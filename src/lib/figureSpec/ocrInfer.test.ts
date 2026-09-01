/**
 * OCR → figureSpec inference tests.
 *
 * The inference layer is deliberately heuristic — the agent always reviews
 * the guess and may rewrite the spec. What we test here is: (1) the geometric
 * heuristics map the obvious regions to the obvious kinds, (2) the
 * confidence is honestly reported (0 when no heuristic matched), and (3) the
 * caller can tell when to skip (null spec, low confidence).
 */

import { describe, it, expect } from "vitest";
import { inferFigureSpec } from "./ocrInfer";
import type { FigureRegion } from "./region";

function makeRegion(opts: Partial<FigureRegion> = {}): FigureRegion {
  return {
    id: "r1",
    page: 0,
    x: 0,
    y: 0,
    w: 200,
    h: 200,
    imageBase64: "",
    hints: [],
    ...opts,
  };
}

describe("inferFigureSpec — square regions", () => {
  it("square region with closed-curve hint → unitCircle", () => {
    const result = inferFigureSpec(
      makeRegion({ w: 200, h: 200, hints: ["closed-curve"] }),
      ["closed-curve"]
    );
    expect(result.spec?.kind).toBe("unitCircle");
    expect(result.confidence).toBeGreaterThan(0);
  });

  it("rectangular (not square) region with closed-curve hint → not a unit circle", () => {
    const result = inferFigureSpec(
      makeRegion({ w: 300, h: 100, hints: ["closed-curve"] }),
      ["closed-curve"]
    );
    expect(result.spec?.kind).not.toBe("unitCircle");
  });
});

describe("inferFigureSpec — tall regions", () => {
  it("tall region with curve hint → trigGraph (sin)", () => {
    const result = inferFigureSpec(
      makeRegion({ w: 200, h: 400, hints: ["curve"] }),
      ["curve"]
    );
    expect(result.spec?.kind).toBe("trigGraph");
  });

  it("short region with curve hint → low confidence (not a trig graph)", () => {
    const result = inferFigureSpec(
      makeRegion({ w: 200, h: 40, hints: ["curve"] }),
      ["curve"]
    );
    expect(result.spec?.kind).not.toBe("trigGraph");
  });
});

describe("inferFigureSpec — flowchart & shaded & limit hints", () => {
  it("boxes + arrows hints → flowchart", () => {
    const result = inferFigureSpec(
      makeRegion({ hints: ["boxes", "arrows"] }),
      ["boxes", "arrows"]
    );
    expect(result.spec?.kind).toBe("flowchart");
  });

  it("shaded-area hint → shadedArea", () => {
    const result = inferFigureSpec(
      makeRegion({ hints: ["shaded-area"] }),
      ["shaded-area"]
    );
    expect(result.spec?.kind).toBe("shadedArea");
  });

  it("vertical-dashed hint → limitGraph", () => {
    const result = inferFigureSpec(
      makeRegion({ hints: ["vertical-dashed"] }),
      ["vertical-dashed"]
    );
    expect(result.spec?.kind).toBe("limitGraph");
  });
});

describe("inferFigureSpec — low-confidence fallback", () => {
  it("returns null spec with zero confidence when no heuristic matches", () => {
    const result = inferFigureSpec(
      makeRegion({ hints: [] }),
      []
    );
    expect(result.spec).toBeNull();
    expect(result.confidence).toBe(0);
  });

  it("always returns a non-empty reason string for logging", () => {
    const result = inferFigureSpec(makeRegion(), []);
    expect(typeof result.reason).toBe("string");
    expect(result.reason.length).toBeGreaterThan(0);
  });
});