export interface SnapshotVerticalRange {
  top: number;
  bottom: number;
  scrollable: boolean;
}

const SNAPSHOT_EDGE_PADDING = 36;
const SNAPSHOT_SCROLL_FRACTION = 0.58;
const MIN_SNAPSHOT_SCROLL_STEP = 140;

/** Camera bounds that expose the first and last rendered board content while
 * preserving a small chalkboard margin at both edges. Values are in the saved
 * board viewport's coordinate system, before the Past Notes preview is scaled. */
export function getSnapshotVerticalRange(
  contentHeight: number,
  viewportHeight: number,
  zoom: number,
  savedY = SNAPSHOT_EDGE_PADDING
): SnapshotVerticalRange {
  const safeContentHeight = Number.isFinite(contentHeight) ? Math.max(0, contentHeight) : 0;
  const safeViewportHeight = Number.isFinite(viewportHeight) ? Math.max(0, viewportHeight) : 0;
  const safeZoom = Number.isFinite(zoom) ? Math.max(0, zoom) : 0;
  const safeSavedY = Number.isFinite(savedY) ? savedY : SNAPSHOT_EDGE_PADDING;
  const contentTop = SNAPSHOT_EDGE_PADDING;
  const contentBottom = safeContentHeight > 0
    ? Math.min(contentTop, safeViewportHeight - safeContentHeight * safeZoom - SNAPSHOT_EDGE_PADDING)
    : contentTop;

  // Include an intentionally saved pan position in the range. The initial
  // snapshot therefore remains pixel-faithful, while the learner can still
  // navigate to both natural content edges and back again.
  const top = Math.max(contentTop, safeSavedY);
  const bottom = Math.min(contentBottom, safeSavedY);
  return { top, bottom, scrollable: bottom < top - 1 };
}

export function clampSnapshotY(y: number, range: SnapshotVerticalRange): number {
  return Math.min(range.top, Math.max(range.bottom, y));
}

export function moveSnapshotY(
  y: number,
  direction: "up" | "down",
  range: SnapshotVerticalRange,
  viewportHeight: number
): number {
  const step = Math.max(
    MIN_SNAPSHOT_SCROLL_STEP,
    Math.max(0, viewportHeight) * SNAPSHOT_SCROLL_FRACTION
  );
  return clampSnapshotY(direction === "up" ? y + step : y - step, range);
}
