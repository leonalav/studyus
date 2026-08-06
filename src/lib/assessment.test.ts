import { describe, it, expect, beforeEach } from "vitest";
import { getDb, runExec } from "../db/database";
import {
  parseRationalNumber,
  gradeNumericResponse,
  getAttemptForTaking,
  autosaveDraft,
  submitAttempt,
  applyScoreOverride,
  TypedNumericAnswerSpec,
} from "./assessment";

describe("Assessment & Numeric Grader Engine", () => {
  beforeEach(async () => {
    // initialize db
    await getDb();
  });

  describe("Numeric Normalization & Equivalence", () => {
    it("parses integers, decimals, trailing zeros, fractions, and negative values", () => {
      expect(parseRationalNumber("0")).toBe(0);
      expect(parseRationalNumber("10")).toBe(10);
      expect(parseRationalNumber("100")).toBe(100);
      expect(parseRationalNumber("1.0")).toBe(1.0);
      expect(parseRationalNumber("1.00")).toBe(1.0);
      expect(parseRationalNumber("-5.2")).toBe(-5.2);
      expect(parseRationalNumber("1/2")).toBe(0.5);
      expect(parseRationalNumber("2/4")).toBe(0.5);
      expect(parseRationalNumber("-3/4")).toBe(-0.75);
    });

    it("rejects malformed and non-finite values", () => {
      expect(parseRationalNumber("abc")).toBeNull();
      expect(parseRationalNumber("1/0")).toBeNull();
      expect(parseRationalNumber("1.2.3")).toBeNull();
      expect(parseRationalNumber("")).toBeNull();
    });

    it("ensures '10' never grades as '1' and '0' never normalizes to empty", () => {
      const spec: TypedNumericAnswerSpec = {
        version: 1,
        type: "numeric",
        accepted: [{ value: "10", absolute_tolerance: "0" }],
      };

      expect(gradeNumericResponse("10", spec).pass).toBe(true);
      expect(gradeNumericResponse("1", spec).pass).toBe(false);
      expect(gradeNumericResponse("0", spec).pass).toBe(false);

      const zeroSpec: TypedNumericAnswerSpec = {
        version: 1,
        type: "numeric",
        accepted: [{ value: "0", absolute_tolerance: "0" }],
      };
      expect(gradeNumericResponse("0", zeroSpec).pass).toBe(true);
      expect(gradeNumericResponse("", zeroSpec).pass).toBe(false);
    });

    it("respects absolute and relative tolerances", () => {
      const spec: TypedNumericAnswerSpec = {
        version: 1,
        type: "numeric",
        accepted: [{ value: "10.0", absolute_tolerance: "0.2" }],
      };

      expect(gradeNumericResponse("10.15", spec).pass).toBe(true);
      expect(gradeNumericResponse("9.85", spec).pass).toBe(true);
      expect(gradeNumericResponse("10.3", spec).pass).toBe(false);
    });
  });

  describe("Attempt State Machine & Idempotency", () => {
    it("restores draft responses and flags on reload", async () => {
      const dto1 = await getAttemptForTaking("attempt-active-1");
      expect(dto1).not.toBeNull();

      // Autosave a draft
      const saveRes = await autosaveDraft("attempt-active-1", "q1", "0.5", ["flagged"], 1);
      expect(saveRes.success).toBe(true);

      const dto2 = await getAttemptForTaking("attempt-active-1");
      const q1 = dto2?.questions.find((q) => q.id === "q1");
      expect(q1?.draftResponse).toBe("0.5");
      expect(q1?.flags).toEqual(["flagged"]);
    });

    it("submits attempt idempotently without duplicates", async () => {
      const res1 = await submitAttempt("attempt-legacy-1");
      expect(res1.status).toBe("completed");

      const res2 = await submitAttempt("attempt-legacy-1");
      expect(res2.status).toBe("completed");
      expect(res2.aggregateScore).toBe(res1.aggregateScore);
    });

    it("applies score override transactionally and recomputes total", async () => {
      const initial = await submitAttempt("attempt-legacy-1");

      const overrideRes = await applyScoreOverride({
        attemptId: "attempt-legacy-1",
        responseId: "resp-legacy-q1",
        criterionId: "numeric_match",
        adjustedMark: 1.0,
        reason: "Partial credit given",
        operator: "instructor",
      });

      expect(overrideRes.questions[0].criteria[0].awardedMark).toBe(1.0);
      expect(overrideRes.questions[0].criteria[0].isOverridden).toBe(true);
    });
  });
});
