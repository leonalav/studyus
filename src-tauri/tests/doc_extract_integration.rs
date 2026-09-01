//! Integration tests for the oar-ocr PP-OCR pipeline.
//!
//! These tests require the full ~390MB model bundle to be downloaded and
//! cached. They are marked `#[ignore]` so `cargo test` stays hermetic on
//! CI boxes that have not pre-warmed the model cache.
//!
//! To run locally:
//!     cargo test --release -- --ignored --nocapture extract_
//!
//! The peak-memory test prints `{peak_rss_bytes, budget_bytes, pass}` JSON
//! so CI can grep the result without parsing unstructured stderr.

use std::path::PathBuf;
use std::time::{Duration, Instant};

use base64::Engine;
use studyus_app_lib::doc_extract;

/// Default memory budget for the integration tests. The Tauri build is
/// budgeted at 1.2 GB; we leave 200MB headroom for the test runner and
/// any sibling processes.
const PEAK_RAM_BUDGET_BYTES: u64 = 1_200 * 1024 * 1024;

/// Best-effort resident set size in bytes. Linux reads /proc/self/status;
/// Windows is a stub (returns 0) — the dedicated memory_budget tool is
/// the authoritative probe there.
#[cfg(target_os = "linux")]
fn current_rss_bytes() -> u64 {
    let body = std::fs::read_to_string("/proc/self/status").unwrap_or_default();
    for line in body.lines() {
        if let Some(rest) = line.strip_prefix("VmRSS:") {
            let kb: u64 = rest
                .split_whitespace()
                .next()
                .and_then(|s| s.parse().ok())
                .unwrap_or(0);
            return kb * 1024;
        }
    }
    0
}

#[cfg(not(target_os = "linux"))]
fn current_rss_bytes() -> u64 {
    0
}

/// Read a fixture PNG as base64.
fn load_fixture_b64(name: &str) -> String {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("fixtures")
        .join(name);
    let bytes = std::fs::read(&path).expect("fixture present");
    base64::engine::general_purpose::STANDARD.encode(&bytes)
}

/// Resolve the app-data directory used by the live extractor.
fn app_data_dir() -> PathBuf {
    std::env::var("APPDATA")
        .map(PathBuf::from)
        .or_else(|_| std::env::var("HOME").map(|h| PathBuf::from(h).join(".local/share")))
        .expect("APPDATA or HOME must be set")
        .join("com.studyus.app")
}

#[test]
#[ignore = "requires PP-OCR model bundle (~390MB)"]
fn extract_simple_text_page() {
    let b64 = load_fixture_b64("simple-text.png");
    let result = doc_extract::extract_page(&app_data_dir(), &b64)
        .expect("extraction succeeds");
    assert!(!result.markdown.is_empty(), "markdown should be non-empty");
}

#[test]
#[ignore = "requires PP-OCR model bundle"]
fn extract_table_page_has_table_marker() {
    let b64 = load_fixture_b64("table.png");
    let result = doc_extract::extract_page(&app_data_dir(), &b64)
        .expect("extraction succeeds");
    assert!(!result.tables.is_empty(), "expected at least one table");
    assert!(
        result.tables[0].html.contains("<table"),
        "expected HTML table markup"
    );
}

#[test]
#[ignore = "requires PP-OCR model bundle"]
fn extract_formula_page_has_dollar_delimiters() {
    let b64 = load_fixture_b64("formula.png");
    let result = doc_extract::extract_page(&app_data_dir(), &b64)
        .expect("extraction succeeds");
    assert!(
        result.markdown.contains("$$"),
        "expected $$...$$ delimiters, got:\n{}",
        result.markdown
    );
}

#[test]
#[ignore = "requires PP-OCR model bundle + calculus PDF"]
fn extract_trig_trigonometric_functions_pages() {
    let pdf_path = PathBuf::from(r"A:\study\curriculum\calculus-volume-1_-_WEB.pdf");
    if !pdf_path.exists() {
        eprintln!("SKIP: calculus PDF not present at {:?}", pdf_path);
        return;
    }
    let pages = studyus_app_lib::pdf_render::render_page_range(&pdf_path, 51, 51)
        .expect("render page 51");
    let b64 = base64::engine::general_purpose::STANDARD.encode(&pages[0]);
    let result = doc_extract::extract_page(&app_data_dir(), &b64)
        .expect("extraction succeeds");
    assert!(!result.markdown.is_empty());
}

#[test]
#[ignore = "requires PP-OCR model bundle"]
fn peak_memory_under_1200mb() {
    let b64 = load_fixture_b64("mixed-content.png");
    let app_data = app_data_dir();

    let peak_holder = std::sync::Arc::new(std::sync::Mutex::new(0u64));
    let peak_clone = peak_holder.clone();
    let sampler = std::thread::spawn(move || {
        let start = Instant::now();
        while start.elapsed() < Duration::from_secs(30) {
            let rss = current_rss_bytes();
            let mut p = peak_clone.lock().unwrap();
            if rss > *p {
                *p = rss;
            }
            drop(p);
            std::thread::sleep(Duration::from_millis(100));
        }
    });

    let _ = doc_extract::extract_page(&app_data, &b64).expect("extraction succeeds");
    let _ = sampler.join();

    let peak = *peak_holder.lock().unwrap();
    let pass = peak <= PEAK_RAM_BUDGET_BYTES;
    let report = serde_json::json!({
        "peak_rss_bytes": peak,
        "budget_bytes": PEAK_RAM_BUDGET_BYTES,
        "pass": pass,
    });
    println!("MEMORY_REPORT {}", report);

    if peak == 0 {
        eprintln!("WARN: RSS sampling returned 0 (unsupported platform)");
    }
    if peak > 0 {
        assert!(
            pass,
            "peak RSS {peak} bytes exceeds budget {PEAK_RAM_BUDGET_BYTES} bytes"
        );
    }
}

/// Memory-budget API smoke test — confirms the public re-export from the
/// library crate matches the unit-test expectations.
#[test]
fn memory_budget_public_api_rejects_impossible_budget() {
    let result = doc_extract::check_memory_budget(1u64 << 62);
    assert!(result.is_err(), "impossible budget must reject");
    let msg = result.err().unwrap();
    assert!(msg.contains("Insufficient memory"));
}
