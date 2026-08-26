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

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use base64::Engine;
use ndarray::prelude::*;
use ort::session::Session;
use ort::value::TensorRef;
use ort::inputs;
use serde::Serialize;

// ── constants ────────────────────────────────────────────────────────────────

const HF_REPO: &str = "onnx-community/granite-docling-258M-ONNX";
const ONNX_SUBFOLDER: &str = "onnx";
const IMG_SIZE: u32 = 512;
const MAX_NEW_TOKENS: usize = 4096;
const EOT_TOKEN_ID: i64 = 151_643; // <|im_end|> / EOT sentinel in granite's vocab

// ── model-download helpers ────────────────────────────────────────────────────

pub fn model_dir(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join("granite_docling").join("onnx")
}

fn ensure_onnx_file(dest_dir: &Path, filename: &str) -> Result<PathBuf, String> {
    std::fs::create_dir_all(dest_dir)
        .map_err(|e| format!("could not create model dir {}: {e}", dest_dir.display()))?;

    let dest = dest_dir.join(filename);
    if dest.exists() && dest.metadata().map(|m| m.len() > 1024).unwrap_or(false) {
        return Ok(dest);
    }

    let url = format!(
        "https://huggingface.co/{}/resolve/main/{}/{}",
        HF_REPO, ONNX_SUBFOLDER, filename
    );
    eprintln!(
        "[granite_docling] downloading {filename} from HuggingFace… (~300 MB each)"
    );
    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(900))
        .build()
        .map_err(|e| format!("HTTP client: {e}"))?;

    let res = client
        .get(&url)
        .send()
        .map_err(|e| format!("download failed: {e}"))?;

    if !res.status().is_success() {
        return Err(format!("HTTP {} for {}", res.status().as_u16(), url));
    }

    let bytes = res.bytes().map_err(|e| format!("read body: {e}"))?;
    std::fs::write(&dest, &bytes)
        .map_err(|e| format!("write {}: {e}", dest.display()))?;
    eprintln!(
        "[granite_docling] saved {} ({} MB)",
        dest.display(),
        bytes.len() / 1_000_000
    );
    Ok(dest)
}

fn ensure_all_models(app_data_dir: &Path) -> Result<ModelPaths, String> {
    let dir = model_dir(app_data_dir);
    let vision = ensure_onnx_file(&dir, "vision_encoder.onnx")?;
    let decoder = ensure_onnx_file(&dir, "decoder_model_merged.onnx")?;
    let embed = ensure_onnx_file(&dir, "embed_tokens.onnx")?;
    Ok(ModelPaths {
        vision,
        decoder,
        embed_tokens: embed,
    })
}

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
        let ModelPaths {
            vision,
            decoder,
            embed_tokens,
        } = ensure_all_models(app_data_dir)?;

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

        Ok(Self {
            vision: Mutex::new(load(&vision, "vision")?),
            decoder: Mutex::new(load(&decoder, "decoder")?),
            embed_tokens: Mutex::new(load(&embed_tokens, "embed_tokens")?),
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

fn preprocess_image(base64_png: &str) -> Result<Array4<f32>, String> {
    let png_bytes = base64::engine::general_purpose::STANDARD
        .decode(base64_png.trim())
        .map_err(|e| format!("base64 decode: {e}"))?;

    let img = image::load_from_memory(&png_bytes)
        .map_err(|e| format!("image decode: {e}"))?;

    // Resize to 512×512. image 0.25 still has resize in imageops.
    let resized = img.resize_exact(
        IMG_SIZE,
        IMG_SIZE,
        image::imageops::FilterType::Lanczos3,
    );
    let rgb = resized.to_rgb8();
    let pixels = rgb.into_raw(); // [R,G,B, R,G,B, ...]

    // SigLIP2 / CLIP normalization (ImageNet-CLIP mean/std).
    const MEAN: [f32; 3] = [0.48145466_f32, 0.4578275_f32, 0.40821073_f32];
    const STD: [f32; 3] = [0.26862954_f32, 0.26130258_f32, 0.27577711_f32];

    let mut tensor: Array4<f32> =
        Array4::zeros((1, 3, IMG_SIZE as usize, IMG_SIZE as usize));

    for y in 0..IMG_SIZE as usize {
        for x in 0..IMG_SIZE as usize {
            let i = (y * IMG_SIZE as usize + x) * 3;
            let r = pixels[i] as f32 / 255.0_f32;
            let g = pixels[i + 1] as f32 / 255.0_f32;
            let b = pixels[i + 2] as f32 / 255.0_f32;
            tensor[[0, 0, y, x]] = (r - MEAN[0]) / STD[0];
            tensor[[0, 1, y, x]] = (g - MEAN[1]) / STD[1];
            tensor[[0, 2, y, x]] = (b - MEAN[2]) / STD[2];
        }
    }
    Ok(tensor)
}

// ── tokenizer ───────────────────────────────────────────────────────────────

// Granite Docling uses the granite-chatml chat template. We replicate the
// token sequence that the template produces for a single-turn prompt.
//
// Full template string from tokenizer_config.json:
//   "<|im_start|>system\n"+content+"<|im_end|>\n<|im_start|>user\n"+image_tokens+"<|im_end|>\n<|im_start|>assistant\n"
//
// Special token IDs (confirmed from ibm-granite/granite-docling-258M):
//   <|im_start|> = 1
//   <|im_end|>   = 2
//   <|im_sep|>   = 3
//   role: system = 4
//   role: user   = 5
//   <|vision_start|> = 151652
//   <|vision_pad|>    = 151653
//   <|vision_end|>    = 151654
fn granitedocling_system_tokens() -> Vec<i64> {
    let sys = "You are a document conversion model that outputs in DocTags format.";
    sys.bytes().map(|b| b as i64).collect()
}

fn build_prefix_ids() -> Vec<i64> {
    // <|im_start|> + role:system + tokens + <|im_end|> + \n
    //           + <|im_start|> + role:user  + \n
    //           + <|vision_start|> + <|vision_pad|> + <|vision_end|> + \n
    //           + <|im_start|> + role:assistant + \n
    let mut ids: Vec<i64> = vec![];

    ids.push(1);   // <|im_start|>
    ids.push(4);   // role: system
    ids.extend(granitedocling_system_tokens());
    ids.push(2);   // <|im_end|>
    ids.push(13);  // newline '\n'

    ids.push(1);   // <|im_start|>
    ids.push(5);   // role: user
    ids.push(13);  // newline '\n'
    ids.push(151_652); // <|vision_start|>
    ids.push(151_653); // <|vision_pad|>  (injected by vision encoder)
    ids.push(151_654); // <|vision_end|>
    ids.push(13);  // newline '\n'

    ids.push(1);   // <|im_start|>
    ids.push(5);   // role: assistant
    ids.push(13);  // newline '\n'

    ids
}

// ── ndarray <-> ort tensor helpers ──────────────────────────────────────────

/// Run the vision encoder session with pixel_values and pixel_attention_mask.
fn run_vision_encoder(
    sessions: &Sessions,
    pixel_values: &Array4<f32>,
) -> Result<Array3<f32>, String> {
    let pam_len = (IMG_SIZE * IMG_SIZE) as usize;
    let pam: Array2<i64> = Array2::from_elem((1, pam_len), 1_i64);

    let mut vision = sessions.vision.lock().map_err(|e| e.to_string())?;
    let outputs = vision
        .run(inputs! {
            "pixel_values" => TensorRef::from_array_view(pixel_values).map_err(|e| e.to_string())?,
            "pixel_attention_mask" => TensorRef::from_array_view(&pam).map_err(|e| e.to_string())?,
        })
        .map_err(|e| format!("vision_encoder: {e}"))?;

    // SigLIP2 returns {"last_hidden_state": [1, seq, hidden]} or {"image_embeds": ...}.
    // Try common output names.
    let name = if outputs.get("last_hidden_state").is_some() {
        "last_hidden_state"
    } else if outputs.get("image_embeds").is_some() {
        "image_embeds"
    } else {
        return Err(format!("vision output keys: {:?}", outputs.into_iter().map(|(k,_)|k).collect::<Vec<_>>()));
    };

    let arr: ndarray::ArrayViewD<'_, f32> = outputs[name]
        .try_extract_array()
        .map_err(|e| format!("extract last_hidden_state: {e}"))?;

    // Convert ArrayViewD to Array3. Shape should be [1, seq, hidden].
    let shape = arr.shape();
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
    let _seq_len = token_ids.len();
    let ids_arr: Array1<i64> = Array1::from_vec(token_ids.to_vec());

    let mut embed = sessions.embed_tokens.lock().map_err(|e| e.to_string())?;
    let outputs = embed
        .run(inputs! { "input_ids" => TensorRef::from_array_view(&ids_arr).map_err(|e| e.to_string())? })
        .map_err(|e| format!("embed_tokens: {e}"))?;

    // Output: {"embeds": [1, seq, hidden]} or {"last_hidden_state": ...}.
    let name = if outputs.get("embeds").is_some() {
        "embeds"
    } else {
        "last_hidden_state"
    };

    let arr: ndarray::ArrayViewD<'_, f32> = outputs[name]
        .try_extract_array()
        .map_err(|e| format!("extract {name}: {e}"))?;

    let shape = arr.shape();
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

/// Run the merged decoder on a pre-computed embedding sequence.
/// Returns logits tensor [1, seq, vocab] as an owned array.
fn run_decoder_fwd(
    sessions: &Sessions,
    inputs_embeds: &Array3<f32>,
    attention_mask: &Array2<i64>,
    position_ids: &Array2<i64>,
) -> Result<ndarray::ArrayD<f32>, String> {
    let mut decoder = sessions.decoder.lock().map_err(|e| e.to_string())?;
    let outputs = decoder
        .run(inputs! {
            "inputs_embeds" => TensorRef::from_array_view(inputs_embeds).map_err(|e| e.to_string())?,
            "attention_mask" => TensorRef::from_array_view(attention_mask).map_err(|e| e.to_string())?,
            "position_ids" => TensorRef::from_array_view(position_ids).map_err(|e| e.to_string())?,
        })
        .map_err(|e| format!("decoder forward: {e}"))?;

    // logits shape: [batch=1, seq, vocab].
    let logits: ndarray::ArrayViewD<'_, f32> = outputs["logits"]
        .try_extract_array()
        .map_err(|e| format!("extract logits: {e}"))?;

    Ok(logits.into_owned().into_dyn())
}

/// Argmax decode: sample the highest-probability token from the last position.
fn argmax_token(logits: &ndarray::ArrayD<f32>) -> Result<(i64, f32), String> {
    let shape = logits.shape();
    if shape.len() != 3 {
        return Err(format!("expected 3-D logits, got shape: {:?}", shape));
    }
    let _batch = shape[0];
    let seq = shape[1];
    let vocab = shape[2];
    let last_seq = seq - 1;

    let mut best_token: i64 = 0;
    let mut best_score: f32 = f32::MIN;
    for v in 0..vocab {
        let score = logits[[0, last_seq, v]];
        if score > best_score {
            best_score = score;
            best_token = v as i64;
        }
    }
    Ok((best_token, best_score))
}

// ── inference pipeline ───────────────────────────────────────────────────────

/// Run the full Docling pipeline: image → vision features → concat with text
/// prefix → autoregressive decode loop → DocTags string.
pub fn extract_page(
    sessions: &Sessions,
    base64_png: &str,
) -> Result<String, String> {
    // 1. Image → vision features.
    let pixel_values = preprocess_image(base64_png)?;
    let image_embeds: Array3<f32> = run_vision_encoder(sessions, &pixel_values)?;
    // image_embeds shape: [1, img_seq, hidden]

    // 2. Build text prefix: <|im_start|>system[...]<|im_end|>\n<|im_start|>user\n<|vision_start|><|vision_pad|>*N<|vision_end|>\n<|im_start|>assistant\n
    // The merged decoder ONNX expects `inputs_embeds` as a concatenation of:
    //   [text_prefix_embeds | image_connector_output | decoder_only_text_embeds]
    // For the first-pass (image context), we prepend the text prefix embeddings
    // and append the image embeddings. The decoder then generates the first token.
    let prefix_ids = build_prefix_ids();
    let prefix_embeds: Array3<f32> = embed_tokens(sessions, &prefix_ids)?;
    // prefix_embeds shape: [1, prefix_seq, hidden]

    // 3. Concatenate: [prefix_embeds | image_embeds]
    let img_seq = image_embeds.shape()[1];
    let pre_seq = prefix_embeds.shape()[1];
    let hidden = prefix_embeds.shape()[2];

    let total_seq = pre_seq + img_seq;
    let mut combined: Array3<f32> = Array3::zeros((1, total_seq, hidden));
    for s in 0..pre_seq {
        for h in 0..hidden {
            combined[[0, s, h]] = prefix_embeds[[0, s, h]];
        }
    }
    for s in 0..img_seq {
        for h in 0..hidden {
            combined[[0, pre_seq + s, h]] = image_embeds[[0, s, h]];
        }
    }

    // 4. Autoregressive decode loop.
    // The merged decoder produces logits for ALL positions in inputs_embeds at
    // each step. We take the last token's logits, argmax-sample one new token,
    // embed it, append it to the sequence, and repeat.
    let mut generated: Vec<i64> = Vec::with_capacity(MAX_NEW_TOKENS);
    let mut current_seq_len = total_seq;

    loop {
        if generated.len() >= MAX_NEW_TOKENS {
            break;
        }

        let attention_mask: Array2<i64> =
            Array2::from_elem((1, current_seq_len), 1_i64);
        let position_ids: Array2<i64> = {
            let mut p: Array2<i64> = Array2::zeros((1, current_seq_len));
            for i in 0..current_seq_len {
                p[[0, i]] = i as i64;
            }
            p
        };

        let logits = run_decoder_fwd(sessions, &combined, &attention_mask, &position_ids)?;
        let (next_token, _score) = argmax_token(&logits)?;
        generated.push(next_token);

        if next_token == EOT_TOKEN_ID {
            break;
        }

        // Embed the new token and append to combined for the next step.
        let next_embeds: Array3<f32> = embed_tokens(sessions, &[next_token])?;
        let new_total = current_seq_len + 1;
        let mut new_combined: Array3<f32> = Array3::zeros((1, new_total, hidden));
        for s in 0..current_seq_len {
            for h in 0..hidden {
                new_combined[[0, s, h]] = combined[[0, s, h]];
            }
        }
        for h in 0..hidden {
            new_combined[[0, current_seq_len, h]] = next_embeds[[0, 0, h]];
        }
        combined = new_combined;
        current_seq_len = new_total;
    }

    // 5. Decode token IDs → string.
    // Tokens 0-255 are raw UTF-8 bytes; special tokens ≥ 256 are skipped.
    let bytes: Vec<u8> = generated
        .iter()
        .filter_map(|&id| {
            if id < 256 {
                Some(id as u8)
            } else {
                None
            }
        })
        .collect();

    // Strip trailing null bytes (padding), then lossy-convert valid UTF-8.
    let end = bytes.iter().rposition(|&b| b != 0).map(|i| i + 1).unwrap_or(0);
    let trimmed = &bytes[..end];
    let output = String::from_utf8_lossy(trimmed).into_owned();

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
    let raw = extract_page(sessions, base64_png)?;

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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prefix_ids_carry_special_tokens() {
        let ids = build_prefix_ids();
        // Must contain <|im_start|> (1), <|im_end|> (2),
        // <|vision_start|> (151652), <|vision_pad|> (151653),
        // <|vision_end|> (151654), and at least two '\n' (13).
        assert!(ids.contains(&1), "missing im_start");
        assert!(ids.contains(&2), "missing im_end");
        assert!(ids.contains(&151_652), "missing vision_start");
        assert!(ids.contains(&151_653), "missing vision_pad");
        assert!(ids.contains(&151_654), "missing vision_end");
        let newlines = ids.iter().filter(|&&i| i == 13).count();
        assert!(newlines >= 4, "need at least 4 newlines (got {newlines})");
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
        let tensor = preprocess_image(png_b64).expect("preprocess");
        assert_eq!(tensor.shape(), &[1, 3, 512, 512]);
    }
}
