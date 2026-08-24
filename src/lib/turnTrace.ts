/**
 * Standalone latency-instrumentation module for tutor turns.
 *
 * Designed for the agent runtime to write per-attempt timings into the same
 * trace without importing tutor.ts. Safe to call in any order -- out-of-order
 * usage never throws.
 *
 * HARD CONSTRAINTS:
 *  - NO database writes. Instrumenting latency with a mechanism that itself
 *    serializes the database would contaminate the measurement.
 *  - NO persistence, schema, or migration.
 *  - Never records learner message content, prompt text, credentials, API keys,
 *    endpoints, or any secret. Phase names and numeric durations only.
 *  - DEV-guarded console output; inert in production builds.
 */

export interface PhaseDuration {
  phase: string;
  ms: number;
}

export interface AttemptRecord {
  attempt: number;
  ms: number;
  meta?: Record<string, unknown>;
}

export interface TraceResult {
  phases: PhaseDuration[];
  attempts: AttemptRecord[];
  totalMs: number;
}

/** True only in non-production builds. Wrapped defensively so it never throws
 *  in a browser bundle where `process` is absent. Minifiers inline the constant
 *  and DCE the dead branch. */
// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
const IS_DEV: boolean = typeof process !== "undefined" && (process as any).env?.NODE_ENV !== "production";

/**
 * Create a fresh trace cursor. Each call to `mark(phase)` closes the previous
 * phase (recording its elapsed milliseconds) and opens the named one.
 * `attempt(n, ms, meta?)` records per-attempt model timings.
 * `end()` finalises the current phase and returns all collected data.
 */
export function createTurnTrace() {
  let phases: PhaseDuration[] = [];
  let attempts: AttemptRecord[] = [];
  let currentPhase: string | null = null;
  let phaseStart: number = 0;
  let traceStart: number = performance.now();

  function closeCurrent() {
    if (currentPhase !== null) {
      const ms = performance.now() - phaseStart;
      phases.push({ phase: currentPhase, ms });
      currentPhase = null;
    }
  }

  return {
    /**
     * Close the previous phase (if any) and start a new one.
     * Calling mark() twice with the same name in sequence is safe -- it simply
     * closes the first and opens a fresh one.
     */
    mark(phase: string): void {
      closeCurrent();
      currentPhase = phase;
      phaseStart = performance.now();
    },

    /**
     * Record per-attempt model timing. No phase must be open -- this is a
     * discrete event, not a span. Safe to call at any point in the lifecycle.
     */
    attempt(n: number, ms: number, meta?: Record<string, unknown>): void {
      attempts.push({ attempt: n, ms, ...(meta !== undefined ? { meta } : {}) });
    },

    /**
     * Close any open phase and return the full trace.
     * Safe to call without any prior mark() or attempt() calls.
     */
    end(): TraceResult {
      closeCurrent();
      const totalMs = performance.now() - traceStart;

      // DEV-only console output. Inert in production builds where IS_DEV is false.
      if (IS_DEV && typeof console !== "undefined" && typeof console.groupCollapsed === "function") {
        // eslint-disable-next-line no-console
        console.groupCollapsed(
          `%c[turnTrace] ${Math.round(totalMs)}ms total, ${phases.length} phases, ${attempts.length} attempts`,
          "color: #888; font-style: italic"
        );
        for (const p of phases) {
          // eslint-disable-next-line no-console
          console.log(`  ${p.phase}: ${Math.round(p.ms)}ms`);
        }
        for (const a of attempts) {
          // eslint-disable-next-line no-console
          console.log(`  attempt #${a.attempt}: ${Math.round(a.ms)}ms`, a.meta ?? "");
        }
        // eslint-disable-next-line no-console
        console.groupEnd();
      }

      const result: TraceResult = { phases, attempts, totalMs };

      // Reset internal state so the trace object is reusable (e.g. next turn).
      phases = [];
      attempts = [];
      currentPhase = null;
      traceStart = performance.now();

      return result;
    },
  };
}
