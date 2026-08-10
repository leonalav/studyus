# PDFium runtime library

Place the platform PDFium binary here so `build.rs` can copy it next to the
built executable and the app can load it at runtime.

## Windows (this environment)

1. Download the Windows build of PDFium from the community distribution:
   https://github.com/bblanchon/pdfium-binaries/releases  (the `win-x64` asset)
2. Extract the archive; inside, find `bin/pdfium.dll`.
3. Copy it to this directory as `pdfium.dll` (so the path is
   `src-tauri/pdfium/pdfium.dll`).

The build will emit a `cargo:warning=... PDFium library not found ...` message
and the app will still compile if this file is missing — but PDF rendering
(ingestion of curriculum PDFs) will fail at runtime with a clear error.

## macOS / Linux (for cross-builds)

- macOS:   `libpdfium.dylib`
- Linux:    `libpdfium.so`

Tauri also bundles this file into the installed app via the `resources` entry in
`tauri.conf.json`, so the released app finds it under `<exe>/resources/`.
PDFium_BINARIES are distributed under the BSD-style license used by the
pdfium-binaries project; record it in your `LICENSE` notices.
