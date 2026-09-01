import { describe, it, expect } from "vitest";
import { createLessonStep, type LessonStepInput } from "./lessonStep";
import { isSupportLevel } from "./learning/types";

/**
 * The five invariants in `createLessonStep` are the only rules the harness
 * used to enforce via an order-sensitive chain of eight enforcers. Pin them
 * here so the constructor cannot quietly regress: the lesson step is the
 * single source of truth, and a step that slips through with the wrong shape
 * is exactly the failure the cleanup was meant to remove.
 */

function minimalInput(overrides: Partial<LessonStepInput> = {}): LessonStepInput {
  return {
    route: "guided_retry",
    targetSkillIds: ["chain_rule"],
    stage: "construct",
    mode: "guided_practice",
    supportCeiling: 2,
    requiredEvidence: ["construction", "procedure"],
    permittedWidgetKinds: ["hint", "scratchpad"],
    proseSlots: [{ blockId: "slot-1", hint: "Lead the learner to the next step.", tone: "concise" }],
    maxBoardOps: 3,
    ...overrides,
  };
}

describe("createLessonStep", () => {
  it("accepts a happy-path input and freezes it", () => {
    const step = createLessonStep(minimalInput());
    expect(step.route).toBe("guided_retry");
    expect(step.stage).toBe("construct");
    expect(step.contextVariant).toBe("same");
    expect(step.maxBoardOps).toBe(3);
    expect(Object.isFrozen(step)).toBe(true);
    expect(step.proseSlots.every((slot) => Object.isFrozen(slot))).toBe(true);
  });

  it("rejects an empty permittedWidgetKinds list", () => {
    expect(() => createLessonStep(minimalInput({ permittedWidgetKinds: [] }))).toThrow(
      /unservable.*permitted widget kind/i
    );
  });

  it("rejects direct_instruction with zero prose slots", () => {
    expect(() =>
      createLessonStep(
        minimalInput({
          route: "direct_instruction",
          permittedWidgetKinds: ["concept_card", "example"],
          proseSlots: [],
        })
      )
    ).toThrow(/unservable.*direct_instruction.*prose slot/i);
  });

  it("rejects a retrieval whose support ceiling is above zero", () => {
    expect(() =>
      createLessonStep(
        minimalInput({
          mode: "retrieval",
          permittedWidgetKinds: ["retrieval_check"],
          supportCeiling: 1,
        })
      )
    ).toThrow(/unservable.*retrieval must be unaided/i);
  });

  it("clamps maxBoardOps up to 12 and down to 1", () => {
    const upper = createLessonStep(minimalInput({ maxBoardOps: 99 }));
    expect(upper.maxBoardOps).toBe(12);
    const lower = createLessonStep(minimalInput({ maxBoardOps: 0 }));
    expect(lower.maxBoardOps).toBe(1);
    const negative = createLessonStep(minimalInput({ maxBoardOps: -7 }));
    expect(negative.maxBoardOps).toBe(1);
  });

  it("defaults contextVariant to 'same' when omitted", () => {
    const step = createLessonStep(minimalInput());
    expect(step.contextVariant).toBe("same");
  });

  it("accepts a retrieval with a zero support ceiling", () => {
    // The opposite of the rejection case: a retrieval at ceiling 0 is the
    // exact path the planner wants for a measurable check.
    const step = createLessonStep(
      minimalInput({
        route: "due_retrieval",
        permittedWidgetKinds: ["retrieval_check"],
        supportCeiling: 0,
        proseSlots: [{ blockId: "slot-1", hint: "Surface the due retrieval.", tone: "concise" }],
      })
    );
    expect(isSupportLevel(step.supportCeiling)).toBe(true);
    expect(step.supportCeiling).toBe(0);
  });

  it("preserves requiredVisualizationKind and corpusRef when supplied", () => {
    const step = createLessonStep(
      minimalInput({
        requiredVisualizationKind: "function",
        corpusRef: "limits.intro#main",
      })
    );
    expect(step.requiredVisualizationKind).toBe("function");
    expect(step.corpusRef).toBe("limits.intro#main");
  });

  it("returns undefined optional fields when omitted", () => {
    const step = createLessonStep(minimalInput());
    expect(step.requiredVisualizationKind).toBeUndefined();
    expect(step.corpusRef).toBeUndefined();
  });

  it("rejects a prose slot with an unknown tone", () => {
    expect(() =>
      createLessonStep(
        minimalInput({
          proseSlots: [{ blockId: "slot-1", hint: "x", tone: "mystery" as never }],
        })
      )
    ).toThrow(/unservable.*prose tone/i);
  });
});