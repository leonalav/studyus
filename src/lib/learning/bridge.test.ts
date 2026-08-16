import { describe, it, expect, beforeEach } from "vitest";
import { getDb } from "../../db/database";
import { recordAssessmentEvidence, recordTutorObservation, recordWidgetEvidence } from "./bridge";
import { getSkillEvidence } from "./store";
import type { LearningActivityContract } from "./types";
import type { AnimationWidget, QuestionWidget, SliderWidget, WidgetIntent } from "../widgets/types";

/**
 * The bridge is where "the learner did something" becomes "the ledger knows
 * something", and it is the only place in the engine that can manufacture facts
 * out of nothing. Two failure modes matter more than correctness of any single
 * mapping:
 *
 *  1. Inflation — counting exploration, presentation, or a click as evidence.
 *     Every inflated event raises a mastery number the learner did not earn and
 *     the tutor will then teach against.
 *  2. Erasure — dropping real work because it arrived in an unexpected shape.
 *     Erased evidence leaves a learner stuck below a gate they have in fact
 *     cleared, which is the version of this bug that makes people quit.
 */

let n = 0;
function learner(): string {
  n += 1;
  return `bridge_learner_${n}`;
}

const contract: LearningActivityContract = {
  activityId: "act-1",
  targetSkillIds: ["chain_rule"],
  stage: "construct",
  mode: "guided_practice",
  taskFamily: "composite_derivative",
  contextVariant: "same",
  supportCeiling: 1,
  expectedEvidence: ["construction"],
  successCriteria: ["applies the outer derivative before the inner"],
  representationRoles: [],
  createdAt: new Date().toISOString(),
};

function mcq(overrides: Partial<QuestionWidget> = {}): QuestionWidget {
  return {
    kind: "question",
    prompt: "Which derivative is correct?",
    format: "multiple_choice",
    options: [
      { id: "a", label: "2x", correct: true },
      { id: "b", label: "x" },
    ],
    ...overrides,
  };
}

describe("bridge — only committed answers become evidence", () => {
  beforeEach(async () => {
    await getDb();
  });

  it("records a submitted answer as evidence against the contract's skills", async () => {
    const learnerId = learner();
    const event = await recordWidgetEvidence(
      mcq(),
      { selectedOptionId: "a", submitted: true },
      { learnerId, contract }
    );

    expect(event).toBeDefined();
    expect(event!.skillIds).toEqual(["chain_rule"]);
    expect(event!.correctness).toBe("correct");
    expect(event!.source).toBe("widget");
    // Persisted, not merely returned. A bridge that computes the right event
    // and fails to store it looks identical at the call site.
    const stored = await getSkillEvidence("chain_rule", learnerId);
    expect(stored.map((e) => e.evidenceId)).toContain(event!.evidenceId);
  });

  it("ignores an answer the learner has not committed", async () => {
    // A half-typed response is thinking in progress. Recording it would score
    // the learner on a draft and, worse, teach them that the box is watching.
    const event = await recordWidgetEvidence(
      mcq(),
      { selectedOptionId: "b", submitted: false },
      { learnerId: learner(), contract }
    );
    expect(event).toBeUndefined();
  });

  it("produces no evidence from presentational widgets however they are used", async () => {
    // Reading a roadmap says nothing about what the learner knows. Counting it
    // would mean a learner who scrolled attentively outranks one who worked.
    const roadmap: WidgetIntent = {
      kind: "roadmap",
      steps: [{ id: "s1", label: "Chain rule" }],
    };
    const event = await recordWidgetEvidence(
      roadmap,
      { submitted: true, responseText: "read it" },
      { learnerId: learner(), contract }
    );
    expect(event).toBeUndefined();
  });

  it("treats slider exploration as context, never evidence", async () => {
    // The invariant this whole module is built around: the moment a learner
    // suspects that moving a slider is being scored, they stop moving it and
    // the representation becomes decorative.
    const slider: SliderWidget = {
      kind: "slider",
      label: "Angle",
      parameter: "theta",
      min: 0,
      max: 90,
      value: 45,
    };
    const event = await recordWidgetEvidence(
      slider,
      { sliderValue: 72, submitted: true, interactedAt: new Date().toISOString() },
      { learnerId: learner(), contract }
    );
    expect(event).toBeUndefined();
  });

  it("promotes an explored widget to evidence once the agent attaches a prompt to answer", async () => {
    // The same slider becomes assessable the moment the learner is asked to
    // commit a claim about what they saw. Exploration stays free; the claim is
    // what gets recorded.
    const slider: SliderWidget = {
      kind: "slider",
      label: "Angle",
      parameter: "theta",
      min: 0,
      max: 90,
      value: 45,
      respond: { prompt: "What happens to range as theta passes 45 degrees?" },
    };
    const event = await recordWidgetEvidence(
      slider,
      { sliderValue: 72, responseText: "It starts falling again", submitted: true },
      { learnerId: learner(), contract }
    );
    expect(event).toBeDefined();
    expect(event!.evidenceType).toBe("observation");
    expect(event!.response).toContain("falling");
  });

  it("does not record playback position, only what the learner answered", async () => {
    const animation: AnimationWidget = {
      kind: "animation",
      frames: [{ id: "f1", caption: "Secant approaches tangent" }],
      predictPrompt: "What will the secant slope approach?",
      respond: { prompt: "Commit your prediction" },
    };
    const event = await recordWidgetEvidence(
      animation,
      {
        responseText: "The tangent slope",
        submitted: true,
        predictionLocked: true,
        animationProgress: 0.62,
      },
      { learnerId: learner(), contract }
    );

    expect(event).toBeDefined();
    expect(event!.evidenceType).toBe("prediction");
    // The scrub trail that got them there is telemetry. Nothing in the stored
    // row should carry it.
    expect(JSON.stringify(event)).not.toContain("0.62");
  });
});

describe("bridge — evidence type reflects the cognitive act, not the widget", () => {
  beforeEach(async () => {
    await getDb();
  });

  it("files a multiple-choice answer as selection", async () => {
    const event = await recordWidgetEvidence(
      mcq(),
      { selectedOptionId: "a", submitted: true },
      { learnerId: learner(), contract }
    );
    // Recognition is the weakest evidence type and must not masquerade as
    // production.
    expect(event!.evidenceType).toBe("selection");
  });

  it("files a short-answer response as construction, because the learner produced it", async () => {
    // Same widget kind, different cognitive act. Filing both as `selection`
    // makes production evidence invisible and strands the learner below
    // Construct forever despite doing constructive work.
    const event = await recordWidgetEvidence(
      mcq({ format: "short_answer", options: undefined, acceptedAnswers: ["2x"] }),
      { responseText: "2x", submitted: true },
      { learnerId: learner(), contract }
    );
    expect(event!.evidenceType).toBe("construction");
    expect(event!.correctness).toBe("correct");
  });

  it("relabels evidence as transfer when the activity's whole point was the changed context", async () => {
    const event = await recordWidgetEvidence(
      mcq(),
      { selectedOptionId: "a", submitted: true },
      {
        learnerId: learner(),
        contract: { ...contract, mode: "transfer", contextVariant: "changed_context" },
      }
    );
    expect(event!.evidenceType).toBe("transfer");
    expect(event!.contextVariant).toBe("changed_context");
  });

  it("keeps a retrieval check as retrieval even in a transfer-mode activity", async () => {
    const retrieval: WidgetIntent = {
      kind: "retrieval_check",
      prompt: "State the chain rule",
      format: "short_answer",
      acceptedAnswers: ["f'(g(x))g'(x)"],
    };
    const event = await recordWidgetEvidence(
      retrieval,
      { responseText: "f'(g(x))g'(x)", submitted: true },
      { learnerId: learner(), contract: { ...contract, mode: "transfer" } }
    );
    // Retrieval is the only evidence that can support a Master claim, so it must
    // never be relabelled into something weaker or stronger by the mode.
    expect(event!.evidenceType).toBe("retrieval");
  });
});

describe("bridge — an ungraded response is not a wrong one", () => {
  beforeEach(async () => {
    await getDb();
  });

  it("records an open reflection as unknown rather than incorrect", async () => {
    // Recording it as incorrect would fabricate failures out of open questions,
    // and those fabricated failures drive regression and repair routing — the
    // learner gets sent backwards for answering thoughtfully.
    const reflection: WidgetIntent = {
      kind: "reflection",
      prompt: "What was hardest about this?",
    };
    const event = await recordWidgetEvidence(
      reflection,
      { responseText: "Keeping track of which function is inner", submitted: true },
      { learnerId: learner(), contract }
    );
    expect(event!.correctness).toBe("unknown");
    // And nothing asserts confidence about a judgement that was never made.
    expect(event!.evaluatorConfidence).toBeUndefined();
  });

  it("records an empty submission as blank rather than incorrect", async () => {
    const event = await recordWidgetEvidence(
      mcq({ format: "short_answer", options: undefined, acceptedAnswers: ["2x"] }),
      { responseText: "   ", submitted: true },
      { learnerId: learner(), contract }
    );
    // A blank is a signal about engagement, not about the misconception the
    // learner never expressed.
    expect(event!.correctness).toBe("blank");
  });

  it("marks a deterministically graded answer with full evaluator confidence", async () => {
    const event = await recordWidgetEvidence(
      mcq(),
      { selectedOptionId: "b", submitted: true },
      { learnerId: learner(), contract }
    );
    expect(event!.correctness).toBe("incorrect");
    // A key-graded answer is certain; downstream credit should not be discounted.
    expect(event!.evaluatorConfidence).toBe(100);
  });
});

describe("bridge — independence is read from what the learner opened", () => {
  beforeEach(async () => {
    await getDb();
  });

  it("records the hints actually opened, not the ceiling that was permitted", async () => {
    // A learner may work unaided under a generous ceiling, and that deserves
    // independence credit. Reading the ceiling instead would punish them for
    // help they declined.
    const event = await recordWidgetEvidence(
      mcq(),
      { selectedOptionId: "a", submitted: true, hintLevelOpened: 0 },
      { learnerId: learner(), contract, supportCeiling: 3 }
    );
    expect(event!.hintExposure).toBe(0);
    expect(event!.supportLevel).toBe(3);
  });

  it("carries hint exposure through when the learner did take help", async () => {
    const event = await recordWidgetEvidence(
      mcq(),
      { selectedOptionId: "a", submitted: true, hintLevelOpened: 2 },
      { learnerId: learner(), contract, supportCeiling: 3 }
    );
    expect(event!.hintExposure).toBe(2);
  });

  it("carries the learner's self-rated confidence without treating it as knowledge", async () => {
    const event = await recordWidgetEvidence(
      mcq(),
      { selectedOptionId: "b", submitted: true, confidence: 95 },
      { learnerId: learner(), contract }
    );
    // High confidence on a wrong answer is the calibration fact the planner
    // needs; it must survive the trip into the ledger.
    expect(event!.selfRatedConfidence).toBe(95);
    expect(event!.correctness).toBe("incorrect");
  });

  it("keeps distinct board placements as distinct tasks", async () => {
    const learnerId = learner();
    await recordWidgetEvidence(mcq(), { selectedOptionId: "a", submitted: true }, {
      learnerId,
      contract,
      taskId: "board-1:block-a",
    });
    await recordWidgetEvidence(mcq(), { selectedOptionId: "a", submitted: true }, {
      learnerId,
      contract,
      taskId: "board-1:block-b",
    });

    const stored = await getSkillEvidence("chain_rule", learnerId);
    // The predicates count DISTINCT tasks and families. If two placements
    // collapse into one id, a learner who answered several problems reads as a
    // learner who answered one, and breadth can never be demonstrated.
    expect(new Set(stored.map((e) => e.taskId)).size).toBe(2);
  });
});

describe("bridge — assessments and conversation enter the same ledger", () => {
  beforeEach(async () => {
    await getDb();
  });

  it("files an assessment result as unaided evidence by default", async () => {
    const learnerId = learner();
    const event = await recordAssessmentEvidence({
      learnerId,
      skillIds: ["chain_rule"],
      itemId: "item-9",
      taskFamily: "composite_derivative",
      response: "2x cos(x^2)",
      correct: true,
    });

    // Before this bridge existed a learner could ace an assessment while the
    // tutor kept treating them as a beginner.
    expect(event.source).toBe("assessment");
    expect(event.supportLevel).toBe(0);
    expect(event.hintExposure).toBe(0);
    expect((await getSkillEvidence("chain_rule", learnerId))[0].correctness).toBe("correct");
  });

  it("files a delayed assessment as retrieval", async () => {
    const event = await recordAssessmentEvidence({
      learnerId: learner(),
      skillIds: ["chain_rule"],
      itemId: "item-10",
      taskFamily: "composite_derivative",
      response: "correct thing",
      correct: true,
      delayed: true,
    });
    expect(event.evidenceType).toBe("retrieval");
    expect(event.delayed).toBe(true);
  });

  it("caps a conversational judgement below a mark scheme's certainty", async () => {
    const event = await recordTutorObservation({
      learnerId: learner(),
      skillIds: ["chain_rule"],
      taskId: "turn-3",
      taskFamily: "explaining_composition",
      evidenceType: "explanation",
      response: "You differentiate the outside then multiply by the inside derivative",
      correctness: "correct",
      supportLevel: 0,
      hintExposure: 0,
      evaluatorConfidence: 100,
    });

    // An over-confident model must not be able to give its own opinion the
    // weight of an answer key.
    expect(event.evaluatorConfidence).toBe(85);
    expect(event.source).toBe("tutor_turn");
  });

  it("defaults an unstated conversational confidence to a hedged value", async () => {
    const event = await recordTutorObservation({
      learnerId: learner(),
      skillIds: ["chain_rule"],
      taskId: "turn-4",
      taskFamily: "explaining_composition",
      evidenceType: "explanation",
      response: "Something roughly right",
      correctness: "correct",
      supportLevel: 0,
      hintExposure: 0,
    });
    expect(event.evaluatorConfidence).toBe(70);
  });
});
