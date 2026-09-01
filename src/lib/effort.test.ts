/**
 * Effort Parameter unit tests.
 *
 * Coverage:
 *  - `resolveAutoEffort` heuristic across every documented branch
 *  - `resolveEffort` resolution against explicit, undefined, and auto inputs
 *  - `effortConstraintsFor` returns the matching constraint row
 *  - `formatEffortReminder` produces a system-prompt reminder that names the
 *    effort level and the structural elements it requires
 */
import { describe, it, expect } from "vitest";

import {
  EFFORT_LEVELS,
  EFFORT_PLAN_CONSTRAINTS,
  effortConstraintsFor,
  formatEffortReminder,
  resolveAutoEffort,
  resolveEffort,
  type EffortParameter,
} from "./effort";
import type { OnboardingAnswers } from "../data/tutor";

function intake(overrides: Partial<OnboardingAnswers> = {}): OnboardingAnswers {
  return {
    concept: "limits",
    answers: [{ question: "Q", answer: "A" }],
    selfReportedFamiliarity: "shaky",
    ...overrides,
  };
}

describe("resolveAutoEffort", () => {
  it("returns 'high' when onboarding is undefined (no signal)", () => {
    expect(resolveAutoEffort(undefined, undefined)).toBe("high");
  });

  it("returns 'extra_high' for broad concept + no familiarity", () => {
    const concept = "Limits, derivatives, integrals, and their applications in physics";
    const onboarding = intake({ selfReportedFamiliarity: "new" });
    expect(resolveAutoEffort(concept, onboarding)).toBe("extra_high");
  });

  it("returns 'high' for broad concept + some familiarity", () => {
    const concept = "Limits, derivatives, integrals, and their applications in physics";
    const onboarding = intake({ selfReportedFamiliarity: "shaky" });
    expect(resolveAutoEffort(concept, onboarding)).toBe("high");
  });

  it("returns 'standard' for narrow concept + some familiarity", () => {
    const concept = "Limits";
    const onboarding = intake({ selfReportedFamiliarity: "shaky" });
    expect(resolveAutoEffort(concept, onboarding)).toBe("standard");
  });

  it("returns 'high' when familiarity is empty string (no signal)", () => {
    // Empty string is the case the heuristic was designed for: the intake
    // submitted no familiarity answer, so there is no signal to act on.
    const onboarding = intake({ selfReportedFamiliarity: "" as never });
    expect(resolveAutoEffort(undefined, onboarding)).toBe("high");
  });

  it("returns 'high' when concept is broad and onboarding includes an explicit goal", () => {
    const concept = "Limits, derivatives, integrals, and their applications in physics";
    const onboarding = intake({ selfReportedFamiliarity: "shaky", concept: "Limits" });
    // The intent of `hasGoal` is to err on the side of more depth, but it only
    // fires when no other branch matched. The broad+familiarity branch wins
    // first, so this lands on "high".
    expect(resolveAutoEffort(concept, onboarding)).toBe("high");
  });
});

describe("resolveEffort", () => {
  it("passes explicit values through unchanged", () => {
    expect(resolveEffort("standard", "limits", undefined)).toBe("standard");
    expect(resolveEffort("max", "limits", undefined)).toBe("max");
    expect(resolveEffort("high", "limits", undefined)).toBe("high");
    expect(resolveEffort("extra_high", "limits", undefined)).toBe("extra_high");
  });

  it("resolves 'auto' against concept + onboarding", () => {
    const onboarding = intake({ selfReportedFamiliarity: "shaky" });
    expect(resolveEffort("auto", "Limits", onboarding)).toBe("standard");
  });

  it("resolves undefined as 'auto'", () => {
    expect(resolveEffort(undefined, undefined, undefined)).toBe("high");
  });
});

describe("effortConstraintsFor", () => {
  it("returns the constraint row matching the requested effort", () => {
    expect(effortConstraintsFor("standard")).toBe(EFFORT_PLAN_CONSTRAINTS.standard);
    expect(effortConstraintsFor("high")).toBe(EFFORT_PLAN_CONSTRAINTS.high);
    expect(effortConstraintsFor("extra_high")).toBe(EFFORT_PLAN_CONSTRAINTS.extra_high);
    expect(effortConstraintsFor("max")).toBe(EFFORT_PLAN_CONSTRAINTS.max);
  });

  it("every effort row has a step range, a depth, and a token split summing to 1", () => {
    for (const level of ["standard", "high", "extra_high", "max"] as const) {
      const cfg = EFFORT_PLAN_CONSTRAINTS[level];
      expect(cfg.minSteps).toBeGreaterThanOrEqual(1);
      expect(cfg.maxSteps).toBeGreaterThanOrEqual(cfg.minSteps);
      expect(["surface", "medium", "deep", "exhaustive"]).toContain(cfg.curriculumDepth);
      const sum = cfg.tokenSplit.plan + cfg.tokenSplit.overview;
      expect(sum).toBeGreaterThan(0.99);
      expect(sum).toBeLessThan(1.01);
    }
  });
});

describe("formatEffortReminder", () => {
  it("names the effort level and step range for every explicit level", () => {
    for (const level of ["standard", "high", "extra_high", "max"] as const) {
      const reminder = formatEffortReminder(level);
      expect(reminder).toMatch(new RegExp(level.toUpperCase()));
      const cfg = EFFORT_PLAN_CONSTRAINTS[level];
      expect(reminder).toContain(`${cfg.minSteps}`);
      expect(reminder).toContain(`${cfg.maxSteps}`);
      expect(reminder).toContain(cfg.curriculumDepth);
    }
  });

  it("names each required structural element when its flag is on", () => {
    // "extra_high" enables every flag.
    const reminder = formatEffortReminder("extra_high");
    expect(reminder.toLowerCase()).toContain("prerequisite");
    expect(reminder.toLowerCase()).toContain("time estimate");
    expect(reminder.toLowerCase()).toContain("success criterion");
    expect(reminder.toLowerCase()).toContain("pitfall");
    expect(reminder.toLowerCase()).toContain("sub-activit");
  });

  it("does NOT name sub-activity/pitfall/etc. for 'standard' where flags are off", () => {
    const reminder = formatEffortReminder("standard");
    expect(reminder.toLowerCase()).not.toContain("prerequisite");
    expect(reminder.toLowerCase()).not.toContain("pitfall");
    expect(reminder.toLowerCase()).not.toContain("sub-activit");
  });
});

describe("EFFORT_LEVELS", () => {
  it("has five entries covering all EffortParameter ids", () => {
    const ids = EFFORT_LEVELS.map((level) => level.id);
    expect(ids).toEqual<EffortParameter[]>(["auto", "standard", "high", "extra_high", "max"]);
  });
});
