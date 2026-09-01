/**
 * Trigonometric-graph compiler.
 *
 * Emits a `SceneCurve` of the requested function over the given domain, plus
 * the zero/extrema markers for sin/cos/tan when `showKeyPoints` is set.
 * Asymptote markers are emitted as vertical dashed segments for tan/cot/sec/csc
 * at the points where the function blows up.
 */

import type { AnimationScene, AnimationSceneElement } from "../../widgets/types";
import type { TrigFunction, TrigGraphSpec } from "../types";

interface TrigProfile {
  /** Whether the function has zeros inside a domain. */
  zeros: (x: number, domain: [number, number]) => number[];
  /** Whether the function has extrema inside a domain. */
  extrema: (x: number, domain: [number, number]) => number[];
  /** Where the asymptotes sit. */
  asymptotes: (domain: [number, number]) => number[];
  /** Default Y range when none is supplied. */
  defaultRangeY: [number, number];
  /** The expression in scene coordinates. */
  expression: string;
}

const PROFILES: Record<TrigFunction, TrigProfile> = {
  sin: {
    zeros: (x, [a, b]) => sampleZeros(Math.sin, x, a, b),
    extrema: (x, [a, b]) => sampleExtrema(Math.sin, x, a, b),
    asymptotes: () => [],
    defaultRangeY: [-1.4, 1.4],
    expression: "sin(x)",
  },
  cos: {
    zeros: (x, [a, b]) => sampleZeros(Math.cos, x, a, b),
    extrema: (x, [a, b]) => sampleExtrema(Math.cos, x, a, b),
    asymptotes: () => [],
    defaultRangeY: [-1.4, 1.4],
    expression: "cos(x)",
  },
  tan: {
    zeros: (x, [a, b]) => sampleZeros(Math.tan, x, a, b),
    extrema: () => [],
    asymptotes: (domain) => asymptotesFor(domain),
    defaultRangeY: [-4, 4],
    expression: "tan(x)",
  },
  csc: {
    zeros: () => [],
    extrema: () => [],
    asymptotes: (domain) => asymptotesFor(domain),
    defaultRangeY: [-4, 4],
    expression: "1/sin(x)",
  },
  sec: {
    zeros: () => [],
    extrema: () => [],
    asymptotes: (domain) => asymptotesFor(domain),
    defaultRangeY: [-4, 4],
    expression: "1/cos(x)",
  },
  cot: {
    zeros: () => [],
    extrema: () => [],
    asymptotes: (domain) => asymptotesFor(domain),
    defaultRangeY: [-4, 4],
    expression: "cos(x)/sin(x)",
  },
};

export function compileTrigGraph(spec: TrigGraphSpec): AnimationScene {
  const profile = PROFILES[spec.function];
  const yDomain = spec.rangeY ?? profile.defaultRangeY;
  const elements: AnimationSceneElement[] = [];

  elements.push({
    kind: "curve",
    id: `trig-${spec.function}`,
    xExpression: "x",
    yExpression: profile.expression,
    uDomain: spec.domainX,
    accent: spec.accent ?? "accent",
  });

  // Asymptote markers — vertical dashed segments at the asymptote x's.
  const asymX = profile.asymptotes(spec.domainX);
  for (const x of asymX) {
    elements.push({
      kind: "segment",
      id: `asym-${x.toFixed(3)}`,
      from: { x, y: yDomain[0] },
      to: { x, y: yDomain[1] },
      style: "dotted",
      accent: "chalk",
    });
  }

  if (spec.showKeyPoints === true) {
    const xs = profile.zeros(0, spec.domainX);
    for (const x of xs) {
      elements.push({
        kind: "point",
        id: `zero-${x.toFixed(3)}`,
        xExpression: `${x}`,
        yExpression: "0",
        label: spec.showLabels === true ? "0" : undefined,
        accent: "amber",
      });
    }
    const exts = profile.extrema(0, spec.domainX);
    for (const x of exts) {
      const value = computeProfile(spec.function, x);
      elements.push({
        kind: "point",
        id: `extremum-${x.toFixed(3)}`,
        xExpression: `${x}`,
        yExpression: `${value}`,
        label: spec.showLabels === true ? `${formatNum(value)}` : undefined,
        accent: "violet",
      });
    }
  }

  return {
    xDomain: spec.domainX,
    yDomain,
    xLabel: "x",
    yLabel: `f(x) = ${spec.function}(x)`,
    showGrid: true,
    elements,
  };
}

function computeProfile(fn: TrigFunction, x: number): number {
  switch (fn) {
    case "sin":
      return Math.sin(x);
    case "cos":
      return Math.cos(x);
    case "tan":
      return Math.tan(x);
    case "csc":
      return 1 / Math.sin(x);
    case "sec":
      return 1 / Math.cos(x);
    case "cot":
      return Math.cos(x) / Math.sin(x);
  }
}

function sampleZeros(
  fn: (x: number) => number,
  _: number,
  a: number,
  b: number
): number[] {
  const out: number[] = [];
  const STEPS = 480;
  let prev = fn(a);
  for (let i = 1; i <= STEPS; i += 1) {
    const x = a + ((b - a) * i) / STEPS;
    const v = fn(x);
    if (prev === 0 || (prev < 0 && v >= 0) || (prev > 0 && v <= 0)) {
      // approximate the zero by linear interpolation
      const t = prev === v ? 0 : -prev / (v - prev);
      out.push(a + ((b - a) * (i - 1 + t)) / STEPS);
    }
    prev = v;
  }
  // dedupe within 1e-3
  return out.filter((v, i, arr) => i === 0 || Math.abs(v - arr[i - 1]) > 1e-3);
}

function sampleExtrema(
  fn: (x: number) => number,
  _: number,
  a: number,
  b: number
): number[] {
  // numerical derivative zero crossings; coarse scan.
  const STEPS = 240;
  const h = (b - a) / STEPS;
  const out: number[] = [];
  let prevD = (fn(a + h) - fn(a)) / h;
  for (let i = 1; i < STEPS; i += 1) {
    const x = a + i * h;
    const d = (fn(x + h) - fn(x - h)) / (2 * h);
    if (prevD !== 0 && (prevD < 0 && d >= 0) || (prevD > 0 && d <= 0)) {
      out.push(x);
    }
    prevD = d;
  }
  return out.filter((v, i, arr) => i === 0 || Math.abs(v - arr[i - 1]) > 1e-3);
}

function asymptotesFor([a, b]: [number, number]): number[] {
  // For tan/cot/sec/csc, asymptotes sit at (2k+1)π/2 (tan-style) — period 1.0
  // in those normalized angles. Here the caller passes `period` in units of π,
  // i.e. 0.5 for tan-style. We anchor on π/2 + kπ.
  const out: number[] = [];
  const startK = Math.ceil((a - Math.PI / 2) / Math.PI);
  for (let k = startK; ; k += 1) {
    const x = Math.PI / 2 + k * Math.PI;
    if (x > b) break;
    if (x >= a) out.push(x);
  }
  return out;
}

function formatNum(v: number): string {
  if (Math.abs(v - Math.round(v)) < 1e-3) return `${Math.round(v)}`;
  return v.toFixed(2);
}