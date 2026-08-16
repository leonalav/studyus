import { describe, it, expect } from "vitest";
import { formatMoveDirective, planNextMove, readSignals } from "./policy";
import { emptySkillState } from "./types";
import type { MasteryStage } from "../mastery";
import type { LearnerHypothesis, LearningEvidenceEvent, ReviewTask, SkillState } from "./types";

/**
 * The planner's check ORDER is the pedagogy, so most of these tests are
 * conflict tests: two conditions are made true at once and the assertion is
 * about which one wins. A planner that handles each condition correctly in
 * isolation but resolves collisions by accident will teach the wrong thing at
 * precisely the moments that matter most.
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
    response: "worked response",
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

function state(overrides: Partial<SkillState> = {}): SkillState {
  return { ...emptySkillState("L", "derivatives"), ...overrides };
}

function review(overrides: Partial<ReviewTask> = {}): ReviewTask {
  return {
    reviewId: "r1",
    learnerId: "L",
    skillId: "derivatives",
    taskFamily: "family_a",
    dueAt: new Date(Date.now() - DAY).toISOString(),
    intervalIndex: 1,
    state: "due",
    requiredMode: "unaided",
    retrievalType: "free_recall",
    reconstruction: false,
    createdAt: new Date(Date.now() - 3 * DAY).toISOString(),
    attemptCount: 0,
    ...overrides,
  };
}

function hypothesis(overrides: Partial<LearnerHypothesis> = {}): LearnerHypothesis {
  return {
    hypothesisId: "h1",
    learnerId: "L",
    skillId: "derivatives",
    kind: "misconception",
    statement: "Believes the derivative of a product is the product of the derivatives.",
    status: "supported",
    supportingEvidenceIds: ["e1"],
    contradictingEvidenceIds: [],
    nextBestTest: "Ask for d/dx of x * x and compare with 2x.",
    firstObserved: new Date(Date.now() - 2 * DAY).toISOString(),
    lastObserved: new Date(Date.now() - DAY).toISOString(),
    learnerDisputed: false,
    ...overrides,
  };
}

describe("readSignals", () => {
  it("reports nothing on an empty ledger rather than inventing a profile", () => {
    const signals = readSignals([]);
    expect(signals.hasAnyEvidence).toBe(false);
    expect(signals.overconfident).toBe(false);
    expect(signals.underconfident).toBe(false);
    expect(signals.consecutiveFailures).toBe(0);
  });

  it("counts consecutive failures only up to the most recent success", () => {
    const signals = readSignals([
      ev({ correctness: "incorrect" }),
      ev({ correctness: "correct" }),
      ev({ correctness: "incorrect" }),
      ev({ correctness: "incorrect" }),
    ]);
    expect(signals.consecutiveFailures).toBe(2);
  });

  it("does not call one confident wrong answer a calibration problem", () => {
    // A bad day and a calibration problem call for opposite responses, so the
    // signal requires a pattern before it fires.
    const single = readSignals([ev({ correctness: "incorrect", selfRatedConfidence: 95 })]);
    expect(single.overconfident).toBe(false);

    const pattern = readSignals([
      ev({ correctness: "incorrect", selfRatedConfidence: 95 }),
      ev({ correctness: "incorrect", selfRatedConfidence: 90 }),
    ]);
    expect(pattern.overconfident).toBe(true);
  });

  it("detects underconfidence, which is a different problem from ignorance", () => {
    const signals = readSignals([
      ev({ correctness: "correct", selfRatedConfidence: 20 }),
      ev({ correctness: "correct", selfRatedConfidence: 25 }),
    ]);
    expect(signals.underconfident).toBe(true);
    expect(signals.overconfident).toBe(false);
  });

  it("notices disengagement from blank and perfunctory responses", () => {
    const signals = readSignals([
      ev({ correctness: "blank", response: "" }),
      ev({ correctness: "blank", response: "" }),
      ev({ response: "ok" }),
    ]);
    expect(signals.disengaged).toBe(true);
  });
});

describe("planNextMove — ordering conflicts", () => {
  it("puts a due review ahead of new teaching", () => {
    // A review deferred because something new came up is a review that never
    // happens, and retention decays whether or not the new thing is interesting.
    const move = planNextMove({
      state: state({ stage: "construct" }),
      events: [ev(), ev({ taskFamily: "b" })],
      dueReviews: [review()],
    });
    expect(move.route).toBe("due_retrieval");
    expect(move.reviewId).toBe("r1");
  });

  it("puts a due review ahead of even an owed reconstruction", () => {
    const move = planNextMove({
      state: state({ stage: "apply", reconstructionDueTaskFamily: "chain" }),
      events: [ev()],
      dueReviews: [review()],
    });
    expect(move.route).toBe("due_retrieval");
  });

  it("puts an owed reconstruction ahead of ordinary progression", () => {
    const move = planNextMove({
      state: state({ stage: "construct", reconstructionDueTaskFamily: "chain", supportedSuccesses: 2 }),
      events: [ev({ supportLevel: 2, hintExposure: 2 })],
    });
    expect(move.route).toBe("independent_practice");
    expect(move.reconstructionTaskFamily).toBe("chain");
    expect(move.supportCeiling).toBe(0);
  });

  it("checks the prerequisite after repeated failure instead of retrying the same level", () => {
    const failures = [
      ev({ correctness: "incorrect" }),
      ev({ correctness: "incorrect" }),
      ev({ correctness: "incorrect" }),
    ];
    const move = planNextMove({
      state: state({ stage: "construct" }),
      events: failures,
      weakPrerequisites: [{ skillId: "algebra_factoring", state: state({ skillId: "algebra_factoring" }) }],
    });
    expect(move.route).toBe("prerequisite_repair");
    expect(move.targetSkillIds).toEqual(["algebra_factoring"]);
  });

  it("probes rather than teaches when repeated failure has no identified cause", () => {
    const move = planNextMove({
      state: state({ stage: "construct" }),
      events: [
        ev({ correctness: "incorrect" }),
        ev({ correctness: "incorrect" }),
        ev({ correctness: "incorrect" }),
      ],
    });
    expect(move.route).toBe("diagnostic_probe");
    expect(move.rationale).toMatch(/guess|cause/i);
  });

  it("answers a supported misconception with a contrast case, not a restatement", () => {
    const move = planNextMove({
      state: state({ stage: "construct" }),
      events: [ev()],
      hypotheses: [hypothesis()],
    });
    expect(move.route).toBe("contrast_case");
    // The test that would settle the hypothesis has to reach the tutor, or the
    // hypothesis stays open forever.
    expect(move.rationale).toMatch(/Next best test/);
  });

  it("ignores a hypothesis the learner has disputed", () => {
    const move = planNextMove({
      state: state({ stage: "construct" }),
      events: [ev()],
      hypotheses: [hypothesis({ learnerDisputed: true })],
    });
    expect(move.route).not.toBe("contrast_case");
  });

  it("ignores a merely suspected hypothesis until evidence supports it", () => {
    const move = planNextMove({
      state: state({ stage: "construct" }),
      events: [ev()],
      hypotheses: [hypothesis({ status: "suspected" })],
    });
    expect(move.route).not.toBe("contrast_case");
  });

  it("answers overconfidence with a discriminating task rather than encouragement", () => {
    const rated = [
      ev({ correctness: "incorrect", selfRatedConfidence: 95 }),
      ev({ correctness: "incorrect", selfRatedConfidence: 90 }),
      ev({ correctness: "partial", selfRatedConfidence: 95 }),
    ];
    const move = planNextMove({
      state: state({ stage: "apply", totalEvidenceCount: 3 }),
      events: rated,
    });
    expect(move.route).toBe("transfer_check");
  });

  it("fades support when successes keep arriving with help", () => {
    const helped = Array.from({ length: 3 }, (_, index) =>
      ev({ taskFamily: `f${index}`, supportLevel: 2, hintExposure: 2 })
    );
    const move = planNextMove({
      state: state({ stage: "construct", supportedSuccesses: 3 }),
      events: helped,
    });
    expect(move.route).toBe("faded_example");
    expect(move.rationale).toMatch(/support has to start coming out/i);
  });
});

describe("planNextMove — stage progression", () => {
  const routeForStage = (stage: MasteryStage) =>
    planNextMove({ state: state({ stage }), events: [ev()] }).route;

  it("opens at encounter with a prediction rather than an explanation", () => {
    expect(routeForStage("encounter")).toBe("prediction");
  });

  it("aims each stage at evidence that stage actually lacks", () => {
    expect(routeForStage("construct")).toBe("faded_example");
    expect(routeForStage("apply")).toBe("independent_practice");
    expect(routeForStage("transfer")).toBe("transfer_check");
  });
});

describe("planNextMove — the ceiling and the widget permission list", () => {
  it("pins measurement routes to zero support", () => {
    // These routes exist to measure unaided performance; any help deletes the
    // measurement while leaving something that still looks like evidence.
    for (const [stage, expected] of [
      ["apply", "independent_practice"],
      ["transfer", "transfer_check"],
      ["encounter", "prediction"],
    ] as const) {
      const move = planNextMove({ state: state({ stage }), events: [ev()] });
      expect(move.route).toBe(expected);
      expect(move.supportCeiling).toBe(0);
    }
  });

  it("allows real support on a repair route, where withholding it is pointless", () => {
    const move = planNextMove({
      state: state({ stage: "construct" }),
      events: [
        ev({ correctness: "incorrect" }),
        ev({ correctness: "incorrect" }),
        ev({ correctness: "incorrect" }),
      ],
      weakPrerequisites: [{ skillId: "algebra_factoring", state: state({ skillId: "algebra_factoring" }) }],
    });
    expect(move.route).toBe("prerequisite_repair");
    expect(move.supportCeiling).toBeGreaterThan(0);
  });

  it("restricts a retrieval move to widgets that can actually measure recall", () => {
    const move = planNextMove({
      state: state({ stage: "master" }),
      events: [ev()],
      dueReviews: [review()],
    });
    expect(move.permittedWidgetKinds).toEqual(["retrieval_check", "question"]);
    // A worked example during a retrieval check is not a slip, it is the end of
    // the measurement.
    expect(move.permittedWidgetKinds).not.toContain("example");
    expect(move.permittedWidgetKinds).not.toContain("hint");
  });

  it("never leaves a move without a route, evidence requirement, or rationale", () => {
    const stages: MasteryStage[] = ["encounter", "understand", "construct", "apply", "transfer", "master"];
    for (const stage of stages) {
      const move = planNextMove({ state: state({ stage }), events: [ev()] });
      expect(move.route).toBeTruthy();
      expect(move.requiredEvidence.length).toBeGreaterThan(0);
      expect(move.permittedWidgetKinds.length).toBeGreaterThan(0);
      // A move the tutor cannot justify to the learner is a move that will be
      // delivered as an arbitrary demand.
      expect(move.rationale.length).toBeGreaterThan(20);
      expect(move.targetSkillIds.length).toBeGreaterThan(0);
    }
  });
});

describe("formatMoveDirective", () => {
  it("names the move, the ceiling, and the evidence without naming renderers", () => {
    const move = planNextMove({ state: state({ stage: "apply" }), events: [ev()] });
    const directive = formatMoveDirective(move);
    expect(directive).toContain(move.route);
    expect(directive).toMatch(/ceiling/i);
    // The model decides how to explain; it does not get to pick the policy.
    expect(directive.length).toBeGreaterThan(80);
  });
});
