/**
 * §20 grading tests — normalization, misconception detection, static policy,
 * and honest partial grading.
 */

import { describe, expect, it } from "vitest";
import { gradeModify, gradePredict, gradeWrite, normalizeOutput } from "../grading";
import { buildExercise } from "../generate";
import { STUDYUS_PYTHON_PACK, CUSTOM_DETECTORS } from "../../pack/studyus-python";

const pack = STUDYUS_PYTHON_PACK;
const forRange = pack.templates.find((t) => t.id === "py.loops.for-range.accumulate.v1")!;
const misconceptions = pack.misconceptions.filter((m) =>
  ["range-includes-upper", "range-starts-at-one"].includes(m.id),
);

describe("12.1 Predict — normalization", () => {
  it("treats trailing newline, CRLF, and internal double-spaces as equal", () => {
    expect(normalizeOutput("6\n")).toBe("6");
    expect(normalizeOutput("6\r\n")).toBe("6");
    expect(normalizeOutput("a  b\n c")).toBe("a b\nc");
    expect(normalizeOutput("  [1,  2]\n3  ")).toBe("[1, 2]\n3");
  });

  it("treats case differences as different — case is semantic in output", () => {
    expect(normalizeOutput("Hi")).not.toBe(normalizeOutput("hi"));
    const exercise = buildExercise(pack, forRange, "predict", { n: 4, start: 0, label: "total" }, 1, "none")!;
    const judgement = gradePredict(exercise, { kind: "text", text: "SIX" }, misconceptions, CUSTOM_DETECTORS);
    // 'SIX' is not the numeric 6 — this is not a match
    expect(judgement.outcome.kind).toBe("incorrect");
  });

  it("an off-by-one prediction on a range template matches range-includes-upper", () => {
    const exercise = buildExercise(pack, forRange, "predict", { n: 4, start: 0, label: "total" }, 1, "none")!;
    // expected 6; predicting 10 means range was assumed to include n (6 + 4)
    const judgement = gradePredict(exercise, { kind: "text", text: "10" }, misconceptions, CUSTOM_DETECTORS);
    expect(judgement.outcome.kind).toBe("incorrect");
    expect(judgement.matchedMisconception).toBe("range-includes-upper");
    expect(judgement.confidence).toBe("exact");
  });
});

describe("12.3 Modify — learner input is untrusted", () => {
  it("refuses fills containing import os instead of executing them", () => {
    const exercise = buildExercise(pack, forRange, "modify", { n: 5, start: 0, label: "total" }, 2, "completion")!;
    const judgement = gradeModify(exercise, { kind: "holes", fills: ["import os", "i"] });
    expect(judgement.judgement.outcome.kind).toBe("incorrect");
    expect(judgement.judgement.detail).toMatch(/static policy/);
  });

  it("does not reveal the correct fills on failure — only which holes miss the target", () => {
    const exercise = buildExercise(pack, forRange, "modify", { n: 5, start: 0, label: "total" }, 2, "completion")!;
    const result = gradeModify(exercise, { kind: "holes", fills: ["9", "i"] });
    expect(result.judgement.outcome.kind).toBe("incorrect");
    expect(result.failingHoleIndices).toEqual([0]);
    const accepted = exercise.payload.beat === "modify" ? exercise.payload.holes[0].accept : [];
    for (const fill of accepted) expect(JSON.stringify(result)).not.toContain(JSON.stringify(fill));
  });
});

describe("12.4 Write — honest structural grading, first failure only", () => {
  const template = pack.templates.find((t) => t.id === "py.loops.for-range.accumulate.v1")!;
  const exercise = buildExercise(pack, template, "write", { n: 5, start: 0, label: "total" }, 3, "none")!;

  it("a source satisfying some but not all checks is Incorrect and reports only the first failure", () => {
    const partial = "n = int(input())\ntotal = 0\nfor i in range(1, n + 1):\n    total += i\n    print(total)";
    const result = gradeWrite(exercise, { kind: "source", source: partial, dryRun: "999" });
    expect(result.judgement.outcome.kind).toBe("incorrect");
    expect(result.judgement.confidence).toBe("heuristic");
    expect(result.checksPassed).toBeLessThan(result.checksTotal);
    expect(result.firstFailure).toBeTruthy();
    // only the FIRST unmet check is reported — never the whole list of fixes
    expect(Object.keys(result.firstFailure!)).toContain("label");
  });

  it("a fully satisfying source passes — still at heuristic confidence, never executed here", () => {
    const good = template.write.referenceSolution;
    const result = gradeWrite(exercise, { kind: "source", source: good, dryRun: "15" });
    expect(result.judgement.outcome.kind).toBe("correct");
    expect(result.judgement.confidence).toBe("heuristic");
  });

  it("source attempting a network import is blocked, not graded", () => {
    const hostile = "import socket\nprint('hi')";
    const result = gradeWrite(exercise, { kind: "source", source: hostile, dryRun: "15" });
    expect(result.judgement.outcome.kind).toBe("incorrect");
    expect(result.judgement.detail).toMatch(/static policy/);
    expect(result.firstFailure?.label).toMatch(/blocked/);
  });
});
