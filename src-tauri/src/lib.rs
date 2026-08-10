//! Studyus desktop app: a thin Tauri shell over the Vite frontend that exposes
//! PDF page rasterization via PDFium, persists uploaded curriculum PDFs to the
//! app data directory, and proxies OpenAI-compatible chat-completion POSTs so
//! model calls escape the webview's CORS. Vision transcription and API-key
//! resolution run in TypeScript (`src/lib/agentRuntime.ts` /
//! `src/lib/curriculum.ts`); this crate only rasterizes pages, extracts prose,
//! stores the source PDF, and forwards the assembled request body to the model
//! endpoint — the key and body cross IPC exactly once, then leave the machine.

mod pdf_render;
mod storage;

use std::path::PathBuf;

use base64::Engine;
use reqwest::blocking::Client;
use serde::Serialize;
use tauri::Manager;

/// Rasterize an inclusive, 1-based page range of a PDF to a list of PNG byte
/// buffers, base64-encoded as strings for IPC. The frontend posts each PNG as a
/// `data:image/png;base64,...` URL to the vision model — see `src/lib/llm.ts`
/// and the lazy per-node transcribe path in `src/lib/curriculum.ts`.
#[tauri::command]
fn render_page_range(path: String, page_start: u32, page_end: u32) -> Result<Vec<String>, String> {
    let pages = pdf_render::render_page_range(&PathBuf::from(path), page_start, page_end)?;
    Ok(pages
        .into_iter()
        .map(|bytes| base64::engine::general_purpose::STANDARD.encode(&bytes))
        .collect())
}

/// Extract the prose text of an inclusive, 1-based page range, one string per
/// page. Faithful math comes from `render_page_range` + the vision model; this
/// is for tutor grounding narrative where equation gaps are tolerable.
#[tauri::command]
fn extract_text_range(path: String, page_start: u32, page_end: u32) -> Result<Vec<String>, String> {
    pdf_render::extract_text_range(&PathBuf::from(path), page_start, page_end)
}

/// Persist an uploaded curriculum PDF to `<app_data>/curriculum/<name>` and
/// return its absolute path, which the frontend stores as the source's
/// `file_path`. The bytes arrive as base64 from the JS side; decoding here keeps
/// large uploads out of string escaping concerns in the IPC boundary.
#[tauri::command]
fn save_source_pdf(
    app: tauri::AppHandle,
    name: String,
    bytes_base64: String,
) -> Result<String, String> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(bytes_base64.trim())
        .map_err(|e| format!("could not decode PDF bytes: {e}"))?;
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("could not resolve app data dir: {e}"))?;
    storage::save_source_pdf(&dir, &name, &bytes)
}

/// Native transport for one OpenAI-compatible chat-completion POST.
///
/// The Tauri webview cannot `fetch` model endpoints directly (CORS), so the
/// agent runtime assembles the request body in TypeScript and posts it through
/// this command instead. `reqwest` issues a blocking request with no same-origin
/// enforcement; the optional `api_key` is attached as `Authorization: Bearer`
/// only when supplied, and never logged. We return the HTTP status and raw
/// response body so the TS layer maps it onto the same `AgentRuntimeError`
/// classes (`http_error`, `auth`, `rate_limit`, `transport`) the browser path
/// produces, keeping error semantics identical across builds.
#[tauri::command]
fn chat_completion(
    url: String,
    api_key: Option<String>,
    body_json: String,
) -> Result<ChatCompletionResponse, String> {
    // `body_json` is the fully-built OpenAI body; parse only to validate shape,
    // forward it verbatim so the TS builder remains the single source of truth.
    let _body: serde_json::Value = serde_json::from_str(&body_json)
        .map_err(|e| format!("invalid request body JSON: {e}"))?;

    let client = Client::builder()
        .timeout(std::time::Duration::from_secs(180))
        .build()
        .map_err(|e| format!("could not build HTTP client: {e}"))?;

    let mut req = client
        .post(&url)
        .header("Content-Type", "application/json")
        .header("Accept", "application/json");
    if let Some(key) = api_key
        .as_ref()
        .map(|k| k.trim())
        .filter(|k| !k.is_empty())
    {
        req = req.header("Authorization", format!("Bearer {key}"));
    }

    let res = req
        .body(body_json)
        .send()
        .map_err(|e| format!("transport error reaching {url}: {e}"))?;

    // Map the native response faithfully. No CORS, no preflight — but a network
    // failure, DNS error, or TLS problem still surfaces as a transport error.
    let status = res.status().as_u16();
    let text = res.text().unwrap_or_default();
    Ok(ChatCompletionResponse { status, body: text })
}

#[derive(Serialize)]
struct ChatCompletionResponse {
    status: u16,
    body: String,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            render_page_range,
            extract_text_range,
            save_source_pdf,
            chat_completion
        ])
        .run(tauri::generate_context!())
        .expect("error while running Studyus");
}
