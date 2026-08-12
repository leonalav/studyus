import { describe, it, expect, beforeEach } from "vitest";
import { getDb } from "../db/database";
import {
  recordLearnerModelEntry,
  getLearnerModelEntries,
  disputeLearnerModelEntry,
  getActiveTutorContextLearnerSummary,
  recordInterventionOutcome,
  forgetLearnerModelEntry,
  clearLearnerModel,
  pruneLearnerModelEntries,
} from "./learnerModel";

describe("Learner Model & Adaptation Engine", () => {
  beforeEach(async () => {
    await getDb();
  });

  it("records entries with evidence citations and allows learner dispute", async () => {
    const entry = await recordLearnerModelEntry({
      entryKind: "misconception",
      curriculumNode: "1.1",
      statement: "Confuses orbital radius scaling with linear velocity scaling",
      evidenceRefs: ["attempt-1-q1", "resp-1-q1"],
    });

    expect(entry.evidenceRefs).toEqual(["attempt-1-q1", "resp-1-q1"]);

    let summary = await getActiveTutorContextLearnerSummary("default_learner");
    expect(summary).toContain("Confuses orbital radius scaling");

    // Learner disputes entry
    await disputeLearnerModelEntry(entry.id, "I misread the question prompt");

    const entries = await getLearnerModelEntries("default_learner");
    const disputed = entries.find((e) => e.id === entry.id);
    expect(disputed?.learnerDisputed).toBe(true);

    // Disputed entries leave active tutor context
    summary = await getActiveTutorContextLearnerSummary("default_learner");
    expect(summary).not.toContain("Confuses orbital radius scaling");
  });

  it("deduplicates observations and gives the learner granular and bulk deletion", async () => {
    const learnerId = "memory-owner-test";
    await clearLearnerModel(learnerId);
    const first = await recordLearnerModelEntry({
      learnerId,
      entryKind: "misconception",
      statement: "Treats slope as an intercept",
      evidenceRefs: ["session:a"],
    });
    const repeated = await recordLearnerModelEntry({
      learnerId,
      entryKind: "misconception",
      statement: "Treats slope as an intercept",
      evidenceRefs: ["session:b"],
    });

    expect(repeated.id).toBe(first.id);
    expect(repeated.observationCount).toBe(2);
    expect(repeated.evidenceRefs).toEqual(["session:a", "session:b"]);
    await forgetLearnerModelEntry(first.id);
    expect(await getLearnerModelEntries(learnerId)).toEqual([]);

    await recordLearnerModelEntry({
      learnerId,
      entryKind: "calibration",
      statement: "Overestimates fluency",
      evidenceRefs: ["session:c"],
    });
    await clearLearnerModel(learnerId);
    expect(await getLearnerModelEntries(learnerId)).toEqual([]);
  });

  it("prunes persistent observations outside the configured retention window", async () => {
    const learnerId = "memory-retention-test";
    await clearLearnerModel(learnerId);
    const entry = await recordLearnerModelEntry({
      learnerId,
      entryKind: "criterion_deficit",
      statement: "Needs to justify the induction step",
      evidenceRefs: ["attempt:old"],
    });
    const db = await getDb();
    db.run("UPDATE learner_model_entries SET last_observed = '2020-01-01T00:00:00.000Z' WHERE id = ?;", [entry.id]);

    await pruneLearnerModelEntries(30, learnerId);
    expect(await getLearnerModelEntries(learnerId)).toEqual([]);
  });

  it("records intervention outcomes for unassisted transfer tracking", async () => {
    await recordInterventionOutcome({
      shape: "stepped_execution",
      nodeId: "1.1",
      hintLevelReached: 2,
      transferCheckPassed: true,
      timeToUnassistedSuccessS: 120,
    });

    const db = await getDb();
    const res = db.exec("SELECT shape, transfer_check_passed FROM intervention_outcomes WHERE shape = 'stepped_execution';");
    expect(res[0].values[0][0]).toBe("stepped_execution");
    expect(res[0].values[0][1]).toBe(1);
  });
});
