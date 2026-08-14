#!/usr/bin/env node
// Cross-platform launcher for the Tauri CLI.
//
// The `pnpm tauri*` scripts used to hardcode `CARGO_TARGET_DIR=C:/rust_targets`
// via cross-env so Windows builds dodge MAX_PATH issues. That value is a
// Windows-only absolute path; on macOS/Linux cargo would treat it as a literal
// relative path and dump all output into a `C:` folder inside src-tauri.
// This launcher keeps the exact Windows behavior and simply omits the variable
// on other platforms. `STUDYUS_TAURI=1` (see vite.config.ts) is set everywhere.
import { spawn } from "node:child_process";

const isWindows = process.platform === "win32";
const args = process.argv.slice(2);

const child = spawn("tauri", args, {
  stdio: "inherit",
  shell: isWindows,
  env: {
    ...process.env,
    STUDYUS_TAURI: "1",
    ...(isWindows ? { CARGO_TARGET_DIR: "C:/rust_targets" } : {}),
  },
});

child.on("error", (err) => {
  console.error(`scripts/tauri.mjs: failed to start the tauri CLI: ${err.message}`);
  process.exit(1);
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
