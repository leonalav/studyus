/**
 * Generic coordinate-plane compiler.
 *
 * Emits the xDomain/yDomain viewport plus a `point` primitive per declared
 * point, with optional labels. This is the "scatter plot" figure.
 */

import type { AnimationScene, AnimationSceneElement } from "../../widgets/types";
import type { CoordinatePlaneSpec } from "../types";

export function compileCoordinatePlane(spec: CoordinatePlaneSpec): AnimationScene {
  const accent = spec.accent ?? "accent";
  const elements: AnimationSceneElement[] = [];

  for (let i = 0; i < spec.points.length; i += 1) {
    const p = spec.points[i];
    elements.push({
      kind: "point",
      id: `p-${i}`,
      xExpression: `${p.x}`,
      yExpression: `${p.y}`,
      label: spec.showLabels === false ? undefined : (p.labelLatex ?? p.label),
      accent,
    });
  }

  return {
    xDomain: spec.xRange,
    yDomain: spec.yRange,
    xLabel: "x",
    yLabel: "y",
    showGrid: true,
    elements,
  };
}