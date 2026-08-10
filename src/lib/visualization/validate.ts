/**
 * Structural validation for visualization intents.
 *
 * Enforces safety bounds without rendering-specific logic.
 */

import type {
  GeometryIntent,
  FunctionIntent,
  ChartIntent,
  EquationIntent,
  DiagramIntent,
  CircuitIntent,
  ChemistryIntent,
  GraphTheoryIntent,
  GeometryObject,
} from "./types";

/* ── Safety Bounds ── */

const MAX_OBJECTS = 50;
const MAX_EXPRESSIONS = 12;
const MAX_DATA_SERIES = 20;
const MAX_DATA_POINTS = 500;
const MAX_NODES = 100;
const MAX_EDGES = 200;
const MAX_STRING_LENGTH = 500;
const MAX_LATEX_LENGTH = 2000;
const COORD_MIN = -1e6;
const COORD_MAX = 1e6;

/* ── Result Type ── */

export type ValidationResult =
  | { valid: true }
  | { valid: false; reason: string };

/* ── Main Entry Point ── */

export function validateVisualizationIntent(
  intent: unknown
): ValidationResult {
  if (!intent || typeof intent !== "object") {
    return { valid: false, reason: "Intent must be an object" };
  }

  const typed = intent as { type?: string };
  if (!typed.type || typeof typed.type !== "string") {
    return { valid: false, reason: "Intent must have a string 'type' field" };
  }

  switch (typed.type) {
    case "geometry":
      return validateGeometry(intent as GeometryIntent);
    case "function":
      return validateFunction(intent as FunctionIntent);
    case "chart":
      return validateChart(intent as ChartIntent);
    case "equation":
      return validateEquation(intent as EquationIntent);
    case "diagram":
      return validateDiagram(intent as DiagramIntent);
    case "circuit":
      return validateCircuit(intent as CircuitIntent);
    case "chemistry":
      return validateChemistry(intent as ChemistryIntent);
    case "graph_theory":
      return validateGraphTheory(intent as GraphTheoryIntent);
    default:
      return { valid: false, reason: `Unknown intent type: ${typed.type}` };
  }
}

/* ── Geometry ── */

function validateGeometry(intent: GeometryIntent): ValidationResult {
  if (intent.title && !validateString(intent.title, MAX_STRING_LENGTH)) {
    return { valid: false, reason: "Geometry title exceeds length limit" };
  }

  if (intent.viewport) {
    const vp = intent.viewport;
    if (
      !isFiniteCoord(vp.xMin) ||
      !isFiniteCoord(vp.xMax) ||
      !isFiniteCoord(vp.yMin) ||
      !isFiniteCoord(vp.yMax)
    ) {
      return { valid: false, reason: "Viewport coordinates out of bounds" };
    }
    if (vp.xMin >= vp.xMax || vp.yMin >= vp.yMax) {
      return { valid: false, reason: "Viewport min must be less than max" };
    }
  }

  if (!Array.isArray(intent.objects)) {
    return { valid: false, reason: "Geometry objects must be an array" };
  }
  if (intent.objects.length > MAX_OBJECTS) {
    return { valid: false, reason: `Too many objects (max ${MAX_OBJECTS})` };
  }

  const ids = new Set<string>();
  for (const obj of intent.objects) {
    const result = validateGeometryObject(obj, ids);
    if (!result.valid) return result;
    ids.add(obj.id);
  }

  if (intent.actions && !Array.isArray(intent.actions)) {
    return { valid: false, reason: "Geometry actions must be an array" };
  }

  return { valid: true };
}

function validateGeometryObject(
  obj: GeometryObject,
  existingIds: Set<string>
): ValidationResult {
  if (!obj.kind || typeof obj.kind !== "string") {
    return { valid: false, reason: "Geometry object missing 'kind'" };
  }
  if (!obj.id || typeof obj.id !== "string") {
    return { valid: false, reason: "Geometry object missing 'id'" };
  }
  if (!validateString(obj.id, 100)) {
    return { valid: false, reason: "Geometry object id too long" };
  }
  if (existingIds.has(obj.id)) {
    return { valid: false, reason: `Duplicate object id: ${obj.id}` };
  }

  switch (obj.kind) {
    case "point":
      if (!Array.isArray(obj.at) || obj.at.length !== 2) {
        return { valid: false, reason: "Point 'at' must be [x, y]" };
      }
      if (!isFiniteCoord(obj.at[0]) || !isFiniteCoord(obj.at[1])) {
        return { valid: false, reason: "Point coordinates out of bounds" };
      }
      break;

    case "line":
      if (
        !Array.isArray(obj.through) ||
        obj.through.length !== 2 ||
        !obj.through.every((id) => typeof id === "string")
      ) {
        return { valid: false, reason: "Line 'through' must be [id1, id2]" };
      }
      break;

    case "segment":
      if (typeof obj.from !== "string" || typeof obj.to !== "string") {
        return { valid: false, reason: "Segment must have 'from' and 'to'" };
      }
      break;

    case "circle":
      if (typeof obj.center !== "string") {
        return { valid: false, reason: "Circle must have 'center' id" };
      }
      if (obj.radius !== undefined) {
        if (typeof obj.radius !== "number" || obj.radius <= 0) {
          return { valid: false, reason: "Circle radius must be positive" };
        }
      } else if (typeof obj.through !== "string") {
        return {
          valid: false,
          reason: "Circle must have 'through' or 'radius'",
        };
      }
      break;

    case "polygon":
      if (
        !Array.isArray(obj.vertices) ||
        obj.vertices.length < 3 ||
        !obj.vertices.every((id) => typeof id === "string")
      ) {
        return {
          valid: false,
          reason: "Polygon must have at least 3 vertex ids",
        };
      }
      break;

    case "angle":
      if (
        typeof obj.from !== "string" ||
        typeof obj.at !== "string" ||
        typeof obj.to !== "string"
      ) {
        return { valid: false, reason: "Angle must have from/at/to ids" };
      }
      break;

    case "label":
      if (typeof obj.text !== "string" || typeof obj.anchor !== "string") {
        return { valid: false, reason: "Label must have text and anchor" };
      }
      if (!validateString(obj.text, MAX_STRING_LENGTH)) {
        return { valid: false, reason: "Label text too long" };
      }
      break;

    case "text":
      if (typeof obj.text !== "string") {
        return { valid: false, reason: "Text must have text field" };
      }
      if (!validateString(obj.text, MAX_STRING_LENGTH)) {
        return { valid: false, reason: "Text content too long" };
      }
      if (!Array.isArray(obj.at) || obj.at.length !== 2) {
        return { valid: false, reason: "Text 'at' must be [x, y]" };
      }
      if (!isFiniteCoord(obj.at[0]) || !isFiniteCoord(obj.at[1])) {
        return { valid: false, reason: "Text coordinates out of bounds" };
      }
      break;

    default:
  // The discriminated switch above is exhaustive over the 8 declared kinds, so
  // `obj` narrows to `never` here. The default is still reachable at runtime for
  // malformed untrusted input carrying an unknown string `kind` that passes the
  // guard at line 122 — read it via a cast so the error reports the actual value.
  const rawKind = (obj as { kind?: string }).kind ?? "?";
  return { valid: false, reason: `Unknown geometry object kind: ${rawKind}` };
  }

  return { valid: true };
}

/* ── Function ── */

function validateFunction(intent: FunctionIntent): ValidationResult {
  if (intent.title && !validateString(intent.title, MAX_STRING_LENGTH)) {
    return { valid: false, reason: "Function title exceeds length limit" };
  }

  if (
    !Array.isArray(intent.domainX) ||
    intent.domainX.length !== 2 ||
    !isFiniteCoord(intent.domainX[0]) ||
    !isFiniteCoord(intent.domainX[1])
  ) {
    return { valid: false, reason: "Function domainX must be [min, max]" };
  }
  if (intent.domainX[0] >= intent.domainX[1]) {
    return { valid: false, reason: "Function domain min must be less than max" };
  }

  if (intent.rangeY) {
    if (
      !Array.isArray(intent.rangeY) ||
      intent.rangeY.length !== 2 ||
      !isFiniteCoord(intent.rangeY[0]) ||
      !isFiniteCoord(intent.rangeY[1])
    ) {
      return { valid: false, reason: "Function rangeY must be [min, max]" };
    }
    if (intent.rangeY[0] >= intent.rangeY[1]) {
      return { valid: false, reason: "Function range min must be less than max" };
    }
  }

  if (!Array.isArray(intent.expressions)) {
    return { valid: false, reason: "Function expressions must be an array" };
  }
  if (intent.expressions.length === 0) {
    return { valid: false, reason: "Function must have at least one expression" };
  }
  if (intent.expressions.length > MAX_EXPRESSIONS) {
    return {
      valid: false,
      reason: `Too many expressions (max ${MAX_EXPRESSIONS})`,
    };
  }

  const ids = new Set<string>();
  for (const expr of intent.expressions) {
    if (!expr.id || typeof expr.id !== "string") {
      return { valid: false, reason: "Expression missing id" };
    }
    if (ids.has(expr.id)) {
      return { valid: false, reason: `Duplicate expression id: ${expr.id}` };
    }
    ids.add(expr.id);

    if (!expr.expression || typeof expr.expression !== "string") {
      return { valid: false, reason: "Expression missing expression string" };
    }
    if (!validateString(expr.expression, MAX_STRING_LENGTH)) {
      return { valid: false, reason: "Expression too long" };
    }

    if (expr.label && !validateString(expr.label, MAX_STRING_LENGTH)) {
      return { valid: false, reason: "Expression label too long" };
    }
  }

  if (intent.actions && !Array.isArray(intent.actions)) {
    return { valid: false, reason: "Function actions must be an array" };
  }

  return { valid: true };
}

/* ── Chart ── */

function validateChart(intent: ChartIntent): ValidationResult {
  if (intent.title && !validateString(intent.title, MAX_STRING_LENGTH)) {
    return { valid: false, reason: "Chart title exceeds length limit" };
  }

  const validTypes = ["bar", "line", "scatter", "histogram", "box"];
  if (!validTypes.includes(intent.chartType)) {
    return { valid: false, reason: `Invalid chart type: ${intent.chartType}` };
  }

  if (!Array.isArray(intent.data)) {
    return { valid: false, reason: "Chart data must be an array" };
  }
  if (intent.data.length === 0) {
    return { valid: false, reason: "Chart must have at least one data series" };
  }
  if (intent.data.length > MAX_DATA_SERIES) {
    return { valid: false, reason: `Too many data series (max ${MAX_DATA_SERIES})` };
  }

  const ids = new Set<string>();
  for (const series of intent.data) {
    if (!series.id || typeof series.id !== "string") {
      return { valid: false, reason: "Data series missing id" };
    }
    if (ids.has(series.id)) {
      return { valid: false, reason: `Duplicate series id: ${series.id}` };
    }
    ids.add(series.id);

    if (!series.label || typeof series.label !== "string") {
      return { valid: false, reason: "Data series missing label" };
    }
    if (!validateString(series.label, MAX_STRING_LENGTH)) {
      return { valid: false, reason: "Data series label too long" };
    }

    if (!Array.isArray(series.values)) {
      return { valid: false, reason: "Data series values must be an array" };
    }
    if (series.values.length > MAX_DATA_POINTS) {
      return {
        valid: false,
        reason: `Too many data points (max ${MAX_DATA_POINTS})`,
      };
    }
    if (!series.values.every((v) => typeof v === "number" && isFinite(v))) {
      return { valid: false, reason: "Data series values must be finite numbers" };
    }
  }

  if (intent.xLabel && !validateString(intent.xLabel, MAX_STRING_LENGTH)) {
    return { valid: false, reason: "Chart xLabel too long" };
  }
  if (intent.yLabel && !validateString(intent.yLabel, MAX_STRING_LENGTH)) {
    return { valid: false, reason: "Chart yLabel too long" };
  }

  return { valid: true };
}

/* ── Equation ── */

function validateEquation(intent: EquationIntent): ValidationResult {
  if (!intent.latex || typeof intent.latex !== "string") {
    return { valid: false, reason: "Equation must have latex string" };
  }
  if (!validateString(intent.latex, MAX_LATEX_LENGTH)) {
    return { valid: false, reason: "Equation latex exceeds length limit" };
  }

  if (intent.caption && !validateString(intent.caption, MAX_STRING_LENGTH)) {
    return { valid: false, reason: "Equation caption too long" };
  }

  if (intent.actions && !Array.isArray(intent.actions)) {
    return { valid: false, reason: "Equation actions must be an array" };
  }

  return { valid: true };
}

/* ── Diagram ── */

function validateDiagram(intent: DiagramIntent): ValidationResult {
  if (!intent.variant || typeof intent.variant !== "string") {
    return { valid: false, reason: "Diagram must have variant string" };
  }
  if (!validateString(intent.variant, 100)) {
    return { valid: false, reason: "Diagram variant too long" };
  }

  if (intent.caption && !validateString(intent.caption, MAX_STRING_LENGTH)) {
    return { valid: false, reason: "Diagram caption too long" };
  }

  return { valid: true };
}

/* ── Circuit ── */

function validateCircuit(intent: CircuitIntent): ValidationResult {
  if (intent.title && !validateString(intent.title, MAX_STRING_LENGTH)) {
    return { valid: false, reason: "Circuit title exceeds length limit" };
  }

  if (!Array.isArray(intent.components)) {
    return { valid: false, reason: "Circuit components must be an array" };
  }
  if (intent.components.length > MAX_OBJECTS) {
    return { valid: false, reason: `Too many components (max ${MAX_OBJECTS})` };
  }

  return { valid: true };
}

/* ── Chemistry ── */

function validateChemistry(intent: ChemistryIntent): ValidationResult {
  if (intent.title && !validateString(intent.title, MAX_STRING_LENGTH)) {
    return { valid: false, reason: "Chemistry title exceeds length limit" };
  }

  if (intent.molecule && !validateString(intent.molecule, MAX_STRING_LENGTH)) {
    return { valid: false, reason: "Molecule string too long" };
  }

  if (intent.reaction && !validateString(intent.reaction, MAX_STRING_LENGTH)) {
    return { valid: false, reason: "Reaction string too long" };
  }

  return { valid: true };
}

/* ── Graph Theory ── */

function validateGraphTheory(intent: GraphTheoryIntent): ValidationResult {
  if (intent.title && !validateString(intent.title, MAX_STRING_LENGTH)) {
    return { valid: false, reason: "Graph theory title exceeds length limit" };
  }

  if (!Array.isArray(intent.nodes)) {
    return { valid: false, reason: "Graph nodes must be an array" };
  }
  if (intent.nodes.length > MAX_NODES) {
    return { valid: false, reason: `Too many nodes (max ${MAX_NODES})` };
  }

  const nodeIds = new Set<string>();
  for (const node of intent.nodes) {
    if (!node.id || typeof node.id !== "string") {
      return { valid: false, reason: "Graph node missing id" };
    }
    if (nodeIds.has(node.id)) {
      return { valid: false, reason: `Duplicate node id: ${node.id}` };
    }
    nodeIds.add(node.id);

    if (node.label && !validateString(node.label, MAX_STRING_LENGTH)) {
      return { valid: false, reason: "Graph node label too long" };
    }
  }

  if (!Array.isArray(intent.edges)) {
    return { valid: false, reason: "Graph edges must be an array" };
  }
  if (intent.edges.length > MAX_EDGES) {
    return { valid: false, reason: `Too many edges (max ${MAX_EDGES})` };
  }

  for (const edge of intent.edges) {
    if (typeof edge.from !== "string" || typeof edge.to !== "string") {
      return { valid: false, reason: "Graph edge must have from/to strings" };
    }
    if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) {
      return { valid: false, reason: "Graph edge references unknown node" };
    }
    if (edge.weight !== undefined && typeof edge.weight !== "number") {
      return { valid: false, reason: "Graph edge weight must be number" };
    }
  }

  return { valid: true };
}

/* ── Helpers ── */

function validateString(s: string, maxLen: number): boolean {
  return typeof s === "string" && s.length <= maxLen;
}

function isFiniteCoord(n: number): boolean {
  return (
    typeof n === "number" && isFinite(n) && n >= COORD_MIN && n <= COORD_MAX
  );
}
