// Intent eval. Run: node eval/run.mjs
// Exits non-zero if accuracy is below THRESHOLD so it can gate changes.
import { parseIntent } from "../js/intent.js";
import { cases } from "./cases.js";

const THRESHOLD = 0.9;

let pass = 0;
const fails = [];

for (const c of cases) {
  const got = parseIntent(c.input);

  let ok;
  if (c.expectNull) {
    ok = got === null;
  } else if (c.expectUnsupported) {
    ok = got?.unsupported === true;
  } else {
    ok = got &&
      got.builder === c.builder &&
      (c.council == null || got.params.council === c.council) &&
      (c.year == null ||
        (got.year && got.year.min === c.year.min && got.year.max === c.year.max));
  }

  if (ok) pass++;
  else fails.push({ input: c.input, expected: c, got });
}

const acc = pass / cases.length;
console.log(`Intent eval: ${pass}/${cases.length} (${(acc * 100).toFixed(1)}%)\n`);

for (const f of fails) {
  console.log(`✗ "${f.input}"`);
  console.log(`    expected: ${f.expected.expectNull ? "null" : f.expected.builder}` +
    `${f.expected.council ? " / " + f.expected.council : ""}` +
    `${f.expected.year ? " / " + JSON.stringify(f.expected.year) : ""}`);
  console.log(`    got:      ${f.got ? f.got.builder +
    (f.got.params.council ? " / " + f.got.params.council : "") +
    (f.got.year ? " / " + JSON.stringify(f.got.year) : "") : "null"}`);
}

if (acc < THRESHOLD) {
  console.error(`\nFAIL: below threshold ${THRESHOLD * 100}%`);
  process.exit(1);
}
console.log("\nPASS");
