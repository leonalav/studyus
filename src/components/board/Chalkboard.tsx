import { memo, useEffect, useMemo, useRef, useState, useCallback } from "react";
import { Minus, Plus } from "lucide-react";
import type { Block, BoardDoc } from "../../data/boards";
import { DOMAIN_META } from "../../data/boards";
import { Latex, ChalkStrong } from "./Visuals";
import { VisualizationSurface } from "./VisualizationSurface";
import { WidgetSurface, type WidgetClusterInfo } from "./WidgetSurface";
import type { VisualizationState } from "../../lib/visualization/types";
import { WIDGET_LABEL, type WidgetState } from "../../lib/widgets/types";
import {
  clusterProgressText,
  collectClusters,
  groupIdOf,
  type ClusterMember,
} from "../../lib/widgets/cluster";
import { ErrorBoundary } from "../ErrorBoundary";

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

/** Block kinds that render at a bounded width, so their wrapper can shrink to
 *  the content and leave the surrounding board draggable. "visualization" and
 *  "row" are deliberately absent: both stretch to the content stream by design.
 */
const SHRINK_WRAP_BLOCKS = new Set<Block["kind"]>(["title", "text", "bullets", "latex", "callout", "widget"]);

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
  /** Persist a visualization block's interactive state (e.g. dragged point
   * positions) back into the board so it survives a session reopen. */
  onBlockStateChange?: (blockId: string, state: VisualizationState) => void;
  /** Persist a study widget's learner interaction (answers, slider position,
   * revealed steps) back into the board so it survives a session reopen and
   * reaches the tutor on the next turn. */
  onWidgetStateChange?: (blockId: string, state: WidgetState) => void;
  /** Render the canonical board without mutation, pan, zoom, or selection UI. */
  readOnly?: boolean;
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
  /** Original viewport dimensions let Past Notes scale the saved view exactly. */
  viewportWidth?: number;
  viewportHeight?: number;
}

const MIN_BOARD_ZOOM = 0.4;
const MAX_BOARD_ZOOM = 2.2;
const BOARD_ZOOM_STEP = 0.15;

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
  onBlockStateChange,
  onWidgetStateChange,
  readOnly = false,
}: Props) {
  const [view, setView] = useState<BoardView>(initialView ?? { x: 48, y: 36, s: 1 });
  const [revealed, setRevealed] = useState(writing ? 0 : board.blocks.length);

  /**
   * Cluster progress per widget block.
   *
   * Computed once for the whole board rather than inside each widget, because a
   * widget cannot see its siblings — and cluster membership is precisely a
   * statement about siblings. Rows are walked too, so a clustered widget placed
   * inside a two-column row still counts.
   */
  const clusterInfo = useMemo(() => {
    const members: ClusterMember[] = [];
    const walk = (blocks: Block[]) => {
      for (const blk of blocks) {
        if (blk.kind === "widget") members.push({ blockId: blk.id, intent: blk.intent, state: blk.state });
        else if (blk.kind === "row") walk(blk.children);
      }
    };
    walk(board.blocks);

    const map: Record<string, WidgetClusterInfo> = {};
    for (const cluster of collectClusters(members)) {
      const progressText = clusterProgressText(cluster);
      cluster.answerable.forEach((member, index) => {
        map[member.blockId] = {
          answered: cluster.answered,
          required: cluster.required,
          position: index + 1,
          label: cluster.label,
          progressText,
        };
      });
      // Presentational members of the cluster get the badge but no position:
      // they are context inside the set, not one of the things to answer.
      for (const member of members) {
        if (groupIdOf(member.intent) !== cluster.groupId || map[member.blockId]) continue;
        map[member.blockId] = {
          answered: cluster.answered,
          required: cluster.required,
          label: cluster.label,
          progressText,
        };
      }
    }
    return map;
  }, [board.blocks]);
  const [panning, setPanning] = useState(false);
  const [sel, setSel] = useState<{ text: string; x: number; y: number } | null>(null);
  const [askOpen, setAskOpen] = useState(false);
  const [askText, setAskText] = useState("");

  const wrapRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null);
  const viewRef = useRef(view);
  viewRef.current = view;
  const accent = DOMAIN_META[board.domain].accent;

  useEffect(() => {
    onRootRef?.(wrapRef.current);
    return () => onRootRef?.(null);
  }, [onRootRef]);

  const blockCountRef = useRef(board.blocks.length);
  blockCountRef.current = board.blocks.length;

  // A restored board starts fully visible; a newly written board reveals from
  // the beginning. Subsequent block arrivals never reset this progress.
  useEffect(() => {
    setRevealed(writing ? 0 : board.blocks.length);
  }, [board.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setRevealed((current) => Math.min(current, board.blocks.length));
  }, [board.id, board.blocks.length]);

  // Keep one ticker alive for the board identity. Tutor operations can arrive
  // faster than the reveal cadence without repeatedly cancelling the timer.
  useEffect(() => {
    const id = window.setInterval(() => {
      setRevealed((current) => current < blockCountRef.current ? current + 1 : current);
    }, 620);
    return () => window.clearInterval(id);
  }, [board.id]);

  useEffect(() => {
    setView(initialView ?? { x: 48, y: 36, s: 1 });
    setSel(null);
    setAskOpen(false);
  }, [board.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Read-only snapshots may provide a controlled camera (for example, Past
  // Notes' up/down controls). Keep live boards uncontrolled so their normal
  // drag and zoom behavior is unchanged.
  useEffect(() => {
    if (!readOnly || !initialView) return;
    setView((current) => (
      current.x === initialView.x && current.y === initialView.y && current.s === initialView.s
        ? current
        : { ...initialView }
    ));
  }, [initialView?.x, initialView?.y, initialView?.s, readOnly]);

  useEffect(() => {
    const viewport = wrapRef.current;
    onViewChange?.({
      ...view,
      viewportWidth: viewport?.clientWidth,
      viewportHeight: viewport?.clientHeight,
    });
  }, [view, onViewChange]);

  const onDown = (e: React.MouseEvent) => {
    if (readOnly || annotating) return;
    const t = e.target as HTMLElement;
    if (e.button !== 0 && e.button !== 1) return;
    if (t.closest("[data-nopan]")) return;
    // Left-drag over block CONTENT selects text instead of panning. But a
    // block's wrapper is full-width, so a click far to the right of a narrow
    // widget or paragraph still lands inside [data-block] with nothing to
    // select — that dead zone made the board feel unpannable. When the click
    // landed on the wrapper itself rather than any rendered child, it is empty
    // margin: pan.
    const block = e.button === 0 ? t.closest("[data-block]") : null;
    if (block && block !== t) return;
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
    if (readOnly || annotating) return;
    const target = e.target as HTMLElement;
    if (target.closest("[data-nopan]")) return;
    if (e.ctrlKey || e.metaKey) {
      const delta = -e.deltaY * 0.0016;
      setView((v) => ({ ...v, s: Math.min(MAX_BOARD_ZOOM, Math.max(MIN_BOARD_ZOOM, v.s + delta)) }));
    } else {
      setView((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }));
    }
  };

  const zoomBoard = useCallback((direction: -1 | 1) => {
    const box = wrapRef.current?.getBoundingClientRect();
    setView((current) => {
      const nextScale = Math.min(
        MAX_BOARD_ZOOM,
        Math.max(MIN_BOARD_ZOOM, Number((current.s + direction * BOARD_ZOOM_STEP).toFixed(2)))
      );
      if (nextScale === current.s) return current;

      // Keep the same board point under the viewport center while zooming so
      // keyboard/trackpad-free controls do not make the notes jump away.
      const centerX = (box?.width ?? 0) / 2;
      const centerY = (box?.height ?? 0) / 2;
      const boardX = (centerX - current.x) / current.s;
      const boardY = (centerY - current.y) / current.s;
      return {
        x: centerX - boardX * nextScale,
        y: centerY - boardY * nextScale,
        s: nextScale,
      };
    });
  }, []);

  const checkSelection = useCallback(() => {
    if (readOnly || annotating) return;
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
  }, [annotating, askOpen, readOnly]);

  useEffect(() => {
    if (readOnly) return;
    const h = () => window.setTimeout(checkSelection, 10);
    document.addEventListener("mouseup", h);
    return () => document.removeEventListener("mouseup", h);
  }, [checkSelection, readOnly]);

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
      if (!readOnly) {
        onViewChange?.({
          ...viewRef.current,
          viewportWidth: w.clientWidth,
          viewportHeight: w.clientHeight,
        });
      }
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(w);
    return () => ro.disconnect();
  }, [onViewChange, readOnly, redraw]);

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
    if (readOnly || !annotating) return;
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
        cursor: readOnly ? "default" : annotating ? "crosshair" : panning ? "grabbing" : "grab",
      }}
      aria-label={readOnly ? "Read-only chalkboard snapshot" : "Interactive chalkboard"}
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
        data-board-content
        className="absolute left-0 top-0 origin-top-left"
        style={{
          transform: `translate(${view.x}px, ${view.y}px) scale(${view.s})`,
          width: 920,
          color: theme.chalk,
          fontFamily: fontCss,
        }}
      >
        <div className="space-y-7">
          {/* Intentionally render a blank chalkboard when a session opens.
              The tutor fills the board with actual teaching content; we do not
              echo the learner's prompt or even the session title onto the board
              before any content exists. */}

          {board.blocks.slice(0, revealed).map((b, i) => (
            <div
              key={b.id}
              data-block
              /* Shrink-wrap blocks that render at a bounded width — widgets are
                 fixed-width instruments, prose and equations cap themselves —
                 so the empty board beside them stays board: draggable, with a
                 grab cursor rather than an I-beam. Without this the wrapper
                 spans the whole 920px stream and swallows left-drags landing
                 hundreds of pixels away from anything visible. Rows and
                 visualizations keep the full-width wrapper because their
                 internal layout depends on it; onDown covers their margins. */
              className={`${readOnly ? "" : containsVisualization(b) ? "anim-chalk-visual" : "anim-chalk"} ${readOnly ? "cursor-default" : "board-block select-text"} ${SHRINK_WRAP_BLOCKS.has(b.kind) ? "w-fit max-w-full" : ""}`}
              style={{ animationDelay: `${Math.min(i, 4) * 40}ms` }}
            >
              {/* One malformed block must never blank the board. A widget with
                  a truncated payload, a visualization with impossible bounds:
                  contain it here so every other block the tutor drew survives
                  and the session stays usable. */}
              <ErrorBoundary label={blockLabel(b)} resetKey={b.id}>
                <BlockView block={b} chalk={theme.chalk} accent={accent} scale={fontScale} latex={latex} onBlockStateChange={onBlockStateChange} onWidgetStateChange={onWidgetStateChange} blockId={b.id} readOnly={readOnly} cluster={clusterInfo[b.id]} clusterInfo={clusterInfo} />
              </ErrorBoundary>
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

      {!readOnly && (
        <>
      <div
        data-nopan
        className="absolute bottom-3 left-3 z-30 flex items-center overflow-hidden rounded-lg border border-white/15 bg-[#171819]/88 text-white shadow-[0_8px_24px_rgba(0,0,0,0.3)] backdrop-blur-md"
        role="group"
        aria-label="Board zoom controls"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          onClick={() => zoomBoard(-1)}
          disabled={view.s <= MIN_BOARD_ZOOM}
          className="grid h-8 w-8 place-items-center transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:text-white/20"
          aria-label="Zoom out"
          title="Zoom out"
        >
          <Minus size={15} strokeWidth={2.2} />
        </button>
        <output
          className="min-w-[48px] border-x border-white/10 px-2 text-center font-mono text-[10px] text-white/70"
          aria-live="polite"
          aria-label={`Board zoom ${Math.round(view.s * 100)} percent`}
        >
          {Math.round(view.s * 100)}%
        </output>
        <button
          type="button"
          onClick={() => zoomBoard(1)}
          disabled={view.s >= MAX_BOARD_ZOOM}
          className="grid h-8 w-8 place-items-center transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:text-white/20"
          aria-label="Zoom in"
          title="Zoom in"
        >
          <Plus size={15} strokeWidth={2.2} />
        </button>
      </div>

      <div className="pointer-events-none absolute bottom-3 left-[138px] rounded-md bg-black/40 px-2 py-1 font-mono text-[9.5px] text-white/55 backdrop-blur-sm">
        drag empty space to pan · ⌘/ctrl + scroll to zoom
      </div>
      <div className="pointer-events-none absolute bottom-3 right-3 max-w-[34%] truncate rounded-md bg-black/40 px-2 py-1 text-right font-mono text-[9.5px] text-white/55 backdrop-blur-sm" title={board.title}>
        {board.title}
      </div>
        </>
      )}
    </div>
  );
}

const BlockView = memo(function BlockView({
  block,
  chalk,
  accent,
  scale,
  latex,
  onBlockStateChange,
  onWidgetStateChange,
  blockId,
  readOnly = false,
  cluster,
  clusterInfo,
}: {
  block: Block;
  chalk: string;
  accent: string;
  scale: number;
  latex: boolean;
  onBlockStateChange?: (blockId: string, state: VisualizationState) => void;
  onWidgetStateChange?: (blockId: string, state: WidgetState) => void;
  blockId: string;
  readOnly?: boolean;
  cluster?: WidgetClusterInfo;
  /** Forwarded so a row can hand each child its own cluster slice. */
  clusterInfo?: Record<string, WidgetClusterInfo>;
}) {
  const handleVisualizationState = useCallback(
    (next: VisualizationState) => onBlockStateChange?.(blockId, next),
    [blockId, onBlockStateChange]
  );
  const handleWidgetState = useCallback(
    (next: WidgetState) => onWidgetStateChange?.(blockId, next),
    [blockId, onWidgetStateChange]
  );

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
    case "visualization":
      return (
        <VisualizationSurface
          intent={block.intent}
          state={block.state}
          chalk={chalk}
          accent={accent}
          scale={scale}
          onState={onBlockStateChange ? handleVisualizationState : undefined}
        />
      );
    case "widget":
      return (
        <WidgetSurface
          intent={block.intent}
          state={block.state}
          chalk={chalk}
          accent={accent}
          scale={scale}
          readOnly={readOnly}
          cluster={cluster}
          onState={onWidgetStateChange ? handleWidgetState : undefined}
        />
      );
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
              <ErrorBoundary label={blockLabel(child)} resetKey={child.id}>
              <BlockView block={child} chalk={chalk} accent={accent} scale={scale} latex={latex} onBlockStateChange={onBlockStateChange} onWidgetStateChange={onWidgetStateChange} blockId={child.id} readOnly={readOnly} cluster={clusterInfo?.[child.id]} clusterInfo={clusterInfo} />
              </ErrorBoundary>
            </div>
          ))}
        </div>
      );
    default:
      return null;
  }
});

/** Name a block for an error message the learner can actually act on. */
function blockLabel(block: Block): string {
  if (block.kind === "widget") return `${WIDGET_LABEL[block.intent.kind]} widget`;
  if (block.kind === "visualization") return "Visualization";
  return "Board block";
}

function containsVisualization(block: Block): boolean {
  return block.kind === "visualization"
    || block.kind === "widget"
    || (block.kind === "row" && block.children.some(containsVisualization));
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
