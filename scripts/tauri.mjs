#!/usr/bin/env node
// Cross-platform launcher for the Tauri CLI.
//
// The `pnpm tauri*` scripts set `CARGO_TARGET_DIR=A:/rust_targets` via this
// launcher so Windows builds land on a drive with enough free space (C: has
// only a couple of GB free on this box, which trips `LNK1180: insufficient
// disk space`). The variable is Windows-only absolute path; on macOS/Linux
// cargo would treat it as a literal relative path, so we omit it elsewhere.
// `STUDYUS_TAURI=1` (see vite.config.ts) is set everywhere.
import { spawn } from "node:child_process";

const isWindows = process.platform === "win32";
const args = process.argv.slice(2);

const child = spawn("tauri", args, {
  stdio: "inherit",
  shell: isWindows,
  env: {
    ...process.env,
    STUDYUS_TAURI: "1",
    ...(isWindows ? { CARGO_TARGET_DIR: "A:/rust_targets" } : {}),
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
