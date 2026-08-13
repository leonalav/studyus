/**
 * Structural validation for visualization intents.
 *
 * Enforces safety bounds without rendering-specific logic.
 */

import type {
  GeometryIntent,
  FunctionIntent,
  Graph3DIntent,
  ChartIntent,
  EquationIntent,
  DiagramIntent,
  PhysicsIntent,
  BiologyIntent,
  CircuitIntent,
  ChemistryIntent,
  GraphTheoryIntent,
  GeometryObject,
  VisualizationDisplayMode,
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
    case "graph3d":
      return validateGraph3D(intent as Graph3DIntent);
    case "chart":
      return validateChart(intent as ChartIntent);
    case "equation":
      return validateEquation(intent as EquationIntent);
    case "diagram":
      return validateDiagram(intent as DiagramIntent);
    case "physics":
      return validatePhysics(intent as PhysicsIntent);
    case "biology":
      return validateBiology(intent as BiologyIntent);
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
  if (!validateDisplayMode(intent.displayMode)) {
    return { valid: false, reason: "Geometry displayMode must be 'graph' or 'graphless'" };
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
      if (obj.parallelMarkCount !== undefined && (!Number.isInteger(obj.parallelMarkCount) || obj.parallelMarkCount < 1 || obj.parallelMarkCount > 4)) {
        return { valid: false, reason: "Line parallelMarkCount must be an integer between 1 and 4" };
      }
      break;

    case "segment":
      if (typeof obj.from !== "string" || typeof obj.to !== "string") {
        return { valid: false, reason: "Segment must have 'from' and 'to'" };
      }
      if (obj.tickCount !== undefined && (!Number.isInteger(obj.tickCount) || obj.tickCount < 1 || obj.tickCount > 4)) {
        return { valid: false, reason: "Segment tickCount must be an integer between 1 and 4" };
      }
      if (obj.parallelMarkCount !== undefined && (!Number.isInteger(obj.parallelMarkCount) || obj.parallelMarkCount < 1 || obj.parallelMarkCount > 4)) {
        return { valid: false, reason: "Segment parallelMarkCount must be an integer between 1 and 4" };
      }
      if (obj.midpointMarker !== undefined && typeof obj.midpointMarker !== "boolean") {
        return { valid: false, reason: "Segment midpointMarker must be boolean" };
      }
      if (obj.label && !validateString(obj.label, MAX_STRING_LENGTH)) {
        return { valid: false, reason: "Segment label too long" };
      }
      if (obj.labelLatex && !validateString(obj.labelLatex, MAX_LATEX_LENGTH)) {
        return { valid: false, reason: "Segment labelLatex too long" };
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
      if (obj.marker !== undefined && obj.marker !== "arc" && obj.marker !== "right_angle") {
        return { valid: false, reason: "Angle marker must be 'arc' or 'right_angle'" };
      }
      if (obj.arcCount !== undefined && (!Number.isInteger(obj.arcCount) || obj.arcCount < 1 || obj.arcCount > 4)) {
        return { valid: false, reason: "Angle arcCount must be an integer between 1 and 4" };
      }
      if (obj.label && !validateString(obj.label, MAX_STRING_LENGTH)) {
        return { valid: false, reason: "Angle label too long" };
      }
      if (obj.labelLatex && !validateString(obj.labelLatex, MAX_LATEX_LENGTH)) {
        return { valid: false, reason: "Angle labelLatex too long" };
      }
      if (obj.radius !== undefined && (typeof obj.radius !== "number" || !isFiniteCoord(obj.radius) || obj.radius <= 0)) {
        return { valid: false, reason: "Angle radius must be a positive finite number" };
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

    case "notation": {
      switch (obj.variant) {
        case "segment":
          if (typeof obj.from !== "string" || typeof obj.to !== "string") {
            return { valid: false, reason: "Segment notation must have 'from' and 'to'" };
          }
          if (obj.tickCount !== undefined && (!Number.isInteger(obj.tickCount) || obj.tickCount < 1 || obj.tickCount > 4)) {
            return { valid: false, reason: "Segment notation tickCount must be an integer between 1 and 4" };
          }
          if (obj.parallelMarkCount !== undefined && (!Number.isInteger(obj.parallelMarkCount) || obj.parallelMarkCount < 1 || obj.parallelMarkCount > 4)) {
            return { valid: false, reason: "Segment notation parallelMarkCount must be an integer between 1 and 4" };
          }
          if (obj.midpointMarker !== undefined && typeof obj.midpointMarker !== "boolean") {
            return { valid: false, reason: "Segment notation midpointMarker must be boolean" };
          }
          if (obj.label && !validateString(obj.label, MAX_STRING_LENGTH)) {
            return { valid: false, reason: "Segment notation label too long" };
          }
          if (obj.labelLatex && !validateString(obj.labelLatex, MAX_LATEX_LENGTH)) {
            return { valid: false, reason: "Segment notation labelLatex too long" };
          }
          break;
        case "angle":
          if (typeof obj.from !== "string" || typeof obj.at !== "string" || typeof obj.to !== "string") {
            return { valid: false, reason: "Angle notation must have from/at/to ids" };
          }
          if (obj.marker !== undefined && obj.marker !== "arc" && obj.marker !== "right_angle") {
            return { valid: false, reason: "Angle notation marker must be 'arc' or 'right_angle'" };
          }
          if (obj.arcCount !== undefined && (!Number.isInteger(obj.arcCount) || obj.arcCount < 1 || obj.arcCount > 4)) {
            return { valid: false, reason: "Angle notation arcCount must be an integer between 1 and 4" };
          }
          if (obj.label && !validateString(obj.label, MAX_STRING_LENGTH)) {
            return { valid: false, reason: "Angle notation label too long" };
          }
          if (obj.labelLatex && !validateString(obj.labelLatex, MAX_LATEX_LENGTH)) {
            return { valid: false, reason: "Angle notation labelLatex too long" };
          }
          if (obj.radius !== undefined && (typeof obj.radius !== "number" || !isFiniteCoord(obj.radius) || obj.radius <= 0)) {
            return { valid: false, reason: "Angle notation radius must be a positive finite number" };
          }
          break;
        case "parallel":
          if (typeof obj.from !== "string" || typeof obj.to !== "string") {
            return { valid: false, reason: "Parallel notation must have 'from' and 'to'" };
          }
          if (obj.markCount !== undefined && (!Number.isInteger(obj.markCount) || obj.markCount < 1 || obj.markCount > 4)) {
            return { valid: false, reason: "Parallel notation markCount must be an integer between 1 and 4" };
          }
          break;
        case "midpoint":
          if (typeof obj.from !== "string" || typeof obj.to !== "string") {
            return { valid: false, reason: "Midpoint notation must have 'from' and 'to'" };
          }
          if (obj.label && !validateString(obj.label, MAX_STRING_LENGTH)) {
            return { valid: false, reason: "Midpoint notation label too long" };
          }
          if (obj.labelLatex && !validateString(obj.labelLatex, MAX_LATEX_LENGTH)) {
            return { valid: false, reason: "Midpoint notation labelLatex too long" };
          }
          break;
        case "perpendicular":
          if (typeof obj.at !== "string" || typeof obj.arm1 !== "string" || typeof obj.arm2 !== "string") {
            return { valid: false, reason: "Perpendicular notation must have at/arm1/arm2 ids" };
          }
          if (obj.size !== undefined && (typeof obj.size !== "number" || !isFiniteCoord(obj.size) || obj.size <= 0)) {
            return { valid: false, reason: "Perpendicular notation size must be a positive finite number" };
          }
          if (obj.label && !validateString(obj.label, MAX_STRING_LENGTH)) {
            return { valid: false, reason: "Perpendicular notation label too long" };
          }
          if (obj.labelLatex && !validateString(obj.labelLatex, MAX_LATEX_LENGTH)) {
            return { valid: false, reason: "Perpendicular notation labelLatex too long" };
          }
          break;
        case "bisector":
          if (typeof obj.from !== "string" || typeof obj.at !== "string" || typeof obj.through !== "string" || typeof obj.to !== "string") {
            return { valid: false, reason: "Bisector notation must have from/at/through/to ids" };
          }
          if (obj.radius !== undefined && (typeof obj.radius !== "number" || !isFiniteCoord(obj.radius) || obj.radius <= 0)) {
            return { valid: false, reason: "Bisector notation radius must be a positive finite number" };
          }
          if (obj.label && !validateString(obj.label, MAX_STRING_LENGTH)) {
            return { valid: false, reason: "Bisector notation label too long" };
          }
          if (obj.labelLatex && !validateString(obj.labelLatex, MAX_LATEX_LENGTH)) {
            return { valid: false, reason: "Bisector notation labelLatex too long" };
          }
          break;
        default:
          return { valid: false, reason: `Unknown notation variant: ${(obj as { variant?: string }).variant ?? "?"}` };
      }
      break;
    }

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
  if (!validateDisplayMode(intent.displayMode)) {
    return { valid: false, reason: "Function displayMode must be 'graph' or 'graphless'" };
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

  if (intent.xLabel && !validateString(intent.xLabel, MAX_STRING_LENGTH)) {
    return { valid: false, reason: "Function xLabel too long" };
  }
  if (intent.yLabel && !validateString(intent.yLabel, MAX_STRING_LENGTH)) {
    return { valid: false, reason: "Function yLabel too long" };
  }
  if (intent.showGrid !== undefined && typeof intent.showGrid !== "boolean") {
    return { valid: false, reason: "Function showGrid must be boolean" };
  }
  if (intent.showLegend !== undefined && typeof intent.showLegend !== "boolean") {
    return { valid: false, reason: "Function showLegend must be boolean" };
  }
  if (intent.sampling) {
    const { samples, adaptive } = intent.sampling;
    if (samples !== undefined && (!Number.isInteger(samples) || samples < 8 || samples > 5000)) {
      return { valid: false, reason: "Function sampling.samples must be an integer between 8 and 5000" };
    }
    if (adaptive !== undefined && typeof adaptive !== "boolean") {
      return { valid: false, reason: "Function sampling.adaptive must be boolean" };
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

  if (intent.annotations !== undefined) {
    if (!Array.isArray(intent.annotations)) {
      return { valid: false, reason: "Function annotations must be an array" };
    }
    const exprIds = new Set(intent.expressions.map((expr) => expr.id));
    for (const ann of intent.annotations) {
      if (!ann || typeof ann !== "object" || typeof ann.kind !== "string" || typeof ann.id !== "string") {
        return { valid: false, reason: "Function annotation must have string kind and id" };
      }
      if (!validateString(ann.id, 100)) {
        return { valid: false, reason: "Function annotation id too long" };
      }
      if ("label" in ann && ann.label !== undefined && !validateString(String(ann.label), MAX_STRING_LENGTH)) {
        return { valid: false, reason: "Function annotation label too long" };
      }
      if ("labelLatex" in ann && ann.labelLatex !== undefined && !validateString(String(ann.labelLatex), MAX_LATEX_LENGTH)) {
        return { valid: false, reason: "Function annotation labelLatex too long" };
      }
      switch (ann.kind) {
        case "point":
          if (typeof ann.x !== "number" || !isFiniteCoord(ann.x)) {
            return { valid: false, reason: "Function point annotation x must be finite number" };
          }
          if (ann.y !== undefined && (typeof ann.y !== "number" || !isFiniteCoord(ann.y))) {
            return { valid: false, reason: "Function point annotation y must be finite number" };
          }
          break;
        case "root":
        case "extremum":
          if (typeof ann.expressionId !== "string" || !exprIds.has(ann.expressionId)) {
            return { valid: false, reason: `Function ${ann.kind} annotation must reference a known expressionId` };
          }
          if (ann.nearX !== undefined && (typeof ann.nearX !== "number" || !isFiniteCoord(ann.nearX))) {
            return { valid: false, reason: `Function ${ann.kind} annotation nearX must be finite number` };
          }
          break;
        case "intersection":
          if (!Array.isArray(ann.expressionIds) || ann.expressionIds.length !== 2 || !ann.expressionIds.every((id: unknown) => typeof id === "string" && exprIds.has(id))) {
            return { valid: false, reason: "Function intersection annotation must reference two known expressionIds" };
          }
          if (ann.nearX !== undefined && (typeof ann.nearX !== "number" || !isFiniteCoord(ann.nearX))) {
            return { valid: false, reason: "Function intersection annotation nearX must be finite number" };
          }
          break;
        case "tangent":
          if (typeof ann.expressionId !== "string" || !exprIds.has(ann.expressionId)) {
            return { valid: false, reason: "Function tangent annotation must reference a known expressionId" };
          }
          if (typeof ann.atX !== "number" || !isFiniteCoord(ann.atX)) {
            return { valid: false, reason: "Function tangent annotation atX must be finite number" };
          }
          break;
        case "area":
          if (typeof ann.expressionId !== "string" || !exprIds.has(ann.expressionId)) {
            return { valid: false, reason: "Function area annotation must reference a known expressionId" };
          }
          if (typeof ann.fromX !== "number" || !isFiniteCoord(ann.fromX) || typeof ann.toX !== "number" || !isFiniteCoord(ann.toX) || ann.fromX >= ann.toX) {
            return { valid: false, reason: "Function area annotation must have finite fromX < toX" };
          }
          break;
        case "asymptote":
          if (ann.orientation !== "vertical" && ann.orientation !== "horizontal") {
            return { valid: false, reason: "Function asymptote annotation orientation must be vertical or horizontal" };
          }
          if (typeof ann.value !== "number" || !isFiniteCoord(ann.value)) {
            return { valid: false, reason: "Function asymptote annotation value must be finite number" };
          }
          break;
        default:
          return { valid: false, reason: `Unknown function annotation kind: ${String((ann as { kind?: unknown }).kind)}` };
      }
    }
  }

  if (intent.actions && !Array.isArray(intent.actions)) {
    return { valid: false, reason: "Function actions must be an array" };
  }

  return { valid: true };
}

/* ── 3D Graph ── */

function validateGraph3D(intent: Graph3DIntent): ValidationResult {
  if (intent.title && !validateString(intent.title, MAX_STRING_LENGTH)) {
    return { valid: false, reason: "3D graph title exceeds length limit" };
  }

  if (intent.axes) {
    if (intent.axes.xLabel && !validateString(intent.axes.xLabel, MAX_STRING_LENGTH)) {
      return { valid: false, reason: "3D graph xLabel too long" };
    }
    if (intent.axes.yLabel && !validateString(intent.axes.yLabel, MAX_STRING_LENGTH)) {
      return { valid: false, reason: "3D graph yLabel too long" };
    }
    if (intent.axes.zLabel && !validateString(intent.axes.zLabel, MAX_STRING_LENGTH)) {
      return { valid: false, reason: "3D graph zLabel too long" };
    }
    if (intent.axes.showGrid !== undefined && typeof intent.axes.showGrid !== "boolean") {
      return { valid: false, reason: "3D graph axes.showGrid must be boolean" };
    }
  }

  if (intent.domain) {
    for (const axis of [intent.domain.x, intent.domain.y, intent.domain.z].filter(Boolean) as [number, number][]) {
      if (!Array.isArray(axis) || axis.length !== 2 || !isFiniteCoord(axis[0]) || !isFiniteCoord(axis[1]) || axis[0] >= axis[1]) {
        return { valid: false, reason: "3D graph domains must be [min, max] with min < max" };
      }
    }
  }

  if (intent.camera) {
    for (const value of [intent.camera.azimuth, intent.camera.elevation, intent.camera.distance]) {
      if (value !== undefined && (typeof value !== "number" || !isFinite(value))) {
        return { valid: false, reason: "3D graph camera values must be finite numbers" };
      }
    }
  }

  if (intent.sampling) {
    for (const [key, value] of Object.entries(intent.sampling)) {
      if (value !== undefined && (!Number.isInteger(value) || value < 4 || value > 200)) {
        return { valid: false, reason: `3D graph sampling.${key} must be an integer between 4 and 200` };
      }
    }
  }

  if (!Array.isArray(intent.surfaces)) {
    return { valid: false, reason: "3D graph surfaces must be an array" };
  }
  if (intent.surfaces.length === 0) {
    return { valid: false, reason: "3D graph must have at least one object" };
  }
  if (intent.surfaces.length > MAX_EXPRESSIONS) {
    return { valid: false, reason: `Too many 3D graph objects (max ${MAX_EXPRESSIONS})` };
  }

  const pointCloudTotal = intent.surfaces.reduce(
    (total, object) => total + (object?.kind === "point_cloud" && Array.isArray(object.points) ? object.points.length : 0),
    0
  );
  if (pointCloudTotal > MAX_DATA_POINTS * 4) {
    return { valid: false, reason: `3D graph point clouds exceed the aggregate ${MAX_DATA_POINTS * 4}-point budget` };
  }

  const ids = new Set<string>();
  for (const obj of intent.surfaces) {
    if (!obj || typeof obj !== "object" || typeof obj.kind !== "string" || typeof obj.id !== "string") {
      return { valid: false, reason: "3D graph object must have string kind and id" };
    }
    if (ids.has(obj.id)) {
      return { valid: false, reason: `Duplicate 3D graph object id: ${obj.id}` };
    }
    ids.add(obj.id);

    if ("color" in obj && obj.color !== undefined && typeof obj.color !== "string") {
      return { valid: false, reason: "3D graph color must be string" };
    }
    if ("opacity" in obj && obj.opacity !== undefined && (typeof obj.opacity !== "number" || !isFinite(obj.opacity) || obj.opacity < 0 || obj.opacity > 1)) {
      return { valid: false, reason: "3D graph opacity must be a number between 0 and 1" };
    }
    if ("renderMode" in obj && obj.renderMode !== undefined && !["surface", "wireframe", "points"].includes(obj.renderMode)) {
      return { valid: false, reason: "3D graph renderMode must be surface, wireframe, or points" };
    }

    switch (obj.kind) {
      case "surface":
        if (!validateString(obj.z, MAX_STRING_LENGTH)) {
          return { valid: false, reason: "3D graph surface z expression too long" };
        }
        break;
      case "parametric_surface":
        if (!isValidDomain(obj.uDomain) || !isValidDomain(obj.vDomain)) {
          return { valid: false, reason: "3D graph parametric surface domains must be [min, max]" };
        }
        if (![obj.x, obj.y, obj.z].every((s) => validateString(s, MAX_STRING_LENGTH))) {
          return { valid: false, reason: "3D graph parametric surface expressions too long" };
        }
        break;
      case "parametric_curve":
        if (!isValidDomain(obj.tDomain)) {
          return { valid: false, reason: "3D graph parametric curve tDomain must be [min, max]" };
        }
        if (![obj.x, obj.y, obj.z].every((s) => validateString(s, MAX_STRING_LENGTH))) {
          return { valid: false, reason: "3D graph parametric curve expressions too long" };
        }
        break;
      case "point":
        if (!Array.isArray(obj.at) || obj.at.length !== 3 || !obj.at.every((n) => typeof n === "number" && isFiniteCoord(n))) {
          return { valid: false, reason: "3D graph point must have a finite [x,y,z] position" };
        }
        if (obj.label !== undefined && !validateString(obj.label, MAX_STRING_LENGTH)) {
          return { valid: false, reason: "3D graph point label too long" };
        }
        break;
      case "point_cloud":
        if (!Array.isArray(obj.points) || obj.points.length === 0 || obj.points.length > MAX_DATA_POINTS) {
          return { valid: false, reason: `3D graph point_cloud must have 1..${MAX_DATA_POINTS} points` };
        }
        if (!obj.points.every((p) => Array.isArray(p) && p.length === 3 && p.every((n) => typeof n === "number" && isFiniteCoord(n)))) {
          return { valid: false, reason: "3D graph point_cloud points must be finite [x,y,z] triples" };
        }
        break;
      case "vector_field":
        if (![obj.xDomain, obj.yDomain, obj.zDomain].every(isValidDomain)) {
          return { valid: false, reason: "3D graph vector_field domains must be [min, max]" };
        }
        if (![obj.fx, obj.fy, obj.fz].every((s) => validateString(s, MAX_STRING_LENGTH))) {
          return { valid: false, reason: "3D graph vector_field expressions too long" };
        }
        break;
      default:
        return { valid: false, reason: `Unknown 3D graph object kind: ${(obj as { kind?: string }).kind ?? "?"}` };
    }
  }

  return { valid: true };
}

/* ── Chart ── */

function validateChart(intent: ChartIntent): ValidationResult {
  if (intent.title && !validateString(intent.title, MAX_STRING_LENGTH)) {
    return { valid: false, reason: "Chart title exceeds length limit" };
  }
  if (intent.subtitle && !validateString(intent.subtitle, MAX_STRING_LENGTH)) {
    return { valid: false, reason: "Chart subtitle too long" };
  }
  if (intent.caption && !validateString(intent.caption, MAX_STRING_LENGTH)) {
    return { valid: false, reason: "Chart caption too long" };
  }

  const validTypes = [
    "bar", "line", "scatter", "histogram", "box", "heatmap", "contour",
    "pie", "donut", "radar", "polar_line", "polar_scatter", "sankey",
    "treemap", "sunburst", "candlestick", "ohlc"
  ];
  if (!validTypes.includes(intent.chartType)) {
    return { valid: false, reason: `Invalid chart type: ${intent.chartType}` };
  }

  if (intent.palette && (!Array.isArray(intent.palette) || intent.palette.length > MAX_DATA_SERIES * 2 || !intent.palette.every((c) => typeof c === "string"))) {
    return { valid: false, reason: "Chart palette must be an array of color strings" };
  }
  if (intent.background && !validateString(intent.background, 100)) {
    return { valid: false, reason: "Chart background too long" };
  }
  if (intent.legend !== undefined && typeof intent.legend !== "boolean") {
    return { valid: false, reason: "Chart legend must be boolean" };
  }
  if (intent.tooltip !== undefined && typeof intent.tooltip !== "boolean") {
    return { valid: false, reason: "Chart tooltip must be boolean" };
  }
  if (intent.showZoom !== undefined && typeof intent.showZoom !== "boolean") {
    return { valid: false, reason: "Chart showZoom must be boolean" };
  }

  for (const [axisName, axis] of [["xAxis", intent.xAxis], ["yAxis", intent.yAxis], ["angleAxis", intent.angleAxis], ["radiusAxis", intent.radiusAxis]] as const) {
    if (!axis) continue;
    if (axis.label && !validateString(axis.label, MAX_STRING_LENGTH)) return { valid: false, reason: `${axisName} label too long` };
    if (axis.tickFormat && !validateString(axis.tickFormat, 100)) return { valid: false, reason: `${axisName} tickFormat too long` };
    if (axis.scaleType && !["linear", "log", "time", "category"].includes(axis.scaleType)) return { valid: false, reason: `${axisName} scaleType invalid` };
    if (axis.min !== undefined && !isFiniteCoord(axis.min)) return { valid: false, reason: `${axisName} min must be finite number` };
    if (axis.max !== undefined && !isFiniteCoord(axis.max)) return { valid: false, reason: `${axisName} max must be finite number` };
    if (axis.min !== undefined && axis.max !== undefined && axis.min >= axis.max) return { valid: false, reason: `${axisName} min must be less than max` };
    if (axis.categories && (!Array.isArray(axis.categories) || axis.categories.length > MAX_DATA_POINTS || !axis.categories.every((s) => typeof s === "string" && validateString(s, MAX_STRING_LENGTH)))) {
      return { valid: false, reason: `${axisName} categories must be an array of strings` };
    }
    for (const key of ["showGrid", "showAxisLine", "invert"] as const) {
      if (axis[key] !== undefined && typeof axis[key] !== "boolean") return { valid: false, reason: `${axisName} ${key} must be boolean` };
    }
  }

  if (intent.indicators && (!Array.isArray(intent.indicators) || intent.indicators.length === 0 || intent.indicators.length > MAX_DATA_POINTS)) {
    return { valid: false, reason: "Chart indicators must be a non-empty array" };
  }
  for (const indicator of intent.indicators ?? []) {
    if (typeof indicator.name !== "string" || !validateString(indicator.name, MAX_STRING_LENGTH)) return { valid: false, reason: "Chart indicator name too long" };
    if (indicator.min !== undefined && !isFiniteCoord(indicator.min)) return { valid: false, reason: "Chart indicator min must be finite number" };
    if (indicator.max !== undefined && !isFiniteCoord(indicator.max)) return { valid: false, reason: "Chart indicator max must be finite number" };
  }

  if (intent.annotations && (!Array.isArray(intent.annotations) || intent.annotations.length > MAX_OBJECTS)) {
    return { valid: false, reason: `Chart annotations must be an array with at most ${MAX_OBJECTS} items` };
  }
  for (const ann of intent.annotations ?? []) {
    if (!ann || typeof ann !== "object" || typeof ann.kind !== "string") return { valid: false, reason: "Chart annotation invalid" };
    if (ann.kind === "label") {
      if (!validateString(ann.text, MAX_STRING_LENGTH) || !isFiniteCoord(ann.x) || !isFiniteCoord(ann.y)) return { valid: false, reason: "Chart label annotation invalid" };
    } else if (ann.kind === "line") {
      if (ann.x === undefined && ann.y === undefined) return { valid: false, reason: "Chart line annotation must provide x or y" };
      if (ann.x !== undefined && !isFiniteCoord(ann.x)) return { valid: false, reason: "Chart line annotation x must be finite" };
      if (ann.y !== undefined && !isFiniteCoord(ann.y)) return { valid: false, reason: "Chart line annotation y must be finite" };
    } else if (ann.kind === "region") {
      for (const val of [ann.x0, ann.x1, ann.y0, ann.y1].filter((v) => v !== undefined) as number[]) if (!isFiniteCoord(val)) return { valid: false, reason: "Chart region annotation bounds must be finite" };
    } else {
      return { valid: false, reason: `Unknown chart annotation kind: ${(ann as {kind?: string}).kind ?? '?'}` };
    }
  }

  if (intent.viewport) {
    for (const [k, v] of Object.entries(intent.viewport)) {
      if (v !== undefined && (typeof v !== "number" || !Number.isFinite(v))) return { valid: false, reason: `Chart viewport ${k} must be finite number` };
    }
  }

  if (intent.series !== undefined && !Array.isArray(intent.series)) {
    return { valid: false, reason: "Chart series must be an array" };
  }
  if (intent.data !== undefined && !Array.isArray(intent.data)) {
    return { valid: false, reason: "Legacy chart data must be an array" };
  }

  const hasExplicitSeries = Array.isArray(intent.series) && intent.series.length > 0;
  let series: any[];
  if (hasExplicitSeries) {
    series = intent.series as any[];
  } else {
    if (!Array.isArray(intent.data) || intent.data.length === 0) {
      return { valid: false, reason: "Chart must have at least one series" };
    }
    if (!["bar", "line", "scatter"].includes(intent.chartType)) {
      return { valid: false, reason: `Legacy chart data is only supported for bar, line, and scatter charts` };
    }
    if (intent.data.length > MAX_DATA_SERIES) {
      return { valid: false, reason: `Too many data series (max ${MAX_DATA_SERIES})` };
    }
    for (const item of intent.data as any[]) {
      if (!item || typeof item.id !== "string" || !validateString(item.id, MAX_STRING_LENGTH)) {
        return { valid: false, reason: "Legacy chart data series must have an id" };
      }
      if (typeof item.label !== "string" || !validateString(item.label, MAX_STRING_LENGTH)) {
        return { valid: false, reason: "Legacy chart data series must have a label" };
      }
      if (!Array.isArray(item.values)) {
        return { valid: false, reason: "Legacy chart data values must be an array" };
      }
    }
    series = intent.data.map((item) => intent.chartType === "scatter"
      ? { kind: "scatter", id: item.id, name: item.label, points: item.values.map((value, index) => [index, value]) }
      : { kind: intent.chartType, id: item.id, name: item.label, values: item.values });
  }

  if (series.length === 0) {
    return { valid: false, reason: "Chart must have at least one series" };
  }
  if (series.length > MAX_DATA_SERIES) {
    return { valid: false, reason: `Too many data series (max ${MAX_DATA_SERIES})` };
  }

  const ids = new Set<string>();
  for (const seriesItem of series) {
    if (!seriesItem || typeof seriesItem !== "object" || typeof seriesItem.kind !== "string") {
      return { valid: false, reason: "Chart series must have a kind" };
    }
    if (seriesItem.kind !== intent.chartType) {
      return { valid: false, reason: `Chart type ${intent.chartType} requires ${intent.chartType} series, received ${seriesItem.kind}` };
    }
    if (!seriesItem.id || typeof seriesItem.id !== "string" || !validateString(seriesItem.id, MAX_STRING_LENGTH)) {
      return { valid: false, reason: "Chart series missing id" };
    }
    if (ids.has(seriesItem.id)) return { valid: false, reason: `Duplicate series id: ${seriesItem.id}` };
    ids.add(seriesItem.id);
    if ("name" in seriesItem && seriesItem.name !== undefined && !validateString(String(seriesItem.name), MAX_STRING_LENGTH)) return { valid: false, reason: "Chart series name too long" };
    if ("color" in seriesItem && seriesItem.color !== undefined && typeof seriesItem.color !== "string") return { valid: false, reason: "Chart series color must be string" };
    if ("opacity" in seriesItem && seriesItem.opacity !== undefined && (typeof seriesItem.opacity !== "number" || !isFinite(seriesItem.opacity) || seriesItem.opacity < 0 || seriesItem.opacity > 1)) return { valid: false, reason: "Chart series opacity must be between 0 and 1" };

    switch (seriesItem.kind) {
      case "bar":
      case "line":
        if (!isFiniteNumberArray(seriesItem.values, true)) return { valid: false, reason: `${seriesItem.kind} series values must contain 1..${MAX_DATA_POINTS} finite numbers` };
        break;
      case "scatter":
      case "polar_line":
      case "polar_scatter":
        if (!isFiniteTupleArray(seriesItem.points, 2, true)) return { valid: false, reason: `${seriesItem.kind} series points must contain 1..${MAX_DATA_POINTS} finite [x,y] pairs` };
        break;
      case "histogram":
      case "box":
        if (!isFiniteNumberArray(seriesItem.values, true)) return { valid: false, reason: `${seriesItem.kind} series values must contain 1..${MAX_DATA_POINTS} finite numbers` };
        break;
      case "heatmap":
      case "contour": {
        const providesPoints = seriesItem.points !== undefined;
        const providesGrid = seriesItem.grid !== undefined;
        if (providesPoints === providesGrid) {
          return { valid: false, reason: `${seriesItem.kind} series must provide exactly one of points or grid` };
        }
        if (providesPoints) {
          if (!isFiniteTupleArray(seriesItem.points, 3, true)) return { valid: false, reason: `${seriesItem.kind} points must contain 1..${MAX_DATA_POINTS} finite [x,y,value] triples` };
          if (seriesItem.kind === "contour") {
            const uniqueX = new Set(seriesItem.points.map((point: number[]) => point[0])).size;
            const uniqueY = new Set(seriesItem.points.map((point: number[]) => point[1])).size;
            if (uniqueX < 2 || uniqueY < 2) return { valid: false, reason: "Contour points require at least two distinct x and y coordinates" };
          }
        } else {
          const grid = seriesItem.grid;
          if (!grid || !isFiniteNumberArray(grid.x, true) || !isFiniteNumberArray(grid.y, true)) {
            return { valid: false, reason: `${seriesItem.kind} grid axes must be non-empty finite arrays` };
          }
          if (grid.x.length * grid.y.length > MAX_DATA_POINTS) {
            return { valid: false, reason: `${seriesItem.kind} grid exceeds ${MAX_DATA_POINTS} cells` };
          }
          if (!Array.isArray(grid.values) || grid.values.length !== grid.y.length || !grid.values.every((row: unknown) => Array.isArray(row) && row.length === grid.x.length && row.every((value) => typeof value === "number" && isFinite(value)))) {
            return { valid: false, reason: `${seriesItem.kind} grid values must be a finite rectangular y-by-x matrix` };
          }
          if (seriesItem.kind === "contour" && (grid.x.length < 2 || grid.y.length < 2)) {
            return { valid: false, reason: "Contour grid requires at least two x and y coordinates" };
          }
        }
        break;
      }
      case "pie":
      case "donut":
        if (!Array.isArray(seriesItem.slices) || seriesItem.slices.length === 0 || seriesItem.slices.length > MAX_DATA_POINTS) return { valid: false, reason: `${seriesItem.kind} series slices must be a non-empty array` };
        if (!seriesItem.slices.every((slice: any) => typeof slice.name === "string" && validateString(slice.name, MAX_STRING_LENGTH) && typeof slice.value === "number" && isFinite(slice.value) && slice.value >= 0)) return { valid: false, reason: `${seriesItem.kind} slices must have names and non-negative finite values` };
        break;
      case "radar":
        if (!isFiniteNumberArray(seriesItem.values, true)) return { valid: false, reason: "Radar series values invalid" };
        if (!intent.indicators || seriesItem.values.length !== intent.indicators.length) return { valid: false, reason: "Radar series values must match the indicator count" };
        break;
      case "sankey": {
        if (!Array.isArray(seriesItem.nodes) || seriesItem.nodes.length === 0 || seriesItem.nodes.length > MAX_NODES || !Array.isArray(seriesItem.links) || seriesItem.links.length > MAX_EDGES) {
          return { valid: false, reason: `Sankey series must have 1..${MAX_NODES} nodes and at most ${MAX_EDGES} links` };
        }
        const nodeIds = new Set<string>();
        for (const node of seriesItem.nodes) {
          if (!node || typeof node.id !== "string" || !validateString(node.id, MAX_STRING_LENGTH) || nodeIds.has(node.id)) return { valid: false, reason: "Sankey nodes require unique string ids" };
          if (node.name !== undefined && !validateString(node.name, MAX_STRING_LENGTH)) return { valid: false, reason: "Sankey node name too long" };
          nodeIds.add(node.id);
        }
        if (!seriesItem.links.every((link: any) => link && nodeIds.has(link.source) && nodeIds.has(link.target) && typeof link.value === "number" && isFinite(link.value) && link.value >= 0)) {
          return { valid: false, reason: "Sankey links must reference nodes and have non-negative finite values" };
        }
        break;
      }
      case "treemap":
      case "sunburst": {
        const treeResult = validateChartTree(seriesItem.nodes);
        if (!treeResult.valid) return treeResult;
        break;
      }
      case "candlestick":
      case "ohlc":
        if (!isFiniteTupleArray(seriesItem.candles, 4, true)) return { valid: false, reason: `${seriesItem.kind} candles must contain 1..${MAX_DATA_POINTS} finite OHLC tuples` };
        break;
      default:
        return { valid: false, reason: `Unknown chart series kind: ${seriesItem.kind}` };
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

/* ── Physics ── */

function validatePhysics(intent: PhysicsIntent): ValidationResult {
  if (intent.title && !validateString(intent.title, MAX_STRING_LENGTH)) {
    return { valid: false, reason: "Physics title exceeds length limit" };
  }
  if (!validateString(intent.variant, 50)) {
    return { valid: false, reason: "Physics variant missing or too long" };
  }
  if (intent.caption && !validateString(intent.caption, MAX_STRING_LENGTH)) {
    return { valid: false, reason: "Physics caption too long" };
  }
  if (intent.bodies && (!Array.isArray(intent.bodies) || intent.bodies.length > MAX_OBJECTS)) {
    return { valid: false, reason: `Physics bodies must be an array with at most ${MAX_OBJECTS} items` };
  }
  if (intent.vectors && (!Array.isArray(intent.vectors) || intent.vectors.length > MAX_OBJECTS)) {
    return { valid: false, reason: `Physics vectors must be an array with at most ${MAX_OBJECTS} items` };
  }
  if (intent.optics && (!Array.isArray(intent.optics) || intent.optics.length > MAX_OBJECTS)) {
    return { valid: false, reason: `Physics optics must be an array with at most ${MAX_OBJECTS} items` };
  }
  if (intent.rays && (!Array.isArray(intent.rays) || intent.rays.length > MAX_OBJECTS)) {
    return { valid: false, reason: `Physics rays must be an array with at most ${MAX_OBJECTS} items` };
  }
  if (intent.decorations && (!Array.isArray(intent.decorations) || intent.decorations.length > MAX_OBJECTS)) {
    return { valid: false, reason: `Physics decorations must be an array with at most ${MAX_OBJECTS} items` };
  }
  for (const body of intent.bodies ?? []) {
    if (typeof body.id !== "string") return { valid: false, reason: "Physics body missing id" };
    if (!Array.isArray(body.at) || body.at.length !== 2 || !body.at.every((n) => isFiniteCoord(n))) return { valid: false, reason: "Physics body at must be [x,y] finite" };
    if (body.width !== undefined && (!isFiniteCoord(body.width) || body.width <= 0)) return { valid: false, reason: "Physics body width must be positive" };
    if (body.height !== undefined && (!isFiniteCoord(body.height) || body.height <= 0)) return { valid: false, reason: "Physics body height must be positive" };
  }
  for (const vector of intent.vectors ?? []) {
    if (typeof vector.id !== "string") return { valid: false, reason: "Physics vector missing id" };
    const fromOk = typeof vector.from === "string" || (Array.isArray(vector.from) && vector.from.length === 2 && vector.from.every((n) => isFiniteCoord(n)));
    if (!fromOk) return { valid: false, reason: "Physics vector from must be body id or [x,y]" };
    const toOk = vector.to === undefined || (Array.isArray(vector.to) && vector.to.length === 2 && vector.to.every((n) => isFiniteCoord(n)));
    if (!toOk) return { valid: false, reason: "Physics vector to must be [x,y] when provided" };
    const hasDelta = typeof vector.dx === "number" && typeof vector.dy === "number" && isFiniteCoord(vector.dx) && isFiniteCoord(vector.dy);
    if (!vector.to && !hasDelta) {
      return { valid: false, reason: "Physics vector must provide to or both finite dx and dy" };
    }
  }
  for (const optic of intent.optics ?? []) {
    if (typeof optic.id !== "string" || !["lens", "mirror", "screen", "focal_plane"].includes(optic.kind)) return { valid: false, reason: "Physics optic invalid" };
    if (!isFiniteCoord(optic.atX)) return { valid: false, reason: "Physics optic atX must be finite" };
  }
  for (const ray of intent.rays ?? []) {
    if (typeof ray.id !== "string") return { valid: false, reason: "Physics ray missing id" };
    for (const pt of [ray.from, ray.via, ray.to].filter(Boolean) as [number, number][]) {
      if (!Array.isArray(pt) || pt.length !== 2 || !pt.every((n) => isFiniteCoord(n))) return { valid: false, reason: "Physics ray points must be finite [x,y]" };
    }
    if (ray.dashed !== undefined && typeof ray.dashed !== "boolean") return { valid: false, reason: "Physics ray dashed must be boolean" };
  }
  for (const decoration of intent.decorations ?? []) {
    if (typeof decoration.id !== "string") return { valid: false, reason: "Physics decoration missing id" };
    switch (decoration.kind) {
      case "ground":
        if (![decoration.fromX, decoration.toX, decoration.y].every((n) => isFiniteCoord(n))) return { valid: false, reason: "Physics ground decoration coordinates must be finite" };
        break;
      case "incline":
        if ((!Array.isArray(decoration.base) || decoration.base.length !== 2 || !decoration.base.every((n) => isFiniteCoord(n))) || !isFiniteCoord(decoration.dx) || !isFiniteCoord(decoration.dy)) {
          return { valid: false, reason: "Physics incline decoration must have finite base/dx/dy" };
        }
        break;
      case "spring": {
        const fromOk = typeof decoration.from === "string" || (Array.isArray(decoration.from) && decoration.from.length === 2 && decoration.from.every((n) => isFiniteCoord(n)));
        const toOk = typeof decoration.to === "string" || (Array.isArray(decoration.to) && decoration.to.length === 2 && decoration.to.every((n) => isFiniteCoord(n)));
        if (!fromOk || !toOk) return { valid: false, reason: "Physics spring decoration must have valid from/to" };
        break;
      }
      case "pivot":
        if (!(typeof decoration.at === "string" || (Array.isArray(decoration.at) && decoration.at.length === 2 && decoration.at.every((n) => isFiniteCoord(n))))) {
          return { valid: false, reason: "Physics pivot decoration must have valid at" };
        }
        break;
      case "axis":
        if (![decoration.from, decoration.to].every((pt) => Array.isArray(pt) && pt.length === 2 && pt.every((n) => isFiniteCoord(n)))) {
          return { valid: false, reason: "Physics axis decoration must have finite from/to" };
        }
        break;
    }
  }
  return { valid: true };
}

/* ── Biology ── */

function validateBiology(intent: BiologyIntent): ValidationResult {
  if (intent.title && !validateString(intent.title, MAX_STRING_LENGTH)) {
    return { valid: false, reason: "Biology title exceeds length limit" };
  }
  if (!validateString(intent.variant, 50)) {
    return { valid: false, reason: "Biology variant missing or too long" };
  }
  if (intent.caption && !validateString(intent.caption, MAX_STRING_LENGTH)) {
    return { valid: false, reason: "Biology caption too long" };
  }
  if (intent.layout && !["preset", "breadthfirst", "circle", "concentric", "grid", "cose"].includes(intent.layout)) {
    return { valid: false, reason: "Biology layout must be preset, breadthfirst, circle, concentric, grid, or cose" };
  }
  if (intent.style) {
    if (intent.style.directed !== undefined && typeof intent.style.directed !== "boolean") return { valid: false, reason: "Biology style.directed must be boolean" };
    if (intent.style.nodeColorByKind !== undefined && typeof intent.style.nodeColorByKind !== "boolean") return { valid: false, reason: "Biology style.nodeColorByKind must be boolean" };
    if (intent.style.compact !== undefined && typeof intent.style.compact !== "boolean") return { valid: false, reason: "Biology style.compact must be boolean" };
  }
  if (intent.structures && (!Array.isArray(intent.structures) || intent.structures.length > MAX_OBJECTS)) {
    return { valid: false, reason: `Biology structures must be an array with at most ${MAX_OBJECTS} items` };
  }
  if (intent.connections && (!Array.isArray(intent.connections) || intent.connections.length > MAX_EDGES)) {
    return { valid: false, reason: `Biology connections must be an array with at most ${MAX_EDGES} items` };
  }
  const ids = new Set<string>();
  for (const s of intent.structures ?? []) {
    if (typeof s.id !== "string" || typeof s.label !== "string") return { valid: false, reason: "Biology structure must have id and label" };
    if (!Array.isArray(s.at) || s.at.length !== 2 || !s.at.every((n) => isFiniteCoord(n))) return { valid: false, reason: "Biology structure at must be [x,y] finite" };
    ids.add(s.id);
  }
  for (const c of intent.connections ?? []) {
    if (typeof c.from !== "string" || typeof c.to !== "string") return { valid: false, reason: "Biology connection must have from/to" };
    if (ids.size > 0 && (!ids.has(c.from) || !ids.has(c.to))) return { valid: false, reason: "Biology connection references unknown structure" };
  }
  return { valid: true };
}

/* ── Circuit ── */

function validateCircuit(intent: CircuitIntent): ValidationResult {
  if (intent.title && !validateString(intent.title, MAX_STRING_LENGTH)) {
    return { valid: false, reason: "Circuit title exceeds length limit" };
  }
  if (intent.caption && !validateString(intent.caption, MAX_STRING_LENGTH)) {
    return { valid: false, reason: "Circuit caption too long" };
  }
  if (!Array.isArray(intent.nodes)) {
    return { valid: false, reason: "Circuit nodes must be an array" };
  }
  if (!Array.isArray(intent.wires)) {
    return { valid: false, reason: "Circuit wires must be an array" };
  }
  if (!Array.isArray(intent.components)) {
    return { valid: false, reason: "Circuit components must be an array" };
  }
  if (intent.nodes.length > MAX_OBJECTS || intent.wires.length > MAX_EDGES || intent.components.length > MAX_OBJECTS) {
    return { valid: false, reason: "Circuit intent exceeds size limits" };
  }
  const ids = new Set<string>();
  for (const node of intent.nodes) {
    if (typeof node.id !== "string" || !Array.isArray(node.at) || node.at.length !== 2 || !node.at.every((n) => isFiniteCoord(n))) {
      return { valid: false, reason: "Circuit node must have id and finite [x,y]" };
    }
    ids.add(node.id);
  }
  for (const wire of intent.wires) {
    if (typeof wire.id !== "string" || typeof wire.from !== "string" || typeof wire.to !== "string") {
      return { valid: false, reason: "Circuit wire must have id/from/to" };
    }
    if (!ids.has(wire.from) || !ids.has(wire.to)) {
      return { valid: false, reason: "Circuit wire references unknown node" };
    }
  }
  for (const component of intent.components) {
    if (typeof component.id !== "string") return { valid: false, reason: "Circuit component missing id" };
    if (component.kind === "ground") {
      if (!ids.has(component.at)) return { valid: false, reason: "Circuit ground references unknown node" };
    } else if (!ids.has(component.between[0]) || !ids.has(component.between[1])) {
      return { valid: false, reason: "Circuit component references unknown node" };
    }
  }
  return { valid: true };
}

/* ── Chemistry ── */

function validateChemistry(intent: ChemistryIntent): ValidationResult {
  if (intent.title && !validateString(intent.title, MAX_STRING_LENGTH)) {
    return { valid: false, reason: "Chemistry title exceeds length limit" };
  }
  if (intent.caption && !validateString(intent.caption, MAX_STRING_LENGTH)) {
    return { valid: false, reason: "Chemistry caption too long" };
  }
  if (intent.variant && !validateString(intent.variant, 50)) {
    return { valid: false, reason: "Chemistry variant too long" };
  }
  if (intent.molecule && !validateString(intent.molecule, MAX_STRING_LENGTH)) {
    return { valid: false, reason: "Molecule string too long" };
  }
  if (intent.reaction && !validateString(intent.reaction, MAX_STRING_LENGTH)) {
    return { valid: false, reason: "Reaction string too long" };
  }
  if (intent.agents) {
    if (!Array.isArray(intent.agents) || !intent.agents.every((s) => typeof s === "string" && validateString(s, MAX_STRING_LENGTH))) {
      return { valid: false, reason: "Chemistry agents must be an array of strings" };
    }
  }
  if (intent.atoms && (!Array.isArray(intent.atoms) || intent.atoms.length > MAX_OBJECTS)) {
    return { valid: false, reason: `Chemistry atoms must be an array with at most ${MAX_OBJECTS} items` };
  }
  if (intent.bonds && (!Array.isArray(intent.bonds) || intent.bonds.length > MAX_EDGES)) {
    return { valid: false, reason: `Chemistry bonds must be an array with at most ${MAX_EDGES} items` };
  }
  const speciesLists = [intent.reactants ?? [], intent.products ?? []];
  for (const species of speciesLists.flat()) {
    if (typeof species.id !== "string") return { valid: false, reason: "Chemistry species must have id" };
    if (species.molecule !== undefined && !validateString(species.molecule, MAX_STRING_LENGTH)) return { valid: false, reason: "Chemistry species molecule too long" };
    if (species.label !== undefined && !validateString(species.label, MAX_STRING_LENGTH)) return { valid: false, reason: "Chemistry species label too long" };
    const sub = validateChemistry({ type: "chemistry", atoms: species.atoms, bonds: species.bonds, molecule: species.molecule });
    if (!sub.valid) return { valid: false, reason: `Chemistry species ${species.id}: ${sub.reason}` };
  }
  const ids = new Set<string>();
  for (const atom of intent.atoms ?? []) {
    if (typeof atom.id !== "string" || typeof atom.element !== "string") return { valid: false, reason: "Chemistry atom must have id and element" };
    if (!Array.isArray(atom.at) || atom.at.length !== 2 || !atom.at.every((n) => isFiniteCoord(n))) return { valid: false, reason: "Chemistry atom at must be [x,y] finite" };
    ids.add(atom.id);
  }
  for (const bond of intent.bonds ?? []) {
    if (typeof bond.from !== "string" || typeof bond.to !== "string") return { valid: false, reason: "Chemistry bond must have from/to" };
    if (ids.size > 0 && (!ids.has(bond.from) || !ids.has(bond.to))) return { valid: false, reason: "Chemistry bond references unknown atom" };
    if (bond.order !== undefined && ![1, 2, 3].includes(bond.order)) return { valid: false, reason: "Chemistry bond order must be 1, 2, or 3" };
  }
  return { valid: true };
}

/* ── Graph Theory ── */

function validateGraphTheory(intent: GraphTheoryIntent): ValidationResult {
  if (intent.title && !validateString(intent.title, MAX_STRING_LENGTH)) {
    return { valid: false, reason: "Graph theory title exceeds length limit" };
  }
  if (intent.caption && !validateString(intent.caption, MAX_STRING_LENGTH)) {
    return { valid: false, reason: "Graph theory caption too long" };
  }
  if (intent.layout && !["preset", "breadthfirst", "circle", "concentric", "grid", "cose"].includes(intent.layout)) {
    return { valid: false, reason: "Graph theory layout invalid" };
  }
  if (intent.directed !== undefined && typeof intent.directed !== "boolean") {
    return { valid: false, reason: "Graph theory directed must be boolean" };
  }
  if (intent.style) {
    if (intent.style.compact !== undefined && typeof intent.style.compact !== "boolean") return { valid: false, reason: "Graph theory style.compact must be boolean" };
    if (intent.style.showLabels !== undefined && typeof intent.style.showLabels !== "boolean") return { valid: false, reason: "Graph theory style.showLabels must be boolean" };
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
    if (node.color !== undefined && typeof node.color !== 'string') return { valid: false, reason: 'Graph node color must be string' };
    if (node.shape !== undefined && !["ellipse", "round-rectangle", "rectangle", "diamond", "hexagon", "triangle"].includes(node.shape)) return { valid: false, reason: 'Graph node shape invalid' };
    if (node.size !== undefined && (typeof node.size !== 'number' || !isFiniteCoord(node.size) || node.size <= 0)) return { valid: false, reason: 'Graph node size must be positive number' };
    if (node.at !== undefined && (!Array.isArray(node.at) || node.at.length !== 2 || !node.at.every((n) => isFiniteCoord(n)))) return { valid: false, reason: 'Graph node at must be [x,y] finite' };
    if (node.locked !== undefined && typeof node.locked !== 'boolean') return { valid: false, reason: 'Graph node locked must be boolean' };
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
    if (edge.color !== undefined && typeof edge.color !== 'string') return { valid: false, reason: 'Graph edge color must be string' };
    if (edge.width !== undefined && (typeof edge.width !== 'number' || !isFiniteCoord(edge.width) || edge.width <= 0)) return { valid: false, reason: 'Graph edge width must be positive number' };
    if (edge.style !== undefined && !['solid', 'dashed', 'dotted'].includes(edge.style)) return { valid: false, reason: 'Graph edge style invalid' };
    if (edge.directed !== undefined && typeof edge.directed !== 'boolean') return { valid: false, reason: 'Graph edge directed must be boolean' };
    if (edge.curvature !== undefined && (typeof edge.curvature !== 'number' || !isFinite(edge.curvature))) return { valid: false, reason: 'Graph edge curvature must be finite number' };
  }

  return { valid: true };
}

/* ── Helpers ── */

function isFiniteNumberArray(value: unknown, nonEmpty = false): value is number[] {
  return Array.isArray(value)
    && (!nonEmpty || value.length > 0)
    && value.length <= MAX_DATA_POINTS
    && value.every((item) => typeof item === "number" && isFinite(item));
}

function isFiniteTupleArray(value: unknown, width: number, nonEmpty = false): value is number[][] {
  return Array.isArray(value)
    && (!nonEmpty || value.length > 0)
    && value.length <= MAX_DATA_POINTS
    && value.every((tuple) => Array.isArray(tuple) && tuple.length === width && tuple.every((item) => typeof item === "number" && isFinite(item)));
}

function validateChartTree(roots: unknown): ValidationResult {
  if (!Array.isArray(roots) || roots.length === 0) {
    return { valid: false, reason: "Tree chart nodes must be non-empty" };
  }
  const seen = new WeakSet<object>();
  const stack = roots.map((node) => ({ node, depth: 1 }));
  let count = 0;
  while (stack.length > 0) {
    const { node, depth } = stack.pop()!;
    if (!node || typeof node !== "object" || seen.has(node)) return { valid: false, reason: "Tree chart contains an invalid or repeated node" };
    seen.add(node);
    count += 1;
    if (count > MAX_DATA_POINTS) return { valid: false, reason: `Tree chart exceeds ${MAX_DATA_POINTS} nodes` };
    if (depth > 20) return { valid: false, reason: "Tree chart exceeds maximum depth of 20" };
    const item = node as { name?: unknown; value?: unknown; color?: unknown; children?: unknown };
    if (typeof item.name !== "string" || !validateString(item.name, MAX_STRING_LENGTH)) return { valid: false, reason: "Tree chart node name invalid" };
    if (item.value !== undefined && (typeof item.value !== "number" || !isFinite(item.value) || item.value < 0)) return { valid: false, reason: "Tree chart node value must be a non-negative finite number" };
    if (item.color !== undefined && typeof item.color !== "string") return { valid: false, reason: "Tree chart node color must be string" };
    if (item.children !== undefined) {
      if (!Array.isArray(item.children)) return { valid: false, reason: "Tree chart children must be an array" };
      for (const child of item.children) stack.push({ node: child, depth: depth + 1 });
    }
  }
  return { valid: true };
}

function validateString(s: string, maxLen: number): boolean {
  return typeof s === "string" && s.length <= maxLen;
}

function validateDisplayMode(mode: VisualizationDisplayMode | undefined): boolean {
  return mode === undefined || mode === "graph" || mode === "graphless";
}

function isValidDomain(axis: unknown): axis is [number, number] {
  return Array.isArray(axis) && axis.length === 2 && isFiniteCoord(axis[0]) && isFiniteCoord(axis[1]) && axis[0] < axis[1];
}

function isFiniteCoord(n: number): boolean {
  return (
    typeof n === "number" && isFinite(n) && n >= COORD_MIN && n <= COORD_MAX
  );
}
