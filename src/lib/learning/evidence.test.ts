import { describe, it, expect } from "vitest";
import {
  computeSkillEvidence,
  deriveSkillState,
  findOutstandingReconstruction,
  isSubstantiveSupport,
  toMasteryEvidence,
} from "./evidence";
import type { ContextVariant, EvidenceType, LearningEvidenceEvent, SupportLevel } from "./types";

/**
 * The evidence engine is the load-bearing claim of the whole refactor: that a
 * mastery number can be computed from what a learner actually did rather than
 * asserted by a model that has just spent ten turns being encouraging.
 *
 * These tests are therefore mostly about what must NOT count. It is easy to
 * write a scorer that rises with activity; the hard part, and the part that
 * decides whether the reported number means anything, is that help, repetition,
 * and enthusiasm must not move it.
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
    taskFamily: "difference_quotient",
    contextVariant: "same" as ContextVariant,
    evidenceType: "procedure" as EvidenceType,
    response: "worked it through",
    correctness: "correct",
    rubricCriterionIds: [],
    supportLevel: 0 as SupportLevel,
    hintExposure: 0,
    delayed: false,
    source: "tutor_turn",
    timestamp: new Date(Date.now() - DAY).toISOString(),
    ...overrides,
  };
}

describe("computeSkillEvidence — what may and may not raise a score", () => {
  it("reports zero across the board when nothing has been observed", () => {
    const computed = computeSkillEvidence([]);
    expect(computed).toMatchObject({
      recall: 0,
      understanding: 0,
      procedure: 0,
      transfer: 0,
      independence: 0,
      eventCount: 0,
    });
  });

  it("credits an unaided success more than the same success with a worked step", () => {
    const unaided = computeSkillEvidence([ev({ supportLevel: 0 })]);
    const helped = computeSkillEvidence([ev({ supportLevel: 3, hintExposure: 3 })]);
    expect(unaided.procedure).toBeGreaterThan(helped.procedure);
    // Support does not zero the credit -- doing it with help is still doing it.
    expect(helped.procedure).toBeGreaterThan(0);
  });

  it("never grants independence for a success that needed help", () => {
    // This is the single most important line in the file. If correct-after-hint
    // raised independence, every hint the tutor gave would quietly inflate the
    // one dimension that is supposed to answer 'can they do it alone?'.
    const helped = computeSkillEvidence([
      ev({ supportLevel: 2, hintExposure: 2 }),
      ev({ supportLevel: 3, hintExposure: 3, taskFamily: "chain_rule" }),
      ev({ supportLevel: 2, hintExposure: 2, taskFamily: "product_rule" }),
    ]);
    expect(helped.independence).toBe(0);
  });

  it("does not treat repetition of one task family as breadth", () => {
    const sameFamily = computeSkillEvidence([
      ev({ taskFamily: "f" }),
      ev({ taskFamily: "f" }),
      ev({ taskFamily: "f" }),
    ]);
    const spread = computeSkillEvidence([
      ev({ taskFamily: "a" }),
      ev({ taskFamily: "b" }),
      ev({ taskFamily: "c" }),
    ]);
    expect(spread.independence).toBeGreaterThan(sameFamily.independence);
  });

  it("gives no transfer credit for succeeding on the identical task again", () => {
    const same = computeSkillEvidence([
      ev({ evidenceType: "transfer", contextVariant: "same" }),
    ]);
    expect(same.transfer).toBe(0);

    const changed = computeSkillEvidence([
      ev({ evidenceType: "transfer", contextVariant: "changed_context" }),
    ]);
    expect(changed.transfer).toBeGreaterThan(0);
  });

  it("weights a delayed retrieval far above an in-lesson one for recall", () => {
    const immediate = computeSkillEvidence([ev({ evidenceType: "retrieval", delayed: false })]);
    const delayed = computeSkillEvidence([ev({ evidenceType: "retrieval", delayed: true })]);
    // Remembering something you were told minutes ago is not remembering.
    expect(delayed.recall).toBeGreaterThan(immediate.recall);
  });

  it("decays old evidence relative to fresh evidence", () => {
    const fresh = computeSkillEvidence([ev({ timestamp: new Date(Date.now() - DAY).toISOString() })]);
    const stale = computeSkillEvidence([ev({ timestamp: new Date(Date.now() - 200 * DAY).toISOString() })]);
    expect(fresh.procedure).toBeGreaterThan(stale.procedure);
  });

  it("lets failures pull a dimension back down", () => {
    const successOnly = computeSkillEvidence([ev(), ev({ taskFamily: "b" })]);
    const mixed = computeSkillEvidence([
      ev(),
      ev({ taskFamily: "b" }),
      ev({ taskFamily: "c", correctness: "incorrect" }),
      ev({ taskFamily: "d", correctness: "incorrect" }),
    ]);
    expect(mixed.procedure).toBeLessThan(successOnly.procedure);
  });

  it("discounts evidence the grader was unsure about", () => {
    const certain = computeSkillEvidence([ev({ evaluatorConfidence: 100 })]);
    const unsure = computeSkillEvidence([ev({ evaluatorConfidence: 40 })]);
    expect(unsure.procedure).toBeLessThan(certain.procedure);
  });

  it("keeps every dimension inside 0-100 under a flood of successes", () => {
    const many = Array.from({ length: 80 }, (_, index) =>
      ev({ taskFamily: `family_${index}`, evidenceType: "transfer", contextVariant: "changed_context" })
    );
    const computed = computeSkillEvidence(many);
    for (const dimension of ["recall", "understanding", "procedure", "transfer", "independence"] as const) {
      expect(computed[dimension]).toBeGreaterThanOrEqual(0);
      expect(computed[dimension]).toBeLessThanOrEqual(100);
    }
  });

  it("carries the evidence ids that produced the numbers", () => {
    const computed = computeSkillEvidence([ev({ evidenceId: "x1" }), ev({ evidenceId: "x2" })]);
    expect(computed.evidenceIds).toEqual(["x1", "x2"]);
    expect(computed.eventCount).toBe(2);
  });
});

describe("isSubstantiveSupport", () => {
  it("treats structural help as substantive, orientation as not", () => {
    expect(isSubstantiveSupport(ev({ supportLevel: 0 }))).toBe(false);
    expect(isSubstantiveSupport(ev({ supportLevel: 1 }))).toBe(false);
    // Naming the method is already enough to make the next success uninformative.
    expect(isSubstantiveSupport(ev({ supportLevel: 2 }))).toBe(true);
    expect(isSubstantiveSupport(ev({ supportLevel: 3 }))).toBe(true);
  });

  it("counts hints the learner opened even under a low ceiling", () => {
    expect(isSubstantiveSupport(ev({ supportLevel: 0, hintExposure: 2 }))).toBe(true);
  });
});

describe("findOutstandingReconstruction", () => {
  it("opens a debt when a success required substantive support", () => {
    expect(findOutstandingReconstruction([ev({ taskFamily: "chain", supportLevel: 2 })])).toBe("chain");
  });

  it("stays clear when the success was unaided", () => {
    expect(findOutstandingReconstruction([ev({ taskFamily: "chain", supportLevel: 0 })])).toBeUndefined();
  });

  it("closes the debt only with an unaided success in the same family", () => {
    const helped = ev({ taskFamily: "chain", supportLevel: 2 });
    const elsewhere = ev({ taskFamily: "product", supportLevel: 0 });
    // Succeeding at something else does not discharge this debt.
    expect(findOutstandingReconstruction([helped, elsewhere])).toBe("chain");

    const redone = ev({ taskFamily: "chain", supportLevel: 0, hintExposure: 0 });
    expect(findOutstandingReconstruction([helped, elsewhere, redone])).toBeUndefined();
  });

  it("does not let another helped attempt discharge the debt", () => {
    const helped = ev({ taskFamily: "chain", supportLevel: 2 });
    const helpedAgain = ev({ taskFamily: "chain", supportLevel: 2 });
    expect(findOutstandingReconstruction([helped, helpedAgain])).toBe("chain");
  });
});

describe("deriveSkillState", () => {
  it("is deterministic: the same ledger always rebuilds the same state", () => {
    const events = [ev({ taskFamily: "a" }), ev({ taskFamily: "b" }), ev({ taskFamily: "c" })];
    const now = Date.now();
    const first = deriveSkillState("L", "derivatives", events, undefined, now);
    const second = deriveSkillState("L", "derivatives", [...events].reverse(), undefined, now);
    // Order-independence is what lets a disputed event be removed and the state
    // simply recomputed rather than patched.
    expect(second).toEqual(first);
  });

  it("separates unaided from supported successes in the counts", () => {
    const state = deriveSkillState("L", "derivatives", [
      ev({ taskFamily: "a", supportLevel: 0 }),
      ev({ taskFamily: "b", supportLevel: 2 }),
      ev({ taskFamily: "c", supportLevel: 3 }),
    ]);
    expect(state.unaidedSuccesses).toBe(1);
    expect(state.supportedSuccesses).toBe(2);
    expect(state.totalEvidenceCount).toBe(3);
  });

  it("counts only delayed retrievals toward retention", () => {
    const state = deriveSkillState("L", "derivatives", [
      ev({ evidenceType: "retrieval", delayed: false }),
      ev({ evidenceType: "retrieval", delayed: true, taskFamily: "b" }),
    ]);
    expect(state.successfulRetrievals).toBe(1);
  });

  it("regresses after repeated unaided failure rather than holding the stage", () => {
    const climbing = [
      ev({ evidenceType: "prediction", taskFamily: "a" }),
      ev({ evidenceType: "observation", taskFamily: "a" }),
      ev({ evidenceType: "explanation", taskFamily: "b", response: "x".repeat(60), contextVariant: "changed_representation" }),
    ];
    const reached = deriveSkillState("L", "derivatives", climbing);

    const withFailures = deriveSkillState("L", "derivatives", [
      ...climbing,
      ev({ taskFamily: "c", correctness: "incorrect", supportLevel: 0 }),
      ev({ taskFamily: "d", correctness: "incorrect", supportLevel: 0 }),
    ]);
    const order = ["encounter", "understand", "construct", "apply", "transfer", "master"];
    // Noticing a slip must never be harder than granting a promotion, so this
    // is a strict drop: holding the stage would pass a `<=` check vacuously.
    expect(reached.stage).toBe("construct");
    expect(order.indexOf(withFailures.stage)).toBeLessThan(order.indexOf(reached.stage));
  });

  it("records an owed reconstruction on the state", () => {
    const state = deriveSkillState("L", "derivatives", [ev({ taskFamily: "chain", supportLevel: 2 })]);
    expect(state.reconstructionDueTaskFamily).toBe("chain");
  });
});

describe("toMasteryEvidence", () => {
  it("projects exactly the five reportable dimensions", () => {
    const state = deriveSkillState("L", "derivatives", [ev()]);
    expect(Object.keys(toMasteryEvidence(state)).sort()).toEqual(
      ["independence", "procedure", "recall", "transfer", "understanding"]
    );
  });
});
