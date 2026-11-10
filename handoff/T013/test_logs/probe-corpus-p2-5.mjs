// T013 independent probe: count geometry steps / INVALID steps across the
// frozen corpus (geometry + golden fixtures), reproducing test-coverage P2-5
// with visible numbers; and count golden expected.bfs fields.
import fs from "node:fs";
import path from "node:path";
import {
  loadJson,
  listGoldenFixtures,
  loadT011Domain,
  sha256Hex,
} from "/home/hatch/workspace/p021-viewportshift/scripts/t011-lib.mjs";

const ROOT = "/home/hatch/workspace/p021-viewportshift";
const { geometryEval, bfs } = await loadT011Domain();
const geoDir = path.join(ROOT, "tests/fixtures/geometry");
const geoFiles = fs.readdirSync(geoDir)
  .filter((f) => f.startsWith("geometry-") && f.endsWith(".json"))
  .map((f) => path.join(geoDir, f));
const goldenFiles = listGoldenFixtures();
let steps = 0, invalidSteps = 0, unknownSteps = 0, fixtures = 0;
for (const file of [...geoFiles, ...goldenFiles]) {
  const fixture = loadJson(file);
  const sha = sha256Hex(bfs.canonicalBfsJson(fixture));
  const result = fixture.kind === "direct"
    ? geometryEval.evaluateDirectGeometry(fixture, sha)
    : geometryEval.evaluateGeometry(fixture, sha);
  fixtures++;
  for (const step of result.steps ?? []) {
    steps++;
    if (step.status === "INVALID") invalidSteps++;
    if (step.status === "UNKNOWN") unknownSteps++;
  }
}
console.log(`corpus fixtures=${fixtures} (geometry=${geoFiles.length} golden=${goldenFiles.length}) steps=${steps} INVALID=${invalidSteps} UNKNOWN=${unknownSteps}`);

// Golden expected.bfs node-count fields
let withNodes = 0, total = 0;
for (const f of goldenFiles) {
  const fx = loadJson(f);
  total++;
  if (fx.expected?.bfs && "nodesVisited" in fx.expected.bfs && "nodesEnqueued" in fx.expected.bfs) withNodes++;
}
console.log(`golden fixtures=${total} with nodesVisited+nodesEnqueued in expected.bfs=${withNodes}`);

// BFS fixtures node-count fields (for contrast)
const bfsDir = path.join(ROOT, "tests/fixtures/bfs");
const bfsFiles = fs.readdirSync(bfsDir).filter((f) => f.endsWith(".json"));
let bfsWith = 0;
for (const f of bfsFiles) {
  const fx = loadJson(path.join(bfsDir, f));
  if (fx.expected?.bfs && "nodesVisited" in fx.expected.bfs) bfsWith++;
}
console.log(`bfs fixtures=${bfsFiles.length} with nodesVisited in expected.bfs=${bfsWith}`);

// Actual nodesVisited/nodesEnqueued for golden fixtures (what the values would be)
for (const f of goldenFiles.slice(0, 3)) {
  const fx = loadJson(f);
  const sha = sha256Hex(bfs.canonicalBfsJson(fx));
  const r = bfs.searchBfs(fx, sha);
  console.log(`${fx.scenario_id}: status=${r.status} nodesVisited=${r.nodesVisited} nodesEnqueued=${r.nodesEnqueued}`);
}
