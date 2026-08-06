/**
 * §20 property tests — the web analog of the plan's proptest requirement:
 * never-repeat and normalization hold not for sampled cases but as
 * properties over generated inputs (fast-check).
 */

import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { normalizeOutput } from "../grading";
import { bktUpdate, initBktState, predictCorrect } from "../bkt";
import { selectNext, BAND_MID, type Candidate } from "../select";
import { drawUnseenBinding, type SeenTable } from "../generate";
import { paramSpaceSize } from "../template";
import { seededRng } from "../rng";
import { STUDYUS_PYTHON_PACK } from "../../pack/studyus-python";

function memorySeen(): SeenTable {
  const seen = new Map<string, Set<number>>();
  return {
    isSeen: (t, h) => seen.get(t)?.has(h) ?? false,
    markSeen: (t, h) => {
      if (!seen.has(t)) seen.set(t, new Set());
      seen.get(t)!.add(h);
    },
    seenCount: (t) => seen.get(t)?.size ?? 0,
  };
}

describe("normalization properties (§12.1)", () => {
  it("is idempotent", () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        expect(normalizeOutput(normalizeOutput(s))).toBe(normalizeOutput(s));
      }),
    );
  });

  it("is invariant to per-line leading/trailing whitespace", () => {
    fc.assert(
      fc.property(fc.array(fc.string(), { minLength: 1, maxLength: 6 }), fc.array(fc.nat(4)), (lines, pads) => {
        const bare = lines.join("\n");
        const padded = lines.map((line, i) => " ".repeat((pads[i % pads.length] ?? 0) % 5) + line + " ".repeat((pads[(i + 1) % pads.length] ?? 0) % 5)).join("\n");
        expect(normalizeOutput(padded)).toBe(normalizeOutput(bare));
      }),
    );
  });

  it("treats CRLF, CR, and LF identically", () => {
    fc.assert(
      fc.property(fc.array(fc.string().filter((s) => !/[\r\n]/.test(s)), { minLength: 1, maxLength: 5 }), (lines) => {
        const lf = normalizeOutput(lines.join("\n"));
        expect(normalizeOutput(lines.join("\r\n"))).toBe(lf);
        expect(normalizeOutput(lines.join("\r"))).toBe(lf);
      }),
    );
  });

  it("collapses internal space runs but never touches case", () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        const n = normalizeOutput(s);
        expect(n).not.toMatch(/  +/); // no double spaces survive
        expect(n).toBe(n); // (kept)
        // case-preserving: normalizing commutes with case changes
        expect(normalizeOutput(s.toUpperCase())).toBe(normalizeOutput(s).toUpperCase());
        expect(normalizeOutput(s.toLowerCase())).toBe(normalizeOutput(s).toLowerCase());
      }),
    );
  });
});

describe("BKT properties (§13.1)", () => {
  it("p_L stays a probability for any sequence of outcomes", () => {
    fc.assert(
      fc.property(fc.array(fc.boolean(), { minLength: 1, maxLength: 40 }), (outcomes) => {
        let state = initBktState(0);
        outcomes.forEach((correct, i) => {
          state = bktUpdate(state, correct, i);
          expect(state.p).toBeGreaterThanOrEqual(0);
          expect(state.p).toBeLessThanOrEqual(1);
        });
        const p = predictCorrect(state);
        expect(p).toBeGreaterThanOrEqual(0);
        expect(p).toBeLessThanOrEqual(1);
      }),
    );
  });

  it("evidence ordering — from the same state, an incorrect attempt always yields a lower p_L than a correct one", () => {
    fc.assert(
      fc.property(fc.array(fc.boolean(), { maxLength: 20 }), (prefix) => {
        let state = initBktState(0);
        prefix.forEach((correct, i) => {
          state = bktUpdate(state, correct, i);
        });
        const afterCorrect = bktUpdate(state, true, prefix.length + 1);
        const afterIncorrect = bktUpdate(state, false, prefix.length + 1);
        expect(afterIncorrect.p).toBeLessThan(afterCorrect.p);
      }),
    );
  });
});

describe("selection properties (§13.3)", () => {
  it("the chosen candidate is never farther from the band middle than any eligible rival", () => {
    const skill = STUDYUS_PYTHON_PACK.skills[0];
    const candidateArb = fc.record({
      p: fc.double({ min: 0, max: 1, noNaN: true }),
      lastAt: fc.integer({ min: 0, max: 1000 }),
    });
    fc.assert(
      fc.property(fc.array(candidateArb, { minLength: 1, maxLength: 8 }), (specs) => {
        const candidates: Candidate[] = specs.map((spec, i) => ({
          skill: { ...skill, id: `${skill.id}.${i}` },
          beat: "predict",
          gate: "open",
          bkt: { p: spec.p, attempts: 1, correct: 1, lastAt: spec.lastAt },
          hasUnseenBinding: true,
          beatUnlocked: true,
          now: 5000,
        }));
        const chosen = selectNext({ candidates, prereqsMastered: () => true });
        expect(chosen).toBeTruthy();
        const chosenDistance = Math.abs((chosen!.bkt!.p * 0.9 + (1 - chosen!.bkt!.p) * 0.2) - BAND_MID);
        for (const c of candidates) {
          const d = Math.abs((c.bkt!.p * 0.9 + (1 - c.bkt!.p) * 0.2) - BAND_MID);
          expect(chosenDistance).toBeLessThanOrEqual(d + 1e-12);
        }
      }),
    );
  });
});

describe("never-repeat properties (§10.3)", () => {
  it("drawn bindings never repeat until the space is exhausted, for any seed", () => {
    const template = STUDYUS_PYTHON_PACK.templates.find((t) => t.id === "py.cond.if-else.threshold.v1")!;
    const space = paramSpaceSize(template);
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 1_000_000 }), (seed) => {
        const seen = memorySeen();
        const rng = seededRng(seed);
        const hashes = new Set<number>();
        const draws = Math.min(60, space);
        for (let i = 0; i < draws; i += 1) {
          const drawn = drawUnseenBinding(template, rng, seen);
          expect(drawn).toBeTruthy();
          expect(hashes.has(drawn!.hash)).toBe(false);
          hashes.add(drawn!.hash);
          seen.markSeen(template.id, drawn!.hash);
        }
      }),
      { numRuns: 12 },
    );
  });

  it("exhaustion is exact: the space yields its full size, then nothing, for any seed", () => {
    const template = STUDYUS_PYTHON_PACK.templates.find((t) => t.id === "py.strings.methods.new-string.v1")!;
    const space = paramSpaceSize(template);
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 1_000_000 }), (seed) => {
        const seen = memorySeen();
        const rng = seededRng(seed);
        let count = 0;
        let drawn = drawUnseenBinding(template, rng, seen);
        while (drawn) {
          seen.markSeen(template.id, drawn.hash);
          count += 1;
          expect(count).toBeLessThanOrEqual(space);
          drawn = drawUnseenBinding(template, rng, seen);
        }
        expect(count).toBe(space);
      }),
      { numRuns: 3 },
    );
  });
});
