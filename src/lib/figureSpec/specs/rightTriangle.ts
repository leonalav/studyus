/**
 * Right-triangle compiler.
 *
 * Emits the right triangle at the origin with legs along +x and +y, the
 * hypotenuse connecting (adjacent, 0) to (0, opposite), an optional right-
 * angle marker (small square at origin), and — when `showRatios` — labels
 * for sin/cos/tan ratios.
 */

import type { AnimationScene, AnimationSceneElement } from "../../widgets/types";
import type { RightTriangleSpec } from "../types";

export function compileRightTriangle(spec: RightTriangleSpec): AnimationScene {
  const a = spec.adjacent;
  const o = spec.opposite;
  const h = Math.hypot(a, o);
  const theta = Math.atan2(o, a);
  const accent = spec.accent ?? "accent";
  const elements: AnimationSceneElement[] = [];

  // Hypotenuse
  elements.push({
    kind: "segment",
    id: "hypotenuse",
    from: { x: a, y: 0 },
    to: { x: 0, y: o },
    accent,
  });
  // Adjacent leg
  elements.push({
    kind: "segment",
    id: "adjacent",
    from: { x: 0, y: 0 },
    to: { x: a, y: 0 },
    accent: "chalk",
  });
  // Opposite leg
  elements.push({
    kind: "segment",
    id: "opposite",
    from: { x: 0, y: 0 },
    to: { x: 0, y: o },
    accent: "chalk",
  });

  // Right-angle marker (small L bracket at origin)
  const bracketSize = Math.min(0.18, Math.min(a, o) * 0.18);
  elements.push({
    kind: "segment",
    id: "ra-1",
    from: { x: 0, y: 0 },
    to: { x: bracketSize, y: 0 },
    style: "solid",
    accent: "chalk",
  });
  elements.push({
    kind: "segment",
    id: "ra-2",
    from: { x: 0, y: 0 },
    to: { x: 0, y: bracketSize },
    style: "solid",
    accent: "chalk",
  });

  // Vertices
  elements.push({
    kind: "point",
    id: "v-origin",
    xExpression: "0",
    yExpression: "0",
    accent,
  });
  elements.push({
    kind: "point",
    id: "v-adj",
    xExpression: `${a}`,
    yExpression: "0",
    accent,
  });
  elements.push({
    kind: "point",
    id: "v-opp",
    xExpression: "0",
    yExpression: `${o}`,
    accent,
  });

  if (spec.thetaLabel !== false) {
    // θ label just above the x-axis, inside the triangle near the origin.
    elements.push({
      kind: "label",
      id: "theta",
      at: { x: theta * 0.35, y: 0.05 },
      text: "θ",
      anchor: "start",
      offset: { x: 2, y: 0 },
      accent,
    });
  }

  if (spec.showRatios === true) {
    elements.push({
      kind: "label",
      id: "ratio-sin",
      at: { x: a / 2, y: -0.1 },
      text: `adjacent = ${formatNum(a)}`,
      anchor: "middle",
      accent: "chalk",
    });
    elements.push({
      kind: "label",
      id: "ratio-cos",
      at: { x: -0.05, y: o / 2 },
      text: `opposite = ${formatNum(o)}`,
      anchor: "end",
      accent: "chalk",
    });
    elements.push({
      kind: "label",
      id: "ratio-tan",
      at: { x: a * 0.55, y: o * 0.55 },
      text: `hypotenuse = ${formatNum(h)}`,
      anchor: "start",
      offset: { x: 4, y: 0 },
      accent: "chalk",
    });
  }

  const pad = Math.max(0.5, h * 0.18);
  return {
    xDomain: [-pad, a + pad],
    yDomain: [-pad, o + pad],
    showGrid: true,
    elements,
  };
}

function formatNum(v: number): string {
  if (Math.abs(v - Math.round(v)) < 1e-3) return `${Math.round(v)}`;
  return v.toFixed(2);
}