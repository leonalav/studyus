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

/** Adapter identifiers — the renderer-side registry keys. */
export const AdapterId = {
  GeometrySvg: "geometry-svg",
  Graph2DJsxGraph: "graph2d-jsxgraph",
  Graph3DR3F: "graph3d-r3f",
  ChartECharts: "chart-echarts",
  GraphTheoryCytoscape: "graph-theory-cytoscape",
  PhysicsSvg: "physics-svg",
  Physics3DR3F: "physics-3d-r3f",
  ChemistryRDKit: "chemistry-rdkit",
  BiologySvg: "biology-svg",
  BiologyNetwork: "biology-network",
  KaTex: "katex",
  PhetLocked: "phet-locked",
  Unsupported: "unsupported",
  // Back-compat aliases for already-rendered blocks/tests; current renderers use
  // the old ids while the adapter map expands toward the approved stack.
  JsxGraph: "jsxgraph",
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
    case "graph3d":
      return routeGraph3D(intent);
    case "chart":
      return routeChart(intent);
    case "equation":
      return routeEquation(intent);
    case "diagram":
      return routeDiagram(intent);
    case "physics":
      return routePhysics(intent);
    case "biology":
      return routeBiology(intent);
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

function routeGraph3D(intent: Graph3DIntent): VisualizationRenderModel {
  if (intent.surfaces.length === 0) {
    return {
      adapterId: AdapterId.Unsupported,
      intent,
      unsupported: true,
      unsupportedReason: "3D graph intent has no objects to render",
    };
  }
  return { adapterId: AdapterId.Graph3DR3F, intent };
}

function routeChart(intent: ChartIntent): VisualizationRenderModel {
  const hasData = (intent.series && intent.series.length > 0) || (intent.data && intent.data.length > 0);
  if (!hasData) {
    return {
      adapterId: AdapterId.Unsupported,
      intent,
      unsupported: true,
      unsupportedReason: "Chart intent has no series to render",
    };
  }
  return { adapterId: AdapterId.ChartECharts, intent };
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
      "Free-form diagrams are not available — describe the figure as a geometry, function, equation, physics, biology, circuit, or chemistry intent instead.",
  };
}

function routePhysics(intent: PhysicsIntent): VisualizationRenderModel {
  return { adapterId: AdapterId.PhysicsSvg, intent };
}

function routeBiology(intent: BiologyIntent): VisualizationRenderModel {
  return { adapterId: AdapterId.BiologySvg, intent };
}

function routeCircuit(intent: CircuitIntent): VisualizationRenderModel {
  return { adapterId: AdapterId.PhysicsSvg, intent };
}

function routeChemistry(intent: ChemistryIntent): VisualizationRenderModel {
  return { adapterId: AdapterId.ChemistryRDKit, intent };
}

function routeGraphTheory(intent: GraphTheoryIntent): VisualizationRenderModel {
  if (intent.nodes.length === 0) {
    return {
      adapterId: AdapterId.Unsupported,
      intent,
      unsupported: true,
      unsupportedReason: "Graph theory intent has no nodes to render",
    };
  }
  return { adapterId: AdapterId.GraphTheoryCytoscape, intent };
}
