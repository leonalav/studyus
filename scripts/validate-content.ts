/**
 * §15.1 `content validate <pack>` — runs the whole §11 chain over every
 * template × a sample of bindings and prints a table of accept/reject counts
 * per filter. The web analog of the CLI command: `npm run validate:content`.
 *
 * Every rejection names its filter. Published numbers belong in BUILD_LOG.md.
 */

import { STUDYUS_PYTHON_PACK } from "../src/pack/studyus-python";
import { validatePack, paramSpaceSize } from "../src/core/template";
import { validateTemplate } from "../src/core/generate";
import { seededRng } from "../src/core/rng";

const samples = Number(process.argv[2] ?? 50);
const seed = Number(process.argv[3] ?? 3);
const pack = STUDYUS_PYTHON_PACK;

console.log(`pack: ${pack.id} v${pack.version} (${pack.language}, min ${pack.minPython})`);
console.log(`license: ${pack.license}`);
console.log(`attribution: ${pack.attribution}`);
console.log("");

const errors = validatePack(pack);
if (errors.length > 0) {
  console.log("PACK VALIDATION ERRORS:");
  for (const e of errors) console.log(`  ✗ ${e}`);
  process.exit(1);
}
console.log(`pack validation: 0 errors — ${pack.skills.length} skills, ${pack.templates.length} templates`);
console.log("");

console.log(`template                              space   accepted/${samples}   rejected by filter`);
console.log("─".repeat(84));
let totalAccepted = 0;
for (const template of pack.templates) {
  const report = validateTemplate(template, seededRng(seed), samples);
  totalAccepted += report.accepted;
  const rejected = Object.entries(report.rejected)
    .map(([filter, count]) => `${filter}:${count}`)
    .join(" ");
  console.log(
    `${template.id.padEnd(36)}${String(paramSpaceSize(template)).padEnd(8)}${String(report.accepted).padStart(4)}/${samples}     ${rejected || "—"}`,
  );
}
console.log("─".repeat(84));
console.log(
  `total: ${totalAccepted}/${pack.templates.length * samples} accepted · seed ${seed} · trivial instances are rejected on purpose and never served`,
);
