/**
 * Generic polynomial graph compiler.
 *
 * Emits a `SceneCurve` with the supplied `expressionLatex` parsed into a
 * safe JS expression in `x`. The simple parser in `../latex.ts` handles
 * polynomial forms common in textbook figures: x^2, x^3 - 4*x, etc.
 *
 * The validator (in `validate.ts`) requires `MAX_FIGURE_EXPRESSION` characters
 * and the safe-expression evaluator (same one used by `lib/widgets/validate.ts`
 * for slider readouts) keeps injection off the wire.
 */

import type { AnimationScene, AnimationSceneElement } from "../../widgets/types";
import { latexToJsExpression, FigureSpecLatexError } from "../latex";
import { FigureSpecCompileError } from "../compile";
import type { PolynomialGraphSpec } from "../types";

export function compilePolynomialGraph(spec: PolynomialGraphSpec): AnimationScene {
  let jsExpr: string;
  try {
    jsExpr = latexToJsExpression(spec.expressionLatex);
  } catch (e) {
    if (e instanceof FigureSpecLatexError) {
      throw new FigureSpecCompileError(spec.kind, e.message);
    }
    throw e;
  }
  const elements: AnimationSceneElement[] = [
    {
      kind: "curve",
      id: "poly",
      xExpression: "x",
      yExpression: jsExpr,
      uDomain: spec.domainX,
      accent: spec.accent ?? "accent",
    },
  ];

  if (spec.showRoots === true) {
    // Numerical scan to detect sign-change roots. We track the previous
    // y-value at the start of each step and emit a root whenever the
    // sign (or exact-zero) flips, including the boundary case where
    // y0 itself is a root — without that case a polynomial whose first
    // sample is exactly zero would be missed.
    const STEPS = 720;
    const [x0, x1] = spec.domainX;
    const emitRoot = (x: number) => {
      elements.push({
        kind: "point",
        id: `root-${elements.length}`,
        xExpression: `${x.toFixed(3)}`,
        yExpression: "0",
        accent: "amber",
      });
    };
    let prevY = safeEval(jsExpr, x0);
    if (prevY !== null && Math.abs(prevY) < 1e-3) emitRoot(x0);
    for (let i = 1; i <= STEPS; i += 1) {
      const x = x0 + ((x1 - x0) * i) / STEPS;
      const y = safeEval(jsExpr, x);
      if (y === null || prevY === null) continue;
      if (Math.abs(y) < 1e-3) {
        emitRoot(x);
      } else if ((prevY < 0 && y > 0) || (prevY > 0 && y < 0)) {
        // Sign change inside one sub-interval. Linear-interpolate the root.
        const t = prevY / (prevY - y);
        emitRoot(x0 + ((x1 - x0) * (i - 1 + t)) / STEPS);
      }
      prevY = y;
    }
  }

  if (spec.showVertex === true) {
    // numerical scan for derivative sign-change (turning points).
    const STEPS = 240;
    const [x0, x1] = spec.domainX;
    const h = (x1 - x0) / STEPS;
    let prevD = deriv(jsExpr, x0);
    for (let i = 1; i < STEPS; i += 1) {
      const x = x0 + i * h;
      const d = deriv(jsExpr, x);
      if (prevD !== null && d !== null && ((prevD < 0 && d >= 0) || (prevD > 0 && d <= 0))) {
        const y = safeEval(jsExpr, x);
        if (y !== null) {
          elements.push({
            kind: "point",
            id: `vertex-${i}`,
            xExpression: `${x.toFixed(3)}`,
            yExpression: `${y.toFixed(3)}`,
            accent: "violet",
          });
        }
      }
      prevD = d;
    }
  }

  return {
    xDomain: spec.domainX,
    yDomain: spec.rangeY ?? autoRange(jsExpr, spec.domainX),
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

function deriv(expr: string, x: number): number | null {
  const h = 1e-4;
  const a = safeEval(expr, x - h);
  const b = safeEval(expr, x + h);
  if (a === null || b === null) return null;
  return (b - a) / (2 * h);
}

function autoRange(expr: string, [x0, x1]: [number, number]): [number, number] {
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
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return [-3, 3];
  const pad = Math.max(0.5, (hi - lo) * 0.1);
  return [Math.floor(lo - pad), Math.ceil(hi + pad)];
}