/**
 * Visualization Router.
 *
 * Maps a renderer-agnostic VisualizationIntent to a VisualizationRenderModel
 * that names the adapter responsible for rendering it — or an honest
 * `unsupported` verdict when no adapter exists for the intent's domain.
 *
 * The LLM never knows which rendering engine (JSXGraph, KaTeX, …) handles
 * which intent. This module is the single place that decision lives.
 */

import type {
  VisualizationIntent,
  VisualizationRenderModel,
  GeometryIntent,
  FunctionIntent,
  EquationIntent,
  ChartIntent,
  DiagramIntent,
  CircuitIntent,
  ChemistryIntent,
  GraphTheoryIntent,
} from "./types";

/** Adapter identifiers — the renderer-side registry keys. */
export const AdapterId = {
  JsxGraph: "jsxgraph",
  KaTex: "katex",
  Unsupported: "unsupported",
} as const;

/**
 * Route a validated intent to its adapter. Intents for adapters that are not
 * built yet return an honest `unsupported` model rather than a silent fallback
 * to placeholder art — that path is what previously produced an unrelated
 * planet/ellipse diagram for a circle request.
 */
export function routeVisualization(
  intent: VisualizationIntent
): VisualizationRenderModel {
  switch (intent.type) {
    case "geometry":
      return routeGeometry(intent);
    case "function":
      return routeFunction(intent);
    case "chart":
      return routeChart(intent);
    case "equation":
      return routeEquation(intent);
    case "diagram":
      return routeDiagram(intent);
    case "circuit":
      return routeCircuit(intent);
    case "chemistry":
      return routeChemistry(intent);
    case "graph_theory":
      return routeGraphTheory(intent);
    default: {
      // Exhaustiveness check: a new intent type added to the union must be
      // routed here or it is a compile error. The `never` narrowing below is
      // intentional.
      const _exhaustive: never = intent;
      void _exhaustive;
      return {
        adapterId: AdapterId.Unsupported,
        intent,
        unsupported: true,
        unsupportedReason: "Unknown visualization intent type",
      };
    }
  }
}

/* ── Per-domain routing ── */

function routeGeometry(intent: GeometryIntent): VisualizationRenderModel {
  if (intent.objects.length === 0) {
    return {
      adapterId: AdapterId.Unsupported,
      intent,
      unsupported: true,
      unsupportedReason: "Geometry intent has no objects to render",
    };
  }
  return { adapterId: AdapterId.JsxGraph, intent };
}

function routeFunction(intent: FunctionIntent): VisualizationRenderModel {
  if (intent.expressions.length === 0) {
    return {
      adapterId: AdapterId.Unsupported,
      intent,
      unsupported: true,
      unsupportedReason: "Function intent has no expressions to plot",
    };
  }
  return { adapterId: AdapterId.JsxGraph, intent };
}

function routeChart(intent: ChartIntent): VisualizationRenderModel {
  // Charts are a JSXGraph capability (`board.create("chart", …)`), but the
  // data-visualization adapter is not built in this phase. Surface honestly
  // rather than rendering a placeholder.
  return {
    adapterId: AdapterId.Unsupported,
    intent,
    unsupported: true,
    unsupportedReason:
      "Chart rendering is not available in this build of Studyus.",
  };
}

function routeEquation(intent: EquationIntent): VisualizationRenderModel {
  if (!intent.latex || !intent.latex.trim()) {
    return {
      adapterId: AdapterId.Unsupported,
      intent,
      unsupported: true,
      unsupportedReason: "Equation intent has no LaTeX to render",
    };
  }
  return { adapterId: AdapterId.KaTex, intent };
}

function routeDiagram(intent: DiagramIntent): VisualizationRenderModel {
  // The old `diagram` kind existed only to pick a preset (orbit/atom/…).
  // Presets are removed per the architectural directive; a bare `diagram`
  // intent with no objects is not something we can faithfully render, so we
  // decline rather than fabricate.
  return {
    adapterId: AdapterId.Unsupported,
    intent,
    unsupported: true,
    unsupportedReason:
      "Free-form diagrams are not available — describe the figure as a geometry, function, or equation intent instead.",
  };
}

function routeCircuit(intent: CircuitIntent): VisualizationRenderModel {
  void intent;
  return {
    adapterId: AdapterId.Unsupported,
    intent,
    unsupported: true,
    unsupportedReason: "Circuit rendering is not available in this build of Studyus.",
  };
}

function routeChemistry(intent: ChemistryIntent): VisualizationRenderModel {
  void intent;
  return {
    adapterId: AdapterId.Unsupported,
    intent,
    unsupported: true,
    unsupportedReason: "Chemistry rendering is not available in this build of Studyus.",
  };
}

function routeGraphTheory(intent: GraphTheoryIntent): VisualizationRenderModel {
  void intent;
  return {
    adapterId: AdapterId.Unsupported,
    intent,
    unsupported: true,
    unsupportedReason: "Graph-theory rendering is not available in this build of Studyus.",
  };
}
