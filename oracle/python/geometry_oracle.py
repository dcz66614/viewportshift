"""Independent Python Geometry Oracle for P021 ViewportShift (T003).

Contract: P021_PROJECT_BOOK.md SS4.4-4.6, SS6.1 and
P021_IMPLEMENTATION_PLAN.md SS5 (T003), SS6.

This module is a fully independent implementation of the viewport state
machine (transitions + replay), rectangle geometry, failure predicates and
scenario analysis. It never imports or calls the TypeScript code and shares
no production algorithm module with it. The two sides share only the
read-only scenario fixtures (tests/fixtures/s0/*.json) and the field names.

Frozen semantics (identical to src/domain/geometry.ts; see its header for
the full rationale):

- Fixed-point integers only: 1 unit = 1/1000 CSS px. ``visibleRatio`` is
  an integer milli-ratio, ``visibleArea * 1000 // surfaceArea`` (exact
  integer division). ``anchorDrift.magnitude`` is ``math.isqrt`` of the
  exact squared length, never a float square root.
- Surface rect S is derived from the fixture's declarative layout spec:
  bottom-anchored layouts sit at ``y = layoutHeight - offset - height``,
  top-anchored layouts at ``y = offset``. The expected anchor rect is the
  same anchor expressed relative to the visual viewport. Drift is the
  actual origin minus the expected origin.
- With V the visual-viewport rect and K the keyboard rect,
  ``keyboardObscuredArea = |S ∩ V ∩ K|`` while the keyboard is visible,
  else 0. In ``resizes-visual`` / ``resizes-content`` K is disjoint from V
  (below the shrunken visual viewport), so obscuration is 0 there and an
  element outside V counts as *clipped*, not obscured. In
  ``overlays-content`` V covers the full layout, so the triple
  intersection equals ``|S ∩ K|``. After a DELAYED_VISUAL_PAN in
  ``resizes-visual``, V can overlap K and the overlap is counted once.
- ``viewportClippedArea = |S| - |S ∩ V|``;
  ``visibleArea = |S ∩ V| - keyboardObscuredArea``. Invariant:
  ``visibleArea + viewportClippedArea + keyboardObscuredArea
  = surfaceArea``.
- ``bottomGap = (visualOffsetTop + visualHeight) - surfaceBottom``
  (signed; positive = gap remains).
- Zero-area surface (width <= 0 or height <= 0) is INVALID, never 0.
- Scenario status is decided by the FINAL step's failure predicates; every
  step's fired predicates are still recorded (transient failures stay
  visible in the evidence).
- Unsupported mode strings are rejected at the analysis layer with status
  UNKNOWN (``unsupported_mode``); the T002 state machine does not
  whitelist mode names itself, so this layer fails closed instead.
- Scale != 1, event-clock regression and out-of-range keyboard height are
  UNKNOWN via replay (state kept as of before the failing event, replay
  stops there).

CLI usage (the S0 scripts call it; it takes no other input)::

    python3 oracle/python/geometry_oracle.py \\
        --files tests/fixtures/s0/s0-geometry-01.json ... \\
        --out evidence/s0/S0_GEOMETRY_PY.json [--repeat 100]

Exit code 0 only when every fixture analyses without an internal error
and (for --repeat N) all N runs hash identically. Fixture expectation
checks (expected_status) are the caller's job; this module reports what
it computed, it never rewrites expectations to match itself.

Fixed seed (frozen by the implementation plan):
P021-VIEWPORTSHIFT-S0-2026-11-10
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import sys
from pathlib import Path

SEED = "P021-VIEWPORTSHIFT-S0-2026-11-10"
VIEWPORT_MODES = ("resizes-visual", "resizes-content", "overlays-content")
ANALYSIS_VERSION = "s0-geometry/v1"

__all__ = [
    "SEED",
    "VIEWPORT_MODES",
    "ANALYSIS_VERSION",
    "canonical_json",
    "sha256_hex",
    "initial_state",
    "transition",
    "replay",
    "rect_intersection",
    "intersection_area",
    "surface_rect_for",
    "expected_anchor_rect",
    "compute_metrics",
    "evaluate_predicates",
    "analyze_scenario",
    "analyze_scenarios",
]


# ---------------------------------------------------------------------------
# Canonical JSON / hashing (must match the TypeScript side byte for byte
# for identical data: sorted keys, no spaces, integers only, ASCII).
# ---------------------------------------------------------------------------

def canonical_json(value) -> str:
    if value is None or isinstance(value, (bool, int, str)):
        return json.dumps(value, ensure_ascii=True)
    if isinstance(value, list):
        return "[" + ",".join(canonical_json(v) for v in value) + "]"
    if isinstance(value, dict):
        keys = sorted(value.keys())
        return "{" + ",".join(
            json.dumps(k, ensure_ascii=True) + ":" + canonical_json(value[k])
            for k in keys
        ) + "}"
    raise TypeError(f"canonical_json: unsupported value {value!r}")


def sha256_hex(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _is_int(value) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


# ---------------------------------------------------------------------------
# Viewport state machine (independent re-implementation of the T002
# contract, PROJECT_BOOK SS4.1-4.3, including its 7 frozen modelling
# choices from evidence/s0/T002_REPORT.md SS2.2).
# ---------------------------------------------------------------------------

def initial_state(layout_width: int, layout_height: int, mode: str) -> dict:
    if not _is_int(layout_width) or not _is_int(layout_height):
        raise ValueError("initial_state: dimensions must be integers")
    if layout_width <= 0 or layout_height <= 0:
        raise ValueError("initial_state: dimensions must be positive")
    return {
        "layoutWidth": layout_width,
        "layoutHeight": layout_height,
        "visualOffsetLeft": 0,
        "visualOffsetTop": 0,
        "visualWidth": layout_width,
        "visualHeight": layout_height,
        "keyboardRect": {
            "x": 0,
            "y": layout_height,
            "width": layout_width,
            "height": 0,
        },
        "keyboardVisible": False,
        "scrollX": 0,
        "scrollY": 0,
        "mode": mode,
        "pendingPan": {"dx": 0, "dy": 0},
        "eventClock": 0,
    }


def _clamp_int(value: int, low: int, high: int) -> int:
    if value < low:
        return low
    if value > high:
        return high
    return value


def _unknown(current: dict, reason: str) -> dict:
    return {"status": "UNKNOWN", "state": current, "reason": reason,
            "panReport": None}


def transition(current: dict, event: dict, mode: str, profile: dict) -> dict:
    """Pure single-step transition. Never mutates ``current``."""
    if mode != current["mode"]:
        return _unknown(current, "mode_mismatch")
    if profile.get("scale") != 1:
        return _unknown(current, "unsupported_scale")
    event_id = event.get("id")
    if not isinstance(event_id, str) or len(event_id) == 0:
        return _unknown(current, "missing_event_id")
    at_ms = event.get("atMs")
    if not _is_int(at_ms):
        return _unknown(current, "invalid_at_ms")
    if at_ms < current["eventClock"]:
        return _unknown(current, "event_clock_regression")

    event_type = event.get("type")
    if event_type == "KEYBOARD_OPEN":
        height = event.get("keyboardHeight")
        if not _is_int(height):
            return _unknown(current, "invalid_keyboard_height")
        # Full (keyboard-free) layout height: under resizes-content an
        # already-open keyboard has shrunk layoutHeight, so add it back.
        if mode == "resizes-content" and current["keyboardVisible"]:
            full_height = (current["layoutHeight"]
                           + current["keyboardRect"]["height"])
        else:
            full_height = current["layoutHeight"]
        if height < 0 or height > full_height:
            return _unknown(current, "keyboard_height_out_of_range")
        old_height = (current["keyboardRect"]["height"]
                      if current["keyboardVisible"] else 0)
        delta = height - old_height
        h = height
        if mode == "resizes-visual":
            state = dict(current)
            state["visualHeight"] = current["layoutHeight"] - h
            state["keyboardRect"] = {"x": 0, "y": current["layoutHeight"] - h,
                                     "width": current["layoutWidth"],
                                     "height": h}
            state["keyboardVisible"] = True
            state["eventClock"] = at_ms
            return {"status": "OK", "state": state, "reason": None,
                    "panReport": None}
        if mode == "resizes-content":
            new_layout_height = current["layoutHeight"] - delta
            state = dict(current)
            state["layoutHeight"] = new_layout_height
            state["visualOffsetLeft"] = 0
            state["visualOffsetTop"] = 0
            state["visualWidth"] = current["layoutWidth"]
            state["visualHeight"] = new_layout_height
            state["keyboardRect"] = {"x": 0, "y": new_layout_height,
                                     "width": current["layoutWidth"],
                                     "height": h}
            state["keyboardVisible"] = True
            state["eventClock"] = at_ms
            return {"status": "OK", "state": state, "reason": None,
                    "panReport": None}
        # overlays-content: sizes do not move; the keyboard rect overlaps.
        state = dict(current)
        state["keyboardRect"] = {"x": 0, "y": current["layoutHeight"] - h,
                                 "width": current["layoutWidth"],
                                 "height": h}
        state["keyboardVisible"] = True
        state["eventClock"] = at_ms
        return {"status": "OK", "state": state, "reason": None,
                "panReport": None}

    if event_type == "KEYBOARD_CLOSE":
        if not current["keyboardVisible"]:
            # Idempotent close: only the clock advances.
            state = dict(current)
            state["eventClock"] = at_ms
            return {"status": "OK", "state": state, "reason": None,
                    "panReport": None}
        h = current["keyboardRect"]["height"]
        if mode == "resizes-visual":
            state = dict(current)
            state["visualHeight"] = current["visualHeight"] + h
            state["keyboardRect"] = {"x": 0, "y": current["layoutHeight"],
                                     "width": current["layoutWidth"],
                                     "height": 0}
            state["keyboardVisible"] = False
            state["eventClock"] = at_ms
            return {"status": "OK", "state": state, "reason": None,
                    "panReport": None}
        if mode == "resizes-content":
            new_layout_height = current["layoutHeight"] + h
            state = dict(current)
            state["layoutHeight"] = new_layout_height
            state["visualOffsetLeft"] = 0
            state["visualOffsetTop"] = 0
            state["visualWidth"] = current["layoutWidth"]
            state["visualHeight"] = new_layout_height
            state["keyboardRect"] = {"x": 0, "y": new_layout_height,
                                     "width": current["layoutWidth"],
                                     "height": 0}
            state["keyboardVisible"] = False
            state["eventClock"] = at_ms
            return {"status": "OK", "state": state, "reason": None,
                    "panReport": None}
        state = dict(current)
        state["keyboardRect"] = {"x": 0, "y": current["layoutHeight"],
                                 "width": current["layoutWidth"],
                                 "height": 0}
        state["keyboardVisible"] = False
        state["eventClock"] = at_ms
        return {"status": "OK", "state": state, "reason": None,
                "panReport": None}

    if event_type == "SCROLL":
        dx = event.get("dx")
        dy = event.get("dy")
        if not _is_int(dx) or not _is_int(dy):
            return _unknown(current, "invalid_scroll_delta")
        # Scroll offsets are independent fields; the visual offset is
        # untouched. Lower bound 0; no upper bound is modelled.
        state = dict(current)
        state["scrollX"] = (current["scrollX"] + dx
                            if current["scrollX"] + dx >= 0 else 0)
        state["scrollY"] = (current["scrollY"] + dy
                            if current["scrollY"] + dy >= 0 else 0)
        state["eventClock"] = at_ms
        return {"status": "OK", "state": state, "reason": None,
                "panReport": None}

    if event_type == "DELAYED_VISUAL_PAN":
        dx = event.get("dx")
        dy = event.get("dy")
        if not _is_int(dx) or not _is_int(dy):
            return _unknown(current, "invalid_pan_delta")
        max_left = current["layoutWidth"] - current["visualWidth"]
        if max_left < 0:
            max_left = 0
        max_top = current["layoutHeight"] - current["visualHeight"]
        if max_top < 0:
            max_top = 0
        new_left = _clamp_int(current["visualOffsetLeft"] + dx, 0, max_left)
        new_top = _clamp_int(current["visualOffsetTop"] + dy, 0, max_top)
        applied_dx = new_left - current["visualOffsetLeft"]
        applied_dy = new_top - current["visualOffsetTop"]
        reasons = []
        if applied_dx != dx:
            reasons.append(f"dx clamped to [0, {max_left}]")
        if applied_dy != dy:
            reasons.append(f"dy clamped to [0, {max_top}]")
        pan_report = {
            "requestedDx": dx,
            "requestedDy": dy,
            "appliedDx": applied_dx,
            "appliedDy": applied_dy,
            "clamped": len(reasons) > 0,
            "clampReason": "; ".join(reasons) if reasons else None,
        }
        state = dict(current)
        state["visualOffsetLeft"] = new_left
        state["visualOffsetTop"] = new_top
        state["pendingPan"] = {"dx": applied_dx, "dy": applied_dy}
        state["eventClock"] = at_ms
        return {"status": "OK", "state": state, "reason": None,
                "panReport": pan_report}

    if event_type == "VIEWPORT_SETTLED":
        state = dict(current)
        state["pendingPan"] = {"dx": 0, "dy": 0}
        state["eventClock"] = at_ms
        return {"status": "OK", "state": state, "reason": None,
                "panReport": None}

    return _unknown(current, "unknown_event_type")


def replay(initial: dict, events, mode: str, profile: dict) -> dict:
    """Deterministic replay in array order; stops at the first UNKNOWN."""
    state = initial
    pan_reports = []
    for event in events:
        result = transition(state, event, mode, profile)
        pan_reports.append(result["panReport"])
        if result["status"] == "UNKNOWN":
            return {
                "status": "UNKNOWN",
                "state": state,
                "reason": result["reason"],
                "failedEventId": event.get("id"),
                "panReports": pan_reports,
            }
        state = result["state"]
    return {
        "status": "OK",
        "state": state,
        "reason": None,
        "failedEventId": None,
        "panReports": pan_reports,
    }


def _step_states(initial: dict, events, mode: str, scale) -> list:
    """States after each successful event, in order (mirrors replay)."""
    states = []
    state = initial
    for event in events:
        result = transition(state, event, mode, {"scale": scale})
        if result["status"] == "UNKNOWN":
            break
        state = result["state"]
        states.append(state)
    return states


# ---------------------------------------------------------------------------
# Rectangle geometry (PROJECT_BOOK SS4.4).
# ---------------------------------------------------------------------------

def rect_intersection(a: dict, b: dict):
    left = max(a["x"], b["x"])
    top = max(a["y"], b["y"])
    right = min(a["x"] + a["width"], b["x"] + b["width"])
    bottom = min(a["y"] + a["height"], b["y"] + b["height"])
    if right <= left or bottom <= top:
        return None
    return {"x": left, "y": top, "width": right - left,
            "height": bottom - top}


def intersection_area(a: dict, b: dict) -> int:
    hit = rect_intersection(a, b)
    return 0 if hit is None else hit["width"] * hit["height"]


def surface_rect_for(layout: dict, state: dict) -> dict:
    if layout["anchor"] == "bottom":
        y = (state["layoutHeight"] - layout["offsetMilli"]
             - layout["heightMilli"])
    else:  # top
        y = layout["offsetMilli"]
    return {
        "x": layout["xMilli"],
        "y": y,
        "width": layout["widthMilli"],
        "height": layout["heightMilli"],
    }


def expected_anchor_rect(layout: dict, state: dict) -> dict:
    visual_bottom = state["visualOffsetTop"] + state["visualHeight"]
    if layout["anchor"] == "bottom":
        y = visual_bottom - layout["offsetMilli"] - layout["heightMilli"]
    else:  # top
        y = state["visualOffsetTop"] + layout["offsetMilli"]
    return {
        "x": state["visualOffsetLeft"] + layout["xMilli"],
        "y": y,
        "width": layout["widthMilli"],
        "height": layout["heightMilli"],
    }


def compute_metrics(layout: dict, state: dict):
    """Return (status, reason, metrics-or-None) for one state."""
    surface = surface_rect_for(layout, state)
    if (not _is_int(surface["width"]) or not _is_int(surface["height"])
            or surface["width"] <= 0 or surface["height"] <= 0):
        return ("INVALID", "zero_area_surface", None)
    visual_rect = {
        "x": state["visualOffsetLeft"],
        "y": state["visualOffsetTop"],
        "width": state["visualWidth"],
        "height": state["visualHeight"],
    }
    surface_area = surface["width"] * surface["height"]
    visible_intersection = intersection_area(surface, visual_rect)
    keyboard_obscured_area = 0
    if state["keyboardVisible"]:
        visible_keyboard = rect_intersection(
            visual_rect, state["keyboardRect"])
        if visible_keyboard is not None:
            keyboard_obscured_area = intersection_area(
                surface, visible_keyboard)
    visible_area = visible_intersection - keyboard_obscured_area
    viewport_clipped_area = surface_area - visible_intersection
    visible_ratio = (visible_area * 1000) // surface_area
    bottom_gap = ((state["visualOffsetTop"] + state["visualHeight"])
                  - (surface["y"] + surface["height"]))
    expected = expected_anchor_rect(layout, state)
    dx = surface["x"] - expected["x"]
    dy = surface["y"] - expected["y"]
    magnitude = math.isqrt(dx * dx + dy * dy)
    metrics = {
        "surfaceArea": surface_area,
        "keyboardObscuredArea": keyboard_obscured_area,
        "viewportClippedArea": viewport_clipped_area,
        "visibleArea": visible_area,
        "visibleRatio": visible_ratio,
        "bottomGap": bottom_gap,
        "anchorDrift": {"dx": dx, "dy": dy, "magnitude": magnitude},
    }
    return ("OK", None, metrics)


def _metric_field(metrics: dict, field: str) -> int:
    if field == "visibleRatio":
        return metrics["visibleRatio"]
    if field == "keyboardObscuredArea":
        return metrics["keyboardObscuredArea"]
    if field == "bottomGap":
        return metrics["bottomGap"]
    if field == "anchorDriftMagnitude":
        return metrics["anchorDrift"]["magnitude"]
    raise ValueError(f"unknown predicate field: {field}")


def evaluate_predicates(metrics: dict, predicates) -> list:
    fired = []
    for pred in predicates:
        value = _metric_field(metrics, pred["field"])
        op = pred["op"]
        threshold = pred["threshold"]
        if op == "<":
            hit = value < threshold
        elif op == ">":
            hit = value > threshold
        elif op == "<=":
            hit = value <= threshold
        elif op == ">=":
            hit = value >= threshold
        elif op == "==":
            hit = value == threshold
        else:
            raise ValueError(f"unknown predicate op: {op}")
        if hit:
            fired.append(pred["field"])
    return fired


# ---------------------------------------------------------------------------
# Scenario analysis.
# ---------------------------------------------------------------------------

def _validate_fixture(fixture: dict) -> None:
    scenario_id = fixture.get("scenario_id")
    if not isinstance(scenario_id, str) or len(scenario_id) == 0:
        raise ValueError("fixture: missing scenario_id")
    if fixture.get("seed") != SEED:
        raise ValueError(
            f"fixture {scenario_id}: seed mismatch (expected {SEED})")
    layout = fixture["layout"]
    if layout.get("anchor") not in ("bottom", "top"):
        raise ValueError(f"fixture {scenario_id}: bad layout anchor")
    for name in ("offsetMilli", "xMilli", "widthMilli", "heightMilli"):
        if not _is_int(layout.get(name)):
            raise ValueError(
                f"fixture {scenario_id}: non-integer geometry input")
    viewport = fixture["viewport"]
    if (not _is_int(viewport.get("layoutWidth"))
            or not _is_int(viewport.get("layoutHeight"))):
        raise ValueError(f"fixture {scenario_id}: non-integer viewport")
    if viewport["layoutWidth"] <= 0 or viewport["layoutHeight"] <= 0:
        raise ValueError(f"fixture {scenario_id}: non-positive viewport")
    if not _is_int(fixture["keyboard"].get("heightMilli")):
        raise ValueError(f"fixture {scenario_id}: non-integer keyboard")
    if not isinstance(fixture.get("events"), list) or not isinstance(
            fixture.get("failure_predicates"), list):
        raise ValueError(
            f"fixture {scenario_id}: events/predicates must be arrays")


def analyze_scenario(fixture: dict) -> dict:
    _validate_fixture(fixture)
    scenario_sha256 = sha256_hex(canonical_json(fixture))
    initial = initial_state(
        fixture["viewport"]["layoutWidth"],
        fixture["viewport"]["layoutHeight"],
        fixture["mode"],
    )
    events = fixture["events"]
    if fixture["mode"] not in VIEWPORT_MODES:
        first_id = None
        if events:
            first = events[0].get("id")
            first_id = first if isinstance(first, str) else None
        return {
            "scenarioId": fixture["scenario_id"],
            "scenarioSha256": scenario_sha256,
            "seed": fixture["seed"],
            "layoutTemplate": fixture["layout"]["template"],
            "mode": fixture["mode"],
            "status": "UNKNOWN",
            "reason": "unsupported_mode",
            "failedEventId": first_id,
            "replayStatus": "NOT_RUN",
            "finalState": initial,
            "finalMetrics": None,
            "failedPredicates": [],
            "firstFailedStepIndex": None,
            "expectedStatus": fixture["expected_status"],
            "plantedError": fixture["planted_error"],
            "panReports": [],
            "steps": [],
        }

    mode = fixture["mode"]
    scale = (fixture.get("profile") or {}).get("scale", 1)
    replayed = replay(initial, events, mode, {"scale": scale})
    step_states = _step_states(initial, events, mode, scale)

    steps = []
    first_failed_step_index = None
    geometry_invalid = False
    invalid_reason = None
    for i, state in enumerate(step_states):
        event = events[i]
        surface = surface_rect_for(fixture["layout"], state)
        expected = expected_anchor_rect(fixture["layout"], state)
        status, reason, metrics = compute_metrics(fixture["layout"], state)
        fired = []
        if status == "INVALID":
            geometry_invalid = True
            invalid_reason = reason
            step_status = "INVALID"
        else:
            fired = evaluate_predicates(
                metrics, fixture["failure_predicates"])
            step_status = "FAIL" if fired else "PASS"
            if fired and first_failed_step_index is None:
                first_failed_step_index = i
        steps.append({
            "eventId": str(event.get("id", "")),
            "eventType": str(event.get("type", "")),
            "atMs": event.get("atMs", 0),
            "state": state,
            "surfaceRect": surface,
            "expectedAnchorRect": expected,
            "metrics": metrics,
            "stepStatus": step_status,
            "failedPredicates": fired,
        })

    final_state = step_states[-1] if step_states else initial
    final_step = steps[-1] if steps else None
    final_metrics = final_step["metrics"] if final_step else None

    if replayed["status"] == "UNKNOWN":
        return {
            "scenarioId": fixture["scenario_id"],
            "scenarioSha256": scenario_sha256,
            "seed": fixture["seed"],
            "layoutTemplate": fixture["layout"]["template"],
            "mode": fixture["mode"],
            "status": "UNKNOWN",
            "reason": replayed["reason"],
            "failedEventId": replayed["failedEventId"],
            "replayStatus": "UNKNOWN",
            "finalState": final_state,
            "finalMetrics": final_metrics,
            "failedPredicates": [],
            "firstFailedStepIndex": first_failed_step_index,
            "expectedStatus": fixture["expected_status"],
            "plantedError": fixture["planted_error"],
            "panReports": replayed["panReports"],
            "steps": steps,
        }
    if geometry_invalid:
        return {
            "scenarioId": fixture["scenario_id"],
            "scenarioSha256": scenario_sha256,
            "seed": fixture["seed"],
            "layoutTemplate": fixture["layout"]["template"],
            "mode": fixture["mode"],
            "status": "INVALID",
            "reason": invalid_reason,
            "failedEventId": None,
            "replayStatus": "OK",
            "finalState": final_state,
            "finalMetrics": final_metrics,
            "failedPredicates": [],
            "firstFailedStepIndex": first_failed_step_index,
            "expectedStatus": fixture["expected_status"],
            "plantedError": fixture["planted_error"],
            "panReports": replayed["panReports"],
            "steps": steps,
        }
    final_fired = final_step["failedPredicates"] if final_step else []
    return {
        "scenarioId": fixture["scenario_id"],
        "scenarioSha256": scenario_sha256,
        "seed": fixture["seed"],
        "layoutTemplate": fixture["layout"]["template"],
        "mode": fixture["mode"],
        "status": "FAIL" if final_fired else "PASS",
        "reason": None,
        "failedEventId": None,
        "replayStatus": "OK",
        "finalState": final_state,
        "finalMetrics": final_metrics,
        "failedPredicates": final_fired,
        "firstFailedStepIndex": first_failed_step_index,
        "expectedStatus": fixture["expected_status"],
        "plantedError": fixture["planted_error"],
        "panReports": replayed["panReports"],
        "steps": steps,
    }


def analyze_scenarios(fixtures) -> dict:
    """Analyse fixtures in order; return the shared core document."""
    results = [analyze_scenario(f) for f in fixtures]
    core = {
        "results": results,
        "seed": SEED,
        "version": ANALYSIS_VERSION,
    }
    return {"core": core, "analysisSha256": sha256_hex(canonical_json(core))}


def load_fixtures(paths) -> list:
    fixtures = []
    for path in paths:
        with open(path, "r", encoding="utf-8") as handle:
            fixtures.append(json.load(handle))
    return fixtures


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(
        description="P021 independent Python geometry Oracle (T003).")
    parser.add_argument("--files", nargs="+", required=True,
                        help="Scenario fixture JSON files, in order.")
    parser.add_argument("--out", required=True,
                        help="Output JSON path.")
    parser.add_argument("--repeat", type=int, default=1,
                        help="Repeat the full analysis N times; all runs "
                        "must hash identically (determinism check).")
    args = parser.parse_args(argv)
    if args.repeat < 1:
        print("oracle: --repeat must be >= 1", file=sys.stderr)
        return 2
    hashes = []
    analysed = None
    for _ in range(args.repeat):
        fixtures = load_fixtures(args.files)
        analysed = analyze_scenarios(fixtures)
        hashes.append(analysed["analysisSha256"])
    unique_hashes = sorted(set(hashes))
    output = {
        "analysisSha256": analysed["analysisSha256"],
        "determinism": {
            "runs": args.repeat,
            "uniqueHashes": len(unique_hashes),
            "hashes": unique_hashes,
        },
        "results": analysed["core"]["results"],
        "seed": SEED,
        "version": ANALYSIS_VERSION,
    }
    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as handle:
        handle.write(json.dumps(output, sort_keys=True, indent=2) + "\n")
    counts = {}
    for result in analysed["core"]["results"]:
        counts[result["status"]] = counts.get(result["status"], 0) + 1
    print(f"oracle: scenarios={len(analysed['core']['results'])} "
          f"statuses={counts} "
          f"analysisSha256={analysed['analysisSha256']} "
          f"runs={args.repeat} uniqueHashes={len(unique_hashes)}")
    if len(unique_hashes) != 1:
        print("oracle: FAIL — determinism broken (multiple hashes)",
              file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
