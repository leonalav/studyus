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
    expect(initial.find((record) => record.id.endsWith(":q1"))?.status).toBe("correct");

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
});
