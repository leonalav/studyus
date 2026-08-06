/**
 * §20 mastery tests — BKT behaviour, target-band selection, adaptive fading,
 * and the Law 7 mastery gate.
 */

import { describe, expect, it } from "vitest";
import { bktUpdate, initBktState, predictCorrect } from "../bkt";
import { applyFading } from "../fading";
import { isMastered, BEAT_WEIGHT } from "../mastery";
import { selectNext, BAND_MID, type Candidate } from "../select";
import { STUDYUS_PYTHON_PACK } from "../../pack/studyus-python";

describe("13.1 BKT", () => {
  it("converges upward under repeated correct attempts", () => {
    let state = initBktState(0);
    for (let i = 0; i < 8; i += 1) state = bktUpdate(state, true, i);
    expect(state.p).toBeGreaterThan(0.95);
  });

  it("converges downward under repeated incorrect attempts", () => {
    let state = initBktState(0);
    state = bktUpdate(state, true, 0);
    state = bktUpdate(state, true, 1);
    const high = state.p;
    let previous = state.p;
    for (let i = 2; i < 10; i += 1) {
      state = bktUpdate(state, false, i);
      expect(state.p).toBeLessThan(previous); // monotonic drop
      previous = state.p;
    }
    expect(state.p).toBeLessThan(high);
    // with transit p_T = 0.20 the floor sits above zero — that is the model,
    // not a bug: learning is always possible on the next attempt.
    expect(state.p).toBeLessThan(0.3);
  });

  it("a scaffold-requested attempt counts at reduced weight 0.5 (§13.4)", () => {
    const base = initBktState(0);
    const full = bktUpdate(base, true, 1, undefined, 1);
    const half = bktUpdate(base, true, 1, undefined, 0.5);
    expect(half.p).toBeGreaterThan(base.p);
    expect(half.p).toBeLessThan(full.p);
    expect(Math.abs(half.p - (base.p + (full.p - base.p) / 2))).toBeLessThan(1e-9);
  });
});

describe("13.3 selection — the small gap, never the hardest item (Law 5)", () => {
  const skill = STUDYUS_PYTHON_PACK.skills[0];
  const candidate = (p: number, extra: Partial<Candidate> = {}): Candidate => ({
    skill,
    beat: "predict",
    gate: "open",
    bkt: { p, attempts: 1, correct: 1, lastAt: 0 },
    hasUnseenBinding: true,
    beatUnlocked: true,
    now: 1000,
    ...extra,
  });

  it("chooses the candidate closest to the band middle, not the hardest", () => {
    const easy = candidate(0.1); // P(correct) ≈ 0.27
    const inBand = candidate(0.5); // P(correct) ≈ 0.55
    const hard = candidate(0.99); // P(correct) ≈ 0.91
    const chosen = selectNext({
      candidates: [easy, inBand, hard],
      prereqsMastered: () => true,
    });
    expect(chosen).toBe(inBand);
    expect(chosen).not.toBe(hard);
  });

  it("estimates P(correct) inside the band for a mid-learned state", () => {
    const state = { p: 0.55, attempts: 2, correct: 1, lastAt: 0 };
    const p = predictCorrect(state);
    expect(p).toBeGreaterThanOrEqual(0.55 - 0.05);
    expect(p).toBeLessThanOrEqual(0.75 + 0.05);
    expect(BAND_MID).toBeCloseTo(0.65);
  });

  it("never selects a locked candidate, and mastered candidates need a due review", () => {
    const locked = candidate(0.5, { gate: "locked" });
    const masteredNotDue = candidate(0.5, { gate: "mastered", reviewDueAt: 99999 });
    const open = candidate(0.4);
    const chosen = selectNext({ candidates: [locked, masteredNotDue, open], prereqsMastered: () => true });
    expect(chosen).toBe(open);
  });
});

describe("13.4 adaptive fading", () => {
  it("fades toward harder after an unassisted pass, never below none", () => {
    let decision = applyFading("write", { level: "hinted", consecutiveFails: 0 }, true, false, false);
    expect(decision.level).toBe("none");
    decision = applyFading("write", { level: "none", consecutiveFails: 0 }, true, false, false);
    expect(decision.level).toBe("none"); // never below none
  });

  it("un-fades after two consecutive failures, not one", () => {
    let decision = applyFading("write", { level: "none", consecutiveFails: 0 }, false, false, false);
    expect(decision.level).toBe("none");
    expect(decision.consecutiveFails).toBe(1);
    decision = applyFading("write", { level: "none", consecutiveFails: 1 }, false, false, false);
    expect(decision.level).toBe("hinted");
  });

  it("a requested scaffold un-fades immediately and suppresses fading", () => {
    const decision = applyFading("write", { level: "none", consecutiveFails: 0 }, true, true, false);
    expect(decision.level).toBe("hinted");
    expect(decision.suppressed).toBe(true);
  });

  it("expertise reversal — mastered skills are never offered worked examples", () => {
    const decision = applyFading("modify", { level: "completion", consecutiveFails: 1 }, false, false, true);
    expect(decision.level).not.toBe("worked-example");
  });
});

describe("Law 7 — mastery requires a scaffold-free Write", () => {
  const skill = STUDYUS_PYTHON_PACK.skills.find((s) => s.id === "py.loops.for-range")!;

  it("no mastery without a passed Write at ScaffoldLevel none, however good the predictions", () => {
    const bkt = {
      predict: { p: 0.99, attempts: 10, correct: 10, lastAt: 0 },
      explain: { p: 0.99, attempts: 10, correct: 10, lastAt: 0 },
      modify: { p: 0.99, attempts: 10, correct: 10, lastAt: 0 },
      write: { p: 0.99, attempts: 10, correct: 10, lastAt: 0 },
    };
    expect(isMastered({ skill, bkt, writePassedAtNone: false })).toBe(false);
    expect(isMastered({ skill, bkt, writePassedAtNone: true })).toBe(true);
  });

  it("no mastery below the Write p_L threshold either", () => {
    const bkt = { write: { p: 0.5, attempts: 1, correct: 1, lastAt: 0 } };
    expect(isMastered({ skill, bkt, writePassedAtNone: true })).toBe(false);
  });

  it("beat weights follow §13.2 — Explain heavy, Write heaviest", () => {
    expect(BEAT_WEIGHT.explain).toBe(0.3);
    expect(BEAT_WEIGHT.write).toBe(0.35);
    expect(BEAT_WEIGHT.predict + BEAT_WEIGHT.explain + BEAT_WEIGHT.modify + BEAT_WEIGHT.write).toBeCloseTo(1);
  });
});
