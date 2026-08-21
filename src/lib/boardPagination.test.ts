import { describe, expect, it } from "vitest";
import {
  DEFAULT_BOARD_PAGE_SIZE,
  MAX_BOARD_PAGE_SIZE,
  MIN_BOARD_PAGE_SIZE,
  boardPageInkKey,
  clampPageSize,
  collectBoardStrokes,
  migrateStrokeMapForPaginationToggle,
  pageCountFor,
  pageIndexOf,
  pageSlice,
  resolveLiveBoardStrokes,
} from "./boardPagination";

describe("boardPagination arithmetic", () => {
  it("is lossless: the last page always ends exactly at the last revealed block", () => {
    // A page count that rounds down would make the tail of a lesson permanently
    // invisible with no error and no empty state — the learner would simply
    // never see the last few blocks the tutor drew.
    for (let size = MIN_BOARD_PAGE_SIZE; size <= MAX_BOARD_PAGE_SIZE; size += 2) {
      for (let count = 0; count <= 50; count++) {
        const pages = pageCountFor(count, size);
        expect(pageSlice(count, pages - 1, size).end).toBe(count);
      }
    }
  });

  it("treats an empty board as one page with an empty slice", () => {
    // The pager renders only when pageCount > 1, so this is what keeps an
    // untouched chalkboard a chalkboard instead of a "Page 1 of 1" chrome
    // shell over nothing.
    expect(pageCountFor(0, 8)).toBe(1);
    expect(pageSlice(0, 0, 8)).toEqual({ start: 0, end: 0 });
  });

  it("tiles the revealed prefix with no gaps and no overlaps", () => {
    // A gap here is a block that exists, was revealed, and can be reached from
    // no page at all.
    const count = 37;
    const size = 8;
    const pages = pageCountFor(count, size);
    let cursor = 0;
    for (let page = 0; page < pages; page++) {
      const slice = pageSlice(count, page, size);
      expect(slice.start).toBe(cursor);
      expect(slice.end).toBeGreaterThanOrEqual(slice.start);
      cursor = slice.end;
    }
    expect(cursor).toBe(count);
  });

  it("places the writing indicator on the page that will receive the next block", () => {
    // The pen sits at the NEXT block, not the last drawn one; off by one here
    // puts "writing…" on the page the tutor just left.
    expect(pageIndexOf(8, 8)).toBe(1);
    expect(pageSlice(20, 1, 8).start).toBe(8);
    const size = 8;
    for (let revealed = 0; revealed <= 24; revealed++) {
      const page = pageIndexOf(revealed, size);
      const slice = pageSlice(Math.max(revealed + 1, revealed), page, size);
      // The page that pageIndexOf names is the one whose range covers `revealed`
      // once that block has been (or is about to be) revealed.
      expect(slice.start).toBeLessThanOrEqual(revealed);
      if (revealed > 0 || slice.end > slice.start) {
        // For a non-empty page, the next block index lands inside or at the
        // start of the page that claims it.
        expect(page).toBe(Math.floor(revealed / size));
      }
    }
  });

  it("hardens page size against anything persisted JSON can throw at it", () => {
    // The size arrives from persisted JSON, so it can be anything; a size of 0
    // would make pageCountFor divide by zero and produce Infinity pages.
    expect(clampPageSize(Number.NaN)).toBe(DEFAULT_BOARD_PAGE_SIZE);
    expect(clampPageSize(undefined)).toBe(DEFAULT_BOARD_PAGE_SIZE);
    expect(clampPageSize("eight")).toBe(DEFAULT_BOARD_PAGE_SIZE);
    expect(clampPageSize(Number.POSITIVE_INFINITY)).toBe(DEFAULT_BOARD_PAGE_SIZE);
    expect(clampPageSize(1)).toBe(MIN_BOARD_PAGE_SIZE);
    expect(clampPageSize(999)).toBe(MAX_BOARD_PAGE_SIZE);
    expect(clampPageSize(7.4)).toBe(7);
  });
});

describe("board ink key fallback and toggle migration", () => {
  type Ink = { id: string; pts: [number, number][] };
  const stroke = (id: string): Ink[] => [{ id, pts: [[0, 0]] }];

  it("falls back from #p0 to bare id when pagination is enabled", () => {
    const map: Record<string, Ink[]> = { board: stroke("bare") };
    expect(resolveLiveBoardStrokes(map, "board", { paginate: true, page: 0 })).toEqual(stroke("bare"));
    expect(resolveLiveBoardStrokes(map, "board", { paginate: true, page: 1 })).toEqual([]);
  });

  it("falls back from bare id to #p0 when pagination is disabled", () => {
    const map: Record<string, Ink[]> = { [boardPageInkKey("board", 0)]: stroke("p0") };
    expect(resolveLiveBoardStrokes(map, "board", { paginate: false, page: 0 })).toEqual(stroke("p0"));
  });

  it("collects bare + every page key for Past Notes readback", () => {
    const map: Record<string, Ink[]> = {
      board: stroke("bare"),
      [boardPageInkKey("board", 0)]: stroke("p0"),
      [boardPageInkKey("board", 1)]: stroke("p1"),
      other: stroke("x"),
    };
    const all = collectBoardStrokes(map, "board");
    expect(all).toHaveLength(3);
    expect(all.map((s) => s.id).sort()).toEqual(["bare", "p0", "p1"]);
  });

  it("migrates bare → #p0 when enabling pagination and #p0 → bare when disabling", () => {
    const bareOnly: Record<string, Ink[]> = { board: stroke("bare") };
    const enabled = migrateStrokeMapForPaginationToggle(bareOnly, ["board"], true);
    expect(enabled[boardPageInkKey("board", 0)]).toEqual(stroke("bare"));
    expect(enabled.board).toEqual(stroke("bare"));

    const pageOnly: Record<string, Ink[]> = {
      [boardPageInkKey("board", 0)]: stroke("p0"),
      [boardPageInkKey("board", 1)]: stroke("p1"),
    };
    const disabled = migrateStrokeMapForPaginationToggle(pageOnly, ["board"], false);
    expect(disabled.board).toEqual(stroke("p0"));
    expect(disabled[boardPageInkKey("board", 1)]).toEqual(stroke("p1"));
  });
});
