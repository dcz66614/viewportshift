"""Independent Python BFS Oracle for P021 ViewportShift (T011).

Contract: P021_PROJECT_BOOK.md SS4.5, SS4.3, SS4.4, SS6.1 and
P021_IMPLEMENTATION_PLAN.md SS5 (T011), SS6.

This module is an independent implementation of the bounded BFS
shortest-failure-sequence search. The search itself -- the frozen
alphabet, length-first queue order, full-state dedup key, prefix
handling, node/depth bounds and the fail-closed limits rule -- is
written here from the contract, never imported from TypeScript and
never shared with the production algorithm. It reuses the same-side
Python layers for the single-step transition
(``events_oracle.evaluate_event_transition``), the rectangle
geometry (``geometry_full_oracle.compute_metrics`` /
``evaluate_predicates`` / ``evaluate_scenario_geometry``) and the
frozen validation (``modes_oracle.validate_scenario``), exactly as
``geometry_full_oracle.py`` reuses ``modes_oracle.py`` for its replay
layer while implementing its own geometry. The two sides (TS /
Python) share only the read-only fixtures, the field names and the
canonical-JSON definition; the BFS search logic is implemented once
per side and compared field-by-field by
``scripts/oracle-diff-coverage.mjs``.

Frozen semantics (identical to src/domain/bfs.ts; see its header):

- Any-step semantics: predicates are evaluated after EVERY step
  (initial state, every prefix step, every generated step).
- Length-first, frozen alphabet order (12 entries); generated event
  ids are ``bfs-<step>-<slug>`` and timestamps are spaced 100 ms
  from the prefix end (or 0).
- Dedup key = the full canonical ViewportState JSON (all 13 fields).
- Bounds from the scenario limits; queue exhausted -> 
  BOUNDED_NO_WITNESS with limitReached "depth"; node budget first ->
  "nodes". A hit is FAIL with the full witness.
- Fail-closed inputs (T011, P2-2): INVALID / UNKNOWN inputs never
  reach the search. Each of limits.maxDepth / maxNodes is preserved
  when it is an integer inside its frozen bound, and only an illegal
  or missing field falls back to its default, with the fallback
  recorded in ``limitsFallbackReason`` using the exact same strings
  as the TypeScript side.

CLI usage (the coverage scripts call it; it takes no other input)::

    python3 oracle/python/bfs_oracle.py \\
        --files tests/fixtures/bfs/bfs-1step-oc-chat.json ... \\
        --out evidence/coverage/BFS_PY.json [--repeat N]

Exit code 0 only when every fixture searches without an internal
error and (for --repeat N) all N runs hash identically. Fixture
expectation checks are the caller's job; this module reports what it
computed, it never rewrites expectations to match itself.

Fixed seed (frozen by the implementation plan):
P021-VIEWPORTSHIFT-S0-2026-11-10
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from events_oracle import evaluate_event_transition  # noqa: E402
from geometry_full_oracle import (  # noqa: E402
    compute_metrics,
    evaluate_predicates,
    evaluate_scenario_geometry,
    surface_rect_for,
)
from modes_oracle import (  # noqa: E402
    SEED,
    canonical_json,
    initial_state,
    sha256_hex,
    validate_scenario,
)

BFS_VERSION = "bfs/v1"
BFS_STEP_MS = 100
DEFAULT_MAX_DEPTH = 8
DEFAULT_MAX_NODES = 10000
MAX_DEPTH_LIMIT = 16
MAX_NODES_LIMIT = 1000000

BFS_ALPHABET = (
    {"type": "KEYBOARD_OPEN", "keyboardHeight": 150000},
    {"type": "KEYBOARD_OPEN", "keyboardHeight": 300000},
    {"type": "KEYBOARD_CLOSE"},
    {"type": "SCROLL", "dx": -100000, "dy": 0},
    {"type": "SCROLL", "dx": 0, "dy": -100000},
    {"type": "SCROLL", "dx": 0, "dy": 100000},
    {"type": "SCROLL", "dx": 100000, "dy": 0},
    {"type": "DELAYED_VISUAL_PAN", "dx": 0, "dy": -300000},
    {"type": "DELAYED_VISUAL_PAN", "dx": 0, "dy": -100000},
    {"type": "DELAYED_VISUAL_PAN", "dx": 0, "dy": 100000},
    {"type": "DELAYED_VISUAL_PAN", "dx": 0, "dy": 300000},
    {"type": "VIEWPORT_SETTLED"},
)

__all__ = [
    "SEED",
    "BFS_VERSION",
    "BFS_ALPHABET",
    "canonical_json",
    "sha256_hex",
    "alphabet_slug",
    "build_bfs_event",
    "state_key_for",
    "limits_from_raw_input",
    "search_bfs",
    "search_bfs_scenario",
    "evaluate_fixtures",
]


def _is_int(value) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


def alphabet_slug(template: dict) -> str:
    kind = template["type"]
    if kind == "KEYBOARD_OPEN":
        return f"open-{template['keyboardHeight']}"
    if kind == "KEYBOARD_CLOSE":
        return "close"
    if kind == "SCROLL":
        return f"scroll-{template['dx']}-{template['dy']}"
    if kind == "DELAYED_VISUAL_PAN":
        return f"pan-{template['dx']}-{template['dy']}"
    if kind == "VIEWPORT_SETTLED":
        return "settled"
    raise ValueError(f"unknown alphabet entry: {kind}")


def build_bfs_event(template: dict, step_index: int, at_ms: int) -> dict:
    event_id = f"bfs-{step_index}-{alphabet_slug(template)}"
    kind = template["type"]
    if kind == "KEYBOARD_OPEN":
        return {"type": kind, "id": event_id, "atMs": at_ms,
                "keyboardHeight": template["keyboardHeight"]}
    if kind == "KEYBOARD_CLOSE":
        return {"type": kind, "id": event_id, "atMs": at_ms}
    if kind in ("SCROLL", "DELAYED_VISUAL_PAN"):
        return {"type": kind, "id": event_id, "atMs": at_ms,
                "dx": template["dx"], "dy": template["dy"]}
    if kind == "VIEWPORT_SETTLED":
        return {"type": kind, "id": event_id, "atMs": at_ms}
    raise ValueError(f"unknown alphabet entry: {kind}")


def _event_params(event: dict) -> dict:
    kind = event["type"]
    if kind == "KEYBOARD_OPEN":
        return {"keyboardHeight": event["keyboardHeight"]}
    if kind in ("SCROLL", "DELAYED_VISUAL_PAN"):
        return {"dx": event["dx"], "dy": event["dy"]}
    return {}


def state_key_for(state: dict) -> str:
    return canonical_json(state)


def limits_from_raw_input(record):
    """Fail-closed limits (T011, P2-2): mirror of the TS function.

    Each limit is preserved when it is an integer inside its frozen
    bound; otherwise it falls back to its default and the fallback
    is named in the returned reason string (None when nothing fell
    back). The strings are frozen and identical on both sides.
    """
    parts = []
    limits_record = None
    if isinstance(record, dict):
        raw = record.get("limits")
        if isinstance(raw, dict):
            limits_record = raw
    def pick(field, maximum, fallback):  # noqa: E306
        value = limits_record.get(field) if limits_record is not None else None
        if _is_int(value) and 1 <= value <= maximum:
            return value
        parts.append(f"limits.{field} invalid, using default {fallback}")
        return fallback
    limits = {
        "maxDepth": pick("maxDepth", MAX_DEPTH_LIMIT, DEFAULT_MAX_DEPTH),
        "maxNodes": pick("maxNodes", MAX_NODES_LIMIT, DEFAULT_MAX_NODES),
    }
    return {"limits": limits,
            "limitsFallbackReason": "; ".join(parts) if parts else None}


def _fail_closed_result(scenario_id, scenario_sha256, seed, mode, status,
                        reason, validation_issues, limits,
                        limits_fallback_reason):
    return {
        "bfsVersion": BFS_VERSION,
        "scenarioId": scenario_id,
        "scenarioSha256": scenario_sha256,
        "seed": seed,
        "mode": mode,
        "status": status,
        "reason": reason,
        "validationIssues": validation_issues,
        "witness": None,
        "witnessLength": None,
        "failedPredicates": [],
        "firstFailedStepIndex": None,
        "nodesVisited": 0,
        "nodesEnqueued": 0,
        "nodesPrunedDuplicate": 0,
        "transitionsSkippedUnknown": 0,
        "maxDepthReached": 0,
        "limitReached": None,
        "limits": limits,
        "limitsFallbackReason": limits_fallback_reason,
        "alphabet": [dict(entry) for entry in BFS_ALPHABET],
        "initialState": None,
        "initialMetrics": None,
    }


def search_bfs_scenario(scenario: dict, scenario_sha256: str) -> dict:
    limits = {"maxDepth": scenario["limits"]["maxDepth"],
              "maxNodes": scenario["limits"]["maxNodes"]}
    base = {
        "bfsVersion": BFS_VERSION,
        "scenarioId": scenario["scenario_id"],
        "scenarioSha256": scenario_sha256,
        "seed": scenario["seed"],
        "mode": scenario["mode"],
        "validationIssues": [],
        "limits": limits,
        "alphabet": [dict(entry) for entry in BFS_ALPHABET],
    }
    initial = initial_state(scenario["viewport"]["layoutWidth"],
                            scenario["viewport"]["layoutHeight"],
                            scenario["mode"])
    status, reason, initial_metrics = compute_metrics(scenario["layout"],
                                                       initial)
    if status != "OK" or initial_metrics is None:
        return {**base, "status": "INVALID", "reason": reason,
                "witness": None, "witnessLength": None,
                "failedPredicates": [], "firstFailedStepIndex": None,
                "nodesVisited": 0, "nodesEnqueued": 0,
                "nodesPrunedDuplicate": 0, "transitionsSkippedUnknown": 0,
                "maxDepthReached": 0, "limitReached": None,
                "initialState": initial, "initialMetrics": None}
    initial_fired = evaluate_predicates(initial_metrics,
                                        scenario["failure_predicates"])
    if initial_fired:
        return {**base, "status": "FAIL", "reason": None,
                "witness": [], "witnessLength": 0,
                "failedPredicates": initial_fired,
                "firstFailedStepIndex": -1,
                "nodesVisited": 1, "nodesEnqueued": 1,
                "nodesPrunedDuplicate": 0, "transitionsSkippedUnknown": 0,
                "maxDepthReached": 0, "limitReached": None,
                "initialState": initial, "initialMetrics": initial_metrics}

    # Fixed prefix: replay through the geometry evaluator, any-step check.
    start_state = initial
    prefix_steps = []
    next_at_ms = BFS_STEP_MS
    if scenario["events"]:
        prefix_eval = evaluate_scenario_geometry(scenario, scenario_sha256)
        if prefix_eval["status"] != "OK":
            return {**base,
                    "status": ("INVALID" if prefix_eval["status"] == "INVALID"
                               else "UNKNOWN"),
                    "reason": prefix_eval["reason"],
                    "witness": None, "witnessLength": None,
                    "failedPredicates": [], "firstFailedStepIndex": None,
                    "nodesVisited": 0, "nodesEnqueued": 0,
                    "nodesPrunedDuplicate": 0, "transitionsSkippedUnknown": 0,
                    "maxDepthReached": 0, "limitReached": None,
                    "initialState": initial,
                    "initialMetrics": initial_metrics}
        if prefix_eval["finalState"] is not None:
            start_state = prefix_eval["finalState"]
        for step in prefix_eval["steps"]:
            event = scenario["events"][step["index"]]
            prefix_steps.append({
                "index": step["index"],
                "eventId": step["eventId"],
                "eventType": step["eventType"],
                "atMs": step["atMs"],
                "params": _event_params(event),
                "state": step["state"],
                "surfaceRect": step["surfaceRect"],
                "metrics": step["metrics"],
                "failedPredicates": step["failedPredicates"],
            })
        for i, step in enumerate(prefix_steps):
            if step["failedPredicates"]:
                return {**base, "status": "FAIL", "reason": None,
                        "witness": prefix_steps[:i + 1],
                        "witnessLength": i + 1,
                        "failedPredicates": step["failedPredicates"],
                        "firstFailedStepIndex": i,
                        "nodesVisited": 1, "nodesEnqueued": 1,
                        "nodesPrunedDuplicate": 0,
                        "transitionsSkippedUnknown": 0,
                        "maxDepthReached": 0, "limitReached": None,
                        "initialState": initial,
                        "initialMetrics": initial_metrics}
        next_at_ms = scenario["events"][-1]["atMs"] + BFS_STEP_MS
    status, reason, start_metrics = compute_metrics(scenario["layout"],
                                                     start_state)
    if status != "OK" or start_metrics is None:
        return {**base, "status": "INVALID", "reason": reason,
                "witness": None, "witnessLength": None,
                "failedPredicates": [], "firstFailedStepIndex": None,
                "nodesVisited": 0, "nodesEnqueued": 0,
                "nodesPrunedDuplicate": 0, "transitionsSkippedUnknown": 0,
                "maxDepthReached": 0, "limitReached": None,
                "initialState": initial, "initialMetrics": initial_metrics}

    visited = {state_key_for(start_state)}
    queue = [{"events": [], "steps": [], "state": start_state,
              "metrics": start_metrics, "depth": 0, "nextAtMs": next_at_ms}]
    head = 0
    nodes_visited = 0
    nodes_enqueued = 1
    nodes_pruned_duplicate = 0
    transitions_skipped_unknown = 0
    max_depth_reached = 0
    nodes_limit_hit = False

    while head < len(queue):
        node = queue[head]
        head += 1
        nodes_visited += 1
        if node["depth"] >= limits["maxDepth"]:
            continue
        for template in BFS_ALPHABET:
            step_index = len(prefix_steps) + node["depth"] + 1
            event = build_bfs_event(template, step_index, node["nextAtMs"])
            transition = evaluate_event_transition(
                node["state"], event, scenario["mode"], scenario["profile"])
            if transition["status"] == "UNKNOWN":
                transitions_skipped_unknown += 1
                continue
            next_state = transition["state"]
            status, _reason, next_metrics = compute_metrics(
                scenario["layout"], next_state)
            if status != "OK" or next_metrics is None:
                transitions_skipped_unknown += 1
                continue
            fired = evaluate_predicates(next_metrics,
                                        scenario["failure_predicates"])
            step = {
                "index": len(prefix_steps) + node["depth"],
                "eventId": event["id"],
                "eventType": event["type"],
                "atMs": event["atMs"],
                "params": _event_params(event),
                "state": next_state,
                "surfaceRect": surface_rect_for(scenario["layout"],
                                                next_state),
                "metrics": next_metrics,
                "failedPredicates": fired,
            }
            witness = prefix_steps + node["steps"] + [step]
            if fired:
                return {**base, "status": "FAIL", "reason": None,
                        "witness": witness, "witnessLength": len(witness),
                        "failedPredicates": fired,
                        "firstFailedStepIndex": len(witness) - 1,
                        "nodesVisited": nodes_visited,
                        "nodesEnqueued": nodes_enqueued,
                        "nodesPrunedDuplicate": nodes_pruned_duplicate,
                        "transitionsSkippedUnknown":
                            transitions_skipped_unknown,
                        "maxDepthReached": max(max_depth_reached,
                                               node["depth"] + 1),
                        "limitReached": None,
                        "initialState": initial,
                        "initialMetrics": initial_metrics}
            key = state_key_for(next_state)
            if key in visited:
                nodes_pruned_duplicate += 1
                continue
            if nodes_enqueued >= limits["maxNodes"]:
                nodes_limit_hit = True
                break
            visited.add(key)
            nodes_enqueued += 1
            max_depth_reached = max(max_depth_reached, node["depth"] + 1)
            queue.append({
                "events": node["events"] + [event],
                "steps": node["steps"] + [step],
                "state": next_state,
                "metrics": next_metrics,
                "depth": node["depth"] + 1,
                "nextAtMs": node["nextAtMs"] + BFS_STEP_MS,
            })
        if nodes_limit_hit:
            break

    return {**base, "status": "BOUNDED_NO_WITNESS", "reason": None,
            "witness": None, "witnessLength": None,
            "failedPredicates": [], "firstFailedStepIndex": None,
            "nodesVisited": nodes_visited, "nodesEnqueued": nodes_enqueued,
            "nodesPrunedDuplicate": nodes_pruned_duplicate,
            "transitionsSkippedUnknown": transitions_skipped_unknown,
            "maxDepthReached": max_depth_reached,
            "limitReached": "nodes" if nodes_limit_hit else "depth",
            "initialState": initial, "initialMetrics": initial_metrics}


def search_bfs(data) -> dict:
    """Full BFS entry point for an unknown input value: validate first."""
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
    extracted = limits_from_raw_input(record)
    validated = validate_scenario(data)
    if validated["outcome"] != "VALID" or validated["scenario"] is None:
        status = ("INVALID" if validated["outcome"] == "INVALID"
                  else "UNKNOWN")
        return _fail_closed_result(
            scenario_id, scenario_sha256, seed, mode, status,
            (validated["issues"][0]["code"]
             if validated["issues"] else "invalid_input"),
            validated["issues"], extracted["limits"],
            extracted["limitsFallbackReason"])
    return search_bfs_scenario(validated["scenario"], scenario_sha256)


def evaluate_fixtures(fixtures) -> dict:
    """Search fixtures in order; return the shared core document."""
    results = [search_bfs(fixture) for fixture in fixtures]
    core = {"results": results, "seed": SEED, "version": BFS_VERSION}
    return {"core": core, "analysisSha256": sha256_hex(canonical_json(core))}


def load_fixtures(paths) -> list:
    fixtures = []
    for path in paths:
        with open(path, "r", encoding="utf-8") as handle:
            fixtures.append(json.load(handle))
    return fixtures


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="P021 BFS Oracle (T011)")
    parser.add_argument("--files", nargs="+", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--repeat", type=int, default=1)
    args = parser.parse_args(argv)
    fixtures = load_fixtures(args.files)
    hashes = set()
    first = None
    for _ in range(args.repeat):
        result = evaluate_fixtures(fixtures)
        hashes.add(result["analysisSha256"])
        if first is None:
            first = result
    output = {**first["core"],
              "analysisSha256": first["analysisSha256"],
              "determinism": {"runs": args.repeat,
                              "uniqueHashes": len(hashes)}}
    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as handle:
        json.dump(output, handle, indent=2, sort_keys=True)
        handle.write("\n")
    print(f"bfs oracle: fixtures={len(fixtures)} "
          f"analysisSha256={first['analysisSha256']} "
          f"runs={args.repeat} uniqueHashes={len(hashes)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
