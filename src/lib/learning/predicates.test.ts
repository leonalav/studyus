import { describe, it, expect } from "vitest";
import {
  evaluateAllStages,
  evaluateStageExit,
  formatStageGateStatus,
  MIN_EXPLANATION_CHARS,
  resolveStageFromEvidence,
} from "./predicates";
import type { LearningEvidenceEvent } from "./types";

/**
 * Stage exit predicates replace the old check, which was: did the model write a
 * non-empty sentence justifying advancement? That check could never fail, which
 * made the six-stage ladder decorative.
 *
 * Each test below therefore pairs a satisfying ledger with a near-miss that a
 * generous reader would wave through — an explanation that is really a
 * restatement, breadth that is really repetition, a retrieval that is really a
 * recap. The near-misses are the point.
 */

const DAY = 24 * 60 * 60 * 1000;
let seq = 0;

function ev(overrides: Partial<LearningEvidenceEvent> = {}): LearningEvidenceEvent {
  seq += 1;
  return {
    evidenceId: `e${seq}`,
    learnerId: "L",
    skillIds: ["derivatives"],
    taskId: `t${seq}`,
    taskFamily: "family_a",
    contextVariant: "same",
    evidenceType: "procedure",
    response: "response",
    correctness: "correct",
    rubricCriterionIds: [],
    supportLevel: 0,
    hintExposure: 0,
    delayed: false,
    source: "tutor_turn",
    timestamp: new Date(Date.now() - DAY).toISOString(),
    ...overrides,
  };
}

const longExplanation = "A derivative is how fast the output moves when the input nudges, not just a formula.";

describe("evaluateStageExit — encounter", () => {
  it("is not satisfied by an empty ledger", () => {
    const verdict = evaluateStageExit("encounter", []);
    expect(verdict.satisfied).toBe(false);
    expect(verdict.missing.length).toBeGreaterThan(0);
  });

  it("requires a prediction, not merely having watched something", () => {
    const watchedOnly = evaluateStageExit("encounter", [ev({ evidenceType: "observation" })]);
    expect(watchedOnly.satisfied).toBe(false);

    const predicted = evaluateStageExit("encounter", [
      ev({ evidenceType: "prediction" }),
      ev({ evidenceType: "observation" }),
    ]);
    expect(predicted.satisfied).toBe(true);
    expect(predicted.satisfiedByEvidenceIds.length).toBeGreaterThan(0);
  });
});

describe("evaluateStageExit — understand", () => {
  // A discrimination: the same idea met in a different representation and told
  // apart correctly. Grinding the same procedure again does not qualify.
  const changedRep = ev({ evidenceType: "selection", contextVariant: "changed_representation" });

  it("rejects a one-word explanation as understanding", () => {
    const thin = evaluateStageExit("understand", [
      ev({ evidenceType: "explanation", response: "yes" }),
      changedRep,
    ]);
    expect(thin.satisfied).toBe(false);
    expect(thin.missing.join(" ")).toMatch(/own words/);
  });

  it("accepts an explanation in the learner's own words plus a changed representation", () => {
    expect(longExplanation.length).toBeGreaterThanOrEqual(MIN_EXPLANATION_CHARS);
    const verdict = evaluateStageExit("understand", [
      ev({ evidenceType: "explanation", response: longExplanation }),
      changedRep,
    ]);
    expect(verdict.satisfied).toBe(true);
  });

  it("does not accept the explanation alone, without a representation change", () => {
    // Explaining the version you were taught is compatible with having memorized
    // it. The representation change is what distinguishes the two.
    const verdict = evaluateStageExit("understand", [
      ev({ evidenceType: "explanation", response: longExplanation }),
      ev({ evidenceType: "selection", contextVariant: "same" }),
    ]);
    expect(verdict.satisfied).toBe(false);
    expect(verdict.missing.join(" ")).toMatch(/contrast pair/);
  });
});

describe("evaluateStageExit — construct", () => {
  it("counts distinct task families, not repeated attempts at one", () => {
    const repeated = evaluateStageExit("construct", [
      ev({ evidenceType: "construction", taskFamily: "same" }),
      ev({ evidenceType: "construction", taskFamily: "same" }),
      ev({ evidenceType: "construction", taskFamily: "same" }),
    ]);
    expect(repeated.satisfied).toBe(false);

    const varied = evaluateStageExit("construct", [
      ev({ evidenceType: "construction", taskFamily: "a" }),
      ev({ evidenceType: "construction", taskFamily: "b" }),
    ]);
    expect(varied.satisfied).toBe(true);
  });
});

describe("evaluateStageExit — apply", () => {
  const three = (overrides: Partial<LearningEvidenceEvent>) => [
    ev({ taskFamily: "a", ...overrides }),
    ev({ taskFamily: "b", ...overrides }),
    ev({ taskFamily: "c", ...overrides }),
  ];

  it("is satisfied by three independent successes across families", () => {
    expect(evaluateStageExit("apply", three({ supportLevel: 0 })).satisfied).toBe(true);
  });

  it("is not satisfied when those successes needed help", () => {
    // Apply means unaided. Three supported successes are three open questions.
    expect(evaluateStageExit("apply", three({ supportLevel: 2, hintExposure: 2 })).satisfied).toBe(false);
  });

  it("does not accept partial credit as success at this stage", () => {
    expect(evaluateStageExit("apply", three({ correctness: "partial" })).satisfied).toBe(false);
  });
});

describe("evaluateStageExit — transfer", () => {
  it("requires a genuinely changed context, not new numbers in the same problem", () => {
    const numbersOnly = evaluateStageExit("transfer", [
      ev({ evidenceType: "transfer", contextVariant: "changed_numbers" }),
      ev({ evidenceType: "explanation", response: longExplanation }),
    ]);
    expect(numbersOnly.satisfied).toBe(false);

    const realTransfer = evaluateStageExit("transfer", [
      ev({ evidenceType: "transfer", contextVariant: "changed_context" }),
      ev({ evidenceType: "explanation", response: longExplanation, contextVariant: "changed_context" }),
    ]);
    expect(realTransfer.satisfied).toBe(true);
  });

  it("rejects transfer that leaned on a worked step", () => {
    const propped = evaluateStageExit("transfer", [
      ev({ evidenceType: "transfer", contextVariant: "changed_context", supportLevel: 3, hintExposure: 3 }),
      ev({ evidenceType: "explanation", response: longExplanation, contextVariant: "changed_context" }),
    ]);
    expect(propped.satisfied).toBe(false);
  });
});

describe("evaluateStageExit — master", () => {
  const transferEvidence = ev({
    evidenceType: "transfer",
    contextVariant: "changed_context",
    supportLevel: 0,
  });

  it("refuses mastery without a delayed retrieval", () => {
    const sameDay = evaluateStageExit("master", [
      transferEvidence,
      ev({ evidenceType: "retrieval", delayed: false }),
    ]);
    // Recalling in the lesson that taught it is not retention.
    expect(sameDay.satisfied).toBe(false);
  });

  it("accepts delayed unaided retrieval alongside independent transfer", () => {
    const verdict = evaluateStageExit("master", [
      transferEvidence,
      ev({ evidenceType: "retrieval", delayed: true, supportLevel: 0, taskFamily: "b" }),
    ]);
    expect(verdict.satisfied).toBe(true);
  });

  it("refuses when the delayed retrieval needed help", () => {
    const verdict = evaluateStageExit("master", [
      transferEvidence,
      ev({ evidenceType: "retrieval", delayed: true, supportLevel: 2, hintExposure: 2, taskFamily: "b" }),
    ]);
    expect(verdict.satisfied).toBe(false);
  });
});

describe("resolveStageFromEvidence", () => {
  it("leaves a learner at encounter when nothing has been recorded", () => {
    expect(resolveStageFromEvidence("encounter", []).stage).toBe("encounter");
  });

  it("reports what is blocking rather than only that it is blocked", () => {
    const resolved = resolveStageFromEvidence("encounter", []);
    expect(resolved.blockedBy.length).toBeGreaterThan(0);
    expect(resolved.blockedBy.join(" ")).toMatch(/\w{4,}/);
  });

  it("walks forward through every gate the ledger actually supports", () => {
    const resolved = resolveStageFromEvidence("encounter", [
      ev({ evidenceType: "prediction" }),
      ev({ evidenceType: "observation" }),
      ev({ evidenceType: "explanation", response: longExplanation, contextVariant: "changed_representation" }),
    ]);
    expect(resolved.stage).not.toBe("encounter");
    expect(resolved.advancedBy.length).toBeGreaterThan(0);
  });

  it("never advances on assertion alone — a ledger of chatter moves nothing", () => {
    // The old gate was 'model supplied a non-empty rationale', which is exactly
    // this ledger: plenty of turns, no evidence.
    const chatter = Array.from({ length: 20 }, () =>
      ev({ evidenceType: "selection", correctness: "unknown", response: "ok" })
    );
    expect(resolveStageFromEvidence("encounter", chatter).stage).toBe("encounter");
  });
});

describe("evaluateAllStages / formatStageGateStatus", () => {
  it("returns a verdict for every stage", () => {
    const all = evaluateAllStages([ev()]);
    expect(Object.keys(all).sort()).toEqual(
      ["apply", "construct", "encounter", "master", "transfer", "understand"]
    );
  });

  it("tells the model what would count instead of only refusing", () => {
    const status = formatStageGateStatus("apply", []);
    expect(status).toMatch(/NOT satisfied/);
    expect(status).toMatch(/Asserting readiness in your response does not advance the stage/);
    // The missing items must be listed, or the model can only guess and retry.
    expect(status.split("\n").length).toBeGreaterThan(2);
  });
});
