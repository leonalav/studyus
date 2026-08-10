/**
 * Renderer-agnostic visualization intent protocol.
 *
 * The tutor agent emits semantic visualization intents; a router selects the
 * appropriate rendering engine (JSXGraph, KaTeX, etc.) without the LLM knowing
 * which library is used.
 */

/* ── Core Intent Union ── */

export type VisualizationIntent =
  | GeometryIntent
  | FunctionIntent
  | ChartIntent
  | EquationIntent
  | DiagramIntent
  | CircuitIntent
  | ChemistryIntent
  | GraphTheoryIntent;

/* ── Geometry ── */

export interface GeometryIntent {
  type: "geometry";
  title?: string;
  viewport?: {
    xMin: number;
    xMax: number;
    yMin: number;
    yMax: number;
    keepAspect?: boolean;
  };
  objects: GeometryObject[];
  actions?: GeometryTeachingAction[];
}

export type GeometryObject =
  | PointObject
  | LineObject
  | SegmentObject
  | CircleObject
  | PolygonObject
  | AngleObject
  | LabelObject
  | TextObject;

export interface PointObject {
  kind: "point";
  id: string;
  label?: string;
  at: [number, number];
  draggable?: boolean;
  visible?: boolean;
}

export interface LineObject {
  kind: "line";
  id: string;
  through: [string, string];
  style?: LineStyle;
}

export interface SegmentObject {
  kind: "segment";
  id: string;
  from: string;
  to: string;
  style?: LineStyle;
}

export interface CircleObject {
  kind: "circle";
  id: string;
  center: string;
  through?: string;
  radius?: number;
  style?: LineStyle;
}

export interface PolygonObject {
  kind: "polygon";
  id: string;
  vertices: string[];
  style?: LineStyle;
}

export interface AngleObject {
  kind: "angle";
  id: string;
  from: string;
  at: string;
  to: string;
  showMeasure?: boolean;
}

export interface LabelObject {
  kind: "label";
  id: string;
  text: string;
  anchor: string;
  offset?: [number, number];
}

export interface TextObject {
  kind: "text";
  id: string;
  text: string;
  at: [number, number];
}

export interface LineStyle {
  color?: string;
  strokeWidth?: number;
  dash?: boolean;
}

export type GeometryTeachingAction =
  | "highlight_radius"
  | "show_measure"
  | "ask_learner_to_move_point"
  | "lock_point"
  | "reveal_object"
  | "hide_object"
  | "show_construction"
  | "animate_rotation";

/* ── Function Graphing ── */

export interface FunctionIntent {
  type: "function";
  title?: string;
  domainX: [number, number];
  rangeY?: [number, number];
  expressions: FunctionExpression[];
  actions?: FunctionTeachingAction[];
}

export interface FunctionExpression {
  id: string;
  expression: string;
  label?: string;
  color?: string;
  visible?: boolean;
}

export type FunctionTeachingAction =
  | "show_derivative"
  | "show_integral"
  | "highlight_area"
  | "show_tangent"
  | "show_zeros"
  | "animate_parameter";

/* ── Charts & Data Visualization ── */

export interface ChartIntent {
  type: "chart";
  title?: string;
  chartType: "bar" | "line" | "scatter" | "histogram" | "box";
  data: ChartDataSeries[];
  xLabel?: string;
  yLabel?: string;
}

export interface ChartDataSeries {
  id: string;
  label: string;
  values: number[];
  color?: string;
}

/* ── Equations ── */

export interface EquationIntent {
  type: "equation";
  latex: string;
  caption?: string;
  editable?: boolean;
  actions?: EquationTeachingAction[];
}

export type EquationTeachingAction =
  | "highlight_terms"
  | "reveal_step"
  | "ask_learner_to_complete";

/* ── Simple Diagrams (fallback SVG) ── */

export interface DiagramIntent {
  type: "diagram";
  variant: string;
  caption?: string;
}

/* ── Plugin Domains (unimplemented, honest unsupported card) ── */

export interface CircuitIntent {
  type: "circuit";
  title?: string;
  components: Record<string, unknown>[];
}

export interface ChemistryIntent {
  type: "chemistry";
  title?: string;
  molecule?: string;
  reaction?: string;
}

export interface GraphTheoryIntent {
  type: "graph_theory";
  title?: string;
  nodes: { id: string; label?: string }[];
  edges: { from: string; to: string; weight?: number }[];
}

/* ── Visualization State (for interactive persistence) ── */

export interface VisualizationState {
  pointPositions?: Record<string, [number, number]>;
  equationValue?: string;
  [key: string]: unknown;
}

/* ── Render Model ── */

export interface VisualizationRenderModel {
  adapterId: string;
  intent: VisualizationIntent;
  state?: VisualizationState;
  unsupported?: boolean;
  unsupportedReason?: string;
}
