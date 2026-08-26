import { describe, expect, it } from "vitest";
import {
  detectContractViolations,
  enforceLearnerContract,
  forbiddenNotationToken,
} from "../enforce";
import type { Commitment, TurnContract } from "../types";
import { TURN_CONTRACT_SCHEMA_VERSION } from "../types";
import type { BoardOp, TutorTurn } from "../../tutor";

function contract(commitments: Commitment[], overrides: Partial<TurnContract> = {}): TurnContract {
  return {
    contractId: "tc_1",
    revision: 1,
    learnerId: "learner_1",
    schemaVersion: TURN_CONTRACT_SCHEMA_VERSION,
    commitments,
    createdAt: "2026-08-24T00:00:00.000Z",
    active: true,
    ...overrides,
  };
}

function turn(speech: string, boardOps: BoardOp[] = []): TutorTurn {
  return { speech, boardOps, evidenceRefs: [] };
}

describe("scope_exclude", () => {
  it("flags an excluded concept in speech", () => {
    const violations = detectContractViolations(
      turn("Let's start from the right triangle definition."),
      contract([{ kind: "scope_exclude", concept: "right triangle" }])
    );
    expect(violations).toHaveLength(1);
    expect(violations[0].severity).toBe("hard");
    expect(violations[0].location).toBe("speech");
  });

  it("flags an excluded concept nested in a spawned thread block", () => {
    const violations = detectContractViolations(
      turn("Here is a side thread.", [
        {
          op: "spawn_thread",
          title: "Detour",
          reason: "prerequisite",
          initialBlocks: [{ kind: "text", text: "Recall the right triangle ratios." }],
        },
      ]),
      contract([{ kind: "scope_exclude", concept: "right triangle" }])
    );
    expect(violations).toHaveLength(1);
    expect(violations[0].boardOpIndex).toBe(0);
  });

  it("flags an excluded concept inside widget content", () => {
    const violations = detectContractViolations(
      turn("Try this.", [
        {
          op: "place_widget",
          intent: {
            kind: "question",
            prompt: "Which right triangle side is opposite the angle?",
            answerKind: "short_text",
          } as never,
        },
      ]),
      contract([{ kind: "scope_exclude", concept: "right triangle" }])
    );
    expect(violations).toHaveLength(1);
  });

  it("flags an excluded concept in emitted LaTeX", () => {
    const violations = detectContractViolations(
      turn("Consider this.", [{ op: "write_latex", tex: "\\text{right triangle } a^2+b^2=c^2" }]),
      contract([{ kind: "scope_exclude", concept: "right triangle" }])
    );
    expect(violations).toHaveLength(1);
  });

  it("does not fire on a longer word containing the concept", () => {
    const violations = detectContractViolations(
      turn("The arccosine is the inverse."),
      contract([{ kind: "scope_exclude", concept: "cosine" }])
    );
    expect(violations).toEqual([]);
  });

  it("tolerates simple plurals", () => {
    const violations = detectContractViolations(
      turn("Compare the two triangles."),
      contract([{ kind: "scope_exclude", concept: "triangle" }])
    );
    expect(violations).toHaveLength(1);
  });

  it("ignores an inactive contract", () => {
    const violations = detectContractViolations(
      turn("Use a right triangle."),
      contract([{ kind: "scope_exclude", concept: "right triangle" }], {
        active: false,
        revokedAt: "2026-08-24T01:00:00.000Z",
      })
    );
    expect(violations).toEqual([]);
  });
});

describe("representation", () => {
  it("flags a geometry intent when geometry was to be avoided", () => {
    const violations = detectContractViolations(
      turn("Look at this.", [
        {
          op: "visualize",
          intent: { type: "geometry", objects: [{ kind: "point", id: "A", at: [0, 0] }] },
        },
      ]),
      contract([{ kind: "representation", prefer: "unit circle", avoid: "right triangles" }])
    );
    expect(violations).toHaveLength(1);
    expect(violations[0].severity).toBe("hard");
  });

  it("does not flag intents that cannot express displayMode", () => {
    const violations = detectContractViolations(
      turn("Here's a chart.", [
        {
          op: "visualize",
          intent: {
            type: "chart",
            chartKind: "bar",
            series: [{ id: "s", points: [{ x: 1, y: 2 }] }],
          } as never,
        },
      ]),
      contract([{ kind: "representation", prefer: "graphless diagrams" }])
    );
    expect(violations).toEqual([]);
  });

  it("flags graph displayMode when graphless was requested", () => {
    const violations = detectContractViolations(
      turn("Here.", [
        {
          op: "visualize",
          intent: { type: "geometry", displayMode: "graph", objects: [] },
        },
      ]),
      contract([{ kind: "representation", prefer: "graphless figures" }])
    );
    expect(violations).toHaveLength(1);
  });

  it("does not flag a preference with no avoid clause on an unrelated intent", () => {
    const violations = detectContractViolations(
      turn("Here.", [
        { op: "visualize", intent: { type: "geometry", objects: [] } },
      ]),
      contract([{ kind: "representation", prefer: "visual explanations" }])
    );
    expect(violations).toEqual([]);
  });
});

describe("notation", () => {
  it("parses machine-checkable rules", () => {
    expect(forbiddenNotationToken("use sin^{-1} not arcsin")).toBe("arcsin");
    expect(forbiddenNotationToken("prefer dy/dx over y'")).toBe("y'");
    expect(forbiddenNotationToken("avoid tan")).toBe("tan");
  });

  it("returns null for unparseable rules", () => {
    expect(forbiddenNotationToken("be consistent with notation")).toBeNull();
  });

  it("flags forbidden notation in LaTeX only", () => {
    const rule: Commitment = { kind: "notation", rule: "use sin^{-1} not arcsin" };
    const withLatex = detectContractViolations(
      turn("Fine.", [{ op: "write_latex", tex: "\\arcsin(x)" }]),
      contract([rule])
    );
    expect(withLatex).toHaveLength(1);

    const speechOnly = detectContractViolations(turn("We say arcsin here."), contract([rule]));
    expect(speechOnly).toEqual([]);
  });

  it("does not enforce an unparseable notation rule", () => {
    const violations = detectContractViolations(
      turn("Here.", [{ op: "write_latex", tex: "\\arcsin(x)" }]),
      contract([{ kind: "notation", rule: "keep notation tidy" }])
    );
    expect(violations).toEqual([]);
  });
});

describe("soft and unobservable commitments", () => {
  it("reports example_domain mismatch as soft", () => {
    const violations = detectContractViolations(
      turn("Consider a wave on a string."),
      contract([{ kind: "example_domain", domain: "music" }])
    );
    expect(violations).toHaveLength(1);
    expect(violations[0].severity).toBe("soft");
  });

  it("never flags scope_include, pace, or goal at turn level", () => {
    const violations = detectContractViolations(
      turn("Short turn."),
      contract([
        { kind: "scope_include", concept: "unit circle" },
        { kind: "pace", sessionsPerWeek: 3, minutesPerSession: 45 },
        { kind: "goal", statement: "pass the final", deadline: "2026-12-01" },
      ])
    );
    expect(violations).toEqual([]);
  });
});

describe("enforceLearnerContract", () => {
  it("drops only the offending board op", () => {
    const result = enforceLearnerContract(
      turn("Clean speech.", [
        { op: "write_text", text: "This is fine." },
        { op: "write_text", text: "Use the right triangle." },
        { op: "write_title", text: "Also fine." },
      ]),
      contract([{ kind: "scope_exclude", concept: "right triangle" }])
    );
    expect(result.droppedBoardOpIndices).toEqual([1]);
    expect(result.turn.boardOps).toHaveLength(2);
    expect(result.unresolved).toEqual([]);
  });

  it("never rewrites speech and reports the breach as unresolved", () => {
    const result = enforceLearnerContract(
      turn("Use the right triangle."),
      contract([{ kind: "scope_exclude", concept: "right triangle" }])
    );
    expect(result.turn.speech).toBe("Use the right triangle.");
    expect(result.droppedBoardOpIndices).toEqual([]);
    expect(result.unresolved).toHaveLength(1);
  });

  it("passes a compliant turn through untouched", () => {
    const original = turn("All good.", [{ op: "write_text", text: "Unit circle it is." }]);
    const result = enforceLearnerContract(
      original,
      contract([{ kind: "scope_exclude", concept: "right triangle" }])
    );
    expect(result.turn).toBe(original);
    expect(result.unresolved).toEqual([]);
  });

  it("is a no-op when there is no contract", () => {
    const original = turn("Anything.", [{ op: "write_text", text: "right triangle" }]);
    const result = enforceLearnerContract(original, undefined);
    expect(result.turn).toBe(original);
  });

  it("does not drop ops for soft violations", () => {
    const original = turn("A wave on a string.", [{ op: "write_text", text: "physics example" }]);
    const result = enforceLearnerContract(
      original,
      contract([{ kind: "example_domain", domain: "music" }])
    );
    expect(result.droppedBoardOpIndices).toEqual([]);
    expect(result.turn.boardOps).toHaveLength(1);
    expect(result.unresolved).toHaveLength(1);
  });
});
