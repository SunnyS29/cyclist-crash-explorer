import { parseIntent } from "../js/intent.js";
import { cases } from "./cases.js";
import { matches } from "./assertions.js";
const failures = cases.map((c) => ({ expected: c, got: parseIntent(c.input) }))
  .filter(({ expected, got }) => !matches(expected, got));
console.log(`Intent eval: ${cases.length - failures.length}/${cases.length}`);
for (const failure of failures) console.error(JSON.stringify(failure, null, 2));
if (failures.length) process.exit(1);
console.log("PASS — all regression cases passed");
