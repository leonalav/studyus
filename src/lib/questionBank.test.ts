import { beforeEach, describe, expect, it } from "vitest";
import { getDb, seedLegacyData } from "../db/database";
import { getCompletedQuestionBankRecords } from "./questionBank";

describe("Question bank completion boundary", () => {
  beforeEach(async () => {
    const db = await getDb();
    seedLegacyData(db);
  });

  it("returns validated stored figures for completed questions", async () => {
    const db = await getDb();
    db.run("UPDATE assessment_items SET figure_spec_json = ? WHERE id = 'q1';", [
      JSON.stringify({
        type: "equation",
        latex: "F = ma",
        variables: [{ symbol: "F", label: "force", unit: "N" }],
      }),
    ]);

    const records = await getCompletedQuestionBankRecords();
    expect(records.find((record) => record.id.endsWith(":q1"))?.figure).toMatchObject({
      type: "equation",
      latex: "F = ma",
    });
  });

  it("returns each completed-attempt item once and hides created or active attempts", async () => {
    const initial = await getCompletedQuestionBankRecords();

    // The seeded form has both a completed and an active attempt. Only the
    // completed attempt contributes its three immutable items.
    expect(initial).toHaveLength(3);
    expect(new Set(initial.map((record) => record.id)).size).toBe(3);
    expect(initial.every((record) => record.id.startsWith("attempt-legacy-1:"))).toBe(true);
    expect(initial.find((record) => record.id.endsWith(":q1"))).toMatchObject({
      status: "correct",
      format: "numeric",
    });

    const db = await getDb();
    try {
      db.run("UPDATE assessment_attempts SET status = 'created' WHERE id = 'attempt-legacy-1';");
      expect(await getCompletedQuestionBankRecords()).toEqual([]);

      db.run("UPDATE assessment_attempts SET status = 'active' WHERE id = 'attempt-legacy-1';");
      expect(await getCompletedQuestionBankRecords()).toEqual([]);
    } finally {
      db.run("UPDATE assessment_attempts SET status = 'completed' WHERE id = 'attempt-legacy-1';");
    }
  });

  it("reveals a finished grading-blocked test without treating held answers as wrong", async () => {
    const db = await getDb();
    try {
      db.run("UPDATE assessment_attempts SET status = 'grading_blocked', grading_status = 'grading_blocked' WHERE id = 'attempt-legacy-1';");
      db.run("UPDATE attempt_responses SET grading_status = 'grading_blocked' WHERE id = 'resp-legacy-q1';");

      const records = await getCompletedQuestionBankRecords();
      expect(records).toHaveLength(3);
      expect(records.find((record) => record.id.endsWith(":q1"))?.status).toBe("needs-review");
    } finally {
      db.run("UPDATE assessment_attempts SET status = 'completed', grading_status = 'graded' WHERE id = 'attempt-legacy-1';");
      db.run("UPDATE attempt_responses SET grading_status = 'graded' WHERE id = 'resp-legacy-q1';");
    }
  });

  it("does not reveal a question merely because an attempt status says completed", async () => {
    const db = await getDb();
    try {
      db.run("UPDATE assessment_attempts SET status = 'completed' WHERE id = 'attempt-active-1';");
      const records = await getCompletedQuestionBankRecords();
      expect(records).toHaveLength(3);
      expect(records.some((record) => record.id.startsWith("attempt-active-1:"))).toBe(false);
    } finally {
      db.run("UPDATE assessment_attempts SET status = 'active' WHERE id = 'attempt-active-1';");
    }
  });
});
