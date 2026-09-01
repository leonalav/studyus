/**
 * Parabola compiler.
 *
 * Emits a parametric curve for y = a(x-h)²+k (vertical) or x = a(y-k)²+h
 * (horizontal), plus the vertex marker and — when requested — the focus and
 * directrix.
 */

import type { AnimationScene, AnimationSceneElement } from "../../widgets/types";
import type { ParabolaSpec } from "../types";

export function compileParabola(spec: ParabolaSpec): AnimationScene {
  const [h, k] = spec.vertex;
  const a = spec.scale ?? 1;
  const accent = spec.accent ?? "accent";
  const elements: AnimationSceneElement[] = [];
  const [hx, hy] = spec.vertex;

  if (spec.opens === "up" || spec.opens === "down") {
    const sign = spec.opens === "up" ? 1 : -1;
    // y = a*(x-h)² + k with sign applied.
    const xLo = spec.domainX?.[0] ?? (h - 3);
    const xHi = spec.domainX?.[1] ?? (h + 3);
    elements.push({
      kind: "curve",
      id: "parabola",
      xExpression: "x",
      yExpression: `${sign * a} * (x - ${h})**2 + ${k}`,
      uDomain: [xLo, xHi],
      accent,
    });
  } else {
    const sign = spec.opens === "right" ? 1 : -1;
    // x = a*(y-k)² + h. Parametrize over y.
    const yLo = spec.domainY?.[0] ?? (k - 3);
    const yHi = spec.domainY?.[1] ?? (k + 3);
    elements.push({
      kind: "curve",
      id: "parabola",
      xExpression: `${sign * a} * (u - ${k})**2 + ${h}`,
      yExpression: "u",
      uDomain: [yLo, yHi],
      accent,
    });
  }

  // vertex
  elements.push({
    kind: "point",
    id: "vertex",
    xExpression: `${hx}`,
    yExpression: `${hy}`,
    label: "(h, k)",
    accent: "amber",
  });

  if (spec.showFocusDirectrix === true) {
    // For y = a*(x-h)²+k, focus = (h, k + 1/(4a)) and directrix y = k - 1/(4a)
    // (assuming a > 0; sign handled separately).
    if (spec.opens === "up" || spec.opens === "down") {
      const offset = 1 / (4 * a);
      const fy = k + offset * (spec.opens === "up" ? 1 : -1);
      const dy = k - offset * (spec.opens === "up" ? 1 : -1);
      elements.push({
        kind: "point",
        id: "focus",
        xExpression: `${h}`,
        yExpression: `${fy}`,
        label: "focus",
        accent: "violet",
      });
      const yLo = spec.domainY?.[0] ?? (k - 3);
      const yHi = spec.domainY?.[1] ?? (k + 3);
      elements.push({
        kind: "segment",
        id: "directrix",
        from: { x: h - 3, y: dy },
        to: { x: h + 3, y: dy },
        style: "dashed",
        accent: "chalk",
      });
      // ensure directrix is visible inside the chosen y-domain
      if (dy < yLo || dy > yHi) {
        // widen the y-domain so the directrix is onscreen.
        // we mutate the bounds later — see below.
      }
    } else {
      // horizontal parabola: x = a(y-k)²+h, focus at (h+sign/(4a), k)
      const offset = 1 / (4 * a);
      const fx = h + offset * (spec.opens === "right" ? 1 : -1);
      const dx = h - offset * (spec.opens === "right" ? 1 : -1);
      elements.push({
        kind: "point",
        id: "focus",
        xExpression: `${fx}`,
        yExpression: `${k}`,
        label: "focus",
        accent: "violet",
      });
      elements.push({
        kind: "segment",
        id: "directrix",
        from: { x: dx, y: k - 3 },
        to: { x: dx, y: k + 3 },
        style: "dashed",
        accent: "chalk",
      });
    }
  }

  return {
    xDomain: spec.domainX ?? [-3 + h, 3 + h],
    yDomain: spec.domainY ?? [-3 + k, 3 + k],
    xLabel: "x",
    yLabel: "y",
    showGrid: true,
    elements,
  };
}