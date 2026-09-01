/**
 * Figure-spec dispatcher.
 *
 * A `FigureSpec` is a concept-level intent; `compile()` turns it into the
 * `AnimationScene` primitive list that the existing chalkboard `SceneFigure`
 * renderer (in `WidgetSurface.tsx`) already consumes. No new render path,
 * no new render code — just a higher-level sugar that lets the agent (and
 * the OCR pipeline, see `ocrInfer.ts`) reason about figures in their
 * textbook vocabulary.
 *
 * Every compiler is fail-closed: an out-of-range number, an unsupported
 * expression, or a too-many-elements spec throws, and the caller (the
 * validator in `validate.ts` or the OCR pipeline) can react. The dispatcher
 * enforces `MAX_FIGURE_ELEMENTS = 24` against the produced `AnimationScene`,
 * mirroring `MAX_SCENE_ELEMENTS` in `lib/widgets/validate.ts`.
 */

import type { AnimationScene } from "../widgets/types";
import { MAX_FIGURE_ELEMENTS } from "./types";
import type { FigureSpec } from "./types";
import { compileUnitCircle } from "./specs/unitCircle";
import { compileTrigGraph } from "./specs/trigGraph";
import { compileParabola } from "./specs/parabola";
import { compilePolynomialGraph } from "./specs/polynomialGraph";
import { compileSecantTangent } from "./specs/secantTangent";
import { compileLimitGraph } from "./specs/limitGraph";
import { compileShadedArea } from "./specs/shadedArea";
import { compileVector } from "./specs/vector";
import { compileRightTriangle } from "./specs/rightTriangle";
import { compileCoordinatePlane } from "./specs/coordinatePlane";
import { compileFlowchart } from "./specs/flowchart";
import { compileFreeBodyDiagram } from "./specs/freeBodyDiagram";

export type { FigureSpec } from "./types";
export {
  FIGURE_KINDS,
  COORD_MAX,
  MAX_FIGURE_EXPRESSION,
  MAX_FIGURE_ELEMENTS,
  MAX_FIGURE_DECLARED,
} from "./types";

/** Thrown by per-kind compilers when a spec fails its internal bounds. The
 *  outer validator may want to convert these into a `fail()` reason string
 *  for the agent's repair loop. */
export class FigureSpecCompileError extends Error {
  constructor(public readonly kind: FigureSpec["kind"], message: string) {
    super(message);
    this.name = "FigureSpecCompileError";
  }
}

export function compile(spec: FigureSpec): AnimationScene {
  let scene: AnimationScene;
  switch (spec.kind) {
    case "unitCircle":
      scene = compileUnitCircle(spec);
      break;
    case "trigGraph":
      scene = compileTrigGraph(spec);
      break;
    case "parabola":
      scene = compileParabola(spec);
      break;
    case "polynomialGraph":
      scene = compilePolynomialGraph(spec);
      break;
    case "secantTangent":
      scene = compileSecantTangent(spec);
      break;
    case "limitGraph":
      scene = compileLimitGraph(spec);
      break;
    case "shadedArea":
      scene = compileShadedArea(spec);
      break;
    case "vector":
      scene = compileVector(spec);
      break;
    case "rightTriangle":
      scene = compileRightTriangle(spec);
      break;
    case "coordinatePlane":
      scene = compileCoordinatePlane(spec);
      break;
    case "flowchart":
      scene = compileFlowchart(spec);
      break;
    case "freeBodyDiagram":
      scene = compileFreeBodyDiagram(spec);
      break;
    default: {
      // exhaustiveness check — `spec.kind` is `never` here.
      const exhaustive: never = spec;
      throw new FigureSpecCompileError((exhaustive as FigureSpec).kind, "unknown figure kind");
    }
  }
  if (scene.elements.length > MAX_FIGURE_ELEMENTS) {
    throw new FigureSpecCompileError(
      spec.kind,
      `figure produces ${scene.elements.length} scene elements, max is ${MAX_FIGURE_ELEMENTS}`
    );
  }
  return scene;
}