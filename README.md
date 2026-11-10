# ViewportShift (P021)

**不需要手机。** Deterministic lab for mobile soft-keyboard viewport behaviour:
simulate how a chat input, bottom sheet, or fixed CTA gets obscured across
the three standard viewport response modes, and find the shortest failing
event sequence — using only synthetic layouts, synthetic events, and a
fixed seed, on your dev machine.

**行为模型实验室，不是真实设备兼容性认证。**
Simulated results are not equivalent to any vendor browser's full
implementation and do not replace real-device testing.

**Status:** `SPEC_FROZEN / S0_PASS` — T001–T003 complete: environment +
skeleton, three-mode state-machine PoC, rectangle-geometry + independent
Python Oracle PoC with the 48-scenario S0 gate passing (53/53 parity
including 5 edge cases, 12/12 planted errors, 0 false positives, 100 runs
/ 1 hash). S1–S2 complete (Schema, three-mode evaluators, delayed-pan /
scroll events, occlusion geometry, bounded BFS). T009 local Web UI +
SVG timeline done (test:ui 202/202). T010 JSON import/export, offline
HTML report, and synthetic demo done (`npm run test:export` 136/136).
See `evidence/s0/S0_GATE.json` and `P021_PROJECT_BOOK.md` (product
contract) and `P021_IMPLEMENTATION_PLAN.md`.

## Quick start

```sh
npm ci
npm run build                      # web app (dist/) + CLI (dist/viewportshift.mjs)
node dist/viewportshift.mjs demo   # synthetic-only demo, exit 0
npm run test:export                # 136/136 checks: round-trip, fail-closed import, offline report, demo hashes
```

Requires Node ≥ 20 and Python 3 (`python3`; bare `python` is not installed on
the build VM). No GPU, Docker, phone, or external API is needed. Runtime is
offline: zero network, zero LLM/API, zero telemetry, zero upload.

## One-command synthetic demo

`node dist/viewportshift.mjs demo` loads the built-in synthetic scenario
(chat input, 390 × 56 CSS px, bottom-anchored, on a 390 × 844 CSS px layout
viewport; 300 CSS px keyboard; `overlays-content`; frozen seed
`P021-VIEWPORTSHIFT-S0-2026-11-10`), replays it, runs the bounded BFS
witness search, and writes deterministic outputs to `demo-output/`:

| File | Contents |
|---|---|
| `viewportshift-demo.json` | Canonical result JSON (scenario + replay + BFS witness) |
| `viewportshift-demo-report.html` | Self-contained offline HTML report (inline SVG, zero external resources) |
| `DEMO_MANIFEST.json` | Recomputable SHA-256 digests of the two files above |

Demo result (recomputable — re-running the demo yields identical hashes):

- Scenario SHA-256: `b3bc29aa2e21970964eb26959848ebf76c2d0019dcb6c21aed65d27f113048e2`
- Result SHA-256: `88f2153afd19cd19659d48587b7a98286621fff7ca9ae37cec0de6a4e50f6b60`
- Status: **FAIL** — shortest failing sequence is 1 event:
  `KEYBOARD_OPEN` (keyboard height 300 CSS px, at 100 ms).
  Keyboard obscured area **21840 CSS px²**, visible ratio **0%**,
  visible area 0 CSS px².

## Three-mode comparison

Same chat input, same event (keyboard opens, 300 CSS px), three modes:

| Mode | Status | Visible ratio | Keyboard obscured | Viewport clipped | Bottom gap | Shortest witness |
|---|---|---|---|---|---|---|
| `resizes-visual` | FAIL | 0% | 0 CSS px² | 21840 CSS px² | −300 CSS px | 1 event (`KEYBOARD_OPEN`, 100 ms) |
| `resizes-content` | PASS | 100% | 0 CSS px² | 0 CSS px² | 0 CSS px | none (`BOUNDED_NO_WITNESS`) |
| `overlays-content` | FAIL | 0% | 21840 CSS px² | 0 CSS px² | 0 CSS px | 1 event (`KEYBOARD_OPEN`, 100 ms) |

Why they differ: in `resizes-visual` the keyboard shrinks the visual
viewport, so the input is *clipped* out of view (bottom gap −300 CSS px);
in `overlays-content` the visual viewport keeps its size and the keyboard
*covers* the input (21840 CSS px² obscured); in `resizes-content` the
layout viewport shrinks with the keyboard and the input stays visible.
The delayed visual-viewport pan (`DELAYED_VISUAL_PAN`) is a stress event,
not a fourth standard mode.

## JSON import / export and offline reports

- `src/io/json.ts`: scenario / result JSON import (strict Schema
  validation; oversize, malformed, over-deep, and hostile inputs fail
  closed; imported text is data, never executed) and export (canonical
  JSON — export → import → export is byte-identical and its SHA-256
  recomputes).
- `src/io/report.ts`: self-contained offline HTML report — scenario ID,
  mode, seed, text status, inline SVG viewport profile, event timeline,
  shortest-failure witness, and key numbers. Zero CDN, zero remote
  resources; all report text is HTML-escaped.
- Import limits: 1 MiB, nesting depth 32, 10,000 JSON values.

## Local web UI

```sh
npm run dev    # then open the printed local address
```

Pick a synthetic layout (chat input / bottom sheet / fixed CTA), a mode,
and a fixed event sequence; replay, inspect the SVG profile and timeline,
read the shortest-failure witness, and export JSON (scenario + replay +
witness). The UI export panel offers JSON download; file import and the
offline HTML report are the T010 CLI / `src/io` path above.

License: `PENDING_SAM_DECISION` — do not publish or redistribute until Sam decides.
