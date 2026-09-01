/**
 * Single-vector compiler.
 *
 * Emits one arrow from `origin` to `tip`, with the supplied label.
 */

import type { AnimationScene, AnimationSceneElement } from "../../widgets/types";
import type { VectorSpec } from "../types";

export function compileVector(spec: VectorSpec): AnimationScene {
  const accent = spec.accent ?? "accent";
  const elements: AnimationSceneElement[] = [
    {
      kind: "arrow",
      id: "vec",
      from: { x: spec.origin[0], y: spec.origin[1] },
      to: { x: spec.tip[0], y: spec.tip[1] },
      label: spec.label ?? (spec.labelLatex ? `(${spec.labelLatex})` : undefined),
      accent,
      // Note: SceneArrow does not carry style — style is defined on the spec for
      // completeness but has no effect on the arrow's rendering.
    },
  ];

  // include the origin and tip as labeled points so the figure reads as a
  // vector embedded in a coordinate plane rather than floating in space.
  elements.push({
    kind: "point",
    id: "tail",
    xExpression: `${spec.origin[0]}`,
    yExpression: `${spec.origin[1]}`,
    accent,
  });
  elements.push({
    kind: "point",
    id: "head",
    xExpression: `${spec.tip[0]}`,
    yExpression: `${spec.tip[1]}`,
    accent,
  });

  const pad = 0.5;
  const xMin = Math.min(spec.origin[0], spec.tip[0]) - pad;
  const xMax = Math.max(spec.origin[0], spec.tip[0]) + pad;
  const yMin = Math.min(spec.origin[1], spec.tip[1]) - pad;
  const yMax = Math.max(spec.origin[1], spec.tip[1]) + pad;

  return {
    xDomain: [xMin, xMax],
    yDomain: [yMin, yMax],
    showGrid: true,
    elements,
  };
}