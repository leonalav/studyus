use std::path::PathBuf;

fn main() {
  copy_pdfium_next_to_exe();
  tauri_build::build()
}

/// PDFium is loaded dynamically at runtime and must sit next to the executable.
/// We vendor the platform DLL under `src-tauri/pdfium/` and copy it into the
/// build output dir (`target/<profile>/`) so `cargo run`/`tauri dev` find it.
/// Release bundling copies it via the tauri.conf.json `resources` entry. If the
/// vendored library is absent, we emit a build warning and continue — the app
/// still builds; PDF rendering fails at runtime with a clear error instead.
fn copy_pdfium_next_to_exe() {
  let manifest_dir = PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap());
  let profile = std::env::var("PROFILE").unwrap_or_else(|_| "debug".to_string());

  #[cfg(target_os = "windows")]
  let lib_name = "pdfium.dll";
  #[cfg(target_os = "macos")]
  let lib_name = "libpdfium.dylib";
  #[cfg(all(unix, not(target_os = "macos")))]
  let lib_name = "libpdfium.so";

  let src = manifest_dir.join("pdfium").join(lib_name);
  println!("cargo:rerun-if-changed={}", src.display());

  if !src.exists() {
    println!(
      "cargo:warning=vendored PDFium library not found at {}; PDF rendering will fail at runtime. Place {} there.",
      src.display(), lib_name
    );
    return;
  }

  let dest_dir = manifest_dir.join("target").join(&profile);
  if let Err(e) = std::fs::create_dir_all(&dest_dir) {
    println!("cargo:warning=could not create {}: {e}", dest_dir.display());
    return;
  }
  let dest = dest_dir.join(lib_name);
  if let Err(e) = std::fs::copy(&src, &dest) {
    println!("cargo:warning=failed to copy PDFium library to {}: {e}", dest.display());
  }
}
