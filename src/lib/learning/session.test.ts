import { describe, it, expect, beforeEach } from "vitest";
import { getDb } from "../../db/database";
import { buildPolicyBrief, buildSessionOpeningBrief, formatPolicyBrief, refreshSkillAfterTurn } from "./session";
import { recordEvidence, scheduleReview, upsertHypothesis, upsertSkillNode } from "./store";
import { emptySkillState, type LearningEvidenceEvent, type LearningEvidenceInput, type NextLearningMove } from "./types";
import type { SupportDecision } from "./support";

/**
 * `session.ts` is the seam where the engine's decisions become text a language
 * model reads. Everything upstream can be correct and the product still fails
 * here, in two specific ways:
 *
 *  - The brief states a constraint the model can talk itself out of. A ceiling
 *    phrased as a preference is not a ceiling.
 *  - The brief invites the model to author the numbers it is being shown. The
 *    entire refactor exists to stop model-authored mastery percentages, and the
 *    prompt is the last place that leak can reopen.
 *
 * So these tests read the rendered prompt as an adversarial reader would: what
 * could a model do that this text does not forbid?
 */

const DAY = 24 * 60 * 60 * 1000;
let n = 0;
function learner(): string {
  n += 1;
  return `session_learner_${n}`;
}

function evidence(overrides: Partial<LearningEvidenceInput> & { learnerId: string }): Promise<LearningEvidenceEvent> {
  return recordEvidence({
    skillIds: ["limits"],
    taskId: `task_${Math.random().toString(36).slice(2)}`,
    taskFamily: "epsilon_delta",
    contextVariant: "same",
    evidenceType: "construction",
    response: "worked answer",
    correctness: "correct",
    supportLevel: 0,
    source: "widget",
    ...overrides,
  });
}

describe("buildPolicyBrief — one turn's decision, assembled from the ledger", () => {
  beforeEach(async () => {
    await getDb();
  });

  it("starts a never-seen skill at the session's stage rather than throwing it back to encounter", async () => {
    const brief = await buildPolicyBrief({
      learnerId: learner(),
      skillId: "brand_new_skill",
      learnerMessage: "ok, what next?",
      fallbackStage: "construct",
    });

    // A learner mid-lesson must not be reset by the mere fact that the skill was
    // only just named. Evidence overrides this the moment any exists.
    expect(brief.state.stage).toBe("construct");
    expect(brief.state.totalEvidenceCount).toBe(0);
  });

  it("normalizes the skill id so board and tutor evidence land on one row", async () => {
    const brief = await buildPolicyBrief({
      learnerId: learner(),
      skillId: "  Chain Rule (basic) ",
      learnerMessage: "hello",
    });
    expect(brief.skillId).toBe("chain_rule_basic");
  });

  it("reads the learner's message for attempt and help-seeking, not just the ledger", async () => {
    const learnerId = learner();
    const brief = await buildPolicyBrief({
      learnerId,
      skillId: "limits",
      learnerMessage: "I tried it and got 3x^2 but I'm not sure why the middle term vanished",
    });

    expect(brief.attempt.madeAttempt).toBe(true);
    // Work shown alongside a question is still work. Treating it as a bare help
    // request would strip the learner of credit for the thinking they did.
    expect(brief.support.granted).toBeGreaterThanOrEqual(0);
  });

  it("withholds all support from a learner who has not attempted anything", async () => {
    const brief = await buildPolicyBrief({
      learnerId: learner(),
      skillId: "limits",
      learnerMessage: "just tell me the answer",
    });

    expect(brief.attempt.madeAttempt).toBe(false);
    expect(brief.support.granted).toBe(0);
    // And the model is told what to do instead of simply being told "no" —
    // a refusal with no alternative reads as evasion to the learner.
    expect(brief.support.instruction.length).toBeGreaterThan(0);
  });

  it("lets a due review preempt whatever the stage would otherwise suggest", async () => {
    const learnerId = learner();
    await evidence({ learnerId });
    await scheduleReview({
      learnerId,
      skillId: "limits",
      taskFamily: "epsilon_delta",
      dueAt: new Date(Date.now() - DAY),
    });

    const brief = await buildPolicyBrief({ learnerId, skillId: "limits", learnerMessage: "hi" });

    expect(brief.move.route).toBe("due_retrieval");
    // A retrieval that is coached measures the coaching.
    expect(brief.move.supportCeiling).toBe(0);
    expect(brief.dueReviews).toHaveLength(1);
  });

  it("excludes hypotheses the learner has disputed from the planning input", async () => {
    const learnerId = learner();
    const hypothesis = await upsertHypothesis({
      learnerId,
      skillId: "limits",
      kind: "misconception",
      statement: "Believes a limit is the value the function takes at the point",
      nextBestTest: "Ask for the limit of a function with a removable discontinuity",
      evidenceIds: ["a", "b"],
    });
    const { disputeHypothesis } = await import("./store");
    await disputeHypothesis(hypothesis.hypothesisId, "I know the difference, I just wrote it badly");

    const brief = await buildPolicyBrief({ learnerId, skillId: "limits", learnerMessage: "hi" });

    // Planning around a claim the learner has rejected is how a tutor becomes
    // something a learner argues with instead of learns from.
    expect(brief.move.route).not.toBe("contrast_case");
    expect(brief.prompt).not.toContain("removable discontinuity");
  });

  it("does not drop into prerequisite repair on a prerequisite that merely has no evidence", async () => {
    const learnerId = learner();
    await upsertSkillNode({ skillId: "limits", label: "Limits", prerequisites: ["functions"] });
    await upsertSkillNode({ skillId: "functions", label: "Functions", prerequisites: [] });
    // Three consecutive failures would route to repair IF a weak prerequisite
    // were known. `functions` has no evidence at all, so it is unknown, not weak.
    for (let i = 0; i < 3; i += 1) {
      await evidence({ learnerId, correctness: "incorrect", taskFamily: `fam_${i}` });
    }

    const brief = await buildPolicyBrief({ learnerId, skillId: "limits", learnerMessage: "stuck again" });

    // Marching a competent learner through material they already have is its own
    // kind of failure, so an unknown prerequisite provokes a probe, not repair.
    expect(brief.move.route).toBe("diagnostic_probe");
  });

  it("routes to prerequisite repair once the prerequisite is demonstrably weak", async () => {
    const learnerId = learner();
    await upsertSkillNode({ skillId: "limits", label: "Limits", prerequisites: ["functions"] });
    await upsertSkillNode({ skillId: "functions", label: "Functions", prerequisites: [] });
    for (let i = 0; i < 3; i += 1) {
      await evidence({ learnerId, correctness: "incorrect", taskFamily: `fam_${i}` });
    }
    // Now give the prerequisite evidence, and make that evidence bad.
    for (let i = 0; i < 3; i += 1) {
      await evidence({
        learnerId,
        skillIds: ["functions"],
        correctness: "incorrect",
        taskFamily: `func_fam_${i}`,
      });
    }

    const brief = await buildPolicyBrief({ learnerId, skillId: "limits", learnerMessage: "stuck again" });

    expect(brief.move.route).toBe("prerequisite_repair");
    expect(brief.move.targetSkillIds).toContain("functions");
  });

  it("writes nothing to the ledger while building a brief", async () => {
    const learnerId = learner();
    await evidence({ learnerId });

    const before = brief_count(await import("./store").then((m) => m.getSkillEvidence("limits", learnerId)));
    await buildPolicyBrief({ learnerId, skillId: "limits", learnerMessage: "I tried x=2 and got 5" });
    const after = brief_count(await import("./store").then((m) => m.getSkillEvidence("limits", learnerId)));

    // Evidence is written only after a turn completes. A failed model call must
    // not leave the ledger claiming the learner did something they never saw.
    expect(after).toBe(before);
  });
});

function brief_count(events: LearningEvidenceEvent[]): number {
  return events.length;
}

describe("formatPolicyBrief — what the model is allowed to conclude", () => {
  const state = { ...emptySkillState("l", "limits"), totalEvidenceCount: 4, recall: 40, stage: "understand" as const };
  const move: NextLearningMove = {
    route: "guided_retry",
    targetSkillIds: ["limits"],
    stage: "understand",
    mode: "guided_practice",
    contextVariant: "same",
    supportCeiling: 1,
    requiredEvidence: ["explanation"],
    permittedWidgetKinds: ["question"],
    rationaleEvidenceIds: [],
    rationale: "The learner has recognition but has not stated the mechanism.",
  };
  const support: SupportDecision = {
    granted: 1,
    ladderLevel: 1,
    ceilingBinding: true,
    requiresReconstruction: false,
    instruction: "Orientation only. Reducing the task is allowed; doing the task is not.",
  };

  function render(overrides: Partial<Parameters<typeof formatPolicyBrief>[0]> = {}): string {
    return formatPolicyBrief({
      state,
      events: [],
      move,
      support,
      hypotheses: [],
      dueReviews: [],
      ...overrides,
    });
  }

  it("forbids the model from restating or revising the computed numbers", () => {
    const text = render();
    // The single most important sentence in the brief. Without it, a model that
    // sees five percentages treats them as an opening bid.
    expect(text).toMatch(/must not restate, revise, or invent/i);
  });

  it("shows the numbers as derived from a countable number of observations", () => {
    expect(render()).toContain("computed from 4 recorded observations");
  });

  it("states that advancement is decided by predicates rather than by the model's judgement", () => {
    const text = render();
    expect(text).toMatch(/not by your judgement/i);
    // The specific loophole: a model asserting readiness in prose.
    expect(text).toMatch(/Produce the missing evidence and the stage moves on its own/i);
  });

  it("lists what the gate still needs, so the model can aim at it", () => {
    const text = render();
    expect(text).toContain("STAGE GATE:");
    expect(text).toContain("Still missing:");
  });

  it("marks hypotheses as provisional claims the learner's work can overturn", () => {
    const text = render({
      hypotheses: [
        {
          hypothesisId: "h1",
          learnerId: "l",
          skillId: "limits",
          kind: "misconception",
          statement: "Treats a limit as substitution",
          status: "supported",
          supportingEvidenceIds: ["a", "b"],
          contradictingEvidenceIds: [],
          nextBestTest: "Removable discontinuity",
          firstObserved: new Date().toISOString(),
          lastObserved: new Date().toISOString(),
          learnerDisputed: false,
        },
      ],
    });

    expect(text).toMatch(/provisional claims, not facts/i);
    expect(text).toContain("Next best test: Removable discontinuity");
  });

  it("omits resolved and disputed hypotheses from the prompt entirely", () => {
    const base = {
      hypothesisId: "h",
      learnerId: "l",
      skillId: "limits",
      kind: "misconception" as const,
      statement: "OLD CLAIM THAT SHOULD NOT APPEAR",
      supportingEvidenceIds: [],
      contradictingEvidenceIds: [],
      nextBestTest: "n/a",
      firstObserved: new Date().toISOString(),
      lastObserved: new Date().toISOString(),
      learnerDisputed: false,
    };
    const text = render({
      hypotheses: [
        { ...base, hypothesisId: "h1", status: "resolved" },
        { ...base, hypothesisId: "h2", status: "disputed", learnerDisputed: true },
      ],
    });

    // A learner model that cannot shrink becomes a permanent record of someone's
    // worst day, and the tutor keeps teaching the learner they used to be.
    expect(text).not.toContain("OLD CLAIM THAT SHOULD NOT APPEAR");
  });

  it("caps the hypothesis list so the brief cannot crowd out the move", () => {
    const many = Array.from({ length: 9 }, (_, i) => ({
      hypothesisId: `h${i}`,
      learnerId: "l",
      skillId: "limits",
      kind: "misconception" as const,
      statement: `CLAIM_${i}`,
      status: "supported" as const,
      supportingEvidenceIds: [],
      contradictingEvidenceIds: [],
      nextBestTest: "test",
      firstObserved: new Date().toISOString(),
      lastObserved: new Date().toISOString(),
      learnerDisputed: false,
    }));
    const text = render({ hypotheses: many });
    const shown = many.filter((h) => text.includes(h.statement)).length;
    expect(shown).toBe(4);
  });

  it("ends with a routing table that overrides any general ask-versus-tell rule", () => {
    const text = render();
    // The conflict this refactor exists to resolve: "require an independent
    // attempt first" versus "default to direct help". A model handed both obeys
    // whichever it read last.
    expect(text).toMatch(/replaces any general instruction about whether to ask or tell/i);
  });

  it("orders the brief so state precedes the gate, the move, and the support ceiling", () => {
    const text = render();
    const order = ["EVIDENCE STATE", "STAGE GATE", "SUPPORT DECISION"].map((key) => text.indexOf(key));
    expect(order[0]).toBeGreaterThanOrEqual(0);
    // Reasoning before verdict: a model that understands why a ceiling exists
    // holds it better than one merely told to.
    expect(order[0]).toBeLessThan(order[1]);
    expect(order[1]).toBeLessThan(order[2]);
  });
});

describe("buildSessionOpeningBrief — reviews before new material", () => {
  beforeEach(async () => {
    await getDb();
  });

  it("returns nothing at all when no review is due", async () => {
    // Empty string rather than a placeholder, so the caller can append it
    // unconditionally without polluting the prompt with "nothing due".
    expect(await buildSessionOpeningBrief(learner())).toBe("");
  });

  it("names the skill and says why each review is owed", async () => {
    const learnerId = learner();
    await scheduleReview({
      learnerId,
      skillId: "limits",
      taskFamily: "epsilon_delta",
      dueAt: new Date(Date.now() - 3 * DAY),
    });

    const text = await buildSessionOpeningBrief(learnerId);
    expect(text).toContain("limits");
    expect(text).toContain("3 days overdue");
  });

  it("distinguishes an owed reconstruction from an ordinary scheduled retrieval", async () => {
    const learnerId = learner();
    await scheduleReview({
      learnerId,
      skillId: "limits",
      taskFamily: "epsilon_delta",
      dueAt: new Date(Date.now() - DAY),
      reconstruction: true,
    });

    const text = await buildSessionOpeningBrief(learnerId);
    // The learner "succeeded" last time with substantive help, so the success is
    // not yet evidence of anything they can do alone.
    expect(text).toMatch(/unaided reconstruction is owed/i);
  });

  it("insists the retrieval stays unaided even if the learner asks for help", async () => {
    const learnerId = learner();
    await scheduleReview({
      learnerId,
      skillId: "limits",
      taskFamily: "epsilon_delta",
      dueAt: new Date(Date.now() - DAY),
    });

    const text = await buildSessionOpeningBrief(learnerId);
    expect(text).toMatch(/even if asked/i);
    expect(text).toMatch(/narrowing of the option space/i);
  });

  it("routes a failed retrieval into repair instead of into the answer", async () => {
    const learnerId = learner();
    await scheduleReview({
      learnerId,
      skillId: "limits",
      taskFamily: "epsilon_delta",
      dueAt: new Date(Date.now() - DAY),
    });

    const text = await buildSessionOpeningBrief(learnerId);
    // Supplying the answer on a failed review converts the one moment that
    // measures durable memory into a moment of re-presentation.
    expect(text).toMatch(/do not simply supply the answer/i);
    expect(text).toMatch(/reschedule/i);
  });

  it("caps the opening at two reviews however long the backlog is", async () => {
    const learnerId = learner();
    for (let i = 0; i < 6; i += 1) {
      await scheduleReview({
        learnerId,
        skillId: `skill_${i}`,
        taskFamily: `family_${i}`,
        dueAt: new Date(Date.now() - (i + 1) * DAY),
      });
    }

    const text = await buildSessionOpeningBrief(learnerId);
    const bullets = text.split("\n").filter((line) => line.startsWith("- "));
    // A learner returning after a month meeting their entire queue is how
    // spaced repetition becomes the thing people quit.
    expect(bullets).toHaveLength(2);
  });

  it("puts an owed reconstruction ahead of an older ordinary review", async () => {
    const learnerId = learner();
    await scheduleReview({
      learnerId,
      skillId: "old_skill",
      taskFamily: "old_family",
      dueAt: new Date(Date.now() - 30 * DAY),
    });
    await scheduleReview({
      learnerId,
      skillId: "owed_skill",
      taskFamily: "owed_family",
      dueAt: new Date(Date.now() - DAY),
      reconstruction: true,
    });

    const text = await buildSessionOpeningBrief(learnerId);
    // An unverified success is a hole in the record, and it should be closed
    // before an old but already-verified item is revisited.
    expect(text.indexOf("owed_skill")).toBeLessThan(text.indexOf("old_skill"));
  });
});

describe("refreshSkillAfterTurn", () => {
  beforeEach(async () => {
    await getDb();
  });

  it("recomputes every skill an event touched", async () => {
    const learnerId = learner();
    await recordEvidence({
      learnerId,
      skillIds: ["limits", "algebra"],
      taskId: "t1",
      taskFamily: "epsilon_delta",
      contextVariant: "same",
      evidenceType: "construction",
      response: "ok",
      correctness: "correct",
      supportLevel: 0,
      source: "widget",
    });

    const states = await refreshSkillAfterTurn(learnerId, ["limits", "algebra"]);
    expect(states).toHaveLength(2);
    // Recomputation is deterministic: a rebuild from the same ledger must land
    // in the same place, which is what makes the numbers auditable.
    for (const state of states) {
      expect(state.totalEvidenceCount).toBe(1);
      expect(state.unaidedSuccesses).toBe(1);
    }
  });
});
