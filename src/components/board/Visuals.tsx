import { useMemo } from "react";
import { renderMath } from "../../lib/latex/render";

/* ── LaTeX ── */

export function Latex({ tex, color, size = 26 }: { tex: string; color: string; size?: number }) {
  const html = useMemo(() => {
    const r = renderMath(tex, true, {});
    return r.html;
  }, [tex]);
  return (
    <div
      className="katex-chalk"
      style={{ color, fontSize: size }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

/* ── Shared plot helpers & Tick Generator ──
   JSXGraph renders its own ticks now, but this pure tick-numbering utility is
   kept (and unit-tested) as a reusable helper for any future bespoke axis work.
   The placeholder enum shape components (Graph2D / Graph3D / Diagram with their
   orbit|atom|cell|stack|beaker SVG art) used to live here; they were removed when
   the visualize→JSXGraph/KaTeX router replaced them — no presets, no enums. */

export function generateAxisTicks(min: number, max: number, maxTicks = 5): number[] {
  if (min >= max) return [min];
  const range = max - min;
  const rawStep = range / maxTicks;
  const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const residual = rawStep / mag;

  let step = mag;
  if (residual > 5) step = 10 * mag;
  else if (residual > 2.5) step = 5 * mag;
  else if (residual > 1.2) step = 2 * mag;

  const start = Math.floor(min / step) * step;
  const ticks: number[] = [];
  for (let v = start; v <= max + step - 1e-9; v += step) {
    ticks.push(Number(v.toFixed(4)));
  }
  return ticks;
}

/* ── Chalk strong-emphasis span (carried for board callouts) ── */

export function ChalkStrong({ children }: { children: React.ReactNode }) {
  return <span style={{ color: "#fde68a" }}>{children}</span>;
}
