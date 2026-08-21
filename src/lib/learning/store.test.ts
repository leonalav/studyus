import { describe, it, expect, beforeEach } from "vitest";
import { getDb } from "../../db/database";
import {
  completeReview,
  contradictHypothesis,
  disputeHypothesis,
  getEntrySignal,
  getDueReviews,
  getEvidenceByIds,
  getHypotheses,
  getOpenReviews,
  getSkillEvidence,
  getSkillState,
  normalizeSkillId,
  recordEvidence,
  scheduleReview,
  upsertEntrySignal,
  upsertHypothesis,
} from "./store";
import type { LearningEvidenceInput } from "./types";

/**
 * The ledger is the persistence layer the rest of the engine trusts absolutely.
 * If it silently drops an event, mis-defaults a field, or lets an obligation
 * evaporate, every number downstream is wrong in a way that looks like a
 * pedagogical judgement rather than a bug.
 *
 * The review-queue tests matter most: spacing constants existed in the codebase
 * for a long time without ever executing, so these pin the execution rather
 * than the arithmetic.
 */

const DAY = 24 * 60 * 60 * 1000;
let n = 0;

function input(overrides: Partial<LearningEvidenceInput> = {}): LearningEvidenceInput {
  n += 1;
  return {
    learnerId: `learner_${n}`,
    skillIds: ["derivatives"],
    taskId: `task_${n}`,
    taskFamily: "difference_quotient",
    evidenceType: "procedure",
    response: "worked it through",
    correctness: "correct",
    supportLevel: 0,
    delayed: false,
    source: "tutor_turn",
    ...overrides,
  } as LearningEvidenceInput;
}

describe("normalizeSkillId", () => {
  it("produces a stable id from free-form text", () => {
    expect(normalizeSkillId("  Derivatives: First Principles!  ")).toBe("derivatives_first_principles");
  });

  it("never returns an empty id", () => {
    // An empty skill id would silently merge unrelated evidence into one bucket.
    expect(normalizeSkillId("   ")).toBe("unspecified");
    expect(normalizeSkillId("!!!")).toBe("unspecified");
  });
});

describe("policy-only onboarding entry signals", () => {
  it("persists a canonical familiarity without creating evidence or skill state", async () => {
    const learnerId = "entry-signal-learner";
    const sessionId = "entry-signal-session";
    await upsertEntrySignal({
      learnerId,
      sessionId,
      skillId: " Chain Rule ",
      familiarity: "shaky",
    });

    expect(await getEntrySignal(sessionId, "chain_rule", learnerId)).toBe("shaky");
    expect(await getSkillEvidence("chain_rule", learnerId)).toEqual([]);
    expect(await getSkillState("chain_rule", learnerId)).toBeUndefined();
  });
});

describe("the evidence ledger", () => {
  beforeEach(async () => {
    await getDb();
  });

  it("returns the stored event with an id so the verdict can be cited", async () => {
    const event = await recordEvidence(input());
    expect(event.evidenceId).toBeTruthy();
    const [fetched] = await getEvidenceByIds([event.evidenceId]);
    expect(fetched?.response).toBe("worked it through");
  });

  it("round-trips every field through SQLite without loss", async () => {
    const event = await recordEvidence(
      input({
        contextVariant: "changed_context",
        evidenceType: "transfer",
        rubricCriterionIds: ["c1", "c2"],
        supportLevel: 2,
        hintExposure: 3,
        responseTimeMs: 4200,
        selfRatedConfidence: 70,
        evaluatorConfidence: 55,
        delayed: true,
      })
    );
    const [fetched] = await getEvidenceByIds([event.evidenceId]);
    expect(fetched).toMatchObject({
      contextVariant: "changed_context",
      evidenceType: "transfer",
      rubricCriterionIds: ["c1", "c2"],
      supportLevel: 2,
      hintExposure: 3,
      responseTimeMs: 4200,
      selfRatedConfidence: 70,
      evaluatorConfidence: 55,
      delayed: true,
    });
  });

  it("defaults unknown hint exposure to the ceiling, not to zero", async () => {
    // Defaulting to zero would let an unreported hint mint independence, which
    // is the one number that must never be inflated by a missing field.
    const event = await recordEvidence(input({ supportLevel: 2, hintExposure: undefined }));
    expect(event.hintExposure).toBe(2);
  });

  it("keeps evidence for one skill out of another skill's ledger", async () => {
    const learnerId = "isolation_learner";
    await recordEvidence(input({ learnerId, skillIds: ["derivatives"] }));
    await recordEvidence(input({ learnerId, skillIds: ["integrals"] }));

    expect(await getSkillEvidence("derivatives", learnerId)).toHaveLength(1);
    expect(await getSkillEvidence("integrals", learnerId)).toHaveLength(1);
  });

  it("files one event under every skill it is evidence about", async () => {
    // A task that exercises a method and its prerequisite together is evidence
    // about both; forcing a single owner would discard half of it.
    const learnerId = "multi_skill_learner";
    await recordEvidence(input({ learnerId, skillIds: ["chain_rule", "derivatives"] }));
    expect(await getSkillEvidence("chain_rule", learnerId)).toHaveLength(1);
    expect(await getSkillEvidence("derivatives", learnerId)).toHaveLength(1);
  });

  it("rebuilds the skill state as a side effect of appending", async () => {
    const learnerId = "state_learner";
    await recordEvidence(input({ learnerId }));
    const state = await getSkillState("derivatives", learnerId);
    expect(state?.totalEvidenceCount).toBe(1);
    expect(state?.unaidedSuccesses).toBe(1);
  });

  it("keeps the ledger append-only: a correction adds, it does not overwrite", async () => {
    const learnerId = "append_learner";
    await recordEvidence(input({ learnerId, correctness: "incorrect" }));
    await recordEvidence(input({ learnerId, correctness: "correct" }));
    const events = await getSkillEvidence("derivatives", learnerId);
    expect(events).toHaveLength(2);
    // History is what makes a verdict auditable; overwriting it would leave the
    // state with no way to explain itself.
    expect(events.map((event) => event.correctness)).toEqual(["incorrect", "correct"]);
  });
});

describe("the review queue actually executes", () => {
  beforeEach(async () => {
    await getDb();
  });

  it("schedules an unaided reconstruction whenever support was substantive", async () => {
    const learnerId = "reconstruction_learner";
    await recordEvidence(input({ learnerId, supportLevel: 2, hintExposure: 2, taskFamily: "chain" }));

    const open = await getOpenReviews(learnerId);
    const owed = open.find((task) => task.taskFamily === "chain");
    expect(owed).toBeDefined();
    // This is what stops "correct after three hints" being filed as competence.
    expect(owed?.reconstruction).toBe(true);
    expect(owed?.requiredMode).toBe("unaided");
  });

  it("does not queue a reconstruction after an unaided success", async () => {
    const learnerId = "clean_learner";
    await recordEvidence(input({ learnerId, supportLevel: 0, hintExposure: 0, taskFamily: "clean" }));
    const open = await getOpenReviews(learnerId);
    expect(open.every((task) => task.reconstruction === false)).toBe(true);
  });

  it("surfaces overdue reviews and caps how many arrive at once", async () => {
    const learnerId = "queue_learner";
    for (let index = 0; index < 5; index += 1) {
      await scheduleReview({
        learnerId,
        skillId: `skill_${index}`,
        taskFamily: `family_${index}`,
        dueAt: new Date(Date.now() - (index + 1) * DAY),
      });
    }
    const due = await getDueReviews(learnerId, new Date(), 2);
    // A learner returning after a month must not be met with their whole queue.
    expect(due).toHaveLength(2);
  });

  it("does not surface a review before it is due", async () => {
    const learnerId = "future_learner";
    await scheduleReview({
      learnerId,
      skillId: "derivatives",
      taskFamily: "later",
      dueAt: new Date(Date.now() + 7 * DAY),
    });
    expect(await getDueReviews(learnerId)).toHaveLength(0);
  });

  it("puts an owed reconstruction ahead of a routine review", async () => {
    const learnerId = "priority_learner";
    await scheduleReview({
      learnerId,
      skillId: "derivatives",
      taskFamily: "routine",
      dueAt: new Date(Date.now() - 5 * DAY),
    });
    await scheduleReview({
      learnerId,
      skillId: "derivatives",
      taskFamily: "owed",
      dueAt: new Date(Date.now() - DAY),
      reconstruction: true,
    });
    const due = await getDueReviews(learnerId, new Date(), 2);
    expect(due[0].taskFamily).toBe("owed");
  });

  it("updates a pending review instead of stacking duplicates", async () => {
    const learnerId = "dedupe_learner";
    const first = await scheduleReview({
      learnerId,
      skillId: "derivatives",
      taskFamily: "same_family",
      dueAt: new Date(Date.now() - DAY),
    });
    const second = await scheduleReview({
      learnerId,
      skillId: "derivatives",
      taskFamily: "same_family",
      dueAt: new Date(Date.now() - 2 * DAY),
    });
    expect(second.reviewId).toBe(first.reviewId);
    expect(await getOpenReviews(learnerId)).toHaveLength(1);
  });

  it("keeps a reconstruction obligation alive across rescheduling", async () => {
    const learnerId = "sticky_learner";
    await scheduleReview({
      learnerId,
      skillId: "derivatives",
      taskFamily: "owed",
      dueAt: new Date(Date.now() - DAY),
      reconstruction: true,
    });
    // A routine review landing on the same family must not quietly cancel the
    // unaided redo that was owed.
    const rescheduled = await scheduleReview({
      learnerId,
      skillId: "derivatives",
      taskFamily: "owed",
      dueAt: new Date(Date.now() + DAY),
      reconstruction: false,
    });
    expect(rescheduled.reconstruction).toBe(true);
  });

  it("lengthens the interval on a pass and resets it on a failure", async () => {
    const learnerId = "spacing_learner";
    const task = await scheduleReview({
      learnerId,
      skillId: "derivatives",
      taskFamily: "spaced",
      dueAt: new Date(Date.now() - DAY),
    });

    const passed = await completeReview(task.reviewId, true);
    expect(passed?.intervalIndex).toBe(1);
    expect(passed?.state).toBe("scheduled");

    const failed = await completeReview(task.reviewId, false);
    expect(failed?.intervalIndex).toBe(0);
    // Lapsed, not merely re-queued: re-asking a question the learner just
    // failed is nagging, so the planner has to route into repair instead.
    expect(failed?.state).toBe("lapsed");
  });

  it("discharges a reconstruction only when it is passed", async () => {
    const learnerId = "discharge_learner";
    const task = await scheduleReview({
      learnerId,
      skillId: "derivatives",
      taskFamily: "owed",
      dueAt: new Date(Date.now() - DAY),
      reconstruction: true,
    });
    expect((await completeReview(task.reviewId, false))?.reconstruction).toBe(true);
    expect((await completeReview(task.reviewId, true))?.reconstruction).toBe(false);
  });

  it("closes the loop: recording a retrieval outcome settles the open review", async () => {
    const learnerId = "loop_learner";
    await scheduleReview({
      learnerId,
      skillId: "derivatives",
      taskFamily: "retrieved",
      dueAt: new Date(Date.now() - DAY),
    });
    await recordEvidence(
      input({
        learnerId,
        taskFamily: "retrieved",
        evidenceType: "retrieval",
        correctness: "incorrect",
        delayed: true,
      })
    );
    const open = await getOpenReviews(learnerId);
    const settled = open.find((task) => task.taskFamily === "retrieved");
    expect(settled?.attemptCount).toBe(1);
    expect(settled?.state).toBe("lapsed");
  });
});

describe("hypotheses are revisable claims, not verdicts", () => {
  beforeEach(async () => {
    await getDb();
  });

  const base = {
    skillId: "derivatives",
    kind: "misconception" as const,
    statement: "Treats the derivative of a product as the product of derivatives.",
    nextBestTest: "Ask for d/dx of x * x and compare against 2x.",
  };

  it("refuses a hypothesis with no way to test it", async () => {
    // A claim about a learner that cannot be checked is a label, and labels
    // outlive the evidence that produced them.
    await expect(
      upsertHypothesis({ ...base, learnerId: "test_learner", nextBestTest: "   " })
    ).rejects.toThrow();
  });

  it("stores supporting evidence refs so the claim can be audited", async () => {
    const learnerId = "audit_learner";
    const event = await recordEvidence(input({ learnerId }));
    await upsertHypothesis({ ...base, learnerId, evidenceIds: [event.evidenceId] });

    const [stored] = await getHypotheses(learnerId, "derivatives");
    expect(stored.supportingEvidenceIds).toContain(event.evidenceId);
    expect(stored.nextBestTest).toBeTruthy();
  });

  it("lets contradicting evidence weaken a claim rather than requiring deletion", async () => {
    const learnerId = "revise_learner";
    await upsertHypothesis({ ...base, learnerId, evidenceIds: ["a", "b"] });
    const [stored] = await getHypotheses(learnerId, "derivatives");

    await contradictHypothesis(stored.hypothesisId, "counter-1");
    const [revised] = await getHypotheses(learnerId, "derivatives");
    expect(revised.contradictingEvidenceIds).toContain("counter-1");
  });

  it("promotes a suspicion to a supported claim only on a second observation", async () => {
    // One wrong answer is a data point, not a diagnosis, and a diagnosis is what
    // the planner acts on.
    const learnerId = "promotion_learner";
    const first = await upsertHypothesis({ ...base, learnerId, evidenceIds: ["ev-a"] });
    expect(first.status).toBe("suspected");

    const second = await upsertHypothesis({ ...base, learnerId, evidenceIds: ["ev-b"] });
    expect(second.status).toBe("supported");
    // The same claim strengthened, not a second copy of it.
    expect(await getHypotheses(learnerId, "derivatives")).toHaveLength(1);
  });

  it("resolves a claim once it has been contradicted twice", async () => {
    const learnerId = "resolution_learner";
    const created = await upsertHypothesis({ ...base, learnerId, evidenceIds: ["a", "b"] });
    await contradictHypothesis(created.hypothesisId, "counter-1");
    await contradictHypothesis(created.hypothesisId, "counter-2");

    const [resolved] = await getHypotheses(learnerId, "derivatives");
    // Planning around a misconception the learner has since dropped means
    // teaching the learner they used to be.
    expect(resolved.status).toBe("resolved");
  });

  it("records a learner's dispute and keeps their note", async () => {
    const learnerId = "dispute_learner";
    await upsertHypothesis({ ...base, learnerId });
    const [stored] = await getHypotheses(learnerId, "derivatives");

    await disputeHypothesis(stored.hypothesisId, "I misread the question.");
    const [disputed] = await getHypotheses(learnerId, "derivatives");
    expect(disputed.learnerDisputed).toBe(true);
    expect(disputed.disputeNote).toBe("I misread the question.");
  });
});
