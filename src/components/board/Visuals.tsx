import { useMemo } from "react";
import katex from "katex";

/* ── LaTeX ── */

export function Latex({ tex, color, size = 26 }: { tex: string; color: string; size?: number }) {
  const html = useMemo(() => {
    try {
      return katex.renderToString(tex, { throwOnError: false, displayMode: true });
    } catch {
      return `<span>${tex}</span>`;
    }
  }, [tex]);
  return (
    <div
      className="katex-chalk"
      style={{ color, fontSize: size }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

/* ── Shared plot helpers & Tick Generator ── */

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

const FNS: Record<string, (x: number) => number> = {
  parabola: (x) => x * x,
  sqrt: (x) => (x <= 0 ? NaN : 8 / Math.sqrt(x)),
  decay: (x) => 6 * Math.exp(-0.45 * x),
  logistic: (x) => 8 / (1 + Math.exp(-1.3 * (x - 5))),
  sine: Math.sin,
  sin: Math.sin,
  cos: Math.cos,
  tan: (x) => (Math.abs(Math.cos(x)) < 1e-3 ? NaN : Math.tan(x)),
};

function generatePathsWithDiscontinuity(
  fn: (x: number) => number,
  x0: number,
  x1: number,
  sx: (x: number) => number,
  sy: (y: number) => number,
  yMin: number,
  yMax: number
): string[] {
  const steps = 200;
  const paths: string[] = [];
  let currentPath = "";

  for (let i = 0; i <= steps; i++) {
    const x = x0 + ((x1 - x0) * i) / steps;
    const y = fn(x);

    if (!isFinite(y) || isNaN(y) || y < yMin - 10 * (yMax - yMin) || y > yMax + 10 * (yMax - yMin)) {
      if (currentPath) {
        paths.push(currentPath);
        currentPath = "";
      }
      continue;
    }

    const px = sx(x).toFixed(1);
    const py = sy(y).toFixed(1);

    if (!currentPath) {
      currentPath = `M${px},${py}`;
    } else {
      currentPath += ` L${px},${py}`;
    }
  }

  if (currentPath) paths.push(currentPath);
  return paths;
}

/* ── 2D Graph with Numeric Ticks & Discontinuity Protection ── */

export function Graph2D({
  fn,
  domainX,
  caption,
  curves,
  color,
  accent,
}: {
  fn: string;
  domainX: [number, number];
  caption?: string;
  curves?: string[];
  color: string;
  accent: string;
}) {
  const W = 320;
  const H = 220;
  const padLeft = 40;
  const padBottom = 30;
  const padTop = 20;
  const padRight = 20;
  const [x0, x1] = domainX;

  const series = useMemo(() => {
    if (fn === "complexity") {
      return [
        { f: (x: number) => x * x, c: "#f87171", label: "n²" },
        { f: (x: number) => x * Math.log2(Math.max(x, 1.01)), c: "#fbbf24", label: "n log n" },
        { f: (x: number) => x, c: accent, label: "n" },
        { f: (x: number) => Math.log2(Math.max(x, 1.01)), c: "#4ade80", label: "log n" },
      ];
    }
    if (curves?.length) {
      const palette = [accent, "#f9a8d4", "#60a5fa"];
      return curves.map((c, i) => ({ f: FNS[c] ?? FNS.sin, c: palette[i % palette.length], label: c }));
    }
    return [{ f: FNS[fn] ?? FNS.parabola, c: accent, label: fn }];
  }, [fn, curves, accent]);

  const yVals = series.flatMap((s) => {
    const out: number[] = [];
    for (let i = 0; i <= 60; i++) {
      const v = s.f(x0 + ((x1 - x0) * i) / 60);
      if (isFinite(v) && !isNaN(v)) out.push(v);
    }
    return out;
  });

  const yMin = yVals.length ? Math.min(0, ...yVals) : 0;
  const yMax = yVals.length ? Math.max(1, ...yVals) : 1;

  const sx = (x: number) => padLeft + ((x - x0) / (x1 - x0)) * (W - padLeft - padRight);
  const sy = (y: number) => H - padBottom - ((y - yMin) / (yMax - yMin || 1)) * (H - padTop - padBottom);

  const xTicks = useMemo(() => generateAxisTicks(x0, x1, 5), [x0, x1]);
  const yTicks = useMemo(() => generateAxisTicks(yMin, yMax, 4), [yMin, yMax]);

  return (
    <figure className="m-0">
      <svg width={W} height={H} className="overflow-visible font-mono">
        {/* Axes */}
        <line x1={padLeft} y1={H - padBottom} x2={W - padRight + 8} y2={H - padBottom} stroke={color} strokeWidth={1.6} opacity={0.75} />
        <line x1={padLeft} y1={H - padBottom} x2={padLeft} y2={padTop - 8} stroke={color} strokeWidth={1.6} opacity={0.75} />

        {/* X Ticks & Labels BELOW x-axis */}
        {xTicks.map((xt) => {
          const px = sx(xt);
          return (
            <g key={`xt-${xt}`}>
              <line x1={px} y1={H - padBottom} x2={px} y2={H - padBottom + 4} stroke={color} strokeWidth={1.2} opacity={0.6} />
              <text x={px} y={H - padBottom + 16} fontSize={10} fill={color} textAnchor="middle" opacity={0.85}>
                {xt}
              </text>
            </g>
          );
        })}

        {/* Y Ticks & Labels BESIDE y-axis */}
        {yTicks.map((yt) => {
          const py = sy(yt);
          return (
            <g key={`yt-${yt}`}>
              <line x1={padLeft - 4} y1={py} x2={padLeft} y2={py} stroke={color} strokeWidth={1.2} opacity={0.6} />
              <text x={padLeft - 8} y={py + 3} fontSize={10} fill={color} textAnchor="end" opacity={0.85}>
                {yt}
              </text>
            </g>
          );
        })}

        {/* Curve series rendering with discontinuity separation */}
        {series.map((s, i) => {
          const pathSegments = generatePathsWithDiscontinuity(s.f, x0, x1, sx, sy, yMin, yMax);
          return (
            <g key={i}>
              {pathSegments.map((d, pIdx) => (
                <path
                  key={pIdx}
                  d={d}
                  fill="none"
                  stroke={s.c}
                  strokeWidth={2.2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  opacity={0.95}
                />
              ))}
            </g>
          );
        })}

        {series.length > 1 && (
          <g>
            {series.map((s, i) => (
              <g key={i} transform={`translate(${W - padRight - 65}, ${padTop + i * 15})`}>
                <line x1={0} y1={0} x2={14} y2={0} stroke={s.c} strokeWidth={2.4} strokeLinecap="round" />
                <text x={19} y={3.5} fontSize={10} fill={color} opacity={0.85}>
                  {s.label}
                </text>
              </g>
            ))}
          </g>
        )}
      </svg>
      {caption && <figcaption className="mt-1 text-[13px] opacity-70">{caption}</figcaption>}
    </figure>
  );
}

/* ── 3D Wireframe Surface with Numeric Tick Axes ── */

const SURFACES: Record<string, (x: number, y: number) => number> = {
  saddle: (x, y) => (x * x - y * y) * 0.55,
  well: (x, y) => -2.6 / Math.sqrt(x * x + y * y + 0.35),
  ripple: (x, y) => Math.sin(Math.sqrt(x * x + y * y) * 1.5) * 1.1,
};

export function Graph3D({ surface, caption, color, accent }: { surface: string; caption?: string; color: string; accent: string }) {
  const W = 320;
  const H = 230;
  const N = 13;
  const f = SURFACES[surface] ?? SURFACES.saddle;

  const { rows, cols } = useMemo(() => {
    const cx = W / 2;
    const cy = H / 2 + 20;
    const s = 12;
    const zs = 15;
    const proj = (i: number, j: number) => {
      const x = (i / (N - 1)) * 4 - 2;
      const y = (j / (N - 1)) * 4 - 2;
      const z = f(x, y);
      const px = cx + (x - y) * s * 0.87;
      const py = cy + (x + y) * s * 0.5 - z * zs;
      return `${px.toFixed(1)},${py.toFixed(1)}`;
    };
    const rows: string[] = [];
    const cols: string[] = [];
    for (let j = 0; j < N; j++) rows.push(Array.from({ length: N }, (_, i) => proj(i, j)).join(" "));
    for (let i = 0; i < N; i++) cols.push(Array.from({ length: N }, (_, j) => proj(i, j)).join(" "));
    return { rows, cols };
  }, [surface]);

  return (
    <figure className="m-0 font-mono">
      <svg width={W} height={H} className="overflow-visible">
        {rows.map((p, i) => (
          <polyline key={`r${i}`} points={p} fill="none" stroke={accent} strokeWidth={1.1} opacity={0.35 + (i / N) * 0.5} strokeLinejoin="round" />
        ))}
        {cols.map((p, i) => (
          <polyline key={`c${i}`} points={p} fill="none" stroke={color} strokeWidth={1} opacity={0.25 + (i / N) * 0.4} strokeLinejoin="round" />
        ))}
        {/* 3D Axis with Numeric Ticks */}
        <g opacity={0.7} stroke={color} strokeWidth={1.4} strokeLinecap="round">
          <line x1={30} y1={H - 25} x2={70} y2={H - 45} />
          <line x1={30} y1={H - 25} x2={70} y2={H - 10} />
          <line x1={30} y1={H - 25} x2={30} y2={H - 65} />
        </g>
        {/* X axis tick numbers */}
        <text x={75} y={H - 45} fontSize={10} fill={color} opacity={0.9}>x (2.0)</text>
        <text x={75} y={H - 8} fontSize={10} fill={color} opacity={0.9}>y (2.0)</text>
        <text x={24} y={H - 70} fontSize={10} fill={color} opacity={0.9}>z (1.5)</text>
        <text x={20} y={H - 22} fontSize={9} fill={color} opacity={0.65}>0</text>
      </svg>
      {caption && <figcaption className="mt-1 text-[13px] opacity-70">{caption}</figcaption>}
    </figure>
  );
}

/* ── Chalk diagrams ── */

export function ChalkStrong({ children }: { children: React.ReactNode }) {
  return <span style={{ color: "#fde68a" }}>{children}</span>;
}

export function Diagram({ variant, caption, color, accent }: { variant: string; caption?: string; color: string; accent: string }) {
  const stroke = { stroke: color, fill: "none", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

  const art = () => {
    switch (variant) {
      case "orbit":
        return (
          <svg width={280} height={220}>
            <ellipse cx={140} cy={110} rx={118} ry={72} {...stroke} strokeDasharray="7 6" opacity={0.75} />
            <circle cx={140} cy={110} r={34} {...stroke} strokeWidth={2.4} />
            <path d="M120 96 q12 8 24 0 M116 118 q24 14 48 -4" {...stroke} strokeWidth={1.4} opacity={0.7} />
            <circle cx={258} cy={110} r={7} fill={accent} />
            <line x1={251} y1={110} x2={178} y2={110} stroke={accent} strokeWidth={1.5} strokeDasharray="4 4" opacity={0.8} />
            <path d="M258 96 l0 -22" stroke={accent} strokeWidth={2} strokeLinecap="round" />
            <path d="M252 80 l6 -10 l6 10" fill="none" stroke={accent} strokeWidth={2} strokeLinecap="round" />
            <text x={196} y={102} fontSize={12} fill={color} opacity={0.8}>r</text>
            <text x={236} y={64} fontSize={12} fill={accent} opacity={0.9}>v</text>
          </svg>
        );
      case "atom":
        return (
          <svg width={260} height={200}>
            <circle cx={130} cy={100} r={13} fill={accent} opacity={0.9} />
            {[0, 60, 120].map((a) => (
              <ellipse key={a} cx={130} cy={100} rx={98} ry={34} {...stroke} opacity={0.65} transform={`rotate(${a} 130 100)`} />
            ))}
            <circle cx={228} cy={100} r={6} fill={color} />
            <circle cx={81} cy={57} r={6} fill={color} />
            <circle cx={81} cy={143} r={6} fill={color} />
          </svg>
        );
      case "cell":
        return (
          <svg width={290} height={210}>
            <ellipse cx={145} cy={105} rx={132} ry={92} {...stroke} strokeWidth={2.4} />
            <ellipse cx={145} cy={105} rx={122} ry={82} {...stroke} strokeWidth={1} opacity={0.4} />
            <circle cx={120} cy={92} r={38} {...stroke} strokeWidth={2} />
            <circle cx={120} cy={92} r={13} fill={accent} opacity={0.75} />
            <ellipse cx={215} cy={78} rx={30} ry={15} {...stroke} strokeWidth={1.7} transform="rotate(-18 215 78)" />
            <path d="M200 76 q8 8 16 0 q8 -8 16 0" {...stroke} strokeWidth={1.2} opacity={0.8} />
            <ellipse cx={196} cy={148} rx={26} ry={13} {...stroke} strokeWidth={1.7} transform="rotate(14 196 148)" />
            <path d="M70 150 q22 -16 46 -4" {...stroke} strokeWidth={1.4} opacity={0.7} />
            <text x={96} y={97} fontSize={11} fill={color} opacity={0.85}>nucleus</text>
            <text x={182} y={60} fontSize={10} fill={color} opacity={0.75}>mito</text>
          </svg>
        );
      case "stack":
        return (
          <svg width={260} height={220}>
            {[0, 1, 2, 3].map((i) => (
              <g key={i}>
                <rect x={40 + i * 8} y={30 + i * 42} width={168} height={34} rx={4} {...stroke} strokeWidth={1.8} opacity={1 - i * 0.16} />
                <text x={54 + i * 8} y={52 + i * 42} fontSize={12} fill={color} opacity={0.85}>
                  fib({5 - i})
                </text>
              </g>
            ))}
            <path d="M232 40 l0 150" stroke={accent} strokeWidth={1.8} strokeDasharray="5 5" strokeLinecap="round" />
            <path d="M226 178 l6 12 l6 -12" fill="none" stroke={accent} strokeWidth={1.8} strokeLinecap="round" />
            <text x={216} y={30} fontSize={10} fill={accent} opacity={0.9}>depth</text>
          </svg>
        );
      case "beaker":
        return (
          <svg width={250} height={210}>
            <path d="M78 30 l0 58 l-38 84 a14 14 0 0 0 13 20 l104 0 a14 14 0 0 0 13 -20 l-38 -84 l0 -58" {...stroke} strokeWidth={2.4} />
            <line x1={68} y1={30} x2={182} y2={30} {...stroke} strokeWidth={2.4} />
            <path d="M52 150 q36 -12 72 0 q36 12 62 0 l6 22 a14 14 0 0 1 -13 20 l-104 0 a14 14 0 0 1 -13 -20 z" fill={accent} opacity={0.28} stroke="none" />
            {[[96, 168], [128, 178], [156, 164], [112, 186]].map(([cx, cy], i) => (
              <circle key={i} cx={cx} cy={cy} r={4 + (i % 2)} {...stroke} strokeWidth={1.2} opacity={0.8} />
            ))}
            <path d="M200 66 q18 -14 34 0" {...stroke} strokeWidth={1.5} opacity={0.6} />
          </svg>
        );
      default:
        return null;
    }
  };

  return (
    <figure className="m-0">
      {art()}
      {caption && <figcaption className="mt-1 text-[13px] opacity-70">{caption}</figcaption>}
    </figure>
  );
}
