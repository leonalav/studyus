import { describe, expect, it } from "vitest";
import {
  clampSnapshotY,
  getSnapshotVerticalRange,
  moveSnapshotY,
} from "./pastNoteSnapshot";

describe("saved chalkboard vertical camera", () => {
  it("disables movement when all content fits in the saved viewport", () => {
    expect(getSnapshotVerticalRange(400, 720, 1)).toEqual({
      top: 36,
      bottom: 36,
      scrollable: false,
    });
  });

  it("derives a bounded range from content height, viewport height, and zoom", () => {
    expect(getSnapshotVerticalRange(1_800, 720, 1)).toEqual({
      top: 36,
      bottom: -1_116,
      scrollable: true,
    });
    expect(getSnapshotVerticalRange(1_800, 720, 1.5).bottom).toBe(-2_016);
  });

  it("keeps an intentionally saved pan position reachable", () => {
    expect(getSnapshotVerticalRange(400, 720, 1, -500)).toEqual({
      top: 36,
      bottom: -500,
      scrollable: true,
    });
    expect(getSnapshotVerticalRange(400, 720, 1, 300)).toEqual({
      top: 300,
      bottom: 36,
      scrollable: true,
    });
  });

  it("clamps restored views and page movement to the first and last content", () => {
    const range = getSnapshotVerticalRange(1_800, 720, 1);
    expect(clampSnapshotY(200, range)).toBe(range.top);
    expect(clampSnapshotY(-2_000, range)).toBe(range.bottom);

    const onePageDown = moveSnapshotY(range.top, "down", range, 720);
    expect(onePageDown).toBeCloseTo(-381.6);
    expect(moveSnapshotY(range.bottom, "down", range, 720)).toBe(range.bottom);
    expect(moveSnapshotY(range.top, "up", range, 720)).toBe(range.top);
  });
});
