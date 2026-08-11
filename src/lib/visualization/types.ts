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
  | Graph3DIntent
  | ChartIntent
  | EquationIntent
  | DiagramIntent
  | PhysicsIntent
  | BiologyIntent
  | CircuitIntent
  | ChemistryIntent
  | GraphTheoryIntent;

/* ── Geometry ── */

export type VisualizationDisplayMode = "graph" | "graphless";

export interface GeometryIntent {
  type: "geometry";
  title?: string;
  /**
   * Coordinate-plane background mode.
   * - "graphless" = pure diagram, no axes/ticks behind the figure
   * - "graph" = render on a coordinate plane when the teaching goal needs it
   *
   * Geometry defaults to "graphless" so circles/triangles are not sliced by
   * incidental axes just because the origin happens to be nearby.
   */
  displayMode?: VisualizationDisplayMode;
  /**
   * Deprecated framing hint. Kept only for backward compatibility with older
   * stored intents; the current renderer ignores geometry viewports and fits to
   * the measured objects directly.
   */
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
  | TextObject
  | NotationObject;

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
  /** Draw 1/2/3 chevron-style marks to denote parallel lines. */
  parallelMarkCount?: number;
  style?: LineStyle;
}

export interface SegmentObject {
  kind: "segment";
  id: string;
  from: string;
  to: string;
  /** Draw 1/2/3 short tick marks across the segment to denote congruence. */
  tickCount?: number;
  /** Draw 1/2/3 chevron-style marks to denote parallel segments. */
  parallelMarkCount?: number;
  /** Show a midpoint marker on the segment. */
  midpointMarker?: boolean;
  /** Optional free-text side label (e.g. "5", "x+2", "AB"). */
  label?: string;
  /** Optional TeX side label rendered with KaTeX in graphless geometry mode. */
  labelLatex?: string;
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
  /** Default "arc"; use "right_angle" to draw the small square marker. */
  marker?: "arc" | "right_angle";
  /** Number of arc marks for congruent-angle notation. */
  arcCount?: number;
  /** Optional free-text angle label (e.g. "x", "θ", "90°"). */
  label?: string;
  /** Optional TeX angle label rendered with KaTeX in graphless geometry mode. */
  labelLatex?: string;
  /** Optional custom mark radius in user units. */
  radius?: number;
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

export type NotationObject =
  | SegmentNotationObject
  | AngleNotationObject
  | ParallelNotationObject
  | MidpointNotationObject
  | PerpendicularNotationObject
  | BisectorNotationObject;

export interface SegmentNotationObject {
  kind: "notation";
  id: string;
  variant: "segment";
  from: string;
  to: string;
  tickCount?: number;
  parallelMarkCount?: number;
  midpointMarker?: boolean;
  label?: string;
  labelLatex?: string;
}

export interface AngleNotationObject {
  kind: "notation";
  id: string;
  variant: "angle";
  from: string;
  at: string;
  to: string;
  marker?: "arc" | "right_angle";
  arcCount?: number;
  label?: string;
  labelLatex?: string;
  radius?: number;
  showMeasure?: boolean;
}

export interface ParallelNotationObject {
  kind: "notation";
  id: string;
  variant: "parallel";
  from: string;
  to: string;
  markCount?: number;
}

export interface MidpointNotationObject {
  kind: "notation";
  id: string;
  variant: "midpoint";
  from: string;
  to: string;
  label?: string;
  labelLatex?: string;
}

export interface PerpendicularNotationObject {
  kind: "notation";
  id: string;
  variant: "perpendicular";
  at: string;
  arm1: string;
  arm2: string;
  size?: number;
  label?: string;
  labelLatex?: string;
}

export interface BisectorNotationObject {
  kind: "notation";
  id: string;
  variant: "bisector";
  from: string;
  at: string;
  through: string;
  to: string;
  radius?: number;
  label?: string;
  labelLatex?: string;
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
  /**
   * Coordinate-plane background mode.
   *
   * Function plots default to "graph" because the axes are part of the lesson,
   * but callers may opt into "graphless" for a pure curve sketch.
   */
  displayMode?: VisualizationDisplayMode;
  domainX: [number, number];
  rangeY?: [number, number];
  xLabel?: string;
  yLabel?: string;
  showGrid?: boolean;
  showLegend?: boolean;
  sampling?: FunctionSampling;
  expressions: FunctionExpression[];
  annotations?: FunctionAnnotation[];
  actions?: FunctionTeachingAction[];
}

export interface FunctionExpression {
  id: string;
  expression: string;
  label?: string;
  color?: string;
  visible?: boolean;
}

export interface FunctionSampling {
  /** Desired sample count for fixed-step renderers. */
  samples?: number;
  /** Hint that future renderers may refine near steep/curved regions. */
  adaptive?: boolean;
}

export type FunctionAnnotation =
  | { kind: "point"; id: string; x: number; y?: number; label?: string; labelLatex?: string }
  | { kind: "root"; id: string; expressionId: string; nearX?: number; label?: string }
  | { kind: "extremum"; id: string; expressionId: string; nearX?: number; label?: string }
  | { kind: "intersection"; id: string; expressionIds: [string, string]; nearX?: number; label?: string }
  | { kind: "tangent"; id: string; expressionId: string; atX: number; label?: string }
  | { kind: "area"; id: string; expressionId: string; fromX: number; toX: number; label?: string }
  | { kind: "asymptote"; id: string; orientation: "vertical" | "horizontal"; value: number; label?: string };

export type FunctionTeachingAction =
  | "show_derivative"
  | "show_integral"
  | "highlight_area"
  | "show_tangent"
  | "show_zeros"
  | "animate_parameter";

/* ── 3D Graphing ── */

export interface Graph3DIntent {
  type: "graph3d";
  title?: string;
  axes?: {
    xLabel?: string;
    yLabel?: string;
    zLabel?: string;
    showGrid?: boolean;
  };
  domain?: {
    x: [number, number];
    y: [number, number];
    z?: [number, number];
  };
  camera?: {
    azimuth?: number;
    elevation?: number;
    distance?: number;
  };
  sampling?: Graph3DSampling;
  surfaces: Graph3DObject[];
}

export interface Graph3DSampling {
  xSteps?: number;
  ySteps?: number;
  tSteps?: number;
  uSteps?: number;
  vSteps?: number;
}

export type Graph3DObject =
  | Graph3DSurfaceObject
  | Graph3DParametricSurfaceObject
  | Graph3DParametricCurveObject
  | Graph3DPointObject
  | Graph3DPointCloudObject
  | Graph3DVectorFieldObject;

export interface Graph3DSurfaceObject {
  kind: "surface";
  id: string;
  z: string;
  color?: string;
  opacity?: number;
  renderMode?: "surface" | "wireframe" | "points";
}

export interface Graph3DParametricSurfaceObject {
  kind: "parametric_surface";
  id: string;
  uDomain: [number, number];
  vDomain: [number, number];
  x: string;
  y: string;
  z: string;
  color?: string;
  opacity?: number;
  renderMode?: "surface" | "wireframe" | "points";
}

export interface Graph3DParametricCurveObject {
  kind: "parametric_curve";
  id: string;
  tDomain: [number, number];
  x: string;
  y: string;
  z: string;
  color?: string;
}

export interface Graph3DPointObject {
  kind: "point";
  id: string;
  at: [number, number, number];
  label?: string;
  color?: string;
}

export interface Graph3DPointCloudObject {
  kind: "point_cloud";
  id: string;
  points: [number, number, number][];
  color?: string;
}

export interface Graph3DVectorFieldObject {
  kind: "vector_field";
  id: string;
  xDomain: [number, number];
  yDomain: [number, number];
  zDomain: [number, number];
  fx: string;
  fy: string;
  fz: string;
  color?: string;
}

/* ── Charts & Data Visualization ── */

export interface ChartIntent {
  type: "chart";
  title?: string;
  subtitle?: string;
  caption?: string;
  chartType:
    | "bar"
    | "line"
    | "scatter"
    | "histogram"
    | "box"
    | "heatmap"
    | "contour"
    | "pie"
    | "donut"
    | "radar"
    | "polar_line"
    | "polar_scatter"
    | "sankey"
    | "treemap"
    | "sunburst"
    | "candlestick"
    | "ohlc";
  xLabel?: string;
  yLabel?: string;
  palette?: string[];
  background?: string;
  legend?: boolean;
  tooltip?: boolean;
  showZoom?: boolean;
  viewport?: ChartViewport;
  xAxis?: ChartAxis;
  yAxis?: ChartAxis;
  angleAxis?: ChartAxis;
  radiusAxis?: ChartAxis;
  indicators?: ChartIndicator[];
  annotations?: ChartAnnotation[];
  data?: ChartDataSeries[]; // legacy/simple path
  series?: ChartSeries[];
}

export interface ChartAxis {
  label?: string;
  min?: number;
  max?: number;
  categories?: string[];
  scaleType?: "linear" | "log" | "time" | "category";
  tickFormat?: string;
  showGrid?: boolean;
  showAxisLine?: boolean;
  invert?: boolean;
}

export interface ChartViewport {
  xStart?: number;
  xEnd?: number;
  yStart?: number;
  yEnd?: number;
}

export interface ChartIndicator {
  name: string;
  min?: number;
  max?: number;
}

export type ChartSeries =
  | CartesianChartSeries
  | ScatterChartSeries
  | HistogramChartSeries
  | BoxChartSeries
  | HeatmapChartSeries
  | PieChartSeries
  | RadarChartSeries
  | PolarChartSeries
  | SankeyChartSeries
  | TreeChartSeries
  | FinancialChartSeries;

export interface CartesianChartSeries {
  kind: "bar" | "line";
  id: string;
  name: string;
  values: number[];
  color?: string;
  opacity?: number;
  lineWidth?: number;
  dashStyle?: "solid" | "dashed" | "dotted";
  fill?: boolean;
  fillOpacity?: number;
  stack?: string;
  smooth?: boolean;
}

export interface ScatterChartSeries {
  kind: "scatter";
  id: string;
  name: string;
  points: [number, number][];
  color?: string;
  symbol?: "circle" | "rect" | "triangle" | "diamond";
  symbolSize?: number;
  opacity?: number;
}

export interface HistogramChartSeries {
  kind: "histogram";
  id: string;
  name: string;
  values: number[];
  color?: string;
  bins?: number;
}

export interface BoxChartSeries {
  kind: "box";
  id: string;
  name: string;
  values: number[];
  color?: string;
}

export interface HeatmapChartSeries {
  kind: "heatmap" | "contour";
  id: string;
  name?: string;
  points?: [number, number, number][];
  grid?: {
    x: number[];
    y: number[];
    values: number[][];
  };
  color?: string;
}

export interface PieChartSeries {
  kind: "pie" | "donut";
  id: string;
  name: string;
  slices: { name: string; value: number; color?: string }[];
}

export interface RadarChartSeries {
  kind: "radar";
  id: string;
  name: string;
  values: number[];
  color?: string;
}

export interface PolarChartSeries {
  kind: "polar_line" | "polar_scatter";
  id: string;
  name: string;
  points: [number, number][];
  color?: string;
  symbol?: "circle" | "rect" | "triangle" | "diamond";
  symbolSize?: number;
}

export interface SankeyChartSeries {
  kind: "sankey";
  id: string;
  name?: string;
  nodes: { id: string; name?: string; color?: string }[];
  links: { source: string; target: string; value: number; color?: string }[];
}

export interface TreeChartSeries {
  kind: "treemap" | "sunburst";
  id: string;
  name?: string;
  nodes: ChartTreeNode[];
}

export interface ChartTreeNode {
  name: string;
  value?: number;
  color?: string;
  children?: ChartTreeNode[];
}

export interface FinancialChartSeries {
  kind: "candlestick" | "ohlc";
  id: string;
  name: string;
  candles: [number, number, number, number][];
  color?: string;
  upColor?: string;
  downColor?: string;
}

export type ChartAnnotation =
  | { kind: "label"; text: string; x: number; y: number }
  | { kind: "line"; x?: number; y?: number; label?: string; color?: string }
  | { kind: "region"; x0?: number; x1?: number; y0?: number; y1?: number; label?: string; color?: string };

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

/* ── Domain-specific Science Visualization ── */

export interface PhysicsIntent {
  type: "physics";
  title?: string;
  variant: "free_body" | "vector_scene" | "ray_diagram" | "mechanics_scene";
  caption?: string;
  bodies?: PhysicsBody[];
  vectors?: PhysicsVector[];
  optics?: PhysicsOptic[];
  rays?: PhysicsRay[];
  decorations?: PhysicsDecoration[];
}

export interface PhysicsBody {
  id: string;
  label?: string;
  at: [number, number];
  shape?: "box" | "circle" | "plane" | "incline" | "pulley";
  width?: number;
  height?: number;
}

export interface PhysicsVector {
  id: string;
  from: string | [number, number];
  to?: [number, number];
  dx?: number;
  dy?: number;
  label?: string;
  color?: string;
  kind?: "force" | "velocity" | "acceleration" | "field" | "generic";
}

export interface PhysicsOptic {
  id: string;
  kind: "lens" | "mirror" | "screen" | "focal_plane";
  atX: number;
  height?: number;
  label?: string;
}

export interface PhysicsRay {
  id: string;
  from: [number, number];
  via?: [number, number];
  to: [number, number];
  label?: string;
  dashed?: boolean;
}

export type PhysicsDecoration =
  | { kind: "ground"; id: string; fromX: number; toX: number; y: number }
  | { kind: "incline"; id: string; base: [number, number]; dx: number; dy: number; label?: string }
  | { kind: "spring"; id: string; from: [number, number] | string; to: [number, number] | string; label?: string }
  | { kind: "pivot"; id: string; at: [number, number] | string; label?: string }
  | { kind: "axis"; id: string; from: [number, number]; to: [number, number]; label?: string };

export interface BiologyIntent {
  type: "biology";
  title?: string;
  variant: "cell" | "dna" | "pathway";
  caption?: string;
  structures?: BiologyStructure[];
  connections?: BiologyConnection[];
  layout?: "preset" | "breadthfirst" | "circle" | "concentric" | "grid" | "cose";
  style?: {
    directed?: boolean;
    nodeColorByKind?: boolean;
    compact?: boolean;
  };
}

export interface BiologyStructure {
  id: string;
  label: string;
  at: [number, number];
  kind?: "nucleus" | "mitochondrion" | "ribosome" | "protein" | "gene" | "organelle" | "node";
}

export interface BiologyConnection {
  from: string;
  to: string;
  label?: string;
}

export interface CircuitIntent {
  type: "circuit";
  title?: string;
  caption?: string;
  nodes: CircuitNode[];
  wires: CircuitWire[];
  components: CircuitComponent[];
}

export interface CircuitNode {
  id: string;
  at: [number, number];
}

export interface CircuitWire {
  id: string;
  from: string;
  to: string;
}

export type CircuitComponent =
  | { kind: "battery"; id: string; between: [string, string]; label?: string }
  | { kind: "resistor"; id: string; between: [string, string]; label?: string }
  | { kind: "capacitor"; id: string; between: [string, string]; label?: string }
  | { kind: "inductor"; id: string; between: [string, string]; label?: string }
  | { kind: "lamp"; id: string; between: [string, string]; label?: string }
  | { kind: "switch"; id: string; between: [string, string]; label?: string; closed?: boolean }
  | { kind: "ground"; id: string; at: string; label?: string };

export interface ChemistryIntent {
  type: "chemistry";
  title?: string;
  variant?: "molecule" | "reaction";
  molecule?: string;
  reaction?: string;
  reactants?: ChemistrySpecies[];
  products?: ChemistrySpecies[];
  agents?: string[];
  caption?: string;
  atoms?: ChemistryAtom[];
  bonds?: ChemistryBond[];
}

export interface ChemistrySpecies {
  id: string;
  molecule?: string;
  label?: string;
  atoms?: ChemistryAtom[];
  bonds?: ChemistryBond[];
}

export interface ChemistryAtom {
  id: string;
  element: string;
  at: [number, number];
  label?: string;
}

export interface ChemistryBond {
  from: string;
  to: string;
  order?: 1 | 2 | 3;
}

export interface GraphTheoryIntent {
  type: "graph_theory";
  title?: string;
  caption?: string;
  layout?: "preset" | "breadthfirst" | "circle" | "concentric" | "grid" | "cose";
  directed?: boolean;
  style?: {
    compact?: boolean;
    showLabels?: boolean;
  };
  nodes: GraphTheoryNode[];
  edges: GraphTheoryEdge[];
}

export interface GraphTheoryNode {
  id: string;
  label?: string;
  color?: string;
  shape?: "ellipse" | "round-rectangle" | "rectangle" | "diamond" | "hexagon" | "triangle";
  size?: number;
  at?: [number, number];
  group?: string;
  locked?: boolean;
}

export interface GraphTheoryEdge {
  from: string;
  to: string;
  label?: string;
  weight?: number;
  color?: string;
  width?: number;
  style?: "solid" | "dashed" | "dotted";
  directed?: boolean;
  curvature?: number;
}

/* ── Visualization State (for interactive persistence) ── */

export interface VisualizationState {
  pointPositions?: Record<string, [number, number]>;
  nodePositions?: Record<string, [number, number]>;
  graph3dCamera?: {
    position: [number, number, number];
    target: [number, number, number];
  };
  chartViewport?: ChartViewport;
  hiddenSeries?: string[];
  seriesStyleOverrides?: Record<string, { color?: string; opacity?: number }>;
  scienceLayout?: string;
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
