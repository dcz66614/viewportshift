/**
 * P021 ViewportShift — shared analysis-status derivation (T011, S4).
 *
 * Contract: P021_PROJECT_BOOK.md §5.2 (SPEC_VERSION 1.0.0).
 *
 * What this module is: the single shared definition of
 * `deriveAnalysisStatus`, previously duplicated in `src/ui/scenario.ts`
 * and `src/cli.ts` (T010 P2-2: the CLI copy could never return
 * BOUNDED_NO_WITNESS — neither can this one, by design: the status
 * is derived from the geometry evaluation only, never from the BFS
 * result, so BOUNDED_NO_WITNESS is not a possible outcome here; the
 * BFS status is reported separately in the witness panel / envelope).
 * Both call sites now import this function; the behaviour is
 * unchanged: UNKNOWN / INVALID fail closed, otherwise FAIL when any
 * replayed step fired a failure predicate, else PASS.
 *
 * Pure function only: no wall clock, no timers, no randomness, no
 * I/O, no date/time access.
 */

import type { GeometryEvaluation } from "./geometry-eval.ts";
import type { AnalysisStatus } from "./types.ts";

/**
 * Derive the top-bar analysis status from a geometry evaluation:
 * UNKNOWN / INVALID fail closed; otherwise FAIL when any step fired
 * a failure predicate, else PASS.
 */
export function deriveAnalysisStatus(
  evaluation: GeometryEvaluation,
): AnalysisStatus {
  if (evaluation.status === "UNKNOWN") return "UNKNOWN";
  if (evaluation.status === "INVALID") return "INVALID";
  for (const step of evaluation.steps) {
    if (step.failedPredicates.length > 0) return "FAIL";
  }
  return "PASS";
}
