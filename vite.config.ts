import path from "path";
import { fileURLToPath } from "url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import { viteSingleFile } from "vite-plugin-singlefile";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Tauri bundles the normal multi-file Vite output, so the single-file inliner
// must be skipped when building under Tauri. `STUDYUS_TAURI=1` is set by the
// `tauri` npm scripts; the plain `npm run build` keeps producing a single
// inlined HTML for the browser standalone path.
const isTauriBuild = process.env.STUDYUS_TAURI === "1";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), ...(isTauriBuild ? [] : [viteSingleFile()])],
  // Tauri consumes a relative-asset index; the single-file path inlines
  // everything, so a non-base build is correct for both.
  base: isTauriBuild ? "./" : "./",
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  server: {
    host: "0.0.0.0",
    port: 5173,
    allowedHosts: true,
    watch: {
      ignored: ["**/src-tauri/target/**"],
    },
  },
  // Under Tauri, watch must not race the Rust process monitor. Keep HMR off the
  // stricter debounce so the webview picks up edits without a manual reload.
  ...(isTauriBuild ? { clearScreen: false } : {}),
  test: {
    // Agent worktrees under .claude/ are full source copies; without this the
    // runner collects every test three times and reports triple counts.
    exclude: ["**/node_modules/**", "**/dist/**", "**/.claude/**", "**/src-tauri/**"],
  },
});

