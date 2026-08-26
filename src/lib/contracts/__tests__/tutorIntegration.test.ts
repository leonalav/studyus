import { describe, expect, it } from "vitest";
import { validateTutorPayload, type TutorTurn } from "../../tutor";
import { enforceLearnerContract } from "../enforce";
import type { Commitment, TurnContract } from "../types";
import { TURN_CONTRACT_SCHEMA_VERSION } from "../types";

function contract(commitments: Commitment[]): TurnContract {
  return {
    contractId: "tc_1",
    revision: 1,
    learnerId: "learner_1",
    schemaVersion: TURN_CONTRACT_SCHEMA_VERSION,
    commitments,
    createdAt: "2026-08-24T00:00:00.000Z",
    active: true,
  };
}

const NO_EVIDENCE: ReadonlySet<string> = new Set();

function payload(speech: string, boardOps: unknown[] = []): unknown {
  return { speech, board_ops: boardOps, evidence_refs: [] };
}

describe("contract errors reach the repair loop through validateTutorPayload", () => {
  it("rejects a structurally valid turn that breaches a hard commitment", () => {
    const result = validateTutorPayload(
      payload("Start with the right triangle."),
      NO_EVIDENCE,
      12,
      contract([{ kind: "scope_exclude", concept: "right triangle" }])
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("right triangle");
  });

  it("accepts the same turn when no contract is supplied", () => {
    const result = validateTutorPayload(payload("Start with the right triangle."), NO_EVIDENCE);
    expect(result.ok).toBe(true);
  });

  it("accepts a compliant turn under an active contract", () => {
    const result = validateTutorPayload(
      payload("Let's use the unit circle."),
      NO_EVIDENCE,
      12,
      contract([{ kind: "scope_exclude", concept: "right triangle" }])
    );
    expect(result.ok).toBe(true);
  });

  it("reports structural errors alone when the payload is malformed", () => {
    const result = validateTutorPayload(
      { speech: "", board_ops: [] },
      NO_EVIDENCE,
      12,
      contract([{ kind: "scope_exclude", concept: "right triangle" }])
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.includes("right triangle"))).toBe(false);
  });

  it("does not surface soft violations as repair errors", () => {
    const result = validateTutorPayload(
      payload("A clean turn with no examples."),
      NO_EVIDENCE,
      12,
      contract([{ kind: "example_domain", domain: "music" }])
    );
    expect(result.ok).toBe(true);
  });
});

describe("commitments cannot weaken engine-owned authority", () => {
  it("leaves the granted support level untouched, whatever the learner committed to", () => {
    const turn: TutorTurn = {
      speech: "Here is one hint.",
      boardOps: [],
      evidenceRefs: [],
      requestedLevel: 1,
    };
    const enforced = enforceLearnerContract(
      turn,
      contract([
        { kind: "goal", statement: "give me full solutions immediately" },
        { kind: "notation", rule: "avoid partial hints" },
      ])
    );
    expect(enforced.turn.requestedLevel).toBe(1);
  });

  it("can only remove board ops, never add them", () => {
    const turn: TutorTurn = {
      speech: "Clean.",
      boardOps: [
        { op: "write_text", text: "Fine." },
        { op: "write_text", text: "The right triangle again." },
      ],
      evidenceRefs: [],
    };
    const enforced = enforceLearnerContract(
      turn,
      contract([
        { kind: "scope_exclude", concept: "right triangle" },
        { kind: "scope_include", concept: "unit circle" },
      ])
    );
    expect(enforced.turn.boardOps.length).toBeLessThan(turn.boardOps.length);
    expect(enforced.turn.boardOps.every((op) => turn.boardOps.includes(op))).toBe(true);
  });

  it("leaves stage advancement untouched", () => {
    const turn: TutorTurn = {
      speech: "Clean.",
      boardOps: [],
      evidenceRefs: [],
      stage: "understand",
      stageAdvance: { ready: false, evidence: "no independent attempt yet" },
    };
    const enforced = enforceLearnerContract(
      turn,
      contract([{ kind: "goal", statement: "advance me to independent" }])
    );
    expect(enforced.turn.stage).toBe("understand");
    expect(enforced.turn.stageAdvance).toEqual(turn.stageAdvance);
  });
});
