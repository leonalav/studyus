/** Pure chalkboard page arithmetic.
 *
 *  Lives in lib rather than Chalkboard because preferences.ts must sanitize
 *  against the same bounds the Settings slider offers, and a preferences
 *  module must not import a component. BoardPanels and Chalkboard share these
 *  constants so the range input, the clamp, and the slice never disagree.
 *
 *  Pages are cut from the REVEALED prefix, not from board.blocks. A fixed block
 *  count (not a measured height) keeps the partition stable under zoom, widget
 *  expansion, and the 620ms reveal ticker — any of which would reflow a
 *  height-measured model while the learner is reading.
 */

export const DEFAULT_BOARD_PAGE_SIZE = 8;
export const MIN_BOARD_PAGE_SIZE = 4;
export const MAX_BOARD_PAGE_SIZE = 16;

export function clampPageSize(size: unknown): number {
  if (typeof size !== "number" || !Number.isFinite(size)) return DEFAULT_BOARD_PAGE_SIZE;
  return Math.min(MAX_BOARD_PAGE_SIZE, Math.max(MIN_BOARD_PAGE_SIZE, Math.round(size)));
}

/** How many pages the revealed prefix occupies. Empty boards are one page so
 *  the pager chrome (which renders only when pageCount > 1) stays hidden and
 *  the intentional blank chalkboard is never wrapped in "Page 1 of 1". */
export function pageCountFor(revealedCount: number, pageSize: number): number {
  const size = clampPageSize(pageSize);
  return Math.max(1, Math.ceil(Math.max(0, revealedCount) / size));
}

/** 0-based page that holds a given block index (or the page the pen is about
 *  to write onto, when the index equals the next-to-reveal position). */
export function pageIndexOf(blockIndex: number, pageSize: number): number {
  const size = clampPageSize(pageSize);
  return Math.max(0, Math.floor(Math.max(0, blockIndex) / size));
}

/** Inclusive-start exclusive-end slice of the revealed prefix for one page.
 *  The end clamp is deliberate — Array.slice tolerates over-reach, but
 *  clamping makes (end - start) a truthful "blocks on this page". */
export function pageSlice(
  revealedCount: number,
  page: number,
  pageSize: number
): { start: number; end: number } {
  const size = clampPageSize(pageSize);
  const safe = Math.max(0, revealedCount);
  const start = Math.min(Math.max(0, page) * size, safe);
  const end = Math.min(start + size, safe);
  return { start, end };
}

/* ── Annotation ink keys ──────────────────────────────────────────
 * Ink is captured in viewport coordinates, so under pagination it is
 * keyed per (board, page). Bare board ids remain the continuous-board
 * key. These helpers keep StudyRoom, Past Notes, and toggle migration
 * on one contract so enabling/disabling pagination cannot orphan strokes.
 */

/** Per-page stroke map key. */
export function boardPageInkKey(boardId: string, page: number): string {
  return `${boardId}#p${Math.max(0, Math.floor(page))}`;
}

export function isBoardPageInkKey(key: string, boardId: string): boolean {
  return key.startsWith(`${boardId}#p`) && /^#p\d+$/.test(key.slice(boardId.length));
}

/** Every stroke key that belongs to a board (bare id + `#pN` pages). */
export function boardInkKeys(strokeMap: Record<string, unknown>, boardId: string): string[] {
  const keys = Object.keys(strokeMap).filter(
    (key) => key === boardId || isBoardPageInkKey(key, boardId)
  );
  return keys.sort((a, b) => {
    if (a === boardId) return -1;
    if (b === boardId) return 1;
    return a.localeCompare(b, undefined, { numeric: true });
  });
}

/**
 * Strokes to show for a live board under the current pagination mode.
 *
 *  - paginate on, page 0: prefer `#p0`, fall back to bare id (ink drawn before
 *    pagination was enabled).
 *  - paginate on, page N>0: only that page's key (no cross-page bleed).
 *  - paginate off: prefer bare id, else `#p0` so disabling pagination does not
 *    blank a board that only ever had paged ink.
 */
export function resolveLiveBoardStrokes<T>(
  strokeMap: Record<string, T[] | undefined>,
  boardId: string,
  opts: { paginate: boolean; page: number }
): T[] {
  if (opts.paginate) {
    const pageKey = boardPageInkKey(boardId, opts.page);
    const pageStrokes = strokeMap[pageKey];
    if (pageStrokes && pageStrokes.length > 0) return pageStrokes;
    if (opts.page === 0) {
      const bare = strokeMap[boardId];
      if (bare && bare.length > 0) return bare;
    }
    return pageStrokes ?? [];
  }
  const bare = strokeMap[boardId];
  if (bare && bare.length > 0) return bare;
  const page0 = strokeMap[boardPageInkKey(boardId, 0)];
  if (page0 && page0.length > 0) return page0;
  return bare ?? [];
}

/**
 * All strokes that belong to a board, for full-board readbacks (Past Notes,
 * export). Concatenates bare + every `#pN` key so annotations survive whether
 * they were drawn with pagination on or off.
 */
export function collectBoardStrokes<T>(
  strokeMap: Record<string, T[] | undefined>,
  boardId: string
): T[] {
  const out: T[] = [];
  for (const key of boardInkKeys(strokeMap, boardId)) {
    const strokes = strokeMap[key];
    if (strokes && strokes.length > 0) out.push(...strokes);
  }
  return out;
}

/**
 * When the learner toggles pagination, copy ink across the bare ↔ `#p0`
 * boundary so the strokes that were on screen stay on screen. Later pages
 * are left under their `#pN` keys (still readable by Past Notes / re-enable).
 */
export function migrateStrokeMapForPaginationToggle<T>(
  strokeMap: Record<string, T[] | undefined>,
  boardIds: readonly string[],
  enabling: boolean
): Record<string, T[] | undefined> {
  let next: Record<string, T[] | undefined> | null = null;
  for (const boardId of boardIds) {
    const page0Key = boardPageInkKey(boardId, 0);
    if (enabling) {
      const bare = strokeMap[boardId];
      const page0 = strokeMap[page0Key];
      if (bare && bare.length > 0 && !(page0 && page0.length > 0)) {
        if (!next) next = { ...strokeMap };
        next[page0Key] = bare;
      }
    } else {
      const bare = strokeMap[boardId];
      const page0 = strokeMap[page0Key];
      if (page0 && page0.length > 0 && !(bare && bare.length > 0)) {
        if (!next) next = { ...strokeMap };
        next[boardId] = page0;
      }
    }
  }
  return next ?? strokeMap;
}
