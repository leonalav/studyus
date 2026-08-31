/**
 * Tauri / PDFium native seam.
 *
 * The desktop build (Tauri) injects `window.__TAURI_INTERNALS__` and a set of
 * Rust commands — page rasterization, text extraction, and source-PDF
 * persistence — that are unavailable in the browser single-file build. This
 * leaf module owns that boundary so both `src/api.ts` (the public facade) and
 * `src/lib/curriculum.ts` (the transcription pipeline) can call it without a
 * circular import.
 *
 * Outside Tauri every call throws `TauriUnavailableError`; callers degrade.
 */

export class TauriUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TauriUnavailableError";
  }
}

interface TauriInternals {
  invoke<T = unknown>(cmd: string, args?: Record<string, unknown>): Promise<T>;
}

export function tauriInternals(): TauriInternals | null {
  const g = globalThis as unknown as { __TAURI_INTERNALS__?: TauriInternals };
  return g.__TAURI_INTERNALS__ ?? null;
}

export function isTauriRuntime(): boolean {
  return tauriInternals() !== null;
}

/** Rasterize an inclusive, 1-based page range to base64 PNG strings. */
export async function renderPageRange(path: string, pageStart: number, pageEnd: number): Promise<string[]> {
  const t = tauriInternals();
  if (!t) {
    throw new TauriUnavailableError(
      "PDF rasterization is only available in the desktop (Tauri) build. Run `npm run tauri:dev` and vendor pdfium.dll under src-tauri/pdfium/.",
    );
  }
  return t.invoke<string[]>("render_page_range", { path, pageStart, pageEnd });
}

/** Extract prose text of an inclusive, 1-based page range, one string per page. */
export async function extractTextRange(path: string, pageStart: number, pageEnd: number): Promise<string[]> {
  const t = tauriInternals();
  if (!t) {
    throw new TauriUnavailableError(
      "PDF text extraction is only available in the desktop (Tauri) build.",
    );
  }
  return t.invoke<string[]>("extract_text_range", { path, pageStart, pageEnd });
}

/**
 * Persist an uploaded curriculum PDF to the app data directory and return its
 * absolute path (desktop only). Bytes go base64-encoded over IPC so large
 * uploads stay out of JSON string-escaping pitfalls.
 */
export async function saveSourcePdf(name: string, bytes: Uint8Array): Promise<string> {
  const t = tauriInternals();
  if (!t) {
    throw new TauriUnavailableError(
      "Saving curriculum PDFs to disk is only available in the desktop (Tauri) build.",
    );
  }
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  const b64 = btoa(binary);
  return t.invoke<string>("save_source_pdf", { name, bytesBase64: b64 });
}

/**
 * Native transport for one OpenAI-compatible chat-completion POST (desktop only).
 *
 * The webview cannot `fetch` model endpoints directly — every provider's CORS
 * policy rejects the browser origin — so the desktop build forwards the
 * assembled request body through the Rust `chat_completion` command, which
 * issues a server-side POST with `reqwest` (no same-origin enforcement). The
 * optional `apiKey` is attached as `Authorization: Bearer` only when supplied.
 *
 * Returns the HTTP status and raw response body so the caller can map it onto
 * the same typed errors the browser `fetch` path produces; this never throws
 * TauriUnavailableError because callers branch on `isTauriRuntime()` before
 * calling — but the guard is kept for defense in depth.
 */
export interface NativeChatResult {
  status: number;
  body: string;
}

export async function nativeChatCompletion(
  url: string,
  apiKey: string,
  bodyJson: string
): Promise<NativeChatResult> {
  const t = tauriInternals();
  if (!t) {
    throw new TauriUnavailableError(
      "Native model transport is only available in the desktop (Tauri) build.",
    );
  }
  return t.invoke<NativeChatResult>("chat_completion", {
    url,
    apiKey: apiKey || null,
    bodyJson,
  });
}

/**
 * Run local Granite Docling ONNX inference on a base64-encoded PNG page.
 *
 * Downloads the ONNX model files (~1.2 GB total) from HuggingFace on first call
 * and caches them under `<app_data>/granite_docling/onnx/`. No API key needed.
 */
export interface DoclingResult {
  markdown: string;
  tables: { id: string; markdown: string }[];
  warnings: string[];
}

export async function doclingExtractImage(
  base64Png: string
): Promise<DoclingResult> {
  const t = tauriInternals();
  if (!t) {
    throw new TauriUnavailableError(
      "Granite Docling ONNX inference is only available in the desktop (Tauri) build."
    );
  }
  return t.invoke<DoclingResult>("docling_extract_image", { base64Png });
}

/**
 * Extract content from a base64-encoded PNG page using a cloud vision model
 * via the existing chat_completion transport. This uses the generation-role
 * binding's vision capability, or falls back to a configurable vision endpoint.
 *
 * This is the primary extraction method when local ONNX is unavailable or
 * the user prefers cloud processing.
 */
export interface VisionExtractResult {
  markdown: string;
  tables: { id: string; html: string }[];
  warnings: string[];
}

export async function visionExtractImage(
  base64Png: string,
  visionModel?: string,
  visionEndpoint?: string
): Promise<VisionExtractResult> {
  const t = tauriInternals();
  if (!t) {
    throw new TauriUnavailableError(
      "Vision extraction is only available in the desktop (Tauri) build."
    );
  }
  return t.invoke<VisionExtractResult>("vision_extract_image", {
    base64Png,
    visionModel: visionModel ?? null,
    visionEndpoint: visionEndpoint ?? null,
  });
}

/**
 * Download and warm up the three Granite Docling ONNX model files.
 *
 * On first run this streams ~900 MB down from HuggingFace (~3-5 min on fast
 * broadband, longer on slower connections). The Rust side caches each file
 * individually under `<app_data>/granite_docling/onnx/`, so interrupted
 * downloads resume from where they left off.
 *
 * Call `doclingGetDownloadState()` while this is running (polling ~1×/s) to
 * surface progress in the Downloads modal.
 *
 * Returns the final download state once all three files are on disk and the
 * ONNX sessions have been pre-loaded. Subsequent calls to `doclingExtractImage`
 * are instant because the sessions are already hot.
 *
 * Safe to call multiple times — subsequent calls return immediately once the
 * sessions are ready.
 */
export interface DoclingDownloadState {
  /** 0.0 – 1.0 overall progress across all three files. */
  progress: number;
  /** Human-readable status string, e.g. "Downloading vision_encoder.onnx…" */
  status: string;
  bytesSoFar: number;
  bytesTotal: number;
  /** `true` once all files are on disk and sessions are pre-loaded. */
  completed: boolean;
}

export async function doclingPrepareModel(): Promise<DoclingDownloadState> {
  const t = tauriInternals();
  if (!t) {
    throw new TauriUnavailableError(
      "Granite Docling model preparation is only available in the desktop (Tauri) build."
    );
  }
  return t.invoke<DoclingDownloadState>("docling_prepare_model");
}

/**
 * Poll the current Granite Docling model download / warm-up progress.
 *
 * Use this after `doclingPrepareModel()` to update the Downloads modal UI
 * until `completed` is `true`.
 */
export async function doclingGetDownloadState(): Promise<DoclingDownloadState> {
  const t = tauriInternals();
  if (!t) {
    throw new TauriUnavailableError(
      "Granite Docling model preparation is only available in the desktop (Tauri) build."
    );
  }
  return t.invoke<DoclingDownloadState>("docling_get_download_state");
}

/**
 * Run inference on a rendered PNG page using a Hugging Face model via the
 * Inference API.  The HF_TOKEN lives in the desktop .env and is resolved
 * natively in Rust — it never appears in the frontend bundle.
 *
 * Falls back gracefully when not running under Tauri.
 */
export async function hfInference(
  model: string,
  inputs: string,
  parameters?: Record<string, unknown>,
  options?: Record<string, unknown>
): Promise<string> {
  const t = tauriInternals();
  if (!t) {
    throw new TauriUnavailableError(
      "Hugging Face inference is only available in the desktop (Tauri) build."
    );
  }
  return t.invoke<string>("hf_inference", {
    model,
    inputs,
    parameters: JSON.stringify(parameters ?? {}),
    options: JSON.stringify(options ?? {}),
  });
}
