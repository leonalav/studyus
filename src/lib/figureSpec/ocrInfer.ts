/**
 * OCR → figureSpec inference.
 *
 * The Rust pipeline in `src-tauri/src/doc_extract.rs` already returns table
 * HTML, formula LaTeX and the markdown body. We extend it with
 * `FigureRegion { x, y, w, h, page, imageBase64, hint }` so the TS side has
 * the geometry it needs to make a guess.
 *
 * The inference here is *geometry-first* and *deliberately heuristic* — not a
 * vision model. The agent always reviews the inference and can rewrite the
 * spec. The point is to give the agent a head start (it edits a guess rather
 * than authoring from scratch) and to give a degraded-but-useful figure to
 * learners when the agent does not bother to rewrite.
 *
 * Heuristics, in order:
 *   1. Bounding box roughly square + hint "closed-curve + axis"            → unitCircle
 *   2. Tall region + hint "curve"                                            → trigGraph (sin default)
 *   3. Box-with-arrows hint + multiple boxes                                 → flowchart
 *   4. Hint "shaded area" or "curve + filled region"                         → shadedArea
 *   5. Hint "vertical dashed line"                                           → limitGraph
 *   6. Anything else                                                         → coordinatePlane (no points, just frame)
 *
 * Every branch returns `null` when the inference lacks confidence — the
 * caller is expected to skip the figure in that case and let the agent
 * generate it itself.
 */

import type { FigureRegion, FigureRegionHint } from "./region";
import type { FigureSpec } from "./types";

/** Tolerance when comparing ratios to 1.0 (square-ish regions). */
const SQUARE_TOL = 0.18;
/** Minimum region height for "tall" trig-graph regions, in pixels. */
const MIN_TRIG_HEIGHT = 60;

export type FigureRegionHints = readonly FigureRegionHint[];

export interface InferenceResult {
  /** The best-guess figure spec, or `null` when no heuristic matched with
   *  enough confidence to commit. */
  spec: FigureSpec | null;
  /** Confidence in [0, 1]. Caller may surface this to the agent. */
  confidence: number;
  /** Free-text reason, useful for logging and for the agent's review UI. */
  reason: string;
}

export function inferFigureSpec(
  region: FigureRegion,
  hints: FigureRegionHints = []
): InferenceResult {
  const aspect = region.w / Math.max(1, region.h);
  const tags = new Set(hints);

  // 1. Square-ish region + closed-curve hint → unit circle.
  if (Math.abs(aspect - 1) < SQUARE_TOL && (tags.has("closed-curve") || tags.has("unit-circle"))) {
    const theta = tags.has("theta-right") ? Math.PI / 6 : tags.has("theta-up") ? Math.PI / 2 : Math.PI / 4;
    return {
      spec: {
        kind: "unitCircle",
        theta,
        showRadius: true,
        showSin: true,
        showCos: true,
        showTan: false,
        showLabels: true,
        domainX: [-1.4, 1.4],
        domainY: [-1.4, 1.4],
      },
      confidence: 0.65,
      reason: "square region + closed-curve hint",
    };
  }

  // 2. Tall region + curve hint → trig graph (default sin).
  if (region.h > MIN_TRIG_HEIGHT && aspect < 0.9 && (tags.has("curve") || tags.has("trig"))) {
    return {
      spec: {
        kind: "trigGraph",
        function: "sin",
        domainX: [-Math.PI * 2, Math.PI * 2],
        showKeyPoints: true,
        showLabels: true,
      },
      confidence: 0.5,
      reason: "tall region + curve hint",
    };
  }

  // 3. Box-with-arrows hint + multiple boxes → flowchart.
  if (tags.has("flowchart") || (tags.has("arrows") && tags.has("boxes"))) {
    return {
      spec: {
        kind: "flowchart",
        nodes: [],
        edges: [],
        showLabels: true,
      },
      confidence: 0.4,
      reason: "flowchart hint",
    };
  }

  // 4. Shaded region hint → shaded area.
  if (tags.has("shaded-area") || tags.has("integral-region")) {
    return {
      spec: {
        kind: "shadedArea",
        fLatex: "x",
        fromX: 0,
        toX: 1,
        showLabels: true,
      },
      confidence: 0.4,
      reason: "shaded region hint",
    };
  }

  // 5. Vertical dashed line → limit graph.
  if (tags.has("vertical-dashed") || tags.has("one-sided-limit")) {
    return {
      spec: {
        kind: "limitGraph",
        fLatex: "x",
        limitPoint: 0,
        leftArrow: true,
        rightArrow: true,
        showLabels: true,
      },
      confidence: 0.4,
      reason: "vertical dashed line hint",
    };
  }

  return { spec: null, confidence: 0, reason: "no heuristic matched" };
}