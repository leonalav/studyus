import { describe, expect, it } from "vitest";
import {
  ASSESSMENT_VISUALIZATION_AUTHORING_GUIDE,
  ASSESSMENT_VISUALIZATION_EVALUATION_GUIDE,
  parseAssessmentFigureJson,
  stemReferencesAssessmentFigure,
  validateAssessmentFigure,
} from "./assessmentFigure";

const supportedFigures = [
  {
    type: "geometry",
    displayMode: "graphless",
    objects: [
      { kind: "point", id: "A", at: [0, 0] },
      { kind: "point", id: "B", at: [2, 0] },
      { kind: "point", id: "C", at: [1, 2] },
      { kind: "polygon", id: "ABC", vertices: ["A", "B", "C"] },
    ],
  },
  {
    type: "function",
    domainX: [-3, 3],
    expressions: [{ id: "f", expression: "x^2", label: "f" }],
  },
  {
    type: "graph3d",
    domain: { x: [-2, 2], y: [-2, 2] },
    surfaces: [{ kind: "surface", id: "s", z: "x^2-y^2" }],
  },
  {
    type: "chart",
    chartType: "histogram",
    xLabel: "Value",
    series: [{ kind: "histogram", id: "h", name: "sample", values: [1, 1, 2, 3, 5], bins: 4 }],
  },
  { type: "equation", latex: "F = ma", editable: false },
  {
    type: "physics",
    variant: "free_body",
    bodies: [{ id: "m", label: "m", at: [0, 0], shape: "box" }],
    vectors: [{ id: "w", from: "m", dx: 0, dy: -2, label: "mg", kind: "force" }],
  },
  {
    type: "biology",
    variant: "pathway",
    structures: [{ id: "g", label: "Gene", at: [0, 0], kind: "gene" }],
  },
  {
    type: "circuit",
    nodes: [{ id: "n1", at: [0, 0] }, { id: "n2", at: [3, 0] }],
    wires: [{ id: "w", from: "n1", to: "n2" }],
    components: [{ kind: "resistor", id: "r", between: ["n1", "n2"], label: "R" }],
  },
  {
    type: "chemistry",
    variant: "molecule",
    molecule: "CCO",
  },
  {
    type: "graph_theory",
    directed: true,
    nodes: [{ id: "A" }, { id: "B" }],
    edges: [{ from: "A", to: "B", weight: 2 }],
  },
] as const;

describe("assessment figure trust boundary", () => {
  it.each(supportedFigures.map((figure) => [figure.type, figure] as const))(
    "accepts the supported %s chalkboard family",
    (_type, figure) => {
      expect(validateAssessmentFigure(figure)).toMatchObject({ ok: true });
    }
  );

  it("rejects legacy/unrenderable diagrams, empty science scenes, and answer-revealing labels", () => {
    expect(validateAssessmentFigure({ type: "diagram", variant: "anything" })).toMatchObject({ ok: false });
    expect(validateAssessmentFigure({ type: "physics", variant: "free_body" })).toMatchObject({ ok: false });
    expect(validateAssessmentFigure({
      type: "equation",
      latex: "x=4",
      caption: "The correct answer is 4",
    })).toMatchObject({ ok: false });
  });

  it("parses and revalidates persisted JSON instead of trusting database text", () => {
    const valid = parseAssessmentFigureJson(JSON.stringify(supportedFigures[3]));
    expect(valid).toMatchObject({ ok: true });
    expect(parseAssessmentFigureJson("{not json")).toMatchObject({ ok: false });
    expect(parseAssessmentFigureJson(null)).toBeNull();
  });

  it("requires figure-bearing stems to point learners to the visual", () => {
    expect(stemReferencesAssessmentFigure("Analyze the histogram shown below.")).toBe(true);
    expect(stemReferencesAssessmentFigure("Evaluate the claim using only the prose excerpt.")).toBe(false);
  });

  it("gives both agents complete visualization-domain guidance", () => {
    for (const family of ["geometry", "function", "graph3d", "chart", "equation", "physics", "biology", "circuit", "chemistry", "graph_theory"]) {
      expect(ASSESSMENT_VISUALIZATION_AUTHORING_GUIDE).toContain(family);
    }
    for (const chartType of ["bar", "line", "scatter", "histogram", "box", "heatmap", "contour", "pie", "donut", "radar", "polar_line", "polar_scatter", "sankey", "treemap", "sunburst", "candlestick", "ohlc"]) {
      expect(ASSESSMENT_VISUALIZATION_AUTHORING_GUIDE).toContain(chartType);
    }
    expect(ASSESSMENT_VISUALIZATION_EVALUATION_GUIDE).toContain("authoritative semantic VisualizationIntent");
    expect(ASSESSMENT_VISUALIZATION_EVALUATION_GUIDE).toContain("Grade against that exact specification");
  });
});
