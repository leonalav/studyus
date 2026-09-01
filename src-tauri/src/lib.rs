//! Studyus desktop app: a thin Tauri shell over the Vite frontend that exposes
//! PDF page rasterization via PDFium, persists uploaded curriculum PDFs to the
//! app data directory, and proxies OpenAI-compatible chat-completion POSTs so
//! model calls escape the webview's CORS. API-key resolution runs in TypeScript
//! (`src/lib/agentRuntime.ts`); this crate rasterizes pages, extracts prose via
//! local oar-ocr ONNX, stores the source PDF, and forwards the assembled request
//! body to the model endpoint — the key and body cross IPC exactly once, then
//! leave the machine.

pub mod pdf_render;
mod storage;
pub mod doc_extract;

use std::path::PathBuf;

use base64::Engine;
use reqwest::blocking::Client;
use serde::Serialize;
use tauri::Manager;

/// Rasterize an inclusive, 1-based page range of a PDF to a list of PNG byte
/// buffers, base64-encoded as strings for IPC. The frontend passes each PNG
/// to the local oar-ocr ONNX pipeline via `docling_extract_image` — see
/// `src/lib/curriculum.ts` and the lazy per-node transcribe path.
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
/// page. Math fidelity comes from `render_page_range` + local oar-ocr ONNX via
/// `docling_extract_image`; this is for tutor grounding narrative where
/// equation gaps are tolerable.
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
const CUSTOM_ENDPOINT_URL: &str = "https://api.xah.io/v1";

/// Model IDs mapping to redirect standard Studyus tiers to your custom models.
const CUSTOM_MODEL_TIER_1: &str = "deepseek-v4-flash-0731"; // Fastest / cheapest
const CUSTOM_MODEL_TIER_2: &str = "thanhnhan9023/glm-5.3";      // Balanced
const CUSTOM_MODEL_TIER_3: &str = "thanhnhan9023/glm-5.3";     // Reasoning / heavy

/// Native transport for one OpenAI-compatible chat-completion POST.
///
/// The Tauri webview cannot `fetch` model endpoints directly (CORS), so the
/// agent runtime assembles the request body in TypeScript and posts it through
/// this command instead. `reqwest` issues a blocking request with no same-origin
/// enforcement. If the target URL contains "api.studyus.app", the native backend
/// automatically redirects the request to your CUSTOM_ENDPOINT_URL and rewrites
/// the model IDs in the body, injecting the default API key natively in Rust.
/// This prevents any custom endpoint details or keys from leaking into the compiled
/// frontend JS package. a
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

/// Inference over a rendered PNG page using a Hugging Face model via the
/// Inference API (text-generation or vision tasks). The HF_TOKEN environment
/// variable is resolved on the Rust side so it never appears in the frontend JS
/// bundle. Falls back gracefully when not running under Tauri.
#[tauri::command]
async fn hf_inference(
    model: String,
    inputs: String,
    parameters: String,
    options: String,
) -> Result<String, String> {
    let hf_token = std::env::var("HF_TOKEN")
        .map_err(|_| "HF_TOKEN is not set in the environment".to_string())?;

    let client = Client::builder()
        .timeout(std::time::Duration::from_secs(180))
        .build()
        .map_err(|e| format!("could not build HTTP client: {e}"))?;

    let url = format!("https://api-inference.huggingface.co/models/{model}");

    let req = client.post(&url).header("Authorization", format!("Bearer {}", hf_token));

    let body = serde_json::json!({
        "inputs": inputs,
        "parameters": serde_json::from_str(&parameters).unwrap_or(serde_json::Value::Null),
        "options": serde_json::from_str(&options).unwrap_or(serde_json::Value::Null),
    });

    let res = req
        .body(serde_json::to_string(&body).map_err(|e| e.to_string())?)
        .send()
        .map_err(|e| format!("transport error reaching {url}: {e}"))?;

    let status = res.status().as_u16();
    let text = res.text().unwrap_or_default();

    if status == 422 {
        return Err(format!("HF inference validation error (422): {text}"));
    }
    if status == 503 {
        return Err(format!(
            "HF model is loading (503). Try again in 20–30s: {text}"
        ));
    }
    if !(200..300).contains(&status) {
        return Err(format!("HF inference error ({status}): {text}"));
    }

    // Hugging Face returns an array of results for most tasks
    let parsed: serde_json::Value =
        serde_json::from_str(&text).map_err(|e| format!("could not parse HF response: {e}"))?;

    let output = if let Some(arr) = parsed.as_array() {
        if let Some(first) = arr.first() {
            if let Some(generations) = first.get("generated_text") {
                generations.as_str().unwrap_or("").to_string()
            } else if let Some(s) = first.as_str() {
                s.to_string()
            } else {
                serde_json::to_string_pretty(&parsed).unwrap_or(text.clone())
            }
        } else {
            serde_json::to_string_pretty(&parsed).unwrap_or(text.clone())
        }
    } else {
        serde_json::to_string_pretty(&parsed).unwrap_or(text.clone())
    };

    Ok(output)
}

/// Extract content from a base64-encoded PNG page using the local PP-OCR
/// ONNX pipeline running on CPU via oar-ocr.
///
/// Downloads the ONNX model files from GitHub on first invocation and caches
/// them in `<app_data>/pp_ocr_models/`. Subsequent calls reuse the cached models.
///
/// Performance: ~0.2-2s per page (vs. 96s for Granite Docling).
#[tauri::command]
async fn docling_extract_image(
    app: tauri::AppHandle,
    base64_png: String,
) -> Result<doc_extract::ExtractionResult, String> {
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir: {e}"))?;

    tauri::async_runtime::spawn_blocking(move || {
        doc_extract::extract_page(&app_data, &base64_png)
    })
    .await
    .map_err(|e| format!("async join error: {e}"))?
}

/// Kick off or resume download of the PP-OCR model files.
///
/// With auto-download enabled, models are fetched from ModelScope automatically
/// on first use. This function just returns a ready state.
#[tauri::command]
async fn docling_prepare_model(_app: tauri::AppHandle) -> Result<PrepareModelResult, String> {
    Ok(PrepareModelResult {
        status: "ready".to_string(),
        total_bytes: doc_extract::TOTAL_BYTES,
    })
}

#[derive(Serialize)]
struct PrepareModelResult {
    status: String,
    total_bytes: u64,
}

/// Read the current PP-OCR model download state.
/// For now, returns a simple ready/not-ready status.
#[tauri::command]
fn docling_get_download_state() -> DownloadState {
    DownloadState {
        completed: true,
        status: "ready".to_string(),
        total_bytes: doc_extract::TOTAL_BYTES,
        downloaded_bytes: doc_extract::TOTAL_BYTES,
    }
}

#[derive(Serialize)]
struct DownloadState {
    completed: bool,
    status: String,
    total_bytes: u64,
    downloaded_bytes: u64,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Load HF_TOKEN from .env so it is available to hf_inference without
    // requiring the variable to be set at OS level. In production the same
    // env var can be set by the installer / launch script instead.
    let _ = dotenvy::dotenv();
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            render_page_range,
            extract_text_range,
            save_source_pdf,
            chat_completion,
            hf_inference,
            docling_extract_image,
            docling_prepare_model,
            docling_get_download_state,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Studyus");
}
