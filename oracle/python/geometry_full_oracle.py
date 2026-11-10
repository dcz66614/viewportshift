"""Independent Python Geometry Oracle for P021 ViewportShift (T007).

Contract: P021_PROJECT_BOOK.md SS4.4, SS6.1-6.2 and
P021_IMPLEMENTATION_PLAN.md SS5 (T007), SS6.

Layering (mirrors the TypeScript side exactly, with no shared code):

- Replay + validation come from the independent Python Modes Oracle
  (``modes_oracle.py``: the T004 validator port and the T005 formal
  three-mode evaluator port). This is the same layering as the
  TypeScript side, where ``geometry-eval.ts`` builds on ``modes.ts``.
  The Modes Oracle never imports or calls TypeScript, so neither does
  this file.
- Rectangle geometry is implemented here, in this file only: the
  triple intersection, clipping, visible area/ratio, bottomGap and
  anchorDrift are re-derived from PROJECT_BOOK SS4.4, independently
  of both the TypeScript geometry module and the S0
  ``geometry_oracle.py``. The two sides share only the read-only
  fixtures (``tests/fixtures/geometry/*.json``) and the field names.

Frozen semantics (identical to src/domain/geometry.ts and
src/domain/geometry-eval.ts):

- Fixed-point integers only: 1 unit = 1/1000 CSS px.
  ``visibleRatio`` is an integer milli-ratio,
  ``visibleArea * 1000 // surfaceArea`` (exact integer division).
  ``anchorDrift.magnitude`` is ``math.isqrt`` of the exact squared
  length, never a float square root.
- ``keyboardObscuredArea = |S ∩ V ∩ K|`` while the keyboard is
  visible, else 0. In ``resizes-visual`` / ``resizes-content`` K is
  disjoint from V, so obscuration is 0 there and an element outside V
  counts as *clipped*, not obscured. After a DELAYED_VISUAL_PAN in
  ``resizes-visual``, V can overlap K and the overlap is counted
  exactly once (the triple intersection is what prevents double
  deduction when the keyboard rect overlaps the visual viewport only
  partially).
- ``viewportClippedArea = |S| - |S ∩ V|``;
  ``visibleArea = |S ∩ V| - keyboardObscuredArea``. Invariant:
  ``visibleArea + viewportClippedArea + keyboardObscuredArea
  = surfaceArea``.
- ``bottomGap = (visualOffsetTop + visualHeight) - surfaceBottom``
  (signed; positive = gap remains).
- ``anchorDrift`` is the surface origin minus the expected anchor
  origin (bottom anchor keys off the visual bottom edge, top anchor
  off the visual top edge).
- Zero-area surface (width <= 0 or height <= 0) is INVALID, never 0.
  Non-integer rect inputs are INVALID (``non_integer_geometry``).
- Scenario steps cover successful transitions only (the S0
  convention); a transition that fails closed contributes no geometry
  step, and the final state/metrics are those of the last successful
  step. A failed geometry contract check fails the step closed with
  UNKNOWN (``geometry_contract_violation:<check-name>``).
- Upstream decisions carried unchanged: in ``resizes-visual``,
  KEYBOARD_CLOSE restores ``visualHeight`` but does not reset
  ``visualOffsetTop`` (a pan applied while the keyboard was open
  leaves a retained offset, visible here as non-zero anchorDrift).

CLI usage (the T007 scripts call it; it takes no other input)::

    python3 oracle/python/geometry_full_oracle.py \\
        --files tests/fixtures/geometry/geometry-direct-01.json ... \\
        --out evidence/geometry/GEOMETRY_PY.json [--repeat 2]

Exit code 0 only when every fixture evaluates without an internal
error and (for --repeat N) all N runs hash identically. Fixture
expectation checks are the caller's job; this module reports what it
computed, it never rewrites expectations to match itself.

Fixed seed (frozen by the implementation plan):
P021-VIEWPORTSHIFT-S0-2026-11-10
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from modes_oracle import (  # noqa: E402
    SEED,
    canonical_json,
    evaluate_scenario_modes,
    sha256_hex,
    validate_scenario,
)

GEOMETRY_VERSION = "geometry/v1"

GEOMETRY_CONTRACT_CHECK_NAMES = (
    "invariant_sum",
    "obscured_definition",
    "visible_ratio_range",
    "visible_ratio_floor",
    "obscured_within_visible",
    "obscured_within_keyboard",
    "clipped_within_surface",
    "areas_nonnegative",
    "bottom_gap_definition",
    "drift_vector",
    "drift_magnitude",
)

__all__ = [
    "SEED",
    "GEOMETRY_VERSION",
    "GEOMETRY_CONTRACT_CHECK_NAMES",
    "canonical_json",
    "sha256_hex",
    "rect_intersection",
    "intersection_area",
    "triple_intersection_area",
    "compute_geometry_direct",
    "geometry_contract_checks_for",
    "evaluate_predicates",
    "surface_rect_for",
    "expected_anchor_rect",
    "compute_metrics",
    "evaluate_direct_geometry",
    "evaluate_scenario_geometry",
    "evaluate_geometry",
    "evaluate_fixtures",
]


def _is_int(value) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


# ---------------------------------------------------------------------------
# Rectangle geometry (PROJECT_BOOK SS4.4). Independent re-implementation;
# this file shares no geometry code with the TypeScript side or with
# the S0 geometry_oracle.py.
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


def triple_intersection_area(a: dict, b: dict, c: dict) -> int:
    ab = rect_intersection(a, b)
    if ab is None:
        return 0
    return intersection_area(ab, c)


def compute_geometry_direct(geometry_input: dict):
    """Return (status, reason, metrics-or-None) for one rect triple."""
    surface = geometry_input["surface"]
    visual = geometry_input["visual"]
    keyboard = geometry_input["keyboard"]
    keyboard_visible = geometry_input["keyboardVisible"]
    expected_anchor = geometry_input["expectedAnchor"]
    for rect in (surface, visual, keyboard, expected_anchor):
        if (not _is_int(rect["x"]) or not _is_int(rect["y"])
                or not _is_int(rect["width"])
                or not _is_int(rect["height"])):
            return ("INVALID", "non_integer_geometry", None)
    if surface["width"] <= 0 or surface["height"] <= 0:
        return ("INVALID", "zero_area_surface", None)
    surface_area = surface["width"] * surface["height"]
    visible_intersection = intersection_area(surface, visual)
    keyboard_obscured_area = 0
    if keyboard_visible:
        keyboard_obscured_area = triple_intersection_area(
            surface, visual, keyboard)
    visible_area = visible_intersection - keyboard_obscured_area
    viewport_clipped_area = surface_area - visible_intersection
    visible_ratio = (visible_area * 1000) // surface_area
    bottom_gap = ((visual["y"] + visual["height"])
                  - (surface["y"] + surface["height"]))
    dx = surface["x"] - expected_anchor["x"]
    dy = surface["y"] - expected_anchor["y"]
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


def _check(name, passed) -> dict:
    return {"name": name, "passed": passed}


def geometry_contract_checks_for(geometry_input: dict, metrics: dict):
    """The frozen SS4.4 contract checks, in fixed order."""
    surface = geometry_input["surface"]
    visual = geometry_input["visual"]
    keyboard = geometry_input["keyboard"]
    keyboard_visible = geometry_input["keyboardVisible"]
    expected_anchor = geometry_input["expectedAnchor"]
    surface_area = surface["width"] * surface["height"]
    visible_intersection = intersection_area(surface, visual)
    obscured = 0
    if keyboard_visible:
        obscured = triple_intersection_area(surface, visual, keyboard)
    expected_ratio = (metrics["visibleArea"] * 1000) // surface_area
    dx = surface["x"] - expected_anchor["x"]
    dy = surface["y"] - expected_anchor["y"]
    return [
        _check("invariant_sum",
               metrics["visibleArea"] + metrics["viewportClippedArea"]
               + metrics["keyboardObscuredArea"] == surface_area),
        _check("obscured_definition",
               metrics["keyboardObscuredArea"] == obscured),
        _check("visible_ratio_range",
               0 <= metrics["visibleRatio"] <= 1000),
        _check("visible_ratio_floor",
               metrics["visibleRatio"] == expected_ratio),
        _check("obscured_within_visible",
               metrics["keyboardObscuredArea"] <= visible_intersection),
        _check("obscured_within_keyboard",
               metrics["keyboardObscuredArea"]
               <= intersection_area(surface, keyboard)),
        _check("clipped_within_surface",
               metrics["viewportClippedArea"]
               == surface_area - visible_intersection),
        _check("areas_nonnegative",
               metrics["visibleArea"] >= 0
               and metrics["viewportClippedArea"] >= 0
               and metrics["keyboardObscuredArea"] >= 0),
        _check("bottom_gap_definition",
               metrics["bottomGap"]
               == (visual["y"] + visual["height"])
               - (surface["y"] + surface["height"])),
        _check("drift_vector",
               metrics["anchorDrift"]["dx"] == dx
               and metrics["anchorDrift"]["dy"] == dy),
        _check("drift_magnitude",
               metrics["anchorDrift"]["magnitude"]
               == math.isqrt(dx * dx + dy * dy)),
    ]


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
    """Return (status, reason, metrics-or-None) for one replayed state."""
    surface = surface_rect_for(layout, state)
    visual_rect = {
        "x": state["visualOffsetLeft"],
        "y": state["visualOffsetTop"],
        "width": state["visualWidth"],
        "height": state["visualHeight"],
    }
    return compute_geometry_direct({
        "surface": surface,
        "visual": visual_rect,
        "keyboard": state["keyboardRect"],
        "keyboardVisible": state["keyboardVisible"],
        "expectedAnchor": expected_anchor_rect(layout, state),
    })


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
# Scenario / direct evaluation.
# ---------------------------------------------------------------------------

def evaluate_direct_geometry(fixture: dict, scenario_sha256: str) -> dict:
    geometry_input = {
        "surface": fixture["surface"],
        "visual": fixture["visual"],
        "keyboard": fixture["keyboard"],
        "keyboardVisible": fixture["keyboardVisible"],
        "expectedAnchor": fixture["expectedAnchor"],
    }
    status, reason, metrics = compute_geometry_direct(geometry_input)
    checks = []
    if status == "OK" and metrics is not None:
        checks = geometry_contract_checks_for(geometry_input, metrics)
    return {
        "caseId": fixture["case_id"],
        "kind": "direct",
        "scenarioSha256": scenario_sha256,
        "seed": fixture["seed"],
        "status": status,
        "reason": reason,
        "surfaceRect": fixture["surface"],
        "visualRect": fixture["visual"],
        "keyboardRect": fixture["keyboard"],
        "keyboardVisible": fixture["keyboardVisible"],
        "expectedAnchorRect": fixture["expectedAnchor"],
        "metrics": metrics,
        "contractChecks": checks,
    }


def evaluate_scenario_geometry(scenario: dict, scenario_sha256: str) -> dict:
    modes_eval = evaluate_scenario_modes(scenario, scenario_sha256)
    steps = []
    status = modes_eval["status"]
    reason = modes_eval["reason"]
    failed_event_id = modes_eval["failedEventId"]
    failed_step_index = modes_eval["failedStepIndex"]
    for i, mode_step in enumerate(modes_eval["steps"]):
        if mode_step["status"] != "OK":
            break
        state = mode_step["state"]
        surface = surface_rect_for(scenario["layout"], state)
        expected = expected_anchor_rect(scenario["layout"], state)
        computed_status, computed_reason, metrics = compute_metrics(
            scenario["layout"], state)
        if computed_status != "OK" or metrics is None:
            steps.append({
                "index": i,
                "eventId": mode_step["eventId"],
                "eventType": mode_step["eventType"],
                "atMs": mode_step["atMs"],
                "status": "INVALID",
                "reason": computed_reason,
                "state": state,
                "surfaceRect": surface,
                "expectedAnchorRect": expected,
                "metrics": None,
                "contractChecks": [],
                "failedPredicates": [],
            })
            status = "INVALID"
            reason = computed_reason
            failed_event_id = mode_step["eventId"]
            failed_step_index = i
            break
        visual_rect = {
            "x": state["visualOffsetLeft"],
            "y": state["visualOffsetTop"],
            "width": state["visualWidth"],
            "height": state["visualHeight"],
        }
        checks = geometry_contract_checks_for(
            {
                "surface": surface,
                "visual": visual_rect,
                "keyboard": state["keyboardRect"],
                "keyboardVisible": state["keyboardVisible"],
                "expectedAnchor": expected,
            },
            metrics,
        )
        first_failed = next(
            (c for c in checks if not c["passed"]), None)
        if first_failed is not None:
            steps.append({
                "index": i,
                "eventId": mode_step["eventId"],
                "eventType": mode_step["eventType"],
                "atMs": mode_step["atMs"],
                "status": "UNKNOWN",
                "reason": ("geometry_contract_violation:"
                           + first_failed["name"]),
                "state": state,
                "surfaceRect": surface,
                "expectedAnchorRect": expected,
                "metrics": metrics,
                "contractChecks": checks,
                "failedPredicates": [],
            })
            status = "UNKNOWN"
            reason = "geometry_contract_violation:" + first_failed["name"]
            failed_event_id = mode_step["eventId"]
            failed_step_index = i
            break
        fired = evaluate_predicates(
            metrics, scenario["failure_predicates"])
        steps.append({
            "index": i,
            "eventId": mode_step["eventId"],
            "eventType": mode_step["eventType"],
            "atMs": mode_step["atMs"],
            "status": "OK",
            "reason": None,
            "state": state,
            "surfaceRect": surface,
            "expectedAnchorRect": expected,
            "metrics": metrics,
            "contractChecks": checks,
            "failedPredicates": fired,
        })
    last_step = steps[-1] if steps else None
    return {
        "scenarioId": scenario["scenario_id"],
        "scenarioSha256": scenario_sha256,
        "seed": scenario["seed"],
        "mode": scenario["mode"],
        "status": status,
        "reason": reason,
        "validationIssues": [],
        "failedEventId": failed_event_id,
        "failedStepIndex": failed_step_index,
        "initialState": modes_eval["initialState"],
        "finalState": modes_eval["finalState"],
        "steps": steps,
        "panReports": modes_eval["panReports"],
        "finalMetrics": (last_step["metrics"] if last_step else None),
        "finalFailedPredicates": (
            last_step["failedPredicates"]
            if last_step is not None and last_step["status"] == "OK"
            else []),
    }


def evaluate_geometry(data) -> dict:
    """Full geometry entry point for an unknown input value: validate
    first, then evaluate only when VALID."""
    scenario_sha256 = sha256_hex(canonical_json(data))
    record = data if isinstance(data, dict) else None
    scenario_id = (record["scenario_id"]
                   if record is not None
                   and isinstance(record.get("scenario_id"), str) else "")
    seed = (record["seed"]
            if record is not None
            and isinstance(record.get("seed"), str) else "")
    mode = (record["mode"]
            if record is not None
            and isinstance(record.get("mode"), str) else "")
    validated = validate_scenario(data)
    if validated["outcome"] != "VALID" or validated["scenario"] is None:
        return {
            "scenarioId": scenario_id,
            "scenarioSha256": scenario_sha256,
            "seed": seed,
            "mode": mode,
            "status": (validated["outcome"]
                       if validated["outcome"] != "VALID" else "UNKNOWN"),
            "reason": (validated["issues"][0]["code"]
                       if validated["issues"] else "invalid_input"),
            "validationIssues": validated["issues"],
            "failedEventId": None,
            "failedStepIndex": None,
            "initialState": None,
            "finalState": None,
            "steps": [],
            "panReports": [],
            "finalMetrics": None,
            "finalFailedPredicates": [],
        }
    return evaluate_scenario_geometry(validated["scenario"], scenario_sha256)


def evaluate_fixtures(fixtures) -> dict:
    """Evaluate fixtures in order; return the shared core document."""
    results = []
    for fixture in fixtures:
        scenario_sha256 = sha256_hex(canonical_json(fixture))
        if isinstance(fixture, dict) and fixture.get("kind") == "direct":
            results.append(
                evaluate_direct_geometry(fixture, scenario_sha256))
        else:
            results.append(evaluate_geometry(fixture))
    core = {
        "results": results,
        "seed": SEED,
        "version": GEOMETRY_VERSION,
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
        description="P021 independent Python geometry Oracle (T007).")
    parser.add_argument("--files", nargs="+", required=True,
                        help="Geometry fixture JSON files, in order.")
    parser.add_argument("--out", required=True,
                        help="Output JSON path.")
    parser.add_argument("--repeat", type=int, default=1,
                        help="Repeat the full evaluation N times; all runs "
                        "must hash identically (determinism check).")
    args = parser.parse_args(argv)
    if args.repeat < 1:
        print("oracle: --repeat must be >= 1", file=sys.stderr)
        return 2
    hashes = []
    evaluated = None
    for _ in range(args.repeat):
        fixtures = load_fixtures(args.files)
        evaluated = evaluate_fixtures(fixtures)
        hashes.append(evaluated["analysisSha256"])
    unique_hashes = sorted(set(hashes))
    output = {
        "analysisSha256": evaluated["analysisSha256"],
        "determinism": {
            "runs": args.repeat,
            "uniqueHashes": len(unique_hashes),
            "hashes": unique_hashes,
        },
        "results": evaluated["core"]["results"],
        "seed": SEED,
        "version": GEOMETRY_VERSION,
    }
    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as handle:
        handle.write(json.dumps(output, sort_keys=True, indent=2) + "\n")
    counts = {}
    for result in evaluated["core"]["results"]:
        counts[result["status"]] = counts.get(result["status"], 0) + 1
    print(f"geometry oracle: fixtures={len(evaluated['core']['results'])} "
          f"statuses={counts} "
          f"analysisSha256={evaluated['analysisSha256']} "
          f"runs={args.repeat} uniqueHashes={len(unique_hashes)}")
    if len(unique_hashes) != 1:
        print("oracle: FAIL — determinism broken (multiple hashes)",
              file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
