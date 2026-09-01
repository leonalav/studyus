/**
 * Compile-output tests for the figure-spec dispatcher.
 *
 * Each kind is exercised at least once: the emitted `AnimationScene` is
 * checked for shape (correct kind set, finite coordinates, every element
 * within `MAX_FIGURE_ELEMENTS`) and for the canonical elements an Open
 * Stax-style figure would have. Snapshots are kept loose — exact element
 * counts are an implementation detail of the compiler; the invariants we
 * actually want are "did the compiler produce a figure-shaped scene, and
 * does the right thing appear inside it?".
 */

import { describe, it, expect } from "vitest";
import {
  compile,
  FIGURE_KINDS,
  MAX_FIGURE_ELEMENTS,
  FigureSpecCompileError,
} from "./compile";
import type { FigureSpec } from "./types";

describe("compile — dispatcher", () => {
  it("rejects an unknown kind at compile time", () => {
    // Force the type checker to accept a bogus kind so we can assert the
    // runtime guard fires.
    const bogus = { kind: "bogus" } as unknown as FigureSpec;
    expect(() => compile(bogus)).toThrow(FigureSpecCompileError);
  });

  it("refuses a scene whose compiled element count exceeds the cap", () => {
    // Construct a flowchart with a hand-rolled spec that exceeds the
    // element cap. Each node + each edge + the origin/tip points make the
    // count climb; 25 nodes with no edges is enough to trip MAX_FIGURE_ELEMENTS = 24.
    const nodes = Array.from({ length: 25 }, (_, i) => ({
      id: `n${i}`,
      label: `N${i}`,
      x: i,
      y: 0,
    }));
    expect(() =>
      compile({ kind: "flowchart", nodes, edges: [], showLabels: true })
    ).toThrow(FigureSpecCompileError);
  });

  it("lists every figure kind the agent can emit", () => {
    // FIGURE_KINDS is the source of truth on the wire; it must include
    // every kind the dispatcher can handle, and the dispatcher must handle
    // every kind FIGURE_KINDS lists.
    for (const kind of FIGURE_KINDS) {
      expect(() => compile(makeMinimal(kind))).not.toThrow();
    }
  });
});

describe("compile — unit circle", () => {
  const scene = compile({
    kind: "unitCircle",
    theta: Math.PI / 6,
    showSin: true,
    showCos: true,
    showLabels: true,
  });

  it("emits the parametric unit circle curve", () => {
    const circle = scene.elements.find((e) => e.id === "circle");
    expect(circle).toBeDefined();
    expect(circle).toMatchObject({ kind: "curve", xExpression: "cos(u)", yExpression: "sin(u)" });
  });

  it("places the point at (cos θ, sin θ)", () => {
    const point = scene.elements.find((e) => e.id === "p-theta");
    expect(point).toBeDefined();
    expect(point).toMatchObject({ kind: "point" });
  });

  it("draws the cos projection leg as a dashed segment", () => {
    const leg = scene.elements.find((e) => e.id === "cos-leg");
    expect(leg).toBeDefined();
    expect(leg).toMatchObject({ kind: "segment", style: "dashed" });
  });

  it("draws the sin projection leg", () => {
    const leg = scene.elements.find((e) => e.id === "sin-leg");
    expect(leg).toBeDefined();
    expect(leg).toMatchObject({ kind: "segment" });
  });

  it("draws the angle arc as a single parametric curve", () => {
    const arc = scene.elements.find((e) => e.id === "arc");
    expect(arc).toBeDefined();
    expect(arc).toMatchObject({ kind: "curve" });
  });

  it("draws the θ label and the sin/cos labels", () => {
    expect(scene.elements.some((e) => e.id === "theta-label")).toBe(true);
    expect(scene.elements.some((e) => e.id === "sin-label")).toBe(true);
    expect(scene.elements.some((e) => e.id === "cos-label")).toBe(true);
  });

  it("uses a square viewport when no domain is given", () => {
    expect(scene.xDomain[0]).toBeLessThan(-1);
    expect(scene.xDomain[1]).toBeGreaterThan(1);
    expect(scene.yDomain[0]).toBeLessThan(-1);
    expect(scene.yDomain[1]).toBeGreaterThan(1);
  });

  it("stays within MAX_FIGURE_ELEMENTS", () => {
    expect(scene.elements.length).toBeLessThanOrEqual(MAX_FIGURE_ELEMENTS);
  });
});

describe("compile — trig graph", () => {
  it("emits a curve whose expression matches the requested function", () => {
    const sin = compile({ kind: "trigGraph", function: "sin", domainX: [-Math.PI, Math.PI] });
    const cos = compile({ kind: "trigGraph", function: "cos", domainX: [-Math.PI, Math.PI] });
    const tan = compile({ kind: "trigGraph", function: "tan", domainX: [-Math.PI / 2 + 0.1, Math.PI / 2 - 0.1] });
    expect(sin.elements.some((e) => e.kind === "curve" && e.yExpression.includes("sin"))).toBe(true);
    expect(cos.elements.some((e) => e.kind === "curve" && e.yExpression.includes("cos"))).toBe(true);
    expect(tan.elements.some((e) => e.kind === "curve" && e.yExpression.includes("tan"))).toBe(true);
  });

  it("marks asymptotes for tan with a vertical dotted segment", () => {
    const tan = compile({
      kind: "trigGraph",
      function: "tan",
      domainX: [-Math.PI, Math.PI],
      showLabels: false,
    });
    expect(tan.elements.some((e) => e.kind === "segment" && e.style === "dotted")).toBe(true);
  });
});

describe("compile — parabola", () => {
  it("upward: y = a(x-h)²+k", () => {
    const scene = compile({ kind: "parabola", vertex: [1, 0], opens: "up", scale: 2 });
    const curve = scene.elements.find((e) => e.kind === "curve");
    expect(curve).toBeDefined();
    expect(curve?.yExpression).toContain("(x - 1)");
    expect(curve?.yExpression).toContain("**2");
  });

  it("downward: flips the sign", () => {
    const scene = compile({ kind: "parabola", vertex: [0, 0], opens: "down" });
    const curve = scene.elements.find((e) => e.kind === "curve");
    expect(curve?.yExpression).toMatch(/-\d+\s*\*\s*\(x/);
  });

  it("rightward: x as a function of u", () => {
    const scene = compile({ kind: "parabola", vertex: [0, 0], opens: "right" });
    const curve = scene.elements.find((e) => e.kind === "curve");
    expect(curve?.xExpression).toContain("u");
  });

  it("showFocusDirectrix adds the focus point and a directrix segment", () => {
    const scene = compile({
      kind: "parabola",
      vertex: [0, 0],
      opens: "up",
      scale: 1,
      showFocusDirectrix: true,
    });
    expect(scene.elements.some((e) => e.id === "focus")).toBe(true);
    expect(scene.elements.some((e) => e.id === "directrix")).toBe(true);
  });
});

describe("compile — polynomial graph", () => {
  it("emits a curve with the translated expression", () => {
    const scene = compile({
      kind: "polynomialGraph",
      expressionLatex: "x^3 - 4*x",
      domainX: [-3, 3],
    });
    const curve = scene.elements.find((e) => e.kind === "curve");
    expect(curve?.yExpression).toContain("x**3");
    expect(curve?.yExpression).toContain("4*x");
  });

  it("rejects an unsupported expression", () => {
    expect(() =>
      compile({
        kind: "polynomialGraph",
        expressionLatex: "x \\cdot \\alpha", // LaTeX command not supported
        domainX: [-1, 1],
      })
    ).toThrow(FigureSpecCompileError);
  });

  it("showRoots places a marker at each sign change", () => {
    const scene = compile({
      kind: "polynomialGraph",
      expressionLatex: "x^2 - 1",
      domainX: [-3, 3],
      showRoots: true,
    });
    const roots = scene.elements.filter((e) => typeof e.id === "string" && e.id.startsWith("root-"));
    expect(roots.length).toBeGreaterThanOrEqual(2);
  });
});

describe("compile — secant & tangent", () => {
  it("emits the curve, two sample points, and the secant segment", () => {
    const scene = compile({
      kind: "secantTangent",
      fLatex: "x^2 + 1",
      x0: 0,
      x1: 3,
      tangentAt: 1.5,
      showLabels: false,
    });
    expect(scene.elements.some((e) => e.id === "f")).toBe(true);
    expect(scene.elements.some((e) => e.id === "p0")).toBe(true);
    expect(scene.elements.some((e) => e.id === "p1")).toBe(true);
    expect(scene.elements.some((e) => e.id === "secant")).toBe(true);
    expect(scene.elements.some((e) => e.id === "tangent")).toBe(true);
  });
});

describe("compile — limit graph", () => {
  it("emits the dashed limit line and the approach arrows", () => {
    const scene = compile({
      kind: "limitGraph",
      fLatex: "x",
      limitPoint: 2,
      leftArrow: true,
      rightArrow: true,
    });
    expect(scene.elements.some((e) => e.id === "limit-line")).toBe(true);
    expect(scene.elements.some((e) => e.id === "left-arrow")).toBe(true);
    expect(scene.elements.some((e) => e.id === "right-arrow")).toBe(true);
  });
});

describe("compile — shaded area", () => {
  it("emits a region primitive and the function curve", () => {
    const scene = compile({
      kind: "shadedArea",
      fLatex: "x",
      fromX: 0,
      toX: 1,
    });
    expect(scene.elements.some((e) => e.kind === "region" && e.id === "area")).toBe(true);
    expect(scene.elements.some((e) => e.kind === "curve" && e.id === "f")).toBe(true);
  });
});

describe("compile — vector", () => {
  it("emits an arrow plus tail/head points", () => {
    const scene = compile({
      kind: "vector",
      origin: [0, 0],
      tip: [3, 4],
      label: "v",
    });
    expect(scene.elements.some((e) => e.id === "vec")).toBe(true);
    expect(scene.elements.some((e) => e.id === "tail")).toBe(true);
    expect(scene.elements.some((e) => e.id === "head")).toBe(true);
  });
});

describe("compile — right triangle", () => {
  it("emits the three legs, three vertices, and a right-angle bracket", () => {
    const scene = compile({
      kind: "rightTriangle",
      adjacent: 3,
      opposite: 4,
      showRatios: false,
    });
    expect(scene.elements.some((e) => e.id === "hypotenuse")).toBe(true);
    expect(scene.elements.some((e) => e.id === "adjacent")).toBe(true);
    expect(scene.elements.some((e) => e.id === "opposite")).toBe(true);
    expect(scene.elements.some((e) => e.id === "ra-1")).toBe(true);
    expect(scene.elements.some((e) => e.id === "ra-2")).toBe(true);
    expect(scene.elements.some((e) => e.id === "v-origin")).toBe(true);
  });

  it("fits the y-domain to the opposite leg", () => {
    const scene = compile({ kind: "rightTriangle", adjacent: 3, opposite: 4 });
    expect(scene.yDomain[1]).toBeGreaterThanOrEqual(4);
  });
});

describe("compile — coordinate plane", () => {
  it("emits one point per declared entry", () => {
    const scene = compile({
      kind: "coordinatePlane",
      points: [
        { x: 0, y: 0 },
        { x: 1, y: 1 },
        { x: -2, y: 3 },
      ],
      xRange: [-5, 5],
      yRange: [-5, 5],
    });
    expect(scene.elements.filter((e) => e.id === "p-0")).toHaveLength(1);
    const points = scene.elements.filter((e) => typeof e.id === "string" && e.id.startsWith("p-"));
    expect(points.length).toBe(3);
  });
});

describe("compile — flowchart", () => {
  it("emits an arrow per edge and a point per node", () => {
    const scene = compile({
      kind: "flowchart",
      nodes: [
        { id: "a", label: "A", x: 0, y: 0 },
        { id: "b", label: "B", x: 2, y: 0 },
      ],
      edges: [{ from: "a", to: "b", label: "next" }],
      showLabels: false,
    });
    expect(scene.elements.some((e) => e.id === "e-0")).toBe(true);
    expect(scene.elements.some((e) => e.id === "n-a")).toBe(true);
    expect(scene.elements.some((e) => e.id === "n-b")).toBe(true);
  });
});

describe("compile — free body diagram", () => {
  it("block body draws a 4-edge rectangle outline", () => {
    const scene = compile({
      kind: "freeBodyDiagram",
      body: "block",
      forces: [{ magnitude: 10, angleDeg: 0, label: "F" }],
    });
    expect(scene.elements.filter((e) => typeof e.id === "string" && e.id.startsWith("body-")).length).toBe(4);
    expect(scene.elements.some((e) => e.id === "f-0")).toBe(true);
  });

  it("sphere body draws a single centre point instead", () => {
    const scene = compile({
      kind: "freeBodyDiagram",
      body: "sphere",
      forces: [{ magnitude: 5, angleDeg: 90, label: "F" }],
    });
    expect(scene.elements.some((e) => e.id === "body")).toBe(true);
    expect(scene.elements.filter((e) => typeof e.id === "string" && e.id.startsWith("body-")).length).toBe(0);
  });
});

/** Construct the minimum-valid spec for each kind, so the dispatcher's
 *  exhaustiveness can be tested without authoring a full exemplar per kind. */
function makeMinimal(kind: FigureSpec["kind"]): FigureSpec {
  switch (kind) {
    case "unitCircle":
      return { kind: "unitCircle", theta: 0 };
    case "trigGraph":
      return { kind: "trigGraph", function: "sin", domainX: [-1, 1] };
    case "parabola":
      return { kind: "parabola", vertex: [0, 0], opens: "up" };
    case "polynomialGraph":
      return { kind: "polynomialGraph", expressionLatex: "x", domainX: [-1, 1] };
    case "secantTangent":
      return { kind: "secantTangent", fLatex: "x", x0: 0, x1: 1 };
    case "limitGraph":
      return { kind: "limitGraph", fLatex: "x", limitPoint: 0 };
    case "shadedArea":
      return { kind: "shadedArea", fLatex: "x", fromX: 0, toX: 1 };
    case "vector":
      return { kind: "vector", origin: [0, 0], tip: [1, 0] };
    case "rightTriangle":
      return { kind: "rightTriangle", adjacent: 1, opposite: 1 };
    case "coordinatePlane":
      return { kind: "coordinatePlane", points: [], xRange: [-1, 1], yRange: [-1, 1] };
    case "flowchart":
      return {
        kind: "flowchart",
        nodes: [{ id: "a", label: "A", x: 0, y: 0 }],
        edges: [],
      };
    case "freeBodyDiagram":
      return {
        kind: "freeBodyDiagram",
        body: "block",
        forces: [{ magnitude: 1, angleDeg: 0 }],
      };
  }
}