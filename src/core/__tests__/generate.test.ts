/**
 * §20 generation and validation tests — reproducibility, never-repeat,
 * parameter space, and every filter in the §11 chain.
 */

import { describe, expect, it } from "vitest";
import {
  drawBinding,
  drawUnseenBinding,
  generateExercise,
  templateSpaceReport,
  validateTemplate,
  validatePackTemplates,
  type SeenTable,
} from "../generate";
import { paramSpaceSize, validatePack } from "../template";
import type { Template } from "../template";
import { seededRng } from "../rng";
import { STUDYUS_PYTHON_PACK } from "../../pack/studyus-python";

const pack = STUDYUS_PYTHON_PACK;

function memorySeen(): SeenTable {
  const seen = new Map<string, number[]>();
  return {
    isSeen: (t, h) => (seen.get(t) ?? []).includes(h),
    markSeen: (t, h) => seen.set(t, [...(seen.get(t) ?? []), h]),
    seenCount: (t) => (seen.get(t) ?? []).length,
  };
}

describe("pack validation (§10.1)", () => {
  it("the shipped pack loads with zero errors", () => {
    expect(validatePack(pack)).toEqual([]);
  });

  it("prerequisite cycles are detected and named", () => {
    const broken = {
      ...pack,
      skills: pack.skills.map((s) =>
        s.id === "py.vars.assignment" ? { ...s, prerequisites: ["py.dicts.count"] } : s,
      ),
    };
    const errors = validatePack(broken);
    expect(errors.some((e) => e.includes("cycle"))).toBe(true);
  });
});

describe("10.3 never-repeat and parameter space", () => {
  it("every shipped Tier 1 template has a parameter space ≥ 200", () => {
    const report = templateSpaceReport(pack);
    for (const { template, space } of report) {
      expect(space, template).toBeGreaterThanOrEqual(200);
    }
  });

  it("500 generated exercises from one template carry zero duplicate param hashes", () => {
    const template = pack.templates.find((t) => t.id === "py.loops.for-range.accumulate.v1")!;
    const rng = seededRng(2026);
    const seen = memorySeen();
    const hashes = new Set<number>();
    for (let i = 0; i < 500; i += 1) {
      const drawn = drawUnseenBinding(template, rng, seen);
      expect(drawn, `exhausted early at ${i}`).toBeTruthy();
      expect(hashes.has(drawn!.hash)).toBe(false);
      hashes.add(drawn!.hash);
      seen.markSeen(template.id, drawn!.hash);
    }
    expect(hashes.size).toBe(500);
  });

  it("on exhaustion the generator switches templates, and reports need when all are exhausted — never re-serves", () => {
    const first = pack.templates.find((t) => t.id === "py.vars.assignment.rebind.v1")!;
    const second = pack.templates.find((t) => t.id === "py.vars.assignment.chain.v1")!;
    const seen = memorySeen();
    const exhaust = (template: typeof first) => {
      const space = paramSpaceSize(template);
      const rng = seededRng(7);
      let drawn = drawUnseenBinding(template, rng, seen);
      let count = 0;
      while (drawn) {
        seen.markSeen(template.id, drawn.hash);
        drawn = drawUnseenBinding(template, rng, seen);
        count += 1;
        if (count > space + 10) break;
      }
      expect(count).toBe(space); // exactly the space, no re-serves
    };

    exhaust(first);
    // §10.3: the generator switches to a different template for the skill
    const switched = generateExercise(pack, "py.vars.assignment", "predict", seededRng(8), seen, "none");
    expect(switched).toBeTruthy();
    expect(switched!.exercise.template).toBe(second.id);

    exhaust(second);
    // both templates exhausted → graceful null, never a re-serve
    const result = generateExercise(pack, "py.vars.assignment", "predict", seededRng(8), seen, "none");
    expect(result).toBeNull();
  });

  it("generation is byte-for-byte reproducible under a fixed seed", () => {
    const run = () => {
      const seen = memorySeen();
      const rng = seededRng(555);
      const out: string[] = [];
      for (const skill of pack.skills) {
        const result = generateExercise(pack, skill.id, "predict", rng, seen, "none");
        if (result) {
          seen.markSeen(result.exercise.template, result.exercise.paramHash);
          out.push(JSON.stringify({ p: result.exercise.params, h: result.exercise.paramHash }));
        }
      }
      return out;
    };
    expect(run()).toEqual(run());
  });
});

describe("§11 validation chain — every filter has a pass case and a reject case", () => {
  const goodTemplate = pack.templates.find((t) => t.id === "py.loops.for-range.accumulate.v1")!;

  const variant = (patch: Partial<Template>): Template => ({ ...goodTemplate, ...patch });

  it("a shipped template passes the whole chain (trivial instances are correctly rejected, not served)", () => {
    const report = validateTemplate(goodTemplate, seededRng(1), 30);
    // a handful of bindings are trivially derivable (e.g. n=2, start=1 prints
    // a literal already visible in the source) — §11 rejects those on purpose;
    // the generator simply draws another binding.
    expect(report.accepted).toBeGreaterThanOrEqual(28);
    expect(report.rejected["static-policy"] ?? 0).toBe(0);
    expect(report.rejected["determinism"] ?? 0).toBe(0);
  });

  it("filter: render rejects unresolved placeholders", () => {
    const t = variant({
      predict: { ...goodTemplate.predict, program: "{{label}} = {{missing_param}}\nprint({{label}})" },
    });
    const report = validateTemplate(t, seededRng(1), 8);
    expect(report.rejected["render"] ?? 0).toBeGreaterThan(0);
    expect(report.accepted).toBe(0);
  });

  it("filter: static policy rejects imports outside the allowlist", () => {
    const t = variant({
      predict: { ...goodTemplate.predict, program: "import os\ntotal = 1\nprint(total)" },
    });
    const report = validateTemplate(t, seededRng(1), 8);
    expect(report.rejected["static-policy"] ?? 0).toBe(8);
  });

  it("filter: static policy rejects sockets, open(), eval, and while True", () => {
    for (const snippet of [
      "import socket\nprint(1)\nprint(2)",
      "f = open('x')\nprint(1)\nprint(2)",
      "print(eval('1'))\nprint(2)\nprint(3)",
      "while True:\n    print(1)\nprint(2)",
    ]) {
      const t = variant({ predict: { ...goodTemplate.predict, program: snippet } });
      const report = validateTemplate(t, seededRng(1), 4);
      expect(report.accepted, snippet).toBe(0);
      expect(report.rejected["static-policy"] ?? 0, snippet).toBe(4);
    }
  });

  it("filter: determinism rejects a reference that varies between runs", () => {
    const t = variant({
      predict: {
        ...goodTemplate.predict,
        reference: () => ({ stdout: String(Math.random()), trace: [] }),
      },
    });
    const report = validateTemplate(t, seededRng(1), 8);
    expect(report.rejected["determinism"] ?? 0).toBeGreaterThan(0);
    expect(report.accepted).toBe(0);
  });

  it("filter: non-triviality rejects empty output", () => {
    const t = variant({
      predict: { ...goodTemplate.predict, reference: () => ({ stdout: "", trace: [] }) },
    });
    const report = validateTemplate(t, seededRng(1), 8);
    expect(report.rejected["non-triviality"] ?? 0).toBe(8);
  });

  it("filter: head-computability rejects programs over 20 lines", () => {
    const long = Array.from({ length: 24 }, (_, i) => `x${i} = ${i}`).join("\n") + "\nprint(x1)";
    const t = variant({ predict: { ...goodTemplate.predict, program: long } });
    const report = validateTemplate(t, seededRng(1), 4);
    expect(report.accepted).toBe(0);
    expect(report.rejected["head-computability"] ?? 0).toBeGreaterThan(0);
  });

  it("filter: beat coherence rejects a write beat whose reference solution flunks its own checks", () => {
    const t = variant({
      write: { ...goodTemplate.write, referenceSolution: "print('not the answer')" },
    });
    const report = validateTemplate(t, seededRng(1), 8);
    expect(report.rejected["beat-coherence"] ?? 0).toBe(8);
  });

  it("every shipped template's reference solution satisfies its own checks and ≥4 hidden tests", () => {
    for (const template of pack.templates) {
      const ok = template.write.checks.every((check) => check.test(template.write.referenceSolution));
      expect(ok, template.id).toBe(true);
      expect(template.write.hiddenTests({}).length, template.id).toBeGreaterThanOrEqual(4);
    }
  });

  it("workspace validation reports per-filter numbers for the whole pack", () => {
    const reports = validatePackTemplates(pack, seededRng(3), 24);
    const total = reports.reduce((acc, r) => acc + r.accepted, 0);
    // trivial-instance rejections excepted, everything passes the chain
    expect(total).toBeGreaterThanOrEqual(reports.length * 24 - 4);
    for (const r of reports) {
      expect(r.rejected["static-policy"] ?? 0, r.template).toBe(0);
      expect(r.rejected["determinism"] ?? 0, r.template).toBe(0);
      expect(r.rejected["beat-coherence"] ?? 0, r.template).toBe(0);
    }
    // the table BUILD_LOG quotes
    const table = reports.map((r) => `${r.template}: accepted ${r.accepted}/${r.samples}`).join("\n");
    expect(table.length).toBeGreaterThan(0);
  });

  it("drawBinding respects int ranges and choice domains", () => {
    const rng = seededRng(11);
    for (const template of pack.templates) {
      for (let i = 0; i < 50; i += 1) {
        const binding = drawBinding(template, rng);
        for (const [name, spec] of Object.entries(template.params)) {
          const value = binding[name];
          if (spec.kind === "int") {
            expect(value).toBeGreaterThanOrEqual(spec.min);
            expect(value).toBeLessThanOrEqual(spec.max);
          } else {
            expect(spec.of).toContain(value);
          }
        }
      }
    }
  });
});
