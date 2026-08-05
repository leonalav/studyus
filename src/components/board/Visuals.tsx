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

/* ── Shared plot helpers ── */

const FNS: Record<string, (x: number) => number> = {
  parabola: (x) => x * x,
  sqrt: (x) => 8 / Math.sqrt(x),
  decay: (x) => 6 * Math.exp(-0.45 * x),
  logistic: (x) => 8 / (1 + Math.exp(-1.3 * (x - 5))),
  sin: Math.sin,
  cos: Math.cos,
};

function path(fn: (x: number) => number, x0: number, x1: number, sx: (x: number) => number, sy: (y: number) => number) {
  const steps = 140;
  let d = "";
  for (let i = 0; i <= steps; i++) {
    const x = x0 + ((x1 - x0) * i) / steps;
    const y = fn(x);
    if (!isFinite(y)) continue;
    d += `${d ? "L" : "M"}${sx(x).toFixed(1)},${sy(y).toFixed(1)}`;
  }
  return d;
}

/* ── 2D graph ── */

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
  const W = 300;
  const H = 200;
  const pad = 26;
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
      const palette = [accent, "#f9a8d4"];
      return curves.map((c, i) => ({ f: FNS[c] ?? FNS.sin, c: palette[i % palette.length], label: c }));
    }
    return [{ f: FNS[fn] ?? FNS.parabola, c: accent, label: fn }];
  }, [fn, curves, accent]);

  const yVals = series.flatMap((s) => {
    const out: number[] = [];
    for (let i = 0; i <= 40; i++) {
      const v = s.f(x0 + ((x1 - x0) * i) / 40);
      if (isFinite(v)) out.push(v);
    }
    return out;
  });
  const yMin = Math.min(0, ...yVals);
  const yMax = Math.max(1, ...yVals);

  const sx = (x: number) => pad + ((x - x0) / (x1 - x0)) * (W - pad * 2);
  const sy = (y: number) => H - pad - ((y - yMin) / (yMax - yMin)) * (H - pad * 2);

  return (
    <figure className="m-0">
      <svg width={W} height={H} className="overflow-visible">
        {/* axes */}
        <line x1={pad} y1={H - pad} x2={W - pad + 8} y2={H - pad} stroke={color} strokeWidth={1.6} opacity={0.75} strokeLinecap="round" />
        <line x1={pad} y1={H - pad} x2={pad} y2={pad - 8} stroke={color} strokeWidth={1.6} opacity={0.75} strokeLinecap="round" />
        {/* ticks */}
        {[0.25, 0.5, 0.75].map((t) => (
          <line
            key={t}
            x1={pad + t * (W - pad * 2)}
            y1={H - pad - 4}
            x2={pad + t * (W - pad * 2)}
            y2={H - pad + 4}
            stroke={color}
            strokeWidth={1.2}
            opacity={0.5}
          />
        ))}
        {series.map((s, i) => (
          <path
            key={i}
            d={path(s.f, x0, x1, sx, sy)}
            fill="none"
            stroke={s.c}
            strokeWidth={2.2}
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity={0.95}
          />
        ))}
        {/* tangent line for parabola */}
        {fn === "parabola" && (
          <line
            x1={sx(Math.max(x0, -0.5))}
            y1={sy(2 * Math.max(x0, -0.5) - 1)}
            x2={sx(Math.min(x1, 2.6))}
            y2={sy(2 * Math.min(x1, 2.6) - 1)}
            stroke="#fbbf24"
            strokeWidth={1.6}
            strokeDasharray="5 4"
            opacity={0.9}
          />
        )}
        {series.length > 1 && (
          <g>
            {series.map((s, i) => (
              <g key={i} transform={`translate(${W - pad - 62}, ${pad + i * 15})`}>
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

/* ── 3D wireframe surface ── */

const SURFACES: Record<string, (x: number, y: number) => number> = {
  saddle: (x, y) => (x * x - y * y) * 0.55,
  well: (x, y) => -2.6 / Math.sqrt(x * x + y * y + 0.35),
  ripple: (x, y) => Math.sin(Math.sqrt(x * x + y * y) * 1.5) * 1.1,
};

export function Graph3D({ surface, caption, color, accent }: { surface: string; caption?: string; color: string; accent: string }) {
  const W = 300;
  const H = 210;
  const N = 13;
  const f = SURFACES[surface] ?? SURFACES.saddle;

  const { rows, cols } = useMemo(() => {
    const cx = W / 2;
    const cy = H / 2 + 30;
    const s = 11;
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
    <figure className="m-0">
      <svg width={W} height={H} className="overflow-visible">
        {rows.map((p, i) => (
          <polyline key={`r${i}`} points={p} fill="none" stroke={accent} strokeWidth={1.1} opacity={0.32 + (i / N) * 0.5} strokeLinejoin="round" />
        ))}
        {cols.map((p, i) => (
          <polyline key={`c${i}`} points={p} fill="none" stroke={color} strokeWidth={1} opacity={0.22 + (i / N) * 0.4} strokeLinejoin="round" />
        ))}
        {/* axes hint */}
        <g opacity={0.55} stroke={color} strokeWidth={1.3} strokeLinecap="round">
          <line x1={26} y1={H - 18} x2={64} y2={H - 34} />
          <line x1={26} y1={H - 18} x2={64} y2={H - 2} />
          <line x1={26} y1={H - 18} x2={26} y2={H - 56} />
        </g>
        <text x={68} y={H - 33} fontSize={9.5} fill={color} opacity={0.7}>x</text>
        <text x={68} y={H - 1} fontSize={9.5} fill={color} opacity={0.7}>y</text>
        <text x={20} y={H - 60} fontSize={9.5} fill={color} opacity={0.7}>z</text>
      </svg>
      {caption && <figcaption className="mt-1 text-[13px] opacity-70">{caption}</figcaption>}
    </figure>
  );
}

/* ── Chalk diagrams ── */

/* Handwriting fonts don't ship bold weights — render "bold" as a soft yellow shade. */
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
