/**
 * Production-safe dev logging.
 *
 * Mirrors the guard used inside `turnTrace.ts:40`: every tutor-trace,
 * tutor-diag, `extractJsonPayload`, and `validatePlan` debug log goes
 * through `devLog` so production bundles ship zero diagnostic output.
 *
 * `process.env.NODE_ENV` is the only reliable "is this a dev build"
 * signal available to both Vite (which inlines it) and sql.js bundles
 * (which tree-shake the false branch). The guard is intentionally
 * cheap and side-effect-free so it can live at module scope.
 *
 * `console.error` is NOT routed through here — a real failure must
 * always reach the console, regardless of build mode.
 */

// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
export const IS_DEV: boolean =
  typeof process !== "undefined" &&
  (process as { env?: { NODE_ENV?: string } }).env?.NODE_ENV !== "production";

/** Like `console.log`, but no-op in production. */
export function devLog(...args: unknown[]): void {
  if (IS_DEV) {
    // eslint-disable-next-line no-console
    console.log(...args);
  }
}

/** Like `console.warn`, but no-op in production. Reserved for the tutor trace,
 *  not for genuine errors (which use `console.error` directly). */
export function devWarn(...args: unknown[]): void {
  if (IS_DEV) {
    // eslint-disable-next-line no-console
    console.warn(...args);
  }
}

/** `console.groupCollapsed` for tutor traces. Inert in production. */
export function devGroupCollapsed(label: string, css?: string): void {
  if (!IS_DEV) return;
  if (typeof console === "undefined" || typeof console.groupCollapsed !== "function") return;
  // eslint-disable-next-line no-console
  console.groupCollapsed(label, css ?? "");
}

/** Closes a `devGroupCollapsed` opened with `devGroupCollapsed`. */
export function devGroupEnd(): void {
  if (!IS_DEV) return;
  if (typeof console === "undefined" || typeof console.groupEnd !== "function") return;
  // eslint-disable-next-line no-console
  console.groupEnd();
}