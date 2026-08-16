import { describe, it, expect, beforeEach } from "vitest";
import { getDb, seedLegacyData } from "../db/database";
import {
  assessmentEvidenceType,
  assessmentSkillId,
  assessmentSupportLevel,
  assessmentTaskFamily,
  marksToCorrectness,
  submitAttempt,
  autosaveDraft,
  createRetakeAttempt,
  beginAttempt,
} from "./assessment";
import { getSkillEvidence, getSkillState, normalizeSkillId } from "./learning/store";

/**
 * The assessment engine and the tutor used to live in separate worlds: one
 * graded, the other taught, and neither could see what the other knew. A
 * learner could sit a test, score full marks, and be met on the next turn by a
 * tutor still treating them as someone who had demonstrated nothing.
 *
 * These tests pin the join. They care much less about arithmetic than about
 * three things that are easy to get quietly wrong:
 *
 *  1. **Nothing is invented.** An unmarkable item must never become a failure.
 *  2. **Nothing is inflated.** A hinted success must not read as independent,
 *     and picking from a list must not read as producing an answer.
 *  3. **Nothing breaks the mark.** The submitted score is the learner's
 *     contract; a bookkeeping failure downstream may never touch it.
 */

const OBJECTIVE_Q1 = normalizeSkillId("Gravitational orbits and velocity scaling");
const OBJECTIVE_Q2 = normalizeSkillId("Kepler's laws derivation");
const OBJECTIVE_Q3 = normalizeSkillId("Chain rule differentiation");

describe("Assessment → evidence ledger routing", () => {
  beforeEach(async () => {
    const db = await getDb();
    seedLegacyData(db);
  });

  describe("item classification", () => {
    it("files each item type as the cognitive act it actually demands", () => {
      // The Construct gate counts construction and procedure. If MCQ were
      // filed as either, a learner could clear a production gate by ticking
      // boxes, which is precisely the inflation the ledger exists to stop.
      expect(assessmentEvidenceType("mcq")).toBe("selection");
      expect(assessmentEvidenceType("numeric")).toBe("procedure");
      expect(assessmentEvidenceType("proof")).toBe("construction");
      expect(assessmentEvidenceType("rubric")).toBe("construction");
    });

    it("degrades an unrecognised item type to a non-committal observation", () => {
      expect(assessmentEvidenceType("interpretive_dance")).toBe("observation");
    });

    it("derives the skill from the learning objective the item was authored against", () => {
      expect(
        assessmentSkillId({
          learningObjective: "Chain rule differentiation",
          curriculumNode: "1.2",
        })
      ).toBe("chain_rule_differentiation");
    });

    it("falls back to the curriculum node rather than blurring skills together", () => {
      // Filing every objective-less item under one generic bucket would merge
      // genuinely different skills into a single state, and every number
      // derived from it would then describe nobody.
      expect(assessmentSkillId({ learningObjective: "   ", curriculumNode: "1.2" })).toBe("1.2");
      expect(assessmentSkillId({ learningObjective: "", curriculumNode: "" })).toBe("unspecified");
    });

    it("separates recognition and production families on the same skill", () => {
      // A reconstruction scheduled on the wrong family would be discharged by a
      // task that never tested what the support propped up.
      expect(assessmentTaskFamily("chain_rule", "mcq")).not.toBe(
        assessmentTaskFamily("chain_rule", "proof")
      );
      expect(assessmentTaskFamily("chain_rule", "numeric")).toBe("chain_rule:numeric");
    });
  });

  describe("support attribution", () => {
    it("treats an untaken hint as genuinely unaided", () => {
      // The learner who declines available help has demonstrated more, not
      // less. Charging them for the offer would penalise restraint.
      expect(assessmentSupportLevel("full_hints", false)).toBe(0);
      expect(assessmentSupportLevel("limited_hints", false)).toBe(0);
    });

    it("charges an objective hint as orientation, not as a worked step", () => {
      expect(assessmentSupportLevel("full_hints", true)).toBe(1);
      expect(assessmentSupportLevel("limited_hints", true)).toBe(1);
    });

    it("records no support under a no-hints policy even if a flag leaks through", () => {
      expect(assessmentSupportLevel("no_hints", true)).toBe(0);
    });
  });

  describe("partial credit", () => {
    it("keeps partial credit as its own state rather than rounding to a verdict", () => {
      // Rounding 4/6 down would route a mostly-right learner into repair;
      // rounding it up would grant independence credit for two thirds of a job.
      expect(marksToCorrectness(4, 6, false)).toBe("partial");
      expect(marksToCorrectness(6, 6, false)).toBe("correct");
      expect(marksToCorrectness(0, 6, false)).toBe("incorrect");
    });

    it("records an unattempted item as blank, never as wrong", () => {
      expect(marksToCorrectness(0, 6, true)).toBe("blank");
    });

    it("declines to judge an item worth no marks", () => {
      expect(marksToCorrectness(0, 0, false)).toBe("unknown");
    });

    it("treats over-award as correct rather than producing an impossible state", () => {
      expect(marksToCorrectness(8, 6, false)).toBe("correct");
    });
  });

  describe("submitAttempt writes to the ledger", () => {
    /**
     * Each case runs a genuinely fresh sitting.
     *
     * The seeded `attempt-legacy-1` is already `completed`, and submitting a
     * completed attempt is a no-op by design — so driving these through a
     * retake is what makes them exercise the grading path at all rather than
     * the idempotency short-circuit.
     */
    async function sit(
      answers: { itemId: string; response: string; flags?: string[] }[]
    ): Promise<string> {
      const attemptId = await createRetakeAttempt("attempt-legacy-1");
      await beginAttempt(attemptId);
      let ordinal = 1;
      for (const answer of answers) {
        await autosaveDraft(attemptId, answer.itemId, answer.response, answer.flags ?? [], ordinal);
        ordinal += 1;
      }
      await submitAttempt(attemptId);
      return attemptId;
    }

    /** Evidence produced by one specific sitting. */
    async function evidenceFor(attemptId: string, skillId: string) {
      const all = await getSkillEvidence(skillId, "default_learner");
      return all.filter((event) => event.taskId.startsWith(`${attemptId}:`));
    }

    it("routes a graded numeric item into the ledger as unaided procedure evidence", async () => {
      const attemptId = await sit([{ itemId: "q1", response: "0.5" }]);

      const events = await evidenceFor(attemptId, OBJECTIVE_Q1);
      expect(events.length).toBe(1);

      const event = events[0];
      expect(event.source).toBe("assessment");
      expect(event.evidenceType).toBe("procedure");
      expect(event.correctness).toBe("correct");
      expect(event.supportLevel).toBe(0);
      expect(event.hintExposure).toBe(0);
      expect(event.taskFamily).toBe(`${OBJECTIVE_Q1}:numeric`);
      expect(event.rubricCriterionIds).toContain("numeric_match");
    });

    it("records a wrong answer as incorrect, with the learner's actual response kept", async () => {
      const attemptId = await sit([{ itemId: "q1", response: "2" }]);

      const [event] = await evidenceFor(attemptId, OBJECTIVE_Q1);
      expect(event.correctness).toBe("incorrect");
      // A verdict nobody can audit is a verdict nobody should trust.
      expect(event.response).toBe("2");
    });

    it("records an unanswered item as blank so it never reads as a misconception", async () => {
      const attemptId = await sit([{ itemId: "q1", response: "0.5" }]);

      const [event] = await evidenceFor(attemptId, OBJECTIVE_Q3);
      expect(event.correctness).toBe("blank");
      expect(event.correctness).not.toBe("incorrect");
    });

    it("files a proof item as construction rather than as another procedure", async () => {
      const attemptId = await sit([{ itemId: "q1", response: "0.5" }]);

      const [event] = await evidenceFor(attemptId, OBJECTIVE_Q2);
      expect(event.evidenceType).toBe("construction");
      // Rubric criteria travel with the event so a later dispute can point at
      // the specific requirement that was judged unmet.
      expect(event.rubricCriterionIds).toEqual(["c1", "c2", "c3"]);
    });

    it("builds a skill state the tutor can read from a submitted attempt alone", async () => {
      await sit([{ itemId: "q1", response: "0.5" }]);

      const state = await getSkillState(OBJECTIVE_Q1, "default_learner");
      expect(state).toBeDefined();
      expect(state!.totalEvidenceCount).toBeGreaterThan(0);
      expect(state!.unaidedSuccesses).toBeGreaterThan(0);
    });

    it("keeps each skill's evidence separate rather than pooling the whole form", async () => {
      const attemptId = await sit([{ itemId: "q1", response: "0.5" }]);

      const orbits = await evidenceFor(attemptId, OBJECTIVE_Q1);
      const kepler = await evidenceFor(attemptId, OBJECTIVE_Q2);
      const chain = await evidenceFor(attemptId, OBJECTIVE_Q3);

      expect(orbits.length).toBe(1);
      expect(kepler.length).toBe(1);
      expect(chain.length).toBe(1);
      expect(orbits[0].evidenceId).not.toBe(chain[0].evidenceId);
    });

    it("gives every sitting of the same item a distinct task id", async () => {
      const first = await sit([{ itemId: "q1", response: "0.5" }]);
      const second = await sit([{ itemId: "q1", response: "0.5" }]);

      const events = [
        ...(await evidenceFor(first, OBJECTIVE_Q1)),
        ...(await evidenceFor(second, OBJECTIVE_Q1)),
      ];
      // Collapsing sittings onto one task id would make two attempts look like
      // one, and the breadth term counts distinct instances.
      expect(new Set(events.map((e) => e.taskId)).size).toBe(2);
      expect(events.every((e) => e.taskFamily === `${OBJECTIVE_Q1}:numeric`)).toBe(true);
    });

    it("charges a hinted answer against independence", async () => {
      const attemptId = await sit([{ itemId: "q1", response: "0.5", flags: ["hint_used"] }]);

      const [event] = await evidenceFor(attemptId, OBJECTIVE_Q1);
      expect(event.correctness).toBe("correct");
      // Correct-after-help is a real success and a real caveat. It is recorded
      // as both; what it may not do is mint independence.
      expect(event.supportLevel).toBe(1);
      expect(event.hintExposure).toBeGreaterThan(0);
    });

    it("does not double-write evidence when a completed attempt is submitted again", async () => {
      const attemptId = await sit([{ itemId: "q1", response: "0.5" }]);
      const before = (await evidenceFor(attemptId, OBJECTIVE_Q1)).length;

      await submitAttempt(attemptId);
      const after = (await evidenceFor(attemptId, OBJECTIVE_Q1)).length;

      // Resubmission is idempotent for the mark; it must be idempotent for the
      // ledger too, or refreshing a results page would inflate mastery.
      expect(after).toBe(before);
      expect(after).toBe(1);
    });

    it("returns the graded result unchanged alongside the ledger write", async () => {
      const attemptId = await createRetakeAttempt("attempt-legacy-1");
      await beginAttempt(attemptId);
      await autosaveDraft(attemptId, "q1", "0.5", [], 1);

      const result = await submitAttempt(attemptId);
      expect(result.status).toBe("completed");
      expect(result.aggregateScore).toBe(2);
      expect(result.questions.length).toBe(3);
    });
  });
});
