/**
 * Flowchart compiler.
 *
 * Emits each node as a `point` (the circle the renderer draws) and each edge
 * as an arrow from the start to the end node. A node's *label* is attached to
 * the `point` element so it shows next to the circle.
 *
 * The diagram does not draw node *boxes* (no rectangle primitive in scene),
 * so each node renders as a labelled dot connected by arrows — the same
 * visual vocabulary as graph-theory figures.
 */

import type { AnimationScene, AnimationSceneElement } from "../../widgets/types";
import type { FlowchartSpec } from "../types";

export function compileFlowchart(spec: FlowchartSpec): AnimationScene {
  const accent = spec.accent ?? "accent";
  const elements: AnimationSceneElement[] = [];

  const nodeById = new Map<string, { x: number; y: number; label: string }>();
  for (const n of spec.nodes) nodeById.set(n.id, n);

  // Edges first (so node dots paint on top of arrowheads).
  for (let i = 0; i < spec.edges.length; i += 1) {
    const e = spec.edges[i];
    const from = nodeById.get(e.from);
    const to = nodeById.get(e.to);
    if (!from || !to) continue;
    elements.push({
      kind: "arrow",
      id: `e-${i}`,
      from: { x: from.x, y: from.y },
      to: { x: to.x, y: to.y },
      label: spec.showLabels === false ? undefined : e.label,
      accent,
    });
  }

  for (const n of spec.nodes) {
    elements.push({
      kind: "point",
      id: `n-${n.id}`,
      xExpression: `${n.x}`,
      yExpression: `${n.y}`,
      label: spec.showLabels === false ? undefined : n.label,
      accent: "violet",
    });
  }

  // pick a frame from node coords
  let xMin = Infinity;
  let xMax = -Infinity;
  let yMin = Infinity;
  let yMax = -Infinity;
  for (const n of spec.nodes) {
    if (n.x < xMin) xMin = n.x;
    if (n.x > xMax) xMax = n.x;
    if (n.y < yMin) yMin = n.y;
    if (n.y > yMax) yMax = n.y;
  }
  if (!Number.isFinite(xMin)) return { xDomain: [-1, 1], yDomain: [-1, 1], elements };

  const padX = Math.max(1, (xMax - xMin) * 0.2);
  const padY = Math.max(1, (yMax - yMin) * 0.2);

  return {
    xDomain: [xMin - padX, xMax + padX],
    yDomain: [yMin - padY, yMax + padY],
    showGrid: true,
    elements,
  };
}