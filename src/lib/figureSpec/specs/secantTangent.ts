/**
 * Secant / tangent compiler.
 *
 * Emits the function curve, two sampled points (x0 and x1) connected by a
 * secant segment, and an optional tangent segment at `tangentAt`. Labels
 * are placed near the geometric features they identify.
 */

import type { AnimationScene, AnimationSceneElement } from "../../widgets/types";
import { latexToJsExpression, FigureSpecLatexError } from "../latex";
import { FigureSpecCompileError } from "../compile";
import type { SecantTangentSpec } from "../types";

export function compileSecantTangent(spec: SecantTangentSpec): AnimationScene {
  let jsExpr: string;
  try {
    jsExpr = latexToJsExpression(spec.fLatex);
  } catch (e) {
    if (e instanceof FigureSpecLatexError) {
      throw new FigureSpecCompileError(spec.kind, e.message);
    }
    throw e;
  }
  const accent = spec.accent ?? "accent";
  const pad = spec.domainPad ?? Math.max(2, Math.abs(spec.x1 - spec.x0) * 1.5);
  const [xLo, xHi] = [Math.min(spec.x0, spec.x1) - pad, Math.max(spec.x0, spec.x1) + pad];
  const elements: AnimationSceneElement[] = [];

  // 1. the function curve
  elements.push({
    kind: "curve",
    id: "f",
    xExpression: "x",
    yExpression: jsExpr,
    uDomain: [xLo, xHi],
    accent: "chalk",
  });

  // 2. sampled secant points (numerical evaluation here — the renderer can't
  // safely reach a f-string at compile time without rerunning the translator).
  const y0 = safeEval(jsExpr, spec.x0);
  const y1 = safeEval(jsExpr, spec.x1);
  if (y0 !== null && y1 !== null) {
    elements.push({
      kind: "point",
      id: "p0",
      xExpression: `${spec.x0}`,
      yExpression: `${y0.toFixed(4)}`,
      accent: "amber",
    });
    elements.push({
      kind: "point",
      id: "p1",
      xExpression: `${spec.x1}`,
      yExpression: `${y1.toFixed(4)}`,
      accent: "amber",
    });
    elements.push({
      kind: "segment",
      id: "secant",
      from: { x: spec.x0, y: y0 },
      to: { x: spec.x1, y: y1 },
      accent,
    });
    if (spec.showLabels !== false) {
      elements.push({
        kind: "label",
        id: "secant-label",
        at: { x: (spec.x0 + spec.x1) / 2, y: (y0 + y1) / 2 },
        text: "secant",
        offset: { x: 4, y: -4 },
        accent,
      });
    }
  }

  // 3. tangent line at tangentAt
  const at = spec.tangentAt ?? (spec.x0 + spec.x1) / 2;
  const yAt = safeEval(jsExpr, at);
  if (yAt !== null) {
    const slope = numericalDerivative(jsExpr, at);
    if (slope !== null) {
      const reach = Math.max(xHi - xLo, 4);
      // Two endpoints of the line, parameterised around the tangent point.
      const tx0 = at - reach;
      const ty0 = yAt - slope * reach;
      const tx1 = at + reach;
      const ty1 = yAt + slope * reach;
      elements.push({
        kind: "point",
        id: "p-tangent",
        xExpression: `${at}`,
        yExpression: `${yAt.toFixed(4)}`,
        accent: "violet",
      });
      elements.push({
        kind: "segment",
        id: "tangent",
        from: { x: tx0, y: ty0 },
        to: { x: tx1, y: ty1 },
        style: "dashed",
        accent: "amber",
      });
      if (spec.showLabels !== false) {
        elements.push({
          kind: "label",
          id: "tangent-label",
          at: { x: at, y: yAt },
          text: "tangent",
          offset: { x: 6, y: -6 },
          accent: "amber",
        });
      }
    }
  }

  return {
    xDomain: [xLo, xHi],
    yDomain: spec.rangeY ?? autoRange(jsExpr, [xLo, xHi], y0, y1, yAt),
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

function numericalDerivative(expr: string, x: number): number | null {
  const h = 1e-4;
  const a = safeEval(expr, x - h);
  const b = safeEval(expr, x + h);
  if (a === null || b === null) return null;
  return (b - a) / (2 * h);
}

function autoRange(
  expr: string,
  [x0, x1]: [number, number],
  ...extras: (number | null)[]
): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  const STEPS = 60;
  for (let i = 0; i <= STEPS; i += 1) {
    const x = x0 + ((x1 - x0) * i) / STEPS;
    const y = safeEval(expr, x);
    if (y === null) continue;
    if (y < lo) lo = y;
    if (y > hi) hi = y;
  }
  for (const y of extras) {
    if (y === null || !Number.isFinite(y)) continue;
    if (y < lo) lo = y;
    if (y > hi) hi = y;
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return [-3, 3];
  const pad = Math.max(0.5, (hi - lo) * 0.15);
  return [Math.floor(lo - pad), Math.ceil(hi + pad)];
}