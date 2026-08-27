//! Local inference pipeline for Granite Docling 258M via ONNX Runtime (CPU).
//!
//! Three ONNX sessions, downloaded lazily from HuggingFace on first use:
//!
//!   1. `vision_encoder.onnx`   (SigLIP2 base + pixel shuffle projector) → image embeddings
//!   2. `embed_tokens.onnx`     (GPT-NeoX token embedding table)         → text embeddings
//!   3. `decoder_model_merged.onnx` (Granite 165M autoregressive decoder) → DocTags tokens
//!
//!   PNG (base64) ──preprocess──► vision ──► image embeds
//!                                                 │
//!   text ids ──tokenize──► embed_tokens ──► text embeds
//!                                                 │
//!                              concat ──► decoder ──► argmax ──► token
//!                                                 │
//!                                       (loop, append embedding, repeat)
//!
//! Model files are cached under `<app_data>/granite_docling/onnx/`. No API key required.

use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use base64::Engine;
use ndarray::prelude::*;
use ort::session::{Session, SessionInputValue};
use ort::value::TensorRef;
use ort::inputs;
use serde::Serialize;
use tokenizers::Tokenizer;

// ── constants ────────────────────────────────────────────────────────────────

const IMG_SIZE: u32 = 512;
const MAX_NEW_TOKENS: usize = 4096;
const USER_PROMPT: &str = "Convert this page to docling.";
const IMAGE_PLACEHOLDER: &str = "<image>";
const IMAGE_WRAPPER_PREFIX: &str = "<fake_token_around_image><global-img>";
const IMAGE_WRAPPER_SUFFIX: &str = "<fake_token_around_image>";
const TOKENIZER_FILES: &[&str] = &[
    "tokenizer.json",
    "tokenizer_config.json",
    "special_tokens_map.json",
    "chat_template.jinja",
];
const NUM_DECODER_LAYERS: usize = 30;
const NUM_KEY_VALUE_HEADS: usize = 3;
const ATTENTION_HEAD_DIM: usize = 64;

// Granite Docling uses image_seq_len=64 for a single 512×512 global image with no splitting.
// When do_image_splitting=false (as in this implementation), the processor produces
// exactly one 512×512 frame, which the vision encoder divides into (512/16)^2 = 1024 patches.
// These 1024 patches are pooled by a factor of 4 via the pixel shuffle projector,
// yielding 1024 / (4*4) = 64 final image features, which replace the 64 <image> tokens.
const IMAGE_SEQUENCE_LENGTH: usize = 64;

// #region agent log
fn debug_log(hypothesis_id: &str, location: &str, message: &str, data: serde_json::Value) {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default();
    let payload = serde_json::json!({
        "sessionId": "d32fa4",
        "runId": "pre-fix",
        "hypothesisId": hypothesis_id,
        "location": location,
        "message": message,
        "data": data,
        "timestamp": timestamp,
    });
    if let Ok(mut file) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(r"a:\studyus_app\debug-d32fa4.log")
    {
        let _ = writeln!(file, "{}", payload);
    }
}
// #endregion

/// ONNX model files - using FP32 decoder with FP16 embedding models.
/// The FP16 embedding models output FP32, and the FP32 decoder expects FP32 inputs.
const MODEL_FILES: &[(&str, u64)] = &[
    ("vision_encoder_fp16.onnx", 299 * 1024),
    ("vision_encoder_fp16.onnx_data", 187_000 * 1024),
    ("embed_tokens_fp16.onnx", 637),
    ("embed_tokens_fp16.onnx_data", 116_000 * 1024),
    ("decoder_model_merged.onnx", 203 * 1024),
    ("decoder_model_merged.onnx_data", 658_100 * 1024),
];

// ── model-download helpers ────────────────────────────────────────────────────

/// Path to the isolated HuggingFace cache directory used by this app.
fn hf_cache_dir(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join("granite_docling").join("hf_cache")
}

/// Clean up stale HF cache lock files that may have been left behind by
/// interrupted downloads or concurrent processes. This prevents "cache lock
/// timed out" errors when re-downloading model files.
fn cleanup_stale_locks(cache_dir: &Path) {
    let locks_dir = cache_dir.join(".locks");
    if !locks_dir.exists() {
        return;
    }

    if let Ok(entries) = std::fs::read_dir(&locks_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if let Some(ext) = path.extension() {
                if ext == "lock" {
                    // Remove lock files older than 5 minutes (likely stale)
                    if let Ok(metadata) = path.metadata() {
                        if let Ok(modified) = metadata.modified() {
                            let age = std::time::SystemTime::now()
                                .duration_since(modified)
                                .map(|d| d.as_secs())
                                .unwrap_or(0);
                            if age > 300 {
                                let _ = std::fs::remove_file(&path);
                            }
                        }
                    }
                }
            }
        }
    }
}

/// Set HF_HUB_CACHE so hf_hub uses our isolated cache directory.
/// Must be called before any hf_hub API call.
fn isolate_hf_cache(app_data_dir: &Path) {
    let cache = hf_cache_dir(app_data_dir);
    std::fs::create_dir_all(&cache).ok();
    std::env::set_var("HF_HUB_CACHE", &cache);
    // Clean up stale locks before any download attempt
    cleanup_stale_locks(&cache);
}

/// Returns the app's model directory (where the .onnx files live).
pub fn model_dir(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join("granite_docling").join("onnx")
}

/// Download a single ONNX file via hf_hub, then move it to `dest`.
/// Uses HFClientSync (blocking API with its own tokio runtime for Xet transfers),
/// which is safe inside Tauri's async context.
/// Deletes any stale stub on failure so retries start clean.
/// Retries up to 3 times on lock timeout errors.
fn download_onnx_file(
    repo: &hf_hub::HFRepositorySync<hf_hub::RepoTypeModel>,
    relative_path: &str,
    dest: &Path,
) -> Result<(), String> {
    const MAX_RETRIES: u32 = 3;
    const RETRY_DELAY_MS: u64 = 5000;

    for attempt in 0..=MAX_RETRIES {
        // Clean locks before each attempt (especially after a failure)
        if let Some(cache) = std::env::var("HF_HUB_CACHE").ok() {
            cleanup_stale_locks(Path::new(&cache));
        }

        // Delete stale file before re-downloading so the move succeeds.
        let _ = std::fs::remove_file(dest);

        if attempt > 0 {
            eprintln!(
                "[granite_docling] retry {}/{} for {} after lock timeout…",
                attempt, MAX_RETRIES, relative_path
            );
            std::thread::sleep(std::time::Duration::from_millis(RETRY_DELAY_MS * (attempt as u64)));
        } else {
            eprintln!(
                "[granite_docling] downloading {} from HuggingFace…",
                relative_path
            );
        }

        match repo
            .download_file()
            .filename(relative_path)
            .send()
        {
            Ok(cached) => {
                // Move from HF cache into our app-local model dir. The cache is managed by
                // hf_hub so repeated calls reuse the cached copy; we own our app-local copy.
                if let Err(e) = std::fs::rename(&cached, dest) {
                    // On Windows, rename can fail if src and dst are on different drives.
                    // Fall back to copy + delete in that case.
                    if e.kind() == std::io::ErrorKind::CrossesDevices
                        || e.raw_os_error() == Some(17) // EXDEV on Unix
                    {
                        std::fs::copy(&cached, dest).map_err(|ce| {
                            format!(
                                "copy {} → {}: {ce}",
                                cached.display(),
                                dest.display(),
                            )
                        })?;
                        let _ = std::fs::remove_file(&cached);
                    } else {
                        return Err(format!(
                            "move {} → {}: {e}",
                            cached.display(),
                            dest.display(),
                        ));
                    }
                }

                let size = dest.metadata().map(|m| m.len()).unwrap_or(0);
                eprintln!(
                    "[granite_docling] saved {} ({} MB)",
                    dest.display(),
                    size / 1_000_000
                );
                return Ok(());
            }
            Err(e) => {
                let err_str = e.to_string();
                // Check if this is a lock timeout error that warrants retry
                if err_str.contains("Cache lock timed out") && attempt < MAX_RETRIES {
                    eprintln!(
                        "[granite_docling] lock timeout on {}, will retry…",
                        relative_path
                    );
                    continue;
                }
                return Err(format!("hf_hub download {}: {e}", relative_path));
            }
        }
    }

    Err(format!(
        "download {}: exhausted {} retries due to cache lock timeouts",
        relative_path,
        MAX_RETRIES
    ))
}

/// Ensure a single ONNX file (or its companion _data file) is present on disk.
/// Downloads via hf_hub if missing or too small, then moves to the app model dir.
/// The `relative_path` is the bare filename (e.g. "vision_encoder_q4f16.onnx"); this
/// function prepends "onnx/" when talking to the HuggingFace Hub.
/// The HF cache is isolated per-app so there are no lock conflicts with other HF processes.
fn ensure_onnx_file(
    repo: &hf_hub::HFRepositorySync<hf_hub::RepoTypeModel>,
    dest_dir: &Path,
    relative_path: &str,
) -> Result<(), String> {
    std::fs::create_dir_all(dest_dir)
        .map_err(|e| format!("create model dir {}: {e}", dest_dir.display()))?;

    let dest = dest_dir.join(relative_path);

    // Prepend "onnx/" for the HF Hub API path (e.g. "onnx/vision_encoder_q4f16.onnx").
    let hf_path = format!("onnx/{}", relative_path);
    ensure_model_artifact(repo, &hf_path, &dest)
}

fn ensure_model_artifact(
    repo: &hf_hub::HFRepositorySync<hf_hub::RepoTypeModel>,
    hf_path: &str,
    dest: &Path,
) -> Result<(), String> {
    if dest.exists() {
        return Ok(());
    }
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("create artifact directory {}: {e}", parent.display()))?;
    }
    if let Some(cache) = std::env::var("HF_HUB_CACHE").ok() {
        cleanup_stale_locks(Path::new(&cache));
    }
    download_onnx_file(repo, hf_path, dest)
}

/// Ensure all six ONNX model files (3 models × 2 files each) are present.
fn ensure_all_models(
    repo: &hf_hub::HFRepositorySync<hf_hub::RepoTypeModel>,
    app_data_dir: &Path,
) -> Result<ModelPaths, String> {
    let dir = model_dir(app_data_dir);
    let mut paths = ModelPaths::default();

    for &(filename, _) in MODEL_FILES {
        ensure_onnx_file(repo, &dir, filename)?;
        match filename {
            "vision_encoder_fp16.onnx" => paths.vision = dir.join(filename),
            "embed_tokens_fp16.onnx" => paths.embed_tokens = dir.join(filename),
            "decoder_model_merged.onnx" => paths.decoder = dir.join(filename),
            _ => {}
        }
    }

    Ok(paths)
}

#[derive(Default)]
struct ModelPaths {
    vision: PathBuf,
    decoder: PathBuf,
    embed_tokens: PathBuf,
}

// ── session loading ───────────────────────────────────────────────────────────

/// The three ONNX sessions, wrapped in Mutex for interior mutability (session.run needs &mut).
pub struct Sessions {
    pub vision: Mutex<Session>,
    pub decoder: Mutex<Session>,
    pub embed_tokens: Mutex<Session>,
}

impl Sessions {
    pub fn new(app_data_dir: &Path) -> Result<Self, String> {
        isolate_hf_cache(app_data_dir);
        let client = hf_hub::HFClientSync::new()
            .map_err(|e| format!("hf_hub init: {e}"))?;
        let repo = client.model("onnx-community", "granite-docling-258M-ONNX");
        let ModelPaths { vision, decoder, embed_tokens } = ensure_all_models(&repo, app_data_dir)?;

        let load = |path: &Path, name: &str| -> Result<Session, String> {
            let session = Session::builder()
                .map_err(|e| format!("session builder: {e}"))?
                .with_intra_threads(1)
                .map_err(|e| format!("with_intra_threads: {e}"))?
                .with_optimization_level(ort::session::builder::GraphOptimizationLevel::Level3)
                .map_err(|e| format!("optimization level: {e}"))?
                .commit_from_file(path)
                .map_err(|e| format!("load {} ({name}): {e}", path.display()))?;
            Ok(session)
        };

        let vision_session = load(&vision, "vision")?;
        let decoder_session = load(&decoder, "decoder")?;
        let embed_session = load(&embed_tokens, "embed_tokens")?;
        // #region agent log
        debug_log("F", "granite_docling.rs:Sessions::new", "Loaded ONNX model interfaces", serde_json::json!({
            "visionInputs": vision_session.inputs().iter().map(|input| format!("{}: {}", input.name(), input.dtype())).collect::<Vec<_>>(),
            "visionOutputs": vision_session.outputs().iter().map(|output| format!("{}: {}", output.name(), output.dtype())).collect::<Vec<_>>(),
            "decoderInputs": decoder_session.inputs().iter().map(|input| format!("{}: {}", input.name(), input.dtype())).collect::<Vec<_>>(),
            "decoderOutputs": decoder_session.outputs().iter().map(|output| format!("{}: {}", output.name(), output.dtype())).collect::<Vec<_>>(),
            "embedInputs": embed_session.inputs().iter().map(|input| format!("{}: {}", input.name(), input.dtype())).collect::<Vec<_>>(),
            "embedOutputs": embed_session.outputs().iter().map(|output| format!("{}: {}", output.name(), output.dtype())).collect::<Vec<_>>(),
        }));
        // #endregion
        Ok(Self {
            vision: Mutex::new(vision_session),
            decoder: Mutex::new(decoder_session),
            embed_tokens: Mutex::new(embed_session),
        })
    }
}

// Global sessions (one-time load, reused across all pages in a session).
// Use Mutex to allow interior mutability since Session::run requires &mut self.
static SESSIONS: std::sync::OnceLock<Result<Sessions, String>> = std::sync::OnceLock::new();

pub fn get_sessions(app_data_dir: &Path) -> Result<&'static Sessions, String> {
    SESSIONS
        .get_or_init(|| Sessions::new(app_data_dir))
        .as_ref()
        .map_err(|e| e.clone())
}

// ── image preprocessing ─────────────────────────────────────────────────────

fn preprocess_image(base64_png: &str) -> Result<(Array5<f32>, Array4<bool>), String> {
    let png_bytes = base64::engine::general_purpose::STANDARD
        .decode(base64_png.trim())
        .map_err(|e| format!("base64 decode: {e}"))?;

    let img = image::load_from_memory(&png_bytes)
        .map_err(|e| format!("image decode: {e}"))?;

    // CRITICAL FIX: This implementation uses do_image_splitting=false.
    // The model was trained with do_image_splitting=true, but the ONNX README example
    // shows both work as long as the prompt matches the actual number of image features.
    //
    // With do_image_splitting=false:
    // - Resize to IMG_SIZE (512) on the longest edge, preserving aspect ratio
    // - Pad shorter edge to square
    // - Feed one 512×512 frame to vision encoder
    // - Vision encoder produces (512/16)^2 = 1024 patches
    // - Pixel shuffle projector (scale_factor=4) pools to 1024/(4*4) = 64 features
    // - These 64 features replace the 64 <image> tokens in the prompt
    
    let (width, height) = (img.width(), img.height());
    let scale = (IMG_SIZE as f32) / width.max(height) as f32;
    let new_width = (width as f32 * scale).round() as u32;
    let new_height = (height as f32 * scale).round() as u32;
    
    let resized = img.resize_exact(new_width, new_height, image::imageops::FilterType::Lanczos3);
    
    // Pad to square (512×512) with black pixels
    let mut padded = image::RgbImage::from_pixel(IMG_SIZE, IMG_SIZE, image::Rgb([0, 0, 0]));
    let rgb = resized.to_rgb8();
    image::imageops::replace(&mut padded, &rgb, 0, 0);
    let pixels = padded.into_raw();

    // Normalize: pixel/255, then (value - 0.5) / 0.5
    const MEAN: [f32; 3] = [0.5_f32; 3];
    const STD: [f32; 3] = [0.5_f32; 3];

    // Vision encoder expects 5D: [batch, frames, channels, height, width]
    let mut tensor: Array5<f32> =
        Array5::zeros((1, 1, 3, IMG_SIZE as usize, IMG_SIZE as usize));

    for y in 0..IMG_SIZE as usize {
        for x in 0..IMG_SIZE as usize {
            let i = (y * IMG_SIZE as usize + x) * 3;
            let r = pixels[i] as f32 / 255.0_f32;
            let g = pixels[i + 1] as f32 / 255.0_f32;
            let b = pixels[i + 2] as f32 / 255.0_f32;
            tensor[[0, 0, 0, y, x]] = (r - MEAN[0]) / STD[0];
            tensor[[0, 0, 1, y, x]] = (g - MEAN[1]) / STD[1];
            tensor[[0, 0, 2, y, x]] = (b - MEAN[2]) / STD[2];
        }
    }
    
    // Attention mask: only the real (non-padded) region is attended
    let mut pixel_attention_mask = Array4::from_elem((1, 1, IMG_SIZE as usize, IMG_SIZE as usize), false);
    for y in 0..new_height as usize {
        for x in 0..new_width as usize {
            pixel_attention_mask[[0, 0, y, x]] = true;
        }
    }
    Ok((tensor, pixel_attention_mask))
}

// ── tokenizer ───────────────────────────────────────────────────────────────

fn tokenizer_path(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join("granite_docling").join("tokenizer.json")
}

fn ensure_tokenizer(app_data_dir: &Path) -> Result<PathBuf, String> {
    let dir = app_data_dir.join("granite_docling");
    isolate_hf_cache(app_data_dir);
    let client = hf_hub::HFClientSync::new().map_err(|e| format!("hf_hub init: {e}"))?;
    let repo = client.model("onnx-community", "granite-docling-258M-ONNX");
    for filename in TOKENIZER_FILES {
        ensure_model_artifact(&repo, filename, &dir.join(filename))?;
    }
    Ok(tokenizer_path(app_data_dir))
}

fn build_prompt_ids(app_data_dir: &Path) -> Result<(Tokenizer, Vec<i64>, u32), String> {
    let tokenizer = Tokenizer::from_file(ensure_tokenizer(app_data_dir)?)
        .map_err(|e| format!("load Granite Docling tokenizer: {e}"))?;
    
    // The Idefics3Processor expands each <image> token into <fake_token_around_image><global-img> + (64 × <image>) + <fake_token_around_image>
    // when do_image_splitting=false (single global image). The README example confirms this expansion.
    let image_expansion = format!(
        "{IMAGE_WRAPPER_PREFIX}{}{}",
        IMAGE_PLACEHOLDER.repeat(IMAGE_SEQUENCE_LENGTH),
        IMAGE_WRAPPER_SUFFIX,
    );
    
    // Build the exact prompt format the chat_template.jinja produces for the Granite Docling model.
    // The template is: <|start_of_role|>user<|end_of_role|>{content}<|end_of_text|>\n<|start_of_role|>assistant<|end_of_role|>
    let prompt = format!(
        "<|start_of_role|>user<|end_of_role|>{image_expansion}{USER_PROMPT}<|end_of_text|>\n<|start_of_role|>assistant<|end_of_role|>"
    );
    
    let encoding = tokenizer
        .encode(prompt.as_str(), false)
        .map_err(|e| format!("encode Granite Docling prompt: {e}"))?;
    let ids = encoding.get_ids().iter().map(|&id| i64::from(id)).collect::<Vec<_>>();
    let image_token_id = tokenizer.token_to_id(IMAGE_PLACEHOLDER)
        .ok_or_else(|| "Granite Docling tokenizer has no <image> token".to_string())?;
    let eot_token_id = tokenizer.token_to_id("<|end_of_text|>")
        .ok_or_else(|| "Granite Docling tokenizer has no <|end_of_text|> token".to_string())?;
    let image_token_count = ids.iter().filter(|&&id| id == i64::from(image_token_id)).count();
    
    // Decode the first few tokens to verify tokenization
    let decoded_tokens: Vec<String> = ids[..ids.len().min(15)]
        .iter()
        .map(|&id| {
            tokenizer
                .decode(&[id as u32], false)
                .unwrap_or_else(|_| format!("[id:{}]", id))
        })
        .collect();
    
    // Log the complete prompt for comparison with Python processor output
    debug_log("E", "granite_docling.rs:build_prompt_ids", "Encoded official Granite Docling prompt", serde_json::json!({
        "tokenCount": ids.len(),
        "imageTokenId": image_token_id,
        "imageTokenCount": image_token_count,
        "eotTokenId": eot_token_id,
        "fullPrompt": prompt,
        "firstTenTokens": &ids[..ids.len().min(10)],
        "decodedFirstTokens": decoded_tokens,
    }));
    
    if image_token_count != IMAGE_SEQUENCE_LENGTH {
        return Err(format!("Granite Docling prompt has {image_token_count} image positions, expected {IMAGE_SEQUENCE_LENGTH}"));
    }
    Ok((tokenizer, ids, eot_token_id))
}

// ── ndarray <-> ort tensor helpers ──────────────────────────────────────────

/// Run the vision encoder session with pixel_values and pixel_attention_mask.
fn run_vision_encoder(
    sessions: &Sessions,
    pixel_values: &Array5<f32>,
    pixel_attention_mask: &Array4<bool>,
) -> Result<Array3<f32>, String> {

    let mut vision = sessions.vision.lock().map_err(|e| e.to_string())?;
    let outputs = vision
        .run(inputs! {
            "pixel_values" => TensorRef::from_array_view(pixel_values).map_err(|e| e.to_string())?,
            "pixel_attention_mask" => TensorRef::from_array_view(pixel_attention_mask).map_err(|e| e.to_string())?,
        })
        .map_err(|e| format!("vision_encoder: {e}"))?;

    // SigLIP2 returns {"last_hidden_state": [1, seq, hidden]} or {"image_embeds": ...}.
    // Try common output names.
    let name = if outputs.get("last_hidden_state").is_some() {
        "last_hidden_state"
    } else if outputs.get("image_embeds").is_some() {
        "image_embeds"
    } else if outputs.get("image_features").is_some() {
        "image_features"
    } else {
        return Err(format!("vision output keys: {:?}", outputs.into_iter().map(|(k,_)|k).collect::<Vec<_>>()));
    };

    let arr: ndarray::ArrayViewD<'_, f32> = outputs[name]
        .try_extract_array()
        .map_err(|e| format!("extract last_hidden_state: {e}"))?;

    // Convert ArrayViewD to Array3. Shape should be [1, seq, hidden].
    let shape = arr.shape();
    // #region agent log
    debug_log("A", "granite_docling.rs:run_vision_encoder", "Vision encoder output selected", serde_json::json!({
        "outputName": name,
        "shape": shape,
    }));
    // #endregion
    if shape.len() != 3 || shape[0] != 1 {
        return Err(format!("unexpected vision output shape: {:?}", shape));
    }
    let s = shape[1] as usize;
    let h = shape[2] as usize;
    let mut out: Array3<f32> = Array3::zeros((1, s, h));
    for si in 0..s {
        for hi in 0..h {
            out[[0, si, hi]] = arr[[0, si, hi]];
        }
    }
    Ok(out)
}

/// Embed a sequence of token IDs → [1, seq, hidden] float embeddings.
fn embed_tokens(sessions: &Sessions, token_ids: &[i64]) -> Result<Array3<f32>, String> {
    let seq_len = token_ids.len();
    let ids_arr: Array2<i64> = Array2::from_shape_vec((1, seq_len), token_ids.to_vec())
        .map_err(|e| format!("create batched input_ids: {e}"))?;

    // #region agent log
    debug_log("B", "granite_docling.rs:embed_tokens", "Calling token embedding session", serde_json::json!({
        "tokenCount": seq_len,
        "inputShape": ids_arr.shape(),
    }));
    // #endregion
    let mut embed = sessions.embed_tokens.lock().map_err(|e| e.to_string())?;
    let outputs = embed
        .run(inputs! { "input_ids" => TensorRef::from_array_view(&ids_arr).map_err(|e| e.to_string())? })
        .map_err(|e| format!("embed_tokens: {e}"))?;

    // The exported quantized model names this tensor `inputs_embeds`.
    let name = if outputs.get("inputs_embeds").is_some() {
        "inputs_embeds"
    } else if outputs.get("embeds").is_some() {
        "embeds"
    } else if outputs.get("last_hidden_state").is_some() {
        "last_hidden_state"
    } else {
        return Err(format!(
            "embed output keys: {:?}",
            outputs.into_iter().map(|(key, _)| key).collect::<Vec<_>>()
        ));
    };

    let arr: ndarray::ArrayViewD<'_, f32> = outputs[name]
        .try_extract_array()
        .map_err(|e| format!("extract {name}: {e}"))?;

    let shape = arr.shape();
    // #region agent log
    debug_log("B", "granite_docling.rs:embed_tokens", "Token embedding output received", serde_json::json!({
        "shape": shape,
    }));
    // #endregion
    if shape.len() != 3 || shape[0] != 1 {
        return Err(format!("unexpected embed output shape: {:?}", shape));
    }
    let s = shape[1] as usize;
    let h = shape[2] as usize;
    let mut out: Array3<f32> = Array3::zeros((1, s, h));
    for si in 0..s {
        for hi in 0..h {
            out[[0, si, hi]] = arr[[0, si, hi]];
        }
    }
    Ok(out)
}

// ── merged decoder ────────────────────────────────────────────────────────────

fn argmax_token(logits: &ndarray::ArrayD<f32>) -> Result<u32, String> {
    let shape = logits.shape();
    if shape.len() != 3 || shape[0] != 1 || shape[1] == 0 {
        return Err(format!("unexpected logits shape: {:?}", shape));
    }
    let last = shape[1] - 1;
    let (token, _) = (0..shape[2])
        .map(|index| (index, logits[[0, last, index]]))
        .max_by(|(_, left), (_, right)| left.total_cmp(right))
        .ok_or_else(|| "decoder produced an empty vocabulary axis".to_string())?;
    Ok(token as u32)
}

fn run_decoder_step(
    sessions: &Sessions,
    inputs_embeds: &Array3<f32>,
    attention_mask: &Array2<i64>,
    past: &mut [Array4<f32>],
) -> Result<(u32, Vec<Array4<f32>>), String> {
    let inputs_embeds_shape = inputs_embeds.shape().to_vec();
    let mut input_values: Vec<(String, SessionInputValue<'_>)> = Vec::with_capacity(2 + NUM_DECODER_LAYERS * 2);
    input_values.push(("inputs_embeds".to_string(), ort::value::Tensor::from_array(inputs_embeds.clone()).map_err(|e| e.to_string())?.into()));
    input_values.push(("attention_mask".to_string(), ort::value::Tensor::from_array(attention_mask.clone()).map_err(|e| e.to_string())?.into()));
    for layer in 0..NUM_DECODER_LAYERS {
        for (kind, offset) in [("key", 0), ("value", 1)] {
            input_values.push((format!("past_key_values.{layer}.{kind}"), ort::value::Tensor::from_array(past[layer * 2 + offset].clone()).map_err(|e| e.to_string())?.into()));
        }
    }
    // #region agent log
    debug_log("D", "granite_docling.rs:run_decoder_step", "Calling documented Idefics3 merged decoder", serde_json::json!({
        "inputsEmbedsShape": inputs_embeds_shape,
        "attentionMaskShape": attention_mask.shape(),
        "cacheTensorCount": past.len(),
    }));
    // #endregion
    let mut decoder = sessions.decoder.lock().map_err(|e| e.to_string())?;
    let outputs = decoder.run(input_values).map_err(|e| format!("decoder step: {e}"))?;
    let logits: ndarray::ArrayViewD<'_, f32> = outputs["logits"].try_extract_array().map_err(|e| format!("extract logits: {e}"))?;
    let token = argmax_token(&logits.into_owned().into_dyn())?;
    let mut next_past = Vec::with_capacity(NUM_DECODER_LAYERS * 2);
    for layer in 0..NUM_DECODER_LAYERS {
        for kind in ["key", "value"] {
            let value: ndarray::ArrayViewD<'_, f32> = outputs[format!("present.{layer}.{kind}").as_str()]
                .try_extract_array().map_err(|e| format!("extract cache layer {layer} {kind}: {e}"))?;
            next_past.push(value.into_dimensionality::<ndarray::Ix4>().map_err(|e| format!("cache shape layer {layer} {kind}: {e}"))?.to_owned());
        }
    }
    Ok((token, next_past))
}

// ── inference pipeline ───────────────────────────────────────────────────────

pub fn extract_page(app_data_dir: &Path, sessions: &Sessions, base64_png: &str) -> Result<String, String> {
    extract_page_with_token_limit(app_data_dir, sessions, base64_png, MAX_NEW_TOKENS)
}

fn extract_page_with_token_limit(
    app_data_dir: &Path,
    sessions: &Sessions,
    base64_png: &str,
    max_new_tokens: usize,
) -> Result<String, String> {
    let (pixel_values, pixel_attention_mask) = preprocess_image(base64_png)?;
    let image_features = run_vision_encoder(sessions, &pixel_values, &pixel_attention_mask)?;
    if image_features.shape() != [1, IMAGE_SEQUENCE_LENGTH, 576] {
        return Err(format!("unexpected Idefics3 vision feature shape: {:?}", image_features.shape()));
    }
    let (tokenizer, prompt_ids, eot_token_id) = build_prompt_ids(app_data_dir)?;
    let image_token_id = tokenizer.token_to_id(IMAGE_PLACEHOLDER)
        .ok_or_else(|| "Granite Docling tokenizer has no <image> token".to_string())?;
    let image_positions = prompt_ids.iter().filter(|&&id| id == i64::from(image_token_id)).count();
    if image_positions != IMAGE_SEQUENCE_LENGTH {
        return Err(format!("Granite Docling prompt has {image_positions} image positions, expected {IMAGE_SEQUENCE_LENGTH}"));
    }
    let mut input_ids = prompt_ids;
    let mut attention_mask = Array2::from_elem((1, input_ids.len()), 1_i64);
    let mut past = (0..NUM_DECODER_LAYERS * 2)
        .map(|_| Array4::from_elem(
            (1, NUM_KEY_VALUE_HEADS, 0, ATTENTION_HEAD_DIM),
            0.0_f32,
        ))
        .collect::<Vec<_>>();
    let mut generated = Vec::with_capacity(max_new_tokens);

    for step in 0..max_new_tokens {
        let mut embeds = embed_tokens(sessions, &input_ids)?;
        if step == 0 {
            // Replace <image> token embeddings with actual vision features
            let image_positions: Vec<usize> = input_ids
                .iter()
                .enumerate()
                .filter(|(_, &id)| id == i64::from(image_token_id))
                .map(|(index, _)| index)
                .collect();
            
            debug_log("C", "granite_docling.rs:extract_page", "Replacing image token embeddings", serde_json::json!({
                "imagePositions": &image_positions[..image_positions.len().min(5)],
                "imagePositionCount": image_positions.len(),
                "imageFeatureShape": image_features.shape(),
                "embedsShape": embeds.shape(),
                "firstImageTokenEmbedBefore": [embeds[[0, image_positions[0], 0]], embeds[[0, image_positions[0], 1]], embeds[[0, image_positions[0], 2]]],
                "firstImageFeature": [image_features[[0, 0, 0]], image_features[[0, 0, 1]], image_features[[0, 0, 2]]],
            }));
            
            for (feature_index, &token_index) in image_positions.iter().enumerate() {
                for hidden in 0..embeds.shape()[2] {
                    embeds[[0, token_index, hidden]] = image_features[[0, feature_index, hidden]];
                }
            }
            
            debug_log("C", "granite_docling.rs:extract_page", "Image embeddings replaced", serde_json::json!({
                "firstImageTokenEmbedAfter": [embeds[[0, image_positions[0], 0]], embeds[[0, image_positions[0], 1]], embeds[[0, image_positions[0], 2]]],
            }));
        }
        let (next_token, next_past) = run_decoder_step(sessions, &embeds, &attention_mask, &mut past)?;
        past = next_past;
        generated.push(next_token);
        if step < 32 {
            let decoded = tokenizer
                .decode(&[next_token], false)
                .map_err(|e| format!("decode generated token: {e}"))?;
            debug_log("G", "granite_docling.rs:extract_page", "Generated token", serde_json::json!({
                "step": step,
                "tokenId": next_token,
                "text": decoded,
            }));
        }
        if next_token == eot_token_id {
            break;
        }
        input_ids = vec![next_token as i64];
        attention_mask = Array2::from_elem((1, attention_mask.shape()[1] + 1), 1_i64);
    }
    let output = tokenizer.decode(&generated, false).map_err(|e| format!("decode DocTags: {e}"))?;
    // #region agent log
    debug_log("G", "granite_docling.rs:extract_page", "Granite Docling extraction completed", serde_json::json!({
        "generatedTokenCount": generated.len(),
        "endedWithEos": generated.last() == Some(&eot_token_id),
        "outputLength": output.len(),
        "outputPrefix": output.chars().take(500).collect::<String>(),
    }));
    // #endregion
    Ok(output)
}

// ── public API ─────────────────────────────────────────────────────────────

#[derive(Serialize)]
pub struct ExtractionResult {
    pub markdown: String,
    pub tables: Vec<TableEntry>,
    pub warnings: Vec<String>,
}

#[derive(Serialize)]
pub struct TableEntry {
    pub id: String,
    pub markdown: String,
}

/// Extract content from a single base64-PNG page using local ONNX inference.
pub fn docling_extract(
    app_data_dir: &Path,
    base64_png: &str,
) -> Result<ExtractionResult, String> {
    let sessions = get_sessions(app_data_dir)?;
    let raw = extract_page(app_data_dir, sessions, base64_png)?;

    let mut warnings = Vec::new();
    let (tables, cleaned) = parse_doctags(&raw, &mut warnings);

    Ok(ExtractionResult {
        markdown: cleaned,
        tables,
        warnings,
    })
}

fn parse_doctags(raw: &str, _warnings: &mut Vec<String>) -> (Vec<TableEntry>, String) {
    // Granite Docling emits DocTags: <page>...<table>...</table>...</page>
    // We extract markdown from text nodes and collect table OTSL blocks.
    let mut tables = Vec::new();
    let mut table_counter = 0;

    // Remove any table tags and extract their content.
    let re_table = regex_lite::Regex::new(r"(?s)<table>.*?</table>").unwrap();
    let cleaned = re_table.replace_all(raw, |caps: &regex_lite::Captures| {
        let table_md = caps[0]
            .lines()
            .skip(1) // skip <table>
            .take_while(|l| !l.trim().starts_with("</table>"))
            .collect::<Vec<_>>()
            .join("\n");
        let id = format!("table-{}", table_counter);
        table_counter += 1;
        tables.push(TableEntry {
            id,
            markdown: table_md.trim().to_string(),
        });
        format!("[Table {}]", table_counter - 1)
    });

    (tables, cleaned.trim().to_string())
}

// ── download progress tracker ──────────────────────────────────────────────────

/// Tracks download progress for all three ONNX files.
/// The frontend polls this during app startup to show the Downloads modal.
#[derive(serde::Serialize)]
pub struct DownloadState {
    /// 0.0 – 1.0 overall completion.
    pub progress: f32,
    /// "Downloading vision_encoder.onnx" | "Ready" | error string
    pub status: String,
    /// Total bytes downloaded so far.
    pub bytes_so_far: u64,
    /// Estimated total bytes (~300 MB per file × 3 = ~900 MB).
    pub bytes_total: u64,
    /// true once all three files are on disk
    pub completed: bool,
}

impl Default for DownloadState {
    fn default() -> Self {
        Self {
            progress: 0.0,
            status: "Checking cached files…".into(),
            bytes_so_far: 0,
            bytes_total: 900_000_000,
            completed: false,
        }
    }
}

impl Clone for DownloadState {
    fn clone(&self) -> Self {
        Self {
            progress: self.progress,
            status: self.status.clone(),
            bytes_so_far: self.bytes_so_far,
            bytes_total: self.bytes_total,
            completed: self.completed,
        }
    }
}

/// Shared mutable download state — initialised once on first call.
static DOWNLOAD_STATE: std::sync::OnceLock<std::sync::Mutex<DownloadState>> =
    std::sync::OnceLock::new();

fn download_state() -> &'static std::sync::Mutex<DownloadState> {
    DOWNLOAD_STATE.get_or_init(|| std::sync::Mutex::new(DownloadState::default()))
}

/// Total estimated download size for the mixed fp16/fp32 variant (in bytes).
pub const MIXED_TOTAL_BYTES: u64 = 1_061_000_000;

/// Download all six q4f16 ONNX files from HuggingFace, streaming progress.
/// Idempotent — files already on disk skip the download.
/// Uses `ensure_onnx_file` internally so stale stubs are deleted before re-downloading.
pub fn prepare_model(
    app_data_dir: &Path,
    on_progress: impl Fn(f32, &str, u64),
) -> Result<(), String> {
    let dir = model_dir(app_data_dir);
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("create model dir {}: {e}", dir.display()))?;

    // Isolate our cache from any system-wide huggingface_hub processes.
    isolate_hf_cache(app_data_dir);

    // HFClientSync manages its own multi-threaded tokio runtime so Xet transfers
    // work even inside Tauri's async context.
    let client = hf_hub::HFClientSync::new()
        .map_err(|e| format!("hf_hub init: {e}"))?;
    let repo = client.model("onnx-community", "granite-docling-258M-ONNX");

    let total = MIXED_TOTAL_BYTES;
    let mut downloaded: u64 = 0;

    for &(filename, file_size) in MODEL_FILES {
        let dest = dir.join(filename);
        // Files already on disk are valid (stale stubs are deleted by download_onnx_file).
        let already_cached = dest.exists();

        if already_cached {
            downloaded += file_size;
            let progress = downloaded as f32 / total as f32;
            let status = format!("{} — cached", filename);
            on_progress(progress, &status, downloaded);
            update_state(progress, &status, downloaded, total);
            continue;
        }

        let status = format!("Downloading {}…", filename);
        on_progress(downloaded as f32 / total as f32, &status, downloaded);
        update_state(downloaded as f32 / total as f32, &status, downloaded, total);

        // Downloads via hf_hub, handles Xet → proper weights.
        // ensure_onnx_file prepends "onnx/" internally for the HF Hub API.
        ensure_onnx_file(&repo, &dir, filename)?;

        downloaded += file_size;
        let progress = downloaded as f32 / total as f32;
        let status = format!("{} — downloaded", filename);
        on_progress(progress, &status, downloaded);
        update_state(progress, &status, downloaded, total);
    }

    {
        let mut s = download_state().lock().map_err(|e| e.to_string())?;
        s.progress = 1.0;
        s.status = "Ready".into();
        s.completed = true;
    }
    on_progress(1.0, "Ready", total);

    // Warm up the ONNX sessions so first page extract is instant.
    // This also validates that all six files are loadable.
    Sessions::new(app_data_dir)?;

    Ok(())
}

fn update_state(progress: f32, status: &str, bytes_so_far: u64, bytes_total: u64) {
    if let Ok(mut s) = download_state().lock() {
        s.progress = progress;
        s.status = status.into();
        s.bytes_so_far = bytes_so_far;
        s.bytes_total = bytes_total;
    }
}

/// Read the current download state snapshot.
pub fn get_download_state() -> DownloadState {
    download_state()
        .lock()
        .map(|s| s.clone())
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[ignore = "requires the locally downloaded ONNX model files"]
    fn record_local_model_interfaces() {
        let app_data = std::env::var("APPDATA")
            .map(PathBuf::from)
            .expect("APPDATA must be set on Windows")
            .join("com.studyus.app");
        Sessions::new(&app_data).expect("load local ONNX sessions");
    }

    #[test]
    #[ignore = "requires the locally downloaded Granite Docling tokenizer"]
    fn granite_docling_prompt_expands_to_exactly_64_image_positions() {
        let app_data = std::env::var("APPDATA")
            .map(PathBuf::from)
            .expect("APPDATA must be set on Windows")
            .join("com.studyus.app");
        let (tokenizer, ids, _) = build_prompt_ids(&app_data).expect("build Granite Docling prompt");
        let image_token_id = tokenizer.token_to_id(IMAGE_PLACEHOLDER).expect("<image> token");
        assert_eq!(ids.iter().filter(|&&id| id == i64::from(image_token_id)).count(), IMAGE_SEQUENCE_LENGTH);
        assert!(ids.iter().all(|&id| id >= 0));
    }

    #[test]
    #[ignore = "inspect ONNX decoder input metadata"]
    fn inspect_decoder_metadata() {
        let app_data = std::env::var("APPDATA")
            .map(PathBuf::from)
            .expect("APPDATA must be set on Windows")
            .join("com.studyus.app");
        let sessions = get_sessions(&app_data).expect("load local ONNX sessions");
        let decoder = sessions.decoder.lock().expect("lock decoder");
        
        println!("\n=== Decoder Model Metadata ===");
        println!("Inputs: {:?}", decoder.inputs().len());
        println!("Outputs: {:?}", decoder.outputs().len());
        
        // Just print the first input
        if let Some(input) = decoder.inputs().get(0) {
            println!("First input: name={}", input.name());
        }
    }

    #[test]
    #[ignore = "runs the official IBM sample image through local ONNX inference"]
    fn validate_ibm_sample_first_32_tokens() {
        const SAMPLE_URL: &str = "https://huggingface.co/ibm-granite/granite-docling-258M/resolve/main/assets/new_arxiv.png";
        let app_data = std::env::var("APPDATA")
            .map(PathBuf::from)
            .expect("APPDATA must be set on Windows")
            .join("com.studyus.app");
        let image = reqwest::blocking::get(SAMPLE_URL)
            .expect("download IBM sample page")
            .error_for_status()
            .expect("IBM sample response status")
            .bytes()
            .expect("read IBM sample page");
        let sessions = get_sessions(&app_data).expect("load local ONNX sessions");
        let output = extract_page_with_token_limit(
            &app_data,
            sessions,
            &base64::engine::general_purpose::STANDARD.encode(image),
            32,
        ).expect("extract IBM sample page");
        assert!(output.contains('<'), "expected DocTags, got {output:?}");
    }

    #[test]
    #[ignore = "full local ONNX integration test for the requested curriculum bookmark"]
    fn extract_calculus_volume_1_substitution_to_content_log() {
        const PDF_PATH: &str = r"A:\study\curriculum\calculus-volume-1_-_WEB.pdf";
        const FIRST_PAGE: u32 = 514;
        const LAST_PAGE: u32 = 523;
        const CONTENT_LOG: &str = r"A:\studyus_app\docling-substitution-content.log";

        let _ = std::fs::remove_file(CONTENT_LOG);
        let app_data = std::env::var("APPDATA")
            .map(PathBuf::from)
            .expect("APPDATA must be set on Windows")
            .join("com.studyus.app");
        let sessions = get_sessions(&app_data).expect("load local ONNX sessions");
        let pages = crate::pdf_render::render_page_range(Path::new(PDF_PATH), FIRST_PAGE, LAST_PAGE)
            .expect("render requested 5.5 Substitution page range");
        assert_eq!(pages.len(), (LAST_PAGE - FIRST_PAGE + 1) as usize);

        for (index, page) in pages.iter().enumerate() {
            let page_number = FIRST_PAGE + index as u32;
            let raw = extract_page(&app_data, sessions, &base64::engine::general_purpose::STANDARD.encode(page))
                .unwrap_or_else(|error| panic!("extract PDF page {page_number}: {error}"));
            let mut warnings = Vec::new();
            let (tables, tutor_text) = parse_doctags(&raw, &mut warnings);
            let record = serde_json::json!({
                "suite": "granite_docling_calculus_volume_1_5_5_substitution",
                "page": page_number,
                "rawDocTags": raw,
                "tutorText": tutor_text,
                "tables": tables,
                "warnings": warnings,
            });
            let mut file = std::fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(CONTENT_LOG)
                .expect("open content output log");
            writeln!(file, "{}", record).expect("append extracted page record");
        }
    }

    #[test]
    #[ignore = "extract pages 51-61 from calculus PDF for context capture"]
    fn extract_calculus_pages_51_to_61_to_context_file() {
        const PDF_PATH: &str = r"A:\study\curriculum\calculus-volume-1_-_WEB.pdf";
        const FIRST_PAGE: u32 = 51;
        const LAST_PAGE: u32 = 61;
        const CONTEXT_FILE: &str = r"A:\studyus_app\.cursor\context.txt";

        let _ = std::fs::remove_file(CONTEXT_FILE);
        let app_data = std::env::var("APPDATA")
            .map(PathBuf::from)
            .expect("APPDATA must be set on Windows")
            .join("com.studyus.app");
        let sessions = get_sessions(&app_data).expect("load local ONNX sessions");
        let pages = crate::pdf_render::render_page_range(Path::new(PDF_PATH), FIRST_PAGE, LAST_PAGE)
            .expect("render requested pages 51-61");
        assert_eq!(pages.len(), (LAST_PAGE - FIRST_PAGE + 1) as usize);

        let mut all_text = String::new();
        
        for (index, page) in pages.iter().enumerate() {
            let page_number = FIRST_PAGE + index as u32;
            let raw = extract_page(&app_data, sessions, &base64::engine::general_purpose::STANDARD.encode(page))
                .unwrap_or_else(|error| panic!("extract PDF page {page_number}: {error}"));
            let mut warnings = Vec::new();
            let (_, tutor_text) = parse_doctags(&raw, &mut warnings);
            
            all_text.push_str(&format!("===== PAGE {} =====\n\n", page_number));
            all_text.push_str(&tutor_text);
            all_text.push_str("\n\n");
        }
        
        std::fs::write(CONTEXT_FILE, &all_text).expect("write context file");
        println!("Wrote {} characters to {}", all_text.len(), CONTEXT_FILE);
    }

    #[test]
    fn doctags_parser_collects_tables_and_replaces_with_marker() {
        let raw = "Some text.\n<table>\nrow1\nrow2\n</table>\nTrailing.";
        let mut warnings = Vec::new();
        let (tables, cleaned) = parse_doctags(raw, &mut warnings);
        assert_eq!(tables.len(), 1);
        assert_eq!(tables[0].id, "table-0");
        assert!(cleaned.contains("[Table 0]"));
        assert!(!cleaned.contains("<table>"));
    }

    #[test]
    fn image_preprocess_shape_is_nchw() {
        // 1×1 transparent PNG, base64-encoded (verified hex → b64).
        let png_b64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1M94AAAABZJREFUGFdj+M8AAAACAAFzp4GfjQAAAABJRU5ErkJggg==";
        let (tensor, mask) = preprocess_image(png_b64).expect("preprocess");
        assert_eq!(tensor.shape(), &[1, 1, 3, 512, 512]);
        assert_eq!(mask.shape(), &[1, 1, 512, 512]);
    }
}
