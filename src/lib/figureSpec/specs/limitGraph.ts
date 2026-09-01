/**
 * Limit-graph compiler.
 *
 * Emits the function curve sampled around `limitPoint`, plus the dashed
 * vertical at the limit point and — when requested — left/right approach
 * arrows on the x-axis pointing toward the limit.
 */

import type { AnimationScene, AnimationSceneElement } from "../../widgets/types";
import { latexToJsExpression, FigureSpecLatexError } from "../latex";
import { FigureSpecCompileError } from "../compile";
import type { LimitGraphSpec } from "../types";

export function compileLimitGraph(spec: LimitGraphSpec): AnimationScene {
  let jsExpr: string;
  try {
    jsExpr = latexToJsExpression(spec.fLatex);
  } catch (e) {
    if (e instanceof FigureSpecLatexError) {
      throw new FigureSpecCompileError(spec.kind, e.message);
    }
    throw e;
  }
  const pad = spec.domainPad ?? 2;
  const [xLo, xHi] = [spec.limitPoint - pad, spec.limitPoint + pad];
  const elements: AnimationSceneElement[] = [];

  elements.push({
    kind: "curve",
    id: "f",
    xExpression: "x",
    yExpression: jsExpr,
    uDomain: [xLo, xHi],
    accent: spec.accent ?? "accent",
  });

  // dashed vertical at the limit point
  elements.push({
    kind: "segment",
    id: "limit-line",
    from: { x: spec.limitPoint, y: -1e6 },
    to: { x: spec.limitPoint, y: 1e6 },
    style: "dashed",
    accent: "chalk",
  });

  // approach arrows
  if (spec.leftArrow === true) {
    const reach = Math.min(pad * 0.6, 1);
    elements.push({
      kind: "arrow",
      id: "left-arrow",
      from: { x: spec.limitPoint - reach, y: 0 },
      to: { x: spec.limitPoint, y: 0 },
      label: spec.showLabels === false ? undefined : "x → a⁻",
      accent: "amber",
    });
  }
  if (spec.rightArrow === true) {
    const reach = Math.min(pad * 0.6, 1);
    elements.push({
      kind: "arrow",
      id: "right-arrow",
      from: { x: spec.limitPoint + reach, y: 0 },
      to: { x: spec.limitPoint, y: 0 },
      label: spec.showLabels === false ? undefined : "x → a⁺",
      accent: "amber",
    });
  }

  if (spec.showLabels !== false) {
    elements.push({
      kind: "label",
      id: "limit-label",
      at: { x: spec.limitPoint, y: 0 },
      text: "a",
      anchor: "middle",
      offset: { x: 0, y: -8 },
      accent: "chalk",
    });
  }

  return {
    xDomain: [xLo, xHi],
    yDomain: spec.rangeY ?? autoRange(jsExpr, [xLo, xHi]),
    xLabel: "x",
    yLabel: "f(x)",
    showGrid: true,
    elements,
  };
}

function safeEval(expr: string, x: number): number | null {
  try {
    // eslint-disable-next-line no-new-func
    const fn = new Function("x", `with (Math) { return (${expr}); }`);
    const v = fn(x);
    return typeof v === "number" && Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
}

function autoRange(expr: string, [x0, x1]: [number, number]): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  const STEPS = 80;
  for (let i = 0; i <= STEPS; i += 1) {
    const x = x0 + ((x1 - x0) * i) / STEPS;
    const y = safeEval(expr, x);
    if (y === null) continue;
    if (y < lo) lo = y;
    if (y > hi) hi = y;
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return [-3, 3];
  const pad = Math.max(0.5, (hi - lo) * 0.15);
  return [Math.floor(lo - pad), Math.ceil(hi + pad)];
}