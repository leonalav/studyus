/**
 * Free-body-diagram compiler.
 *
 * Emits a body (block or sphere) as four corner points (or a single point
 * for the sphere) at `at`, with one arrow per force. Each arrow's magnitude
 * is mapped to a fixed scene-unit length, scaled against the largest force
 * so the strongest force fills the body.
 */

import type { AnimationScene, AnimationSceneElement } from "../../widgets/types";
import type { FreeBodyDiagramSpec } from "../types";

export function compileFreeBodyDiagram(spec: FreeBodyDiagramSpec): AnimationScene {
  const accent = spec.accent ?? "accent";
  const at = spec.at ?? [0, 0];
  const w = spec.width ?? 1;
  const h = spec.height ?? 1;
  const elements: AnimationSceneElement[] = [];

  // Body outline (block: rectangle, sphere: a single centre dot).
  if (spec.body === "block") {
    const corners: Array<[[number, number], [number, number]]> = [
      [[at[0] - w / 2, at[1] - h / 2], [at[0] + w / 2, at[1] - h / 2]],
      [[at[0] + w / 2, at[1] - h / 2], [at[0] + w / 2, at[1] + h / 2]],
      [[at[0] + w / 2, at[1] + h / 2], [at[0] - w / 2, at[1] + h / 2]],
      [[at[0] - w / 2, at[1] + h / 2], [at[0] - w / 2, at[1] - h / 2]],
    ];
    for (let i = 0; i < corners.length; i += 1) {
      elements.push({
        kind: "segment",
        id: `body-${i}`,
        from: { x: corners[i][0][0], y: corners[i][0][1] },
        to: { x: corners[i][1][0], y: corners[i][1][1] },
        accent: "chalk",
      });
    }
  } else {
    // sphere: a single dot is enough at the centre.
    elements.push({
      kind: "point",
      id: "body",
      xExpression: `${at[0]}`,
      yExpression: `${at[1]}`,
      accent: "chalk",
    });
  }

  // Forces — scale arrow length by max(magnitudes).
  const maxMag = spec.forces.reduce((m, f) => Math.max(m, f.magnitude), 0) || 1;
  const arrowLen = Math.max(w, h) * 1.5;
  for (let i = 0; i < spec.forces.length; i += 1) {
    const f = spec.forces[i];
    const rad = (f.angleDeg * Math.PI) / 180;
    const len = (f.magnitude / maxMag) * arrowLen;
    const tip: [number, number] = [at[0] + len * Math.cos(rad), at[1] + len * Math.sin(rad)];
    elements.push({
      kind: "arrow",
      id: `f-${i}`,
      from: { x: at[0], y: at[1] },
      to: { x: tip[0], y: tip[1] },
      label: spec.showLabels === false ? undefined : (f.label ?? `${f.magnitude}`),
      accent,
    });
  }

  const reach = arrowLen + Math.max(w, h) * 0.5;
  return {
    xDomain: [at[0] - reach, at[0] + reach],
    yDomain: [at[1] - reach, at[1] + reach],
    showGrid: true,
    elements,
  };
}