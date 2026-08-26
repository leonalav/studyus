/**
 * Granite Docling curriculum extraction pipeline.
 *
 * Runs on the desktop (Tauri) build only.  The HF_TOKEN lives in .env and
 * never reaches the frontend bundle — it is resolved natively in Rust.
 *
 * Pipeline:
 *   PDF page  →  PDFium rasterisation (Rust)  →  base64 PNG
 *   PNG  →  Granite Docling vision model (HF Inference API via Rust)
 *   →  Markdown + tables
 */

import { doclingExtractImage, isTauriRuntime } from "../tauri";
import { renderPageRange } from "../tauri";

const DOCLING_MODEL = "ds4sd/granite-docling-258M";

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

  // 2. Send each page to Granite Docling on the HF Inference API
  const pages: ExtractedPage[] = [];
  const skippedPages: number[] = [];

  for (let i = 0; i < pngBuffers.length; i++) {
    const pageNumber = start + i;
    try {
      const result = await extractPageWithGraniteDocling(pngBuffers[i]);
      pages.push({ pageNumber, ...result });
    } catch (err) {
      // If the model is still loading (503), retry once after a brief wait
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("503") || msg.includes("loading")) {
        await sleep(25_000);
        try {
          const result = await extractPageWithGraniteDocling(pngBuffers[i]);
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

/** One call to Granite Docling for a single PNG buffer. */
async function extractPageWithGraniteDocling(
  base64Png: string
): Promise<Omit<ExtractedPage, "pageNumber">> {
  // HF Inference API format for vision: the "inputs" is a dict with
  // image (base64) and text (prompt). Parameters go in the "parameters" field.
  const inputs = JSON.stringify({
    image: `data:image/png;base64,${base64Png}`,
  });

  const parameters = {
    return_text: true,
    return_images: false,
    max_new_tokens: 4096,
    temperature: 0.1,
  };

  const response = await hfInference(DOCLING_MODEL, inputs, parameters);

  // The response is a JSON string produced by our Rust hf_inference command.
  // Granite Docling returns an object with a "text" field containing the markdown.
  let parsed: { text?: string };
  try {
    parsed = JSON.parse(response);
  } catch {
    parsed = { text: response };
  }

  const markdown = parsed.text ?? response;
  const { tables, cleanedMarkdown } = parseDoclingMarkdown(markdown);

  return {
    markdown: cleanedMarkdown,
    images: [],
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
