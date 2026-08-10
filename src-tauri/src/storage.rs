//! Persist uploaded curriculum PDFs to the app data directory so pdfium can
//! re-open them later for lazy per-node rasterization. The browser single-file
//! build has no equivalent; this is desktop-only.

use std::fs;
use std::path::PathBuf;

/// Write the bytes of an uploaded curriculum PDF to `<app_data>/curriculum/<name>`.
/// Returns the absolute path, which the frontend stores as the source's
/// `file_path` via `transcribeNode` / pdfium's `load_pdf_from_file`.
///
/// `name` is sanitized to a filesystem-safe segment; collisions overwrite the
/// previous upload of the same name (acceptable: an updated syllabus replaces
/// the old one).
pub fn save_source_pdf(app_data_dir: &PathBuf, name: &str, bytes: &[u8]) -> Result<String, String> {
    let dir = app_data_dir.join("curriculum");
    fs::create_dir_all(&dir).map_err(|e| format!("could not create {}: {e}", dir.display()))?;

    let safe = sanitize_filename(name);
    if safe.is_empty() {
        return Err("invalid source file name".to_string());
    }
    let path = dir.join(&safe);
    fs::write(&path, bytes).map_err(|e| format!("could not write {}: {e}", path.display()))?;
    Ok(path.to_string_lossy().into_owned())
}

/// Map a learner-supplied filename to a safe single-segment name, preserving the
/// extension. Rejects path separators and NUL; collapses dots.
fn sanitize_filename(name: &str) -> String {
    let trimmed = name.trim();
    let mut out = String::with_capacity(trimmed.len());
    for ch in trimmed.chars() {
        if ch == '/' || ch == '\\' || ch == '\0' {
            continue;
        }
        out.push(ch);
    }
    // Collapse leading dots so we never produce a hidden/relative path segment.
    out.trim_start_matches('.').to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitize_strips_separators_and_leading_dots() {
        assert_eq!(sanitize_filename("../evil.pdf"), "evil.pdf");
        assert_eq!(sanitize_filename(r"a/b\c.pdf"), "abc.pdf");
        assert_eq!(sanitize_filename("Calculus Vol 1.pdf"), "Calculus Vol 1.pdf");
    }
}
