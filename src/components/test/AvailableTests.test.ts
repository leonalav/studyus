import { describe, expect, it } from "vitest";
import { resolveAvailableTestStatus } from "./AvailableTests";

describe("Available test action state", () => {
  it("uses Start until learner activity exists, then Resume", () => {
    expect(resolveAvailableTestStatus("created", 0, 0)).toBe("new");
    // Compatibility for tests generated before created-state persistence.
    expect(resolveAvailableTestStatus("active", 0, 0)).toBe("new");
    expect(resolveAvailableTestStatus("active", 0, 1)).toBe("in-progress");
    expect(resolveAvailableTestStatus("active", 1, 0)).toBe("in-progress");
    expect(resolveAvailableTestStatus("completed", 1, 1)).toBe("completed");
    expect(resolveAvailableTestStatus("grading_blocked", 1, 1)).toBe("grading-blocked");
  });
});
