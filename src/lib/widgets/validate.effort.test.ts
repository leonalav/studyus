/**
 * Effort-aware validatePlan tests.
 *
 * Coverage:
 *  - Standard rejects a 5-step plan (above maxSteps=4)
 *  - Standard accepts a 3-step plan with no extra structural elements
 *  - Max accepts an 8-step plan
 *  - Max rejects a 7-step plan (below minSteps=8)
 *  - Max requires time estimates as the first detail of every step
 *  - Max requires success criteria as the last detail of every step
 *  - Max requires pitfalls as an intermediate detail
 *  - Max requires 2+ sub-activities per step
 */
import { describe, it, expect } from "vitest";

import { EFFORT_PLAN_CONSTRAINTS } from "../effort";
import { validatePlan } from "./validate";

function planWithSteps(count: number, stepBuilder: (index: number) => Record<string, unknown> = (i) => ({ id: `s${i + 1}`, label: `Step ${count}` })) {
  return {
    heading: "Limits",
    steps: Array.from({ length: count }, (_, i) => stepBuilder(i)),
  };
}

describe("validatePlan — effort-aware step window", () => {
  it("standard rejects a 5-step plan", () => {
    const result = validatePlan(planWithSteps(5), EFFORT_PLAN_CONSTRAINTS.standard);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toMatch(/at most 4 steps/);
  });

  it("standard accepts a 3-step plan with no extra structural elements", () => {
    const result = validatePlan(planWithSteps(3), EFFORT_PLAN_CONSTRAINTS.standard);
    expect(result.valid).toBe(true);
  });

  it("max accepts an 8-step plan", () => {
    const result = validatePlan(planWithSteps(8), EFFORT_PLAN_CONSTRAINTS.max);
    expect(result.valid).toBe(true);
  });

  it("max rejects a 7-step plan (below minSteps=8)", () => {
    const result = validatePlan(planWithSteps(7), EFFORT_PLAN_CONSTRAINTS.max);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toMatch(/at least 8 steps/);
  });

  it("max rejects a 13-step plan (above maxSteps=12)", () => {
    const result = validatePlan(planWithSteps(13), EFFORT_PLAN_CONSTRAINTS.max);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toMatch(/at most 12 steps/);
  });
});

describe("validatePlan — effort-aware structural elements at 'max'", () => {
  const cfg = EFFORT_PLAN_CONSTRAINTS.max;

  it("requires 2+ sub-activities per step when includeSubActivities is on", () => {
    const plan = {
      heading: "Limits",
      steps: [
        { id: "s1", label: "Meet the idea", details: ["only one detail"] },
      ],
    };
    const result = validatePlan(plan, cfg);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toMatch(/sub-activities/);
  });

  it("requires time estimate as first detail when includeTimeEstimates is on", () => {
    const plan = {
      heading: "Limits",
      steps: [
        { id: "s1", label: "Step one", details: ["no time here", "more stuff", "can solve X"] },
      ],
    };
    const result = validatePlan(plan, cfg);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toMatch(/time estimate/);
  });

  it("accepts a step whose first detail is a time estimate", () => {
    const plan = {
      heading: "Limits",
      steps: [
        { id: "s1", label: "Step one", details: ["~30 min", "watch out for sign errors", "can compute X"] },
      ],
    };
    const result = validatePlan(plan, cfg);
    expect(result.valid).toBe(true);
  });

  it("requires success criterion as last detail when includeSuccessCriteria is on", () => {
    const plan = {
      heading: "Limits",
      steps: [
        { id: "s1", label: "Step one", details: ["~30 min", "watch out", "an unrelated final line"] },
      ],
    };
    const result = validatePlan(plan, cfg);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toMatch(/success criterion/);
  });

  it("requires a pitfall as an intermediate detail when includePitfalls is on", () => {
    const plan = {
      heading: "Limits",
      steps: [
        { id: "s1", label: "Step one", details: ["~30 min", "ordinary detail without a warning", "can solve X"] },
      ],
    };
    const result = validatePlan(plan, cfg);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toMatch(/pitfall/);
  });
});

describe("validatePlan — flags are off at 'standard'", () => {
  it("does not require time estimates at standard", () => {
    const plan = {
      heading: "Limits",
      steps: [
        { id: "s1", label: "Step one", details: ["just one line"] },
        { id: "s2", label: "Step two", details: ["another line"] },
      ],
    };
    const result = validatePlan(plan, EFFORT_PLAN_CONSTRAINTS.standard);
    expect(result.valid).toBe(true);
  });
});
