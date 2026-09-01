//! Benchmark binary: end-to-end PDF → markdown extraction on real pages.
//!
//! Renders the given inclusive 1-based page range from a PDF via PDFium,
//! then runs the oar-ocr PP-OCR pipeline on each rendered page and prints:
//!   - per-page render time
//!   - per-page OCR time (model build amortised over the first call)
//!   - per-page markdown length + table count + formula count
//!   - peak RSS during the run
//!   - aggregate JSON summary on the last line
//!
//! Usage:
//!     cargo run --release --bin ocr_benchmark --
//!         "A:\calculus-volume-1_-_WEB-61-73.pdf" 60 61
//!
//! Defaults: PDF = `A:\\calculus-volume-1_-_WEB-61-73.pdf`, pages 60..=61.
//! Exits 0 on success, non-zero on extraction failure.

use std::path::PathBuf;
use std::time::Instant;

use base64::Engine;

use studyus_app_lib::doc_extract;
use studyus_app_lib::pdf_render;

const DEFAULT_PDF: &str = r"A:\calculus-volume-1_-_WEB-61-73.pdf";
const DEFAULT_START: u32 = 60;
const DEFAULT_END: u32 = 61;

fn parse_args() -> (PathBuf, u32, u32) {
    let mut args = std::env::args().skip(1);
    let pdf = args
        .next()
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(DEFAULT_PDF));
    let start = args
        .next()
        .and_then(|s| s.parse::<u32>().ok())
        .unwrap_or(DEFAULT_START);
    let end = args
        .next()
        .and_then(|s| s.parse::<u32>().ok())
        .unwrap_or(start.max(DEFAULT_END));
    (pdf, start, end.max(start))
}

fn current_rss_bytes() -> u64 {
    // Windows: read the working-set size via GetProcessMemoryInfo-free
    // approximation. We use the Get-Process equivalent through the
    // `sysinfo` crate which is already a runtime dep.
    let mut sys = sysinfo::System::new();
    sys.refresh_memory();
    sys.process(sysinfo::get_current_pid().ok().unwrap())
        .map(|p| p.memory() * 1024)
        .unwrap_or(0)
}

fn main() {
    let (pdf_path, page_start, page_end) = parse_args();
    println!("=== oar-ocr benchmark ===");
    println!("PDF:        {}", pdf_path.display());
    println!("Page range: {page_start}..={page_end}");
    println!();

    // 1. PDF → PNG (PDFium)
    let render_start = Instant::now();
    let pages = match pdf_render::render_page_range(&pdf_path, page_start, page_end) {
        Ok(p) => p,
        Err(e) => {
            eprintln!("render_page_range failed: {e}");
            std::process::exit(2);
        }
    };
    let render_ms = render_start.elapsed().as_millis();
    println!(
        "PDFium rendered {} page(s) in {} ms",
        pages.len(),
        render_ms
    );

    // 2. App-data dir for the extractor's temp dir + memory guard.
    let app_data = std::env::var("APPDATA")
        .map(PathBuf::from)
        .or_else(|_| std::env::var("HOME").map(|h| PathBuf::from(h).join(".local/share")))
        .unwrap_or_else(|_| std::env::temp_dir())
        .join("com.studyus.app");

    // 3. Per-page OCR. The first call amortises model build + ONNX session
    //    creation; subsequent calls measure inference alone.
    let mut per_page: Vec<serde_json::Value> = Vec::new();
    let mut peak_rss = current_rss_bytes();
    let mut total_ocr_ms: u128 = 0;

    for (i, png_bytes) in pages.iter().enumerate() {
        let page_no = page_start + i as u32;
        let rss_before = current_rss_bytes();
        let t0 = Instant::now();
        let b64 = base64::engine::general_purpose::STANDARD.encode(png_bytes);
        let result = match doc_extract::extract_page(&app_data, &b64) {
            Ok(r) => r,
            Err(e) => {
                eprintln!("page {page_no} extraction failed: {e}");
                std::process::exit(3);
            }
        };
        let dt = t0.elapsed();
        total_ocr_ms += dt.as_millis();
        let rss_after = current_rss_bytes();
        if rss_after > peak_rss {
            peak_rss = rss_after;
        }

        let formula_count = result.markdown.matches("$$").count() / 2;
        let table_count = result.tables.len();
        let markdown_len = result.markdown.len();
        let png_kb = png_bytes.len() / 1024;

        // Persist the extracted markdown next to the PDF so the human
        // reviewer can spot-check the OCR output against the source.
        let out_path = std::path::PathBuf::from(format!(
            "{}.page_{}.md",
            pdf_path.display(),
            page_no
        ));
        let _ = std::fs::write(&out_path, &result.markdown);

        println!(
            "page {page_no}: {dt_ms:>6} ms | {markdown_len:>6} B markdown | {table_count} tables | {formula_count} formulas | {png_kb} KB PNG | RSS {rss_before_kb}→{rss_after_kb} KB | saved {out}",
            dt_ms = dt.as_millis(),
            markdown_len = markdown_len,
            rss_before_kb = rss_before / 1024,
            rss_after_kb = rss_after / 1024,
            out = out_path.display(),
        );

        per_page.push(serde_json::json!({
            "page": page_no,
            "ocr_ms": dt.as_millis(),
            "markdown_chars": markdown_len,
            "tables": table_count,
            "formulas": formula_count,
            "png_kb": png_kb,
            "rss_before_kb": rss_before / 1024,
            "rss_after_kb": rss_after / 1024,
            "warnings": result.warnings,
        }));

        // Print a small markdown preview for visual sanity-check.
        let preview: String = result
            .markdown
            .chars()
            .take(240)
            .collect::<String>()
            .replace('\n', " ⏎ ");
        println!("    preview: {preview}");
    }

    let avg_ms = if per_page.is_empty() {
        0
    } else {
        total_ocr_ms / per_page.len() as u128
    };

    let summary = serde_json::json!({
        "pdf": pdf_path.display().to_string(),
        "pages": per_page,
        "render_ms": render_ms,
        "ocr_total_ms": total_ocr_ms,
        "ocr_avg_ms": avg_ms,
        "peak_rss_bytes": peak_rss,
        "peak_rss_mb": peak_rss / 1024 / 1024,
        "budget_mb": 1200,
        "pass": peak_rss <= 1_200 * 1024 * 1024,
    });
    println!();
    println!("BENCHMARK_SUMMARY {}", summary);
}
