import { describe, it, expect } from "vitest";
import {
  isBlankResponse,
  blankEvaluation,
  buildEvaluatorSystemPrompt,
  buildEvaluatorUserPrompt,
  validateEvaluatorPayload,
  type UncertaintyState,
} from "./evaluator";
import type { RubricCriterion } from "./assessment";

const CRITERIA: RubricCriterion[] = [
  { id: "c1", description: "States F_g = GMm/r^2", max_mark: 1 },
  { id: "c2", description: "Equates to centripetal force", max_mark: 2 },
  { id: "c3", description: "Derives T^2 ∝ r^3", max_mark: 2 },
];

function validPayload(overrides: Record<string, unknown> = {}) {
  return {
    criteria: [
      { criterion_id: "c1", awarded_mark: 1, rationale: "Formula stated.", confidence: 1, uncertainty_state: "certain" },
      { criterion_id: "c2", awarded_mark: 1, rationale: "Equated partially.", confidence: 0.8, uncertainty_state: "certain" },
      { criterion_id: "c3", awarded_mark: 0, rationale: "Stopped early.", confidence: 0.9, uncertainty_state: "uncertain" },
    ],
    own_reasoning: true,
    ...overrides,
  };
}

describe("Evaluator payload validation", () => {
  it("accepts a well-formed evaluation", () => {
    const res = validateEvaluatorPayload(validPayload(), CRITERIA);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.criteria).toHaveLength(3);
      expect(res.value.own_reasoning).toBe(true);
    }
  });

  it("rejects invented or renamed criterion IDs", () => {
    const res = validateEvaluatorPayload(
      validPayload({ criteria: [{ criterion_id: "c4", awarded_mark: 1, rationale: "x", confidence: 1, uncertainty_state: "certain" }] }),
      CRITERIA
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors.join(" ")).toMatch(/c4/);
  });

  it("rejects marks above a criterion maximum", () => {
    const res = validateEvaluatorPayload(
      validPayload({ criteria: [{ criterion_id: "c2", awarded_mark: 3, rationale: "x", confidence: 1, uncertainty_state: "certain" }] }),
      CRITERIA
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors.join(" ")).toMatch(/exceeds the maximum/);
  });

  it("rejects negative marks", () => {
    const res = validateEvaluatorPayload(
      validPayload({ criteria: [{ criterion_id: "c1", awarded_mark: -1, rationale: "x", confidence: 1, uncertainty_state: "certain" }] }),
      CRITERIA
    );
    expect(res.ok).toBe(false);
  });

  it("rejects confidence outside 0..1", () => {
    const res = validateEvaluatorPayload(
      validPayload({ criteria: [{ criterion_id: "c1", awarded_mark: 1, rationale: "x", confidence: 1.4, uncertainty_state: "certain" }] }),
      CRITERIA
    );
    expect(res.ok).toBe(false);
  });

  it("surfaces omitted criteria instead of silently zeroing them", () => {
    const res = validateEvaluatorPayload(
      validPayload({ criteria: [{ criterion_id: "c1", awarded_mark: 1, rationale: "x", confidence: 1, uncertainty_state: "certain" }] }),
      CRITERIA
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors.join(" ")).toMatch(/missing an entry for criterion "c2"/);
  });

  it("rejects duplicate criterion entries", () => {
    const res = validateEvaluatorPayload(
      validPayload({ criteria: [
        { criterion_id: "c1", awarded_mark: 1, rationale: "x", confidence: 1, uncertainty_state: "certain" },
        { criterion_id: "c1", awarded_mark: 0, rationale: "y", confidence: 1, uncertainty_state: "certain" },
      ] }),
      CRITERIA
    );
    expect(res.ok).toBe(false);
  });
});

describe("Visualization-aware examiner prompt", () => {
  it("connects the shared spatial and domain interpretation guide to the examiner system prompt", () => {
    const system = buildEvaluatorSystemPrompt();
    expect(system).toContain("ASSESSMENT VISUALIZATION INTERPRETATION");
    expect(system).toContain("Circuits: nodes establish electrical junctions");
    expect(system).toContain("Graph theory: nodes, directedness, edges, weights");
  });

  it("includes the actual semantic figure specification rather than asking the examiner to infer an image", () => {
    const prompt = buildEvaluatorUserPrompt({
      stem: "Analyze the shown weighted network.",
      itemType: "proof",
      maximumMarks: 5,
      criteria: CRITERIA,
      response: "A to B has weight 4.",
      figure: {
        type: "graph_theory",
        directed: true,
        nodes: [{ id: "A" }, { id: "B" }],
        edges: [{ from: "A", to: "B", weight: 4 }],
      },
    });

    expect(prompt).toContain("AUTHORITATIVE LEARNER-VISIBLE VISUALIZATION SPECIFICATION");
    expect(prompt).toContain('"type": "graph_theory"');
    expect(prompt).toContain('"weight": 4');
    expect(prompt).toContain("JSON data only");
  });
});

describe("Blank-response handling", () => {
  it("treats whitespace and zero-width space as blank", () => {
    expect(isBlankResponse("")).toBe(true);
    expect(isBlankResponse("   ")).toBe(true);
    expect(isBlankResponse("​​")).toBe(true);
    expect(isBlankResponse("0.5")).toBe(false);
  });

  it("marks every criterion blank with full confidence, never wrong", () => {
    const marks = blankEvaluation(CRITERIA);
    expect(marks).toHaveLength(3);
    for (const m of marks) {
      expect(m.awardedMark).toBe(0);
      expect(m.confidence).toBe(1);
      expect(m.uncertaintyState).toBe("certain" as UncertaintyState);
      expect(m.rationale).toMatch(/blank/);
    }
  });
});