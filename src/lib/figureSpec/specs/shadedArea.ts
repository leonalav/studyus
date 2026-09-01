/**
 * Shaded-area compiler.
 *
 * Emits the function curve together with a `region` primitive that fills the
 * strip between `fromX` and `toX`, between the curve and `baseY` (default 0).
 *
 * The renderer (in `WidgetSurface.tsx`'s `SceneFigure`) already understands
 * `region` and shades it with the chosen accent.
 */

import type { AnimationScene, AnimationSceneElement } from "../../widgets/types";
import { latexToJsExpression, FigureSpecLatexError } from "../latex";
import { FigureSpecCompileError } from "../compile";
import type { ShadedAreaSpec } from "../types";

export function compileShadedArea(spec: ShadedAreaSpec): AnimationScene {
  let jsExpr: string;
  try {
    jsExpr = latexToJsExpression(spec.fLatex);
  } catch (e) {
    if (e instanceof FigureSpecLatexError) {
      throw new FigureSpecCompileError(spec.kind, e.message);
    }
    throw e;
  }
  const pad = spec.domainPad ?? Math.max(0.5, (spec.toX - spec.fromX) * 0.25);
  const [xLo, xHi] = [spec.fromX - pad, spec.toX + pad];
  const base = spec.baseY ?? 0;
  const top = base === 0 ? jsExpr : `(${jsExpr}) - ${base}`;
  const accent = spec.accent ?? "accent";

  const elements: AnimationSceneElement[] = [
    {
      kind: "region" as const,
      id: "area",
      x0: spec.fromX,
      x1: spec.toX,
      topExpression: top,
      bottomExpression: `${base}`,
      fill: accent,
    },
    {
      kind: "curve" as const,
      id: "f",
      xExpression: "x",
      yExpression: jsExpr,
      uDomain: [xLo, xHi],
      accent,
    },
  ];

  if (spec.showLabels !== false) {
    elements.push({
      kind: "label" as const,
      id: "from-label",
      at: { x: spec.fromX, y: base },
      text: "a",
      anchor: "middle",
      offset: { x: 0, y: -6 },
      accent: "chalk",
    });
    elements.push({
      kind: "label" as const,
      id: "to-label",
      at: { x: spec.toX, y: base },
      text: "b",
      anchor: "middle",
      offset: { x: 0, y: -6 },
      accent: "chalk",
    });
  }

  return {
    xDomain: [xLo, xHi],
    yDomain: spec.rangeY ?? autoRange(jsExpr, [xLo, xHi], base),
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

function autoRange(expr: string, [x0, x1]: [number, number], base: number): [number, number] {
  let lo = base;
  let hi = base;
  const STEPS = 80;
  for (let i = 0; i <= STEPS; i += 1) {
    const x = x0 + ((x1 - x0) * i) / STEPS;
    const y = safeEval(expr, x);
    if (y === null) continue;
    if (y < lo) lo = y;
    if (y > hi) hi = y;
  }
  const pad = Math.max(0.5, (hi - lo) * 0.1);
  return [Math.floor(lo - pad), Math.ceil(hi + pad)];
}