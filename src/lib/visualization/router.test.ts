import { describe, it, expect } from "vitest";
import { routeVisualization, AdapterId } from "./router";
import type {
  GeometryIntent,
  FunctionIntent,
  Graph3DIntent,
  EquationIntent,
  ChartIntent,
  DiagramIntent,
  PhysicsIntent,
  BiologyIntent,
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

const graph3d: Graph3DIntent = {
  type: "graph3d",
  surfaces: [{ kind: "surface", id: "s1", z: "sin(x) * cos(y)" }],
};

const equation: EquationIntent = { type: "equation", latex: "E = mc^2" };

const chart: ChartIntent = {
  type: "chart",
  chartType: "bar",
  data: [{ id: "s1", label: "A", values: [1, 2, 3] }],
};

const diagram: DiagramIntent = { type: "diagram", variant: "orbit" };

const physics: PhysicsIntent = {
  type: "physics",
  variant: "free_body",
  bodies: [{ id: "box", at: [0, 0], label: "m" }],
  vectors: [{ id: "w", from: "box", dx: 0, dy: -2, label: "mg" }],
};

const biology: BiologyIntent = {
  type: "biology",
  variant: "cell",
  structures: [{ id: "n", label: "Nucleus", at: [0, 0], kind: "nucleus" }],
};

const circuit: CircuitIntent = {
  type: "circuit",
  nodes: [{ id: "n1", at: [0, 0] }, { id: "n2", at: [4, 0] }],
  wires: [{ id: "w1", from: "n1", to: "n2" }],
  components: [{ kind: "battery", id: "b1", between: ["n1", "n2"] }],
};

const chemistry: ChemistryIntent = {
  type: "chemistry",
  atoms: [
    { id: "O", element: "O", at: [0, 0] },
    { id: "H1", element: "H", at: [-1, -1] },
    { id: "H2", element: "H", at: [1, -1] },
  ],
  bonds: [{ from: "O", to: "H1" }, { from: "O", to: "H2" }],
  molecule: "H2O",
};

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

  it("routes chart intents to the generic chart adapter", () => {
    const m = routeVisualization(chart);
    expect(m.adapterId).toBe(AdapterId.ChartECharts);
    expect(m.unsupported).toBeUndefined();
  });

  it("declines the bare diagram type — presets are removed, never fabricated", () => {
    const m = routeVisualization(diagram);
    expect(m.adapterId).toBe(AdapterId.Unsupported);
    expect(m.unsupported).toBe(true);
    expect(m.unsupportedReason).toMatch(/geometry|function|equation/i);
  });

  it("routes graph3d to the three.js/r3f adapter", () => {
    const m = routeVisualization(graph3d);
    expect(m.adapterId).toBe(AdapterId.Graph3DR3F);
    expect(m.unsupported).toBeUndefined();
  });

  it("routes physics, biology, circuit, and chemistry to domain adapters", () => {
    expect(routeVisualization(physics).adapterId).toBe(AdapterId.PhysicsSvg);
    expect(routeVisualization(biology).adapterId).toBe(AdapterId.BiologySvg);
    expect(routeVisualization(circuit).adapterId).toBe(AdapterId.PhysicsSvg);
    expect(routeVisualization(chemistry).adapterId).toBe(AdapterId.ChemistryRDKit);
  });

  it("routes graph_theory to the network adapter", () => {
    const m = routeVisualization(graph);
    expect(m.adapterId).toBe(AdapterId.GraphTheoryCytoscape);
    expect(m.unsupported).toBeUndefined();
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

  it("declines a 3D graph intent with zero objects", () => {
    const m = routeVisualization({ type: "graph3d", surfaces: [] });
    expect(m.adapterId).toBe(AdapterId.Unsupported);
    expect(m.unsupported).toBe(true);
  });

  it("declines a chart with no series and a graph with no nodes", () => {
    const chart = routeVisualization({ type: "chart", chartType: "bar", series: [] });
    expect(chart.adapterId).toBe(AdapterId.Unsupported);
    expect(chart.unsupported).toBe(true);

    const graph = routeVisualization({ type: "graph_theory", nodes: [], edges: [] });
    expect(graph.adapterId).toBe(AdapterId.Unsupported);
    expect(graph.unsupported).toBe(true);
  });
});
