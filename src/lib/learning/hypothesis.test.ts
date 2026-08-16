import { describe, it, expect } from "vitest";
import { validateTutorPayload, recordTutorHypotheses } from "../tutor";
import { getHypotheses, recordEvidence, upsertHypothesis } from "./store";
import { DEFAULT_TUTOR } from "../preferences";
import type { LearningEvidenceInput } from "./types";

/**
 * The structured learner model exists because free-text statements about a
 * learner have two properties that make them dangerous: they are not
 * actionable, and they are not removable.
 *
 * "Struggles with the chain rule" does not tell a planner whether to place a
 * contrast case, drop to a prerequisite, or say nothing at all — and once
 * written it stays written, so months later the tutor is still teaching around
 * a difficulty the learner resolved in one afternoon.
 *
 * These tests pin the two mechanisms that fix that: `kind` makes a claim
 * actionable, and the contradiction path makes it removable without the learner
 * having to argue.
 */

const EVIDENCE = new Set(["E1"]);

function turnWith(diagnosis: Record<string, unknown>) {
  return {
    speech: "Let's look at that step again.",
    board_ops: [],
    evidence_refs: [],
    diagnosis: {
      misconceptions: [],
      weak_criteria: [],
      hint_dependence: "none",
      calibration: "accurate",
      ...diagnosis,
    },
  };
}

let n = 0;
function learner(): string {
  n += 1;
  return `hypothesis_learner_${n}`;
}

function evidence(overrides: Partial<LearningEvidenceInput> = {}): LearningEvidenceInput {
  return {
    skillIds: ["chain_rule"],
    taskId: `task_${Math.random().toString(36).slice(2)}`,
    taskFamily: "composite_derivative",
    contextVariant: "same",
    evidenceType: "procedure",
    response: "differentiate the outside, then multiply by the derivative of the inside",
    correctness: "correct",
    supportLevel: 0,
    hintExposure: 0,
    source: "tutor_turn",
    ...overrides,
  };
}

describe("Tutor hypothesis schema", () => {
  it("accepts a claim that names its cause and how to test it", () => {
    const res = validateTutorPayload(
      turnWith({
        hypotheses: [
          {
            kind: "misconception",
            statement: "Believes the chain rule means multiplying the two derivatives.",
            next_best_test: "Ask for d/dx sin(x^2) where the two readings disagree.",
          },
        ],
      }),
      new Set()
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.diagnosis?.hypotheses?.[0].kind).toBe("misconception");
      expect(res.value.diagnosis?.hypotheses?.[0].nextBestTest).toContain("sin(x^2)");
    }
  });

  it("rejects a claim with no way to disconfirm it", () => {
    // This is the whole guardrail. An untestable claim about a learner is a
    // label, and the model is fluent enough to produce infinitely many.
    const res = validateTutorPayload(
      turnWith({
        hypotheses: [{ kind: "misconception", statement: "Doesn't really get functions." }],
      }),
      new Set()
    );
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.errors.join(" ")).toContain("next_best_test");
    }
  });

  it("rejects a claim with an empty test string as firmly as a missing one", () => {
    const res = validateTutorPayload(
      turnWith({
        hypotheses: [
          { kind: "procedural_slip", statement: "Drops signs under time pressure.", next_best_test: "   " },
        ],
      }),
      new Set()
    );
    expect(res.ok).toBe(false);
  });

  it("rejects a cause outside the taxonomy the planner can act on", () => {
    // An unknown kind would persist as a claim no route knows how to answer,
    // which is a free-text statement wearing a struct's clothing.
    const res = validateTutorPayload(
      turnWith({
        hypotheses: [
          { kind: "just_lazy", statement: "Not trying.", next_best_test: "Watch the next attempt." },
        ],
      }),
      new Set()
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors.join(" ")).toContain("kind");
  });

  it("caps how many explanations one turn may propose", () => {
    const res = validateTutorPayload(
      turnWith({
        hypotheses: Array.from({ length: 5 }, (_, i) => ({
          kind: "misconception",
          statement: `Claim ${i}`,
          next_best_test: `Test ${i}`,
        })),
      }),
      new Set()
    );
    // A turn that proposes more explanations than it gathered observations is
    // enumerating possibilities, not diagnosing.
    expect(res.ok).toBe(false);
  });

  it("treats a turn with no hypotheses as entirely normal", () => {
    const res = validateTutorPayload(turnWith({}), new Set());
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.diagnosis?.hypotheses).toBeUndefined();
  });

  it("keeps the rest of the turn usable, and accepts the camelCase spelling", () => {
    const res = validateTutorPayload(
      {
        speech: "Noted.",
        board_ops: [],
        evidence_refs: ["E1"],
        diagnosis: {
          misconceptions: [],
          weak_criteria: [],
          hint_dependence: "none",
          calibration: "accurate",
          hypotheses: [
            {
              kind: "careless_error",
              statement: "Transcribed the coefficient wrong once.",
              nextBestTest: "Check whether the next three attempts copy correctly.",
            },
          ],
        },
      },
      EVIDENCE
    );
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.diagnosis?.hypotheses?.[0].kind).toBe("careless_error");
  });
});

describe("Persisting tutor hypotheses", () => {
  const persistent = {
    ...DEFAULT_TUTOR,
    memory: { ...DEFAULT_TUTOR.memory, mode: "persistent" as const, minimumEvidence: 1 as const },
  };

  it("enters a first observation as suspected, never as established", async () => {
    const learnerId = learner();
    await recordTutorHypotheses({
      learnerId,
      skillId: "chain_rule",
      diagnosis: {
        misconceptions: [],
        weakCriteria: [],
        hintDependence: "none",
        calibration: "accurate",
        hypotheses: [
          {
            kind: "misconception",
            statement: "Multiplies the derivatives instead of composing them.",
            nextBestTest: "Ask for d/dx sin(x^2).",
          },
        ],
      },
      preferences: persistent,
      evidenceIds: ["ev-1"],
    });

    const [hypothesis] = await getHypotheses(learnerId, "chain_rule");
    // The planner routes hard off supported claims. If one turn could assert
    // support, a model could talk itself into a diagnosis and send the learner
    // into contrast cases for a belief they never held.
    expect(hypothesis.status).toBe("suspected");
    expect(hypothesis.supportingEvidenceIds).toEqual(["ev-1"]);
  });

  it("promotes to supported only after independent observations accumulate", async () => {
    const learnerId = learner();
    const claim = {
      kind: "misconception" as const,
      statement: "Multiplies the derivatives instead of composing them.",
      nextBestTest: "Ask for d/dx sin(x^2).",
    };
    const diagnosis = {
      misconceptions: [],
      weakCriteria: [],
      hintDependence: "none" as const,
      calibration: "accurate" as const,
      hypotheses: [claim],
    };

    await recordTutorHypotheses({ learnerId, skillId: "chain_rule", diagnosis, preferences: persistent, evidenceIds: ["ev-1"] });
    await recordTutorHypotheses({ learnerId, skillId: "chain_rule", diagnosis, preferences: persistent, evidenceIds: ["ev-2"] });

    const hypotheses = await getHypotheses(learnerId, "chain_rule");
    expect(hypotheses).toHaveLength(1);
    expect(hypotheses[0].status).toBe("supported");
  });

  it("records nothing when the learner has memory turned off", async () => {
    const learnerId = learner();
    await recordTutorHypotheses({
      learnerId,
      skillId: "chain_rule",
      diagnosis: {
        misconceptions: [],
        weakCriteria: [],
        hintDependence: "none",
        calibration: "accurate",
        hypotheses: [
          { kind: "misconception", statement: "A claim.", nextBestTest: "A test." },
        ],
      },
      preferences: { ...DEFAULT_TUTOR, memory: { ...DEFAULT_TUTOR.memory, mode: "off" as const } },
      evidenceIds: [],
    });
    // A structured learner model is still a learner model. Consent that covers
    // the free-text version covers this one.
    expect(await getHypotheses(learnerId, "chain_rule")).toHaveLength(0);
  });

  it("honours the per-category consent the free-text memory honours", async () => {
    const learnerId = learner();
    await recordTutorHypotheses({
      learnerId,
      skillId: "chain_rule",
      diagnosis: {
        misconceptions: [],
        weakCriteria: [],
        hintDependence: "none",
        calibration: "accurate",
        hypotheses: [
          { kind: "misconception", statement: "A wrong belief.", nextBestTest: "A test." },
          { kind: "careless_error", statement: "A slip.", nextBestTest: "Watch the next three." },
        ],
      },
      preferences: {
        ...persistent,
        memory: { ...persistent.memory, rememberMisconceptions: false },
      },
      evidenceIds: [],
    });

    const kinds = (await getHypotheses(learnerId, "chain_rule")).map((h) => h.kind);
    expect(kinds).toContain("careless_error");
    expect(kinds).not.toContain("misconception");
  });

  it("does not fail a turn because a claim could not be stored", async () => {
    // The reply belongs to the learner; the bookkeeping does not.
    await expect(
      recordTutorHypotheses({
        learnerId: learner(),
        skillId: "chain_rule",
        diagnosis: {
          misconceptions: [],
          weakCriteria: [],
          hintDependence: "none",
          calibration: "accurate",
          hypotheses: [{ kind: "misconception", statement: "   ", nextBestTest: "   " }],
        },
        preferences: persistent,
        evidenceIds: [],
      })
    ).resolves.toBeUndefined();
  });
});

describe("The learner model shrinks on its own", () => {
  it("retires a misconception when the learner works unaided and correctly", async () => {
    const learnerId = learner();
    for (const statement of ["Multiplies the derivatives.", "Multiplies the derivatives."]) {
      await upsertHypothesis({
        learnerId,
        skillId: "chain_rule",
        kind: "misconception",
        statement,
        nextBestTest: "Ask for d/dx sin(x^2).",
        evidenceIds: [`seed-${Math.random()}`],
      });
    }
    expect((await getHypotheses(learnerId, "chain_rule"))[0].status).toBe("supported");

    await recordEvidence(evidence({ learnerId }));
    await recordEvidence(evidence({ learnerId }));

    // Two clean unaided successes are the learner's own argument. They should
    // not have to make it in words.
    expect((await getHypotheses(learnerId, "chain_rule"))[0].status).toBe("resolved");
  });

  it("does not let a hinted success retire a claim", async () => {
    const learnerId = learner();
    await upsertHypothesis({
      learnerId,
      skillId: "chain_rule",
      kind: "procedural_slip",
      statement: "Execution is unreliable under the chain rule.",
      nextBestTest: "Three unaided attempts in a row.",
    });

    await recordEvidence(evidence({ learnerId, supportLevel: 2, hintExposure: 2 }));
    await recordEvidence(evidence({ learnerId, supportLevel: 2, hintExposure: 2 }));

    // Correct-after-help is exactly the state the claim predicts. Letting it
    // clear the claim would erase the distinction the ladder is built on.
    const [hypothesis] = await getHypotheses(learnerId, "chain_rule");
    expect(hypothesis.status).not.toBe("resolved");
    expect(hypothesis.contradictingEvidenceIds).toHaveLength(0);
  });

  it("does not let success retire overconfidence", async () => {
    const learnerId = learner();
    await upsertHypothesis({
      learnerId,
      skillId: "chain_rule",
      kind: "overconfidence",
      statement: "Rates confidence well above measured performance.",
      nextBestTest: "Compare self-rating against a changed-context task.",
    });

    await recordEvidence(evidence({ learnerId }));
    await recordEvidence(evidence({ learnerId }));

    // Success is what an overconfident learner expects. Their calibration, not
    // their competence, is the open question.
    expect((await getHypotheses(learnerId, "chain_rule"))[0].status).not.toBe("resolved");
  });

  it("does not let success retire a careless-error claim", async () => {
    const learnerId = learner();
    await upsertHypothesis({
      learnerId,
      skillId: "chain_rule",
      kind: "careless_error",
      statement: "Occasionally drops a sign.",
      nextBestTest: "Count sign errors across the next five attempts.",
    });

    await recordEvidence(evidence({ learnerId }));
    await recordEvidence(evidence({ learnerId }));

    // Carelessness describes a rate, not a capability, and clean answers are
    // what a careless learner produces most of the time.
    expect((await getHypotheses(learnerId, "chain_rule"))[0].status).not.toBe("resolved");
  });

  it("retires disengagement on serious work even when the work is wrong", async () => {
    const learnerId = learner();
    await upsertHypothesis({
      learnerId,
      skillId: "chain_rule",
      kind: "disengagement",
      statement: "Responses have gone short and perfunctory.",
      nextBestTest: "Look for a response that engages with the actual question.",
    });

    const effortful = {
      correctness: "incorrect" as const,
      response:
        "I tried treating the inside as a separate function and differentiating both, but the units did not come out right",
    };
    await recordEvidence(evidence({ learnerId, ...effortful }));
    await recordEvidence(evidence({ learnerId, ...effortful }));

    // Disengagement is a claim about effort. Treating a wrong but serious
    // attempt as continued disengagement is how a struggling learner gets
    // written off.
    expect((await getHypotheses(learnerId, "chain_rule"))[0].status).toBe("resolved");
  });

  it("leaves a blank response counting as continued disengagement", async () => {
    const learnerId = learner();
    await upsertHypothesis({
      learnerId,
      skillId: "chain_rule",
      kind: "disengagement",
      statement: "Responses have gone blank.",
      nextBestTest: "Look for a response that engages with the actual question.",
    });

    await recordEvidence(evidence({ learnerId, correctness: "blank", response: "" }));
    await recordEvidence(evidence({ learnerId, correctness: "blank", response: "" }));

    expect((await getHypotheses(learnerId, "chain_rule"))[0].status).not.toBe("resolved");
  });

  it("never re-touches a claim the learner has disputed", async () => {
    const learnerId = learner();
    const hypothesis = await upsertHypothesis({
      learnerId,
      skillId: "chain_rule",
      kind: "misconception",
      statement: "Multiplies the derivatives.",
      nextBestTest: "Ask for d/dx sin(x^2).",
    });
    const { disputeHypothesis } = await import("./store");
    await disputeHypothesis(hypothesis.hypothesisId, "I have never thought that.");

    await recordEvidence(evidence({ learnerId }));

    // The learner's rejection stands on its own. Reprocessing the row would be
    // the system relitigating a claim they already threw out.
    const [stored] = await getHypotheses(learnerId, "chain_rule");
    expect(stored.status).toBe("disputed");
    expect(stored.learnerDisputed).toBe(true);
    expect(stored.contradictingEvidenceIds).toHaveLength(0);
  });

  it("only contradicts claims on the skill the evidence is actually about", async () => {
    const learnerId = learner();
    await upsertHypothesis({
      learnerId,
      skillId: "integration_by_parts",
      kind: "misconception",
      statement: "Chooses u and dv arbitrarily.",
      nextBestTest: "Ask which factor should be u and why.",
    });

    await recordEvidence(evidence({ learnerId, skillIds: ["chain_rule"] }));
    await recordEvidence(evidence({ learnerId, skillIds: ["chain_rule"] }));

    // Competence does not generalise sideways, and a model that let it would
    // clear claims the learner has never addressed.
    const [untouched] = await getHypotheses(learnerId, "integration_by_parts");
    expect(untouched.status).toBe("suspected");
    expect(untouched.contradictingEvidenceIds).toHaveLength(0);
  });
});
