import { describe, it, expect } from "vitest";
import { validateVisualizationIntent } from "./validate";

describe("validateVisualizationIntent — displayMode", () => {
  it("accepts graph and graphless on geometry and function intents", () => {
    expect(
      validateVisualizationIntent({
        type: "geometry",
        displayMode: "graphless",
        objects: [{ kind: "point", id: "A", at: [0, 0] }],
      })
    ).toEqual({ valid: true });

    expect(
      validateVisualizationIntent({
        type: "function",
        displayMode: "graph",
        domainX: [-5, 5],
        xLabel: "x",
        yLabel: "y",
        showGrid: true,
        showLegend: true,
        sampling: { samples: 256, adaptive: true },
        expressions: [{ id: "f", expression: "x" }],
        annotations: [
          { kind: "root", id: "r1", expressionId: "f", nearX: 0, label: "root" },
          { kind: "point", id: "p1", x: 1, y: 1, labelLatex: "(1,1)" },
        ],
      })
    ).toEqual({ valid: true });
  });

  it("rejects unknown display modes", () => {
    const geometry = validateVisualizationIntent({
      type: "geometry",
      displayMode: "axes",
      objects: [{ kind: "point", id: "A", at: [0, 0] }],
    });
    expect(geometry.valid).toBe(false);
    if (!geometry.valid) expect(geometry.reason).toMatch(/displayMode/i);

    const fn = validateVisualizationIntent({
      type: "function",
      displayMode: "axes",
      domainX: [-5, 5],
      expressions: [{ id: "f", expression: "x" }],
    });
    expect(fn.valid).toBe(false);
    if (!fn.valid) expect(fn.reason).toMatch(/displayMode/i);
  });
});

describe("validateVisualizationIntent — graph stack planning schemas", () => {
  it("accepts the planned chart and graph_theory schema shapes", () => {
    expect(validateVisualizationIntent({
      type: "chart",
      title: "Climate",
      chartType: "heatmap",
      xAxis: { label: "Month", min: 0, max: 11 },
      yAxis: { label: "Hour", min: 0, max: 23 },
      legend: true,
      tooltip: true,
      showZoom: true,
      series: [
        {
          kind: "heatmap",
          id: "h1",
          name: "temperature",
          points: [[0, 0, 12], [1, 0, 13], [0, 1, 11]],
          color: "#60a5fa",
        },
      ],
      annotations: [{ kind: "line", y: 18, label: "threshold" }],
    })).toEqual({ valid: true });

    expect(validateVisualizationIntent({
      type: "graph_theory",
      title: "Weighted graph",
      layout: "cose",
      directed: true,
      style: { compact: false, showLabels: true },
      nodes: [{ id: "A", label: "A", color: "#60a5fa", shape: "diamond", size: 30, at: [0, 0] }, { id: "B", label: "B" }],
      edges: [{ from: "A", to: "B", label: "5", color: "#86efac", width: 2, style: "dashed", directed: true, curvature: 0.2 }],
    })).toEqual({ valid: true });
  });

  it("accepts the planned graph3d schema shape", () => {
    expect(
      validateVisualizationIntent({
        type: "graph3d",
        title: "z = sin(x) cos(y)",
        axes: { xLabel: "x", yLabel: "y", zLabel: "z", showGrid: true },
        domain: { x: [-5, 5], y: [-5, 5], z: [-2, 2] },
        camera: { azimuth: 45, elevation: 30, distance: 10 },
        sampling: { xSteps: 48, ySteps: 48 },
        surfaces: [
          { kind: "surface", id: "s1", z: "sin(x) * cos(y)", renderMode: "surface", opacity: 0.8 },
          { kind: "parametric_curve", id: "c1", tDomain: [0, 6.28], x: "cos(t)", y: "sin(t)", z: "t/6" },
          { kind: "point", id: "p1", at: [0, 0, 0], label: "O" },
        ],
      })
    ).toEqual({ valid: true });
  });

  it("rejects malformed graph3d and chart/network schemas", () => {
    const bad = validateVisualizationIntent({
      type: "graph3d",
      sampling: { xSteps: 2 },
      surfaces: [{ kind: "surface", id: "s1", z: "x+y", opacity: 2 }],
    });
    expect(bad.valid).toBe(false);

    expect(validateVisualizationIntent({
      type: "chart",
      chartType: "bar",
      series: [{ kind: "bar", id: "s1", name: "bad", values: [1, 'x'] }],
    } as any).valid).toBe(false);

    expect(validateVisualizationIntent({
      type: "graph_theory",
      nodes: [{ id: "A", shape: "blob" }],
      edges: [],
    } as any).valid).toBe(false);
  });
});

describe("validateVisualizationIntent — science domain schemas", () => {
  it("accepts starter physics, biology, circuit, and chemistry intents", () => {
    expect(validateVisualizationIntent({
      type: "physics",
      variant: "mechanics_scene",
      bodies: [{ id: "m", at: [0, 0], label: "m", shape: "box" }],
      vectors: [{ id: "w", from: "m", dx: 0, dy: -2, label: "mg", kind: "force" }],
      decorations: [{ kind: "ground", id: "g", fromX: -2, toX: 2, y: -1 }],
    })).toEqual({ valid: true });

    expect(validateVisualizationIntent({
      type: "biology",
      variant: "pathway",
      layout: "cose",
      style: { directed: true, nodeColorByKind: true, compact: false },
      structures: [{ id: "n", label: "Nucleus", at: [0, 0], kind: "nucleus" }],
    })).toEqual({ valid: true });

    expect(validateVisualizationIntent({
      type: "circuit",
      nodes: [{ id: "n1", at: [0, 0] }, { id: "n2", at: [4, 0] }],
      wires: [{ id: "w1", from: "n1", to: "n2" }],
      components: [{ kind: "battery", id: "b1", between: ["n1", "n2"] }],
    })).toEqual({ valid: true });

    expect(validateVisualizationIntent({
      type: "chemistry",
      variant: "reaction",
      reactants: [{ id: "r1", molecule: "O" }, { id: "r2", molecule: "[H][H]" }],
      products: [{ id: "p1", molecule: "O" }],
      agents: ["heat"],
    })).toEqual({ valid: true });
  });

  it("rejects malformed science intents", () => {
    expect(validateVisualizationIntent({ type: "physics", variant: "free_body", vectors: [{ id: "v1", from: "m" }] }).valid).toBe(false);
    expect(validateVisualizationIntent({ type: "physics", variant: "free_body", decorations: [{ kind: "ground", id: "g", fromX: 0, toX: 1, y: Number.NaN }] }).valid).toBe(false);
    expect(validateVisualizationIntent({ type: "biology", variant: "pathway", layout: "spiral", structures: [{ id: "a", label: "A", at: [0, 0] }], connections: [{ from: "a", to: "b" }] }).valid).toBe(false);
    expect(validateVisualizationIntent({ type: "circuit", nodes: [{ id: "n1", at: [0, 0] }], wires: [], components: [{ kind: "battery", id: "b1", between: ["n1", "n2"] }] }).valid).toBe(false);
    expect(validateVisualizationIntent({ type: "chemistry", atoms: [{ id: "O", element: "O", at: [0, 0] }], bonds: [{ from: "O", to: "H", order: 4 }] }).valid).toBe(false);
  });
});

describe("validateVisualizationIntent — geometry notation fields", () => {
  it("accepts right-angle, congruent-side, parallel, midpoint, and latex notation", () => {
    expect(
      validateVisualizationIntent({
        type: "geometry",
        objects: [
          { kind: "point", id: "A", at: [0, 0] },
          { kind: "point", id: "B", at: [3, 0] },
          { kind: "point", id: "C", at: [0, 3] },
          { kind: "point", id: "D", at: [3, 3] },
          { kind: "segment", id: "AB", from: "A", to: "B", tickCount: 2, midpointMarker: true, labelLatex: "x+2" },
          { kind: "segment", id: "AC", from: "A", to: "C", tickCount: 2 },
          { kind: "segment", id: "CD", from: "C", to: "D", parallelMarkCount: 1 },
          { kind: "segment", id: "AB2", from: "A", to: "B", parallelMarkCount: 1 },
          { kind: "line", id: "l1", through: ["A", "D"], parallelMarkCount: 2 },
          { kind: "angle", id: "Aang", from: "B", at: "A", to: "C", marker: "right_angle", labelLatex: "90^\\circ" },
        ],
      })
    ).toEqual({ valid: true });
  });

  it("accepts standalone notation objects for phase 2", () => {
    expect(
      validateVisualizationIntent({
        type: "geometry",
        objects: [
          { kind: "point", id: "A", at: [0, 0] },
          { kind: "point", id: "B", at: [4, 0] },
          { kind: "point", id: "C", at: [0, 4] },
          { kind: "point", id: "D", at: [2, 2] },
          { kind: "segment", id: "AB", from: "A", to: "B" },
          { kind: "segment", id: "AC", from: "A", to: "C" },
          { kind: "notation", id: "n1", variant: "segment", from: "A", to: "B", tickCount: 2, labelLatex: "x" },
          { kind: "notation", id: "n2", variant: "parallel", from: "A", to: "B", markCount: 1 },
          { kind: "notation", id: "n3", variant: "midpoint", from: "A", to: "B", label: "M" },
          { kind: "notation", id: "n4", variant: "perpendicular", at: "A", arm1: "B", arm2: "C", size: 0.6 },
          { kind: "notation", id: "n5", variant: "bisector", from: "B", at: "A", through: "D", to: "C", labelLatex: "\\theta" },
        ],
      })
    ).toEqual({ valid: true });
  });

  it("rejects invalid notation counts and markers", () => {
    const badSegment = validateVisualizationIntent({
      type: "geometry",
      objects: [
        { kind: "point", id: "A", at: [0, 0] },
        { kind: "point", id: "B", at: [1, 0] },
        { kind: "segment", id: "AB", from: "A", to: "B", tickCount: 0 },
      ],
    });
    expect(badSegment.valid).toBe(false);

    const badParallel = validateVisualizationIntent({
      type: "geometry",
      objects: [
        { kind: "point", id: "A", at: [0, 0] },
        { kind: "point", id: "B", at: [1, 0] },
        { kind: "line", id: "l1", through: ["A", "B"], parallelMarkCount: 9 },
      ],
    });
    expect(badParallel.valid).toBe(false);

    const badAngle = validateVisualizationIntent({
      type: "geometry",
      objects: [
        { kind: "point", id: "A", at: [0, 0] },
        { kind: "point", id: "B", at: [1, 0] },
        { kind: "point", id: "C", at: [0, 1] },
        { kind: "angle", id: "Aang", from: "B", at: "A", to: "C", marker: "square" },
      ],
    });
    expect(badAngle.valid).toBe(false);

    const badNotation = validateVisualizationIntent({
      type: "geometry",
      objects: [
        { kind: "point", id: "A", at: [0, 0] },
        { kind: "point", id: "B", at: [1, 0] },
        { kind: "notation", id: "n1", variant: "parallel", from: "A", to: "B", markCount: 0 },
      ],
    });
    expect(badNotation.valid).toBe(false);
  });
});

describe("validateVisualizationIntent — chart renderer compatibility", () => {
  it("rejects series kinds that do not exactly match chartType", () => {
    const result = validateVisualizationIntent({
      type: "chart",
      chartType: "bar",
      series: [{ kind: "line", id: "s1", name: "wrong", values: [1, 2] }],
    });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toMatch(/requires bar series/i);
  });

  it("limits legacy data to chart types it can safely normalize", () => {
    const result = validateVisualizationIntent({
      type: "chart",
      chartType: "pie",
      data: [{ id: "s1", label: "legacy", values: [1, 2] }],
    });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toMatch(/legacy chart data/i);
  });

  it("rejects empty cartesian data and malformed grids", () => {
    expect(validateVisualizationIntent({
      type: "chart",
      chartType: "line",
      series: [{ kind: "line", id: "s1", name: "empty", values: [] }],
    }).valid).toBe(false);

    expect(validateVisualizationIntent({
      type: "chart",
      chartType: "heatmap",
      series: [{
        kind: "heatmap",
        id: "h1",
        grid: { x: [0, 1], y: [0, 1], values: [[1, 2], [3]] },
      }],
    }).valid).toBe(false);
  });

  it("accepts a finite rectangular grid and enforces radar dimensions", () => {
    expect(validateVisualizationIntent({
      type: "chart",
      chartType: "contour",
      series: [{
        kind: "contour",
        id: "c1",
        grid: { x: [0, 1], y: [0, 1], values: [[1, 2], [3, 4]] },
      }],
    })).toEqual({ valid: true });

    expect(validateVisualizationIntent({
      type: "chart",
      chartType: "radar",
      indicators: [{ name: "A" }, { name: "B" }],
      series: [{ kind: "radar", id: "r1", name: "R", values: [1] }],
    }).valid).toBe(false);
  });

  it("bounds recursive tree chart complexity", () => {
    let root: any = { name: "leaf", value: 1 };
    for (let index = 0; index < 21; index += 1) root = { name: `level-${index}`, children: [root] };
    expect(validateVisualizationIntent({
      type: "chart",
      chartType: "sunburst",
      series: [{ kind: "sunburst", id: "tree", nodes: [root] }],
    }).valid).toBe(false);
  });
});
