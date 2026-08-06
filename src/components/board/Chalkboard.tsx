import { useEffect, useRef, useState, useCallback } from "react";
import type { Block, BoardDoc } from "../../data/boards";
import { DOMAIN_META } from "../../data/boards";
import { Latex, Graph2D, Graph3D, Diagram, ChalkStrong } from "./Visuals";

export interface BoardTheme {
  id: "classic" | "blueprint" | "carbon";
  label: string;
  bg: string;
  grid: string;
  chalk: string;
  swatch: string;
}

export const THEMES: BoardTheme[] = [
  {
    id: "classic",
    label: "Classic green",
    bg: "radial-gradient(120% 90% at 30% 10%, #2f5646 0%, #244136 45%, #1b332a 100%)",
    grid: "linear-gradient(rgba(255,255,255,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.05) 1px, transparent 1px)",
    chalk: "#eef6f1",
    swatch: "#2f5646",
  },
  {
    id: "blueprint",
    label: "White + blue grid",
    bg: "#f7f9fc",
    grid: "linear-gradient(rgba(37,99,235,0.13) 1px, transparent 1px), linear-gradient(90deg, rgba(37,99,235,0.13) 1px, transparent 1px)",
    chalk: "#12305c",
    swatch: "#e8eefc",
  },
  {
    id: "carbon",
    label: "Dark texture",
    bg: "radial-gradient(120% 90% at 20% 0%, #24262b 0%, #191b1f 50%, #101114 100%)",
    grid: "radial-gradient(rgba(255,255,255,0.055) 1px, transparent 1px)",
    chalk: "#e9e9e6",
    swatch: "#1d1f23",
  },
];

export const FONTS = [
  { id: "gloria", label: "Gloria Hallelujah", css: "'Gloria Hallelujah', cursive" },
  { id: "playwrite", label: "Playwrite NZ", css: "'Playwrite NZ', cursive" },
  { id: "playpen", label: "Playpen Sans", css: "'Playpen Sans', cursive" },
  { id: "indie", label: "Indie Flower", css: "'Indie Flower', cursive" },
  { id: "schoolbell", label: "Schoolbell", css: "'Schoolbell', cursive" },
];

interface Props {
  board: BoardDoc;
  theme: BoardTheme;
  fontCss: string;
  fontScale: number;
  writing: boolean;
  latex: boolean;
  onAsk: (selection: string, question: string) => void;
  annotating: boolean;
  penColor: string;
  penTool: "pen" | "highlighter" | "eraser";
  strokesKey: string;
  onClearRef?: (fn: () => void) => void;
  onRootRef?: (node: HTMLDivElement | null) => void;
  initialView?: BoardView;
  onViewChange?: (view: BoardView) => void;
  initialStrokes?: Stroke[];
  onStrokesChange?: (strokes: Stroke[]) => void;
}

export interface Stroke {
  pts: { x: number; y: number }[];
  color: string;
  width: number;
  alpha: number;
  erase: boolean;
}

export interface BoardView {
  x: number;
  y: number;
  s: number;
}

export function Chalkboard({
  board,
  theme,
  fontCss,
  fontScale,
  writing,
  latex,
  onAsk,
  annotating,
  penColor,
  penTool,
  strokesKey,
  onClearRef,
  onRootRef,
  initialView,
  onViewChange,
  initialStrokes,
  onStrokesChange,
}: Props) {
  const [view, setView] = useState<BoardView>(initialView ?? { x: 48, y: 36, s: 1 });
  const [revealed, setRevealed] = useState(writing ? 0 : board.blocks.length);
  const [panning, setPanning] = useState(false);
  const [sel, setSel] = useState<{ text: string; x: number; y: number } | null>(null);
  const [askOpen, setAskOpen] = useState(false);
  const [askText, setAskText] = useState("");

  const wrapRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null);
  const accent = DOMAIN_META[board.domain].accent;

  useEffect(() => {
    onRootRef?.(wrapRef.current);
    return () => onRootRef?.(null);
  }, [onRootRef]);

  useEffect(() => {
    setRevealed(writing ? 0 : board.blocks.length);
    if (!writing) return;
    let i = 0;
    const id = window.setInterval(() => {
      i += 1;
      setRevealed(i);
      if (i >= board.blocks.length) window.clearInterval(id);
    }, 620);
    return () => window.clearInterval(id);
  }, [board.id, writing, board.blocks.length]);

  useEffect(() => {
    setView(initialView ?? { x: 48, y: 36, s: 1 });
    setSel(null);
    setAskOpen(false);
  }, [board.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    onViewChange?.(view);
  }, [view, onViewChange]);

  const onDown = (e: React.MouseEvent) => {
    if (annotating) return;
    const t = e.target as HTMLElement;
    if (e.button !== 0 && e.button !== 1) return;
    if (t.closest("[data-nopan]")) return;
    if (e.button === 0 && t.closest("[data-block]")) return;
    dragRef.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
    setPanning(true);
  };

  useEffect(() => {
    if (!panning) return;
    const move = (e: MouseEvent) => {
      const d = dragRef.current;
      if (!d) return;
      setView((v) => ({ ...v, x: d.vx + (e.clientX - d.x), y: d.vy + (e.clientY - d.y) }));
    };
    const up = () => {
      setPanning(false);
      dragRef.current = null;
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
  }, [panning]);

  const onWheel = (e: React.WheelEvent) => {
    if (annotating) return;
    if (e.ctrlKey || e.metaKey) {
      const delta = -e.deltaY * 0.0016;
      setView((v) => ({ ...v, s: Math.min(2.2, Math.max(0.4, v.s + delta)) }));
    } else {
      setView((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }));
    }
  };

  const checkSelection = useCallback(() => {
    if (annotating) return;
    const s = window.getSelection();
    const text = s?.toString().trim() ?? "";
    if (!text || text.length < 3 || !wrapRef.current) {
      if (!askOpen) setSel(null);
      return;
    }
    const range = s!.getRangeAt(0);
    const r = range.getBoundingClientRect();
    const box = wrapRef.current.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return;
    setSel({ text, x: r.left - box.left + r.width / 2, y: r.top - box.top });
  }, [annotating, askOpen]);

  useEffect(() => {
    const h = () => window.setTimeout(checkSelection, 10);
    document.addEventListener("mouseup", h);
    return () => document.removeEventListener("mouseup", h);
  }, [checkSelection]);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const strokes = useRef<Stroke[]>([]);
  const cur = useRef<Stroke | null>(null);

  const redraw = useCallback(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, c.width, c.height);
    for (const st of [...strokes.current, ...(cur.current ? [cur.current] : [])]) {
      if (st.pts.length < 2) continue;
      ctx.save();
      ctx.globalCompositeOperation = st.erase ? "destination-out" : "source-over";
      ctx.globalAlpha = st.alpha;
      ctx.strokeStyle = st.color;
      ctx.lineWidth = st.width;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      ctx.moveTo(st.pts[0].x, st.pts[0].y);
      for (let i = 1; i < st.pts.length; i++) ctx.lineTo(st.pts[i].x, st.pts[i].y);
      ctx.stroke();
      ctx.restore();
    }
  }, []);

  useEffect(() => {
    const c = canvasRef.current;
    const w = wrapRef.current;
    if (!c || !w) return;
    const fit = () => {
      c.width = w.clientWidth;
      c.height = w.clientHeight;
      redraw();
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(w);
    return () => ro.disconnect();
  }, [redraw]);

  useEffect(() => {
    strokes.current = initialStrokes ? initialStrokes.map((stroke) => ({ ...stroke, pts: [...stroke.pts] })) : [];
    cur.current = null;
    redraw();
  }, [strokesKey, redraw]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    onClearRef?.(() => {
      strokes.current = [];
      redraw();
      onStrokesChange?.([]);
    });
  }, [onClearRef, onStrokesChange, redraw]);

  const annDown = (e: React.MouseEvent) => {
    if (!annotating) return;
    const r = canvasRef.current!.getBoundingClientRect();
    const p = { x: e.clientX - r.left, y: e.clientY - r.top };
    cur.current = {
      pts: [p],
      color: penColor,
      width: penTool === "highlighter" ? 18 : penTool === "eraser" ? 26 : 3,
      alpha: penTool === "highlighter" ? 0.32 : 1,
      erase: penTool === "eraser",
    };
  };
  const annMove = (e: React.MouseEvent) => {
    if (!annotating || !cur.current) return;
    const r = canvasRef.current!.getBoundingClientRect();
    cur.current.pts.push({ x: e.clientX - r.left, y: e.clientY - r.top });
    redraw();
  };
  const annUp = () => {
    if (cur.current) strokes.current.push(cur.current);
    cur.current = null;
    redraw();
    onStrokesChange?.(strokes.current.map((stroke) => ({ ...stroke, pts: [...stroke.pts] })));
  };

  const gridSize = theme.id === "blueprint" ? 28 : 22;

  return (
    <div
      ref={wrapRef}
      onMouseDown={onDown}
      onWheel={onWheel}
      className="relative h-full w-full overflow-hidden select-none"
      style={{
        background: theme.bg,
        cursor: annotating ? "crosshair" : panning ? "grabbing" : "grab",
      }}
    >
      {/* ordered grid behind the content */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage: theme.grid,
          backgroundSize: `${gridSize * view.s}px ${gridSize * view.s}px`,
          backgroundPosition: `${view.x}px ${view.y}px`,
          opacity: theme.id === "blueprint" ? 1 : 0.85,
        }}
      />
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            theme.id === "blueprint"
              ? "radial-gradient(140% 100% at 50% 0%, rgba(255,255,255,0.5), transparent 60%)"
              : "radial-gradient(130% 100% at 50% 0%, rgba(255,255,255,0.06), transparent 55%), radial-gradient(90% 70% at 80% 100%, rgba(0,0,0,0.28), transparent 60%)",
        }}
      />

      {/* ordered content stream — vertical stack, never absolute chaos */}
      <div
        className="absolute left-0 top-0 origin-top-left"
        style={{
          transform: `translate(${view.x}px, ${view.y}px) scale(${view.s})`,
          width: 920,
          color: theme.chalk,
          fontFamily: fontCss,
        }}
      >
        <div className="space-y-7">
          {board.blocks.length === 0 && (
            <div className="anim-chalk max-w-[640px]" style={{ opacity: 0.85 }}>
              <div style={{ fontSize: 34, lineHeight: 1.25 }}>{board.title}</div>
            </div>
          )}

          {board.blocks.slice(0, revealed).map((b, i) => (
            <div
              key={b.id}
              data-block
              className="anim-chalk cursor-text select-text"
              style={{ animationDelay: `${Math.min(i, 4) * 40}ms` }}
            >
              <BlockView block={b} chalk={theme.chalk} accent={accent} scale={fontScale} latex={latex} />
            </div>
          ))}

          {writing && revealed < board.blocks.length && (
            <div className="flex items-center gap-2" style={{ color: accent }}>
              <span className="h-4 w-[3px] animate-pulse rounded-full" style={{ background: accent }} />
              <span className="font-mono text-[11px] opacity-70">writing…</span>
            </div>
          )}
        </div>
      </div>

      <canvas
        ref={canvasRef}
        onMouseDown={annDown}
        onMouseMove={annMove}
        onMouseUp={annUp}
        onMouseLeave={annUp}
        className="absolute inset-0"
        style={{ pointerEvents: annotating ? "auto" : "none" }}
      />

      {sel && !askOpen && (
        <button
          data-nopan
          onMouseDown={(e) => e.stopPropagation()}
          onClick={() => setAskOpen(true)}
          className="anim-toast absolute z-30 -translate-x-1/2 -translate-y-full rounded-md bg-[#1a1a1a] px-3 py-1.5 text-[12px] font-medium text-white shadow-[0_8px_24px_rgba(0,0,0,0.5)] ring-1 ring-white/12"
          style={{ left: sel.x, top: sel.y - 8 }}
        >
          Ask about this
        </button>
      )}

      {sel && askOpen && (
        <div
          data-nopan
          onMouseDown={(e) => e.stopPropagation()}
          className="anim-toast absolute z-30 w-[340px] -translate-x-1/2 -translate-y-full overflow-hidden rounded-xl border border-white/10 bg-[#1c1c1e]/96 shadow-[0_18px_50px_rgba(0,0,0,0.55)] backdrop-blur-md"
          style={{ left: Math.max(180, Math.min(sel.x, (wrapRef.current?.clientWidth ?? 400) - 180)), top: sel.y - 8 }}
        >
          <div className="border-b border-white/8 px-3 py-2">
            <div className="mb-1 text-[10px] uppercase tracking-[0.14em] text-white/40">Selected</div>
            <p className="line-clamp-2 text-[12px] leading-snug text-white/70">"{sel.text}"</p>
          </div>
          <div className="flex items-center gap-2 px-2.5 py-2">
            <input
              autoFocus
              value={askText}
              onChange={(e) => setAskText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && askText.trim()) {
                  onAsk(sel.text, askText.trim());
                  setAskText("");
                  setAskOpen(false);
                  setSel(null);
                  window.getSelection()?.removeAllRanges();
                }
              }}
              placeholder="What about this confuses you?"
              className="min-w-0 flex-1 rounded-md bg-white/[0.06] px-2.5 py-1.5 text-[12.5px] text-white outline-none placeholder:text-white/30"
            />
            <button
              onClick={() => {
                if (!askText.trim()) return;
                onAsk(sel.text, askText.trim());
                setAskText("");
                setAskOpen(false);
                setSel(null);
                window.getSelection()?.removeAllRanges();
              }}
              className="rounded-md px-2.5 py-1.5 text-[12px] font-medium text-black"
              style={{ background: accent }}
            >
              Send
            </button>
            <button
              onClick={() => {
                setAskOpen(false);
                setSel(null);
              }}
              className="rounded-md px-2 py-1.5 text-[12px] text-white/45 hover:text-white"
            >
              Close
            </button>
          </div>
          <div className="border-t border-white/8 px-3 py-1.5 font-mono text-[10px] text-white/30">
            Opens a new board in Threads
          </div>
        </div>
      )}

      <div className="pointer-events-none absolute bottom-3 left-3 rounded-md bg-black/45 px-2 py-1 font-mono text-[10px] text-white/65 backdrop-blur-sm">
        {Math.round(view.s * 100)}% · drag empty space to pan · ⌘/ctrl + scroll to zoom
      </div>
    </div>
  );
}

function BlockView({
  block,
  chalk,
  accent,
  scale,
  latex,
}: {
  block: Block;
  chalk: string;
  accent: string;
  scale: number;
  latex: boolean;
}) {
  switch (block.kind) {
    case "title":
      return (
        <div>
          <h2 style={{ fontSize: 40 * scale, lineHeight: 1.15 }} className="font-normal">
            <ChalkStrong>{block.text}</ChalkStrong>
          </h2>
          <svg width="240" height="10" className="mt-1 opacity-70">
            <path d="M2 6 Q60 1 118 6 T236 4" fill="none" stroke={accent} strokeWidth={2.4} strokeLinecap="round" />
          </svg>
        </div>
      );
    case "text":
      return (
        <p style={{ fontSize: 19 * scale, lineHeight: 1.65 }} className="max-w-[640px]">
          {renderTextWithStrong(block.text)}
        </p>
      );
    case "bullets":
      return (
        <ul className="max-w-[560px] space-y-2">
          {block.items.map((it, i) => (
            <li key={i} className="flex items-start gap-2.5" style={{ fontSize: 18 * scale, lineHeight: 1.5 }}>
              <span style={{ color: accent }}>›</span>
              <span>{renderTextWithStrong(it)}</span>
            </li>
          ))}
        </ul>
      );
    case "latex":
      return (
        <div className="max-w-[460px]">
          {latex ? (
            <Latex tex={block.tex} color={chalk} size={26 * scale} />
          ) : (
            <code className="block rounded bg-black/20 px-2 py-1 font-mono" style={{ fontSize: 15 * scale }}>
              {block.tex}
            </code>
          )}
          {block.caption && (
            <div style={{ fontSize: 15 * scale }} className="mt-0.5 opacity-70">
              {renderTextWithStrong(block.caption)}
            </div>
          )}
        </div>
      );
    case "graph2d":
      return <Graph2D fn={block.fn} domainX={block.domainX} caption={block.caption} curves={block.curves} color={chalk} accent={accent} />;
    case "graph3d":
      return <Graph3D surface={block.surface} caption={block.caption} color={chalk} accent={accent} />;
    case "diagram":
      return <Diagram variant={block.variant} caption={block.caption} color={chalk} accent={accent} />;
    case "callout":
      return (
        <div
          className="max-w-[420px] rounded-lg border-2 border-dashed px-4 py-2.5"
          style={{ borderColor: `${accent}88`, fontSize: 18 * scale }}
        >
          <ChalkStrong>{block.text}</ChalkStrong>
        </div>
      );
    case "row":
      return (
        <div className="grid grid-cols-1 gap-8 md:grid-cols-2 md:items-start">
          {block.children.map((child) => (
            <div key={child.id} data-block className="min-w-0">
              <BlockView block={child} chalk={chalk} accent={accent} scale={scale} latex={latex} />
            </div>
          ))}
        </div>
      );
    default:
      return null;
  }
}

/* `**bold**` and `*em*` markers become yellow-strong text in chalk. */
function renderTextWithStrong(text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <ChalkStrong key={i}>{part.slice(2, -2)}</ChalkStrong>;
    }
    if (part.startsWith("*") && part.endsWith("*") && part.length > 2) {
      return <em key={i} className="opacity-90">{part.slice(1, -1)}</em>;
    }
    return <span key={i}>{part}</span>;
  });
}
