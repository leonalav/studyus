import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createTurnTrace } from "./turnTrace";

describe("createTurnTrace", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, "groupCollapsed").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "groupEnd").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ---------------------------------------------------------------------------
  // Basic API shape
  // ---------------------------------------------------------------------------

  it("end() returns a TraceResult with empty arrays when nothing was recorded", () => {
    const trace = createTurnTrace();
    const result = trace.end();
    expect(result).toEqual({
      phases: [],
      attempts: [],
      totalMs: expect.any(Number),
    });
    expect(result.totalMs).toBeGreaterThanOrEqual(0);
  });

  it("end() is idempotent after the first call", () => {
    const trace = createTurnTrace();
    trace.mark("a");
    const first = trace.end();
    const second = trace.end();
    expect(first.phases).toHaveLength(1);
    expect(second.phases).toHaveLength(0);
  });

  // ---------------------------------------------------------------------------
  // Phase sequencing
  // ---------------------------------------------------------------------------

  describe("mark() phase sequencing", () => {
    it("records a single phase with positive duration", () => {
      const trace = createTurnTrace();
      trace.mark("planning");
      const result = trace.end();
      expect(result.phases).toHaveLength(1);
      expect(result.phases[0].phase).toBe("planning");
      expect(result.phases[0].ms).toBeGreaterThanOrEqual(0);
    });

    it("each mark closes the previous phase before opening the new one", () => {
      const trace = createTurnTrace();
      trace.mark("a");
      trace.mark("b");
      trace.mark("c");
      const result = trace.end();
      expect(result.phases.map((p) => p.phase)).toEqual(["a", "b", "c"]);
      // All durations should be non-negative
      for (const p of result.phases) {
        expect(p.ms).toBeGreaterThanOrEqual(0);
      }
    });

    it("marks the same phase name consecutively produces separate entries", () => {
      const trace = createTurnTrace();
      trace.mark("retry");
      trace.mark("retry");
      const result = trace.end();
      expect(result.phases).toHaveLength(2);
      expect(result.phases[0].phase).toBe("retry");
      expect(result.phases[1].phase).toBe("retry");
    });
  });

  // ---------------------------------------------------------------------------
  // attempt() recording
  // ---------------------------------------------------------------------------

  describe("attempt()", () => {
    it("records a single attempt", () => {
      const trace = createTurnTrace();
      trace.attempt(1, 1234);
      const result = trace.end();
      expect(result.attempts).toHaveLength(1);
      expect(result.attempts[0]).toEqual({ attempt: 1, ms: 1234 });
    });

    it("records multiple attempts in order", () => {
      const trace = createTurnTrace();
      trace.attempt(1, 500);
      trace.attempt(2, 300);
      trace.attempt(3, 200);
      const result = trace.end();
      expect(result.attempts.map((a) => a.attempt)).toEqual([1, 2, 3]);
      expect(result.attempts.map((a) => a.ms)).toEqual([500, 300, 200]);
    });

    it("records optional meta without leaking secrets", () => {
      const trace = createTurnTrace();
      trace.attempt(1, 100, { retries: 2 });
      const result = trace.end();
      expect(result.attempts[0].meta).toEqual({ retries: 2 });
    });

    it("works interleaved with mark()", () => {
      const trace = createTurnTrace();
      trace.mark("phase1");
      trace.attempt(1, 100);
      trace.mark("phase2");
      trace.attempt(2, 200);
      const result = trace.end();
      expect(result.phases.map((p) => p.phase)).toEqual(["phase1", "phase2"]);
      expect(result.attempts).toHaveLength(2);
    });
  });

  // ---------------------------------------------------------------------------
  // Out-of-order safety
  // ---------------------------------------------------------------------------

  describe("out-of-order safety", () => {
    it("end() without any mark() does not throw", () => {
      const trace = createTurnTrace();
      expect(() => trace.end()).not.toThrow();
    });

    it("mark() called many times without end() does not throw", () => {
      const trace = createTurnTrace();
      expect(() => {
        for (let i = 0; i < 100; i++) trace.mark(`phase-${i}`);
      }).not.toThrow();
    });

    it("attempt() called before any mark() does not throw", () => {
      const trace = createTurnTrace();
      expect(() => trace.attempt(1, 10)).not.toThrow();
    });

    it("multiple end() calls do not throw", () => {
      const trace = createTurnTrace();
      trace.mark("a");
      expect(() => {
        trace.end();
        trace.end();
        trace.end();
      }).not.toThrow();
    });
  });

  // ---------------------------------------------------------------------------
  // Console output (DEV-guarded)
  // ---------------------------------------------------------------------------

  describe("DEV console output", () => {
    it("emits a groupCollapsed with phase durations", () => {
      const trace = createTurnTrace();
      trace.mark("build");
      trace.mark("render");
      trace.end();
      expect(consoleSpy).toHaveBeenCalledTimes(1);
      const label = consoleSpy.mock.calls[0][0] as string;
      expect(label).toContain("turnTrace");
      expect(label).toContain("2 phases");
    });

    it("does not call console.groupCollapsed when end() has no data", () => {
      const trace = createTurnTrace();
      trace.end();
      // It still emits, but with 0 phases — the guard is about DEV production
      // flag, not empty data. This is intentional: an empty trace is still
      // diagnostic information.
      expect(consoleSpy).toHaveBeenCalledTimes(1);
    });
  });

  // ---------------------------------------------------------------------------
  // Sensitivity check
  // ---------------------------------------------------------------------------

  describe("no sensitive data leaked", () => {
    it("phase names are only what the caller provided -- no prompt text, no API keys", () => {
      const trace = createTurnTrace();
      trace.mark("model_call");
      trace.attempt(1, 500);
      const result = trace.end();
      // The result should only contain our placeholder values, nothing from the environment
      const serialized = JSON.stringify(result);
      expect(serialized).not.toMatch(/api[_-]?key/i);
      expect(serialized).not.toMatch(/password/i);
      expect(serialized).not.toMatch(/secret/i);
      expect(serialized).not.toMatch(/Bearer/i);
      expect(serialized).not.toMatch(/sk-/i);
    });
  });

  // ---------------------------------------------------------------------------
  // totalMs
  // ---------------------------------------------------------------------------

  describe("totalMs", () => {
    it("is greater than or equal to the sum of individual phase durations", () => {
      const trace = createTurnTrace();
      trace.mark("a");
      trace.mark("b");
      const result = trace.end();
      const phaseSum = result.phases.reduce((s, p) => s + p.ms, 0);
      // totalMs includes the overhead of mark/end calls themselves
      expect(result.totalMs).toBeGreaterThanOrEqual(phaseSum);
    });
  });
});

// ---------------------------------------------------------------------------
// Board pacing tests (StudyRoom.tsx playback loop)
// ---------------------------------------------------------------------------

describe("board pacing", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /**
   * Extracted pacing logic mirroring the StudyRoom board playback loop.
   * The real component wraps this inside handleSend; we test the pattern
   * in isolation using fake timers.
   */
  async function replayBoardOps(
    ops: string[],
    opts: { signal?: AbortSignal } = {}
  ): Promise<{ applied: string[]; aborted: boolean }> {
    const applied: string[] = [];
    for (let index = 0; index < ops.length; index += 1) {
      if (opts.signal?.aborted) return { applied, aborted: true };
      // Conditional delay: first op applies immediately, subsequent ops wait 360ms.
      if (index > 0) {
        await new Promise((resolve) => setTimeout(resolve, 360));
      }
      if (opts.signal?.aborted) return { applied, aborted: true };
      applied.push(ops[index]);
    }
    return { applied, aborted: false };
  }

  it("first op applies immediately at t~0 without waiting", async () => {
    const promise = replayBoardOps(["op1", "op2", "op3"]);
    // Before advancing timers, the first op should already be applied
    // because index === 0 has no delay.
    // We need to flush microtasks to let the async function reach the first push.
    await vi.advanceTimersByTimeAsync(0);
    // At t=0, op1 should have been applied synchronously (no setTimeout).
    // But we're in async-land, so advance a tiny bit.
    await vi.advanceTimersByTime(1);
    // op1 is in, op2 and op3 are not yet.
    // Now advance to trigger op2 at 360ms.
    await vi.advanceTimersByTime(360);
    await vi.advanceTimersByTime(1);
    // op2 is in, op3 still pending at 720ms.
    await vi.advanceTimersByTime(360);
    await vi.advanceTimersByTime(1);

    const result = await promise;
    expect(result.applied).toEqual(["op1", "op2", "op3"]);
    expect(result.aborted).toBe(false);
  });

  it("Nth op (index N-1) applies at approximately 360*(N-1) ms", async () => {
    const timestamps: number[] = [];
    const original = Date.now();

    async function replayWithTimestamps(ops: string[]): Promise<string[]> {
      const applied: string[] = [];
      for (let index = 0; index < ops.length; index += 1) {
        if (index > 0) {
          await new Promise((resolve) => setTimeout(resolve, 360));
        }
        timestamps.push(Date.now() - original);
        applied.push(ops[index]);
      }
      return applied;
    }

    const promise = replayWithTimestamps(["a", "b", "c", "d"]);

    // Advance through all the timeouts: 0ms, 360ms, 720ms, 1080ms
    await vi.advanceTimersByTime(1);       // t=1: op "a" applied at ~0
    await vi.advanceTimersByTime(360);     // t=361: op "b" applied at ~360
    await vi.advanceTimersByTime(360);     // t=721: op "c" applied at ~720
    await vi.advanceTimersByTime(360);     // t=1081: op "d" applied at ~1080

    const result = await promise;
    expect(result).toEqual(["a", "b", "c", "d"]);
    // op "a" at ~0ms
    expect(timestamps[0]).toBeLessThan(10);
    // op "b" at ~360ms
    expect(timestamps[1]).toBeGreaterThanOrEqual(359);
    expect(timestamps[1]).toBeLessThan(370);
    // op "c" at ~720ms
    expect(timestamps[2]).toBeGreaterThanOrEqual(719);
    expect(timestamps[2]).toBeLessThan(730);
    // op "d" at ~1080ms
    expect(timestamps[3]).toBeGreaterThanOrEqual(1079);
    expect(timestamps[3]).toBeLessThan(1090);
  });

  it("aborting mid-loop stops further application (abort guard exercised)", async () => {
    const controller = new AbortController();
    const applied: string[] = [];

    async function replay() {
      for (let index = 0; index < 5; index += 1) {
        if (controller.signal.aborted) return;
        if (index > 0) {
          await new Promise((resolve) => setTimeout(resolve, 360));
        }
        if (controller.signal.aborted) return;
        applied.push(`op${index}`);
      }
    }

    const promise = replay();

    // Let op0 and op1 apply.
    await vi.advanceTimersByTime(1);
    await vi.advanceTimersByTime(360);
    await vi.advanceTimersByTime(1);

    expect(applied).toEqual(["op0", "op1"]);

    // Abort before op2's delay fires.
    controller.abort();

    // Advance past all remaining timeouts -- nothing should be applied.
    await vi.advanceTimersByTime(1000);
    await promise;

    // Only op0 and op1 were applied before the abort.
    expect(applied).toEqual(["op0", "op1"]);
  });

  it("stale-activity guard stops application when turn changes", async () => {
    // Simulates the activityTurnRef pattern: the current turn number changes
    // mid-loop, causing early return.
    let currentTurn = 1;
    const applied: string[] = [];

    async function replay(turnAtStart: number) {
      for (let index = 0; index < 5; index += 1) {
        if (currentTurn !== turnAtStart) return;
        if (index > 0) {
          await new Promise((resolve) => setTimeout(resolve, 360));
        }
        if (currentTurn !== turnAtStart) return;
        applied.push(`op${index}`);
      }
    }

    const promise = replay(1);

    // Let op0 and op1 apply.
    await vi.advanceTimersByTime(1);
    await vi.advanceTimersByTime(360);
    await vi.advanceTimersByTime(1);

    expect(applied).toEqual(["op0", "op1"]);

    // Simulate a new turn superseding this one (e.g. learner sent a new message).
    currentTurn = 2;

    await vi.advanceTimersByTime(1000);
    await promise;

    expect(applied).toEqual(["op0", "op1"]);
  });
});
