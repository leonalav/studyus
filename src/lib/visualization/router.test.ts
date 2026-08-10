import { describe, it, expect } from "vitest";
import { routeVisualization, AdapterId } from "./router";
import type {
  VisualizationIntent,
  GeometryIntent,
  FunctionIntent,
  EquationIntent,
  ChartIntent,
  DiagramIntent,
  CircuitIntent,
  ChemistryIntent,
  GraphTheoryIntent,
} from "./types";

/* ── fixtures ── */

const geometry: GeometryIntent = {
  type: "geometry",
  objects: [
    { kind: "point", id: "O", label: "O", at: [0, 0] },
    { kind: "point", id: "A", label: "A", at: [3, 0] },
    { kind: "circle", id: "c1", center: "O", through: "A" },
  ],
};

const fn: FunctionIntent = {
  type: "function",
  domainX: [-5, 5],
  expressions: [{ id: "f", expression: "x^2 - 2*x + 1", label: "f(x)" }],
};

const equation: EquationIntent = { type: "equation", latex: "E = mc^2" };

const chart: ChartIntent = {
  type: "chart",
  chartType: "bar",
  data: [{ id: "s1", label: "A", values: [1, 2, 3] }],
};

const diagram: DiagramIntent = { type: "diagram", variant: "orbit" };

const circuit: CircuitIntent = { type: "circuit", components: [] };

const chemistry: ChemistryIntent = { type: "chemistry", molecule: "H2O" };

const graph: GraphTheoryIntent = {
  type: "graph_theory",
  nodes: [{ id: "n1" }, { id: "n2" }],
  edges: [{ from: "n1", to: "n2" }],
};

describe("routeVisualization — adapter selection", () => {
  it("routes geometry with objects to JSXGraph", () => {
    const m = routeVisualization(geometry);
    expect(m.adapterId).toBe(AdapterId.JsxGraph);
    expect(m.unsupported).toBeUndefined();
  });

  it("routes function with expressions to JSXGraph", () => {
    const m = routeVisualization(fn);
    expect(m.adapterId).toBe(AdapterId.JsxGraph);
    expect(m.unsupported).toBeUndefined();
  });

  it("routes equation with latex to KaTeX", () => {
    const m = routeVisualization(equation);
    expect(m.adapterId).toBe(AdapterId.KaTex);
    expect(m.unsupported).toBeUndefined();
  });

  it("declines a chart intent honestly rather than rendering placeholder art", () => {
    const m = routeVisualization(chart);
    expect(m.adapterId).toBe(AdapterId.Unsupported);
    expect(m.unsupported).toBe(true);
    expect(typeof m.unsupportedReason).toBe("string");
    expect(m.unsupportedReason).toMatch(/not available/i);
  });

  it("declines the bare diagram type — presets are removed, never fabricated", () => {
    const m = routeVisualization(diagram);
    expect(m.adapterId).toBe(AdapterId.Unsupported);
    expect(m.unsupported).toBe(true);
    expect(m.unsupportedReason).toMatch(/geometry|function|equation/i);
  });

  it("declines circuit, chemistry, and graph_theory honestly", () => {
    for (const intent of [circuit, chemistry, graph] as VisualizationIntent[]) {
      const m = routeVisualization(intent);
      expect(m.adapterId).toBe(AdapterId.Unsupported);
      expect(m.unsupported).toBe(true);
    }
  });
});

describe("routeVisualization — malformed intents surface honestly", () => {
  it("declines a geometry intent with zero objects", () => {
    const m = routeVisualization({ type: "geometry", objects: [] });
    expect(m.adapterId).toBe(AdapterId.Unsupported);
    expect(m.unsupported).toBe(true);
  });

  it("declines a function intent with zero expressions", () => {
    const m = routeVisualization({ type: "function", domainX: [-5, 5], expressions: [] });
    expect(m.adapterId).toBe(AdapterId.Unsupported);
    expect(m.unsupported).toBe(true);
  });

  it("declines an equation with empty latex", () => {
    const m = routeVisualization({ type: "equation", latex: "   " });
    expect(m.adapterId).toBe(AdapterId.Unsupported);
    expect(m.unsupported).toBe(true);
  });
});
