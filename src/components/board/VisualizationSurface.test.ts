import { describe, it, expect } from "vitest";
import { compileExpression, computeBoundingBox, fitBoxToAspect, resolveDisplayMode } from "./VisualizationSurface";

/** Close to zero tolerance for float comparisons. */
const TOL = 1e-9;
const close = (a: number, b: number) => Math.abs(a - b) < TOL;

describe("resolveDisplayMode — graph vs graphless defaults", () => {
  it("defaults geometry to graphless so plain diagrams do not get axes behind them", () => {
    expect(resolveDisplayMode({ type: "geometry", objects: [] } as any)).toBe("graphless");
  });

  it("defaults function plots to graph mode", () => {
    expect(resolveDisplayMode({ type: "function", domainX: [-5, 5], expressions: [] } as any)).toBe("graph");
  });

  it("respects an explicit override", () => {
    expect(resolveDisplayMode({ type: "geometry", displayMode: "graph", objects: [] } as any)).toBe("graph");
    expect(resolveDisplayMode({ type: "function", displayMode: "graphless", domainX: [-5, 5], expressions: [] } as any)).toBe("graphless");
  });
});

describe("compileExpression — arithmetic & precedence", () => {
  it("evaluates a polynomial with explicit operators", () => {
    const f = compileExpression("x^2 - 2*x + 1");
    expect(close(f(0), 1)).toBe(true);
    expect(close(f(1), 0)).toBe(true);
    expect(close(f(3), 4)).toBe(true);
  });

  it("evaluates implicit multiplication: 2x^2 - 1", () => {
    const f = compileExpression("2x^2 - 1");
    expect(close(f(0), -1)).toBe(true);
    expect(close(f(2), 7)).toBe(true);
  });

  it("respects operator precedence: a + b * c", () => {
    const f = compileExpression("x + 2 * x");
    expect(close(f(3), 9)).toBe(true);
  });

  it("respects parentheses and right-assoc exponent: (x+1)^2 vs x^2+1", () => {
    expect(close(compileExpression("(x + 1)^2")(2), 9)).toBe(true);
    expect(close(compileExpression("x^2 + 1")(2), 5)).toBe(true);
  });

  it("handles unary minus and nested sign", () => {
    expect(close(compileExpression("-x")(4), -4)).toBe(true);
    expect(close(compileExpression("x - -x")(3), 6)).toBe(true);
    expect(close(compileExpression("-x^2")(3), -9)).toBe(true);
  });

  it("right-associative exponent: 2^3^2 = 2^9 = 512", () => {
    expect(close(compileExpression("2^3^2")(0), 512)).toBe(true);
  });

  it("implicit multiply between parenthesized factors", () => {
    expect(close(compileExpression("(x + 1)(x - 1)")(3), 8)).toBe(true);
  });

  it("division by zero yields NaN (not Infinity, not crash)", () => {
    expect(Number.isNaN(compileExpression("1 / (x - 3)")(3))).toBe(true);
  });
});

describe("compileExpression — functions & constants", () => {
  it("evaluates sin / cos", () => {
    const sin = compileExpression("sin(x)");
    expect(close(sin(0), 0)).toBe(true);
    expect(close(sin(Math.PI / 2), 1)).toBe(true);
  });

  it("evaluates sqrt (NaN for negatives)", () => {
    const sqrt = compileExpression("sqrt(x)");
    expect(close(sqrt(9), 3)).toBe(true);
    expect(Number.isNaN(sqrt(-4))).toBe(true);
  });

  it("evaluates abs and log with domain guarding", () => {
    expect(close(compileExpression("abs(x)")(-3), 3)).toBe(true);
    expect(Number.isNaN(compileExpression("log(x)")(0))).toBe(true);
    expect(close(compileExpression("log(x)")(Math.E), 1)).toBe(true);
  });

  it("uses pi and e as constants", () => {
    expect(close(compileExpression("2 * pi")(0), Math.PI * 2)).toBe(true);
    expect(close(compileExpression("e")(0), Math.E)).toBe(true);
  });

  it("composes a function with an argument expression: sin(2x)", () => {
    const f = compileExpression("sin(2x)");
    expect(close(f(Math.PI / 4), 1)).toBe(true);
  });
});

describe("compileExpression — robustness", () => {
  it("whitespace is insignificant", () => {
    expect(close(compileExpression("  x  ^  2  ")(5), 25)).toBe(true);
  });

  it("returns NaN for non-finite results instead of throwing", () => {
    const f = compileExpression("exp(x)");
    expect(Number.isFinite(f(0))).toBe(true);
  });

  it("rejects unsupported characters by returning a NaN-producing function", () => {
    // The parser throws on tokenization; compileExpression wraps eval in a try
    // and returns NaN for malformed input rather than throwing to callers.
    const f = compileExpression("x,y");
    expect(Number.isNaN(f(1))).toBe(true);
  });
});

describe("computeBoundingBox — figure is never clipped", () => {
  it("covers a circle's full rim, not just its center/through points", () => {
    // The reported bug: a circle centered at O(0,0) through A(3,0) with a nearby
    // point B(-2,2). Point-only bbox would be x∈[-2,3], y∈[0,2] — clipping the
    // bottom and right of the circle (which reaches y=-3 and x=+3).
    const [xMin, yMax, xMax, yMin] = computeBoundingBox({
      type: "geometry",
      objects: [
        { kind: "point", id: "O", at: [0, 0], label: "O" },
        { kind: "point", id: "A", at: [3, 0], label: "A" },
        { kind: "point", id: "B", at: [-2, 2], label: "B" },
        { kind: "circle", id: "c1", center: "O", through: "A" },
      ],
    } as any);
    // radius = 3, so the rim spans [-3,3] in both axes; bbox must contain it
    // (with padding, so strictly beyond ±3).
    expect(xMin).toBeLessThan(-3);
    expect(xMax).toBeGreaterThan(3);
    expect(yMin).toBeLessThan(-3);
    expect(yMax).toBeGreaterThan(3);
  });

  it("covers a radius-defined circle centered away from the origin", () => {
    const [xMin, yMax, xMax, yMin] = computeBoundingBox({
      type: "geometry",
      objects: [
        { kind: "point", id: "C", at: [5, 5], label: "C" },
        { kind: "circle", id: "c1", center: "C", radius: 2 },
      ],
    } as any);
    // circle occupies x,y ∈ [3,7]; bbox must contain that fully.
    expect(xMin).toBeLessThanOrEqual(3);
    expect(xMax).toBeGreaterThanOrEqual(7);
    expect(yMin).toBeLessThanOrEqual(3);
    expect(yMax).toBeGreaterThanOrEqual(7);
  });

  it("ignores an explicit viewport and fits the measured geometry itself", () => {
    const box = computeBoundingBox({
      type: "geometry",
      viewport: { xMin: -20, xMax: 20, yMin: -20, yMax: 20 },
      objects: [
        { kind: "point", id: "O", at: [0, 0] },
        { kind: "point", id: "A", at: [3, 0] },
        { kind: "circle", id: "c1", center: "O", through: "A" },
      ],
    } as any);
    // The ignored viewport must not blow the figure out to a huge empty block.
    expect(box[0]).toBeGreaterThan(-10);
    expect(box[2]).toBeLessThan(10);
    expect(box[3]).toBeGreaterThan(-10);
    expect(box[1]).toBeLessThan(10);
    // It still fully contains the actual circle.
    expect(box[0]).toBeLessThan(-3);
    expect(box[2]).toBeGreaterThan(3);
    expect(box[3]).toBeLessThan(-3);
    expect(box[1]).toBeGreaterThan(3);
  });

  it("keeps a small triangle compact instead of applying a one-unit margin", () => {
    const [xMin, yMax, xMax, yMin] = computeBoundingBox({
      type: "geometry",
      objects: [
        { kind: "point", id: "A", at: [0, 0] },
        { kind: "point", id: "B", at: [0.5, 0] },
        { kind: "point", id: "C", at: [0, 0.4] },
        { kind: "polygon", id: "t", vertices: ["A", "B", "C"] },
      ],
    } as any);
    expect(xMax - xMin).toBeLessThan(1.5);
    expect(yMax - yMin).toBeLessThan(1.5);
  });

  it("contains the fixed-radius angle arc", () => {
    const [xMin, yMax, xMax, yMin] = computeBoundingBox({
      type: "geometry",
      objects: [
        { kind: "point", id: "A", at: [0, 0] },
        { kind: "point", id: "B", at: [0.1, 0] },
        { kind: "point", id: "C", at: [0, 0.1] },
        { kind: "angle", id: "a", from: "B", at: "A", to: "C" },
      ],
    } as any);
    expect(xMin).toBeLessThan(-0.8);
    expect(xMax).toBeGreaterThan(0.8);
    expect(yMin).toBeLessThan(-0.8);
    expect(yMax).toBeGreaterThan(0.8);
  });

  it("pads function graph bounds so curves and labels at the edge remain visible", () => {
    const [xMin, yMax, xMax, yMin] = computeBoundingBox({
      type: "function",
      domainX: [0, 4],
      rangeY: [0, 4],
      expressions: [{ id: "f", expression: "x" }],
    } as any);
    expect(xMin).toBeLessThan(0);
    expect(xMax).toBeGreaterThan(4);
    expect(yMin).toBeLessThan(0);
    expect(yMax).toBeGreaterThan(4);
  });

  it("infers a function range from sampled expressions when rangeY is omitted", () => {
    const [xMin, yMax, xMax, yMin] = computeBoundingBox({
      type: "function",
      domainX: [0, 4],
      expressions: [{ id: "f", expression: "x^2" }],
    } as any);
    expect(xMin).toBeLessThan(0);
    expect(xMax).toBeGreaterThan(4);
    expect(yMin).toBeLessThanOrEqual(0);
    expect(yMax).toBeGreaterThan(16);
  });
});

describe("fitBoxToAspect — figure is never cropped, only grown", () => {
  const contains = (fit: number[], box: number[]) => {
    const [fxMin, fyMax, fxMax, fyMin] = fit;
    const [xMin, yMax, xMax, yMin] = box;
    return fxMin <= xMin + 1e-9 && fxMax >= xMax - 1e-9 && fyMin <= yMin + 1e-9 && fyMax >= yMax - 1e-9;
  };
  const aspectOf = (b: number[]) => (b[1] - b[3]) / (b[2] - b[0]); // (yMax-yMin)/(xMax-xMin)

  it("widens a tall figure to match a wide container, keeping it fully inside", () => {
    const box: [number, number, number, number] = [-1, 5, 1, -5]; // 2 wide, 10 tall
    const fit = fitBoxToAspect(box, 400, 200); // container aspect 0.5
    expect(contains(fit, box)).toBe(true);
    expect(aspectOf(fit)).toBeCloseTo(0.5, 6);
    // width grew, height unchanged
    expect(fit[2] - fit[0]).toBeGreaterThan(box[2] - box[0]);
    expect(fit[1] - fit[3]).toBeCloseTo(box[1] - box[3], 6);
  });

  it("heightens a wide figure to match a tall container, keeping it fully inside", () => {
    const box: [number, number, number, number] = [-5, 1, 5, -1]; // 10 wide, 2 tall
    const fit = fitBoxToAspect(box, 200, 400); // container aspect 2
    expect(contains(fit, box)).toBe(true);
    expect(aspectOf(fit)).toBeCloseTo(2, 6);
    expect(fit[1] - fit[3]).toBeGreaterThan(box[1] - box[3]);
    expect(fit[2] - fit[0]).toBeCloseTo(box[2] - box[0], 6);
  });

  it("keeps the figure centred", () => {
    const box: [number, number, number, number] = [2, 8, 6, 2]; // centre (4,5)
    const fit = fitBoxToAspect(box, 300, 150);
    expect((fit[0] + fit[2]) / 2).toBeCloseTo(4, 6);
    expect((fit[1] + fit[3]) / 2).toBeCloseTo(5, 6);
  });

  it("is a no-op when the box already matches the container aspect", () => {
    const box: [number, number, number, number] = [-2, 2, 2, -2]; // aspect 1
    const fit = fitBoxToAspect(box, 300, 300); // container aspect 1
    expect(fit[0]).toBeCloseTo(box[0], 6);
    expect(fit[2]).toBeCloseTo(box[2], 6);
    expect(fit[1]).toBeCloseTo(box[1], 6);
    expect(fit[3]).toBeCloseTo(box[3], 6);
  });

  it("returns the box unchanged when the container has no measured size", () => {
    const box: [number, number, number, number] = [-1, 1, 1, -1];
    expect(fitBoxToAspect(box, 0, 0)).toEqual(box);
  });
});
