/**
 * Granite Docling curriculum extraction pipeline.
 *
 * Runs on the desktop (Tauri) build only. Uses local ONNX inference via
 * the Rust backend for zero-latency, offline-capable document extraction.
 *
 * Pipeline overview (4 layers):
 *
 *   Layer 1 — PDF page rasterisation via PDFium (Rust side).
 *   Layer 2 — Single-path extraction via local oar-ocr ONNX (PP-OCR pipeline).
 *             Page-classification helpers are retained for diagnostics but no
 *             longer gate routing.
 *   Layer 3 — Markdown post-processing: tables inlined as `[Table N]` markers.
 *   Layer 4 — Formula registry extraction: deduplicated LaTeX expressions
 *             across all pages of the subsection.
 */

import { doclingExtractImage, isTauriRuntime, TauriUnavailableError } from "../tauri";
import { renderPageRange } from "../tauri";

/** A table extracted from a page during Docling OCR. */
export interface ExtractedTable {
  id: string;
  /** Markdown source for the table (preferred when present). */
  markdown?: string;
  /** HTML source for the table (PP-StructureV3 always emits HTML). */
  html: string;
}

/** An image referenced on the page (currently captured as a metadata placeholder). */
export interface ExtractedImage {
  id: string;
  caption: string;
}

/** One formula in the cross-page formula registry. */
export interface FormulaEntry {
  id: string;
  expression: string;
  isBlock: boolean;
  /** Page numbers where this expression appears (1-based). */
  pages: number[];
}

/** Result of extracting a single PDF page. */
export interface ExtractedPage {
  pageNumber: number;
  markdown: string;
  tables: ExtractedTable[];
  images: ExtractedImage[];
}

/** Classification of a page's content mix — drives the Layer 3 router. */
export type PageClassification =
  | { kind: "diagram-heavy"; imageAreaRatio: number }
  | { kind: "formula-heavy"; equationDensity: number }
  | { kind: "text-heavy"; textDensity: number }
  | { kind: "mixed"; imageAreaRatio: number; equationDensity: number; textDensity: number };

/** Result from extracting a page range. */
export interface SubsectionExtractionResult {
  pages: ExtractedPage[];
  skippedPages: number[];
  /** Cross-page deduplicated formula registry. */
  formulaRegistry: FormulaEntry[];
}

/**
 * Internal classifier output for a single page. We do not commit to a single
 * heuristic here — the page analysis is heuristic and the thresholds are
 * tunable from the test suite. The shape is stable so future pages can be
 * classified without breaking callers.
 */
export interface PageAnalysis {
  /** Fraction of the page covered by figure regions (0.0 – 1.0). */
  imageAreaRatio: number;
  /** Fraction of the page's text that is math (0.0 – 1.0). */
  equationDensity: number;
  /** Fraction of the page covered by text (0.0 – 1.0). */
  textDensity: number;
}

/**
 * Extract an inclusive page range from a curriculum PDF into structured Markdown.
 *
 * Falls back gracefully when not running under Tauri (throws TauriUnavailableError).
 *
 * @param sourceId  The saved PDF path (returned by `saveSourcePdf`).
 * @param pageRange Inclusive 1-based page range, e.g. [1, 5].
 */
export async function extractCurriculumSubsection(
  sourceId: string,
  pageRange: [number, number]
): Promise<SubsectionExtractionResult> {
  if (!isTauriRuntime()) {
    throw new TauriUnavailableError(
      "Granite Docling extraction requires the desktop (Tauri) build."
    );
  }

  const [start, end] = pageRange;
  if (start < 1 || end < start) {
    throw new Error(`Invalid page range: [${start}, ${end}]`);
  }

  // 1. Rasterise pages to base64 PNGs via Rust (pdfium)
  const pngBuffers = await renderPageRange(sourceId, start, end);
  if (pngBuffers.length === 0) {
    return { pages: [], skippedPages: [], formulaRegistry: [] };
  }

  // 2. Extract content from each page using local ONNX inference
  const pages: ExtractedPage[] = [];
  const skippedPages: number[] = [];

  for (let i = 0; i < pngBuffers.length; i++) {
    const pageNumber = start + i;
    try {
      const result = await extractSinglePage(pngBuffers[i], pageNumber);
      pages.push({ pageNumber, ...result });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Retry once on transient errors
      if (msg.includes("lock") || msg.includes("timeout") || msg.includes("503")) {
        await sleep(5000);
        try {
          const result = await extractSinglePage(pngBuffers[i], pageNumber);
          pages.push({ pageNumber, ...result });
        } catch {
          skippedPages.push(pageNumber);
        }
      } else {
        skippedPages.push(pageNumber);
      }
    }
  }

  // 3. Build the cross-page formula registry.
  const formulaRegistry = buildFormulaRegistry(pages);

  return { pages, skippedPages, formulaRegistry };
}

/**
 * Run extraction for one page via local oar-ocr ONNX.
 *
 * The page-classification functions (`analyzePageContent`, `classifyPageContent`)
 * are retained for diagnostics and logging — they no longer gate routing.
 */
async function extractSinglePage(
  base64Png: string,
  _pageNumber: number
): Promise<Omit<ExtractedPage, "pageNumber">> {
  return extractWithLocalOnnx(base64Png);
}

/** Analyse a page's content mix from the rasterised PNG alone. */
export async function analyzePageContent(base64Png: string): Promise<PageAnalysis> {
  // Decode the PNG bytes to compute pixel-level heuristics without an extra
  // round-trip to Rust. This is intentionally lightweight — the goal is a
  // coarse "diagram-heavy?" gate, not pixel-perfect segmentation.
  const dims = await imageDimensionsFromBase64(base64Png);
  if (!dims) {
    // Undecodable PNG: fall back to a text-heavy default so the local OCR
    // path runs; vision fallback is reserved for pages we *know* are
    // diagram-heavy.
    return { imageAreaRatio: 0, equationDensity: 0, textDensity: 0.5 };
  }

  const { width, height } = dims;
  const area = width * height;
  if (area === 0) {
    return { imageAreaRatio: 0, equationDensity: 0, textDensity: 0.5 };
  }

  // Heuristic: a page that is mostly white (low non-white pixel density)
  // is likely a chart, diagram, or sparse figure — bias to diagram-heavy
  // and let the vision LLM do the reading.
  const whitespaceRatio = await whitespaceRatio(base64Png, area);

  // Pages with > 60% whitespace are usually diagram-heavy (figures with
  // sparse annotations). We cannot reliably detect diagrams from pixel
  // density alone without a vision model — and that's the very thing we'd
  // route to vision anyway. We treat this as a proxy: pages where the
  // imageAreaRatio estimate is high AND whitespace is high → diagram.
  const imageAreaRatio = whitespaceRatio;
  const equationDensity = 0; // not measurable from pixels alone
  const textDensity = 1 - whitespaceRatio;

  return { imageAreaRatio, equationDensity, textDensity };
}

/**
 * Map a `PageAnalysis` to one of the routing buckets.
 *
 * Thresholds are conservative: diagram-heavy requires >40% image area to
 * avoid false positives on text pages with margin whitespace. Formula-
 * heavy is a placeholder for the future when the curriculum OCR reports
 * equation density directly.
 */
export function classifyPageContent(analysis: PageAnalysis): PageClassification {
  const { imageAreaRatio, equationDensity, textDensity } = analysis;

  if (imageAreaRatio > 0.4) {
    return { kind: "diagram-heavy", imageAreaRatio };
  }
  if (equationDensity > 0.3) {
    return { kind: "formula-heavy", equationDensity };
  }
  if (textDensity > 0.6) {
    return { kind: "text-heavy", textDensity };
  }
  return { kind: "mixed", imageAreaRatio, equationDensity, textDensity };
}

/** Local ONNX path for all pages (oar-ocr PP-OCR pipeline). */
async function extractWithLocalOnnx(
  base64Png: string
): Promise<{ markdown: string; tables: ExtractedTable[]; images: ExtractedImage[] }> {
  const result = await doclingExtractImage(base64Png);
  const { tables, cleanedMarkdown } = parseDoclingMarkdown(result.markdown, result.tables ?? []);

  return {
    markdown: cleanedMarkdown,
    images: (result.tables ?? []).map((t) => ({ id: t.id, caption: "" })),
    tables,
  };
}

/**
 * Post-process raw model output into structured page content.
 *
 * Tables are replaced with `[Table N]` markers in the markdown so the
 * downstream curriculum renderer can place them inline next to the
 * surrounding prose. The original table rows are kept in the `tables`
 * array.
 */
export function parseDoclingMarkdown(
  raw: string,
  rawTables: Array<{ id: string; markdown?: string; html: string }> = []
): {
  tables: ExtractedTable[];
  cleanedMarkdown: string;
} {
  const tables: ExtractedTable[] = [];
  const tableRegex = /(\|[^\n]+\|\n)+/g;
  let tableIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = tableRegex.exec(raw)) !== null) {
    tables.push({
      id: `table-${Date.now()}-${tableIndex++}`,
      markdown: match[0].trim(),
      html: markdownTableToHtml(match[0].trim()),
    });
  }

  let cleanedMarkdown = raw.replace(tableRegex, "").trim();

  // Insert `[Table N]` markers in reading order using the structured table
  // list returned by the Rust side when available.
  if (rawTables.length > 0) {
    rawTables.forEach((t, idx) => {
      tables.push({
        id: t.id,
        markdown: t.markdown ?? "",
        html: t.html,
      });
      cleanedMarkdown = `${cleanedMarkdown}\n\n[Table ${idx + 1}]\n`;
    });
  } else {
    // Otherwise use the regex-extracted ones.
    tables.forEach((_, idx) => {
      cleanedMarkdown = `${cleanedMarkdown}\n\n[Table ${idx + 1}]\n`;
    });
  }

  return { tables, cleanedMarkdown };
}

/** Parse the vision LLM's markdown output into the same shape as local OCR. */
export function parseVisionResult(
  markdown: string,
  rawTables: Array<{ id: string; markdown?: string; html: string }> = []
): {
  markdown: string;
  tables: ExtractedTable[];
  images: ExtractedImage[];
} {
  const { tables, cleanedMarkdown } = parseDoclingMarkdown(markdown, rawTables);
  return {
    markdown: cleanedMarkdown,
    tables,
    images: [],
  };
}

/**
 * Layer 5 — build the cross-page formula registry.
 *
 * Walks every page's markdown, extracts `$$...$$` (display) and `$...$`
 * (inline) math, and dedupes by normalised expression. Each entry records
 * which pages it appears on so a learner can ask "where is this formula?"
 * and the curriculum UI can link directly.
 */
export function buildFormulaRegistry(pages: ExtractedPage[]): FormulaEntry[] {
  const map = new Map<string, FormulaEntry>();
  for (const page of pages) {
    const expressions = extractFormulasFromMarkdown(page.markdown);
    for (const { expression, isBlock } of expressions) {
      const key = normaliseFormula(expression);
      if (!key) continue;
      const existing = map.get(key);
      if (existing) {
        if (!existing.pages.includes(page.pageNumber)) {
          existing.pages.push(page.pageNumber);
        }
      } else {
        map.set(key, {
          id: `formula-${map.size}`,
          expression: expression.trim(),
          isBlock,
          pages: [page.pageNumber],
        });
      }
    }
  }
  return Array.from(map.values());
}

/**
 * Pull every `$...$` and `$$...$$` expression out of a markdown string.
 *
 * Order is preserved. The `isBlock` flag discriminates display math from
 * inline math so the curriculum renderer can size them appropriately.
 */
export function extractFormulasFromMarkdown(markdown: string): Array<{
  expression: string;
  isBlock: boolean;
}> {
  const out: Array<{ expression: string; isBlock: boolean }> = [];

  // Block: $$...$$ (may span lines)
  const blockRegex = /\$\$([\s\S]+?)\$\$/g;
  let match: RegExpExecArray | null;
  while ((match = blockRegex.exec(markdown)) !== null) {
    const expr = match[1].trim();
    if (expr) out.push({ expression: expr, isBlock: true });
  }

  // Inline: $...$ (must not be preceded by another $)
  const inlineRegex = /(^|[^$])\$([^$\n]+?)\$(?!\$)/g;
  while ((match = inlineRegex.exec(markdown)) !== null) {
    const expr = match[2].trim();
    if (expr && !expr.includes("\n")) {
      out.push({ expression: expr, isBlock: false });
    }
  }

  return out;
}

/**
 * Normalise a LaTeX expression for registry deduplication.
 *
 * Strips whitespace and forces a canonical bracket/quote form so the same
 * formula in two slightly-different renderings still collapses to one entry.
 */
export function normaliseFormula(expression: string): string {
  return expression
    .replace(/\s+/g, "")
    .replace(/\\left/g, "")
    .replace(/\\right/g, "")
    .replace(/\\!/g, "")
    .toLowerCase();
}

function markdownTableToHtml(table: string): string {
  const rows = table.split("\n").filter(Boolean);
  if (rows.length < 2) return `<table>${rows.map(rowHtmlCell).join("")}</table>`;
  const header = rows[0];
  const body = rows.slice(2);
  const headerCells = splitRow(header).map((c) => `<th>${escapeHtml(c)}</th>`).join("");
  const bodyRows = body
    .map((row) => `<tr>${splitRow(row).map((c) => `<td>${escapeHtml(c)}</td>`).join("")}</tr>`)
    .join("");
  return `<table><thead><tr>${headerCells}</tr></thead><tbody>${bodyRows}</tbody></table>`;
}

function rowHtmlCell(row: string): string {
  return `<tr>${splitRow(row).map((c) => `<td>${escapeHtml(c)}</td>`).join("")}</tr>`;
}

function splitRow(row: string): string[] {
  // Pipe-delimited, trimming leading/trailing pipes and whitespace.
  return row
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Decode a base64 PNG and return its width/height in pixels.
 *
 * Reads only the PNG IHDR chunk — we never materialise the full decoded
 * bitmap (we just need the dimensions to size the analysis pass).
 */
async function imageDimensionsFromBase64(
  b64: string
): Promise<{ width: number; height: number } | null> {
  try {
    const bytes = base64ToBytes(b64);
    if (bytes.length < 24) return null;
    // PNG signature is 8 bytes; IHDR follows with 4 length + 4 type + 13 data.
    // Width is at offset 16, height at offset 20 (big-endian uint32).
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const width = view.getUint32(16);
    const height = view.getUint32(20);
    return { width, height };
  } catch {
    return null;
  }
}

/**
 * Estimate the fraction of a page that is whitespace.
 *
 * Cheap O(N) pixel sample: read the IDAT-decoded bitmap, count pixels
 * whose luminance > 245, divide by total. Diagram-heavy pages have lots of
 * whitespace; text pages have < 30%.
 */
async function whitespaceRatio(b64: string, area: number): Promise<number> {
  try {
    // We deliberately don't decode the full PNG here — that would require
    // pulling in a PNG decoder dependency in the renderer. The decode happens
    // on the Rust side at PNG-write time. For our heuristic we rely on the
    // page-rendering output's text density proxy: we know the page is a PDF
    // page, and PDF pages with figures typically render with white margins.
    //
    // Without the bitmap available, we default to "not whitespace-heavy",
    // which means we'll route most pages to the local OCR (cheaper). Only
    // pages flagged by the Rust side as image-heavy (e.g., diagrams) flip
    // the heuristic. That flipping is left for future work; for now the
    // heuristic returns 0 to mean "not obviously diagram-heavy".
    return 0;
  } catch {
    return 0;
  }
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
