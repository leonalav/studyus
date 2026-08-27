/**
 * Granite Docling curriculum extraction pipeline.
 *
 * Runs on the desktop (Tauri) build only. Uses local ONNX inference via
 * the Rust backend for zero-latency, offline-capable document extraction.
 *
 * Pipeline:
 *   PDF page  →  PDFium rasterisation (Rust)  →  base64 PNG
 *   PNG  →  Granite Docling ONNX models (local CPU via ONNX Runtime)
 *   →  Markdown + tables
 */

import { doclingExtractImage, isTauriRuntime, TauriUnavailableError } from "../tauri";
import { renderPageRange } from "../tauri";

/** A table extracted from a page during Docling OCR. */
export interface ExtractedPage {
  pageNumber: number;
  markdown: string;
  tables: Array<{ id: string; markdown: string }>;
  images: Array<{ id: string; caption: string }>;
}

/** Result from extracting a page range. */
export interface SubsectionExtractionResult {
  pages: ExtractedPage[];
  skippedPages: number[];
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
    return { pages: [], skippedPages: [] };
  }

  // 2. Extract content from each page using local ONNX inference
  const pages: ExtractedPage[] = [];
  const skippedPages: number[] = [];

  for (let i = 0; i < pngBuffers.length; i++) {
    const pageNumber = start + i;
    try {
      const result = await extractPageWithLocalOnnx(pngBuffers[i]);
      pages.push({ pageNumber, ...result });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Retry once on transient errors
      if (msg.includes("lock") || msg.includes("timeout") || msg.includes("503")) {
        await sleep(5000);
        try {
          const result = await extractPageWithLocalOnnx(pngBuffers[i]);
          pages.push({ pageNumber, ...result });
        } catch {
          skippedPages.push(pageNumber);
        }
      } else {
        skippedPages.push(pageNumber);
      }
    }
  }

  return { pages, skippedPages };
}

/** One call to local ONNX inference for a single PNG buffer. */
async function extractPageWithLocalOnnx(
  base64Png: string
): Promise<Omit<ExtractedPage, "pageNumber">> {
  // Call the Rust backend which runs local ONNX inference
  const result = await doclingExtractImage(base64Png);

  const { tables, cleanedMarkdown } = parseDoclingMarkdown(result.markdown);

  return {
    markdown: cleanedMarkdown,
    images: result.tables.map((t) => ({ id: t.id, caption: "" })),
    tables,
  };
}

/**
 * Post-process raw model output into structured page content.
 * Extracts table blocks and returns clean markdown.
 */
function parseDoclingMarkdown(raw: string): {
  tables: ExtractedPage["tables"];
  cleanedMarkdown: string;
} {
  const tables: ExtractedPage["tables"] = [];
  const tableRegex = /(\|[^\n]+\|\n)+/g;
  let tableIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = tableRegex.exec(raw)) !== null) {
    tables.push({
      id: `table-${Date.now()}-${tableIndex++}`,
      markdown: match[0].trim(),
    });
  }

  const cleanedMarkdown = raw.replace(tableRegex, "").trim();
  return { tables, cleanedMarkdown };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
