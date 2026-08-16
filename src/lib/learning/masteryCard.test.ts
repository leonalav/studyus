import { describe, it, expect, beforeEach } from "vitest";
import { getDb } from "../../db/database";
import { groundMasteryCard, groundMasteryCards } from "./masteryCard";
import { completeReview, recordEvidence, scheduleReview } from "./store";
import type { LearningEvidenceInput } from "./types";
import type { BoardOp } from "../tutor";
import type { MasteryCardWidget } from "../widgets/types";

/**
 * The mastery card is the only place in the product where the system states, in
 * plain sight, what it believes the learner knows. A learner reading
 * "Transfer: 88%" cannot tell a measurement from a fluent guess, so the whole
 * refactor comes down to this file being airtight: whatever the model wrote in
 * those five numbers must be unreachable from the board.
 *
 * These tests are therefore written as attacks. Each one asks: if the model
 * tried THIS, does the number the learner sees still come from the ledger?
 */

const DAY = 24 * 60 * 60 * 1000;
let n = 0;
function learner(): string {
  n += 1;
  return `card_learner_${n}`;
}

function card(overrides: Partial<MasteryCardWidget> = {}): MasteryCardWidget {
  return {
    kind: "mastery_card",
    concept: "Chain rule",
    skillId: "chain_rule",
    ...overrides,
  };
}

function evidence(overrides: Partial<LearningEvidenceInput> & { learnerId: string }) {
  return recordEvidence({
    skillIds: ["chain_rule"],
    taskId: `task_${Math.random().toString(36).slice(2)}`,
    taskFamily: "composite_derivative",
    contextVariant: "same",
    evidenceType: "procedure",
    response: "did the thing",
    correctness: "correct",
    supportLevel: 0,
    source: "widget",
    ...overrides,
  });
}

describe("groundMasteryCard — the model cannot author a mastery number", () => {
  beforeEach(async () => {
    await getDb();
  });

  it("overwrites flattering numbers the model invented for a learner with no evidence", async () => {
    const grounded = await groundMasteryCard(
      card({
        evidence: { recall: 92, understanding: 88, procedure: 95, transfer: 90, independence: 85 },
      }),
      { learnerId: learner() }
    );

    // Every dimension falls to zero, because zero observations happened.
    expect(grounded.evidence).toEqual({
      recall: 0,
      understanding: 0,
      procedure: 0,
      transfer: 0,
      independence: 0,
    });
  });

  it("says unproven rather than presenting zeros as if they were measurements", async () => {
    const grounded = await groundMasteryCard(card(), { learnerId: learner() });

    // A learner who has done nothing yet has not been measured at 0%; they have
    // not been measured. Showing bare zeros reads as a verdict of failure on a
    // skill nobody has assessed.
    expect(grounded.watch?.[0]).toMatch(/unproven, not zero/i);
  });

  it("raises the numbers only once the learner has actually done something", async () => {
    const learnerId = learner();
    await evidence({ learnerId, evidenceType: "procedure" });
    await evidence({ learnerId, evidenceType: "procedure", taskFamily: "quotient_composite" });

    const grounded = await groundMasteryCard(card({ evidence: undefined }), { learnerId });
    expect(grounded.evidence!.procedure).toBeGreaterThan(0);
  });

  it("does not credit independence to a success that needed a worked step", async () => {
    const learnerId = learner();
    for (let i = 0; i < 4; i += 1) {
      await evidence({
        learnerId,
        taskFamily: `family_${i}`,
        supportLevel: 3,
        hintExposure: 3,
      });
    }

    const grounded = await groundMasteryCard(card(), { learnerId });
    // Correct-after-hint never raises independence. Four supported successes are
    // four pieces of evidence that the learner can do it WITH help.
    expect(grounded.evidence!.independence).toBe(0);
  });

  it("names the weakest link from the computed numbers, not from the model's prose", async () => {
    const learnerId = learner();
    // Successes on a changed representation, but every one of them propped up by
    // a worked step. Transfer earns credit; independence cannot.
    for (let i = 0; i < 3; i += 1) {
      await evidence({
        learnerId,
        taskFamily: `family_${i}`,
        evidenceType: "transfer",
        contextVariant: "changed_representation",
        supportLevel: 3,
        hintExposure: 3,
      });
    }

    const grounded = await groundMasteryCard(
      card({ weakestLink: "recall" }),
      { learnerId }
    );
    // The model guessed "recall"; supported-only work makes independence the
    // honest answer, and it is the one dimension still sitting at zero.
    expect(grounded.evidence!.transfer).toBeGreaterThan(0);
    expect(grounded.weakestLink).toBe("independence");
    expect(grounded.watch).toContain("Weakest link: independence.");
  });

  it("attaches the evidence ids so a claim can be traced back to the learner's work", async () => {
    const learnerId = learner();
    const first = await evidence({ learnerId });
    const second = await evidence({ learnerId, taskFamily: "other_family" });

    const grounded = await groundMasteryCard(card(), { learnerId });
    expect(grounded.evidenceIds).toContain(first.evidenceId);
    expect(grounded.evidenceIds).toContain(second.evidenceId);
  });

  it("caps the evidence trail at a length someone would actually follow", async () => {
    const learnerId = learner();
    for (let i = 0; i < 14; i += 1) {
      await evidence({ learnerId, taskFamily: `family_${i}` });
    }
    const grounded = await groundMasteryCard(card(), { learnerId });
    expect(grounded.evidenceIds).toHaveLength(8);
  });

  it("falls back to the turn's skill when the model named none", async () => {
    const learnerId = learner();
    await evidence({ learnerId, skillIds: ["integration_by_parts"] });

    const grounded = await groundMasteryCard(
      card({ skillId: undefined, concept: "Integration by parts" }),
      { learnerId, fallbackSkillId: "integration_by_parts" }
    );

    expect(grounded.skillId).toBe("integration_by_parts");
    expect(grounded.evidence!.procedure).toBeGreaterThan(0);
  });

  it("normalizes a loosely written skill id so it reads the right ledger row", async () => {
    const learnerId = learner();
    await evidence({ learnerId, skillIds: ["chain_rule"] });

    const grounded = await groundMasteryCard(card({ skillId: "Chain Rule!" }), { learnerId });
    expect(grounded.skillId).toBe("chain_rule");
    expect(grounded.evidence!.procedure).toBeGreaterThan(0);
  });

  it("keeps the prose the agent wrote", async () => {
    const learnerId = learner();
    await evidence({ learnerId });

    const grounded = await groundMasteryCard(
      card({
        understands: ["That the outer function differentiates first"],
        canDo: ["Differentiate sin(x^2)"],
        next: "Try a triple composition",
      }),
      { learnerId }
    );

    // The division of labour: the model owns how this is said, the ledger owns
    // what is claimed.
    expect(grounded.understands).toEqual(["That the outer function differentiates first"]);
    expect(grounded.canDo).toEqual(["Differentiate sin(x^2)"]);
    expect(grounded.next).toBe("Try a triple composition");
  });
});

describe("groundMasteryCard — the honest caveats the model would not volunteer", () => {
  beforeEach(async () => {
    await getDb();
  });

  it("flags a sample too small to conclude anything from", async () => {
    const learnerId = learner();
    await evidence({ learnerId });

    const grounded = await groundMasteryCard(card(), { learnerId });
    expect(grounded.watch?.some((item) => /too little to be confident/i.test(item))).toBe(true);
  });

  it("flags an outstanding reconstruction that has not been paid", async () => {
    const learnerId = learner();
    // A success that leaned on substantive support opens a debt: the learner has
    // not yet shown they can do this alone.
    await evidence({ learnerId, supportLevel: 3, hintExposure: 3 });

    const grounded = await groundMasteryCard(card(), { learnerId });
    expect(
      grounded.watch?.some((item) => /has not yet been reconstructed unaided/i.test(item))
    ).toBe(true);
  });

  it("flags that most successes came with help", async () => {
    const learnerId = learner();
    for (let i = 0; i < 3; i += 1) {
      await evidence({ learnerId, taskFamily: `family_${i}`, supportLevel: 2, hintExposure: 2 });
    }
    await evidence({ learnerId, taskFamily: "solo", supportLevel: 0, hintExposure: 0 });

    const grounded = await groundMasteryCard(card(), { learnerId });
    expect(
      grounded.watch?.some((item) => /independence is the open question/i.test(item))
    ).toBe(true);
  });

  it("flags that retention is untested when nothing has been recalled after a delay", async () => {
    const learnerId = learner();
    for (let i = 0; i < 4; i += 1) {
      await evidence({ learnerId, taskFamily: `family_${i}` });
    }

    const grounded = await groundMasteryCard(card(), { learnerId });
    expect(grounded.watch?.some((item) => /retention is untested/i.test(item))).toBe(true);
  });

  it("stops flagging untested retention once a delayed retrieval has succeeded", async () => {
    const learnerId = learner();
    for (let i = 0; i < 4; i += 1) {
      await evidence({ learnerId, taskFamily: `family_${i}` });
    }
    await evidence({
      learnerId,
      taskFamily: "family_0",
      evidenceType: "retrieval",
      delayed: true,
    });

    const grounded = await groundMasteryCard(card(), { learnerId });
    expect(grounded.watch?.some((item) => /retention is untested/i.test(item))).toBe(false);
  });

  it("does not repeat a caveat the agent already wrote itself", async () => {
    const learnerId = learner();
    for (let i = 0; i < 3; i += 1) {
      await evidence({ learnerId, taskFamily: `family_${i}`, supportLevel: 2, hintExposure: 2 });
    }

    const grounded = await groundMasteryCard(
      card({ watch: ["Most successes here came with help; independence is the open question."] }),
      { learnerId }
    );

    const occurrences = (grounded.watch ?? []).filter((item) =>
      /independence is the open question/i.test(item)
    );
    // A card that repeats itself reads as automated, which undermines the one
    // part of the card the learner is meant to take seriously.
    expect(occurrences).toHaveLength(1);
  });

  it("bounds the watch list however much the agent and ledger have to say", async () => {
    const learnerId = learner();
    await evidence({ learnerId, supportLevel: 2, hintExposure: 2 });

    const grounded = await groundMasteryCard(
      card({ watch: Array.from({ length: 12 }, (_, i) => `Agent note ${i}`) }),
      { learnerId }
    );
    expect(grounded.watch!.length).toBeLessThanOrEqual(8);
  });
});

describe("groundMasteryCard — a promised review must actually be on the queue", () => {
  beforeEach(async () => {
    await getDb();
  });

  it("strips a review date the model invented when nothing is scheduled", async () => {
    const learnerId = learner();
    // A failed attempt schedules nothing — there is no durable success to space
    // out yet — so the model's promise has no backing at all.
    await evidence({ learnerId, correctness: "incorrect" });
    const grounded = await groundMasteryCard(card({ reviewIn: "next week" }), { learnerId });

    // "Let's revisit this next week" with nothing scheduled is worse than
    // silence, because it feels like a plan.
    expect(grounded.reviewIn).toBeUndefined();
  });

  it("advertises the review that an unaided success scheduled by itself", async () => {
    const learnerId = learner();
    // The spacing constants sat unexecuted in this codebase for a long time. An
    // unaided correct answer must now put a real dated obligation on the queue
    // with nobody having to ask for it, and the card must show that date rather
    // than a sentiment.
    await evidence({ learnerId, correctness: "correct", supportLevel: 0, hintExposure: 0 });

    const grounded = await groundMasteryCard(card({ reviewIn: "soon!" }), { learnerId });
    expect(grounded.reviewIn).toMatch(/^in 1 day — unaided retrieval$/);
  });

  it("states the real interval when a review is genuinely queued", async () => {
    const learnerId = learner();
    await scheduleReview({
      learnerId,
      skillId: "chain_rule",
      taskFamily: "composite_derivative",
      dueAt: new Date(Date.now() + 3 * DAY),
    });

    const grounded = await groundMasteryCard(card({ reviewIn: "in a fortnight" }), { learnerId });
    expect(grounded.reviewIn).toMatch(/^in 3 days/);
    expect(grounded.reviewIn).toMatch(/unaided retrieval/);
  });

  it("distinguishes an owed reconstruction from an ordinary retrieval", async () => {
    const learnerId = learner();
    await scheduleReview({
      learnerId,
      skillId: "chain_rule",
      taskFamily: "composite_derivative",
      dueAt: new Date(Date.now() + DAY),
      reconstruction: true,
    });

    const grounded = await groundMasteryCard(card(), { learnerId });
    expect(grounded.reviewIn).toMatch(/unaided reconstruction owed/);
  });

  it("reports an overdue review as due now rather than as a negative interval", async () => {
    const learnerId = learner();
    await scheduleReview({
      learnerId,
      skillId: "chain_rule",
      taskFamily: "composite_derivative",
      dueAt: new Date(Date.now() - 5 * DAY),
    });

    const grounded = await groundMasteryCard(card(), { learnerId });
    expect(grounded.reviewIn).toMatch(/^due now/);
  });

  it("ignores reviews belonging to a different skill", async () => {
    const learnerId = learner();
    await scheduleReview({
      learnerId,
      skillId: "some_other_skill",
      taskFamily: "unrelated",
      dueAt: new Date(Date.now() + DAY),
    });

    const grounded = await groundMasteryCard(card(), { learnerId });
    expect(grounded.reviewIn).toBeUndefined();
  });

  it("drops the line once the queued review has been completed", async () => {
    const learnerId = learner();
    const review = await scheduleReview({
      learnerId,
      skillId: "chain_rule",
      taskFamily: "composite_derivative",
      dueAt: new Date(Date.now() - DAY),
    });
    await completeReview(review.reviewId, true);

    const grounded = await groundMasteryCard(card(), { learnerId });
    // A passed review reschedules forward, so a date is still legitimate — what
    // must not happen is the completed instance being advertised as pending.
    if (grounded.reviewIn) expect(grounded.reviewIn).not.toMatch(/due now/);
  });
});

describe("groundMasteryCards — the board-op pass", () => {
  beforeEach(async () => {
    await getDb();
  });

  it("returns the operations untouched when the turn placed no mastery card", async () => {
    const ops: BoardOp[] = [
      { op: "write_text", text: "Some teaching" },
      { op: "place_widget", intent: { kind: "concept_card", term: "Limit", definition: "..." } },
    ];
    const out = await groundMasteryCards(ops, { learnerId: learner() });
    // The overwhelmingly common case must stay cheap and non-destructive.
    expect(out).toBe(ops);
  });

  it("grounds a card placed mid-turn while leaving its neighbours alone", async () => {
    const learnerId = learner();
    await evidence({ learnerId });

    const ops: BoardOp[] = [
      { op: "write_text", text: "Nice work" },
      {
        op: "place_widget",
        intent: card({ evidence: { recall: 99, understanding: 99, procedure: 99, transfer: 99, independence: 99 } }),
      },
    ];
    const out = await groundMasteryCards(ops, { learnerId });

    expect(out[0]).toEqual({ op: "write_text", text: "Nice work" });
    const grounded = (out[1] as Extract<BoardOp, { op: "place_widget" }>).intent as MasteryCardWidget;
    expect(grounded.evidence!.transfer).toBeLessThan(99);
  });

  it("grounds a card that arrives as an update to an existing block", async () => {
    const learnerId = learner();
    const ops: BoardOp[] = [
      {
        op: "update_widget",
        anchor: "block-1",
        intent: card({ evidence: { recall: 77, understanding: 77, procedure: 77, transfer: 77, independence: 77 } }),
      } as BoardOp,
    ];
    const out = await groundMasteryCards(ops, { learnerId });

    const grounded = (out[0] as Extract<BoardOp, { op: "update_widget" }>).intent as MasteryCardWidget;
    // Updating a card is the obvious way to slip an ungrounded number past a
    // pass that only inspects placements.
    expect(grounded.evidence!.recall).toBe(0);
    // The targeting fields must survive the rewrite, or the update lands nowhere.
    expect((out[0] as { anchor?: string }).anchor).toBe("block-1");
  });

  it("grounds every card when a turn places more than one", async () => {
    const learnerId = learner();
    const ops: BoardOp[] = [
      { op: "place_widget", intent: card({ skillId: "skill_a", evidence: { recall: 90, understanding: 90, procedure: 90, transfer: 90, independence: 90 } }) },
      { op: "place_widget", intent: card({ skillId: "skill_b", evidence: { recall: 90, understanding: 90, procedure: 90, transfer: 90, independence: 90 } }) },
    ];
    const out = await groundMasteryCards(ops, { learnerId });

    for (const op of out) {
      const intent = (op as Extract<BoardOp, { op: "place_widget" }>).intent as MasteryCardWidget;
      expect(intent.evidence!.recall).toBe(0);
    }
  });
});
