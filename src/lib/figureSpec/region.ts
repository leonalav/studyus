/**
 * The figure-region shape returned by the Rust OCR pipeline.
 *
 * `src-tauri/src/doc_extract.rs` is extended to emit a list of these
 * alongside the markdown and tables. The TS side (see `ocrInfer.ts`) reads
 * them to make a guess about what textbook figure the region encodes.
 *
 * Kept as a separate file so the import graph stays acyclic: `ocrInfer.ts`
 * imports the spec types, and `doc_extract.rs` does not need to depend on
 * the entirety of the TS type system.
 */

export type FigureRegionHint =
  | "closed-curve"
  | "unit-circle"
  | "curve"
  | "trig"
  | "theta-right"
  | "theta-up"
  | "boxes"
  | "arrows"
  | "flowchart"
  | "shaded-area"
  | "integral-region"
  | "vertical-dashed"
  | "one-sided-limit";

export interface FigureRegion {
  /** Stable id, used to anchor the spec in the lesson JSON. */
  id: string;
  /** Page index (0-based). */
  page: number;
  /** Bounding box in pixel coordinates of the rendered page, with origin at
   *  the top-left. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** The cropped image of just this region, base64-encoded PNG. The TS side
   *  can render it as a fallback if the heuristic does not match. */
  imageBase64: string;
  /** Pre-computed hints from the layout model (e.g. "closed-curve", "boxes").
   *  Inference consults these before falling back to pure geometry. */
  hints: FigureRegionHint[];
  /** Free-text label from the layout detector ("Figure 1.31", "Diagram", ...).
   *  Surface to the agent for context. */
  caption?: string;
}