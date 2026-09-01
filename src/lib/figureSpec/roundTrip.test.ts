/**
 * Round-trip: serialize a FigureSpec, parse it back, compile, and assert
 * the canonical elements of the textbook figure all survive.
 *
 * This is the unifying test for the whole figure-spec layer. If a spec
 * can survive JSON.stringify/JSON.parse, validate.ts accepts it, compile()
 * produces an AnimationScene, and that scene contains every element an
 * OpenStax-style textbook figure would have, then the translator is doing
 * its job: one JSON description, three producers (LLM agent, OCR pipeline,
 * hand-authored lesson JSON), one consumer.
 */

import { describe, it, expect } from "vitest";
import { compile, FigureSpecCompileError } from "./compile";
import { validateFigureSpec, validateWidgetIntent } from "../widgets/validate";
import type { FigureSpec } from "./types";
import type { FigureSpecWidget, WidgetIntent } from "../widgets/types";

describe("figure-spec round trip", () => {
  it("unitCircle: serialize → parse → compile → all elements present", () => {
    const original: FigureSpec = {
      kind: "unitCircle",
      theta: Math.PI / 6,
      showSin: true,
      showCos: true,
      showLabels: true,
    };

    // 1. serialize + parse — proves the spec is wire-portable.
    const json = JSON.stringify(original);
    const parsed = JSON.parse(json) as FigureSpec;
    expect(parsed).toEqual(original);

    // 2. compile — proves the dispatcher turns the spec into a scene.
    const scene = compile(parsed);

    // 3. assert the canonical elements an OpenStax figure would have:
    expect(scene.elements.some((e) => e.id === "circle")).toBe(true); // parametric circle
    expect(scene.elements.some((e) => e.id === "p-theta")).toBe(true); // point on the circle
    expect(scene.elements.some((e) => e.id === "radius")).toBe(true); // radius segment
    expect(scene.elements.some((e) => e.id === "cos-leg")).toBe(true); // cos projection
    expect(scene.elements.some((e) => e.id === "sin-leg")).toBe(true); // sin projection
    expect(scene.elements.some((e) => e.id === "theta-label")).toBe(true); // θ label
  });

  it("secantTangent: serialize → parse → compile → secant and tangent present", () => {
    const original: FigureSpec = {
      kind: "secantTangent",
      fLatex: "x^2 + 1",
      x0: 0,
      x1: 3,
      tangentAt: 1.5,
      showLabels: false,
    };

    const parsed = JSON.parse(JSON.stringify(original)) as FigureSpec;
    const scene = compile(parsed);

    expect(scene.elements.some((e) => e.id === "f")).toBe(true); // function curve
    expect(scene.elements.some((e) => e.id === "secant")).toBe(true); // secant segment
    expect(scene.elements.some((e) => e.id === "tangent")).toBe(true); // tangent segment
    expect(scene.elements.some((e) => e.id === "p-tangent")).toBe(true); // tangent point
  });

  it("shadedArea: serialize → parse → compile → region + curve present", () => {
    const original: FigureSpec = {
      kind: "shadedArea",
      fLatex: "x",
      fromX: 0,
      toX: 1,
    };

    const parsed = JSON.parse(JSON.stringify(original)) as FigureSpec;
    const scene = compile(parsed);

    expect(scene.elements.some((e) => e.kind === "region" && e.id === "area")).toBe(true);
    expect(scene.elements.some((e) => e.kind === "curve" && e.id === "f")).toBe(true);
  });

  it("a figure_spec widget intent survives widget-level validation and renders through SceneFigure", () => {
    // The full widget-intent path: the agent emits a a figure_spec widget;
    // validateWidgetIntent accepts it; compile() produces the scene; the
    // shape is what the existing SceneFigure chalk renderer expects.
    const widget: FigureSpecWidget = {
      kind: "figure_spec",
      spec: {
        kind: "unitCircle",
        theta: Math.PI / 4,
        showSin: true,
        showCos: true,
        showLabels: true,
      },
      caption: "Unit circle at θ = π/4.",
    };

    expect(validateWidgetIntent(widget as unknown as Record<string, unknown>).valid).toBe(true);

    const scene = compile(widget.spec);
    // The scene's shape is exactly AnimationScene, which is what the chalkboard
    // renderer in WidgetSurface.tsx consumes via its `SceneFigure` component.
    expect(scene.xDomain).toBeDefined();
    expect(scene.yDomain).toBeDefined();
    expect(Array.isArray(scene.elements)).toBe(true);
  });

  it("compile rejects an over-budget spec with a typed FigureSpecCompileError", () => {
    // Construct a flowchart with a hand-rolled spec that exceeds the
    // element cap. We use a force-cast to bypass type checks since 25
    // nodes would otherwise fail the validator.
    const tooBig = {
      kind: "flowchart",
      nodes: Array.from({ length: 25 }, (_, i) => ({
        id: `n${i}`,
        label: `N${i}`,
        x: i,
        y: 0,
      })),
      edges: [],
    } as unknown as FigureSpec;
    try {
      compile(tooBig);
      throw new Error("expected throw");
    } catch (e) {
      expect(e).toBeInstanceOf(FigureSpecCompileError);
      expect((e as FigureSpecCompileError).kind).toBe("flowchart");
    }
  });
});

describe("figure-spec — surface integration via WidgetIntent dispatch", () => {
  it("validateWidgetIntent passes a minimal figure_spec widget", () => {
    const widget: WidgetIntent = {
      kind: "figure_spec",
      spec: { kind: "unitCircle", theta: Math.PI / 6 },
    };
    const result = validateWidgetIntent(widget as unknown as Record<string, unknown>);
    expect(result.valid).toBe(true);
  });

  it("validateWidgetIntent rejects a figure_spec with a missing spec", () => {
    const widget = { kind: "figure_spec" } as unknown as Record<string, unknown>;
    const result = validateWidgetIntent(widget);
    expect(result.valid).toBe(false);
  });

  it("validateWidgetIntent rejects a figure_spec with an out-of-range theta", () => {
    const widget = {
      kind: "figure_spec",
      spec: { kind: "unitCircle", theta: NaN },
    } as unknown as Record<string, unknown>;
    const result = validateWidgetIntent(widget);
    expect(result.valid).toBe(false);
  });

  it("validateWidgetIntent rejects a figure_spec with an over-long expression", () => {
    const widget = {
      kind: "figure_spec",
      spec: {
        kind: "polynomialGraph",
        expressionLatex: "x".repeat(300),
        domainX: [-1, 1],
      },
    } as unknown as Record<string, unknown>;
    const result = validateWidgetIntent(widget);
    expect(result.valid).toBe(false);
  });
});