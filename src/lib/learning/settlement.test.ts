import { describe, it, expect } from "vitest";
import { scheduleReview, recordEvidence, getOpenReviews, getSkillEvidence } from "./store";
import { recordMoveActivity, routeTaskFamily } from "./session";
import { planNextMove } from "./policy";
import { getLatestSessionActivity } from "./store";
import { recordWidgetEvidence } from "./bridge";
import { emptySkillState } from "./types";
import { evaluateStageExit } from "./predicates";
import { gradeAnswerableWidget } from "../widgets/validate";
import type { WidgetIntent } from "../widgets/types";

/**
 * These three defects were all invisible: nothing threw, nothing failed, and
 * the ledger filled with confident nonsense. Each test states the learner-facing
 * consequence, because that is the thing that must never come back.
 */
describe("An unmarked retrieval is not a failed retrieval", () => {
  const openReview = async (learnerId: string) => {
    await scheduleReview({
      learnerId, skillId: "chain_rule", taskFamily: "composite_derivative",
      dueAt: new Date(Date.now() - 86_400_000), intervalIndex: 3, retrievalType: "cued_recall",
    });
  };
  const retrieve = (learnerId: string, correctness: "correct" | "partial" | "incorrect" | "unknown") =>
    recordEvidence({
      learnerId, skillIds: ["chain_rule"], taskId: `t-${correctness}`,
      taskFamily: "composite_derivative", contextVariant: "changed_context",
      evidenceType: "retrieval", response: "the derivative is 2x cos(x squared)",
      correctness, supportLevel: 0, hintExposure: 0, source: "tutor_turn",
    });

  it("leaves the review open and the interval intact when the answer was never marked", async () => {
    const learnerId = "settle_unknown";
    await openReview(learnerId);
    await retrieve(learnerId, "unknown");
    const [task] = await getOpenReviews(learnerId);
    // The spoken review could not be graded, so the obligation stands - but the
    // learner is not punished for it. Before the fix this was lapsed/index 0.
    expect(task.state).toBe("scheduled");
    expect(task.intervalIndex).toBe(3);
  });

  it("advances the interval on a correct retrieval", async () => {
    const learnerId = "settle_correct";
    await openReview(learnerId);
    await retrieve(learnerId, "correct");
    const [task] = await getOpenReviews(learnerId);
    // A passed review is not deleted, it is pushed further out: index 3 -> 4,
    // and the next due date sits in the future rather than today.
    expect(task.state).toBe("scheduled");
    expect(task.intervalIndex).toBe(4);
    expect(new Date(task.dueAt).getTime()).toBeGreaterThan(Date.now());
  });

  it("treats partial recall as a pass rather than resetting to day one", async () => {
    const learnerId = "settle_partial";
    await openReview(learnerId);
    await retrieve(learnerId, "partial");
    const open = await getOpenReviews(learnerId);
    expect(open.every((t) => t.state !== "lapsed")).toBe(true);
  });

  it("still lapses a definitely incorrect retrieval", async () => {
    const learnerId = "settle_incorrect";
    await openReview(learnerId);
    await retrieve(learnerId, "incorrect");
    const [task] = await getOpenReviews(learnerId);
    expect(task.state).toBe("lapsed");
    expect(task.intervalIndex).toBe(0);
  });
});

describe("A missing answer key means ungradeable, never wrong", () => {
  it("returns undefined for a short answer with no key", () => {
    expect(gradeAnswerableWidget({ format: "short_answer" }, { responseText: "a real answer" } as never)).toBeUndefined();
    expect(gradeAnswerableWidget({ format: "short_answer", acceptedAnswers: [] }, { responseText: "a real answer" } as never)).toBeUndefined();
  });

  it("returns undefined for multiple choice with no correct option marked", () => {
    expect(gradeAnswerableWidget(
      { format: "multiple_choice", options: [{ id: "a", label: "A" }, { id: "b", label: "B" }] as never },
      { selectedOptionId: "a" } as never
    )).toBeUndefined();
  });

  it("still grades honestly when a key exists", () => {
    expect(gradeAnswerableWidget({ format: "short_answer", acceptedAnswers: ["4"] }, { responseText: "4" } as never)).toBe(true);
    expect(gradeAnswerableWidget({ format: "short_answer", acceptedAnswers: ["4"] }, { responseText: "5" } as never)).toBe(false);
  });

  it("files a keyless answer as unknown with no asserted confidence", async () => {
    const learnerId = "grade_keyless";
    const intent = { kind: "reflection", id: "r1", prompt: "What did you learn?" } as unknown as WidgetIntent;
    await recordWidgetEvidence(intent, { submitted: true, responseText: "Composites need the chain rule." } as never,
      { learnerId, taskId: "board:r1", fallbackSkillIds: ["sk_keyless"] });
    const [event] = await getSkillEvidence("sk_keyless", learnerId);
    expect(event.correctness).toBe("unknown");
    expect(event.evaluatorConfidence).toBeUndefined();
  });
});

describe("Distinct problems are distinct task families", () => {
  it("lets a learner who solves items unaided actually clear the Apply gate", async () => {
    const learnerId = "families_apply";
    const sessionId = "families-session";
    const state = { ...emptySkillState(learnerId, "chain_rule"), stage: "apply" as const };

    for (let turn = 1; turn <= 3; turn++) {
      const move = planNextMove({ state, events: [] });
      await recordMoveActivity({ learnerId, sessionId, skillId: "chain_rule", move, turnOrdinal: turn });
      const contract = await getLatestSessionActivity(sessionId);
      const intent = {
        kind: "question", id: `q${turn}`, prompt: `Problem ${turn}`,
        format: "short_answer", acceptedAnswers: ["a"],
      } as unknown as WidgetIntent;
      await recordWidgetEvidence(intent, { submitted: true, responseText: "a" } as never,
        { learnerId, sessionId, contract, taskId: `board:blk-${turn}` });
    }

    const events = await getSkillEvidence("chain_rule", learnerId);
    expect(new Set(events.map((e) => e.taskFamily)).size).toBe(3);
    // Before the fix this read "have 0" no matter how many problems were solved.
    expect(evaluateStageExit("apply", events).satisfied).toBe(true);
  });

  it("keeps an obligation's family verbatim so a due review can still be settled", async () => {
    const learnerId = "families_review";
    const sessionId = "families-review-session";
    await scheduleReview({
      learnerId, skillId: "kepler", taskFamily: "orbital_period",
      dueAt: new Date(Date.now() - 86_400_000), intervalIndex: 2, retrievalType: "free_recall",
    });
    const move = planNextMove({
      state: emptySkillState(learnerId, "kepler"),
      events: [],
      dueReviews: await getOpenReviews(learnerId),
    });
    const contract = await recordMoveActivity({ learnerId, sessionId, skillId: "kepler", move, turnOrdinal: 7 });
    // No "#7" suffix: the family names a debt, and the debt is matched exactly.
    expect(contract?.taskFamily).toBe("orbital_period");
  });

  it("scopes a route-derived family to its turn", () => {
    expect(routeTaskFamily("chain_rule", "independent_practice", 4)).toBe("chain_rule:independent_practice#4");
    expect(routeTaskFamily("chain_rule", "independent_practice", 5))
      .not.toBe(routeTaskFamily("chain_rule", "independent_practice", 4));
  });
});
