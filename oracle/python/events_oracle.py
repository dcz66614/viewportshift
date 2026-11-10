"""Independent Python Events Oracle for P021 ViewportShift (T006).

Contract: P021_PROJECT_BOOK.md SS3.4, SS4.1-4.3, SS6.1 and
P021_IMPLEMENTATION_PLAN.md SS5 (T006), SS6.

This module is a fully independent implementation of the formal
delayed-pan / scroll / keyboard / settled event model:
frozen-schema validation
(``viewportshift.scenario/v1``), the three standard mode transitions,
and the per-step SS4.2 mode-contract checks. It never imports or calls
the TypeScript code and shares no production algorithm module with it;
it also does not import the S0 geometry Oracle. The two sides share
only the read-only event fixtures (tests/fixtures/events/*.json), the
field names, and the canonical-JSON definition.

Frozen semantics (identical to src/domain/events.ts; see its header for
the full rationale):

- Fixed-point integers only: 1 unit = 1/1000 CSS px. Every decision
  comparison is an integer comparison.
- Schema first: an input is validated with the frozen T004 rules
  (fixed check order, frozen error codes, INVALID dominates UNKNOWN)
  before any state machine runs. Only VALID scenarios are replayed;
  INVALID / UNKNOWN inputs yield null states and empty step traces.
- Mode whitelist, fail-closed: a mode outside
  ``resizes-visual`` / ``resizes-content`` / ``overlays-content`` is
  UNKNOWN (``unsupported_mode``). It is never evaluated as if it were
  ``overlays-content``.
- Per-step contract checks (SS4.2): after every successful transition
  the result is checked against the mode/event contract (layout /
  visual / keyboard relations, scroll independence, pan clamping,
  pendingPan lifecycle, clock advance). A violated check fails the
  step closed with UNKNOWN
  (``mode_contract_violation:<check-name>``) and the replay stops with
  the state kept as of before the violating event.
- ``DELAYED_VISUAL_PAN`` is an event, never a fourth mode: it moves
  only the visual offset (clamped), records ``pendingPan``, and never
  changes the ``mode`` field (every step asserts ``mode_unchanged``).
- PoC behaviours retained unchanged (the project book is silent on
  them): in ``resizes-visual`` KEYBOARD_CLOSE restores ``visualHeight``
  but does not reset ``visualOffsetTop``; in ``resizes-content``
  KEYBOARD_OPEN zeroes the visual offsets; KEYBOARD_CLOSE with no open
  keyboard is idempotent (only the clock advances); SCROLL updates
  only the independent scroll offsets, lower-bounded at 0.

CLI usage (the events scripts call it; it takes no other input)::

    python3 oracle/python/events_oracle.py \\
        --files tests/fixtures/events/events-rv-open-pan-exact-top.json ... \\
        --out evidence/events/EVENTS_PY.json [--repeat N]

Exit code 0 only when every fixture evaluates without an internal
error and (for --repeat N) all N runs hash identically. Fixture
expectation checks (expected status / reason / final state) are the
caller's job; this module reports what it computed, it never rewrites
expectations to match itself.

Fixed seed (frozen by the implementation plan):
P021-VIEWPORTSHIFT-S0-2026-11-10
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from pathlib import Path

SEED = "P021-VIEWPORTSHIFT-S0-2026-11-10"
SCHEMA_VERSION = "viewportshift.scenario/v1"
SCHEMA_UNIT = "css-px-milli"
EVENTS_VERSION = "events/v1"
VIEWPORT_MODES = ("resizes-visual", "resizes-content", "overlays-content")
EVENT_TYPES = ("KEYBOARD_OPEN", "KEYBOARD_CLOSE", "SCROLL",
               "DELAYED_VISUAL_PAN", "VIEWPORT_SETTLED")
LAYOUT_TEMPLATES = ("chat-input", "bottom-sheet", "fixed-cta", "search-bar")
LAYOUT_ANCHORS = ("bottom", "top")
PREDICATE_FIELDS = ("visibleRatio", "keyboardObscuredArea", "bottomGap",
                    "anchorDriftMagnitude")
PREDICATE_OPS = ("<", ">", "<=", ">=", "==")
MAX_DIMENSION_MILLI = 10_000_000
MAX_AT_MS = 2_147_483_647
MAX_EVENTS_LIMIT = 64
MAX_DEPTH_LIMIT = 16
MAX_NODES_LIMIT = 1_000_000
DEFAULT_LIMITS = {
    "maxEvents": 8,
    "maxPanMilli": 500000,
    "maxDepth": 8,
    "maxNodes": 10000,
    "scale": 1,
}

INVALID_CODES = frozenset([
    "missing_field",
    "invalid_type",
    "invalid_value",
    "non_integer_value",
    "illegal_unit",
    "invalid_enum",
    "negative_size",
    "zero_area_surface",
    "non_positive_viewport",
    "value_out_of_range",
    "invalid_limits",
    "duplicate_event_id",
    "invalid_at_ms",
])

__all__ = [
    "SEED",
    "SCHEMA_VERSION",
    "SCHEMA_UNIT",
    "EVENTS_VERSION",
    "VIEWPORT_MODES",
    "canonical_json",
    "sha256_hex",
    "validate_scenario",
    "is_standard_mode",
    "initial_state",
    "transition",
    "contract_checks_for",
    "evaluate_mode_transition",
    "clamp_bounds_for",
    "pan_clamp",
    "scroll_clamp",
    "event_checks_for",
    "evaluate_event_transition",
    "evaluate_scenario_events",
    "evaluate_events",
    "evaluate_fixtures",
]


# ---------------------------------------------------------------------------
# Canonical JSON / hashing (must match the TypeScript side byte for byte
# for identical data: sorted keys, no spaces, integers only, ASCII).
# ---------------------------------------------------------------------------

def canonical_json(value) -> str:
    if value is None or isinstance(value, (bool, int, float, str)):
        # Floats occur only in INVALID inputs (e.g. a non-integer
        # dimension); json.dumps renders them the same way the
        # TypeScript side's JSON.stringify does for these values.
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


def _is_record(value) -> bool:
    return isinstance(value, dict)


_UNIT_STRING_RE = re.compile(r"^-?\d+(\.\d+)?\s*[a-zA-Z%]+$")


def _looks_like_unit_string(value: str) -> bool:
    return bool(_UNIT_STRING_RE.match(value.strip()))


# ---------------------------------------------------------------------------
# Frozen T004 validation (independent re-implementation of
# src/domain/validate.ts: same fixed check order, same codes, same
# messages, same normalisation. INVALID dominates UNKNOWN.)
# ---------------------------------------------------------------------------

class _Collector:
    def __init__(self):
        self.issues = []

    def add(self, code, path, message):
        self.issues.append({"code": code, "path": path, "message": message})

    def has_invalid(self):
        return any(i["code"] in INVALID_CODES for i in self.issues)

    def has_unknown(self):
        return any(i["code"] not in INVALID_CODES for i in self.issues)


def _check_required_string(collector, obj, field, path):
    # Mirror the TS check exactly: missing only when the key is absent
    # (JSON has no undefined; null is a type error, not a missing field).
    if field not in obj:
        collector.add("missing_field", path, f"missing required field: {field}")
        return None
    value = obj[field]
    if not isinstance(value, str):
        collector.add("invalid_type", path, f"{field} must be a string")
        return None
    if len(value) == 0:
        collector.add("invalid_value", path, f"{field} must not be empty")
        return None
    return value


def _check_required_int(collector, obj, field, path, minimum, maximum,
                        below_code):
    if field not in obj:
        collector.add("missing_field", path, f"missing required field: {field}")
        return None
    value = obj[field]
    if isinstance(value, str) and _looks_like_unit_string(value):
        collector.add(
            "illegal_unit", path,
            f"{field} must be an integer in milli-px, not a unit-suffixed string")
        return None
    if not isinstance(value, (int, float)) or isinstance(value, bool):
        collector.add("invalid_type", path, f"{field} must be a number")
        return None
    if not _is_int(value):
        collector.add("non_integer_value", path, f"{field} must be an integer")
        return None
    if value < minimum:
        collector.add(below_code, path,
                      f"{field} is below its minimum ({minimum})")
        return None
    if value > maximum:
        collector.add("value_out_of_range", path,
                      f"{field} exceeds its maximum ({maximum})")
        return None
    return value


def _check_layout(collector, data):
    if "layout" not in data:
        collector.add("missing_field", "layout", "missing required field: layout")
        return
    layout = data["layout"]
    if not _is_record(layout):
        collector.add("invalid_type", "layout", "layout must be an object")
        return
    if "template" not in layout:
        collector.add("missing_field", "layout.template",
                      "missing required field: template")
    elif not isinstance(layout["template"], str):
        collector.add("invalid_type", "layout.template",
                      "template must be a string")
    elif layout["template"] not in LAYOUT_TEMPLATES:
        collector.add("unsupported_layout_template", "layout.template",
                      f"unsupported layout template: {layout['template']}")
    if "anchor" not in layout:
        collector.add("missing_field", "layout.anchor",
                      "missing required field: anchor")
    elif not isinstance(layout["anchor"], str):
        collector.add("invalid_type", "layout.anchor",
                      "anchor must be a string")
    elif layout["anchor"] not in LAYOUT_ANCHORS:
        collector.add("invalid_enum", "layout.anchor",
                      f"anchor must be one of: {', '.join(LAYOUT_ANCHORS)}")
    _check_required_int(collector, layout, "offsetMilli",
                        "layout.offsetMilli", 0, MAX_DIMENSION_MILLI,
                        "negative_size")
    _check_required_int(collector, layout, "xMilli", "layout.xMilli",
                        0, MAX_DIMENSION_MILLI, "negative_size")
    width = _check_required_int(collector, layout, "widthMilli",
                                "layout.widthMilli", 0, MAX_DIMENSION_MILLI,
                                "negative_size")
    height = _check_required_int(collector, layout, "heightMilli",
                                 "layout.heightMilli", 0, MAX_DIMENSION_MILLI,
                                 "negative_size")
    if width is not None and height is not None and (width == 0 or height == 0):
        collector.add(
            "zero_area_surface", "layout",
            "surface area must be positive (zero-area surface is INVALID)")


def _check_viewport(collector, data):
    if "viewport" not in data:
        collector.add("missing_field", "viewport",
                      "missing required field: viewport")
        return None
    viewport = data["viewport"]
    if not _is_record(viewport):
        collector.add("invalid_type", "viewport", "viewport must be an object")
        return None
    layout_height = None
    for field in ("layoutWidth", "layoutHeight"):
        path = f"viewport.{field}"
        if field not in viewport:
            collector.add("missing_field", path,
                          f"missing required field: {field}")
            continue
        value = viewport[field]
        if isinstance(value, str) and _looks_like_unit_string(value):
            collector.add(
                "illegal_unit", path,
                f"{field} must be an integer in milli-px, not a unit-suffixed string")
            continue
        if not isinstance(value, (int, float)) or isinstance(value, bool):
            collector.add("invalid_type", path, f"{field} must be a number")
            continue
        if not _is_int(value):
            collector.add("non_integer_value", path,
                          f"{field} must be an integer")
            continue
        if value <= 0:
            collector.add("non_positive_viewport", path,
                          f"{field} must be positive")
            continue
        if value > MAX_DIMENSION_MILLI:
            collector.add("value_out_of_range", path,
                          f"{field} exceeds its maximum ({MAX_DIMENSION_MILLI})")
            continue
        if field == "layoutHeight":
            layout_height = value
    return layout_height


def _check_keyboard(collector, data, layout_height):
    if "keyboard" not in data:
        collector.add("missing_field", "keyboard",
                      "missing required field: keyboard")
        return
    keyboard = data["keyboard"]
    if not _is_record(keyboard):
        collector.add("invalid_type", "keyboard", "keyboard must be an object")
        return
    height = _check_required_int(collector, keyboard, "heightMilli",
                                 "keyboard.heightMilli", 0,
                                 MAX_DIMENSION_MILLI, "negative_size")
    if (height is not None and layout_height is not None
            and height > layout_height):
        collector.add(
            "keyboard_height_out_of_range", "keyboard.heightMilli",
            "keyboard height exceeds the layout viewport height")


def _check_mode(collector, data):
    if "mode" not in data:
        collector.add("missing_field", "mode", "missing required field: mode")
        return
    mode = data["mode"]
    if not isinstance(mode, str):
        collector.add("invalid_type", "mode", "mode must be a string")
        return
    if mode not in VIEWPORT_MODES:
        collector.add("unsupported_mode", "mode",
                      f"unsupported viewport mode: {mode}")


def _check_event_common(collector, event, path):
    event_id = _check_required_string(collector, event, "id", f"{path}.id")
    at_ms = None
    if "atMs" not in event:
        collector.add("missing_field", f"{path}.atMs",
                      "missing required field: atMs")
    elif not isinstance(event["atMs"], (int, float)) or isinstance(event["atMs"], bool):
        collector.add("invalid_type", f"{path}.atMs", "atMs must be a number")
    elif not _is_int(event["atMs"]):
        collector.add("non_integer_value", f"{path}.atMs",
                      "atMs must be an integer")
    elif event["atMs"] < 0 or event["atMs"] > MAX_AT_MS:
        collector.add("invalid_at_ms", f"{path}.atMs",
                      f"atMs must be within [0, {MAX_AT_MS}]")
    else:
        at_ms = event["atMs"]
    return event_id, at_ms


def _check_delta_pair(collector, event, path, max_pan_milli, is_pan):
    for field in ("dx", "dy"):
        value = _check_required_int(collector, event, field,
                                    f"{path}.{field}", -MAX_DIMENSION_MILLI,
                                    MAX_DIMENSION_MILLI, "value_out_of_range")
        if (is_pan and value is not None and max_pan_milli is not None
                and abs(value) > max_pan_milli):
            collector.add(
                "pan_limit_exceeded", f"{path}.{field}",
                f"pan delta exceeds limits.maxPanMilli ({max_pan_milli})")


def _check_events(collector, data, layout_height, max_pan_milli):
    if "events" not in data:
        collector.add("missing_field", "events",
                      "missing required field: events")
        return []
    events = data["events"]
    if not isinstance(events, list):
        collector.add("invalid_type", "events", "events must be an array")
        return []
    parsed = []
    clock = []
    for index, raw in enumerate(events):
        path = f"events[{index}]"
        if not _is_record(raw):
            collector.add("invalid_type", path, "event must be an object")
            clock.append(None)
            continue
        parsed.append(raw)
        _, at_ms = _check_event_common(collector, raw, path)
        clock.append(at_ms)
        if "type" not in raw:
            collector.add("missing_field", f"{path}.type",
                          "missing required field: type")
            continue
        event_type = raw["type"]
        if not isinstance(event_type, str):
            collector.add("invalid_type", f"{path}.type",
                          "type must be a string")
            continue
        if event_type not in EVENT_TYPES:
            collector.add("unsupported_event_type", f"{path}.type",
                          f"unsupported event type: {event_type}")
            continue
        if event_type == "KEYBOARD_OPEN":
            height = _check_required_int(
                collector, raw, "keyboardHeight",
                f"{path}.keyboardHeight", 0, MAX_DIMENSION_MILLI,
                "negative_size")
            if (height is not None and layout_height is not None
                    and height > layout_height):
                collector.add(
                    "keyboard_height_out_of_range", f"{path}.keyboardHeight",
                    "keyboard height exceeds the layout viewport height")
        elif event_type == "SCROLL":
            _check_delta_pair(collector, raw, path, None, False)
        elif event_type == "DELAYED_VISUAL_PAN":
            _check_delta_pair(collector, raw, path, max_pan_milli, True)
    for i in range(1, len(clock)):
        prev = clock[i - 1]
        curr = clock[i]
        if prev is not None and curr is not None and curr < prev:
            collector.add(
                "event_clock_regression", f"events[{i}].atMs",
                f"event clock regressed: atMs {curr} < previous {prev}")
    seen = set()
    for index, event in enumerate(parsed):
        event_id = event.get("id")
        if isinstance(event_id, str) and len(event_id) > 0:
            if event_id in seen:
                collector.add("duplicate_event_id", f"events[{index}].id",
                              f"duplicate event id: {event_id}")
            else:
                seen.add(event_id)
    return parsed


def _check_predicates(collector, data):
    if "failure_predicates" not in data:
        collector.add("missing_field", "failure_predicates",
                      "missing required field: failure_predicates")
        return
    predicates = data["failure_predicates"]
    if not isinstance(predicates, list):
        collector.add("invalid_type", "failure_predicates",
                      "failure_predicates must be an array")
        return
    for index, raw in enumerate(predicates):
        path = f"failure_predicates[{index}]"
        if not _is_record(raw):
            collector.add("invalid_type", path, "predicate must be an object")
            continue
        if "field" not in raw:
            collector.add("missing_field", f"{path}.field",
                          "missing required field: field")
        elif not isinstance(raw["field"], str):
            collector.add("invalid_type", f"{path}.field",
                          "field must be a string")
        elif raw["field"] not in PREDICATE_FIELDS:
            collector.add("invalid_enum", f"{path}.field",
                          f"field must be one of: {', '.join(PREDICATE_FIELDS)}")
        if "op" not in raw:
            collector.add("missing_field", f"{path}.op",
                          "missing required field: op")
        elif not isinstance(raw["op"], str):
            collector.add("invalid_type", f"{path}.op", "op must be a string")
        elif raw["op"] not in PREDICATE_OPS:
            collector.add("invalid_enum", f"{path}.op",
                          f"op must be one of: {', '.join(PREDICATE_OPS)}")
        _check_required_int(collector, raw, "threshold",
                            f"{path}.threshold", -MAX_DIMENSION_MILLI,
                            MAX_DIMENSION_MILLI, "value_out_of_range")


def _check_limits(collector, data):
    empty = {"maxEvents": None, "maxPanMilli": None}
    if "limits" not in data:
        collector.add("missing_field", "limits",
                      "missing required field: limits")
        return empty
    limits = data["limits"]
    if not _is_record(limits):
        collector.add("invalid_type", "limits", "limits must be an object")
        return empty
    max_events = None
    max_pan_milli = None
    if "maxEvents" not in limits:
        collector.add("missing_field", "limits.maxEvents",
                      "missing required field: maxEvents")
    elif not isinstance(limits["maxEvents"], (int, float)) or isinstance(limits["maxEvents"], bool):
        collector.add("invalid_type", "limits.maxEvents",
                      "maxEvents must be a number")
    elif not _is_int(limits["maxEvents"]):
        collector.add("non_integer_value", "limits.maxEvents",
                      "maxEvents must be an integer")
    elif limits["maxEvents"] < 1 or limits["maxEvents"] > MAX_EVENTS_LIMIT:
        collector.add("invalid_limits", "limits.maxEvents",
                      f"maxEvents must be within [1, {MAX_EVENTS_LIMIT}]")
    else:
        max_events = limits["maxEvents"]
    if "maxPanMilli" not in limits:
        collector.add("missing_field", "limits.maxPanMilli",
                      "missing required field: maxPanMilli")
    elif not isinstance(limits["maxPanMilli"], (int, float)) or isinstance(limits["maxPanMilli"], bool):
        collector.add("invalid_type", "limits.maxPanMilli",
                      "maxPanMilli must be a number")
    elif not _is_int(limits["maxPanMilli"]):
        collector.add("non_integer_value", "limits.maxPanMilli",
                      "maxPanMilli must be an integer")
    elif limits["maxPanMilli"] < 0 or limits["maxPanMilli"] > MAX_DIMENSION_MILLI:
        collector.add("invalid_limits", "limits.maxPanMilli",
                      f"maxPanMilli must be within [0, {MAX_DIMENSION_MILLI}]")
    else:
        max_pan_milli = limits["maxPanMilli"]
    for field, maximum in (("maxDepth", MAX_DEPTH_LIMIT),
                           ("maxNodes", MAX_NODES_LIMIT)):
        if field in limits:
            value = limits[field]
            if not isinstance(value, (int, float)) or isinstance(value, bool):
                collector.add("invalid_type", f"limits.{field}",
                              f"{field} must be a number")
            elif not _is_int(value):
                collector.add("non_integer_value", f"limits.{field}",
                              f"{field} must be an integer")
            elif value < 1 or value > maximum:
                collector.add("invalid_limits", f"limits.{field}",
                              f"{field} must be within [1, {maximum}]")
    if "scale" in limits:
        if not isinstance(limits["scale"], (int, float)) or isinstance(limits["scale"], bool):
            collector.add("invalid_type", "limits.scale",
                          "scale must be a number")
    return {"maxEvents": max_events, "maxPanMilli": max_pan_milli}


def _check_profile(collector, data):
    if "profile" not in data:
        return
    profile = data["profile"]
    if not _is_record(profile):
        collector.add("invalid_type", "profile", "profile must be an object")
        return
    if "scale" in profile:
        if not isinstance(profile["scale"], (int, float)) or isinstance(profile["scale"], bool):
            collector.add("invalid_type", "profile.scale",
                          "scale must be a number")
        elif profile["scale"] != 1:
            collector.add(
                "unsupported_scale", "profile.scale",
                f"unsupported scale: {profile['scale']} (MVP scale is fixed at 1)")


def validate_scenario(data):
    """Validate an unknown value as a viewportshift.scenario/v1 scenario.

    Returns {"outcome": "VALID"|"INVALID"|"UNKNOWN", "issues": [...],
    "scenario": normalized scenario dict or None}. Never mutates its
    input. Issues are emitted in fixed check order.
    """
    collector = _Collector()
    if not _is_record(data):
        collector.add("invalid_type", "$", "scenario must be an object")
        return {"outcome": "INVALID", "issues": collector.issues,
                "scenario": None}

    scenario_id = _check_required_string(collector, data, "scenario_id",
                                         "scenario_id")
    _check_required_string(collector, data, "seed", "seed")

    if "unit" in data:
        if not isinstance(data["unit"], str):
            collector.add("invalid_type", "unit", "unit must be a string")
        elif data["unit"] != SCHEMA_UNIT:
            collector.add(
                "illegal_unit", "unit",
                f"unit must be {SCHEMA_UNIT} (all values are integers in milli-px)")

    _check_layout(collector, data)
    layout_height = _check_viewport(collector, data)
    _check_keyboard(collector, data, layout_height)
    _check_mode(collector, data)

    raw_max_pan = None
    if (_is_record(data.get("limits"))
            and _is_int(data["limits"].get("maxPanMilli"))
            and data["limits"]["maxPanMilli"] >= 0):
        raw_max_pan = data["limits"]["maxPanMilli"]
    events = _check_events(collector, data, layout_height, raw_max_pan)
    _check_predicates(collector, data)
    limits_info = _check_limits(collector, data)
    _check_profile(collector, data)
    max_events = limits_info["maxEvents"]
    if max_events is not None and len(events) > max_events:
        collector.add(
            "event_limit_exceeded", "events",
            f"event count {len(events)} exceeds limits.maxEvents ({max_events})")

    if collector.has_invalid():
        outcome = "INVALID"
    elif collector.has_unknown():
        outcome = "UNKNOWN"
    else:
        outcome = "VALID"

    if outcome != "VALID" or scenario_id is None:
        return {"outcome": outcome, "issues": collector.issues,
                "scenario": None}

    layout = data["layout"]
    viewport = data["viewport"]
    keyboard = data["keyboard"]
    limits = data["limits"]
    profile = data["profile"] if _is_record(data.get("profile")) else {}
    scenario = {
        "scenario_id": scenario_id,
        "seed": data["seed"],
        "unit": SCHEMA_UNIT,
        "layout": {
            "template": layout["template"],
            "anchor": layout["anchor"],
            "offsetMilli": layout["offsetMilli"],
            "xMilli": layout["xMilli"],
            "widthMilli": layout["widthMilli"],
            "heightMilli": layout["heightMilli"],
        },
        "viewport": {
            "layoutWidth": viewport["layoutWidth"],
            "layoutHeight": viewport["layoutHeight"],
        },
        "keyboard": {"heightMilli": keyboard["heightMilli"]},
        "mode": data["mode"],
        "events": events,
        "failure_predicates": data["failure_predicates"],
        "limits": {
            "maxEvents": limits["maxEvents"],
            "maxPanMilli": limits["maxPanMilli"],
            "maxDepth": (limits["maxDepth"]
                         if _is_int(limits.get("maxDepth"))
                         else DEFAULT_LIMITS["maxDepth"]),
            "maxNodes": (limits["maxNodes"]
                         if _is_int(limits.get("maxNodes"))
                         else DEFAULT_LIMITS["maxNodes"]),
            "scale": (limits["scale"]
                      if isinstance(limits.get("scale"), (int, float))
                      and not isinstance(limits.get("scale"), bool)
                      else DEFAULT_LIMITS["scale"]),
        },
        "profile": {
            "scale": (profile["scale"]
                      if isinstance(profile.get("scale"), (int, float))
                      and not isinstance(profile.get("scale"), bool)
                      else DEFAULT_LIMITS["scale"]),
        },
    }
    return {"outcome": outcome, "issues": collector.issues,
            "scenario": scenario}


# ---------------------------------------------------------------------------
# Viewport state machine (independent re-implementation of the T002
# contract, PROJECT_BOOK SS4.1-4.3).
# ---------------------------------------------------------------------------

def is_standard_mode(value) -> bool:
    return value in VIEWPORT_MODES


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


# ---------------------------------------------------------------------------
# Mode-contract checks (PROJECT_BOOK SS4.2; identical check names and
# order to src/domain/modes.ts).
# ---------------------------------------------------------------------------

def _rect_equals(a: dict, b: dict) -> bool:
    return (a["x"] == b["x"] and a["y"] == b["y"]
            and a["width"] == b["width"] and a["height"] == b["height"])


def _check(name, passed) -> dict:
    return {"name": name, "passed": passed}


def contract_checks_for(prev: dict, nxt: dict, event: dict, mode: str) -> list:
    checks = [
        _check("clock_advanced", nxt["eventClock"] == event["atMs"]),
        _check("mode_unchanged", nxt["mode"] == prev["mode"]),
    ]
    layout_unchanged = (nxt["layoutWidth"] == prev["layoutWidth"]
                        and nxt["layoutHeight"] == prev["layoutHeight"])
    visual_unchanged = (nxt["visualWidth"] == prev["visualWidth"]
                        and nxt["visualHeight"] == prev["visualHeight"]
                        and nxt["visualOffsetLeft"] == prev["visualOffsetLeft"]
                        and nxt["visualOffsetTop"] == prev["visualOffsetTop"])
    scroll_unchanged = (nxt["scrollX"] == prev["scrollX"]
                        and nxt["scrollY"] == prev["scrollY"])
    pan_unchanged = (nxt["pendingPan"]["dx"] == prev["pendingPan"]["dx"]
                     and nxt["pendingPan"]["dy"] == prev["pendingPan"]["dy"])
    keyboard_unchanged = (_rect_equals(nxt["keyboardRect"],
                                       prev["keyboardRect"])
                          and nxt["keyboardVisible"] == prev["keyboardVisible"])

    event_type = event.get("type")
    if event_type == "KEYBOARD_OPEN":
        h = event["keyboardHeight"]
        if mode == "resizes-visual":
            checks += [
                _check("rv_layout_unchanged", layout_unchanged),
                _check("rv_visual_width_unchanged",
                       nxt["visualWidth"] == prev["visualWidth"]),
                _check("rv_visual_height_shrunk",
                       nxt["visualHeight"] == nxt["layoutHeight"] - h),
                _check("rv_keyboard_rect", _rect_equals(
                    nxt["keyboardRect"],
                    {"x": 0, "y": nxt["layoutHeight"] - h,
                     "width": nxt["layoutWidth"], "height": h})),
                _check("rv_keyboard_visible", nxt["keyboardVisible"] is True),
                _check("rv_offsets_unchanged",
                       nxt["visualOffsetLeft"] == prev["visualOffsetLeft"]
                       and nxt["visualOffsetTop"] == prev["visualOffsetTop"]),
                _check("rv_scroll_unchanged", scroll_unchanged),
                _check("rv_pending_pan_unchanged", pan_unchanged),
            ]
        elif mode == "resizes-content":
            if prev["keyboardVisible"]:
                full_height = (prev["layoutHeight"]
                               + prev["keyboardRect"]["height"])
            else:
                full_height = prev["layoutHeight"]
            checks += [
                _check("rc_layout_width_unchanged",
                       nxt["layoutWidth"] == prev["layoutWidth"]),
                _check("rc_layout_height_shrunk",
                       nxt["layoutHeight"] == full_height - h),
                _check("rc_visual_follows_layout",
                       nxt["visualWidth"] == nxt["layoutWidth"]
                       and nxt["visualHeight"] == nxt["layoutHeight"]),
                _check("rc_offsets_zeroed",
                       nxt["visualOffsetLeft"] == 0
                       and nxt["visualOffsetTop"] == 0),
                _check("rc_keyboard_rect", _rect_equals(
                    nxt["keyboardRect"],
                    {"x": 0, "y": nxt["layoutHeight"],
                     "width": nxt["layoutWidth"], "height": h})),
                _check("rc_keyboard_visible", nxt["keyboardVisible"] is True),
                _check("rc_scroll_unchanged", scroll_unchanged),
                _check("rc_pending_pan_unchanged", pan_unchanged),
            ]
        else:
            checks += [
                _check("oc_layout_unchanged", layout_unchanged),
                _check("oc_visual_unchanged", visual_unchanged),
                _check("oc_keyboard_rect", _rect_equals(
                    nxt["keyboardRect"],
                    {"x": 0, "y": nxt["layoutHeight"] - h,
                     "width": nxt["layoutWidth"], "height": h})),
                _check("oc_keyboard_visible", nxt["keyboardVisible"] is True),
                _check("oc_scroll_unchanged", scroll_unchanged),
                _check("oc_pending_pan_unchanged", pan_unchanged),
            ]
    elif event_type == "KEYBOARD_CLOSE":
        if mode == "resizes-visual":
            if prev["keyboardVisible"]:
                restored = (nxt["visualHeight"]
                            == prev["visualHeight"]
                            + prev["keyboardRect"]["height"])
            else:
                restored = nxt["visualHeight"] == prev["visualHeight"]
            checks += [
                _check("rv_layout_unchanged", layout_unchanged),
                _check("rv_visual_width_unchanged",
                       nxt["visualWidth"] == prev["visualWidth"]),
                _check("rv_visual_restored", restored),
                _check("rv_keyboard_rect_cleared", _rect_equals(
                    nxt["keyboardRect"],
                    {"x": 0, "y": nxt["layoutHeight"],
                     "width": nxt["layoutWidth"], "height": 0})),
                _check("rv_keyboard_hidden", nxt["keyboardVisible"] is False),
                _check("rv_offsets_unchanged",
                       nxt["visualOffsetLeft"] == prev["visualOffsetLeft"]
                       and nxt["visualOffsetTop"] == prev["visualOffsetTop"]),
                _check("rv_scroll_unchanged", scroll_unchanged),
                _check("rv_pending_pan_unchanged", pan_unchanged),
            ]
        elif mode == "resizes-content":
            if prev["keyboardVisible"]:
                restored = (nxt["layoutHeight"]
                            == prev["layoutHeight"]
                            + prev["keyboardRect"]["height"])
            else:
                restored = nxt["layoutHeight"] == prev["layoutHeight"]
            checks += [
                _check("rc_layout_width_unchanged",
                       nxt["layoutWidth"] == prev["layoutWidth"]),
                _check("rc_layout_height_restored", restored),
                _check("rc_visual_follows_layout",
                       nxt["visualWidth"] == nxt["layoutWidth"]
                       and nxt["visualHeight"] == nxt["layoutHeight"]),
                _check("rc_offsets_zeroed",
                       nxt["visualOffsetLeft"] == 0
                       and nxt["visualOffsetTop"] == 0),
                _check("rc_keyboard_rect_cleared", _rect_equals(
                    nxt["keyboardRect"],
                    {"x": 0, "y": nxt["layoutHeight"],
                     "width": nxt["layoutWidth"], "height": 0})),
                _check("rc_keyboard_hidden", nxt["keyboardVisible"] is False),
                _check("rc_scroll_unchanged", scroll_unchanged),
                _check("rc_pending_pan_unchanged", pan_unchanged),
            ]
        else:
            checks += [
                _check("oc_layout_unchanged", layout_unchanged),
                _check("oc_visual_unchanged", visual_unchanged),
                _check("oc_keyboard_rect_cleared", _rect_equals(
                    nxt["keyboardRect"],
                    {"x": 0, "y": nxt["layoutHeight"],
                     "width": nxt["layoutWidth"], "height": 0})),
                _check("oc_keyboard_hidden", nxt["keyboardVisible"] is False),
                _check("oc_scroll_unchanged", scroll_unchanged),
                _check("oc_pending_pan_unchanged", pan_unchanged),
            ]
    elif event_type == "SCROLL":
        checks += [
            _check("scroll_offsets",
                   nxt["scrollX"] == (prev["scrollX"] + event["dx"]
                                      if prev["scrollX"] + event["dx"] >= 0
                                      else 0)
                   and nxt["scrollY"] == (prev["scrollY"] + event["dy"]
                                          if prev["scrollY"] + event["dy"] >= 0
                                          else 0)),
            _check("scroll_visual_untouched", visual_unchanged),
            _check("scroll_layout_unchanged", layout_unchanged),
            _check("scroll_keyboard_unchanged", keyboard_unchanged),
            _check("scroll_pending_pan_unchanged", pan_unchanged),
        ]
    elif event_type == "DELAYED_VISUAL_PAN":
        max_left = prev["layoutWidth"] - prev["visualWidth"]
        if max_left < 0:
            max_left = 0
        max_top = prev["layoutHeight"] - prev["visualHeight"]
        if max_top < 0:
            max_top = 0
        expected_left = _clamp_int(prev["visualOffsetLeft"] + event["dx"],
                                   0, max_left)
        expected_top = _clamp_int(prev["visualOffsetTop"] + event["dy"],
                                  0, max_top)
        checks += [
            _check("pan_offsets_clamped",
                   nxt["visualOffsetLeft"] == expected_left
                   and nxt["visualOffsetTop"] == expected_top),
            _check("pan_pending_recorded",
                   nxt["pendingPan"]["dx"]
                   == nxt["visualOffsetLeft"] - prev["visualOffsetLeft"]
                   and nxt["pendingPan"]["dy"]
                   == nxt["visualOffsetTop"] - prev["visualOffsetTop"]),
            _check("pan_layout_unchanged", layout_unchanged),
            _check("pan_visual_size_unchanged",
                   nxt["visualWidth"] == prev["visualWidth"]
                   and nxt["visualHeight"] == prev["visualHeight"]),
            _check("pan_keyboard_unchanged", keyboard_unchanged),
            _check("pan_scroll_unchanged", scroll_unchanged),
        ]
    elif event_type == "VIEWPORT_SETTLED":
        settled_unchanged = (
            nxt["layoutWidth"] == prev["layoutWidth"]
            and nxt["layoutHeight"] == prev["layoutHeight"]
            and nxt["visualOffsetLeft"] == prev["visualOffsetLeft"]
            and nxt["visualOffsetTop"] == prev["visualOffsetTop"]
            and nxt["visualWidth"] == prev["visualWidth"]
            and nxt["visualHeight"] == prev["visualHeight"]
            and _rect_equals(nxt["keyboardRect"], prev["keyboardRect"])
            and nxt["keyboardVisible"] == prev["keyboardVisible"]
            and nxt["scrollX"] == prev["scrollX"]
            and nxt["scrollY"] == prev["scrollY"])
        checks += [
            _check("settled_pending_cleared",
                   nxt["pendingPan"]["dx"] == 0
                   and nxt["pendingPan"]["dy"] == 0),
            _check("settled_state_unchanged", settled_unchanged),
        ]
    return checks


# ---------------------------------------------------------------------------
# Formal evaluation.
# ---------------------------------------------------------------------------

def evaluate_mode_transition(prev: dict, event: dict, mode: str,
                             profile: dict) -> dict:
    if not is_standard_mode(mode):
        return {"status": "UNKNOWN", "state": prev,
                "reason": "unsupported_mode", "panReport": None,
                "contractChecks": []}
    result = transition(prev, event, mode, profile)
    if result["status"] == "UNKNOWN":
        return {"status": "UNKNOWN", "state": prev,
                "reason": result["reason"], "panReport": None,
                "contractChecks": []}
    checks = contract_checks_for(prev, result["state"], event, mode)
    failed = next((c for c in checks if not c["passed"]), None)
    if failed is not None:
        return {"status": "UNKNOWN", "state": prev,
                "reason": f"mode_contract_violation:{failed['name']}",
                "panReport": None, "contractChecks": checks}
    return {"status": "OK", "state": result["state"], "reason": None,
            "panReport": result["panReport"], "contractChecks": checks}


def clamp_bounds_for(state: dict) -> dict:
    return {
        "maxLeft": max(0, state["layoutWidth"] - state["visualWidth"]),
        "maxTop": max(0, state["layoutHeight"] - state["visualHeight"]),
    }


def pan_clamp(prev: dict, dx: int, dy: int) -> dict:
    bounds = clamp_bounds_for(prev)
    new_left = _clamp_int(prev["visualOffsetLeft"] + dx, 0, bounds["maxLeft"])
    new_top = _clamp_int(prev["visualOffsetTop"] + dy, 0, bounds["maxTop"])
    applied_dx = new_left - prev["visualOffsetLeft"]
    applied_dy = new_top - prev["visualOffsetTop"]
    reasons = []
    if applied_dx != dx:
        reasons.append(f"dx clamped to [0, {bounds['maxLeft']}]")
    if applied_dy != dy:
        reasons.append(f"dy clamped to [0, {bounds['maxTop']}]")
    return {
        "bounds": bounds,
        "appliedDx": applied_dx,
        "appliedDy": applied_dy,
        "clamped": len(reasons) > 0,
        "clampReason": "; ".join(reasons) if reasons else None,
    }


def scroll_clamp(prev: dict, dx: int, dy: int) -> dict:
    new_x = 0 if prev["scrollX"] + dx < 0 else prev["scrollX"] + dx
    new_y = 0 if prev["scrollY"] + dy < 0 else prev["scrollY"] + dy
    applied_dx = new_x - prev["scrollX"]
    applied_dy = new_y - prev["scrollY"]
    reasons = []
    if applied_dx != dx:
        reasons.append("dx clamped to [0, +inf)")
    if applied_dy != dy:
        reasons.append("dy clamped to [0, +inf)")
    return {
        "requestedDx": dx,
        "requestedDy": dy,
        "appliedDx": applied_dx,
        "appliedDy": applied_dy,
        "clamped": len(reasons) > 0,
        "clampReason": "; ".join(reasons) if reasons else None,
    }


def event_checks_for(prev: dict, nxt: dict, event: dict, pan_report,
                     scroll_report, clamp_bounds) -> list:
    checks = [
        _check("ev_clock_advanced", nxt["eventClock"] == event["atMs"]),
        _check("ev_clock_monotonic", event["atMs"] >= prev["eventClock"]),
        _check("ev_mode_unchanged", nxt["mode"] == prev["mode"]),
    ]
    visual_unchanged = (
        nxt["visualWidth"] == prev["visualWidth"]
        and nxt["visualHeight"] == prev["visualHeight"]
        and nxt["visualOffsetLeft"] == prev["visualOffsetLeft"]
        and nxt["visualOffsetTop"] == prev["visualOffsetTop"])
    scroll_unchanged = (nxt["scrollX"] == prev["scrollX"]
                        and nxt["scrollY"] == prev["scrollY"])
    event_type = event["type"]
    if event_type == "KEYBOARD_OPEN":
        checks += [
            _check("ev_open_visible", nxt["keyboardVisible"] is True),
            _check("ev_open_pending_unchanged",
                   nxt["pendingPan"] == prev["pendingPan"]),
            _check("ev_open_scroll_unchanged", scroll_unchanged),
        ]
    elif event_type == "KEYBOARD_CLOSE":
        checks += [
            _check("ev_close_hidden", nxt["keyboardVisible"] is False),
            _check("ev_close_offsets_retained",
                   nxt["visualOffsetLeft"] == prev["visualOffsetLeft"]
                   and nxt["visualOffsetTop"] == prev["visualOffsetTop"]),
            _check("ev_close_pending_retained",
                   nxt["pendingPan"] == prev["pendingPan"]),
            _check("ev_close_scroll_unchanged", scroll_unchanged),
        ]
    elif event_type == "SCROLL":
        expected = (scroll_clamp(prev, event["dx"], event["dy"])
                    if scroll_report is not None else None)
        checks += [
            _check("ev_scroll_applied_matches_report",
                   scroll_report is not None and expected is not None
                   and nxt["scrollX"] == prev["scrollX"] + scroll_report["appliedDx"]
                   and nxt["scrollY"] == prev["scrollY"] + scroll_report["appliedDy"]
                   and scroll_report["appliedDx"] == expected["appliedDx"]
                   and scroll_report["appliedDy"] == expected["appliedDy"]),
            _check("ev_scroll_nonnegative",
                   nxt["scrollX"] >= 0 and nxt["scrollY"] >= 0),
            _check("ev_scroll_visual_untouched", visual_unchanged),
            _check("ev_scroll_pending_unchanged",
                   nxt["pendingPan"] == prev["pendingPan"]),
        ]
    elif event_type == "DELAYED_VISUAL_PAN":
        expected = pan_clamp(prev, event["dx"], event["dy"])
        checks += [
            _check("ev_pan_within_bounds",
                   clamp_bounds is not None
                   and 0 <= nxt["visualOffsetLeft"] <= clamp_bounds["maxLeft"]
                   and 0 <= nxt["visualOffsetTop"] <= clamp_bounds["maxTop"]),
            _check("ev_pan_applied_matches_report",
                   pan_report is not None
                   and nxt["visualOffsetLeft"] == prev["visualOffsetLeft"] + pan_report["appliedDx"]
                   and nxt["visualOffsetTop"] == prev["visualOffsetTop"] + pan_report["appliedDy"]
                   and pan_report["appliedDx"] == expected["appliedDx"]
                   and pan_report["appliedDy"] == expected["appliedDy"]
                   and pan_report["requestedDx"] == event["dx"]
                   and pan_report["requestedDy"] == event["dy"]
                   and pan_report["clamped"] == expected["clamped"]
                   and pan_report["clampReason"] == expected["clampReason"]),
            _check("ev_pan_pending_is_applied",
                   nxt["pendingPan"]["dx"] == nxt["visualOffsetLeft"] - prev["visualOffsetLeft"]
                   and nxt["pendingPan"]["dy"] == nxt["visualOffsetTop"] - prev["visualOffsetTop"]),
            _check("ev_pan_visual_size_unchanged",
                   nxt["visualWidth"] == prev["visualWidth"]
                   and nxt["visualHeight"] == prev["visualHeight"]),
            _check("ev_pan_scroll_unchanged", scroll_unchanged),
        ]
    elif event_type == "VIEWPORT_SETTLED":
        rest_unchanged = (
            nxt["layoutWidth"] == prev["layoutWidth"]
            and nxt["layoutHeight"] == prev["layoutHeight"]
            and nxt["visualOffsetLeft"] == prev["visualOffsetLeft"]
            and nxt["visualOffsetTop"] == prev["visualOffsetTop"]
            and nxt["visualWidth"] == prev["visualWidth"]
            and nxt["visualHeight"] == prev["visualHeight"]
            and _rect_equals(nxt["keyboardRect"], prev["keyboardRect"])
            and nxt["keyboardVisible"] == prev["keyboardVisible"]
            and nxt["scrollX"] == prev["scrollX"]
            and nxt["scrollY"] == prev["scrollY"])
        checks += [
            _check("ev_settled_pending_cleared",
                   nxt["pendingPan"] == {"dx": 0, "dy": 0}),
            _check("ev_settled_rest_unchanged", rest_unchanged),
        ]
    return checks


def evaluate_event_transition(prev: dict, event: dict, mode: str,
                              profile: dict) -> dict:
    empty = {"status": "UNKNOWN", "state": prev, "reason": None,
             "panReport": None, "scrollReport": None, "clampBounds": None,
             "eventChecks": [], "contractChecks": []}
    result = evaluate_mode_transition(prev, event, mode, profile)
    if result["status"] == "UNKNOWN":
        return {**empty, "reason": result["reason"],
                "contractChecks": result["contractChecks"]}
    clamp_bounds = (clamp_bounds_for(prev)
                    if event["type"] == "DELAYED_VISUAL_PAN" else None)
    scroll_report = (scroll_clamp(prev, event["dx"], event["dy"])
                     if event["type"] == "SCROLL" else None)
    checks = event_checks_for(prev, result["state"], event,
                              result["panReport"], scroll_report, clamp_bounds)
    failed = next((c for c in checks if not c["passed"]), None)
    if failed is not None:
        return {**empty,
                "reason": f"event_model_violation:{failed['name']}",
                "eventChecks": checks,
                "contractChecks": result["contractChecks"]}
    return {"status": "OK", "state": result["state"], "reason": None,
            "panReport": result["panReport"], "scrollReport": scroll_report,
            "clampBounds": clamp_bounds, "eventChecks": checks,
            "contractChecks": result["contractChecks"]}


def evaluate_scenario_events(scenario: dict, scenario_sha256: str) -> dict:
    mode = scenario["mode"]
    initial = initial_state(scenario["viewport"]["layoutWidth"],
                            scenario["viewport"]["layoutHeight"], mode)
    base = {
        "scenarioId": scenario["scenario_id"],
        "scenarioSha256": scenario_sha256,
        "seed": scenario["seed"],
        "mode": mode,
        "validationIssues": [],
    }
    if not is_standard_mode(mode):
        return {**base, "status": "UNKNOWN", "reason": "unsupported_mode",
                "failedEventId": None, "failedStepIndex": None,
                "initialState": initial, "finalState": initial,
                "steps": [], "panReports": [], "scrollReports": [],
                "clampEvidence": []}
    steps = []
    pan_reports = []
    scroll_reports = []
    clamp_evidence = []
    state = initial
    failed_event_id = None
    failed_step_index = None
    reason = None
    for i, event in enumerate(scenario["events"]):
        result = evaluate_event_transition(state, event, mode,
                                           scenario["profile"])
        pan_reports.append(result["panReport"])
        scroll_reports.append(result["scrollReport"])
        if result["status"] == "UNKNOWN":
            steps.append({
                "index": i,
                "eventId": event["id"],
                "eventType": event["type"],
                "atMs": event["atMs"],
                "status": "UNKNOWN",
                "reason": result["reason"],
                "state": state,
                "panReport": None,
                "scrollReport": None,
                "clampBounds": None,
                "eventChecks": result["eventChecks"],
                "contractChecks": result["contractChecks"],
            })
            failed_event_id = event["id"]
            failed_step_index = i
            reason = result["reason"]
            break
        if (event["type"] == "DELAYED_VISUAL_PAN"
                and result["panReport"] is not None
                and result["clampBounds"] is not None):
            clamp_evidence.append({
                "scenarioId": scenario["scenario_id"],
                "stepIndex": i,
                "eventId": event["id"],
                "requestedDx": result["panReport"]["requestedDx"],
                "requestedDy": result["panReport"]["requestedDy"],
                "appliedDx": result["panReport"]["appliedDx"],
                "appliedDy": result["panReport"]["appliedDy"],
                "maxLeft": result["clampBounds"]["maxLeft"],
                "maxTop": result["clampBounds"]["maxTop"],
                "clamped": result["panReport"]["clamped"],
                "clampReason": result["panReport"]["clampReason"],
            })
        state = result["state"]
        steps.append({
            "index": i,
            "eventId": event["id"],
            "eventType": event["type"],
            "atMs": event["atMs"],
            "status": "OK",
            "reason": None,
            "state": state,
            "panReport": result["panReport"],
            "scrollReport": result["scrollReport"],
            "clampBounds": result["clampBounds"],
            "eventChecks": result["eventChecks"],
            "contractChecks": result["contractChecks"],
        })
    return {**base,
            "status": "OK" if reason is None else "UNKNOWN",
            "reason": reason,
            "failedEventId": failed_event_id,
            "failedStepIndex": failed_step_index,
            "initialState": initial,
            "finalState": state,
            "steps": steps,
            "panReports": pan_reports,
            "scrollReports": scroll_reports,
            "clampEvidence": clamp_evidence}


def evaluate_events(data) -> dict:
    """Full events entry point for an unknown input value: validate
    first, then evaluate only when VALID."""
    scenario_sha256 = sha256_hex(canonical_json(data))
    record = data if _is_record(data) else None
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
            "status": validated["outcome"],
            "reason": (validated["issues"][0]["code"]
                       if validated["issues"] else "invalid_input"),
            "validationIssues": validated["issues"],
            "failedEventId": None,
            "failedStepIndex": None,
            "initialState": None,
            "finalState": None,
            "steps": [],
            "panReports": [],
            "scrollReports": [],
            "clampEvidence": [],
        }
    return evaluate_scenario_events(validated["scenario"], scenario_sha256)


def evaluate_fixtures(fixtures) -> dict:
    """Evaluate fixtures in order; return the shared core document."""
    results = [evaluate_events(f) for f in fixtures]
    core = {
        "results": results,
        "seed": SEED,
        "version": EVENTS_VERSION,
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
        description="P021 independent Python events Oracle (T006).")
    parser.add_argument("--files", nargs="+", required=True,
                        help="Event fixture JSON files, in order.")
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
        "version": EVENTS_VERSION,
    }
    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as handle:
        handle.write(json.dumps(output, sort_keys=True, indent=2) + "\n")
    counts = {}
    for result in evaluated["core"]["results"]:
        counts[result["status"]] = counts.get(result["status"], 0) + 1
    print(f"events oracle: fixtures={len(evaluated['core']['results'])} "
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
