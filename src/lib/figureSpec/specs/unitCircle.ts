/**
 * Unit-circle compiler.
 *
 * Emits an `AnimationScene` whose elements draw:
 *   - the unit circle as a parametric curve (cos u, sin u) over u ∈ [0, 2π]
 *   - the radius from origin to the point at θ
 *   - the angle arc from 0 to θ
 *   - the projected sin/cos legs and the tangent point, when requested
 *   - the labels (cosθ, sinθ, θ, etc.) when requested
 *
 * The view defaults to [-1.4, 1.4] in both axes — wide enough for the radius
 * to clear the circle, narrow enough that the labels fit.
 */

import type { AnimationScene, AnimationSceneElement } from "../../widgets/types";
import type { UnitCircleSpec } from "../types";

export function compileUnitCircle(spec: UnitCircleSpec): AnimationScene {
  const xDomain = spec.domainX ?? [-1.4, 1.4];
  const yDomain = spec.domainY ?? [-1.4, 1.4];
  const accent = spec.accent ?? "accent";
  const elements: AnimationSceneElement[] = [];

  // 1. the circle itself
  elements.push({
    kind: "curve",
    id: "circle",
    xExpression: "cos(u)",
    yExpression: "sin(u)",
    uDomain: [0, Math.PI * 2],
    accent: "chalk",
  });

  const cosT = Math.cos(spec.theta);
  const sinT = Math.sin(spec.theta);

  // 2. angle arc: a single parametric curve, sampled over a small u-domain,
  //    sweeping from 0 to theta with a fixed arc radius. One primitive, not
  //    24 segments — keeps the figure inside the element cap.
  const arcR = 0.18;
  if (Math.abs(spec.theta) > 1e-6) {
    elements.push({
      kind: "curve",
      id: "arc",
      // Sample u in [0, 1] and scale to [0, theta].
      xExpression: `${arcR} * cos(${spec.theta} * u)`,
      yExpression: `${arcR} * sin(${spec.theta} * u)`,
      uDomain: [0, 1],
      accent,
    });
  }

  // 3. radius from origin to the point at theta
  if (spec.showRadius !== false) {
    elements.push({
      kind: "segment",
      id: "radius",
      from: { x: 0, y: 0 },
      to: { x: cosT, y: sinT },
      accent,
    });
  }

  // 4. point on the circle
  elements.push({
    kind: "point",
    id: "p-theta",
    xExpression: `${cosT}`,
    yExpression: `${sinT}`,
    label: "(cos θ, sin θ)",
    accent,
  });

  // 5. cos projection (a segment along x to the x-axis at the same x)
  if (spec.showCos !== false) {
    elements.push({
      kind: "segment",
      id: "cos-leg",
      from: { x: cosT, y: 0 },
      to: { x: cosT, y: sinT },
      style: "dashed",
      accent,
    });
    if (spec.showLabels !== false) {
      elements.push({
        kind: "label",
        id: "cos-label",
        at: { x: cosT, y: sinT / 2 },
        text: "cos θ",
        anchor: "end",
        offset: { x: -4, y: 0 },
        accent,
      });
    }
  }

  // 6. sin projection (a segment along y to the y-axis)
  if (spec.showSin !== false) {
    elements.push({
      kind: "segment",
      id: "sin-leg",
      from: { x: 0, y: sinT },
      to: { x: cosT, y: sinT },
      style: "dashed",
      accent,
    });
    if (spec.showLabels !== false) {
      elements.push({
        kind: "label",
        id: "sin-label",
        at: { x: cosT / 2, y: sinT },
        text: "sin θ",
        anchor: "middle",
        offset: { x: 0, y: -4 },
        accent,
      });
    }
  }

  // 7. tangent line: through the point on the circle, perpendicular to the
  // radius, with slope -cosT/sinT. We draw it as a short segment that spans
  // the visible window. Both ends sit OUTSIDE the unit circle so the eye
  // reads "tangent" not "chord".
  if (spec.showTan === true) {
    const dx = -sinT;
    const dy = cosT;
    const reach = Math.max(xDomain[1] - xDomain[0], yDomain[1] - yDomain[0]);
    const px = cosT + dx * reach;
    const py = sinT + dy * reach;
    const nx = cosT - dx * reach;
    const ny = sinT - dy * reach;
    elements.push({
      kind: "segment",
      id: "tangent",
      from: { x: nx, y: ny },
      to: { x: px, y: py },
      style: "dashed",
      accent: "amber",
    });
  }

  // 8. theta label, anchored near the arc
  if (spec.showLabels !== false) {
    elements.push({
      kind: "label",
      id: "theta-label",
      at: { x: arcR * 1.4 * Math.cos(spec.theta / 2), y: arcR * 1.4 * Math.sin(spec.theta / 2) },
      text: "θ",
      anchor: "middle",
      accent,
    });
  }

  return {
    xDomain,
    yDomain,
    showGrid: true,
    elements,
  };
}