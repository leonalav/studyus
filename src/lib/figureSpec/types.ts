/**
 * High-level figure vocabulary.
 *
 * Every figure the agent (or the OCR pipeline, see `ocrInfer.ts`) emits is a
 * value of `FigureSpec`. A `FigureSpec` is a *concept*: a unit circle at θ,
 * a secant between x₀ and x₁, a right triangle with given sides. It is NOT
 * a list of SVG primitives — that is what `compile()` produces.
 *
 * The compile target is `AnimationScene` from `lib/widgets/types.ts`. The
 * existing chalkboard `SceneFigure` renderer in `WidgetSurface.tsx` already
 * consumes that shape, so a `figureSpec` widget renders with no new render
 * path: `compile()` returns a `SceneSpec`, the surface forwards it to the
 * same renderer the `animation` widget uses for its scene frame.
 *
 * Why a separate vocabulary at all? `scene` (the low-level primitive list)
 * is correct for an animation that needs minute control, but it is the wrong
 * level of abstraction for a textbook figure. The agent does not want to
 * reason about "(radius = 0.9) * cos(theta) on the unit circle", it wants
 * to reason about "unit circle at θ = π/6 with sin/cos labelled". `FigureSpec`
 * is the bridge.
 */

import type { SceneAccent, SceneLineStyle } from "../widgets/types";

/* ── Bounds ── */

/** Mirror of the visualizer's coord bounds. Anything outside [-COORD_MAX,
 *  COORD_MAX] is silently nonsensical in a figure. The validator (see
 *  `lib/widgets/validate.ts`) enforces these same numbers on the wire. */
export const COORD_MAX = 1e6;
/** Mirror of `MAX_EXPRESSION_LENGTH` in `lib/widgets/validate.ts`. A figure
 *  expression longer than this is almost certainly a prompt-injection attempt
 *  or a mistake, not a textbook formula. */
export const MAX_FIGURE_EXPRESSION = 200;
/** Hard cap on per-kind element count, mirroring `MAX_SCENE_ELEMENTS = 24`.
 *  Each per-kind compiler must self-check and refuse to emit past this. */
export const MAX_FIGURE_ELEMENTS = 24;
/** Cap on the number of points/coords/etc. that the agent can declare
 *  declaratively inside a spec (e.g. coordinatePlane, flowchart nodes). */
export const MAX_FIGURE_DECLARED = 12;

export type FigureKind = FigureSpec["kind"];

export const FIGURE_KINDS = [
  "unitCircle",
  "trigGraph",
  "parabola",
  "polynomialGraph",
  "secantTangent",
  "limitGraph",
  "shadedArea",
  "vector",
  "rightTriangle",
  "coordinatePlane",
  "flowchart",
  "freeBodyDiagram",
] as const satisfies readonly FigureKind[];

/* ── The union ── */

export type FigureSpec =
  | UnitCircleSpec
  | TrigGraphSpec
  | ParabolaSpec
  | PolynomialGraphSpec
  | SecantTangentSpec
  | LimitGraphSpec
  | ShadedAreaSpec
  | VectorSpec
  | RightTriangleSpec
  | CoordinatePlaneSpec
  | FlowchartSpec
  | FreeBodyDiagramSpec;

export interface UnitCircleSpec {
  kind: "unitCircle";
  /** Angle in radians. The compile handles the wrap; -2π to 2π is the
   *  practical sweet spot — anything beyond is most likely a mistake. */
  theta: number;
  /** Whether to draw the radius from origin to the point on the circle. */
  showRadius?: boolean;
  showSin?: boolean;
  showCos?: boolean;
  showTan?: boolean;
  /** Whether to label the angle "θ". */
  showLabels?: boolean;
  /** Display window for the picture. Defaults to [-1.4, 1.4] in both axes. */
  domainX?: [number, number];
  domainY?: [number, number];
  accent?: SceneAccent;
}

export type TrigFunction = "sin" | "cos" | "tan" | "csc" | "sec" | "cot";

export interface TrigGraphSpec {
  kind: "trigGraph";
  function: TrigFunction;
  /** Domain the curve is sampled over, in radians. */
  domainX: [number, number];
  /** Optional Y bounds — when omitted the renderer picks by the function's range. */
  rangeY?: [number, number];
  /** Mark zeros, extrema, asymptotes with point primitives. */
  showKeyPoints?: boolean;
  showLabels?: boolean;
  accent?: SceneAccent;
}

export interface ParabolaSpec {
  kind: "parabola";
  /** (h, k) — vertex coordinates. */
  vertex: [number, number];
  /** Direction the parabola opens. */
  opens: "up" | "down" | "left" | "right";
  /** |a| in y = a(x-h)²+k (or its horizontal twin). Defaults to 1. */
  scale?: number;
  showFocusDirectrix?: boolean;
  domainX?: [number, number];
  domainY?: [number, number];
  accent?: SceneAccent;
}

export interface PolynomialGraphSpec {
  kind: "polynomialGraph";
  /** The polynomial, parsed as an expression in `x`. e.g. "x^3 - 4*x". */
  expressionLatex: string;
  domainX: [number, number];
  rangeY?: [number, number];
  showRoots?: boolean;
  showVertex?: boolean;
  accent?: SceneAccent;
}

export interface SecantTangentSpec {
  kind: "secantTangent";
  /** The function, parsed as an expression in `x`. e.g. "x^2 + 1". */
  fLatex: string;
  /** First sample of the secant. */
  x0: number;
  /** Second sample of the secant. */
  x1: number;
  /** Where the tangent line is drawn. Defaults to (x0 + x1) / 2. */
  tangentAt?: number;
  /** Width of x around each sample, in data units, to draw the secant. */
  domainPad?: number;
  rangeY?: [number, number];
  showLabels?: boolean;
  accent?: SceneAccent;
}

export interface LimitGraphSpec {
  kind: "limitGraph";
  fLatex: string;
  /** The x where the limit is being taken. */
  limitPoint: number;
  /** One-sided arrows approaching the limit from the left and/or right. */
  leftArrow?: boolean;
  rightArrow?: boolean;
  /** Domain to plot on, as [limitPoint - pad, limitPoint + pad]. Defaults to
   *  a symmetric pad of 2. */
  domainPad?: number;
  rangeY?: [number, number];
  showLabels?: boolean;
  accent?: SceneAccent;
}

export interface ShadedAreaSpec {
  kind: "shadedArea";
  fLatex: string;
  fromX: number;
  toX: number;
  /** Baseline each region rises from. Defaults to 0. */
  baseY?: number;
  domainPad?: number;
  rangeY?: [number, number];
  showLabels?: boolean;
  accent?: SceneAccent;
}

export interface VectorSpec {
  kind: "vector";
  origin: [number, number];
  tip: [number, number];
  /** Free-text label rendered beside the arrow. */
  label?: string;
  /** Optional KaTeX label, used when `label` is omitted. */
  labelLatex?: string;
  accent?: SceneAccent;
  style?: SceneLineStyle;
}

export interface RightTriangleSpec {
  kind: "rightTriangle";
  /** Adjacent leg length (runs along the +x axis from origin). */
  adjacent: number;
  /** Opposite leg length (rises along the +y axis). */
  opposite: number;
  /** Show the sin/cos/tan ratio labels. */
  showRatios?: boolean;
  /** Angle at the origin, in radians, to label as "θ". Defaults to
   *  atan2(opposite, adjacent). */
  thetaLabel?: boolean;
  accent?: SceneAccent;
}

export interface CoordinatePlaneSpec {
  kind: "coordinatePlane";
  points: Array<{ x: number; y: number; label?: string; labelLatex?: string }>;
  xRange: [number, number];
  yRange: [number, number];
  showOrigin?: boolean;
  showLabels?: boolean;
  accent?: SceneAccent;
}

export interface FlowchartSpec {
  kind: "flowchart";
  nodes: Array<{ id: string; label: string; x: number; y: number }>;
  edges: Array<{ from: string; to: string; label?: string; directed?: boolean }>;
  showLabels?: boolean;
  accent?: SceneAccent;
}

export interface FreeBodyDiagramSpec {
  kind: "freeBodyDiagram";
  body: "block" | "sphere";
  /** Width of the body, in scene units. */
  width?: number;
  /** Height of the body, in scene units. */
  height?: number;
  forces: Array<{
    magnitude: number;
    angleDeg: number;
    label?: string;
  }>;
  /** The fixed centre of the body. Defaults to (0, 0). */
  at?: [number, number];
  showLabels?: boolean;
  accent?: SceneAccent;
}