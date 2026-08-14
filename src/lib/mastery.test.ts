import { describe, it, expect } from "vitest";
import {
  MASTERY_STAGES,
  MASTERY_STAGE_SPECS,
  MASTERY_THRESHOLD,
  assessMastery,
  applyRetrievalOutcome,
  formatEvidenceTable,
  isMasteryStage,
  isWidgetInStageVocabulary,
  nextStage,
  previousStage,
  retentionState,
  retrievalIntervalDays,
  stagesForWidget,
} from "./mastery";

/**
 * The Mastery Gate is the part of the system the model is not allowed to argue
 * with. These tests pin the two rules that make it meaningful: mastery is a
 * conjunction across five dimensions (never an average, never a raw score), and
 * mastery decays (a failed retrieval routes back through repair).
 */

const strong = { recall: 92, understanding: 90, procedure: 95, transfer: 88, independence: 90 };

describe("the six-stage ladder", () => {
  it("runs Encounter → Master with each stage carrying an exit condition", () => {
    expect(MASTERY_STAGES).toEqual(["encounter", "understand", "construct", "apply", "transfer", "master"]);
    for (const stage of MASTERY_STAGES) {
      const spec = MASTERY_STAGE_SPECS[stage];
      expect(spec.exitCondition.length).toBeGreaterThan(10);
      expect(spec.widgets.length).toBeGreaterThan(0);
      expect(spec.agentRole).toBeTruthy();
      expect(spec.studentRole).toBeTruthy();
    }
  });

  it("navigates forward and backward, because regression is a legal move", () => {
    expect(nextStage("encounter")).toBe("understand");
    expect(nextStage("master")).toBeNull();
    expect(previousStage("apply")).toBe("construct");
    expect(previousStage("encounter")).toBeNull();
  });

  it("maps widgets to the stages they belong to", () => {
    expect(stagesForWidget("roadmap")).toContain("encounter");
    expect(stagesForWidget("challenge")).toEqual(expect.arrayContaining(["apply", "transfer"]));
    expect(stagesForWidget("mastery_card")).toEqual(["master"]);
    expect(isWidgetInStageVocabulary("scratchpad", "construct")).toBe(true);
    expect(isWidgetInStageVocabulary("mastery_card", "encounter")).toBe(false);
  });

  it("recognizes only real stage names off the wire", () => {
    expect(isMasteryStage("transfer")).toBe(true);
    expect(isMasteryStage("finished")).toBe(false);
    expect(isMasteryStage(3)).toBe(false);
  });
});

describe("the mastery gate", () => {
  it("requires every dimension to clear the threshold", () => {
    const assessment = assessMastery(strong);
    expect(assessment.mastered).toBe(true);
    expect(assessment.verdict).toBe("mastered");
    expect(assessment.unmetDimensions).toEqual([]);
  });

  it("refuses mastery on a strong average with one weak dimension", () => {
    // This is the exact claim the gate exists to refuse: a learner averaging
    // well above the threshold who cannot transfer the idea is not masterful.
    const lopsided = { recall: 100, understanding: 100, procedure: 100, transfer: 40, independence: 100 };
    const assessment = assessMastery(lopsided);
    expect(assessment.average).toBeGreaterThan(MASTERY_THRESHOLD);
    expect(assessment.mastered).toBe(false);
    expect(assessment.weakestLink).toBe("transfer");
    expect(assessment.verdict).toBe("needs_repair");
    expect(assessment.summary).toMatch(/not yet/i);
  });

  it("names the weakest link even when the verdict is mastered", () => {
    const assessment = assessMastery({ ...strong, transfer: 86 });
    expect(assessment.mastered).toBe(true);
    expect(assessment.weakestLink).toBe("transfer");
    expect(assessment.summary).toMatch(/transfer/i);
  });

  it("distinguishes 'not yet' from 'needs repair'", () => {
    expect(assessMastery({ ...strong, transfer: 75 }).verdict).toBe("not_yet");
    expect(assessMastery({ ...strong, transfer: 30 }).verdict).toBe("needs_repair");
  });

  it("clamps nonsense scores instead of trusting the model's arithmetic", () => {
    const assessment = assessMastery({ recall: 400, understanding: -50, procedure: 90, transfer: 90, independence: 90 });
    expect(assessment.mastered).toBe(false);
    expect(assessment.weakestLink).toBe("understanding");
    expect(assessment.average).toBeLessThanOrEqual(100);
  });

  it("renders an evidence table rather than a single percentage", () => {
    const table = formatEvidenceTable({ ...strong, transfer: 55 });
    for (const label of ["Recall", "Understanding", "Procedure", "Transfer", "Independence"]) {
      expect(table).toContain(label);
    }
    expect(table).toMatch(/MASTERED: Not yet/);
    expect(table).toMatch(/Weakest link: Transfer/);
  });
});

describe("forgetting and repair", () => {
  it("spaces retrieval further apart after each success", () => {
    const first = retrievalIntervalDays(0);
    const later = retrievalIntervalDays(3);
    expect(later).toBeGreaterThan(first);
    // The schedule saturates rather than running away.
    expect(retrievalIntervalDays(99)).toBe(retrievalIntervalDays(5));
  });

  it("classifies retention relative to the due date", () => {
    const now = new Date("2026-08-13T00:00:00Z");
    const inDays = (days: number) => new Date(now.getTime() + days * 86_400_000);
    expect(retentionState(inDays(10), now)).toBe("fresh");
    expect(retentionState(inDays(1), now)).toBe("due_soon");
    expect(retentionState(inDays(-1), now)).toBe("due");
    expect(retentionState(inDays(-30), now)).toBe("overdue");
  });

  it("sends a failed retrieval on a mastered concept back for targeted repair", () => {
    const result = applyRetrievalOutcome({ stage: "master", successfulRetrievals: 3 }, false);
    expect(result.repairTriggered).toBe(true);
    // Back to Understand — not back to the very beginning. The learner has not
    // lost the encounter, only the mental model.
    expect(result.stage).toBe("understand");
    expect(result.successfulRetrievals).toBe(0);
  });

  it("keeps a passed retrieval in place and extends the interval", () => {
    const result = applyRetrievalOutcome({ stage: "master", successfulRetrievals: 1 }, true);
    expect(result.repairTriggered).toBe(false);
    expect(result.stage).toBe("master");
    expect(result.successfulRetrievals).toBe(2);
  });
});
