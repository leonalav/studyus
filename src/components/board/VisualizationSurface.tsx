/**
 * Visualization Surface — the single render target for `kind: "visualization"`
 * board blocks.
 *
 * This component is the React-side half of the Visualization Router. It takes
 * a validated VisualizationIntent plus the chalkboard's chalk/accent palette,
 * routes it (via `routeVisualization`) to the correct adapter, and renders it
 * with the chalk-styling recipe carried forward from the old placeholder
 * SVG art:
 *   - axes        stroke=chalk  strokeWidth 1.6  opacity 0.75
 *   - ticks       stroke=chalk  strokeWidth 1.2  opacity 0.6
 *   - curves      strokeWidth 2.2  strokeLinecap round  opacity 0.95
 *   - constructionlines strokeDasharray "7 6" / "4 4"
 *   - accent fills opacity ~0.28–0.75 (sparingly)
 *   - labels      chalk/accent  opacity 0.7–0.85
 *   - caption     mt-1 text-[13px] opacity-70
 *
 * The LLM never knows that geometry/function are JSXGraph and equations are
 * KaTeX — that decision lives in the router, one layer below this component.
 *
 * Interactive geometry points are draggable; when a point moves, `onState` is
 * called with the updated `pointPositions` so the caller can persist the
 * learner's manipulations with the session (Task #6).
 */

import { useEffect, useMemo, useRef, useState } from "react";
import JXG from "jsxgraph";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { all, create } from "mathjs";
import type { MathNode } from "mathjs";
import { contours as d3Contours } from "d3-contour";
import type { Core as CytoscapeCore } from "cytoscape";
import rdkitJsUrl from "@rdkit/rdkit/dist/RDKit_minimal.js?url";
import rdkitWasmUrl from "@rdkit/rdkit/dist/RDKit_minimal.wasm?url";
import { renderMath } from "../../lib/latex/render";
import type { Board, Point, GeometryElement } from "jsxgraph";
import type {
  VisualizationIntent,
  VisualizationState,
  VisualizationDisplayMode,
  GeometryIntent,
  GeometryObject,
  FunctionIntent,
  Graph3DIntent,
  ChartIntent,
  GraphTheoryIntent,
  PhysicsIntent,
  BiologyIntent,
  CircuitIntent,
  ChemistryIntent,
  CircleObject,
} from "../../lib/visualization/types";
import { routeVisualization } from "../../lib/visualization/router";

const loadECharts = (() => {
  let pending: Promise<typeof import("echarts")> | undefined;
  return () => {
    if (!pending) {
      pending = import("echarts").catch((error) => {
        pending = undefined;
        throw error;
      });
    }
    return pending;
  };
})();

type CytoscapeFactory = typeof import("cytoscape");

const loadCytoscape = (() => {
  let pending: Promise<CytoscapeFactory> | undefined;
  return () => {
    if (!pending) {
      pending = import("cytoscape").then((module) => {
        // Cytoscape's CommonJS-style declarations differ from the namespace Vite
        // returns for a dynamic import. Normalize that boundary once for all users.
        const namespace = module as unknown as { default?: CytoscapeFactory };
        return namespace.default ?? (module as unknown as CytoscapeFactory);
      }).catch((error) => {
        pending = undefined;
        throw error;
      });
    }
    return pending;
  };
})();

export type VisualizationAdapterPrewarmTarget = "chart" | "network";

/** Return only the heavy adapters plausibly needed by an explicit request. */
export function getVisualizationPrewarmTargets(request: string): VisualizationAdapterPrewarmTarget[] {
  const targets: VisualizationAdapterPrewarmTarget[] = [];
  if (/\b(chart|plot|histogram|scatter(?:plot)?|heatmap|contour|radar|candlestick|ohlc|treemap|sunburst|sankey)\b/i.test(request)) {
    targets.push("chart");
  }
  if (/\b(network|graph theory|node[- ]link|pathway)\b/i.test(request)) {
    targets.push("network");
  }
  return targets;
}

/**
 * Begin loading selected visualization engines while the tutor is thinking.
 * Mounted adapters reuse these cached imports; this does not create a renderer.
 */
export function prewarmVisualizationAdapters(targets: readonly VisualizationAdapterPrewarmTarget[]) {
  if (targets.includes("chart")) void loadECharts().catch(() => undefined);
  if (targets.includes("network")) void loadCytoscape().catch(() => undefined);
}

export interface VisualizationSurfaceProps {
  intent: VisualizationIntent;
  state?: VisualizationState;
  chalk: string;
  accent: string;
  scale?: number;
  /** Allow navigation/tooltips while preventing authored objects from being moved. */
  readOnly?: boolean;
  onState?: (next: VisualizationState) => void;
}

/** Multi-series palette carried over from the placeholder Graph2D. */
const SERIES_PALETTE = ["#f9a8d4", "#60a5fa", "#fbbf24", "#4ade80"];

/** Angle arc radius, in user units. Shared with `geometryExtent` so the arc is
 *  part of the measured footprint rather than an unaccounted overhang. */
const ANGLE_ARC_RADIUS = 0.8;
const MATH = create(all, {});
const ALLOWED_MATH_CONSTANT_SYMBOLS = new Set(["e", "pi"]);
const ALLOWED_MATH_FUNCTIONS = new Set([
  "sin", "cos", "tan", "asin", "acos", "atan",
  "sinh", "cosh", "tanh",
  "sqrt", "abs", "log", "ln", "exp",
  "floor", "ceil", "round", "sign", "min", "max"
]);

type LabelAttrs = Record<string, unknown>;
let rdkitModulePromise: Promise<any> | null = null;

const CHEMISTRY_STRUCTURE_PRESETS: Record<string, { atoms: ChemistryIntent['atoms']; bonds: ChemistryIntent['bonds']; title?: string }> = {
  water: {
    atoms: [
      { id: 'O', element: 'O', at: [0, 0] },
      { id: 'H1', element: 'H', at: [-1.35, -0.95] },
      { id: 'H2', element: 'H', at: [1.35, -0.95] },
    ],
    bonds: [
      { from: 'O', to: 'H1', order: 1 },
      { from: 'O', to: 'H2', order: 1 },
    ],
  },
  h2o: {
    atoms: [
      { id: 'O', element: 'O', at: [0, 0] },
      { id: 'H1', element: 'H', at: [-1.35, -0.95] },
      { id: 'H2', element: 'H', at: [1.35, -0.95] },
    ],
    bonds: [
      { from: 'O', to: 'H1', order: 1 },
      { from: 'O', to: 'H2', order: 1 },
    ],
  },
  ammonia: {
    atoms: [
      { id: 'N', element: 'N', at: [0, 0] },
      { id: 'H1', element: 'H', at: [-1.1, -0.85] },
      { id: 'H2', element: 'H', at: [0, -1.2] },
      { id: 'H3', element: 'H', at: [1.1, -0.85] },
    ],
    bonds: [
      { from: 'N', to: 'H1', order: 1 },
      { from: 'N', to: 'H2', order: 1 },
      { from: 'N', to: 'H3', order: 1 },
    ],
  },
  nh3: {
    atoms: [
      { id: 'N', element: 'N', at: [0, 0] },
      { id: 'H1', element: 'H', at: [-1.1, -0.85] },
      { id: 'H2', element: 'H', at: [0, -1.2] },
      { id: 'H3', element: 'H', at: [1.1, -0.85] },
    ],
    bonds: [
      { from: 'N', to: 'H1', order: 1 },
      { from: 'N', to: 'H2', order: 1 },
      { from: 'N', to: 'H3', order: 1 },
    ],
  },
  methane: {
    atoms: [
      { id: 'C', element: 'C', at: [0, 0] },
      { id: 'H1', element: 'H', at: [0, 1.25] },
      { id: 'H2', element: 'H', at: [-1.25, 0] },
      { id: 'H3', element: 'H', at: [1.25, 0] },
      { id: 'H4', element: 'H', at: [0, -1.25] },
    ],
    bonds: [
      { from: 'C', to: 'H1', order: 1 },
      { from: 'C', to: 'H2', order: 1 },
      { from: 'C', to: 'H3', order: 1 },
      { from: 'C', to: 'H4', order: 1 },
    ],
  },
  ch4: {
    atoms: [
      { id: 'C', element: 'C', at: [0, 0] },
      { id: 'H1', element: 'H', at: [0, 1.25] },
      { id: 'H2', element: 'H', at: [-1.25, 0] },
      { id: 'H3', element: 'H', at: [1.25, 0] },
      { id: 'H4', element: 'H', at: [0, -1.25] },
    ],
    bonds: [
      { from: 'C', to: 'H1', order: 1 },
      { from: 'C', to: 'H2', order: 1 },
      { from: 'C', to: 'H3', order: 1 },
      { from: 'C', to: 'H4', order: 1 },
    ],
  },
  oxygen: {
    atoms: [
      { id: 'O1', element: 'O', at: [-0.9, 0] },
      { id: 'O2', element: 'O', at: [0.9, 0] },
    ],
    bonds: [{ from: 'O1', to: 'O2', order: 2 }],
  },
  o2: {
    atoms: [
      { id: 'O1', element: 'O', at: [-0.9, 0] },
      { id: 'O2', element: 'O', at: [0.9, 0] },
    ],
    bonds: [{ from: 'O1', to: 'O2', order: 2 }],
  },
  nitrogen: {
    atoms: [
      { id: 'N1', element: 'N', at: [-0.9, 0] },
      { id: 'N2', element: 'N', at: [0.9, 0] },
    ],
    bonds: [{ from: 'N1', to: 'N2', order: 3 }],
  },
  n2: {
    atoms: [
      { id: 'N1', element: 'N', at: [-0.9, 0] },
      { id: 'N2', element: 'N', at: [0.9, 0] },
    ],
    bonds: [{ from: 'N1', to: 'N2', order: 3 }],
  },
  'carbon dioxide': {
    atoms: [
      { id: 'O1', element: 'O', at: [-1.5, 0] },
      { id: 'C', element: 'C', at: [0, 0] },
      { id: 'O2', element: 'O', at: [1.5, 0] },
    ],
    bonds: [{ from: 'O1', to: 'C', order: 2 }, { from: 'C', to: 'O2', order: 2 }],
  },
  co2: {
    atoms: [
      { id: 'O1', element: 'O', at: [-1.5, 0] },
      { id: 'C', element: 'C', at: [0, 0] },
      { id: 'O2', element: 'O', at: [1.5, 0] },
    ],
    bonds: [{ from: 'O1', to: 'C', order: 2 }, { from: 'C', to: 'O2', order: 2 }],
  },
};

const CHEMISTRY_PRESET_SIGNATURES: Record<string, keyof typeof CHEMISTRY_STRUCTURE_PRESETS> = {
  'H:2|O:1': 'water',
  'H:3|N:1': 'ammonia',
  'C:1|H:4': 'methane',
  'O:2': 'oxygen',
  'N:2': 'nitrogen',
  'C:1|O:2': 'carbon dioxide',
};

/**
 * Geometry diagrams are graphless by default; function plots are graphed by
 * default. Callers may override either with `displayMode`.
 *
 * Exported for unit testing of the mode-selection policy.
 */
export function resolveDisplayMode(intent: VisualizationIntent): VisualizationDisplayMode {
  if (intent.type === "geometry") return intent.displayMode ?? "graphless";
  if (intent.type === "function") return intent.displayMode ?? "graph";
  return "graphless";
}

export function VisualizationSurface({
  intent,
  state,
  chalk,
  accent,
  scale = 1,
  readOnly = false,
  onState,
}: VisualizationSurfaceProps) {
  const model = useMemo(() => routeVisualization(intent), [intent]);
  const displayMode = resolveDisplayMode(intent);
  // Geometry & function intents carry "title"; equation/chart/diagram carry
  // "caption". Surface whichever exists so the figure's author-supplied label
  // always renders.
  const caption =
    ("title" in intent && intent.title) || ("caption" in intent && intent.caption) || undefined;

  if (model.unsupported) {
    return <UnsupportedCard reason={model.unsupportedReason ?? "Unsupported visualization"} chalk={chalk} accent={accent} caption={caption} />;
  }

  // Geometry in graphless mode is rendered by our own SVG adapter rather than
  // JSXGraph. That gives us exact control over the fitted bounds and avoids the
  // board-clipping behavior that kept producing half-shown circles/triangles.
  if (intent.type === "geometry" && displayMode === "graphless") {
    return <SvgGeometrySurface intent={intent} state={state} chalk={chalk} accent={accent} scale={scale} caption={caption} />;
  }

  switch (model.adapterId) {
    case "jsxgraph":
      return <JsxGraphSurface intent={intent} state={state} chalk={chalk} accent={accent} scale={scale} readOnly={readOnly} onState={onState} />;
    case "graph3d-r3f":
      return <Graph3DSurface intent={intent as Graph3DIntent} state={state} chalk={chalk} accent={accent} scale={scale} caption={caption} onState={onState} />;
    case "chart-echarts":
      return <ChartSurface intent={intent as ChartIntent} state={state} chalk={chalk} accent={accent} scale={scale} caption={caption} onState={onState} />;
    case "graph-theory-cytoscape":
      return <GraphTheorySurface intent={intent as GraphTheoryIntent} state={state} chalk={chalk} accent={accent} scale={scale} caption={caption} readOnly={readOnly} onState={onState} />;
    case "physics-svg":
      return <PhysicsSurface intent={intent as PhysicsIntent | CircuitIntent} state={state} chalk={chalk} accent={accent} scale={scale} caption={caption} onState={onState} />;
    case "biology-svg":
      return <BiologySurface intent={intent as BiologyIntent} state={state} chalk={chalk} accent={accent} scale={scale} caption={caption} readOnly={readOnly} onState={onState} />;
    case "chemistry-rdkit":
      return <ChemistrySurface intent={intent as ChemistryIntent} state={state} chalk={chalk} accent={accent} scale={scale} caption={caption} onState={onState} />;
    case "katex":
      return <EquationSurface intent={intent as Extract<VisualizationIntent, { type: "equation" }>} chalk={chalk} accent={accent} scale={scale} caption={caption} />;
    default:
      return <UnsupportedCard reason="No renderer for this intent" chalk={chalk} accent={accent} caption={caption} />;
  }
}

/* ───────────────────────── Graphless SVG geometry ───────────────────────── */

function SvgGeometrySurface({
  intent,
  state,
  chalk,
  accent,
  scale,
  caption,
}: {
  intent: GeometryIntent;
  state?: VisualizationState;
  chalk: string;
  accent: string;
  scale: number;
  caption?: string;
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [widthPx, setWidthPx] = useState(0);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const ro = new ResizeObserver(() => setWidthPx(wrap.clientWidth));
    ro.observe(wrap);
    setWidthPx(wrap.clientWidth);
    return () => ro.disconnect();
  }, []);

  const points = useMemo(() => geometryPointMap(intent, state), [intent, state]);
  const bbox = useMemo(() => computeBoundingBox(intent, state), [intent, state]);
  const [xMin, yMax, xMax, yMin] = bbox;
  const boxW = Math.max(1e-6, xMax - xMin);
  const boxH = Math.max(1e-6, yMax - yMin);
  const aspect = boxH / boxW;
  const rawHeight = widthPx > 0 ? Math.round(widthPx * aspect) : Math.round(230 * Math.max(0.55, Math.min(scale, 1.4)));
  const hostHeight = Math.max(150, Math.min(420, rawHeight));
  const span = Math.max(boxW, boxH);
  const markerR = Math.max(0.08, span * 0.012);
  const labelDx = Math.max(0.12, span * 0.012);
  const labelDy = Math.max(0.16, span * 0.018);
  const fontSize = Math.max(0.18, span * 0.04);
  const textSize = Math.max(0.16, span * 0.035);
  const toSvg = ([x, y]: [number, number]): [number, number] => [x - xMin, yMax - y];
  const refPoint = (id: string): [number, number] | null => points[id] ?? null;
  const lineStroke = (o?: { style?: { color?: string; strokeWidth?: number; dash?: boolean } }) => ({
    stroke: o?.style?.color ?? chalk,
    strokeWidth: o?.style?.strokeWidth ?? 2.2,
    strokeDasharray: o?.style?.dash ? "7 6" : undefined,
  });
  const latexOverlays = useMemo(() => {
    const overlays: { id: string; at: [number, number]; html: string }[] = [];
    for (const obj of intent.objects) {
      if (obj.kind === "segment") {
        const a = refPoint(obj.from);
        const b = refPoint(obj.to);
        if (a && b && obj.labelLatex) {
          overlays.push({
            id: `${obj.id}-latex`,
            at: segmentLabelPosition(a, b, span * 0.08),
            html: renderMath(obj.labelLatex, false, {}).html,
          });
        }
      } else if (obj.kind === "angle") {
        const from = refPoint(obj.from);
        const at = refPoint(obj.at);
        const to = refPoint(obj.to);
        if (from && at && to && obj.labelLatex) {
          const radius = obj.radius ?? ANGLE_ARC_RADIUS;
          overlays.push({
            id: `${obj.id}-latex`,
            at: angleLabelPosition(from, at, to, radius * ((obj.marker ?? "arc") === "right_angle" ? 1.8 : 1.45)),
            html: renderMath(obj.labelLatex, false, {}).html,
          });
        }
      } else if (obj.kind === "notation") {
        switch (obj.variant) {
          case "segment":
          case "midpoint":
            if (obj.labelLatex) {
              const a = refPoint(obj.from);
              const b = refPoint(obj.to);
              if (a && b) {
                overlays.push({
                  id: `${obj.id}-latex`,
                  at: segmentLabelPosition(a, b, span * (obj.variant === "midpoint" ? 0.12 : 0.08)),
                  html: renderMath(obj.labelLatex, false, {}).html,
                });
              }
            }
            break;
          case "angle":
            if (obj.labelLatex) {
              const from = refPoint(obj.from);
              const at = refPoint(obj.at);
              const to = refPoint(obj.to);
              if (from && at && to) {
                const radius = obj.radius ?? ANGLE_ARC_RADIUS;
                overlays.push({
                  id: `${obj.id}-latex`,
                  at: angleLabelPosition(from, at, to, radius * ((obj.marker ?? "arc") === "right_angle" ? 1.8 : 1.45)),
                  html: renderMath(obj.labelLatex, false, {}).html,
                });
              }
            }
            break;
          case "perpendicular":
            if (obj.labelLatex) {
              const at = refPoint(obj.at);
              const arm1 = refPoint(obj.arm1);
              const arm2 = refPoint(obj.arm2);
              if (at && arm1 && arm2) {
                const size = obj.size ?? ANGLE_ARC_RADIUS;
                overlays.push({
                  id: `${obj.id}-latex`,
                  at: angleLabelPosition(arm1, at, arm2, size * 1.9),
                  html: renderMath(obj.labelLatex, false, {}).html,
                });
              }
            }
            break;
          case "bisector":
            if (obj.labelLatex) {
              const from = refPoint(obj.from);
              const at = refPoint(obj.at);
              const to = refPoint(obj.to);
              if (from && at && to) {
                const radius = obj.radius ?? ANGLE_ARC_RADIUS * 0.82;
                overlays.push({
                  id: `${obj.id}-latex`,
                  at: angleLabelPosition(from, at, to, radius * 1.8),
                  html: renderMath(obj.labelLatex, false, {}).html,
                });
              }
            }
            break;
          default:
            break;
        }
      }
    }
    return overlays;
  }, [intent.objects, points, span]);

  return (
    <figure className="m-0 w-full" style={{ width: "100%", maxWidth: "100%" }}>
      <div ref={wrapRef} className="relative w-full">
        <svg
          className="block w-full"
          style={{ height: hostHeight, overflow: "visible" }}
          viewBox={`0 0 ${boxW} ${boxH}`}
          preserveAspectRatio="xMidYMid meet"
          aria-label={caption ?? "geometry diagram"}
        >
          {intent.objects.map((obj) => {
            switch (obj.kind) {
              case "line": {
                const a = refPoint(obj.through[0]);
                const b = refPoint(obj.through[1]);
                const clipped = a && b ? clipInfiniteLineToBox(a, b, { xMin, xMax, yMin, yMax }) : null;
                if (!clipped) return null;
                const [p1, p2] = clipped.map(toSvg);
                const parallels = obj.parallelMarkCount
                  ? buildParallelMarks(clipped[0], clipped[1], obj.parallelMarkCount, span * 0.07, span * 0.06).map((pts) => pts.map(toSvg))
                  : [];
                return (
                  <g key={obj.id}>
                    <line x1={p1[0]} y1={p1[1]} x2={p2[0]} y2={p2[1]} fill="none" opacity={0.95} vectorEffect="non-scaling-stroke" strokeLinecap="round" {...lineStroke(obj)} />
                    {parallels.map((pts, i) => (
                      <polyline key={`${obj.id}-parallel-${i}`} points={pts.map((p) => p.join(",")).join(" ")} fill="none" stroke={obj.style?.color ?? chalk} strokeWidth={1.8} opacity={0.95} vectorEffect="non-scaling-stroke" strokeLinecap="round" />
                    ))}
                  </g>
                );
              }
              case "segment": {
                const a = refPoint(obj.from);
                const b = refPoint(obj.to);
                if (!a || !b) return null;
                const p1 = toSvg(a);
                const p2 = toSvg(b);
                const ticks = obj.tickCount ? buildSegmentTickMarks(a, b, obj.tickCount, span * 0.06, span * 0.05).map(([m1, m2]) => [toSvg(m1), toSvg(m2)] as const) : [];
                const parallels = obj.parallelMarkCount ? buildParallelMarks(a, b, obj.parallelMarkCount, span * 0.07, span * 0.06).map((pts) => pts.map(toSvg)) : [];
                const midpoint = obj.midpointMarker ? toSvg(segmentMidpoint(a, b)) : null;
                const labelPos = (obj.label || obj.labelLatex) ? toSvg(segmentLabelPosition(a, b, span * 0.08)) : null;
                return (
                  <g key={obj.id}>
                    <line x1={p1[0]} y1={p1[1]} x2={p2[0]} y2={p2[1]} fill="none" opacity={0.95} vectorEffect="non-scaling-stroke" strokeLinecap="round" {...lineStroke(obj)} />
                    {ticks.map(([m1, m2], i) => (
                      <line key={`${obj.id}-tick-${i}`} x1={m1[0]} y1={m1[1]} x2={m2[0]} y2={m2[1]} stroke={obj.style?.color ?? chalk} strokeWidth={1.8} opacity={0.95} vectorEffect="non-scaling-stroke" strokeLinecap="round" />
                    ))}
                    {parallels.map((pts, i) => (
                      <polyline key={`${obj.id}-parallel-${i}`} points={pts.map((p) => p.join(",")).join(" ")} fill="none" stroke={obj.style?.color ?? chalk} strokeWidth={1.8} opacity={0.95} vectorEffect="non-scaling-stroke" strokeLinecap="round" />
                    ))}
                    {midpoint ? (
                      <circle cx={midpoint[0]} cy={midpoint[1]} r={markerR * 0.72} fill={accent} stroke={chalk} strokeWidth={1.2} opacity={0.95} vectorEffect="non-scaling-stroke" />
                    ) : null}
                    {obj.label && !obj.labelLatex && labelPos ? (
                      <text x={labelPos[0]} y={labelPos[1]} fill={chalk} opacity={0.85} fontFamily="monospace" fontSize={textSize}>{obj.label}</text>
                    ) : null}
                  </g>
                );
              }
              case "circle": {
                const center = refPoint(obj.center);
                const radius = center ? circleRadiusFromIntent(obj, points) : null;
                if (!center || radius == null) return null;
                const [cx, cy] = toSvg(center);
                return <circle key={obj.id} cx={cx} cy={cy} r={radius} fill="none" opacity={0.95} vectorEffect="non-scaling-stroke" strokeLinecap="round" {...lineStroke(obj)} />;
              }
              case "polygon": {
                const verts = obj.vertices.map((id) => refPoint(id)).filter(Boolean) as [number, number][];
                if (verts.length < 3) return null;
                return (
                  <polygon
                    key={obj.id}
                    points={verts.map((p) => toSvg(p).join(",")).join(" ")}
                    fill={accent}
                    fillOpacity={0.12}
                    opacity={0.95}
                    vectorEffect="non-scaling-stroke"
                    strokeLinecap="round"
                    {...lineStroke(obj)}
                  />
                );
              }
              case "angle": {
                const from = refPoint(obj.from);
                const at = refPoint(obj.at);
                const to = refPoint(obj.to);
                if (!from || !at || !to) return null;
                const radius = obj.radius ?? ANGLE_ARC_RADIUS;
                const marker = obj.marker ?? "arc";
                const arcCount = Math.max(1, obj.arcCount ?? 1);
                const labelText = obj.label ?? (obj.showMeasure ? `${Math.round(computeAngleMeasureDeg(from, at, to))}°` : null);
                const labelPos = (labelText || obj.labelLatex) ? toSvg(angleLabelPosition(from, at, to, radius * (marker === "right_angle" ? 1.8 : 1.45))) : null;
                return (
                  <g key={obj.id}>
                    {marker === "right_angle" ? (
                      <polyline
                        points={buildRightAngleMarker(from, at, to, radius).map(toSvg).map((p) => p.join(",")).join(" ")}
                        fill="none"
                        stroke={accent}
                        strokeWidth={1.6}
                        opacity={0.95}
                        vectorEffect="non-scaling-stroke"
                        strokeLinecap="round"
                      />
                    ) : (
                      Array.from({ length: arcCount }, (_, i) => {
                        const factor = 1 + (i - (arcCount - 1) / 2) * 0.22;
                        const arc = buildAngleArcPoints(from, at, to, radius * factor).map(toSvg);
                        return arc.length < 2 ? null : (
                          <polyline key={`${obj.id}-arc-${i}`} points={arc.map((p) => p.join(",")).join(" ")} fill="none" stroke={accent} strokeWidth={1.6} opacity={0.95} vectorEffect="non-scaling-stroke" strokeLinecap="round" />
                        );
                      })
                    )}
                    {labelText && !obj.labelLatex && labelPos ? (
                      <text x={labelPos[0]} y={labelPos[1]} fill={chalk} opacity={0.85} fontFamily="monospace" fontSize={textSize}>{labelText}</text>
                    ) : null}
                  </g>
                );
              }
              case "label": {
                const anchor = refPoint(obj.anchor);
                if (!anchor) return null;
                const [x, y] = toSvg(anchor);
                const dx = obj.offset?.[0] ?? labelDx;
                const dy = obj.offset?.[1] ?? -labelDy;
                return <text key={obj.id} x={x + dx} y={y + dy} fill={chalk} opacity={0.85} fontFamily="monospace" fontSize={textSize}>{obj.text}</text>;
              }
              case "text": {
                const [x, y] = toSvg(obj.at);
                return <text key={obj.id} x={x} y={y} fill={chalk} opacity={0.7} fontFamily="monospace" fontSize={textSize}>{obj.text}</text>;
              }
              case "notation": {
                switch (obj.variant) {
                  case "segment": {
                    const a = refPoint(obj.from);
                    const b = refPoint(obj.to);
                    if (!a || !b) return null;
                    const ticks = obj.tickCount ? buildSegmentTickMarks(a, b, obj.tickCount, span * 0.06, span * 0.05).map(([m1, m2]) => [toSvg(m1), toSvg(m2)] as const) : [];
                    const parallels = obj.parallelMarkCount ? buildParallelMarks(a, b, obj.parallelMarkCount, span * 0.07, span * 0.06).map((pts) => pts.map(toSvg)) : [];
                    const midpoint = obj.midpointMarker ? toSvg(segmentMidpoint(a, b)) : null;
                    const labelPos = (obj.label || obj.labelLatex) ? toSvg(segmentLabelPosition(a, b, span * 0.08)) : null;
                    return (
                      <g key={obj.id}>
                        {ticks.map(([m1, m2], i) => (
                          <line key={`${obj.id}-tick-${i}`} x1={m1[0]} y1={m1[1]} x2={m2[0]} y2={m2[1]} stroke={chalk} strokeWidth={1.8} opacity={0.95} vectorEffect="non-scaling-stroke" strokeLinecap="round" />
                        ))}
                        {parallels.map((pts, i) => (
                          <polyline key={`${obj.id}-parallel-${i}`} points={pts.map((p) => p.join(",")).join(" ")} fill="none" stroke={chalk} strokeWidth={1.8} opacity={0.95} vectorEffect="non-scaling-stroke" strokeLinecap="round" />
                        ))}
                        {midpoint ? <circle cx={midpoint[0]} cy={midpoint[1]} r={markerR * 0.72} fill={accent} stroke={chalk} strokeWidth={1.2} opacity={0.95} vectorEffect="non-scaling-stroke" /> : null}
                        {obj.label && !obj.labelLatex && labelPos ? <text x={labelPos[0]} y={labelPos[1]} fill={chalk} opacity={0.85} fontFamily="monospace" fontSize={textSize}>{obj.label}</text> : null}
                      </g>
                    );
                  }
                  case "angle": {
                    const from = refPoint(obj.from);
                    const at = refPoint(obj.at);
                    const to = refPoint(obj.to);
                    if (!from || !at || !to) return null;
                    const radius = obj.radius ?? ANGLE_ARC_RADIUS;
                    const marker = obj.marker ?? "arc";
                    const arcCount = Math.max(1, obj.arcCount ?? 1);
                    const labelText = obj.label ?? (obj.showMeasure ? `${Math.round(computeAngleMeasureDeg(from, at, to))}°` : null);
                    const labelPos = (labelText || obj.labelLatex) ? toSvg(angleLabelPosition(from, at, to, radius * (marker === "right_angle" ? 1.8 : 1.45))) : null;
                    return (
                      <g key={obj.id}>
                        {marker === "right_angle"
                          ? <polyline points={buildRightAngleMarker(from, at, to, radius).map(toSvg).map((p) => p.join(",")).join(" ")} fill="none" stroke={accent} strokeWidth={1.6} opacity={0.95} vectorEffect="non-scaling-stroke" strokeLinecap="round" />
                          : Array.from({ length: arcCount }, (_, i) => {
                              const factor = 1 + (i - (arcCount - 1) / 2) * 0.22;
                              const arc = buildAngleArcPoints(from, at, to, radius * factor).map(toSvg);
                              return arc.length < 2 ? null : <polyline key={`${obj.id}-arc-${i}`} points={arc.map((p) => p.join(",")).join(" ")} fill="none" stroke={accent} strokeWidth={1.6} opacity={0.95} vectorEffect="non-scaling-stroke" strokeLinecap="round" />;
                            })}
                        {labelText && !obj.labelLatex && labelPos ? <text x={labelPos[0]} y={labelPos[1]} fill={chalk} opacity={0.85} fontFamily="monospace" fontSize={textSize}>{labelText}</text> : null}
                      </g>
                    );
                  }
                  case "parallel": {
                    const a = refPoint(obj.from);
                    const b = refPoint(obj.to);
                    if (!a || !b) return null;
                    const parallels = buildParallelMarks(a, b, obj.markCount ?? 1, span * 0.07, span * 0.06).map((pts) => pts.map(toSvg));
                    return <g key={obj.id}>{parallels.map((pts, i) => <polyline key={`${obj.id}-${i}`} points={pts.map((p) => p.join(",")).join(" ")} fill="none" stroke={chalk} strokeWidth={1.8} opacity={0.95} vectorEffect="non-scaling-stroke" strokeLinecap="round" />)}</g>;
                  }
                  case "midpoint": {
                    const a = refPoint(obj.from);
                    const b = refPoint(obj.to);
                    if (!a || !b) return null;
                    const midpoint = toSvg(segmentMidpoint(a, b));
                    const labelPos = (obj.label || obj.labelLatex) ? toSvg(segmentLabelPosition(a, b, span * 0.12)) : null;
                    return (
                      <g key={obj.id}>
                        <circle cx={midpoint[0]} cy={midpoint[1]} r={markerR * 0.72} fill={accent} stroke={chalk} strokeWidth={1.2} opacity={0.95} vectorEffect="non-scaling-stroke" />
                        {obj.label && !obj.labelLatex && labelPos ? <text x={labelPos[0]} y={labelPos[1]} fill={chalk} opacity={0.85} fontFamily="monospace" fontSize={textSize}>{obj.label}</text> : null}
                      </g>
                    );
                  }
                  case "perpendicular": {
                    const at = refPoint(obj.at);
                    const arm1 = refPoint(obj.arm1);
                    const arm2 = refPoint(obj.arm2);
                    if (!at || !arm1 || !arm2) return null;
                    const size = obj.size ?? ANGLE_ARC_RADIUS;
                    const square = buildRightAngleMarker(arm1, at, arm2, size).map(toSvg);
                    const labelPos = (obj.label || obj.labelLatex) ? toSvg(angleLabelPosition(arm1, at, arm2, size * 1.9)) : null;
                    return (
                      <g key={obj.id}>
                        <polyline points={square.map((p) => p.join(",")).join(" ")} fill="none" stroke={accent} strokeWidth={1.6} opacity={0.95} vectorEffect="non-scaling-stroke" strokeLinecap="round" />
                        {obj.label && !obj.labelLatex && labelPos ? <text x={labelPos[0]} y={labelPos[1]} fill={chalk} opacity={0.85} fontFamily="monospace" fontSize={textSize}>{obj.label}</text> : null}
                      </g>
                    );
                  }
                  case "bisector": {
                    const from = refPoint(obj.from);
                    const at = refPoint(obj.at);
                    const through = refPoint(obj.through);
                    const to = refPoint(obj.to);
                    if (!from || !at || !through || !to) return null;
                    const radius = obj.radius ?? ANGLE_ARC_RADIUS * 0.82;
                    const leftArc = buildAngleArcPoints(from, at, through, radius).map(toSvg);
                    const rightArc = buildAngleArcPoints(through, at, to, radius).map(toSvg);
                    const labelPos = (obj.label || obj.labelLatex) ? toSvg(angleLabelPosition(from, at, to, radius * 1.8)) : null;
                    return (
                      <g key={obj.id}>
                        {leftArc.length >= 2 ? <polyline points={leftArc.map((p) => p.join(",")).join(" ")} fill="none" stroke={accent} strokeWidth={1.6} opacity={0.95} vectorEffect="non-scaling-stroke" strokeLinecap="round" /> : null}
                        {rightArc.length >= 2 ? <polyline points={rightArc.map((p) => p.join(",")).join(" ")} fill="none" stroke={accent} strokeWidth={1.6} opacity={0.95} vectorEffect="non-scaling-stroke" strokeLinecap="round" /> : null}
                        {obj.label && !obj.labelLatex && labelPos ? <text x={labelPos[0]} y={labelPos[1]} fill={chalk} opacity={0.85} fontFamily="monospace" fontSize={textSize}>{obj.label}</text> : null}
                      </g>
                    );
                  }
                  default:
                    return null;
                }
              }
              case "point":
              default:
                return null;
            }
          })}

          {intent.actions?.includes("show_measure") || intent.actions?.includes("highlight_radius")
            ? intent.objects.map((obj) => {
                if (obj.kind !== "circle" || !obj.through) return null;
                const c = refPoint(obj.center);
                const t = refPoint(obj.through);
                if (!c || !t) return null;
                const p1 = toSvg(c);
                const p2 = toSvg(t);
                return <line key={`action-${obj.id}`} x1={p1[0]} y1={p1[1]} x2={p2[0]} y2={p2[1]} stroke={accent} strokeWidth={1.5} strokeDasharray="7 6" opacity={0.8} vectorEffect="non-scaling-stroke" strokeLinecap="round" />;
              })
            : null}

          {Object.entries(points).map(([id, point]) => {
            const obj = intent.objects.find((entry): entry is Extract<GeometryObject, { kind: "point" }> => entry.kind === "point" && entry.id === id);
            if (obj?.visible === false) return null;
            const [x, y] = toSvg(point);
            return (
              <g key={id}>
                <circle cx={x} cy={y} r={markerR} fill={accent} stroke={chalk} strokeWidth={1.2} vectorEffect="non-scaling-stroke" />
                {obj?.label ? (
                  <text x={x + labelDx} y={y - labelDy} fill={chalk} opacity={0.85} fontFamily="monospace" fontSize={fontSize}>{obj.label}</text>
                ) : null}
              </g>
            );
          })}
        </svg>
        {latexOverlays.length > 0 && (
          <div className="pointer-events-none absolute inset-0 overflow-visible">
            {latexOverlays.map((overlay) => {
              const left = ((overlay.at[0] - xMin) / boxW) * 100;
              const top = ((yMax - overlay.at[1]) / boxH) * 100;
              return (
                <div
                  key={overlay.id}
                  className="katex-chalk absolute -translate-x-1/2 -translate-y-1/2"
                  style={{ left: `${left}%`, top: `${top}%`, color: chalk, fontSize: 14 * Math.max(0.8, Math.min(scale, 1.25)) }}
                  dangerouslySetInnerHTML={{ __html: overlay.html }}
                />
              );
            })}
          </div>
        )}
      </div>
      {caption && <figcaption className="mt-1 text-[13px] opacity-70">{caption}</figcaption>}
    </figure>
  );
}

/* ───────────────────────── Generic charts (ECharts) ───────────────────────── */

function ChartSurface({
  intent,
  state,
  chalk,
  accent,
  scale,
  caption,
  onState,
}: {
  intent: ChartIntent;
  state?: VisualizationState;
  chalk: string;
  accent: string;
  scale: number;
  caption?: string;
  onState?: (next: VisualizationState) => void;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const stateRef = useRef(state);
  const onStateRef = useRef(onState);
  const [error, setError] = useState<string | null>(null);
  stateRef.current = state;
  onStateRef.current = onState;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let cancelled = false;
    let chart: any = null;
    let resizeObserver: ResizeObserver | null = null;
    setError(null);

    void loadECharts().then((echarts) => {
      if (cancelled) return;
      // Compile first so malformed options fail before ECharts allocates a
      // canvas or registers an instance against the host element.
      const option = buildChartOption(intent, stateRef.current, chalk, accent);
      chart = echarts.init(host, undefined, { renderer: 'canvas' });
      chart.setOption(option, true);
      const emitState = () => {
        const emit = onStateRef.current;
        if (!emit || !chart) return;
        const currentOption = chart.getOption();
        const next: VisualizationState = { ...(stateRef.current ?? {}) };
        if (currentOption.dataZoom?.length) {
          const dzx = currentOption.dataZoom[0] ?? {};
          const dzy = currentOption.dataZoom[1] ?? {};
          next.chartViewport = {
            xStart: typeof dzx.start === 'number' ? dzx.start : undefined,
            xEnd: typeof dzx.end === 'number' ? dzx.end : undefined,
            yStart: typeof dzy.start === 'number' ? dzy.start : undefined,
            yEnd: typeof dzy.end === 'number' ? dzy.end : undefined,
          };
        }
        if (currentOption.legend?.[0]?.selected) {
          next.hiddenSeries = Object.entries(currentOption.legend[0].selected)
            .filter(([, selected]) => selected === false)
            .map(([name]) => name);
        }
        emit(next);
      };
      chart.on('datazoom', emitState);
      chart.on('legendselectchanged', emitState);
      resizeObserver = new ResizeObserver(() => chart?.resize());
      resizeObserver.observe(host);
    }).catch(() => {
      if (!cancelled) setError('Chart rendering failed to initialize.');
      chart?.dispose();
      chart = null;
    });

    return () => {
      cancelled = true;
      resizeObserver?.disconnect();
      chart?.dispose();
      chart = null;
    };
  }, [intent, chalk, accent]);

  const heightPx = Math.round(320 * Math.max(0.8, Math.min(scale, 1.2)));
  if (error) return <UnsupportedCard reason={error} chalk={chalk} accent={accent} caption={caption} />;
  return (
    <figure className="m-0 w-full" data-nopan style={{ width: '100%', maxWidth: '100%' }}>
      <div ref={hostRef} className="w-full rounded border" style={{ height: Math.max(260, Math.min(520, heightPx)), borderColor: `${accent}44`, background: intent.background ?? 'rgba(0,0,0,0.06)' }} />
      {caption && <figcaption className="mt-1 text-[13px] opacity-70">{caption}</figcaption>}
    </figure>
  );
}

function GraphTheorySurface({
  intent,
  state,
  chalk,
  accent,
  scale,
  caption,
  readOnly,
  onState,
}: {
  intent: GraphTheoryIntent;
  state?: VisualizationState;
  chalk: string;
  accent: string;
  scale: number;
  caption?: string;
  readOnly: boolean;
  onState?: (next: VisualizationState) => void;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const stateRef = useRef(state);
  const onStateRef = useRef(onState);
  const [error, setError] = useState<string | null>(null);
  stateRef.current = state;
  onStateRef.current = onState;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let cancelled = false;
    let cy: CytoscapeCore | null = null;
    setError(null);

    void loadCytoscape().then((cytoscapeFactory) => {
      if (cancelled) return;
      const initialState = stateRef.current;
      const nodePositions = initialState?.nodePositions ?? {};
      const instance = cytoscapeFactory({
        container: host,
        elements: [
          ...intent.nodes.map((n) => ({
            data: { id: n.id, label: n.label ?? n.id },
            position: nodePositions[n.id]
              ? { x: nodePositions[n.id][0], y: nodePositions[n.id][1] }
              : n.at ? { x: n.at[0] * 80, y: -n.at[1] * 80 } : undefined,
            locked: n.locked === true,
          })),
          ...intent.edges.map((e, i) => ({ data: { id: `e-${i}`, source: e.from, target: e.to, label: e.label ?? '', directed: e.directed ?? intent.directed ?? true, color: e.color, width: e.width, style: e.style } })),
        ],
        layout: { name: initialState?.scienceLayout || intent.layout || (intent.nodes.every((n) => n.at) ? 'preset' : 'cose'), fit: true, padding: intent.style?.compact ? 12 : 28 } as any,
        wheelSensitivity: 0.2,
        style: [
          {
            selector: 'node',
            style: {
              'background-color': (ele: any) => intent.nodes.find((n) => n.id === ele.id())?.color ?? accent,
              'shape': (ele: any) => intent.nodes.find((n) => n.id === ele.id())?.shape ?? 'ellipse',
              'width': (ele: any) => intent.nodes.find((n) => n.id === ele.id())?.size ?? (intent.style?.compact ? 26 : 32),
              'height': (ele: any) => intent.nodes.find((n) => n.id === ele.id())?.size ?? (intent.style?.compact ? 26 : 32),
              'label': intent.style?.showLabels === false ? '' : 'data(label)',
              'color': chalk,
              'font-size': intent.style?.compact ? 10 : 11,
              'text-valign': 'center',
              'text-halign': 'center',
              'border-width': 1,
              'border-color': chalk,
            },
          },
          {
            selector: 'edge',
            style: {
              'curve-style': 'bezier',
              'target-arrow-shape': (ele: any) => ele.data('directed') ? 'triangle' : 'none',
              'line-color': (ele: any) => ele.data('color') ?? accent,
              'target-arrow-color': (ele: any) => ele.data('color') ?? accent,
              'width': (ele: any) => ele.data('width') ?? 2,
              'line-style': (ele: any) => ele.data('style') ?? 'solid',
              'label': intent.style?.showLabels === false ? '' : 'data(label)',
              'font-size': 10,
              'color': chalk,
              'text-background-opacity': 0,
            },
          },
        ],
        userZoomingEnabled: true,
        userPanningEnabled: true,
        autoungrabify: readOnly,
        boxSelectionEnabled: false,
      });
      cy = instance;
      const emit = () => {
        const onChange = onStateRef.current;
        if (!onChange) return;
        const next: Record<string, [number, number]> = {};
        instance.nodes().forEach((node) => {
          const pos = node.position();
          next[String(node.id())] = [pos.x, pos.y];
        });
        const latestState = stateRef.current;
        onChange({ ...(latestState ?? {}), nodePositions: next, scienceLayout: latestState?.scienceLayout || intent.layout || 'preset' });
      };
      instance.on('dragfree', 'node', emit);
      instance.on('layoutstop', emit);
      instance.fit(undefined, intent.style?.compact ? 12 : 28);
    }).catch(() => {
      if (!cancelled) setError('Graph theory rendering failed to initialize.');
      cy?.destroy();
      cy = null;
    });

    return () => {
      cancelled = true;
      cy?.destroy();
      cy = null;
    };
  }, [intent, accent, chalk, readOnly]);

  const heightPx = Math.round(280 * Math.max(0.8, Math.min(scale, 1.2)));
  if (error) return <UnsupportedCard reason={error} chalk={chalk} accent={accent} caption={caption} />;
  return (
    <figure className="m-0 w-full" data-nopan style={{ width: '100%', maxWidth: '100%' }}>
      <div ref={hostRef} className="w-full rounded border" style={{ height: Math.max(240, Math.min(460, heightPx)), borderColor: `${accent}44`, background: 'rgba(0,0,0,0.06)' }} />
      {caption && <figcaption className="mt-1 text-[13px] opacity-70">{caption}</figcaption>}
    </figure>
  );
}

export function buildChartOption(intent: ChartIntent, state: VisualizationState | undefined, chalk: string, accent: string) {
  const series = normalizeChartSeries(intent);
  if (series.length === 0 || series.some((item) => item.kind !== intent.chartType)) {
    throw new Error(`Chart ${intent.chartType} received incompatible series data`);
  }
  const palette = intent.palette && intent.palette.length > 0 ? intent.palette : [accent, ...SERIES_PALETTE];
  const legendNames = series.map((s: any) => s.name).filter(Boolean);
  const selected = Object.fromEntries(legendNames.map((name: string) => [name, !(state?.hiddenSeries ?? []).includes(name)]));
  const baseTextStyle = { color: chalk, fontFamily: 'monospace' };
  const xAxis = buildEChartAxis(intent.xAxis, intent.xLabel);
  const yAxis = buildEChartAxis(intent.yAxis, intent.yLabel);
  const dataZoom = needsCartesian(intent.chartType) && intent.showZoom !== false
    ? [
        { type: 'inside', xAxisIndex: 0, start: state?.chartViewport?.xStart ?? intent.viewport?.xStart ?? 0, end: state?.chartViewport?.xEnd ?? intent.viewport?.xEnd ?? 100 },
        { type: 'inside', yAxisIndex: 0, start: state?.chartViewport?.yStart ?? intent.viewport?.yStart ?? 0, end: state?.chartViewport?.yEnd ?? intent.viewport?.yEnd ?? 100 },
      ]
    : undefined;

  const option: any = {
    backgroundColor: 'transparent',
    color: palette,
    textStyle: baseTextStyle,
    title: {
      text: intent.title,
      subtext: intent.subtitle,
      left: 12,
      top: 8,
      textStyle: { color: chalk, fontSize: 16, fontFamily: 'monospace' },
      subtextStyle: { color: chalk, opacity: 0.7, fontFamily: 'monospace' },
    },
    tooltip: { show: intent.tooltip !== false, trigger: needsCartesian(intent.chartType) ? 'axis' : 'item' },
    legend: legendNames.length > 0 && intent.legend !== false ? { top: 10, right: 12, textStyle: { color: chalk }, selected } : undefined,
    animation: false,
  };

  switch (intent.chartType) {
    case 'bar':
    case 'line':
    case 'scatter': {
      option.grid = { left: 48, right: 20, top: 48, bottom: 42, containLabel: true };
      option.xAxis = xAxis;
      option.yAxis = yAxis;
      option.dataZoom = dataZoom;
      const chartType = intent.chartType as 'bar' | 'line' | 'scatter';
      option.series = series.map((s: any, i: number) => buildCartesianSeries(chartType, s, i, palette, state));
      break;
    }
    case 'histogram': {
      option.grid = { left: 48, right: 20, top: 48, bottom: 42, containLabel: true };
      option.xAxis = buildEChartAxis({ ...(intent.xAxis ?? {}), scaleType: 'linear' }, intent.xLabel);
      option.yAxis = buildEChartAxis({ ...(intent.yAxis ?? {}), scaleType: 'linear' }, intent.yLabel);
      option.dataZoom = dataZoom;
      option.series = buildHistogramSeries(series as any[], palette, state);
      break;
    }
    case 'box': {
      option.grid = { left: 48, right: 20, top: 48, bottom: 42, containLabel: true };
      option.xAxis = { type: 'category', data: series.map((s: any) => s.name), axisLabel: { color: chalk } };
      option.yAxis = buildEChartAxis({ ...(intent.yAxis ?? {}), scaleType: 'linear' }, intent.yLabel);
      option.dataZoom = dataZoom;
      option.series = [{ type: 'boxplot', data: series.map((s: any) => summarizeBoxValues(s.values)), itemStyle: { color: 'transparent', borderColor: accent }, emphasis: { disabled: true } }];
      break;
    }
    case 'heatmap':
    case 'contour': {
      option.grid = { left: 52, right: 22, top: 48, bottom: 46, containLabel: true };
      const field = normalizeHeatmapField(series[0]);
      const axisStyle = { color: chalk };
      const splitLine = { show: intent.xAxis?.showGrid === true, lineStyle: { color: 'rgba(255,255,255,0.08)' } };
      if (intent.chartType === 'heatmap') {
        // ECharts 6 requires two category axes for a Cartesian heatmap. Convert
        // schema coordinates to stable category indexes while preserving their
        // numeric values as the visible axis labels.
        const xIndexes = new Map(field.xs.map((value: number, index: number) => [value, index]));
        const yIndexes = new Map(field.ys.map((value: number, index: number) => [value, index]));
        const indexedCells = field.cells.map(([x, y, value]) => [xIndexes.get(x), yIndexes.get(y), value]);
        option.xAxis = { type: 'category', data: field.xs, name: intent.xAxis?.label ?? intent.xLabel, nameTextStyle: axisStyle, axisLabel: axisStyle, splitLine };
        option.yAxis = { type: 'category', data: field.ys, name: intent.yAxis?.label ?? intent.yLabel, nameTextStyle: axisStyle, axisLabel: axisStyle, splitLine: { ...splitLine, show: intent.yAxis?.showGrid === true } };
        option.series = [{ type: 'heatmap', data: indexedCells, progressive: 0 }];
      } else {
        option.xAxis = { type: 'value', min: field.xs[0], max: field.xs[field.xs.length - 1], name: intent.xAxis?.label ?? intent.xLabel, nameTextStyle: axisStyle, axisLabel: axisStyle, splitLine };
        option.yAxis = { type: 'value', min: field.ys[0], max: field.ys[field.ys.length - 1], name: intent.yAxis?.label ?? intent.yLabel, nameTextStyle: axisStyle, axisLabel: axisStyle, splitLine: { ...splitLine, show: intent.yAxis?.showGrid === true } };
        option.series = buildContourSeries(field, accent);
      }
      option.visualMap = { min: field.min, max: field.max, calculable: false, orient: 'horizontal', left: 'center', bottom: 6, textStyle: { color: chalk } };
      option.dataZoom = dataZoom;
      break;
    }
    case 'pie':
    case 'donut': {
      option.series = series.map((s: any) => ({ type: 'pie', name: s.name, radius: intent.chartType === 'donut' ? ['45%', '68%'] : '68%', data: s.slices.map((slice: any) => ({ name: slice.name, value: slice.value, itemStyle: slice.color ? { color: slice.color } : undefined })) }));
      break;
    }
    case 'radar': {
      option.radar = { indicator: (intent.indicators ?? []).map((i) => ({ name: i.name, max: i.max ?? 100, min: i.min ?? 0 })), axisName: { color: chalk } };
      option.series = [{ type: 'radar', data: series.map((s: any, i: number) => ({ name: s.name, value: s.values, lineStyle: { color: resolveSeriesColor(s, i, palette, state) }, areaStyle: { opacity: 0.1 }, itemStyle: { color: resolveSeriesColor(s, i, palette, state) } })) }];
      break;
    }
    case 'polar_line':
    case 'polar_scatter': {
      option.angleAxis = buildPolarAxis(intent.angleAxis, chalk, 'Angle');
      option.radiusAxis = buildPolarAxis(intent.radiusAxis, chalk, 'Radius');
      option.polar = {};
      option.series = series.map((s: any, i: number) => ({ type: intent.chartType === 'polar_line' ? 'line' : 'scatter', coordinateSystem: 'polar', name: s.name, data: s.points, showSymbol: true, symbol: s.symbol ?? 'circle', symbolSize: s.symbolSize ?? 8, lineStyle: { color: resolveSeriesColor(s, i, palette, state) }, itemStyle: { color: resolveSeriesColor(s, i, palette, state) } }));
      break;
    }
    case 'sankey': {
      const s = series[0] as any;
      // ECharts uses node `name` as the link identity. Keep the schema's unique
      // id there and render the optional friendly name through the node label.
      option.series = [{
        type: 'sankey',
        data: s.nodes.map((n: any) => ({
          name: n.id,
          label: n.name ? { formatter: n.name } : undefined,
          itemStyle: n.color ? { color: n.color } : undefined,
        })),
        links: s.links.map((l: any) => ({ source: l.source, target: l.target, value: l.value, lineStyle: l.color ? { color: l.color } : undefined })),
      }];
      break;
    }
    case 'treemap': {
      option.series = [{ type: 'treemap', data: (series[0] as any).nodes }];
      break;
    }
    case 'sunburst': {
      option.series = [{ type: 'sunburst', data: (series[0] as any).nodes, radius: ['15%', '85%'] }];
      break;
    }
    case 'candlestick':
    case 'ohlc': {
      option.grid = { left: 48, right: 20, top: 48, bottom: 42, containLabel: true };
      option.xAxis = { type: 'category', data: intent.xAxis?.categories ?? (series[0] as any).candles.map((_: any, i: number) => String(i + 1)), axisLabel: { color: chalk } };
      option.yAxis = buildEChartAxis({ ...(intent.yAxis ?? {}), scaleType: 'linear' }, intent.yLabel);
      option.dataZoom = dataZoom;
      option.series = [{ type: 'candlestick', data: (series[0] as any).candles, itemStyle: { color: (series[0] as any).upColor ?? accent, color0: (series[0] as any).downColor ?? '#f87171', borderColor: (series[0] as any).upColor ?? accent, borderColor0: (series[0] as any).downColor ?? '#f87171' } }];
      break;
    }
  }

  attachChartAnnotations(option, intent.annotations, chalk, accent, intent.chartType);
  return option;
}

function needsCartesian(chartType: ChartIntent['chartType']) {
  return ['bar', 'line', 'scatter', 'histogram', 'box', 'heatmap', 'contour', 'candlestick', 'ohlc'].includes(chartType);
}

function normalizeChartSeries(intent: ChartIntent): any[] {
  if (intent.series && intent.series.length > 0) return intent.series as any[];
  const kind = intent.chartType === 'scatter' ? 'scatter' : intent.chartType === 'line' ? 'line' : 'bar';
  return (intent.data ?? []).map((s) => kind === 'scatter'
    ? { kind, id: s.id, name: s.label, points: s.values.map((v, i) => [i, v]), color: s.color }
    : { kind, id: s.id, name: s.label, values: s.values, color: s.color });
}

function resolveSeriesColor(series: any, index: number, palette: string[], state?: VisualizationState) {
  return state?.seriesStyleOverrides?.[series.id]?.color ?? series.color ?? palette[index % palette.length];
}

function buildEChartAxis(axis: ChartIntent['xAxis'], fallbackLabel?: string) {
  const scaleType = axis?.scaleType === 'category' || axis?.categories ? 'category' : axis?.scaleType === 'time' ? 'time' : axis?.scaleType === 'log' ? 'log' : 'value';
  return {
    type: scaleType,
    name: axis?.label ?? fallbackLabel,
    nameTextStyle: { color: '#e7e7e5', fontFamily: 'monospace' },
    axisLabel: { color: '#e7e7e5' },
    axisLine: { show: axis?.showAxisLine !== false, lineStyle: { color: '#e7e7e5', opacity: 0.75 } },
    splitLine: { show: axis?.showGrid === true, lineStyle: { color: 'rgba(255,255,255,0.08)' } },
    min: axis?.min,
    max: axis?.max,
    data: axis?.categories,
    inverse: axis?.invert === true,
  };
}

function buildPolarAxis(axis: ChartIntent['angleAxis'], chalk: string, fallbackLabel: string) {
  return {
    type: axis?.scaleType === 'category' || axis?.categories ? 'category' : 'value',
    data: axis?.categories,
    min: axis?.min,
    max: axis?.max,
    name: axis?.label ?? fallbackLabel,
    axisLabel: { color: chalk },
    axisLine: { lineStyle: { color: chalk } },
  };
}

function buildCartesianSeries(chartType: 'bar' | 'line' | 'scatter', s: any, index: number, palette: string[], state?: VisualizationState) {
  const color = resolveSeriesColor(s, index, palette, state);
  if (chartType === 'scatter') {
    return {
      type: 'scatter',
      name: s.name,
      data: s.points,
      symbol: s.symbol ?? 'circle',
      symbolSize: s.symbolSize ?? 8,
      itemStyle: { color, opacity: state?.seriesStyleOverrides?.[s.id]?.opacity ?? s.opacity ?? 0.9 },
    };
  }
  return {
    type: chartType,
    name: s.name,
    data: s.values,
    smooth: chartType === 'line' ? s.smooth === true : undefined,
    stack: s.stack,
    areaStyle: chartType === 'line' && s.fill ? { opacity: s.fillOpacity ?? 0.12 } : undefined,
    lineStyle: chartType === 'line' ? { color, width: s.lineWidth ?? 2.2, type: s.dashStyle === 'dashed' ? 'dashed' : s.dashStyle === 'dotted' ? 'dotted' : 'solid', opacity: state?.seriesStyleOverrides?.[s.id]?.opacity ?? s.opacity ?? 0.95 } : undefined,
    itemStyle: chartType === 'bar' ? { color, opacity: state?.seriesStyleOverrides?.[s.id]?.opacity ?? s.opacity ?? 0.9 } : undefined,
    showSymbol: chartType === 'line',
    symbolSize: 6,
  };
}

function buildHistogramSeries(series: any[], palette: string[], state?: VisualizationState) {
  return series.map((s: any, index: number) => {
    const values = [...s.values].sort((a: number, b: number) => a - b);
    const bins = Math.max(3, Math.min(40, Math.round(s.bins ?? Math.sqrt(values.length))));
    const min = values[0], max = values[values.length - 1];
    const width = max === min ? 1 : (max - min) / bins;
    const counts = Array.from({ length: bins }, (_, i) => ({ x0: min + i * width, x1: min + (i + 1) * width, count: 0 }));
    for (const v of values) {
      const idx = Math.min(bins - 1, Math.max(0, Math.floor((v - min) / width)));
      counts[idx].count += 1;
    }
    return {
      type: 'bar',
      name: s.name,
      data: counts.map((c) => [Number(((c.x0 + c.x1) / 2).toFixed(4)), c.count, c.x0, c.x1]),
      encode: { x: 0, y: 1 },
      barWidth: '95%',
      itemStyle: { color: resolveSeriesColor(s, index, palette, state), opacity: state?.seriesStyleOverrides?.[s.id]?.opacity ?? s.opacity ?? 0.85 },
    };
  });
}

function summarizeBoxValues(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const q = (p: number) => {
    const idx = (sorted.length - 1) * p;
    const lo = Math.floor(idx), hi = Math.ceil(idx);
    return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
  };
  return [sorted[0], q(0.25), q(0.5), q(0.75), sorted[sorted.length - 1]];
}

function normalizeHeatmapField(series: any) {
  if (series.grid) {
    const xs = series.grid.x;
    const ys = series.grid.y;
    const values = series.grid.values;
    const cells: [number, number, number][] = [];
    const flat: number[] = [];
    for (let yi = 0; yi < ys.length; yi++) {
      for (let xi = 0; xi < xs.length; xi++) {
        const v = values[yi]?.[xi] ?? NaN;
        if (isFinite(v)) {
          cells.push([xs[xi], ys[yi], v]);
          flat.push(v);
        }
      }
    }
    return { xs, ys, cells, matrix: values, min: Math.min(...flat), max: Math.max(...flat) };
  }
  const pts = series.points as [number, number, number][];
  const xs = [...new Set(pts.map((p) => p[0]))].sort((a, b) => a - b);
  const ys = [...new Set(pts.map((p) => p[1]))].sort((a, b) => a - b);
  const matrix = Array.from({ length: ys.length }, () => Array(xs.length).fill(NaN));
  for (const [x, y, v] of pts) matrix[ys.indexOf(y)][xs.indexOf(x)] = v;
  return { xs, ys, cells: pts, matrix, min: Math.min(...pts.map((p) => p[2])), max: Math.max(...pts.map((p) => p[2])) };
}

function buildContourSeries(field: ReturnType<typeof normalizeHeatmapField>, accent: string) {
  const flat = field.matrix.flat().map((v: number) => Number.isFinite(v) ? v : field.min);
  const contourGen = d3Contours().size([field.xs.length, field.ys.length]).thresholds(8);
  const lines: any[] = [];
  for (const feature of contourGen(flat)) {
    for (const polygon of feature.coordinates) {
      for (const ring of polygon) {
        const points = ring.map(([ix, iy]) => {
          const x = interpolateGridValue(field.xs, ix);
          const y = interpolateGridValue(field.ys, iy);
          return [x, y];
        });
        lines.push({ type: 'line', name: `level ${Number(feature.value).toFixed(2)}`, data: points, showSymbol: false, lineStyle: { color: accent, width: 1.4 }, tooltip: { show: false } });
      }
    }
  }
  return lines;
}

function interpolateGridValue(values: number[], index: number) {
  const lo = Math.max(0, Math.min(values.length - 1, Math.floor(index)));
  const hi = Math.max(0, Math.min(values.length - 1, Math.ceil(index)));
  if (lo === hi) return values[lo];
  return values[lo] + (values[hi] - values[lo]) * (index - lo);
}

function attachChartAnnotations(option: any, annotations: ChartIntent['annotations'], chalk: string, accent: string, chartType: ChartIntent['chartType']) {
  if (!annotations || annotations.length === 0) return;
  const graphics: any[] = [];
  const markLineData: any[] = [];
  const markAreaData: any[] = [];
  for (const ann of annotations) {
    if (ann.kind === 'label') {
      graphics.push({ type: 'text', left: ann.x, top: ann.y, style: { text: ann.text, fill: chalk, font: '12px monospace' } });
    } else if (ann.kind === 'line') {
      if (ann.x !== undefined) markLineData.push({ xAxis: ann.x, name: ann.label, lineStyle: { color: ann.color ?? accent } });
      if (ann.y !== undefined) markLineData.push({ yAxis: ann.y, name: ann.label, lineStyle: { color: ann.color ?? accent } });
    } else if (ann.kind === 'region') {
      markAreaData.push([
        { xAxis: ann.x0, yAxis: ann.y0, itemStyle: { color: ann.color ?? `${accent}22` } },
        { xAxis: ann.x1, yAxis: ann.y1 },
      ]);
    }
  }
  if (option.series && option.series.length > 0 && ['bar','line','scatter','histogram','box','heatmap','contour','candlestick','ohlc'].includes(chartType)) {
    if (markLineData.length > 0) option.series[0].markLine = { silent: true, data: markLineData, label: { color: chalk } };
    if (markAreaData.length > 0) option.series[0].markArea = { silent: true, data: markAreaData };
  }
  if (graphics.length > 0) option.graphic = graphics;
}

/* ───────────────────────── Science SVG adapters ───────────────────────── */

function PhysicsSurface({
  intent,
  state,
  chalk,
  accent,
  scale,
  caption,
  onState,
}: {
  intent: PhysicsIntent | CircuitIntent;
  state?: VisualizationState;
  chalk: string;
  accent: string;
  scale: number;
  caption?: string;
  onState?: (next: VisualizationState) => void;
}) {
  void state;
  void onState;
  if (intent.type === "circuit") {
    return <CircuitSurface intent={intent} state={state} chalk={chalk} accent={accent} scale={scale} caption={caption} />;
  }
  const points: [number, number][] = [];
  for (const body of intent.bodies ?? []) points.push(body.at);
  for (const vector of intent.vectors ?? []) {
    if (Array.isArray(vector.from)) points.push(vector.from);
    if (vector.to) points.push(vector.to);
  }
  for (const ray of intent.rays ?? []) {
    points.push(ray.from, ray.to);
    if (ray.via) points.push(ray.via);
  }
  for (const optic of intent.optics ?? []) {
    const h = optic.height ?? 3;
    points.push([optic.atX, -h], [optic.atX, h]);
  }
  for (const decoration of intent.decorations ?? []) {
    switch (decoration.kind) {
      case "ground":
        points.push([decoration.fromX, decoration.y], [decoration.toX, decoration.y]);
        break;
      case "incline":
        points.push(decoration.base, [decoration.base[0] + decoration.dx, decoration.base[1] + decoration.dy]);
        break;
      case "spring":
        if (Array.isArray(decoration.from)) points.push(decoration.from);
        if (Array.isArray(decoration.to)) points.push(decoration.to);
        break;
      case "pivot":
        if (Array.isArray(decoration.at)) points.push(decoration.at);
        break;
      case "axis":
        points.push(decoration.from, decoration.to);
        break;
    }
  }
  const box = fitScienceBox(points);
  const { viewBox, toSvg, hostHeight } = scienceSurfaceMetrics(box, scale);

  const bodyById = new Map((intent.bodies ?? []).map((b) => [b.id, b]));
  const vectorStart = (from: string | [number, number]) =>
    Array.isArray(from) ? from : bodyById.get(from)?.at ?? [0, 0];

  return (
    <figure className="m-0 w-full" data-nopan style={{ width: "100%", maxWidth: "100%" }}>
      <svg className="block w-full rounded border" style={{ height: hostHeight, borderColor: `${accent}44`, background: "rgba(0,0,0,0.06)" }} viewBox={viewBox} preserveAspectRatio="xMidYMid meet">
        {intent.variant === "free_body" || intent.variant === "vector_scene" || intent.variant === "mechanics_scene"
          ? (intent.bodies ?? []).map((body) => {
              const [x, y] = toSvg(body.at);
              const width = body.width ?? 0.9;
              const height = body.height ?? 0.9;
              switch (body.shape) {
                case "circle":
                  return <g key={body.id}><circle cx={x} cy={y} r={0.42} fill="none" stroke={chalk} strokeWidth={0.08} /><ScienceText x={x + 0.55} y={y - 0.35} text={body.label ?? body.id} color={chalk} /></g>;
                case "plane":
                  return <g key={body.id}><line x1={x - width * 0.7} y1={y} x2={x + width * 0.7} y2={y} stroke={chalk} strokeWidth={0.08} /><ScienceText x={x + 0.55} y={y - 0.2} text={body.label ?? body.id} color={chalk} /></g>;
                case "incline":
                  return <g key={body.id}><polygon points={`${x - width / 2},${y + height / 2} ${x + width / 2},${y + height / 2} ${x + width / 2},${y - height / 2}`} fill="rgba(255,255,255,0.03)" stroke={chalk} strokeWidth={0.08} /><ScienceText x={x + 0.55} y={y - 0.35} text={body.label ?? body.id} color={chalk} /></g>;
                case "pulley":
                  return <g key={body.id}><circle cx={x} cy={y} r={0.34} fill="none" stroke={chalk} strokeWidth={0.08} /><line x1={x} y1={y - 0.34} x2={x} y2={y + 0.34} stroke={chalk} strokeWidth={0.06} /><line x1={x - 0.34} y1={y} x2={x + 0.34} y2={y} stroke={chalk} strokeWidth={0.06} /><ScienceText x={x + 0.55} y={y - 0.35} text={body.label ?? body.id} color={chalk} /></g>;
                default:
                  return <g key={body.id}><rect x={x - width / 2} y={y - height / 2} width={width} height={height} fill="none" stroke={chalk} strokeWidth={0.08} rx={0.08} /><ScienceText x={x + 0.55} y={y - 0.35} text={body.label ?? body.id} color={chalk} /></g>;
              }
            })
          : null}
        {(intent.vectors ?? []).map((vector) => {
          const start = vectorStart(vector.from);
          const end = vector.to ?? [start[0] + (vector.dx ?? 0), start[1] + (vector.dy ?? 0)];
          const [x1, y1] = toSvg(start);
          const [x2, y2] = toSvg(end);
          const color = vector.color ?? (vector.kind === 'velocity' ? '#60a5fa' : vector.kind === 'acceleration' ? '#fbbf24' : vector.kind === 'field' ? '#86efac' : accent);
          return <g key={vector.id}><Arrow x1={x1} y1={y1} x2={x2} y2={y2} color={color} width={0.08} />{vector.label ? <ScienceText x={x2 + 0.2} y={y2 - 0.2} text={vector.label} color={chalk} /> : null}</g>;
        })}
        {(intent.optics ?? []).map((optic) => {
          const h = optic.height ?? 3;
          const [x1, y1] = toSvg([optic.atX, -h]);
          const [x2, y2] = toSvg([optic.atX, h]);
          const dash = optic.kind === "mirror" || optic.kind === "screen" || optic.kind === "focal_plane" ? "0.18 0.14" : undefined;
          const stroke = optic.kind === 'screen' ? accent : chalk;
          const label = optic.kind === 'focal_plane' ? (optic.label ?? 'f') : optic.label;
          return <g key={optic.id}><line x1={x1} y1={y1} x2={x2} y2={y2} stroke={stroke} strokeWidth={0.08} strokeDasharray={dash} />{optic.kind === 'lens' ? <polyline points={`${x1-0.18},${y1+0.25} ${x1},${y1} ${x1+0.18},${y1+0.25}`} fill="none" stroke={stroke} strokeWidth={0.06} /> : null}{label ? <ScienceText x={x2 + 0.18} y={(y1 + y2) / 2} text={label} color={chalk} /> : null}</g>;
        })}
        {(intent.rays ?? []).map((ray) => {
          const pts = [ray.from, ...(ray.via ? [ray.via] : []), ray.to].map(toSvg);
          return <g key={ray.id}><polyline points={pts.map((p) => p.join(",")).join(" ")} fill="none" stroke={accent} strokeWidth={0.07} strokeDasharray={ray.dashed ? '0.14 0.12' : undefined} /><ArrowHead from={pts[pts.length - 2]} to={pts[pts.length - 1]} color={accent} />{ray.label ? <ScienceText x={pts[pts.length - 1][0] + 0.2} y={pts[pts.length - 1][1] - 0.2} text={ray.label} color={chalk} /> : null}</g>;
        })}
        {(intent.decorations ?? []).map((decoration) => renderPhysicsDecoration(decoration, bodyById, toSvg, chalk, accent))}
      </svg>
      {caption && <figcaption className="mt-1 text-[13px] opacity-70">{caption}</figcaption>}
    </figure>
  );
}

function CircuitSurface({
  intent,
  state,
  chalk,
  accent,
  scale,
  caption,
}: {
  intent: CircuitIntent;
  state?: VisualizationState;
  chalk: string;
  accent: string;
  scale: number;
  caption?: string;
}) {
  void state;
  const nodeMap = new Map(intent.nodes.map((n) => [n.id, n.at]));
  const box = fitScienceBox(intent.nodes.map((n) => n.at));
  const { viewBox, toSvg, hostHeight } = scienceSurfaceMetrics(box, scale);

  return (
    <figure className="m-0 w-full" data-nopan style={{ width: "100%", maxWidth: "100%" }}>
      <svg className="block w-full rounded border" style={{ height: hostHeight, borderColor: `${accent}44`, background: "rgba(0,0,0,0.06)" }} viewBox={viewBox} preserveAspectRatio="xMidYMid meet">
        {intent.wires.map((wire) => {
          const a = nodeMap.get(wire.from);
          const b = nodeMap.get(wire.to);
          if (!a || !b) return null;
          const [x1, y1] = toSvg(a);
          const [x2, y2] = toSvg(b);
          return <line key={wire.id} x1={x1} y1={y1} x2={x2} y2={y2} stroke={chalk} strokeWidth={0.08} />;
        })}
        {intent.components.map((component) => renderCircuitComponent(component, nodeMap, toSvg, chalk, accent))}
        {intent.nodes.map((node) => {
          const [x, y] = toSvg(node.at);
          return <circle key={node.id} cx={x} cy={y} r={0.08} fill={chalk} />;
        })}
      </svg>
      {caption && <figcaption className="mt-1 text-[13px] opacity-70">{caption}</figcaption>}
    </figure>
  );
}

function ChemistrySurface({
  intent,
  state,
  chalk,
  accent,
  scale,
  caption,
  onState,
}: {
  intent: ChemistryIntent;
  state?: VisualizationState;
  chalk: string;
  accent: string;
  scale: number;
  caption?: string;
  onState?: (next: VisualizationState) => void;
}) {
  void state;
  void onState;
  const preset = resolveChemistryPreset(intent.molecule);
  const [rdkitSvg, setRdkitSvg] = useState<string | null>(null);
  const [rdkitReaction, setRdkitReaction] = useState<Array<{ key: string; svg?: string; text?: string; role: 'reactant' | 'product' | 'agent' }> | null>(null);
  const [rdkitFailed, setRdkitFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setRdkitSvg(null);
    setRdkitReaction(null);
    setRdkitFailed(false);

    const hasReaction = intent.variant === 'reaction' && ((intent.reactants?.length ?? 0) > 0 || (intent.products?.length ?? 0) > 0);
    if (hasReaction) {
      loadRDKitModule()
        .then(async (RDKit) => {
          const renderSpecies = (species: NonNullable<ChemistryIntent['reactants']>[number], role: 'reactant' | 'product') => {
            if (species.molecule) {
              const mol = RDKit.get_mol(species.molecule);
              if (!mol) return { key: species.id, text: species.label ?? species.molecule, role };
              try {
                const svg = mol.get_svg(180, 120);
                return { key: species.id, svg: themeRDKitSvg(svg, chalk, accent), role };
              } finally {
                try { mol.delete(); } catch {}
              }
            }
            return { key: species.id, text: species.label ?? species.id, role };
          };
          const rendered = [
            ...(intent.reactants ?? []).map((s) => renderSpecies(s, 'reactant')),
            ...(intent.products ?? []).map((s) => renderSpecies(s, 'product')),
            ...(intent.agents ?? []).map((text, i) => ({ key: `agent-${i}`, text, role: 'agent' as const })),
          ];
          if (!cancelled) setRdkitReaction(rendered);
        })
        .catch(() => {
          if (!cancelled) setRdkitFailed(true);
        });
      return () => { cancelled = true; };
    }

    if (!intent.molecule) return () => { cancelled = true; };

    loadRDKitModule()
      .then((RDKit) => {
        if (cancelled) return;
        const mol = RDKit.get_mol(intent.molecule);
        if (!mol) {
          setRdkitFailed(true);
          return;
        }
        try {
          const svg = mol.get_svg(360, 220);
          if (!cancelled) setRdkitSvg(themeRDKitSvg(svg, chalk, accent));
        } catch {
          if (!cancelled) setRdkitFailed(true);
        } finally {
          try { mol.delete(); } catch {}
        }
      })
      .catch(() => {
        if (!cancelled) setRdkitFailed(true);
      });

    return () => {
      cancelled = true;
    };
  }, [intent, chalk, accent]);

  if (rdkitReaction) {
    const reactants = rdkitReaction.filter((x) => x.role === 'reactant');
    const products = rdkitReaction.filter((x) => x.role === 'product');
    const agents = rdkitReaction.filter((x) => x.role === 'agent');
    return (
      <figure className="m-0 w-full" data-nopan style={{ width: '100%', maxWidth: '100%' }}>
        <div className="rounded border bg-black/10 p-3" style={{ borderColor: `${accent}44` }}>
          <div className="flex flex-wrap items-center gap-3">
            {reactants.map((item) => <ChemistrySpeciesCard key={item.key} item={item} chalk={chalk} />).flatMap((node, i, arr) => i < arr.length - 1 ? [node, <span key={`plus-r-${i}`} className="font-mono text-lg opacity-75">+</span>] : [node])}
            <span className="font-mono text-lg opacity-75">→</span>
            {products.map((item) => <ChemistrySpeciesCard key={item.key} item={item} chalk={chalk} />).flatMap((node, i, arr) => i < arr.length - 1 ? [node, <span key={`plus-p-${i}`} className="font-mono text-lg opacity-75">+</span>] : [node])}
          </div>
          {agents.length > 0 ? <div className="mt-2 font-mono text-[12px] opacity-80">reagents/conditions: {agents.map((a) => a.text).join(', ')}</div> : null}
          {intent.reaction ? <div className="mt-2 font-mono text-[12px] opacity-80">{intent.reaction}</div> : null}
        </div>
        {caption && <figcaption className="mt-1 text-[13px] opacity-70">{caption}</figcaption>}
      </figure>
    );
  }

  if (rdkitSvg) {
    return (
      <figure className="m-0 w-full" data-nopan style={{ width: "100%", maxWidth: "100%" }}>
        <div className="rounded border bg-black/10 p-2" style={{ borderColor: `${accent}44` }}>
          <div className="katex-chalk chemistry-rdkit w-full" style={{ color: chalk }} dangerouslySetInnerHTML={{ __html: rdkitSvg }} />
          {intent.reaction ? <div className="mt-2 font-mono text-[12px] opacity-80">{intent.reaction}</div> : null}
        </div>
        {caption && <figcaption className="mt-1 text-[13px] opacity-70">{caption}</figcaption>}
      </figure>
    );
  }

  const atoms = intent.atoms ?? preset?.atoms;
  const bonds = intent.bonds ?? preset?.bonds;

  if (!atoms || atoms.length === 0) {
    const text = rdkitFailed
      ? `RDKit rendering failed for: ${intent.molecule ?? intent.reaction ?? intent.title ?? "chemistry"}`
      : intent.reaction ?? intent.molecule ?? intent.title ?? "Chemistry";
    return <UnsupportedCard reason={text} chalk={chalk} accent={accent} caption={caption} />;
  }

  const atomMap = new Map(atoms.map((a) => [a.id, a.at]));
  const box = fitScienceBox(atoms.map((a) => a.at));
  const { viewBox, toSvg, hostHeight } = scienceSurfaceMetrics(box, scale);
  return (
    <figure className="m-0 w-full" data-nopan style={{ width: "100%", maxWidth: "100%" }}>
      <svg className="block w-full rounded border" style={{ height: hostHeight, borderColor: `${accent}44`, background: "rgba(0,0,0,0.06)" }} viewBox={viewBox} preserveAspectRatio="xMidYMid meet">
        {(bonds ?? []).map((bond, i) => {
          const a = atomMap.get(bond.from);
          const b = atomMap.get(bond.to);
          if (!a || !b) return null;
          return renderBond(`bond-${i}`, a, b, bond.order ?? 1, toSvg, chalk);
        })}
        {atoms.map((atom) => {
          const [x, y] = toSvg(atom.at);
          return <g key={atom.id}><circle cx={x} cy={y} r={0.34} fill="rgba(255,255,255,0.06)" stroke={accent} strokeWidth={0.08} /><ScienceText x={x} y={y + 0.03} text={atom.label ?? atom.element} color={chalk} center /></g>;
        })}
        {intent.molecule ? <ScienceText x={viewBoxNumber(viewBox, 0) + 0.5} y={viewBoxNumber(viewBox, 1) + 0.65} text={intent.molecule} color={chalk} /> : null}
        {intent.reaction ? <ScienceText x={viewBoxNumber(viewBox, 0) + 0.5} y={viewBoxNumber(viewBox, 1) + 1.15} text={intent.reaction} color={chalk} /> : null}
      </svg>
      {caption && <figcaption className="mt-1 text-[13px] opacity-70">{caption}</figcaption>}
    </figure>
  );
}

function ChemistrySpeciesCard({ item, chalk }: { item: { svg?: string; text?: string; key: string }, chalk: string }) {
  return item.svg
    ? <div className="rounded border bg-black/5 p-1" style={{ borderColor: 'rgba(255,255,255,0.12)' }}><div className="chemistry-rdkit" style={{ color: chalk }} dangerouslySetInnerHTML={{ __html: item.svg }} /></div>
    : <div className="rounded border bg-black/5 px-3 py-2 font-mono text-[12px] opacity-85" style={{ borderColor: 'rgba(255,255,255,0.12)' }}>{item.text}</div>;
}

function BiologySurface({
  intent,
  state,
  chalk,
  accent,
  scale,
  caption,
  readOnly,
  onState,
}: {
  intent: BiologyIntent;
  state?: VisualizationState;
  chalk: string;
  accent: string;
  scale: number;
  caption?: string;
  readOnly: boolean;
  onState?: (next: VisualizationState) => void;
}) {
  if (intent.variant === "pathway") {
    return <BiologyNetworkSurface intent={intent} state={state} chalk={chalk} accent={accent} scale={scale} caption={caption} readOnly={readOnly} onState={onState} />;
  }
  const points = (intent.structures ?? []).map((s) => s.at);
  const box = fitScienceBox(points.length ? points : [[0, 0], [6, 4]]);
  const { viewBox, toSvg, hostHeight } = scienceSurfaceMetrics(box, scale);
  return (
    <figure className="m-0 w-full" data-nopan style={{ width: "100%", maxWidth: "100%" }}>
      <svg className="block w-full rounded border" style={{ height: hostHeight, borderColor: `${accent}44`, background: "rgba(0,0,0,0.06)" }} viewBox={viewBox} preserveAspectRatio="xMidYMid meet">
        {intent.variant === "cell" ? <ellipse cx={viewBoxCenterX(viewBox)} cy={viewBoxCenterY(viewBox)} rx={viewBoxWidth(viewBox) * 0.36} ry={viewBoxHeight(viewBox) * 0.3} fill="rgba(255,255,255,0.03)" stroke={chalk} strokeWidth={0.08} /> : null}
        {intent.variant === "dna" ? renderDnaBackdrop(viewBox, accent) : null}
        {(intent.connections ?? []).map((conn, i) => {
          const from = intent.structures?.find((s) => s.id === conn.from)?.at;
          const to = intent.structures?.find((s) => s.id === conn.to)?.at;
          if (!from || !to) return null;
          const [x1, y1] = toSvg(from);
          const [x2, y2] = toSvg(to);
          return <g key={`conn-${i}`}><Arrow x1={x1} y1={y1} x2={x2} y2={y2} color={accent} width={0.06} />{conn.label ? <ScienceText x={(x1 + x2) / 2} y={(y1 + y2) / 2 - 0.18} text={conn.label} color={chalk} center /> : null}</g>;
        })}
        {(intent.structures ?? []).map((s) => {
          const [x, y] = toSvg(s.at);
          const r = s.kind === "nucleus" ? 0.42 : 0.28;
          return <g key={s.id}><circle cx={x} cy={y} r={r} fill="rgba(255,255,255,0.04)" stroke={accent} strokeWidth={0.07} /><ScienceText x={x + 0.42} y={y - 0.12} text={s.label} color={chalk} /></g>;
        })}
      </svg>
      {caption && <figcaption className="mt-1 text-[13px] opacity-70">{caption}</figcaption>}
    </figure>
  );
}

function BiologyNetworkSurface({
  intent,
  state,
  chalk,
  accent,
  scale,
  caption,
  readOnly,
  onState,
}: {
  intent: BiologyIntent;
  state?: VisualizationState;
  chalk: string;
  accent: string;
  scale: number;
  caption?: string;
  readOnly: boolean;
  onState?: (next: VisualizationState) => void;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const stateRef = useRef(state);
  const onStateRef = useRef(onState);
  const [error, setError] = useState<string | null>(null);
  stateRef.current = state;
  onStateRef.current = onState;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let cancelled = false;
    let cy: CytoscapeCore | null = null;
    setError(null);

    void loadCytoscape().then((cytoscapeFactory) => {
      if (cancelled) return;
      const structures = intent.structures ?? [];
      const initialState = stateRef.current;
      const nodePositions = initialState?.nodePositions ?? {};
      const elements = [
        ...structures.map((s) => ({
          data: { id: s.id, label: s.label, kind: s.kind ?? 'node' },
          position: nodePositions[s.id]
            ? { x: nodePositions[s.id][0], y: nodePositions[s.id][1] }
            : { x: s.at[0] * 80, y: -s.at[1] * 80 },
        })),
        ...(intent.connections ?? []).map((c, i) => ({ data: { id: `e-${i}`, source: c.from, target: c.to, label: c.label ?? '' } })),
      ];
      const layoutName = initialState?.scienceLayout || intent.layout || (structures.every((s) => Array.isArray(s.at)) ? 'preset' : 'breadthfirst');
      const instance = cytoscapeFactory({
        container: host,
        elements,
        layout: { name: layoutName as any, fit: true, padding: intent.style?.compact ? 12 : 30 },
        wheelSensitivity: 0.2,
        style: [
          {
            selector: 'node',
            style: {
              'background-color': intent.style?.nodeColorByKind ? 'mapData(kindScore, 0, 1, ' + accent + ', #86efac)' : accent,
              'label': 'data(label)',
              'color': chalk,
              'text-valign': 'center',
              'text-halign': 'center',
              'font-size': intent.style?.compact ? 10 : 11,
              'text-outline-width': 0,
              'width': intent.style?.compact ? 26 : 32,
              'height': intent.style?.compact ? 26 : 32,
              'border-width': 1,
              'border-color': chalk,
            },
          },
          {
            selector: 'edge',
            style: {
              'curve-style': 'bezier',
              'target-arrow-shape': intent.style?.directed === false ? 'none' : 'triangle',
              'line-color': accent,
              'target-arrow-color': accent,
              'label': 'data(label)',
              'font-size': 10,
              'color': chalk,
              'text-background-opacity': 0,
              'width': 2,
            },
          },
        ],
        userZoomingEnabled: true,
        userPanningEnabled: true,
        autoungrabify: readOnly,
        boxSelectionEnabled: false,
      });
      cy = instance;

      if (intent.style?.nodeColorByKind) {
        instance.nodes().forEach((node) => {
          const kind = node.data('kind');
          const color = kind === 'gene' ? '#86efac' : kind === 'protein' ? '#fcd34d' : kind === 'nucleus' ? '#a5b4fc' : accent;
          node.style('background-color', color);
        });
      }

      const emitPositions = () => {
        const onChange = onStateRef.current;
        if (!onChange) return;
        const next: Record<string, [number, number]> = {};
        instance.nodes().forEach((node) => {
          const pos = node.position();
          next[String(node.id())] = [pos.x, pos.y];
        });
        onChange({ ...(stateRef.current ?? {}), nodePositions: next, scienceLayout: layoutName });
      };

      instance.on('dragfree', 'node', emitPositions);
      instance.on('layoutstop', emitPositions);
      if (layoutName === 'preset') instance.fit(undefined, intent.style?.compact ? 12 : 30);
    }).catch(() => {
      if (!cancelled) setError('Biology network rendering failed to initialize.');
      cy?.destroy();
      cy = null;
    });

    return () => {
      cancelled = true;
      cy?.destroy();
      cy = null;
    };
  }, [intent, chalk, accent, readOnly]);

  const heightPx = Math.round(280 * Math.max(0.8, Math.min(scale, 1.2)));
  if (error) return <UnsupportedCard reason={error} chalk={chalk} accent={accent} caption={caption} />;
  return (
    <figure className="m-0 w-full" data-nopan style={{ width: '100%', maxWidth: '100%' }}>
      <div ref={hostRef} className="w-full rounded border" style={{ height: Math.max(240, Math.min(460, heightPx)), borderColor: `${accent}44`, background: 'rgba(0,0,0,0.06)' }} />
      {caption && <figcaption className="mt-1 text-[13px] opacity-70">{caption}</figcaption>}
    </figure>
  );
}

/* ───────────────────────── 3D graphing (three.js) ───────────────────────── */

function Graph3DSurface({
  intent,
  state,
  chalk,
  accent,
  scale,
  caption,
  onState,
}: {
  intent: Graph3DIntent;
  state?: VisualizationState;
  chalk: string;
  accent: string;
  scale: number;
  caption?: string;
  onState?: (next: VisualizationState) => void;
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stateRef = useRef(state);
  const onStateRef = useRef(onState);
  const [error, setError] = useState<string | null>(null);
  stateRef.current = state;
  onStateRef.current = onState;

  useEffect(() => {
    const host = wrapRef.current;
    const canvas = canvasRef.current;
    if (!host || !canvas) return;
    setError(null);

    let renderer: THREE.WebGLRenderer | null = null;
    let controls: OrbitControls | null = null;
    let ro: ResizeObserver | null = null;
    let scene: THREE.Scene | null = null;
    let raf = 0;
    let requestRender = () => {};
    let emitCameraState = () => {};

    try {
      const webgl = canvas.getContext('webgl2') || canvas.getContext('webgl');
      if (!webgl) {
        setError('3D graphing is unavailable in this browser or preview environment.');
        return;
      }

      renderer = new THREE.WebGLRenderer({
        canvas,
        antialias: true,
        alpha: true,
        context: webgl as WebGLRenderingContext,
      });
      // A lower DPR ceiling avoids multiplying fill work on dense surfaces while
      // retaining sharp output on common HiDPI displays.
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
      renderer.outputColorSpace = THREE.SRGBColorSpace;

      scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 2000);
      controls = new OrbitControls(camera, canvas);
      // Damping requires a permanent animation loop. Static scenes instead
      // render only when controls or layout dimensions change.
      controls.enableDamping = false;
      controls.enablePan = true;
      controls.enableZoom = true;
      controls.enableRotate = true;
      controls.zoomSpeed = 0.9;
      controls.panSpeed = 0.9;
      canvas.style.touchAction = 'none';

      scene.add(new THREE.AmbientLight(0xffffff, 0.9));
      const key = new THREE.DirectionalLight(0xffffff, 0.9);
      key.position.set(6, 10, 8);
      scene.add(key);
      const fill = new THREE.DirectionalLight(0xffffff, 0.35);
      fill.position.set(-6, -3, -5);
      scene.add(fill);

      const graphGroup = new THREE.Group();
      scene.add(graphGroup);
      const dataGroup = new THREE.Group();
      graphGroup.add(dataGroup);
      const overlayGroup = new THREE.Group();
      scene.add(overlayGroup);

      const axisColor = new THREE.Color(chalk);
      const inputDomain = {
        x: intent.domain?.x ?? [-5, 5],
        y: intent.domain?.y ?? [-5, 5],
      } as const;

      const samplingPlan = getGraph3DSamplingPlan(intent);
      for (const [surfaceIndex, item] of intent.surfaces.entries()) {
        const itemSampling = samplingPlan[surfaceIndex];
        const color = new THREE.Color(item.color ?? accent);
        try {
          switch (item.kind) {
            case 'surface': {
              const zOf = compileScopedExpression(item.z, ['x', 'y']);
              const mesh = buildSurfaceMesh(
                inputDomain.x,
                inputDomain.y,
                itemSampling[0],
                itemSampling[1],
                (x, y) => zOf({ x, y }),
                color,
                item.opacity ?? 0.82,
                item.renderMode ?? 'surface'
              );
              if (mesh) dataGroup.add(mesh);
              break;
            }
            case 'parametric_surface': {
              const xOf = compileScopedExpression(item.x, ['u', 'v']);
              const yOf = compileScopedExpression(item.y, ['u', 'v']);
              const zOf = compileScopedExpression(item.z, ['u', 'v']);
              const mesh = buildParametricSurfaceMesh(
                item.uDomain,
                item.vDomain,
                itemSampling[0],
                itemSampling[1],
                (u, v) => [xOf({ u, v }), yOf({ u, v }), zOf({ u, v })],
                color,
                item.opacity ?? 0.82,
                item.renderMode ?? 'surface'
              );
              if (mesh) dataGroup.add(mesh);
              break;
            }
            case 'parametric_curve': {
              const xOf = compileScopedExpression(item.x, ['t']);
              const yOf = compileScopedExpression(item.y, ['t']);
              const zOf = compileScopedExpression(item.z, ['t']);
              const line = buildCurve3D(
                item.tDomain,
                itemSampling[0],
                (t) => [xOf({ t }), yOf({ t }), zOf({ t })],
                color
              );
              if (line) dataGroup.add(line);
              break;
            }
            case 'point': {
              if (item.at.every((n) => isFinite(n))) {
                const point = buildPoint3D(item.at, color, item.label, chalk);
                if (point) dataGroup.add(point);
              }
              break;
            }
            case 'point_cloud': {
              const pts = item.points.filter((p) => p.every((n) => isFinite(n)));
              const cloud = buildPointCloud(pts, color);
              if (cloud) dataGroup.add(cloud);
              break;
            }
            case 'vector_field': {
              const fx = compileScopedExpression(item.fx, ['x', 'y', 'z']);
              const fy = compileScopedExpression(item.fy, ['x', 'y', 'z']);
              const fz = compileScopedExpression(item.fz, ['x', 'y', 'z']);
              const arrows = buildVectorField3D(
                item.xDomain,
                item.yDomain,
                item.zDomain,
                itemSampling[0],
                itemSampling[1],
                itemSampling[2],
                (x, y, z) => [fx({ x, y, z }), fy({ x, y, z }), fz({ x, y, z })],
                color
              );
              if (arrows) dataGroup.add(arrows);
              break;
            }
          }
        } catch {
          /* malformed 3D object — skip it, keep the rest */
        }
      }

      const dataBounds = new THREE.Box3().setFromObject(dataGroup);
      if (dataBounds.isEmpty()) {
        dataBounds.expandByPoint(new THREE.Vector3(inputDomain.x[0], -1, inputDomain.y[0]));
        dataBounds.expandByPoint(new THREE.Vector3(inputDomain.x[1], 1, inputDomain.y[1]));
      }
      const xExtent = intent.domain?.x ?? [dataBounds.min.x, dataBounds.max.x] as [number, number];
      const yExtent = intent.domain?.y ?? [dataBounds.min.z, dataBounds.max.z] as [number, number];
      let zExtent = intent.domain?.z ?? [dataBounds.min.y, dataBounds.max.y] as [number, number];
      if (zExtent[0] === zExtent[1]) zExtent = [zExtent[0] - 1, zExtent[1] + 1];
      zExtent = [zExtent[0] - (zExtent[1] - zExtent[0]) * 0.18, zExtent[1] + (zExtent[1] - zExtent[0]) * 0.18];

      if (intent.axes?.showGrid !== false) {
        const gridSize = Math.max(xExtent[1] - xExtent[0], yExtent[1] - yExtent[0], 10);
        const grid = new THREE.GridHelper(
          gridSize,
          10,
          axisColor.clone().multiplyScalar(0.65),
          axisColor.clone().multiplyScalar(0.35)
        );
        grid.position.set((xExtent[0] + xExtent[1]) / 2, 0, (yExtent[0] + yExtent[1]) / 2);
        grid.material.transparent = true;
        (grid.material as THREE.Material).opacity = 0.18;
        graphGroup.add(grid);
      }

      graphGroup.add(buildAxisLine(new THREE.Vector3(xExtent[0], 0, 0), new THREE.Vector3(xExtent[1], 0, 0), axisColor));
      graphGroup.add(buildAxisLine(new THREE.Vector3(0, 0, yExtent[0]), new THREE.Vector3(0, 0, yExtent[1]), axisColor));
      graphGroup.add(buildAxisLine(new THREE.Vector3(0, zExtent[0], 0), new THREE.Vector3(0, zExtent[1], 0), axisColor));

      if (intent.axes?.xLabel) overlayGroup.add(buildTextSprite(intent.axes.xLabel, chalk, new THREE.Vector3(xExtent[1], 0, 0)));
      if (intent.axes?.yLabel) overlayGroup.add(buildTextSprite(intent.axes.yLabel, chalk, new THREE.Vector3(0, 0, yExtent[1])));
      if (intent.axes?.zLabel) overlayGroup.add(buildTextSprite(intent.axes.zLabel, chalk, new THREE.Vector3(0, zExtent[1], 0)));

      const bounds = new THREE.Box3().setFromObject(graphGroup);
      if (bounds.isEmpty()) {
        bounds.expandByPoint(new THREE.Vector3(-5, -5, -5));
        bounds.expandByPoint(new THREE.Vector3(5, 5, 5));
      }
      const center = bounds.getCenter(new THREE.Vector3());
      const size = bounds.getSize(new THREE.Vector3());
      const radius = Math.max(size.length() * 0.45, 4);
      const initialState = stateRef.current;
      if (initialState?.graph3dCamera) {
        camera.position.set(...initialState.graph3dCamera.position);
        controls.target.set(...initialState.graph3dCamera.target);
      } else {
        const azimuth = ((intent.camera?.azimuth ?? 40) * Math.PI) / 180;
        const elevation = ((intent.camera?.elevation ?? 28) * Math.PI) / 180;
        const distance = intent.camera?.distance ?? radius * 1.9;
        camera.position.set(
          center.x + Math.cos(azimuth) * Math.cos(elevation) * distance,
          center.y + Math.sin(elevation) * distance,
          center.z + Math.sin(azimuth) * Math.cos(elevation) * distance
        );
        controls.target.copy(center);
      }
      emitCameraState = () => {
        const onChange = onStateRef.current;
        const activeControls = controls;
        if (!onChange || !activeControls) return;
        onChange({
          ...(stateRef.current ?? {}),
          graph3dCamera: {
            position: [camera.position.x, camera.position.y, camera.position.z],
            target: [activeControls.target.x, activeControls.target.y, activeControls.target.z],
          },
        });
      };

      // Coalesce bursts of control/resize events into one frame. There is no
      // recursive RAF, so an idle chalkboard consumes no continuous GPU time.
      requestRender = () => {
        if (raf) return;
        raf = window.requestAnimationFrame(() => {
          raf = 0;
          if (renderer && scene) renderer.render(scene, camera);
        });
      };
      controls.addEventListener('change', requestRender);
      controls.addEventListener('end', emitCameraState);
      controls.update();

      const resize = () => {
        const width = host.clientWidth;
        const height = host.clientHeight;
        if (width <= 0 || height <= 0 || !renderer) return;
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        renderer.setSize(width, height, false);
        requestRender();
      };
      resize();
      ro = new ResizeObserver(resize);
      ro.observe(host);
    } catch {
      setError('3D graphing failed to initialize in this environment.');
      renderer?.dispose();
    }

    return () => {
      window.cancelAnimationFrame(raf);
      ro?.disconnect();
      controls?.removeEventListener('change', requestRender as any);
      controls?.removeEventListener('end', emitCameraState as any);
      controls?.dispose();
      scene?.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
        const material = (mesh as { material?: THREE.Material | THREE.Material[] }).material;
        if (Array.isArray(material)) material.forEach((m) => m.dispose());
        else material?.dispose();
        const sprite = obj as THREE.Sprite;
        if (sprite.material && 'map' in sprite.material) {
          (sprite.material as THREE.SpriteMaterial).map?.dispose();
        }
      });
      renderer?.dispose();
    };
  }, [intent, chalk, accent]);

  const heightPx = Math.round(400 * Math.max(0.7, Math.min(scale, 1.25)));

  if (error) {
    return <UnsupportedCard reason={error} chalk={chalk} accent={accent} caption={caption} />;
  }

  return (
    <figure className="m-0 w-full" data-nopan style={{ width: '100%', maxWidth: '100%' }}>
      <div
        ref={wrapRef}
        className="relative w-full overflow-hidden rounded border"
        style={{
          height: Math.max(260, Math.min(620, heightPx)),
          borderColor: `${accent}55`,
          background: 'rgba(0,0,0,0.10)',
        }}
      >
        <canvas ref={canvasRef} className="block h-full w-full" />
        <div className="pointer-events-none absolute bottom-2 right-2 rounded bg-black/30 px-2 py-1 font-mono text-[10px] text-white/70">
          drag · pinch/scroll to zoom
        </div>
      </div>
      {caption && <figcaption className="mt-1 text-[13px] opacity-70">{caption}</figcaption>}
    </figure>
  );
}

/* ───────────────────────── JSXGraph (geometry + function) ───────────────────────── */

function JsxGraphSurface({
  intent,
  state,
  chalk,
  accent,
  scale,
  readOnly,
  onState,
}: {
  intent: VisualizationIntent;
  state?: VisualizationState;
  chalk: string;
  accent: string;
  scale: number;
  readOnly: boolean;
  onState?: (next: VisualizationState) => void;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const onStateRef = useRef(onState);
  onStateRef.current = onState;

  // Persisted point positions to seed the board with. Keyed on the intent
  // identity (NOT on the live `state` prop) so that an echo of our own drag
  // back down from the parent does NOT re-init the board mid-drag. When the
  // intent changes (or the block is restored on session reopen) this is
  // recomputed fresh and the new positions are applied.
  const seedKey = useMemo(() => JSON.stringify(intent), [intent]);
  const seedPositions = useMemo(
    () => (state?.pointPositions as Record<string, [number, number]>) ?? {},
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [seedKey]
  );

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    setError(null);

    // Unique board container id (JSXGraph attaches by id).
    const containerId = `jsxcell-${Math.random().toString(36).slice(2, 9)}`;
    host.id = containerId;

    const isGeometry = intent.type === "geometry";
    const isFunction = intent.type === "function";
    const displayMode = resolveDisplayMode(intent);
    const showGraph = displayMode === "graph";

    // The figure's true extent, in user units.
    const figureBox = computeBoundingBox(intent, { pointPositions: seedPositions });

    // Under `keepaspectratio` JSXGraph reconciles the box against the container
    // by picking a "dominating interval", and which one it picks depends on
    // both the container and the box — that is where figures lost their edges.
    // We take that decision away from it: expand the figure box symmetrically
    // until its aspect EXACTLY matches the container, so the fit is an identity
    // and the whole figure is guaranteed visible with square units.
    const fitted = () => fitBoxToAspect(figureBox, host.clientWidth, host.clientHeight);

    const board: Board = JXG.JSXGraph.initBoard(containerId, {
      boundingbox: fitted(),
      keepaspectratio: isGeometry,
      showCopyright: false,
      showNavigation: false,
      pan: { enabled: isFunction, needShift: false, needTwoFingers: false },
      zoom: {
        wheel: isFunction,
        needShift: false,
        factorX: 1.18,
        factorY: 1.18,
        pinch: isFunction,
        pinchHorizontal: isFunction,
        pinchVertical: isFunction,
      } as any,
      axis: false,
      grid: false,
      defaultAxes: {},
    });

    // Seed from persisted positions (stable per intent; see seedPositions).
    const positions: Record<string, [number, number]> = { ...seedPositions };
    const created: Record<string, GeometryElement> = {};

    // Chalk-styled axes for graph mode only. Geometry defaults to graphless so
    // a pure diagram does not get an incidental coordinate plane slicing behind
    // it just because the origin lies nearby.
    const axisAttrs = {
      strokeColor: chalk,
      strokeWidth: 1.6,
      highlight: false,
      opacity: 0.75,
      ticks: {
        strokeColor: chalk,
        strokeWidth: 1.2,
        majorHeight: 4,
        minorHeight: 0,
        ticksDistance: 1,
        label: {
          fontSize: 10,
          color: chalk,
          opacity: 0.85,
          anchorX: "middle",
          cssStyle: "font-family: monospace",
        } as LabelAttrs,
      },
    };
    // Only draw axes in explicit graph mode. Each axis appears only when its
    // own zero-line intersects the figure's box, tested against the figure box
    // rather than the aspect-fitted one so a wide container cannot drag an
    // unwanted background graph into view.
    const [fxMin, fyMax, fxMax, fyMin] = figureBox;
    const xAxisInView = 0 >= fyMin && 0 <= fyMax;
    const yAxisInView = 0 >= fxMin && 0 <= fxMax;
    if (showGraph) {
      try {
        if (xAxisInView) board.create("axis", [[0, 0], [1, 0]], axisAttrs);
        if (yAxisInView) board.create("axis", [[0, 0], [0, 1]], axisAttrs);
      } catch {
        /* axes optional — JSXGraph boards may omit them gracefully */
      }
    }

    try {
      if (isGeometry) {
        renderGeometry(board, intent, created, positions, chalk, accent, readOnly);
      } else if (isFunction) {
        renderFunction(board, intent as FunctionIntent, chalk, accent);
      }
    } catch {
      try {
        JXG.JSXGraph.freeBoard(board);
      } catch {
        /* board may already be freed */
      }
      setError("Graph rendering failed for this visualization.");
      return;
    }

    // ── Persist drag positions (Task #6) ──
    const reportState = () => {
      const nextPos: Record<string, [number, number]> = {};
      let changed = false;
      for (const [id, obj] of Object.entries(created)) {
        const p = obj as Partial<Point> & { X?: () => number; Y?: () => number };
        if (typeof p.X === "function" && typeof p.Y === "function") {
          const x = p.X();
          const y = p.Y();
          nextPos[id] = [x, y];
          if (!positions[id] || positions[id][0] !== x || positions[id][1] !== y) {
            positions[id] = [x, y];
            changed = true;
          }
        }
      }
      if (changed && onStateRef.current) {
        // Base-merge on the stable seed, NOT the live `state` prop — echoing our
        // own drag back as a new `state` would otherwise re-init the board.
        onStateRef.current({ pointPositions: { ...seedPositions, ...nextPos } });
      }
    };
    if (isGeometry && onState) {
      board.on("update", reportState);
    }

    board.update();

    // JSXGraph sizes its SVG to the host, and the host's height comes from the
    // figure's aspect (see BoardHost). On every resize we recompute the
    // aspect-matched box for the CURRENT container and apply it, so the whole
    // figure stays visible at any column width. Drag persistence is unaffected —
    // resizing does not re-init the board.
    //
    // We always apply a freshly-computed box rather than letting resizeContainer
    // round-trip through getBoundingBox(): that getter returns the currently
    // *visible* box, so feeding it back on each resize compounds the padding
    // and the figure creeps toward a corner. `dontset`/`dontSetBoundingBox`
    // both true keeps React the sole owner of the container's inline size and
    // skips that round-trip. For geometry we recompute from the LIVE point
    // positions, so a point the learner dragged outward is brought back into
    // frame on the next resize instead of staying stranded off-canvas.
    const resize = () => {
      const w = host.clientWidth;
      const h = host.clientHeight;
      if (w > 0 && h > 0) {
        try {
          board.resizeContainer(w, h, true, true);
          const liveBox = isGeometry
            ? computeBoundingBox(intent, { pointPositions: positions })
            : figureBox;
          board.setBoundingBox(fitBoxToAspect(liveBox, w, h), isGeometry, "reset");
          board.fullUpdate();
        } catch {
          /* board already freed */
        }
      }
    };
    const ro = new ResizeObserver(resize);
    ro.observe(host);

    return () => {
      ro.disconnect();
      if (isGeometry && onState) board.off("update", reportState);
      JXG.JSXGraph.freeBoard(board);
    };
    // Re-init only when the visual identity changes. We intentionally do NOT
    // depend on `state.pointPositions`: `saveBlockState` echoes our own drag
    // back down as a new `state` prop, which would re-init the board mid-drag.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intent, chalk, accent, scale, readOnly]);

  const isGeometry = intent.type === "geometry";
  const isFunction = intent.type === "function";
  const heightPx = Math.round(230 * Math.max(0.55, Math.min(scale, 1.4)));
  const title = "title" in intent ? intent.title : undefined;

  if (error) {
    return <UnsupportedCard reason={error} chalk={chalk} accent={accent} caption={title} />;
  }

  return <BoardHost hostRef={hostRef} isGeometry={isGeometry} intent={intent} seedPositions={seedPositions} heightPx={heightPx} title={title} disableBoardPan={isFunction} />;
}

/** Build JSXGraph objects for a geometry intent, honoring persisted positions. */
function renderGeometry(
  board: Board,
  intent: GeometryIntent,
  created: Record<string, GeometryElement>,
  positions: Record<string, [number, number]>,
  chalk: string,
  accent: string,
  readOnly: boolean
) {
  const ref = (id: string): GeometryElement | undefined => created[id];
  const lineStyle = (o: { style?: { color?: string; strokeWidth?: number; dash?: boolean } }) => ({
    strokeColor: o.style?.color ?? chalk,
    strokeWidth: o.style?.strokeWidth ?? 2.2,
    dash: o.style?.dash ? 2 : 0,
    highlight: false,
    opacity: 0.95,
    strokeLinecap: "round",
  });

  // First pass: points (everything else references points by id).
  for (const obj of intent.objects) {
    if (obj.kind === "point") {
      const pt = positions[obj.id] ?? obj.at;
      created[obj.id] = board.create("point", pt, {
        name: obj.label ?? "",
        size: 3,
        fillColor: accent,
        strokeColor: chalk,
        strokeWidth: 1.2,
        fixed: readOnly || obj.draggable === false,
        showInfobox: false,
        snapToGrid: false,
        label: {
          offset: [6, 8],
          fontSize: 13,
          color: chalk,
          opacity: 0.85,
          cssStyle: "font-family: monospace",
        } as LabelAttrs,
      }) as GeometryElement;
    }
  }

  // Second pass: the rest, resolving referenced point ids from `created`.
  for (const obj of intent.objects) {
    switch (obj.kind) {
      case "point":
        continue; // already created
      case "line": {
        const [a, b] = obj.through;
        if (ref(a) && ref(b)) {
          board.create("line", [ref(a), ref(b)], lineStyle(obj));
          const p1 = positions[a];
          const p2 = positions[b];
          if (p1 && p2 && obj.parallelMarkCount) {
            for (const pts of buildParallelMarks(p1, p2, obj.parallelMarkCount, 0.36, 0.3)) {
              for (let i = 0; i < pts.length - 1; i++) {
                board.create("segment", [pts[i], pts[i + 1]], {
                  strokeColor: obj.style?.color ?? chalk,
                  strokeWidth: 1.8,
                  highlight: false,
                  fixed: true,
                });
              }
            }
          }
        }
        break;
      }
      case "segment": {
        if (ref(obj.from) && ref(obj.to)) {
          board.create("segment", [ref(obj.from), ref(obj.to)], lineStyle(obj));
          const a = positions[obj.from];
          const b = positions[obj.to];
          if (a && b) {
            if (obj.tickCount) {
              for (const [m1, m2] of buildSegmentTickMarks(a, b, obj.tickCount, 0.32, 0.26)) {
                board.create("segment", [m1, m2], {
                  strokeColor: obj.style?.color ?? chalk,
                  strokeWidth: 1.8,
                  highlight: false,
                  fixed: true,
                });
              }
            }
            if (obj.parallelMarkCount) {
              for (const pts of buildParallelMarks(a, b, obj.parallelMarkCount, 0.36, 0.3)) {
                for (let i = 0; i < pts.length - 1; i++) {
                  board.create("segment", [pts[i], pts[i + 1]], {
                    strokeColor: obj.style?.color ?? chalk,
                    strokeWidth: 1.8,
                    highlight: false,
                    fixed: true,
                  });
                }
              }
            }
            if (obj.midpointMarker) {
              const [mx, my] = segmentMidpoint(a, b);
              board.create("point", [mx, my], {
                name: "",
                size: 2.3,
                fillColor: accent,
                strokeColor: chalk,
                strokeWidth: 1.1,
                fixed: true,
                highlight: false,
                showInfobox: false,
              });
            }
            if (obj.label || obj.labelLatex) {
              const [lx, ly] = segmentLabelPosition(a, b, 0.42);
              board.create("text", [lx, ly, obj.label ?? obj.labelLatex ?? ""], {
                fontSize: 12,
                color: chalk,
                opacity: 0.85,
                cssStyle: "font-family: monospace",
              } as LabelAttrs);
            }
          }
        }
        break;
      }
      case "circle": {
        if (ref(obj.center)) {
          const attrs = { ...lineStyle(obj), fillColor: "none" };
          if (obj.radius !== undefined) {
            board.create("circle", [ref(obj.center), obj.radius], attrs);
          } else if (obj.through && ref(obj.through)) {
            board.create("circle", [ref(obj.center), ref(obj.through)], attrs);
          }
        }
        break;
      }
      case "polygon": {
        const verts = obj.vertices.map(ref).filter(Boolean) as GeometryElement[];
        if (verts.length >= 3) board.create("polygon", verts, { ...lineStyle(obj), fillColor: accent, fillOpacity: 0.12 });
        break;
      }
      case "angle": {
        if (ref(obj.from) && ref(obj.at) && ref(obj.to)) {
          const from = positions[obj.from];
          const at = positions[obj.at];
          const to = positions[obj.to];
          const radius = obj.radius ?? ANGLE_ARC_RADIUS;
          if (from && at && to) {
            if ((obj.marker ?? "arc") === "right_angle") {
              const pts = buildRightAngleMarker(from, at, to, radius);
              for (let i = 0; i < pts.length - 1; i++) {
                board.create("segment", [pts[i], pts[i + 1]], {
                  strokeColor: accent,
                  strokeWidth: 1.6,
                  highlight: false,
                  fixed: true,
                });
              }
            } else {
              const arcCount = Math.max(1, obj.arcCount ?? 1);
              for (let i = 0; i < arcCount; i++) {
                const factor = 1 + (i - (arcCount - 1) / 2) * 0.22;
                const arc = buildAngleArcPoints(from, at, to, radius * factor);
                for (let j = 0; j < arc.length - 1; j++) {
                  board.create("segment", [arc[j], arc[j + 1]], {
                    strokeColor: accent,
                    strokeWidth: 1.6,
                    highlight: false,
                    fixed: true,
                  });
                }
              }
            }
            const labelText = obj.label ?? obj.labelLatex ?? (obj.showMeasure ? `${Math.round(computeAngleMeasureDeg(from, at, to))}°` : undefined);
            if (labelText) {
              const [lx, ly] = angleLabelPosition(from, at, to, radius * ((obj.marker ?? "arc") === "right_angle" ? 1.8 : 1.45));
              board.create("text", [lx, ly, labelText], {
                fontSize: 12,
                color: chalk,
                opacity: 0.85,
                cssStyle: "font-family: monospace",
              } as LabelAttrs);
            }
          }
        }
        break;
      }
      case "label": {
        if (ref(obj.anchor)) {
          board.create("text", [0, 0, obj.text], {
            anchor: ref(obj.anchor),
            fontSize: 13,
            color: chalk,
            opacity: 0.85,
            cssStyle: "font-family: monospace",
          } as LabelAttrs);
        }
        break;
      }
      case "text": {
        created[obj.id] = board.create("text", [obj.at[0], obj.at[1], obj.text], {
          fontSize: 13,
          color: chalk,
          opacity: 0.7,
          cssStyle: "font-family: monospace",
        }) as GeometryElement;
        break;
      }
      case "notation": {
        switch (obj.variant) {
          case "segment": {
            const a = positions[obj.from];
            const b = positions[obj.to];
            if (a && b) {
              if (obj.tickCount) {
                for (const [m1, m2] of buildSegmentTickMarks(a, b, obj.tickCount, 0.32, 0.26)) {
                  board.create("segment", [m1, m2], { strokeColor: chalk, strokeWidth: 1.8, highlight: false, fixed: true });
                }
              }
              if (obj.parallelMarkCount) {
                for (const pts of buildParallelMarks(a, b, obj.parallelMarkCount, 0.36, 0.3)) {
                  for (let i = 0; i < pts.length - 1; i++) board.create("segment", [pts[i], pts[i + 1]], { strokeColor: chalk, strokeWidth: 1.8, highlight: false, fixed: true });
                }
              }
              if (obj.midpointMarker) {
                const [mx, my] = segmentMidpoint(a, b);
                board.create("point", [mx, my], { name: "", size: 2.3, fillColor: accent, strokeColor: chalk, strokeWidth: 1.1, fixed: true, highlight: false, showInfobox: false });
              }
              if (obj.label || obj.labelLatex) {
                const [lx, ly] = segmentLabelPosition(a, b, 0.42);
                board.create("text", [lx, ly, obj.label ?? obj.labelLatex ?? ""], { fontSize: 12, color: chalk, opacity: 0.85, cssStyle: "font-family: monospace" } as LabelAttrs);
              }
            }
            break;
          }
          case "angle": {
            const from = positions[obj.from];
            const at = positions[obj.at];
            const to = positions[obj.to];
            const radius = obj.radius ?? ANGLE_ARC_RADIUS;
            if (from && at && to) {
              if ((obj.marker ?? "arc") === "right_angle") {
                const pts = buildRightAngleMarker(from, at, to, radius);
                for (let i = 0; i < pts.length - 1; i++) board.create("segment", [pts[i], pts[i + 1]], { strokeColor: accent, strokeWidth: 1.6, highlight: false, fixed: true });
              } else {
                const arcCount = Math.max(1, obj.arcCount ?? 1);
                for (let i = 0; i < arcCount; i++) {
                  const factor = 1 + (i - (arcCount - 1) / 2) * 0.22;
                  const arc = buildAngleArcPoints(from, at, to, radius * factor);
                  for (let j = 0; j < arc.length - 1; j++) board.create("segment", [arc[j], arc[j + 1]], { strokeColor: accent, strokeWidth: 1.6, highlight: false, fixed: true });
                }
              }
              const labelText = obj.label ?? obj.labelLatex ?? (obj.showMeasure ? `${Math.round(computeAngleMeasureDeg(from, at, to))}°` : undefined);
              if (labelText) {
                const [lx, ly] = angleLabelPosition(from, at, to, radius * ((obj.marker ?? "arc") === "right_angle" ? 1.8 : 1.45));
                board.create("text", [lx, ly, labelText], { fontSize: 12, color: chalk, opacity: 0.85, cssStyle: "font-family: monospace" } as LabelAttrs);
              }
            }
            break;
          }
          case "parallel": {
            const a = positions[obj.from];
            const b = positions[obj.to];
            if (a && b) {
              for (const pts of buildParallelMarks(a, b, obj.markCount ?? 1, 0.36, 0.3)) {
                for (let i = 0; i < pts.length - 1; i++) board.create("segment", [pts[i], pts[i + 1]], { strokeColor: chalk, strokeWidth: 1.8, highlight: false, fixed: true });
              }
            }
            break;
          }
          case "midpoint": {
            const a = positions[obj.from];
            const b = positions[obj.to];
            if (a && b) {
              const [mx, my] = segmentMidpoint(a, b);
              board.create("point", [mx, my], { name: "", size: 2.3, fillColor: accent, strokeColor: chalk, strokeWidth: 1.1, fixed: true, highlight: false, showInfobox: false });
              if (obj.label || obj.labelLatex) {
                const [lx, ly] = segmentLabelPosition(a, b, 0.52);
                board.create("text", [lx, ly, obj.label ?? obj.labelLatex ?? ""], { fontSize: 12, color: chalk, opacity: 0.85, cssStyle: "font-family: monospace" } as LabelAttrs);
              }
            }
            break;
          }
          case "perpendicular": {
            const at = positions[obj.at];
            const arm1 = positions[obj.arm1];
            const arm2 = positions[obj.arm2];
            const size = obj.size ?? ANGLE_ARC_RADIUS;
            if (at && arm1 && arm2) {
              const pts = buildRightAngleMarker(arm1, at, arm2, size);
              for (let i = 0; i < pts.length - 1; i++) board.create("segment", [pts[i], pts[i + 1]], { strokeColor: accent, strokeWidth: 1.6, highlight: false, fixed: true });
              if (obj.label || obj.labelLatex) {
                const [lx, ly] = angleLabelPosition(arm1, at, arm2, size * 1.9);
                board.create("text", [lx, ly, obj.label ?? obj.labelLatex ?? ""], { fontSize: 12, color: chalk, opacity: 0.85, cssStyle: "font-family: monospace" } as LabelAttrs);
              }
            }
            break;
          }
          case "bisector": {
            const from = positions[obj.from];
            const at = positions[obj.at];
            const through = positions[obj.through];
            const to = positions[obj.to];
            const radius = obj.radius ?? ANGLE_ARC_RADIUS * 0.82;
            if (from && at && through && to) {
              const left = buildAngleArcPoints(from, at, through, radius);
              const right = buildAngleArcPoints(through, at, to, radius);
              for (const arc of [left, right]) {
                for (let i = 0; i < arc.length - 1; i++) board.create("segment", [arc[i], arc[i + 1]], { strokeColor: accent, strokeWidth: 1.6, highlight: false, fixed: true });
              }
              if (obj.label || obj.labelLatex) {
                const [lx, ly] = angleLabelPosition(from, at, to, radius * 1.8);
                board.create("text", [lx, ly, obj.label ?? obj.labelLatex ?? ""], { fontSize: 12, color: chalk, opacity: 0.85, cssStyle: "font-family: monospace" } as LabelAttrs);
              }
            }
            break;
          }
        }
        break;
      }
      default: {
        const _exhaustive: never = obj;
        void _exhaustive;
      }
    }
  }

  // Apply teaching actions as construction-line hints where meaningful.
  if (intent.actions) {
    for (const action of intent.actions) {
      if (action === "show_measure" || action === "highlight_radius") {
        for (const obj of intent.objects) {
          const c = obj as CircleObject;
          if (c.kind === "circle" && c.center && c.through && ref(c.center) && ref(c.through)) {
            board.create("segment", [ref(c.center), ref(c.through)], {
              strokeColor: accent,
              strokeWidth: 1.5,
              dash: 2,
              opacity: 0.8,
              highlight: false,
            });
          }
        }
      }
    }
  }
}

function geometryPointMap(intent: GeometryIntent, state?: VisualizationState): Record<string, [number, number]> {
  const points: Record<string, [number, number]> = {};
  for (const obj of intent.objects) {
    if (obj.kind === "point") points[obj.id] = state?.pointPositions?.[obj.id] ?? obj.at;
  }
  return points;
}

function circleRadiusFromIntent(circle: CircleObject, points: Record<string, [number, number]>): number | null {
  const center = points[circle.center];
  if (!center) return null;
  if (typeof circle.radius === "number") return Math.abs(circle.radius);
  if (circle.through && points[circle.through]) {
    const through = points[circle.through];
    return Math.hypot(through[0] - center[0], through[1] - center[1]);
  }
  return null;
}

function clipInfiniteLineToBox(
  a: [number, number],
  b: [number, number],
  box: { xMin: number; xMax: number; yMin: number; yMax: number }
): [[number, number], [number, number]] | null {
  const [x1, y1] = a;
  const [x2, y2] = b;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const pts: [number, number][] = [];
  const pushIfInside = (x: number, y: number) => {
    const inside = x >= box.xMin - 1e-9 && x <= box.xMax + 1e-9 && y >= box.yMin - 1e-9 && y <= box.yMax + 1e-9;
    if (!inside) return;
    if (pts.some(([px, py]) => Math.abs(px - x) < 1e-9 && Math.abs(py - y) < 1e-9)) return;
    pts.push([x, y]);
  };

  if (Math.abs(dx) > 1e-9) {
    for (const x of [box.xMin, box.xMax]) {
      const t = (x - x1) / dx;
      pushIfInside(x, y1 + t * dy);
    }
  }
  if (Math.abs(dy) > 1e-9) {
    for (const y of [box.yMin, box.yMax]) {
      const t = (y - y1) / dy;
      pushIfInside(x1 + t * dx, y);
    }
  }

  if (pts.length < 2) return null;
  let best: [[number, number], [number, number]] = [pts[0], pts[1]];
  let bestDist = -1;
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      const d = Math.hypot(pts[i][0] - pts[j][0], pts[i][1] - pts[j][1]);
      if (d > bestDist) {
        bestDist = d;
        best = [pts[i], pts[j]];
      }
    }
  }
  return best;
}

function normalizeVec([x, y]: [number, number]): [number, number] {
  const len = Math.hypot(x, y);
  return len > 1e-9 ? [x / len, y / len] : [1, 0];
}

function segmentMidpoint(a: [number, number], b: [number, number]): [number, number] {
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
}

function buildParallelMarks(
  a: [number, number],
  b: [number, number],
  count: number,
  markLength: number,
  spacing: number
): Array<[[number, number], [number, number], [number, number]]> {
  const tangent = normalizeVec([b[0] - a[0], b[1] - a[1]]);
  const normal: [number, number] = [-tangent[1], tangent[0]];
  const mid = segmentMidpoint(a, b);
  const marks: Array<[[number, number], [number, number], [number, number]]> = [];
  for (let i = 0; i < count; i++) {
    const offset = (i - (count - 1) / 2) * spacing;
    const center: [number, number] = [mid[0] + tangent[0] * offset, mid[1] + tangent[1] * offset];
    const half = markLength / 2;
    const height = markLength * 0.42;
    marks.push([
      [center[0] - tangent[0] * half + normal[0] * height, center[1] - tangent[1] * half + normal[1] * height],
      center,
      [center[0] + tangent[0] * half + normal[0] * height, center[1] + tangent[1] * half + normal[1] * height],
    ]);
  }
  return marks;
}

function buildSegmentTickMarks(
  a: [number, number],
  b: [number, number],
  count: number,
  tickLength: number,
  spacing: number
): Array<[[number, number], [number, number]]> {
  const tangent = normalizeVec([b[0] - a[0], b[1] - a[1]]);
  const normal: [number, number] = [-tangent[1], tangent[0]];
  const slashDir = normalizeVec([normal[0] + tangent[0] * 0.45, normal[1] + tangent[1] * 0.45]);
  const mid: [number, number] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const marks: Array<[[number, number], [number, number]]> = [];
  for (let i = 0; i < count; i++) {
    const offset = (i - (count - 1) / 2) * spacing;
    const center: [number, number] = [mid[0] + tangent[0] * offset, mid[1] + tangent[1] * offset];
    const half = tickLength / 2;
    marks.push([
      [center[0] - slashDir[0] * half, center[1] - slashDir[1] * half],
      [center[0] + slashDir[0] * half, center[1] + slashDir[1] * half],
    ]);
  }
  return marks;
}

function segmentLabelPosition(a: [number, number], b: [number, number], offset: number): [number, number] {
  const tangent = normalizeVec([b[0] - a[0], b[1] - a[1]]);
  const normal: [number, number] = [-tangent[1], tangent[0]];
  return [(a[0] + b[0]) / 2 + normal[0] * offset, (a[1] + b[1]) / 2 + normal[1] * offset];
}

function buildAngleArcPoints(
  from: [number, number],
  at: [number, number],
  to: [number, number],
  radius: number
): [number, number][] {
  const a1 = Math.atan2(from[1] - at[1], from[0] - at[0]);
  const a2 = Math.atan2(to[1] - at[1], to[0] - at[0]);
  let delta = a2 - a1;
  while (delta <= -Math.PI) delta += Math.PI * 2;
  while (delta > Math.PI) delta -= Math.PI * 2;
  const steps = 20;
  const pts: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const a = a1 + delta * t;
    pts.push([at[0] + radius * Math.cos(a), at[1] + radius * Math.sin(a)]);
  }
  return pts;
}

function buildRightAngleMarker(
  from: [number, number],
  at: [number, number],
  to: [number, number],
  radius: number
): [number, number][] {
  const u1 = normalizeVec([from[0] - at[0], from[1] - at[1]]);
  const u2 = normalizeVec([to[0] - at[0], to[1] - at[1]]);
  const p1: [number, number] = [at[0] + u1[0] * radius, at[1] + u1[1] * radius];
  const p2: [number, number] = [p1[0] + u2[0] * radius, p1[1] + u2[1] * radius];
  const p3: [number, number] = [at[0] + u2[0] * radius, at[1] + u2[1] * radius];
  return [p1, p2, p3];
}

function computeAngleMeasureDeg(from: [number, number], at: [number, number], to: [number, number]): number {
  const a1 = Math.atan2(from[1] - at[1], from[0] - at[0]);
  const a2 = Math.atan2(to[1] - at[1], to[0] - at[0]);
  let delta = Math.abs(a2 - a1);
  while (delta > Math.PI * 2) delta -= Math.PI * 2;
  if (delta > Math.PI) delta = Math.PI * 2 - delta;
  return (delta * 180) / Math.PI;
}

function angleLabelPosition(
  from: [number, number],
  at: [number, number],
  to: [number, number],
  radius: number
): [number, number] {
  const u1 = normalizeVec([from[0] - at[0], from[1] - at[1]]);
  const u2 = normalizeVec([to[0] - at[0], to[1] - at[1]]);
  const bis = normalizeVec([u1[0] + u2[0], u1[1] + u2[1]]);
  return [at[0] + bis[0] * radius, at[1] + bis[1] * radius];
}

/** Build JSXGraph functiongraph curves for a function intent. */
function renderFunction(board: Board, intent: FunctionIntent, chalk: string, accent: string) {
  const [x0, x1] = intent.domainX;
  const sampleCount = clampSampleCount(intent.sampling?.samples);
  const visibleExpressions = intent.expressions.filter((expr) => expr.visible !== false);
  const compiled = new Map<string, (x: number) => number>();
  const curves = new Map<string, GeometryElement>();

  visibleExpressions.forEach((expr, i) => {
    const color = expr.color ?? (i === 0 ? accent : SERIES_PALETTE[(i - 1) % SERIES_PALETTE.length]);
    try {
      const fn = compileExpression(expr.expression);
      compiled.set(expr.id, fn);
      const curve = board.create("functiongraph", [(x: number) => fn(x), x0, x1], {
        strokeColor: color,
        strokeWidth: 2.2,
        highlight: false,
        opacity: 0.95,
        dash: 0,
      }) as GeometryElement;
      curves.set(expr.id, curve);
      if (expr.label) {
        const xLabel = x0 + (x1 - x0) * 0.82;
        const yLabel = fn(xLabel);
        if (isFinite(yLabel)) {
          board.create("text", [xLabel, yLabel, expr.label], {
            fontSize: 12,
            color: chalk,
            opacity: 0.85,
            cssStyle: "font-family: monospace",
            anchorX: "left",
          } as LabelAttrs);
        }
      }
    } catch {
      /* malformed expression — skip this curve; the rest still render */
    }
  });

  renderFunctionAxesLabels(board, intent, chalk);
  renderFunctionLegend(board, visibleExpressions, accent, chalk, intent.showLegend);
  renderFunctionAnnotations(board, intent, compiled, curves, chalk, accent, sampleCount);
}

function renderFunctionAxesLabels(board: Board, intent: FunctionIntent, chalk: string) {
  const box = board.getBoundingBox() as [number, number, number, number];
  const [xMin, yMax, xMax, yMin] = box;
  const xSpan = xMax - xMin;
  const ySpan = yMax - yMin;
  if (intent.xLabel) {
    const x = xMax - xSpan * 0.05;
    const y = yMin + ySpan * 0.06;
    board.create("text", [x, y, intent.xLabel], {
      fontSize: 12,
      color: chalk,
      opacity: 0.82,
      cssStyle: "font-family: monospace",
      anchorX: "right",
    } as LabelAttrs);
  }
  if (intent.yLabel) {
    const x = xMin + xSpan * 0.04;
    const y = yMax - ySpan * 0.05;
    board.create("text", [x, y, intent.yLabel], {
      fontSize: 12,
      color: chalk,
      opacity: 0.82,
      cssStyle: "font-family: monospace",
      anchorX: "left",
    } as LabelAttrs);
  }
}

function renderFunctionLegend(
  board: Board,
  expressions: FunctionIntent["expressions"],
  accent: string,
  chalk: string,
  showLegend: boolean | undefined = undefined
) {
  if (showLegend === false || expressions.length === 0) return;
  const labeled = expressions.filter((expr) => expr.label);
  if (labeled.length === 0) return;
  if (showLegend !== true && labeled.length < 2) return;
  const box = board.getBoundingBox() as [number, number, number, number];
  const [xMin, yMax, xMax, yMin] = box;
  const xSpan = xMax - xMin;
  const ySpan = yMax - yMin;
  const x0 = xMin + xSpan * 0.05;
  const y0 = yMax - ySpan * 0.08;
  labeled.forEach((expr, i) => {
    const color = expr.color ?? (i === 0 ? accent : SERIES_PALETTE[(i - 1) % SERIES_PALETTE.length]);
    const y = y0 - i * ySpan * 0.08;
    board.create("segment", [[x0, y], [x0 + xSpan * 0.05, y]], {
      strokeColor: color,
      strokeWidth: 2.2,
      highlight: false,
      fixed: true,
    });
    board.create("text", [x0 + xSpan * 0.065, y, expr.label ?? expr.id], {
      fontSize: 12,
      color: chalk,
      opacity: 0.85,
      cssStyle: "font-family: monospace",
      anchorX: "left",
    } as LabelAttrs);
  });
}

function renderFunctionAnnotations(
  board: Board,
  intent: FunctionIntent,
  compiled: Map<string, (x: number) => number>,
  curves: Map<string, GeometryElement>,
  chalk: string,
  accent: string,
  sampleCount: number
) {
  if (!intent.annotations || intent.annotations.length === 0) return;
  const [xMin, xMax] = intent.domainX;
  const box = board.getBoundingBox() as [number, number, number, number];
  const ySpan = box[1] - box[3];

  for (const ann of intent.annotations) {
    switch (ann.kind) {
      case "point": {
        const fn = ann.y === undefined ? compiled.values().next().value as ((x: number) => number) | undefined : undefined;
        const y = ann.y ?? fn?.(ann.x);
        if (y === undefined || !Number.isFinite(y)) break;
        createFunctionMarker(board, ann.x, y, ann.label ?? ann.labelLatex, chalk, accent);
        break;
      }
      case "root": {
        const fn = compiled.get(ann.expressionId);
        if (!fn) break;
        const root = findRoot(fn, xMin, xMax, sampleCount, ann.nearX);
        if (root == null) break;
        createFunctionMarker(board, root, 0, ann.label ?? "root", chalk, accent);
        break;
      }
      case "extremum": {
        const fn = compiled.get(ann.expressionId);
        if (!fn) break;
        const x = findExtremum(fn, xMin, xMax, sampleCount, ann.nearX);
        if (x == null) break;
        const y = fn(x);
        if (!isFinite(y)) break;
        createFunctionMarker(board, x, y, ann.label ?? "extremum", chalk, accent);
        break;
      }
      case "intersection": {
        const fnA = compiled.get(ann.expressionIds[0]);
        const fnB = compiled.get(ann.expressionIds[1]);
        if (!fnA || !fnB) break;
        const x = findRoot((u) => fnA(u) - fnB(u), xMin, xMax, sampleCount, ann.nearX);
        if (x == null) break;
        const y = fnA(x);
        if (!isFinite(y)) break;
        createFunctionMarker(board, x, y, ann.label ?? "intersection", chalk, accent);
        break;
      }
      case "tangent": {
        const fn = compiled.get(ann.expressionId);
        if (!fn) break;
        const y = fn(ann.atX);
        const slope = derivativeAt(fn, ann.atX, xMax - xMin);
        if (!isFinite(y) || !isFinite(slope)) break;
        const dx = (xMax - xMin) * 0.25;
        board.create("line", [[ann.atX - dx, y - slope * dx], [ann.atX + dx, y + slope * dx]], {
          strokeColor: accent,
          strokeWidth: 1.6,
          dash: 2,
          highlight: false,
          fixed: true,
          opacity: 0.9,
        });
        createFunctionMarker(board, ann.atX, y, ann.label ?? "tangent", chalk, accent);
        break;
      }
      case "area": {
        const curve = curves.get(ann.expressionId);
        if (!curve) break;
        try {
          board.create("integral", [[ann.fromX, ann.toX], curve], {
            fillColor: accent,
            fillOpacity: 0.16,
            strokeColor: accent,
            strokeWidth: 1.2,
            highlight: false,
            axis: "x",
          });
          if (ann.label) {
            const midX = (ann.fromX + ann.toX) / 2;
            const fn = compiled.get(ann.expressionId);
            const y = fn ? fn(midX) : 0;
            if (isFinite(y)) {
              board.create("text", [midX, y + ySpan * 0.06, ann.label], {
                fontSize: 12,
                color: chalk,
                opacity: 0.85,
                cssStyle: "font-family: monospace",
              } as LabelAttrs);
            }
          }
        } catch {
          /* integral optional */
        }
        break;
      }
      case "asymptote": {
        if (ann.orientation === "vertical") {
          board.create("line", [[ann.value, box[1]], [ann.value, box[3]]], {
            strokeColor: chalk,
            strokeWidth: 1.4,
            dash: 2,
            highlight: false,
            fixed: true,
            opacity: 0.75,
          });
          if (ann.label) board.create("text", [ann.value, box[1] - ySpan * 0.06, ann.label], { fontSize: 12, color: chalk, opacity: 0.85, cssStyle: "font-family: monospace" } as LabelAttrs);
        } else {
          board.create("line", [[box[0], ann.value], [box[2], ann.value]], {
            strokeColor: chalk,
            strokeWidth: 1.4,
            dash: 2,
            highlight: false,
            fixed: true,
            opacity: 0.75,
          });
          if (ann.label) board.create("text", [box[2] - (box[2] - box[0]) * 0.05, ann.value, ann.label], { fontSize: 12, color: chalk, opacity: 0.85, cssStyle: "font-family: monospace", anchorX: "right" } as LabelAttrs);
        }
        break;
      }
    }
  }
}

function createFunctionMarker(board: Board, x: number, y: number, label: string | undefined, chalk: string, accent: string) {
  board.create("point", [x, y], {
    name: "",
    size: 3,
    fillColor: accent,
    strokeColor: chalk,
    strokeWidth: 1.2,
    fixed: true,
    highlight: false,
    showInfobox: false,
  });
  if (label) {
    board.create("text", [x + 0.15, y + 0.15, label], {
      fontSize: 12,
      color: chalk,
      opacity: 0.85,
      cssStyle: "font-family: monospace",
    } as LabelAttrs);
  }
}

function clampSampleCount(samples: number | undefined): number {
  return Math.max(32, Math.min(2048, Math.round(samples ?? 256)));
}

function sampleDomain(xMin: number, xMax: number, samples: number): number[] {
  if (samples <= 1) return [xMin, xMax];
  const xs: number[] = [];
  for (let i = 0; i <= samples; i++) xs.push(xMin + ((xMax - xMin) * i) / samples);
  return xs;
}

function findRoot(fn: (x: number) => number, xMin: number, xMax: number, samples: number, nearX?: number): number | null {
  const xs = sampleDomain(xMin, xMax, samples);
  const candidates: number[] = [];
  let prevX = xs[0];
  let prevY = fn(prevX);
  for (let i = 1; i < xs.length; i++) {
    const x = xs[i];
    const y = fn(x);
    if (isFinite(prevY) && Math.abs(prevY) < 1e-7) candidates.push(prevX);
    if (isFinite(prevY) && isFinite(y) && prevY * y < 0) {
      const root = bisectRoot(fn, prevX, x);
      if (root != null) candidates.push(root);
    }
    prevX = x;
    prevY = y;
  }
  return chooseNearest(candidates, nearX, (xMin + xMax) / 2);
}

function bisectRoot(fn: (x: number) => number, a: number, b: number): number | null {
  let left = a;
  let right = b;
  let fLeft = fn(left);
  let fRight = fn(right);
  if (!isFinite(fLeft) || !isFinite(fRight)) return null;
  if (fLeft === 0) return left;
  if (fRight === 0) return right;
  if (fLeft * fRight > 0) return null;
  for (let i = 0; i < 40; i++) {
    const mid = (left + right) / 2;
    const fMid = fn(mid);
    if (!isFinite(fMid)) return null;
    if (Math.abs(fMid) < 1e-8) return mid;
    if (fLeft * fMid <= 0) {
      right = mid;
      fRight = fMid;
    } else {
      left = mid;
      fLeft = fMid;
    }
  }
  return (left + right) / 2;
}

function derivativeAt(fn: (x: number) => number, x: number, span: number): number {
  const h = Math.max(1e-4, span * 1e-4);
  const y1 = fn(x - h);
  const y2 = fn(x + h);
  if (!isFinite(y1) || !isFinite(y2)) return NaN;
  return (y2 - y1) / (2 * h);
}

function findExtremum(fn: (x: number) => number, xMin: number, xMax: number, samples: number, nearX?: number): number | null {
  const deriv = (x: number) => derivativeAt(fn, x, xMax - xMin);
  return findRoot(deriv, xMin, xMax, Math.max(64, Math.round(samples / 2)), nearX);
}

function chooseNearest(values: number[], near: number | undefined, fallback: number): number | null {
  if (values.length === 0) return null;
  const target = near ?? fallback;
  let best = values[0];
  let dist = Math.abs(best - target);
  for (const value of values.slice(1)) {
    const nextDist = Math.abs(value - target);
    if (nextDist < dist) {
      best = value;
      dist = nextDist;
    }
  }
  return best;
}

function compileScopedExpression(expr: string, variables: string[]): (scope: Record<string, number>) => number {
  const node = MATH.parse(expr);
  if (!validateMathNode(node, new Set(variables))) {
    throw new Error("unsupported math expression");
  }
  const compiled = node.compile();
  return (scope: Record<string, number>) => {
    const raw = compiled.evaluate({ ...scope, e: Math.E, pi: Math.PI });
    const y = coerceMathNumber(raw);
    return typeof y === "number" && isFinite(y) ? y : NaN;
  };
}

function getSamplingCount(value: number | undefined, fallback: number): number {
  return Math.max(4, Math.min(200, Math.round(value ?? fallback)));
}

export const GRAPH3D_MESH_VERTEX_BUDGET = 36_000;
export const GRAPH3D_VECTOR_BUDGET = 512;

/**
 * Allocate one aggregate sampling budget across a 3D intent. Large model-
 * generated requests are scaled in both dimensions, preserving aspect ratio,
 * rather than allowing every mesh to consume the per-mesh ceiling.
 */
export function getGraph3DSamplingPlan(intent: Graph3DIntent): [number, number, number][] {
  const plan: [number, number, number][] = intent.surfaces.map((item) => {
    switch (item.kind) {
      case 'surface':
        return [getSamplingCount(intent.sampling?.xSteps, 40), getSamplingCount(intent.sampling?.ySteps, 40), 1];
      case 'parametric_surface':
        return [getSamplingCount(intent.sampling?.uSteps, 28), getSamplingCount(intent.sampling?.vSteps, 28), 1];
      case 'parametric_curve':
        return [getSamplingCount(intent.sampling?.tSteps, 160), 1, 1];
      case 'vector_field':
        return [
          Math.min(8, getSamplingCount(intent.sampling?.xSteps, 5)),
          Math.min(8, getSamplingCount(intent.sampling?.ySteps, 5)),
          Math.min(8, getSamplingCount(intent.sampling?.tSteps, 5)),
        ];
      default:
        return [1, 1, 1];
    }
  });

  const meshIndexes = intent.surfaces
    .map((item, index) => item.kind === 'surface' || item.kind === 'parametric_surface' ? index : -1)
    .filter((index) => index >= 0);
  // Mesh builders include both endpoints, so N steps allocate N + 1 vertices.
  const countMeshVertices = () => meshIndexes.reduce(
    (sum, index) => sum + (plan[index][0] + 1) * (plan[index][1] + 1),
    0
  );
  let requestedMeshVertices = countMeshVertices();
  while (requestedMeshVertices > GRAPH3D_MESH_VERTEX_BUDGET) {
    const scale = Math.sqrt(GRAPH3D_MESH_VERTEX_BUDGET / requestedMeshVertices);
    for (const index of meshIndexes) {
      plan[index] = [Math.max(4, Math.floor(plan[index][0] * scale)), Math.max(4, Math.floor(plan[index][1] * scale)), 1];
    }
    const nextCount = countMeshVertices();
    // The minimum plan is far below the budget, but guard against a rounding
    // fixed point so this defensive planner can never loop indefinitely.
    if (nextCount >= requestedMeshVertices) {
      const index = meshIndexes.reduce((largest, candidate) =>
        plan[candidate][0] * plan[candidate][1] > plan[largest][0] * plan[largest][1] ? candidate : largest
      );
      if (plan[index][0] >= plan[index][1] && plan[index][0] > 4) plan[index][0] -= 1;
      else if (plan[index][1] > 4) plan[index][1] -= 1;
    }
    requestedMeshVertices = countMeshVertices();
  }

  const vectorIndexes = intent.surfaces
    .map((item, index) => item.kind === 'vector_field' ? index : -1)
    .filter((index) => index >= 0);
  const requestedVectors = vectorIndexes.reduce((sum, index) => sum + plan[index][0] * plan[index][1] * plan[index][2], 0);
  if (requestedVectors > GRAPH3D_VECTOR_BUDGET) {
    const scale = Math.cbrt(GRAPH3D_VECTOR_BUDGET / requestedVectors);
    for (const index of vectorIndexes) {
      plan[index] = [
        Math.max(2, Math.floor(plan[index][0] * scale)),
        Math.max(2, Math.floor(plan[index][1] * scale)),
        Math.max(2, Math.floor(plan[index][2] * scale)),
      ];
    }
  }

  return plan;
}

async function loadRDKitModule() {
  if (!rdkitModulePromise) {
    rdkitModulePromise = new Promise((resolve, reject) => {
      const init = (window as Window & { initRDKitModule?: (options?: { locateFile?: () => string }) => Promise<any> }).initRDKitModule;
      const boot = () => {
        const loader = (window as Window & { initRDKitModule?: (options?: { locateFile?: () => string }) => Promise<any> }).initRDKitModule;
        if (!loader) {
          reject(new Error('RDKit loader unavailable'));
          return;
        }
        loader({ locateFile: () => rdkitWasmUrl }).then(resolve, reject);
      };
      if (init) {
        boot();
        return;
      }
      const script = document.createElement('script');
      script.src = rdkitJsUrl;
      script.async = true;
      script.onload = () => boot();
      script.onerror = () => reject(new Error('Failed to load RDKit script'));
      document.head.appendChild(script);
    });
  }
  return rdkitModulePromise;
}

function themeRDKitSvg(svg: string, chalk: string, accent: string): string {
  return svg
    .replace(/#FFFFFF/gi, 'transparent')
    .replace(/fill:white/gi, 'fill:transparent')
    .replace(/stroke:#000000/gi, `stroke:${chalk}`)
    .replace(/fill:#000000/gi, `fill:${chalk}`)
    .replace(/stroke:black/gi, `stroke:${chalk}`)
    .replace(/fill:black/gi, `fill:${chalk}`)
    .replace(/stroke:#FF7F7F/gi, `stroke:${accent}`)
    .replace(/fill:#FF7F7F/gi, `fill:${accent}`);
}

function resolveChemistryPreset(name: string | undefined) {
  if (!name) return null;
  const normalized = name.trim().toLowerCase();
  const direct = CHEMISTRY_STRUCTURE_PRESETS[normalized];
  if (direct) return direct;

  const counts = inferChemistryElementCounts(name);
  if (!counts) return null;
  const signature = Object.entries(counts)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([el, count]) => `${el}:${count}`)
    .join('|');
  const presetKey = CHEMISTRY_PRESET_SIGNATURES[signature];
  return presetKey ? CHEMISTRY_STRUCTURE_PRESETS[presetKey] : null;
}

function inferChemistryElementCounts(input: string): Record<string, number> | null {
  const cleaned = input.replace(/[\[\]\(\)\-\s]/g, '');
  const matches = [...cleaned.matchAll(/([A-Z][a-z]?)(\d*)/g)];
  if (matches.length === 0) return null;
  const counts: Record<string, number> = {};
  for (const match of matches) {
    const element = match[1];
    const count = match[2] ? Number(match[2]) : 1;
    if (!Number.isFinite(count) || count <= 0) return null;
    counts[element] = (counts[element] ?? 0) + count;
  }
  return counts;
}

function fitScienceBox(points: [number, number][]): { xMin: number; xMax: number; yMin: number; yMax: number } {
  if (points.length === 0) return { xMin: -1, xMax: 7, yMin: -1, yMax: 5 };
  let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity;
  for (const [x, y] of points) {
    xMin = Math.min(xMin, x); xMax = Math.max(xMax, x);
    yMin = Math.min(yMin, y); yMax = Math.max(yMax, y);
  }
  const pad = Math.max((xMax - xMin) * 0.18, (yMax - yMin) * 0.18, 0.8);
  return { xMin: xMin - pad, xMax: xMax + pad, yMin: yMin - pad, yMax: yMax + pad };
}

function scienceSurfaceMetrics(box: { xMin: number; xMax: number; yMin: number; yMax: number }, scale: number) {
  const width = Math.max(1e-6, box.xMax - box.xMin);
  const height = Math.max(1e-6, box.yMax - box.yMin);
  const hostHeight = Math.round(Math.max(220, Math.min(420, 260 * Math.max(0.8, Math.min(scale, 1.25)) * (height / width + 0.5))));
  return {
    viewBox: `${box.xMin} ${-box.yMax} ${width} ${height}`,
    hostHeight,
    toSvg: ([x, y]: [number, number]): [number, number] => [x, -y],
  };
}

function viewBoxNumber(viewBox: string, index: number): number {
  return Number(viewBox.split(" ")[index] ?? 0);
}
function viewBoxWidth(viewBox: string): number { return viewBoxNumber(viewBox, 2); }
function viewBoxHeight(viewBox: string): number { return viewBoxNumber(viewBox, 3); }
function viewBoxCenterX(viewBox: string): number { return viewBoxNumber(viewBox, 0) + viewBoxWidth(viewBox) / 2; }
function viewBoxCenterY(viewBox: string): number { return viewBoxNumber(viewBox, 1) + viewBoxHeight(viewBox) / 2; }

function ScienceText({ x, y, text, color, center = false }: { x: number; y: number; text: string; color: string; center?: boolean }) {
  return <text x={x} y={y} fill={color} opacity={0.85} fontFamily="monospace" fontSize={0.34} textAnchor={center ? "middle" : "start"}>{text}</text>;
}

function Arrow({ x1, y1, x2, y2, color, width }: { x1: number; y1: number; x2: number; y2: number; color: string; width: number }) {
  return <g><line x1={x1} y1={y1} x2={x2} y2={y2} stroke={color} strokeWidth={width} />{renderArrowHead([x1, y1], [x2, y2], color, width)}</g>;
}

function ArrowHead({ from, to, color }: { from: [number, number]; to: [number, number]; color: string }) {
  return <>{renderArrowHead(from, to, color, 0.07)}</>;
}

function renderArrowHead(from: [number, number], to: [number, number], color: string, width: number) {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len;
  const px = -uy, py = ux;
  const size = width * 6;
  const p1: [number, number] = [to[0] - ux * size + px * size * 0.45, to[1] - uy * size + py * size * 0.45];
  const p2: [number, number] = [to[0] - ux * size - px * size * 0.45, to[1] - uy * size - py * size * 0.45];
  return <polygon points={`${to[0]},${to[1]} ${p1[0]},${p1[1]} ${p2[0]},${p2[1]}`} fill={color} />;
}

function renderBond(key: string, a: [number, number], b: [number, number], order: 1 | 2 | 3, toSvg: (p: [number, number]) => [number, number], chalk: string) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len, ny = dx / len;
  const offsets = order === 1 ? [0] : order === 2 ? [-0.08, 0.08] : [-0.16, 0, 0.16];
  return <g key={key}>{offsets.map((off, i) => {
    const p1 = toSvg([a[0] + nx * off, a[1] + ny * off]);
    const p2 = toSvg([b[0] + nx * off, b[1] + ny * off]);
    return <line key={i} x1={p1[0]} y1={p1[1]} x2={p2[0]} y2={p2[1]} stroke={chalk} strokeWidth={0.08} />;
  })}</g>;
}

function renderDnaBackdrop(viewBox: string, accent: string) {
  const x0 = viewBoxNumber(viewBox, 0);
  const y0 = viewBoxNumber(viewBox, 1);
  const w = viewBoxWidth(viewBox);
  const h = viewBoxHeight(viewBox);
  const left: string[] = [];
  const right: string[] = [];
  const rungs = [] as React.ReactNode[];
  for (let i = 0; i <= 12; i++) {
    const t = i / 12;
    const y = y0 + h * t;
    const cx = x0 + w * 0.5;
    const amp = w * 0.08;
    const phase = t * Math.PI * 3;
    const lx = cx - w * 0.12 + Math.sin(phase) * amp;
    const rx = cx + w * 0.12 - Math.sin(phase) * amp;
    left.push(`${lx},${y}`);
    right.push(`${rx},${y}`);
    rungs.push(<line key={i} x1={lx} y1={y} x2={rx} y2={y} stroke={accent} strokeOpacity={0.45} strokeWidth={0.05} />);
  }
  return <g><polyline points={left.join(" ")} fill="none" stroke={accent} strokeOpacity={0.7} strokeWidth={0.08} /> <polyline points={right.join(" ")} fill="none" stroke={accent} strokeOpacity={0.7} strokeWidth={0.08} /> {rungs}</g>;
}

function renderCircuitComponent(component: CircuitIntent["components"][number], nodeMap: Map<string, [number, number]>, toSvg: (p: [number, number]) => [number, number], chalk: string, accent: string) {
  const labelNode = (x: number, y: number, label?: string) => label ? <ScienceText x={x + 0.18} y={y - 0.18} text={label} color={chalk} /> : null;
  if (component.kind === "ground") {
    const at = nodeMap.get(component.at);
    if (!at) return null;
    const [x, y] = toSvg(at);
    return <g key={component.id}><line x1={x} y1={y} x2={x} y2={y + 0.25} stroke={chalk} strokeWidth={0.08} /><line x1={x - 0.25} y1={y + 0.25} x2={x + 0.25} y2={y + 0.25} stroke={chalk} strokeWidth={0.08} /><line x1={x - 0.17} y1={y + 0.35} x2={x + 0.17} y2={y + 0.35} stroke={chalk} strokeWidth={0.08} /><line x1={x - 0.09} y1={y + 0.45} x2={x + 0.09} y2={y + 0.45} stroke={chalk} strokeWidth={0.08} />{labelNode(x, y, component.label)}</g>;
  }
  const a = nodeMap.get(component.between[0]);
  const b = nodeMap.get(component.between[1]);
  if (!a || !b) return null;
  const [x1, y1] = toSvg(a);
  const [x2, y2] = toSvg(b);
  const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len;
  const px = -uy, py = ux;
  switch (component.kind) {
    case "battery":
      return <g key={component.id}><line x1={mx - ux * 0.12 - px * 0.22} y1={my - uy * 0.12 - py * 0.22} x2={mx - ux * 0.12 + px * 0.22} y2={my - uy * 0.12 + py * 0.22} stroke={accent} strokeWidth={0.08} /><line x1={mx + ux * 0.12 - px * 0.34} y1={my + uy * 0.12 - py * 0.34} x2={mx + ux * 0.12 + px * 0.34} y2={my + uy * 0.12 + py * 0.34} stroke={accent} strokeWidth={0.08} />{labelNode(mx, my, component.label)}</g>;
    case "resistor": {
      const pts = [-0.36, -0.2, -0.04, 0.12, 0.28].map((t, i) => [mx + ux * t + px * (i % 2 === 0 ? -0.16 : 0.16), my + uy * t + py * (i % 2 === 0 ? -0.16 : 0.16)] as [number, number]);
      return <g key={component.id}><polyline points={pts.map((p) => p.join(",")).join(" ")} fill="none" stroke={accent} strokeWidth={0.08} />{labelNode(mx, my, component.label)}</g>;
    }
    case "capacitor":
      return <g key={component.id}><line x1={mx - ux * 0.14 - px * 0.24} y1={my - uy * 0.14 - py * 0.24} x2={mx - ux * 0.14 + px * 0.24} y2={my - uy * 0.14 + py * 0.24} stroke={accent} strokeWidth={0.08} /><line x1={mx + ux * 0.14 - px * 0.24} y1={my + uy * 0.14 - py * 0.24} x2={mx + ux * 0.14 + px * 0.24} y2={my + uy * 0.14 + py * 0.24} stroke={accent} strokeWidth={0.08} />{labelNode(mx, my, component.label)}</g>;
    case "inductor": {
      const circles = [ -0.24, -0.08, 0.08, 0.24 ].map((t, i) => <circle key={i} cx={mx + ux * t} cy={my + uy * t} r={0.11} fill="none" stroke={accent} strokeWidth={0.06} />);
      return <g key={component.id}>{circles}{labelNode(mx, my, component.label)}</g>;
    }
    case "lamp":
      return <g key={component.id}><circle cx={mx} cy={my} r={0.28} fill="none" stroke={accent} strokeWidth={0.08} /><line x1={mx - 0.2} y1={my - 0.2} x2={mx + 0.2} y2={my + 0.2} stroke={accent} strokeWidth={0.06} /><line x1={mx - 0.2} y1={my + 0.2} x2={mx + 0.2} y2={my - 0.2} stroke={accent} strokeWidth={0.06} />{labelNode(mx, my, component.label)}</g>;
    case "switch": {
      const closed = component.closed === true;
      return <g key={component.id}><line x1={mx - ux * 0.24} y1={my - uy * 0.24} x2={mx - ux * 0.04} y2={my - uy * 0.04} stroke={accent} strokeWidth={0.08} /><line x1={mx + ux * 0.24} y1={my + uy * 0.24} x2={closed ? mx - ux * 0.04 : mx + ux * 0.06} y2={closed ? my - uy * 0.04 : my + uy * 0.12} stroke={accent} strokeWidth={0.08} />{labelNode(mx, my, component.label)}</g>;
    }
  }
}

function renderPhysicsDecoration(
  decoration: NonNullable<PhysicsIntent['decorations']>[number],
  bodyById: Map<string, { at: [number, number] }>,
  toSvg: (p: [number, number]) => [number, number],
  chalk: string,
  accent: string
) {
  const resolvePoint = (value: [number, number] | string): [number, number] | null => Array.isArray(value) ? value : bodyById.get(value)?.at ?? null;
  switch (decoration.kind) {
    case 'ground': {
      const [x1, y1] = toSvg([decoration.fromX, decoration.y]);
      const [x2, y2] = toSvg([decoration.toX, decoration.y]);
      const marks = [] as React.ReactNode[];
      for (let i = 0; i < 8; i++) {
        const x = x1 + ((x2 - x1) * i) / 7;
        marks.push(<line key={i} x1={x} y1={y1} x2={x - 0.18} y2={y1 + 0.18} stroke={chalk} strokeWidth={0.05} />);
      }
      return <g key={decoration.id}><line x1={x1} y1={y1} x2={x2} y2={y2} stroke={chalk} strokeWidth={0.08} />{marks}</g>;
    }
    case 'incline': {
      const a = decoration.base;
      const b: [number, number] = [decoration.base[0] + decoration.dx, decoration.base[1] + decoration.dy];
      const [x1, y1] = toSvg(a);
      const [x2, y2] = toSvg(b);
      return <g key={decoration.id}><line x1={x1} y1={y1} x2={x2} y2={y2} stroke={chalk} strokeWidth={0.08} />{decoration.label ? <ScienceText x={x2 + 0.2} y={y2 - 0.2} text={decoration.label} color={chalk} /> : null}</g>;
    }
    case 'spring': {
      const a = resolvePoint(decoration.from);
      const b = resolvePoint(decoration.to);
      if (!a || !b) return null;
      const [x1, y1] = toSvg(a);
      const [x2, y2] = toSvg(b);
      const pts: string[] = [];
      for (let i = 0; i <= 8; i++) {
        const t = i / 8;
        const x = x1 + (x2 - x1) * t;
        const y = y1 + (y2 - y1) * t + (i === 0 || i === 8 ? 0 : (i % 2 === 0 ? -0.18 : 0.18));
        pts.push(`${x},${y}`);
      }
      return <g key={decoration.id}><polyline points={pts.join(' ')} fill="none" stroke={accent} strokeWidth={0.07} />{decoration.label ? <ScienceText x={(x1+x2)/2 + 0.2} y={(y1+y2)/2 - 0.2} text={decoration.label} color={chalk} /> : null}</g>;
    }
    case 'pivot': {
      const a = resolvePoint(decoration.at);
      if (!a) return null;
      const [x, y] = toSvg(a);
      return <g key={decoration.id}><polygon points={`${x},${y} ${x-0.26},${y+0.38} ${x+0.26},${y+0.38}`} fill="rgba(255,255,255,0.03)" stroke={chalk} strokeWidth={0.07} />{decoration.label ? <ScienceText x={x + 0.3} y={y - 0.18} text={decoration.label} color={chalk} /> : null}</g>;
    }
    case 'axis': {
      const [x1, y1] = toSvg(decoration.from);
      const [x2, y2] = toSvg(decoration.to);
      return <g key={decoration.id}><Arrow x1={x1} y1={y1} x2={x2} y2={y2} color={chalk} width={0.06} />{decoration.label ? <ScienceText x={x2 + 0.2} y={y2 - 0.2} text={decoration.label} color={chalk} /> : null}</g>;
    }
  }
}

function buildAxisLine(start: THREE.Vector3, end: THREE.Vector3, color: THREE.Color): THREE.Line {
  const geometry = new THREE.BufferGeometry().setFromPoints([start, end]);
  const material = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.75 });
  return new THREE.Line(geometry, material);
}

function buildTextSprite(text: string, color: string, position: THREE.Vector3): THREE.Sprite {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 96;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = color;
    ctx.font = "28px monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, canvas.width / 2, canvas.height / 2);
  }
  const texture = new THREE.CanvasTexture(canvas);
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true });
  const sprite = new THREE.Sprite(material);
  sprite.position.copy(position);
  sprite.scale.set(1.4, 0.5, 1);
  return sprite;
}

function buildSurfaceMesh(
  xDomain: [number, number],
  yDomain: [number, number],
  xSteps: number,
  ySteps: number,
  zAt: (x: number, y: number) => number,
  color: THREE.Color,
  opacity: number,
  renderMode: "surface" | "wireframe" | "points"
): THREE.Object3D | null {
  const positions: number[] = [];
  const indices: number[] = [];
  for (let iy = 0; iy <= ySteps; iy++) {
    const y = yDomain[0] + ((yDomain[1] - yDomain[0]) * iy) / ySteps;
    for (let ix = 0; ix <= xSteps; ix++) {
      const x = xDomain[0] + ((xDomain[1] - xDomain[0]) * ix) / xSteps;
      const z = zAt(x, y);
      positions.push(x, isFinite(z) ? z : NaN, y);
    }
  }
  for (let iy = 0; iy < ySteps; iy++) {
    for (let ix = 0; ix < xSteps; ix++) {
      const a = iy * (xSteps + 1) + ix;
      const b = a + 1;
      const c = a + (xSteps + 1);
      const d = c + 1;
      if (quadFinite(positions, a, b, c, d)) {
        indices.push(a, c, b, b, c, d);
      }
    }
  }
  if (indices.length === 0) return null;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return materializeGraph3DGeometry(geometry, color, opacity, renderMode);
}

function buildParametricSurfaceMesh(
  uDomain: [number, number],
  vDomain: [number, number],
  uSteps: number,
  vSteps: number,
  xyzAt: (u: number, v: number) => [number, number, number],
  color: THREE.Color,
  opacity: number,
  renderMode: "surface" | "wireframe" | "points"
): THREE.Object3D | null {
  const positions: number[] = [];
  const indices: number[] = [];
  for (let iv = 0; iv <= vSteps; iv++) {
    const v = vDomain[0] + ((vDomain[1] - vDomain[0]) * iv) / vSteps;
    for (let iu = 0; iu <= uSteps; iu++) {
      const u = uDomain[0] + ((uDomain[1] - uDomain[0]) * iu) / uSteps;
      const [x, y, z] = xyzAt(u, v);
      positions.push(x, y, z);
    }
  }
  for (let iv = 0; iv < vSteps; iv++) {
    for (let iu = 0; iu < uSteps; iu++) {
      const a = iv * (uSteps + 1) + iu;
      const b = a + 1;
      const c = a + (uSteps + 1);
      const d = c + 1;
      if (quadFinite(positions, a, b, c, d)) {
        indices.push(a, c, b, b, c, d);
      }
    }
  }
  if (indices.length === 0) return null;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return materializeGraph3DGeometry(geometry, color, opacity, renderMode);
}

function buildCurve3D(
  tDomain: [number, number],
  tSteps: number,
  xyzAt: (t: number) => [number, number, number],
  color: THREE.Color
): THREE.Line | null {
  const points: THREE.Vector3[] = [];
  for (let i = 0; i <= tSteps; i++) {
    const t = tDomain[0] + ((tDomain[1] - tDomain[0]) * i) / tSteps;
    const [x, y, z] = xyzAt(t);
    if ([x, y, z].every((n) => isFinite(n))) points.push(new THREE.Vector3(x, y, z));
  }
  if (points.length < 2) return null;
  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  const material = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.95 });
  return new THREE.Line(geometry, material);
}

function buildPoint3D(at: [number, number, number], color: THREE.Color, label: string | undefined, chalk: string): THREE.Group {
  const group = new THREE.Group();
  const sphere = new THREE.Mesh(
    new THREE.SphereGeometry(0.12, 16, 12),
    new THREE.MeshStandardMaterial({ color, metalness: 0.08, roughness: 0.7 })
  );
  sphere.position.set(at[0], at[1], at[2]);
  group.add(sphere);
  if (label) {
    const sprite = buildTextSprite(label, chalk, new THREE.Vector3(at[0] + 0.18, at[1] + 0.18, at[2]));
    sprite.scale.set(0.9, 0.32, 1);
    group.add(sprite);
  }
  return group;
}

function buildPointCloud(points: [number, number, number][], color: THREE.Color): THREE.Points | null {
  if (points.length === 0) return null;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(points.flat(), 3));
  const material = new THREE.PointsMaterial({ color, size: 0.12, sizeAttenuation: true });
  return new THREE.Points(geometry, material);
}

function buildVectorField3D(
  xDomain: [number, number],
  yDomain: [number, number],
  zDomain: [number, number],
  xSteps: number,
  ySteps: number,
  zSteps: number,
  vectorAt: (x: number, y: number, z: number) => [number, number, number],
  color: THREE.Color
): THREE.Group | null {
  const group = new THREE.Group();
  const xCount = Math.max(2, Math.min(8, xSteps));
  const yCount = Math.max(2, Math.min(8, ySteps));
  const zCount = Math.max(2, Math.min(8, zSteps));
  for (let iz = 0; iz < zCount; iz++) {
    const z = zDomain[0] + ((zDomain[1] - zDomain[0]) * iz) / Math.max(1, zCount - 1);
    for (let iy = 0; iy < yCount; iy++) {
      const y = yDomain[0] + ((yDomain[1] - yDomain[0]) * iy) / Math.max(1, yCount - 1);
      for (let ix = 0; ix < xCount; ix++) {
        const x = xDomain[0] + ((xDomain[1] - xDomain[0]) * ix) / Math.max(1, xCount - 1);
        const [vx, vy, vz] = vectorAt(x, y, z);
        const dir = new THREE.Vector3(vx, vy, vz);
        const len = dir.length();
        if (!isFinite(len) || len < 1e-6) continue;
        dir.normalize();
        const arrow = new THREE.ArrowHelper(dir, new THREE.Vector3(x, y, z), Math.min(len * 0.35, 1.4), color, 0.18, 0.1);
        group.add(arrow);
      }
    }
  }
  return group.children.length > 0 ? group : null;
}

function quadFinite(positions: number[], a: number, b: number, c: number, d: number): boolean {
  for (const idx of [a, b, c, d]) {
    const off = idx * 3;
    if (!isFinite(positions[off]) || !isFinite(positions[off + 1]) || !isFinite(positions[off + 2])) return false;
  }
  return true;
}

function materializeGraph3DGeometry(
  geometry: THREE.BufferGeometry,
  color: THREE.Color,
  opacity: number,
  renderMode: "surface" | "wireframe" | "points"
): THREE.Object3D {
  if (renderMode === "points") {
    return new THREE.Points(geometry, new THREE.PointsMaterial({ color, size: 0.08, sizeAttenuation: true }));
  }
  if (renderMode === "wireframe") {
    return new THREE.LineSegments(
      new THREE.WireframeGeometry(geometry),
      new THREE.LineBasicMaterial({ color, transparent: true, opacity: Math.max(0.28, opacity) })
    );
  }
  const group = new THREE.Group();
  group.add(
    new THREE.Mesh(
      geometry,
      new THREE.MeshStandardMaterial({
        color,
        transparent: true,
        opacity,
        side: THREE.DoubleSide,
        metalness: 0.08,
        roughness: 0.75,
      })
    )
  );
  group.add(
    new THREE.LineSegments(
      new THREE.WireframeGeometry(geometry),
      new THREE.LineBasicMaterial({
        color: color.clone().lerp(new THREE.Color('#ffffff'), 0.35),
        transparent: true,
        opacity: 0.42,
      })
    )
  );
  return group;
}

function estimateFunctionRange(intent: FunctionIntent): [number, number] | null {
  const [xMin, xMax] = intent.domainX;
  const samples = clampSampleCount(intent.sampling?.samples);
  const ys: number[] = [];
  for (const expr of intent.expressions) {
    if (expr.visible === false) continue;
    const fn = compileExpression(expr.expression);
    for (const x of sampleDomain(xMin, xMax, samples)) {
      const y = fn(x);
      if (isFinite(y)) ys.push(y);
    }
  }
  for (const ann of intent.annotations ?? []) {
    if (ann.kind === "point" && ann.y !== undefined && isFinite(ann.y)) ys.push(ann.y);
    if (ann.kind === "asymptote" && ann.orientation === "horizontal" && isFinite(ann.value)) ys.push(ann.value);
  }
  if (ys.length === 0) return null;
  let yMin = Math.min(...ys);
  let yMax = Math.max(...ys);
  if (yMin === yMax) {
    yMin -= 1;
    yMax += 1;
  }
  return [yMin, yMax];
}

/**
 * Compile a learner-facing math expression (e.g. "x^2 - 2*x + 1", "sin(x)",
 * "2x^2 - 1") into a numeric function with NO dynamic code generation — no
 * `eval`, no `Function` constructor. We first use the approved math.js stack
 * with a tight whitelist of supported symbols/functions, then fall back to the
 * legacy parser for backward compatibility if needed.
 *
 * Exported for unit testing of the pure parse/eval path (no JSXGraph needed).
 */
export function compileExpression(expr: string): (x: number) => number {
  try {
    const scoped = compileScopedExpression(expr, ["x"]);
    return (x: number) => {
      try {
        return scoped({ x });
      } catch {
        return NaN;
      }
    };
  } catch {
    let ast: Ast | null = null;
    try {
      ast = parseExpression(expr);
    } catch {
      return () => NaN;
    }
    const fns: Record<string, (u: number) => number> = {
      sin: Math.sin, cos: Math.cos, tan: Math.tan,
      sqrt: (u) => (u < 0 ? NaN : Math.sqrt(u)),
      abs: Math.abs, log: (u) => (u <= 0 ? NaN : Math.log(u)),
      exp: Math.exp,
    };
    return (x: number) => {
      try {
        const y = evalAst(ast, x, fns);
        return typeof y === "number" && isFinite(y) ? y : NaN;
      } catch {
        return NaN;
      }
    };
  }
}

function validateMathNode(node: MathNode, variables: Set<string> = new Set(["x"])): boolean {
  const n = node as MathNode & {
    type: string;
    op?: string;
    fn?: { name?: string };
    name?: string;
    args?: MathNode[];
    content?: MathNode;
    items?: MathNode[];
    implicit?: boolean;
    forEach?: (cb: (child: MathNode) => void) => void;
  };

  switch (n.type) {
    case "ConstantNode":
      return true;
    case "SymbolNode": {
      const name = n.name ?? "";
      return variables.has(name) || ALLOWED_MATH_CONSTANT_SYMBOLS.has(name);
    }
    case "OperatorNode":
      if (!n.op || !["+", "-", "*", "/", "^"].includes(n.op)) return false;
      break;
    case "ParenthesisNode":
      return n.content ? validateMathNode(n.content, variables) : true;
    case "FunctionNode": {
      const name = n.fn?.name ?? "";
      if (!ALLOWED_MATH_FUNCTIONS.has(name)) return false;
      return (n.args ?? []).every((arg) => validateMathNode(arg, variables));
    }
    case "ArrayNode":
      return (n.items ?? []).every((item) => validateMathNode(item, variables));
    default:
      return false;
  }

  let valid = true;
  n.forEach?.((child) => {
    if (!validateMathNode(child, variables)) valid = false;
  });
  return valid;
}

function coerceMathNumber(value: unknown): number {
  if (typeof value === "number") return value;
  if (value && typeof value === "object") {
    const complex = value as { re?: number; im?: number; toNumber?: () => number };
    if (typeof complex.re === "number" && typeof complex.im === "number") {
      return Math.abs(complex.im) < 1e-12 ? complex.re : NaN;
    }
    if (typeof complex.toNumber === "function") {
      return complex.toNumber();
    }
  }
  return Number(value);
}

type Ast =
  | { t: "num"; v: number }
  | { t: "var" }
  | { t: "const"; v: number }
  | { t: "neg"; x: Ast }
  | { t: "bin"; op: "+" | "-" | "*" | "/" | "^"; l: Ast; r: Ast }
  | { t: "call"; name: string; arg: Ast };

const FN_NAMES = new Set(["sin", "cos", "tan", "sqrt", "abs", "log", "exp"]);

function evalAst(ast: Ast, x: number, fns: Record<string, (u: number) => number>): number {
  switch (ast.t) {
    case "num": return ast.v;
    case "var": return x;
    case "const": return ast.v;
    case "neg": return -evalAst(ast.x, x, fns);
    case "call": {
      const fn = fns[ast.name];
      if (!fn) throw new Error("unknown fn");
      return fn(evalAst(ast.arg, x, fns));
    }
    case "bin": {
      const l = evalAst(ast.l, x, fns);
      if (ast.op === "^") {
        const r = evalAst(ast.r, x, fns);
        return Math.pow(l, r);
      }
      const r = evalAst(ast.r, x, fns);
      switch (ast.op) {
        case "+": return l + r;
        case "-": return l - r;
        case "*": return l * r;
        case "/": return r === 0 ? NaN : l / r;
      }
    }
  }
}

/* ── Tokenizer ── */
type Tok =
  | { k: "num"; v: number }
  | { k: "x" }
  | { k: "id"; v: string }
  | { k: "op"; v: string }
  | { k: "lp" }
  | { k: "rp" }
  | { k: "end" };

function tokenize(src: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === " " || c === "\t") { i++; continue; }
    if (c >= "0" && c <= "9" || (c === "." && src[i + 1] >= "0" && src[i + 1] <= "9")) {
      let j = i + 1;
      while (j < src.length && ((src[j] >= "0" && src[j] <= "9") || src[j] === ".")) j++;
      // scientific notation: e[+|-]digits
      if (src[j] === "e" || src[j] === "E") {
        let k = j + 1;
        if (src[k] === "+" || src[k] === "-") k++;
        if (src[k] >= "0" && src[k] <= "9") {
          while (k < src.length && src[k] >= "0" && src[k] <= "9") k++;
          j = k;
        }
      }
      toks.push({ k: "num", v: parseFloat(src.slice(i, j)) });
      i = j;
      continue;
    }
    if (c === "x" || c === "X") { toks.push({ k: "x" }); i++; continue; }
    if (c >= "a" && c <= "z" || c >= "A" && c <= "Z") {
      let j = i + 1;
      while (j < src.length && ((src[j] >= "a" && src[j] <= "z") || (src[j] >= "A" && src[j] <= "Z") || src[j] === "_")) j++;
      toks.push({ k: "id", v: src.slice(i, j).toLowerCase() });
      i = j;
      continue;
    }
    if ("+-*/^".includes(c)) { toks.push({ k: "op", v: c }); i++; continue; }
    if (c === "(") { toks.push({ k: "lp" }); i++; continue; }
    if (c === ")") { toks.push({ k: "rp" }); i++; continue; }
    // anything else (commas, etc.) — unsupported, bail later
    throw new Error("unsupported char: " + c);
  }
  toks.push({ k: "end" });
  return toks;
}

/* ── Recursive-descent parser ── */
function parseExpression(src: string): Ast {
  const toks = tokenize(src.replace(/\s+/g, ""));
  let pos = 0;
  const peek = () => toks[pos];
  const next = () => toks[pos++];

  function parseExpr(): Ast {
    let node = parseTerm();
    while (true) {
      const t = peek();
      if (t.k === "op" && (t.v === "+" || t.v === "-")) { next(); node = { t: "bin", op: t.v, l: node, r: parseTerm() }; }
      else break;
    }
    return node;
  }
  function parseTerm(): Ast {
    let node = parseFactorOrUnary();
    while (true) {
      const t = peek();
      if (t.k === "op" && (t.v === "*" || t.v === "/")) { next(); node = { t: "bin", op: t.v, l: node, r: parseFactorOrUnary() }; }
      else if (t.k === "x" || t.k === "num" || t.k === "id" || t.k === "lp") {
        // implicit multiplication: "2x", "3sin(x)", "(a)(b)"
        node = { t: "bin", op: "*", l: node, r: parseImplicit() };
      }
      else break;
    }
    return node;
  }
  function parseImplicit(): Ast {
    // RHS of an implicit multiply: parse a single factor (with power+unary),
    // not a full term, so "2x^2" parses as 2*(x^2) and chains stop naturally.
    return parseFactorOrUnary();
  }
  function parseFactorOrUnary(): Ast {
    const t = peek();
    if (t.k === "op" && (t.v === "+" || t.v === "-")) {
      next();
      return { t: "neg" as const, x: parseFactorOrUnary() };
    }
    return parsePower();
  }
  function isOp(tok: Tok, v: string): boolean {
    return tok.k === "op" && tok.v === v;
  }
  function parsePower(): Ast {
    const base = parsePrimary();
    if (isOp(peek(), "^")) {
      next();
      // exponent: right-associative, may be unary (e.g. x^-2)
      const exp = parseFactorOrUnary();
      return { t: "bin" as const, op: "^" as const, l: base, r: exp };
    }
    return base;
  }
  function parsePrimary(): Ast {
    const t = next();
    if (t.k === "num") return { t: "num" as const, v: t.v };
    if (t.k === "x") return { t: "var" as const };
    if (t.k === "id") {
      // constants
      if (t.v === "pi") return { t: "const" as const, v: Math.PI };
      if (t.v === "e") return { t: "const" as const, v: Math.E };
      // functions
      if (FN_NAMES.has(t.v)) {
        if (peek().k !== "lp") throw new Error("expected ( after " + t.v);
        next(); // consume (
        const arg = parseExpr();
        if (peek().k !== "rp") throw new Error("expected )");
        next();
        return { t: "call" as const, name: t.v, arg };
      }
      throw new Error("unknown id: " + t.v);
    }
    if (t.k === "lp") {
      const inner = parseExpr();
      if (peek().k !== "rp") throw new Error("expected )");
      next();
      return inner;
    }
    throw new Error("unexpected token");
  }

  const result = parseExpr();
  if (peek().k !== "end") throw new Error("trailing tokens");
  return result;
}

/* ── Host sizing ──
   JSXGraph sizes its SVG to the host box. Geometry boards run with
   `keepaspectratio: true`, so if the host's aspect ratio does not match the
   bbox's the board letterboxes (and with a fixed-width + overflow-hidden host,
   wide bboxes get clipped). We drive the geometry host's height from the
   measured width × (bboxH / bboxW) so the figure always fills its box and is
   never cropped. Function boards run keepaspectratio:false and stretched to
   any box, so they keep the scale-derived height. */

function BoardHost({
  hostRef,
  isGeometry,
  intent,
  seedPositions,
  heightPx,
  title,
  disableBoardPan = false,
}: {
  hostRef: React.RefObject<HTMLDivElement | null>;
  isGeometry: boolean;
  intent: VisualizationIntent;
  seedPositions: Record<string, [number, number]>;
  heightPx: number;
  title?: string;
  disableBoardPan?: boolean;
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [widthPx, setWidthPx] = useState(0);
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const ro = new ResizeObserver(() => setWidthPx(wrap.clientWidth));
    ro.observe(wrap);
    setWidthPx(wrap.clientWidth);
    return () => ro.disconnect();
  }, []);

  const bbox = useMemo(
    () => computeBoundingBox(intent, { pointPositions: seedPositions }),
    [intent, seedPositions]
  );
  const [xMin, yMax, xMax, yMin] = bbox;
  const bboxW = Math.max(1e-6, xMax - xMin);
  const bboxH = Math.max(1e-6, yMax - yMin);
  const aspect = bboxH / bboxW;

  // Keep diagrams compact while preserving enough height for labels and angle
  // arcs. The board's actual bounding box is still aspect-fitted on every
  // resize, so a clamp can add whitespace but cannot crop the figure.
  const rawGeoHeight = widthPx > 0 ? Math.round(widthPx * aspect) : heightPx;
  const geoHeight = Math.max(150, Math.min(420, rawGeoHeight));
  const hostHeight = isGeometry ? geoHeight : heightPx;
  const hostWidth = "100%";

  return (
    <figure className="m-0 w-full" data-nopan={disableBoardPan ? "true" : undefined} style={{ width: "100%", maxWidth: "100%" }}>
      <div ref={wrapRef} className="w-full">
        <div
          ref={hostRef}
          className="jsxcell rounded border"
          style={{
            width: hostWidth,
            height: hostHeight,
            borderColor: disableBoardPan ? 'rgba(255,255,255,0.12)' : 'transparent',
            background: disableBoardPan ? 'rgba(0,0,0,0.06)' : 'transparent',
          }}
        />
      </div>
      {title && <figcaption className="mt-1 text-[13px] opacity-70">{title}</figcaption>}
    </figure>
  );
}

/**
 * Expand a figure box symmetrically until its aspect ratio exactly matches the
 * container's, so a `keepaspectratio` fit becomes an identity — the entire
 * figure is always visible, centred, with square units and no cropping.
 *
 * JSXGraph's own `keepaspectratio` reconciliation picks a "dominating interval"
 * based on both the container and the box; when the two disagree it can scale
 * the figure so parts fall outside the viewport. Matching the aspect ourselves
 * removes that decision entirely. We only ever GROW the box, never shrink it,
 * so nothing that was inside can be pushed out.
 *
 * Exported for unit testing (pure math, no JSXGraph needed).
 */
export function fitBoxToAspect(
  box: [number, number, number, number],
  containerW: number,
  containerH: number
): [number, number, number, number] {
  const [xMin, yMax, xMax, yMin] = box;
  if (!(containerW > 0) || !(containerH > 0)) return box;

  const w = xMax - xMin;
  const h = yMax - yMin;
  if (!(w > 0) || !(h > 0)) return box;

  const containerAspect = containerH / containerW; // user-units per unit width
  const boxAspect = h / w;

  const cx = (xMin + xMax) / 2;
  const cy = (yMin + yMax) / 2;

  if (boxAspect > containerAspect) {
    // Figure is taller than the container's shape → widen the box.
    const newW = h / containerAspect;
    return [cx - newW / 2, yMax, cx + newW / 2, yMin];
  }
  // Figure is wider than the container's shape → heighten the box.
  const newH = w * containerAspect;
  return [xMin, cy + newH / 2, xMax, cy - newH / 2];
}

/* Compute a JSXGraph bounding box from the intent (geometry viewport or function domain).
   Exported for unit testing of the pure geometry-extent math (no JSXGraph needed). */
export function computeBoundingBox(intent: VisualizationIntent, state?: VisualizationState): [number, number, number, number] {
  if (intent.type === "geometry") {
    const extent = geometryExtent(intent, state);

    // Geometry viewports are intentionally ignored.
    //
    // In practice the model uses them as a pseudo-canvas rectangle, which is
    // exactly what produced the reported "half-covered" diagrams: a circle or
    // triangle would be technically inside a much larger viewport, leaving lots
    // of dead space and making the real figure sit awkwardly in only part of
    // the block. That oversized rectangle also captured mouse interaction over
    // empty space. The current rule is simple: auto-fit to the measured figure
    // itself and let the learner drag the actual objects, not a model-guessed
    // viewport.
    if (!extent) return [-5, 5, 5, -5];
    const { xMin, xMax, yMin, yMax } = padExtent(extent);
    return [xMin, yMax, xMax, yMin];
  }
  if (intent.type === "function") {
    const [x0, x1] = intent.domainX;
    let yMin: number, yMax: number;
    if (intent.rangeY) {
      [yMin, yMax] = intent.rangeY;
    } else {
      const sampled = estimateFunctionRange(intent);
      if (sampled) {
        [yMin, yMax] = sampled;
      } else {
        yMin = -5;
        yMax = 5;
      }
    }
    if (yMin >= yMax) { yMin = -5; yMax = 5; }
    // Keep curve strokes, grid, and labels inside the visible graph while
    // preserving the requested domain/range as the central plotting region.
    const pad = Math.max(0.18, (x1 - x0) * 0.1, (yMax - yMin) * 0.12);
    return [x0 - pad, yMax + pad, x1 + pad, yMin - pad];
  }
  return [-5, 5, 5, -5];
}

interface Extent { xMin: number; xMax: number; yMin: number; yMax: number; }

/** Add scale-relative breathing room around a geometry footprint.
 *
 *  The margin is uniform in user units (derived from the larger span) rather
 *  than per-axis: geometry boards keep square units, so a uniform user-unit
 *  margin is a uniform pixel margin on every side. It is also purely
 *  proportional — the old `Math.max(1, …)` floor meant a 0.4-unit triangle got
 *  a ±1 margin and shrank to a speck, while a 40-unit figure got the same
 *  relative treatment. We keep it proportional but slightly more generous than
 *  before so circle rims, polygon strokes, and nearby labels have reliable
 *  breathing room at the frame edge. */
function padExtent(extent: Extent): Extent {
  const spanX = extent.xMax - extent.xMin;
  const spanY = extent.yMax - extent.yMin;
  const span = Math.max(spanX, spanY);
  const pad = span > 0 ? span * 0.22 : 0.5;
  let { xMin, xMax, yMin, yMax } = extent;
  xMin -= pad; xMax += pad; yMin -= pad; yMax += pad;
  if (xMin === xMax) { xMin -= 0.5; xMax += 0.5; }
  if (yMin === yMax) { yMin -= 0.5; yMax += 0.5; }
  return { xMin, xMax, yMin, yMax };
}

/**
 * True bounding extent of a geometry figure — the union of EVERY object's
 * footprint, not just the declared points. A circle reaches `radius` in all
 * directions from its center; a `through`-defined circle's radius is the
 * distance from its center to the through-point. Segments/lines/polygons are
 * bounded by their endpoints (already points), and free text carries its own
 * coordinate. Without this the bbox was point-only, so a circle whose rim
 * extends past its center point (the common case) got cropped — exactly the
 * clipped half-circle in the reported figure.
 */
function geometryExtent(intent: GeometryIntent, state?: VisualizationState): Extent | null {
  const coordOf = (o: Extract<GeometryObject, { kind: "point" }>): [number, number] =>
    state?.pointPositions?.[o.id] ?? o.at;

  // Resolve any referenced point (by id) to its live/declared coordinate.
  const pointCoord = (id: string): [number, number] | null => {
    const p = intent.objects.find(
      (o): o is Extract<GeometryObject, { kind: "point" }> => o.kind === "point" && o.id === id
    );
    return p ? coordOf(p) : null;
  };

  let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity;
  let seen = false;
  const include = (x: number, y: number) => {
    if (!isFinite(x) || !isFinite(y)) return;
    xMin = Math.min(xMin, x); xMax = Math.max(xMax, x);
    yMin = Math.min(yMin, y); yMax = Math.max(yMax, y);
    seen = true;
  };

  for (const obj of intent.objects) {
    switch (obj.kind) {
      case "point":
        include(coordOf(obj)[0], coordOf(obj)[1]);
        break;
      case "text": {
        include(obj.at[0], obj.at[1]);
        break;
      }
      case "circle": {
        const center = pointCoord(obj.center);
        if (!center) break;
        let r: number | null = null;
        if (typeof obj.radius === "number") {
          r = Math.abs(obj.radius);
        } else if (obj.through) {
          const t = pointCoord(obj.through);
          if (t) r = Math.hypot(t[0] - center[0], t[1] - center[1]);
        }
        if (r != null && isFinite(r)) {
          // The rim reaches r in every direction — this is the box the figure
          // actually occupies, and what was missing before.
          include(center[0] - r, center[1] - r);
          include(center[0] + r, center[1] + r);
        } else {
          include(center[0], center[1]);
        }
        break;
      }
      case "segment": {
        const a = pointCoord(obj.from);
        const b = pointCoord(obj.to);
        if (a && b && (obj.label || obj.labelLatex)) {
          const labelAt = segmentLabelPosition(a, b, Math.max(0.42, Math.hypot(b[0] - a[0], b[1] - a[1]) * 0.12));
          include(labelAt[0], labelAt[1]);
        }
        break;
      }
      case "angle": {
        // Angle markers and labels can reach past the raw rays/vertex on a
        // small figure, so include their notation footprint or it gets clipped.
        const vertex = pointCoord(obj.at);
        const from = pointCoord(obj.from);
        const to = pointCoord(obj.to);
        const radius = obj.radius ?? ANGLE_ARC_RADIUS;
        if (vertex) {
          include(vertex[0] - radius, vertex[1] - radius);
          include(vertex[0] + radius, vertex[1] + radius);
        }
        if (vertex && from && to && (obj.label || obj.labelLatex || obj.showMeasure)) {
          const labelAt = angleLabelPosition(from, vertex, to, radius * ((obj.marker ?? "arc") === "right_angle" ? 1.8 : 1.45));
          include(labelAt[0], labelAt[1]);
        }
        break;
      }
      case "notation": {
        switch (obj.variant) {
          case "segment":
          case "midpoint": {
            const a = pointCoord(obj.from);
            const b = pointCoord(obj.to);
            if (a && b && (obj.label || obj.labelLatex)) {
              const labelAt = segmentLabelPosition(a, b, Math.max(obj.variant === "midpoint" ? 0.52 : 0.42, Math.hypot(b[0] - a[0], b[1] - a[1]) * (obj.variant === "midpoint" ? 0.15 : 0.12)));
              include(labelAt[0], labelAt[1]);
            }
            if (a && b && obj.variant === "segment") {
              const mid = segmentMidpoint(a, b);
              include(mid[0], mid[1]);
            }
            break;
          }
          case "angle": {
            const vertex = pointCoord(obj.at);
            const from = pointCoord(obj.from);
            const to = pointCoord(obj.to);
            const radius = obj.radius ?? ANGLE_ARC_RADIUS;
            if (vertex) {
              include(vertex[0] - radius, vertex[1] - radius);
              include(vertex[0] + radius, vertex[1] + radius);
            }
            if (vertex && from && to && (obj.label || obj.labelLatex || obj.showMeasure)) {
              const labelAt = angleLabelPosition(from, vertex, to, radius * ((obj.marker ?? "arc") === "right_angle" ? 1.8 : 1.45));
              include(labelAt[0], labelAt[1]);
            }
            break;
          }
          case "parallel": {
            const a = pointCoord(obj.from);
            const b = pointCoord(obj.to);
            if (a && b) {
              const mid = segmentMidpoint(a, b);
              include(mid[0], mid[1]);
            }
            break;
          }
          case "perpendicular": {
            const at = pointCoord(obj.at);
            const arm1 = pointCoord(obj.arm1);
            const arm2 = pointCoord(obj.arm2);
            const size = obj.size ?? ANGLE_ARC_RADIUS;
            if (at) {
              include(at[0] - size, at[1] - size);
              include(at[0] + size, at[1] + size);
            }
            if (at && arm1 && arm2 && (obj.label || obj.labelLatex)) {
              const labelAt = angleLabelPosition(arm1, at, arm2, size * 1.9);
              include(labelAt[0], labelAt[1]);
            }
            break;
          }
          case "bisector": {
            const at = pointCoord(obj.at);
            const from = pointCoord(obj.from);
            const to = pointCoord(obj.to);
            const radius = obj.radius ?? ANGLE_ARC_RADIUS * 0.82;
            if (at) {
              include(at[0] - radius, at[1] - radius);
              include(at[0] + radius, at[1] + radius);
            }
            if (at && from && to && (obj.label || obj.labelLatex)) {
              const labelAt = angleLabelPosition(from, at, to, radius * 1.8);
              include(labelAt[0], labelAt[1]);
            }
            break;
          }
        }
        break;
      }
      // line/segment/polygon/label are bounded by the points they reference,
      // which are included in the point pass above. (A `line` is drawn
      // infinite, but it exits through the frame edge by construction — it can
      // never be "missing" the way a bounded object can.)
      default:
        break;
    }
  }

  if (!seen) return null;
  return { xMin, xMax, yMin, yMax };
}

/* ───────────────────────── KaTeX (equation) ───────────────────────── */

function EquationSurface({
  intent,
  chalk,
  accent,
  scale,
  caption,
}: {
  intent: Extract<VisualizationIntent, { type: "equation" }>;
  chalk: string;
  accent: string;
  scale: number;
  caption?: string;
}) {
  const html = useMemo(() => renderMath(intent.latex, true, {}).html, [intent.latex]);
  return (
    <figure className="m-0 max-w-[420px]">
      <div
        className="katex-chalk rounded-lg border px-4 py-3"
        style={{ borderColor: `${accent}55`, fontSize: 26 * Math.max(0.7, Math.min(scale, 1.3)), color: chalk }}
        dangerouslySetInnerHTML={{ __html: html }}
      />
      {caption && <figcaption className="mt-1 text-[13px] opacity-70">{caption}</figcaption>}
    </figure>
  );
}

/* ───────────────────────── Honest unsupported card ───────────────────────── */

function UnsupportedCard({ reason, chalk, accent, caption }: { reason: string; chalk: string; accent: string; caption?: string }) {
  return (
    <figure className="m-0 max-w-[420px]">
      <div className="rounded-lg border-2 border-dashed px-4 py-3" style={{ borderColor: `${accent}66`, color: chalk }}>
        <div className="flex items-center gap-2 text-[13px] opacity-80">
          <span aria-hidden>∿</span>
          <span>{reason}</span>
        </div>
      </div>
      {caption && <figcaption className="mt-1 text-[13px] opacity-70">{caption}</figcaption>}
    </figure>
  );
}
