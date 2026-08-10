//! PDF page rasterization via PDFium.
//!
//! OpenStax renders display math (equations, diagrams, coordinate axes) as
//! vector drawings rather than selectable text, so text extraction silently
//! loses the math. Instead we rasterize the pages of a syllabus section to PNG
//! images and hand them to a vision LLM, which can read the equations and
//! transcribe them as LaTeX.
//!
//! PDFium is loaded dynamically at runtime from `pdfium.dll` (vendored under
//! `src-tauri/pdfium/` and copied next to the executable by `build.rs`).
//! Ported from leonalav/studyus-provisional-repo.

use std::io::Cursor;
use std::path::{Path, PathBuf};

use pdfium_render::prelude::*;

/// Target width in pixels for rendered pages. Letter-size OpenStax pages at this
/// width land around ~180 DPI: enough for the vision model to read subscripts,
/// fraction bars, and integral limits without ballooning the payload size.
const TARGET_WIDTH: i32 = 1500;

/// Cap on pages rendered per call, bounding both render time and the size of the
/// multimodal payload sent to the LLM. Leaf sections rarely exceed this; the
/// guard mainly protects against accidentally rendering a whole chapter.
const MAX_PAGES_PER_CALL: usize = 12;

/// Render an inclusive, 1-based page range of a PDF to a list of PNG byte
/// buffers (one per page), returned base64-encoded for transport to the frontend.
pub fn render_page_range(
    pdf_path: &Path,
    page_start: u32,
    page_end: u32,
) -> Result<Vec<Vec<u8>>, String> {
    if !pdf_path.exists() {
        return Err(format!("PDF not found: {}", pdf_path.display()));
    }
    if page_start == 0 || page_end < page_start {
        return Err(format!("invalid page range {page_start}..={page_end}"));
    }

    let pdfium = bind()?;
    let document = pdfium
        .load_pdf_from_file(pdf_path, None)
        .map_err(|e| format!("failed to open {}: {e}", pdf_path.display()))?;

    let page_count = document.pages().len() as u32;
    let render_config = PdfRenderConfig::new().set_target_width(TARGET_WIDTH);

    let mut out: Vec<Vec<u8>> = Vec::new();
    // page_start/page_end are 1-based inclusive; PDFium page indices are 0-based.
    let last = page_end.min(page_count);
    for page_no in page_start..=last {
        if out.len() >= MAX_PAGES_PER_CALL {
            break;
        }
        let index = (page_no - 1) as i32;
        let page = document
            .pages()
            .get(index)
            .map_err(|e| format!("failed to load page {page_no}: {e}"))?;
        let image = page
            .render_with_config(&render_config)
            .map_err(|e| format!("failed to render page {page_no}: {e}"))?
            .as_image()
            .map_err(|e| format!("failed to convert page {page_no} to image: {e}"))?;
        let mut bytes: Vec<u8> = Vec::new();
        image
            .write_to(&mut Cursor::new(&mut bytes), image::ImageFormat::Png)
            .map_err(|e| format!("failed to encode page {page_no} to PNG: {e}"))?;
        out.push(bytes);
    }

    if out.is_empty() {
        return Err("no pages were rendered".to_string());
    }
    Ok(out)
}

/// Cap on pages whose text we extract per call. Larger than the render cap
/// because text is cheap compared to rasterization.
const MAX_TEXT_PAGES_PER_CALL: usize = 40;

/// Extract the prose text of an inclusive, 1-based page range, one `String` per
/// page. Pages that are blank or whose text is empty come back as empty strings.
///
/// NOTE: OpenStax renders display math as vector drawings, so extracted text has
/// holes where equations sit. That's acceptable for tutor grounding prose;
/// faithful math comes from the vision path in `render_page_range`.
pub fn extract_text_range(
    pdf_path: &Path,
    page_start: u32,
    page_end: u32,
) -> Result<Vec<String>, String> {
    if !pdf_path.exists() {
        return Err(format!("PDF not found: {}", pdf_path.display()));
    }
    if page_start == 0 || page_end < page_start {
        return Err(format!("invalid page range {page_start}..={page_end}"));
    }

    let pdfium = bind()?;
    let document = pdfium
        .load_pdf_from_file(pdf_path, None)
        .map_err(|e| format!("failed to open {}: {e}", pdf_path.display()))?;

    let page_count = document.pages().len() as u32;
    let last = page_end.min(page_count);

    let mut out: Vec<String> = Vec::new();
    for page_no in page_start..=last {
        if out.len() >= MAX_TEXT_PAGES_PER_CALL {
            break;
        }
        let index = (page_no - 1) as i32;
        let page = document
            .pages()
            .get(index)
            .map_err(|e| format!("failed to load page {page_no}: {e}"))?;
        let text = page
            .text()
            .map(|t| t.all())
            .unwrap_or_default();
        out.push(text);
    }

    if out.is_empty() {
        return Err("no pages were read".to_string());
    }
    Ok(out)
}

use std::sync::{Arc, OnceLock};

static PDFIUM: OnceLock<Result<Arc<Pdfium>, String>> = OnceLock::new();

/// Locate and bind the PDFium dynamic library. Tries the executable's directory
/// first (where `build.rs` copies the vendored DLL and where Tauri bundles the
/// resource), then one level up (covers `target/<profile>/deps/` during tests),
/// then the current working dir, and finally any system-installed copy.
fn bind() -> Result<Arc<Pdfium>, String> {
    PDFIUM.get_or_init(|| {
        for dir in library_dir_candidates() {
            let name = Pdfium::pdfium_platform_library_name_at_path(&dir);
            if name.exists() {
                if let Ok(bindings) = Pdfium::bind_to_library(&name) {
                    return Ok(Arc::new(Pdfium::new(bindings)));
                }
            }
        }
        Pdfium::bind_to_system_library()
            .map(|b| Arc::new(Pdfium::new(b)))
            .map_err(|e| {
                format!("could not load PDFium library (pdfium.dll must sit next to the executable): {e}")
            })
    }).clone()
}

fn library_dir_candidates() -> Vec<PathBuf> {
    let mut dirs: Vec<PathBuf> = Vec::new();
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            dirs.push(dir.join("resources").join("pdfium"));
            dirs.push(dir.join("resources"));
            dirs.push(dir.join("pdfium"));
            dirs.push(dir.to_path_buf());
            if let Some(up) = dir.parent() {
                dirs.push(up.join("resources").join("pdfium"));
                dirs.push(up.join("resources"));
                dirs.push(up.to_path_buf());
            }
        }
    }
    if let Ok(cwd) = std::env::current_dir() {
        dirs.push(cwd.join("resources").join("pdfium"));
        dirs.push(cwd.join("resources"));
        dirs.push(cwd.join("pdfium"));
        dirs.push(cwd);
    }
    dirs
}
