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
async fn render_page_range(path: String, page_start: u32, page_end: u32) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let pages = pdf_render::render_page_range(&PathBuf::from(path), page_start, page_end)?;
        Ok(pages
            .into_iter()
            .map(|bytes| base64::engine::general_purpose::STANDARD.encode(&bytes))
            .collect())
    })
    .await
    .map_err(|e| format!("async join error: {e}"))?
}

/// Extract the prose text of an inclusive, 1-based page range, one string per
/// page. Faithful math comes from `render_page_range` + the vision model; this
/// is for tutor grounding narrative where equation gaps are tolerable.
#[tauri::command]
async fn extract_text_range(path: String, page_start: u32, page_end: u32) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        pdf_render::extract_text_range(&PathBuf::from(path), page_start, page_end)
    })
    .await
    .map_err(|e| format!("async join error: {e}"))?
}

/// Persist an uploaded curriculum PDF to `<app_data>/curriculum/<name>` and
/// return its absolute path, which the frontend stores as the source's
/// `file_path`. The bytes arrive as base64 from the JS side; decoding here keeps
/// large uploads out of string escaping concerns in the IPC boundary.
#[tauri::command]
async fn save_source_pdf(
    app: tauri::AppHandle,
    name: String,
    bytes_base64: String,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(bytes_base64.trim())
            .map_err(|e| format!("could not decode PDF bytes: {e}"))?;
        let dir = app
            .path()
            .app_data_dir()
            .map_err(|e| format!("could not resolve app data dir: {e}"))?;
        storage::save_source_pdf(&dir, &name, &bytes)
    })
    .await
    .map_err(|e| format!("async join error: {e}"))?
}

/// Predetermined default API key for Studyus models. 
/// Replace this value or set the `STUDYUS_API_KEY` environment variable.
const DEFAULT_STUDYUS_API_KEY: &str = "sk-264056c1bf073233f3a282e18c133b2117c75344409a4bd91d9687d88d3d5000";

/// Custom endpoint URL redirection for the default models.
/// Change this to target your custom API endpoint (e.g., OpenAI, OpenRouter, self-hosted proxy, etc.).
const CUSTOM_ENDPOINT_URL: &str = "https://api.xah.io";

/// Model IDs mapping to redirect standard Studyus tiers to your custom models.
const CUSTOM_MODEL_TIER_1: &str = "qwen3-coder-next"; // Fastest / cheapest
const CUSTOM_MODEL_TIER_2: &str = "pthung310106/Minimax-M3";      // Balanced
const CUSTOM_MODEL_TIER_3: &str = "phatchau036/gpt-5.6-luna";     // Reasoning / heavy

/// Native transport for one OpenAI-compatible chat-completion POST.
///
/// The Tauri webview cannot `fetch` model endpoints directly (CORS), so the
/// agent runtime assembles the request body in TypeScript and posts it through
/// this command instead. `reqwest` issues a blocking request with no same-origin
/// enforcement. If the target URL contains "api.studyus.app", the native backend
/// automatically redirects the request to your CUSTOM_ENDPOINT_URL and rewrites
/// the model IDs in the body, injecting the default API key natively in Rust.
/// This prevents any custom endpoint details or keys from leaking into the compiled
/// frontend JS package.
#[tauri::command]
async fn chat_completion(
    url: String,
    api_key: Option<String>,
    body_json: String,
) -> Result<ChatCompletionResponse, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut final_url = url;
        let mut final_body = body_json;

        // Intercept requests targeting the app-provided Studyus models
        if final_url.contains("api.studyus.app") {
            // 1. Rewrite the endpoint URL to your private backend/provider endpoint
            let base = CUSTOM_ENDPOINT_URL.trim_end_matches('/');
            if base.ends_with("/chat/completions") {
                final_url = base.to_string();
            } else if base.ends_with("/v1") || base.ends_with("/v2") || base.ends_with("/v3") {
                final_url = format!("{}/chat/completions", base);
            } else {
                final_url = format!("{}/v1/chat/completions", base);
            }

            // 2. Rewrite model identifiers inside the request body
            if let Ok(mut json_val) = serde_json::from_str::<serde_json::Value>(&final_body) {
                if let Some(model) = json_val.get("model").and_then(|m| m.as_str()) {
                    let mapped = match model {
                        "studyus/tier-1" => CUSTOM_MODEL_TIER_1,
                        "studyus/tier-2" => CUSTOM_MODEL_TIER_2,
                        "studyus/tier-3" => CUSTOM_MODEL_TIER_3,
                        _ => model,
                    };
                    json_val["model"] = serde_json::Value::String(mapped.to_string());
                    if let Ok(serialized) = serde_json::to_string(&json_val) {
                        final_body = serialized;
                    }
                }
            }
        }

        // Now validate the final request body shape
        let _body: serde_json::Value = serde_json::from_str(&final_body)
            .map_err(|e| format!("invalid request body JSON: {e}"))?;

        let client = Client::builder()
            .timeout(std::time::Duration::from_secs(180))
            .build()
            .map_err(|e| format!("could not build HTTP client: {e}"))?;

        let mut req = client
            .post(&final_url)
            .header("Content-Type", "application/json")
            .header("Accept", "application/json");

        // Resolve API key securely on the native side.
        let resolved_key = if final_url.contains("api.studyus.app") || final_url.contains(CUSTOM_ENDPOINT_URL) {
            let key = api_key.clone().unwrap_or_default();
            if key.trim().is_empty() || key == "managed" {
                std::env::var("STUDYUS_API_KEY")
                    .unwrap_or_else(|_| option_env!("STUDYUS_API_KEY").unwrap_or(DEFAULT_STUDYUS_API_KEY).to_string())
            } else {
                key
            }
        } else {
            api_key.clone().unwrap_or_default()
        };

        if !resolved_key.trim().is_empty() {
            req = req.header("Authorization", format!("Bearer {}", resolved_key.trim()));
        }

        let res = req
            .body(final_body)
            .send()
            .map_err(|e| format!("transport error reaching {final_url}: {e}"))?;

        // Map the native response faithfully. No CORS, no preflight — but a network
        // failure, DNS error, or TLS problem still surfaces as a transport error.
        let status = res.status().as_u16();
        let text = res.text().unwrap_or_default();
        Ok(ChatCompletionResponse { status, body: text })
    })
    .await
    .map_err(|e| format!("async join error: {e}"))?
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
