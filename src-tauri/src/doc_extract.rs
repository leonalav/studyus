//! Fast document extraction via PP-OCR (layout, table, formula, text OCR).
//!
//! Uses oar-ocr with CPU-optimized models (~390 MB total):
//!   - Layout: pp-doclayout_plus-l (123.7 MB) — formula-aware layout detection
//!   - Table classify: pp-lcnet_x1_0_table_cls (6.5 MB)
//!   - Table structure: slanet_plus (7.4 MB)
//!   - Text detect: pp-ocrv6_small_det (9.4 MB)
//!   - Text recognize: pp-ocrv6_small_rec + dict (20.2 MB)
//!   - Formula: pp-formulanet_plus-s + tokenizer (221.1 MB)
//!
//! Performance: ~0.2-2s per page (vs. 96s for Granite Docling).

use std::fs;
use std::path::Path;
use serde::Serialize;
use oar_ocr::prelude::*;

/// Total estimated download size (in bytes) for all models.
pub const TOTAL_BYTES: u64 = 390_000_000;

/// Extraction result with markdown text, tables, and warnings.
#[derive(Debug, Clone, Serialize)]
pub struct ExtractionResult {
    pub markdown: String,
    pub tables: Vec<TableData>,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct TableData {
    pub id: String,
    pub html: String,
}

/// Extract document structure from a base64-encoded PNG image.
pub fn extract_page(app_data: &Path, png_base64: &str) -> Result<ExtractionResult, String> {
    // Decode base64 PNG
    let png_bytes = base64::Engine::decode(
        &base64::engine::general_purpose::STANDARD,
        png_base64,
    ).map_err(|e| format!("base64 decode: {e}"))?;

    // Save PNG to temporary file (oar-ocr's predict expects a file path)
    let temp_dir = app_data.join("temp");
    fs::create_dir_all(&temp_dir)
        .map_err(|e| format!("create temp dir: {e}"))?;
    
    let temp_image = temp_dir.join(format!("page_{}.png", 
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis()
    ));
    
    fs::write(&temp_image, &png_bytes)
        .map_err(|e| format!("write temp image: {e}"))?;

    // Build PP-OCR structure using v0.9.2 API with registered model names
    // The auto-download feature will download missing models from ModelScope
    let structure = OARStructureBuilder::new("pp-doclayout_plus-l.onnx")
        .with_table_classification("pp-lcnet_x1_0_table_cls.onnx")
        .with_table_structure_recognition("slanet_plus.onnx", "wireless")
        .table_structure_dict_path("table_structure_dict_ch.txt")
        .with_ocr(
            "pp-ocrv6_small_det.onnx",
            "pp-ocrv6_small_rec.onnx",
            "ppocrv6_dict.txt",
        )
        .with_formula_recognition(
            "pp-formulanet_plus-s.onnx",
            "pp-formulanet_plus-s_tokenizer.json",
            "pp_formulanet",
        )
        .build()
        .map_err(|e| format!("build PP-OCR structure: {e}"))?;

    // Run prediction
    eprintln!("DEBUG: Running prediction on {:?}...", temp_image);
    let result = structure.predict(&temp_image)
        .map_err(|e| format!("PP-OCR predict: {e}"))?;

    // Clean up temp file
    let _ = fs::remove_file(&temp_image);

    // Convert result to markdown using built-in method
    let markdown = result.to_markdown();

    // Extract tables if present (parse from markdown or use structured data if available)
    let tables = Vec::new(); // TODO: Extract table data from result
    let warnings = Vec::new();

    Ok(ExtractionResult {
        markdown,
        tables,
        warnings,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::Engine;
    use std::path::PathBuf;

    #[test]
    #[ignore = "requires PP-OCR models to be downloaded"]
    fn test_extract_sample_page() {
        let app_data = std::env::var("APPDATA")
            .map(PathBuf::from)
            .expect("APPDATA must be set")
            .join("com.studyus.app");
        
        // Use a simple test image (1x1 transparent PNG)
        let png_b64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1M94AAAABZJREFUGFdj+M8AAAACAAFzp4GfjQAAAABJRU5ErkJggg==";
        
        let result = extract_page(&app_data, png_b64);
        assert!(result.is_ok(), "extraction failed: {:?}", result.err());
    }

    #[test]
    #[ignore = "requires PP-OCR models and calculus PDF"]
    fn test_extract_calculus_page_51() {
        const PDF_PATH: &str = r"A:\study\curriculum\calculus-volume-1_-_WEB.pdf";
        
        let app_data = std::env::var("APPDATA")
            .map(PathBuf::from)
            .expect("APPDATA must be set")
            .join("com.studyus.app");
        
        // Render page 51
        let pages = crate::pdf_render::render_page_range(Path::new(PDF_PATH), 51, 51)
            .expect("render page 51");
        
        let png_b64 = base64::engine::general_purpose::STANDARD.encode(&pages[0]);
        
        let result = extract_page(&app_data, &png_b64)
            .expect("extract page 51");
        
        println!("Extracted markdown:\n{}", result.markdown);
        assert!(!result.markdown.is_empty(), "markdown should not be empty");
    }
}
