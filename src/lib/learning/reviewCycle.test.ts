import { describe, it, expect } from "vitest";
import { planNextMove, readSignals } from "./policy";
import {
  getDueReviews,
  getOpenReviews,
  getSkillState,
  recordEvidence,
  scheduleReview,
} from "./store";
import { buildSessionOpeningBrief } from "./session";
import { emptySkillState, type LearningEvidenceInput } from "./types";

/**
 * Spaced retrieval is the part of this system that is easiest to build and
 * easiest to build uselessly.
 *
 * The spacing constants existed in this codebase for a long time without ever
 * executing: intervals were computed and nothing acted on them. The failure
 * mode these tests exist to prevent is subtler than that and much harder to
 * notice in use — a review queue that surfaces reviews correctly but can never
 * SETTLE them.
 *
 * A review is closed by matching (skill, taskFamily). If the answer the learner
 * produces is filed under a different family than the one the review named, the
 * review stays open, comes due again tomorrow, and comes due again the day
 * after. The learner is asked the same question forever while every answer they
 * give lands somewhere the scheduler never looks. Nothing errors, nothing looks
 * broken, and the product quietly becomes a nag.
 */

const DAY = 24 * 60 * 60 * 1000;
let n = 0;
function learner(): string {
  n += 1;
  return `review_cycle_learner_${n}`;
}

function evidence(overrides: Partial<LearningEvidenceInput> = {}): LearningEvidenceInput {
  return {
    skillIds: ["chain_rule"],
    taskId: `task_${Math.random().toString(36).slice(2)}`,
    taskFamily: "composite_derivative",
    contextVariant: "same",
    evidenceType: "retrieval",
    response: "2x cos(x^2)",
    correctness: "correct",
    supportLevel: 0,
    hintExposure: 0,
    source: "review",
    ...overrides,
  };
}

describe("A due review can actually be closed", () => {
  it("routes the learner to the reviewed family, not a route-derived one", async () => {
    const learnerId = learner();
    const review = await scheduleReview({
      learnerId,
      skillId: "chain_rule",
      taskFamily: "composite_derivative",
      dueAt: new Date(Date.now() - DAY),
      intervalIndex: 1,
      retrievalType: "cued_recall",
    });

    const move = planNextMove({
      state: { ...emptySkillState(learnerId, "chain_rule"), stage: "apply" },
      events: [],
      dueReviews: [review],
    });

    expect(move.route).toBe("due_retrieval");
    // Without this the evidence lands under "chain_rule:due_retrieval" and the
    // review it was created to answer never sees it.
    expect(move.taskFamily).toBe("composite_derivative");
    expect(move.reviewId).toBe(review.reviewId);
  });

  it("settles the review when the retrieval succeeds and advances the interval", async () => {
    const learnerId = learner();
    const review = await scheduleReview({
      learnerId,
      skillId: "chain_rule",
      taskFamily: "composite_derivative",
      dueAt: new Date(Date.now() - DAY),
      intervalIndex: 1,
      retrievalType: "cued_recall",
    });

    await recordEvidence(evidence({ learnerId }));

    const open = await getOpenReviews(learnerId);
    const settled = open.find((task) => task.reviewId === review.reviewId);
    expect(settled?.state).toBe("scheduled");
    expect(settled?.intervalIndex).toBe(2);
    // A passed review must move out of the due window, or it re-surfaces
    // tomorrow and the spacing schedule is decorative.
    expect(new Date(settled!.dueAt).getTime()).toBeGreaterThan(Date.now());
  });

  it("resets the interval rather than dropping the skill when a retrieval fails", async () => {
    const learnerId = learner();
    const review = await scheduleReview({
      learnerId,
      skillId: "chain_rule",
      taskFamily: "composite_derivative",
      dueAt: new Date(Date.now() - DAY),
      intervalIndex: 3,
      retrievalType: "cued_recall",
    });

    await recordEvidence(evidence({ learnerId, correctness: "incorrect", response: "2 cos(x^2)" }));

    const open = await getOpenReviews(learnerId);
    const lapsed = open.find((task) => task.reviewId === review.reviewId);
    // Forgetting is normal and the schedule should absorb it. What it must not
    // do is discard the obligation, which would let a lost skill quietly leave
    // the queue.
    expect(lapsed?.state).toBe("lapsed");
    expect(lapsed?.intervalIndex).toBe(0);
  });

  it("does not let an answer in a different family close the review", async () => {
    const learnerId = learner();
    await scheduleReview({
      learnerId,
      skillId: "chain_rule",
      taskFamily: "composite_derivative",
      dueAt: new Date(Date.now() - DAY),
      intervalIndex: 1,
      retrievalType: "cued_recall",
    });

    await recordEvidence(evidence({ learnerId, taskFamily: "implicit_differentiation" }));

    // Succeeding at a neighbouring task is not the retrieval that was
    // scheduled, and crediting it would hollow out the whole schedule.
    const due = await getDueReviews(learnerId, new Date(), 5);
    expect(due.some((task) => task.taskFamily === "composite_derivative")).toBe(true);
  });

  it("surfaces at most two reviews at session start", async () => {
    const learnerId = learner();
    for (const family of ["f1", "f2", "f3", "f4"]) {
      await scheduleReview({
        learnerId,
        skillId: `skill_${family}`,
        taskFamily: family,
        dueAt: new Date(Date.now() - DAY),
        intervalIndex: 0,
        retrievalType: "cued_recall",
      });
    }

    const brief = await buildSessionOpeningBrief(learnerId);
    // Opening a session with a wall of overdue work is how a learner decides
    // not to open the session.
    expect(brief.match(/^- /gm)).toHaveLength(2);
    expect(brief).toContain("before new teaching");
  });

  it("says nothing at all when nothing is due", async () => {
    expect(await buildSessionOpeningBrief(learner())).toBe("");
  });

  it("prioritises an owed reconstruction over an ordinary retrieval", async () => {
    const learnerId = learner();
    await scheduleReview({
      learnerId,
      skillId: "skill_ordinary",
      taskFamily: "ordinary",
      dueAt: new Date(Date.now() - 5 * DAY),
      intervalIndex: 2,
      retrievalType: "cued_recall",
    });
    await scheduleReview({
      learnerId,
      skillId: "skill_owed",
      taskFamily: "owed",
      dueAt: new Date(Date.now() - DAY),
      intervalIndex: 0,
      retrievalType: "applied",
      reconstruction: true,
    });

    const due = await getDueReviews(learnerId, new Date(), 2);
    // An unaided reconstruction is an open question about whether the learner
    // can do something at all. That outranks refreshing something they have
    // already shown they can do.
    expect(due[0].taskFamily).toBe("owed");
  });
});

describe("Support creates the obligation that follows it", () => {
  it("queues an unaided reconstruction after a heavily supported success", async () => {
    const learnerId = learner();
    await recordEvidence(
      evidence({
        learnerId,
        evidenceType: "procedure",
        source: "widget",
        supportLevel: 3,
        hintExposure: 3,
      })
    );

    const open = await getOpenReviews(learnerId);
    expect(open).toHaveLength(1);
    // This is what stops "correct after three hints" from being filed as
    // competence and built upon.
    expect(open[0].reconstruction).toBe(true);
    expect(open[0].taskFamily).toBe("composite_derivative");
  });

  it("does not queue a reconstruction for work that needed no help", async () => {
    const learnerId = learner();
    await recordEvidence(evidence({ learnerId, evidenceType: "procedure", source: "widget" }));

    const open = await getOpenReviews(learnerId);
    expect(open.every((task) => task.reconstruction === false)).toBe(true);
  });

  it("holds independence back until the reconstruction is discharged", async () => {
    const learnerId = learner();
    await recordEvidence(
      evidence({
        learnerId,
        evidenceType: "procedure",
        source: "widget",
        supportLevel: 3,
        hintExposure: 3,
      })
    );

    const before = await getSkillState("chain_rule", learnerId);
    expect(before?.reconstructionDueTaskFamily).toBe("composite_derivative");

    await recordEvidence(evidence({ learnerId, evidenceType: "procedure", source: "widget" }));

    const after = await getSkillState("chain_rule", learnerId);
    // Only doing it alone clears the debt. Anything else would mean the ladder
    // could be climbed entirely on supported work.
    expect(after?.reconstructionDueTaskFamily).toBeUndefined();
    expect(after!.unaidedSuccesses).toBeGreaterThan(0);
  });

  it("plans the reconstruction as unaided practice on a changed instance", async () => {
    const learnerId = learner();
    const state = {
      ...emptySkillState(learnerId, "chain_rule"),
      stage: "construct" as const,
      reconstructionDueTaskFamily: "composite_derivative",
      supportedSuccesses: 2,
    };

    const move = planNextMove({ state, events: [] });
    expect(move.route).toBe("independent_practice");
    expect(move.supportCeiling).toBe(0);
    // Re-serving the identical item tests recall of that item, not the skill.
    expect(move.contextVariant).toBe("changed_numbers");
    expect(move.taskFamily).toBe("composite_derivative");
  });
});

describe("Signals stay honest about what happened", () => {
  it("reads a run of failures without counting the successes between them", async () => {
    const events = [
      { correctness: "incorrect" as const },
      { correctness: "correct" as const },
      { correctness: "incorrect" as const },
      { correctness: "incorrect" as const },
    ].map((partial, i) => ({
      ...evidence({ ...partial, taskId: `t${i}` }),
      evidenceId: `ev-${i}`,
      learnerId: "x",
      timestamp: new Date().toISOString(),
      rubricCriterionIds: [],
      delayed: false,
    }));

    // Consecutive means consecutive. Counting the total instead would route a
    // learner who is recovering into prerequisite repair.
    expect(readSignals(events as never).consecutiveFailures).toBe(2);
  });
});
