import { describe, it, expect, beforeEach } from "vitest";
import { getDb } from "../db/database";
import {
  recordLearnerModelEntry,
  getLearnerModelEntries,
  disputeLearnerModelEntry,
  getActiveTutorContextLearnerSummary,
  recordInterventionOutcome,
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
