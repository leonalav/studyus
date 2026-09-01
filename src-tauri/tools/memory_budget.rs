//! Standalone memory budget probe.
//!
//! Loads every model the live `extract_page` path loads, samples RSS via
//! `sysinfo`, and prints a single JSON line with `{peak_rss_bytes,
//! budget_bytes, pass}`. Exits 0 when peak is within budget, 1 otherwise.
//!
//! Usage:
//!     cargo run --release --bin memory_budget
//!     cargo run --release --bin memory_budget -- --budget-mb 1200
//!
//! CI step:
//!     cargo run --release --bin memory_budget > memory_report.json
//!     jq -e '.pass' memory_report.json

use std::path::Path;
use std::time::Duration;

use base64::Engine;
use oar_ocr::prelude::*;

const FIXTURE_PNG_BASE64: &str = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1M94AAAABZJREFUGFdj+M8AAAACAAFzp4GfjQAAAABJRU5ErkJggg==";

/// Pick a writable temp dir for the synthesized PNG. We honour TMPDIR on
/// Linux/macOS and TEMP on Windows, mirroring the live extractor's choice.
fn temp_dir() -> std::path::PathBuf {
    if let Ok(p) = std::env::var("TMPDIR") {
        return std::path::PathBuf::from(p);
    }
    if let Ok(p) = std::env::var("TEMP") {
        return std::path::PathBuf::from(p);
    }
    std::env::temp_dir()
}

fn parse_budget_mb(args: &[String]) -> u64 {
    let mut iter = args.iter();
    while let Some(a) = iter.next() {
        if a == "--budget-mb" {
            if let Some(v) = iter.next() {
                if let Ok(n) = v.parse::<u64>() {
                    return n * 1024 * 1024;
                }
            }
        }
    }
    1_200 * 1024 * 1024
}

fn main() {
    let budget_bytes = parse_budget_mb(&std::env::args().collect::<Vec<_>>());

    // Decode and write the fixture so oar-ocr's `predict(&Path)` works.
    let png_bytes = base64::engine::general_purpose::STANDARD
        .decode(FIXTURE_PNG_BASE64)
        .expect("decode fixture");
    let dir = temp_dir().join("studyus-memory-budget");
    std::fs::create_dir_all(&dir).expect("mkdir");
    let img_path = dir.join("fixture.png");
    std::fs::write(&img_path, &png_bytes).expect("write fixture");

    // Build the full pipeline — every model the live extractor loads is
    // loaded here too, so the peak RSS we measure matches production.
    let structure = OARStructureBuilder::new("pp-doclayout_plus-l.onnx")
        .with_table_classification("pp-lcnet_x1_0_table_cls.onnx")
        .with_wireless_table_structure("slanet_plus.onnx")
        .wireless_table_structure_model_name("SLANet_plus")
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
        .expect("build structure");

    // Sample RSS every 100ms for the duration of the extraction window.
    let peak_holder = std::sync::Arc::new(std::sync::Mutex::new(0u64));
    let peak_clone = peak_holder.clone();
    let stop = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    let stop_clone = stop.clone();
    let sampler = std::thread::spawn(move || {
        let mut sys = sysinfo::System::new();
        while !stop_clone.load(std::sync::atomic::Ordering::Relaxed) {
            sys.refresh_memory();
            let me = sysinfo::get_current_pid().ok().and_then(|p| sys.process(p));
            let rss = me.map(|pr| pr.memory()).unwrap_or(0) * 1024;
            let mut p = peak_clone.lock().unwrap();
            if rss > *p {
                *p = rss;
            }
            drop(p);
            std::thread::sleep(Duration::from_millis(100));
        }
    });

    let _ = structure
        .predict(Path::new(&img_path))
        .expect("predict fixture");
    stop.store(true, std::sync::atomic::Ordering::Relaxed);
    let _ = sampler.join();

    let peak_rss_bytes = *peak_holder.lock().unwrap();
    let pass = peak_rss_bytes <= budget_bytes;

    let report = serde_json::json!({
        "peak_rss_bytes": peak_rss_bytes,
        "budget_bytes": budget_bytes,
        "pass": pass,
    });
    println!("{}", report);

    let _ = std::fs::remove_file(&img_path);

    if pass {
        std::process::exit(0);
    }
    std::process::exit(1);
}
