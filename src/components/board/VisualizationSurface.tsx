/**
 * Visualization Surface — the single render target for `kind: "visualization"`
 * board blocks.
 *
 * This component is the React-side half of the Visualization Router. It takes
 * a validated VisualizationIntent plus the chalkboard's chalk/accent palette,
 * routes it (via `routeVisualization`) to the correct adapter, and renders it
 * with the chalk-styling recipe carried forward from the old placeholder
 * SVG art:
 *   - axes        stroke=chalk  strokeWidth 1.6  opacity 0.75
 *   - ticks       stroke=chalk  strokeWidth 1.2  opacity 0.6
 *   - curves      strokeWidth 2.2  strokeLinecap round  opacity 0.95
 *   - constructionlines strokeDasharray "7 6" / "4 4"
 *   - accent fills opacity ~0.28–0.75 (sparingly)
 *   - labels      chalk/accent  opacity 0.7–0.85
 *   - caption     mt-1 text-[13px] opacity-70
 *
 * The LLM never knows that geometry/function are JSXGraph and equations are
 * KaTeX — that decision lives in the router, one layer below this component.
 *
 * Interactive geometry points are draggable; when a point moves, `onState` is
 * called with the updated `pointPositions` so the caller can persist the
 * learner's manipulations with the session (Task #6).
 */

import { useEffect, useMemo, useRef, useState } from "react";
import JXG from "jsxgraph";
import { renderMath } from "../../lib/latex/render";
import type { Board, Point, GeometryElement } from "jsxgraph";
import type {
  VisualizationIntent,
  VisualizationState,
  GeometryIntent,
  GeometryObject,
  FunctionIntent,
  CircleObject,
} from "../../lib/visualization/types";
import { routeVisualization } from "../../lib/visualization/router";

export interface VisualizationSurfaceProps {
  intent: VisualizationIntent;
  state?: VisualizationState;
  chalk: string;
  accent: string;
  scale?: number;
  onState?: (next: VisualizationState) => void;
}

/** Multi-series palette carried over from the placeholder Graph2D. */
const SERIES_PALETTE = ["#f9a8d4", "#60a5fa", "#fbbf24", "#4ade80"];

/** Angle arc radius, in user units. Shared with `geometryExtent` so the arc is
 *  part of the measured footprint rather than an unaccounted overhang. */
const ANGLE_ARC_RADIUS = 0.8;

type LabelAttrs = Record<string, unknown>;

export function VisualizationSurface({
  intent,
  state,
  chalk,
  accent,
  scale = 1,
  onState,
}: VisualizationSurfaceProps) {
  const model = useMemo(() => routeVisualization(intent), [intent]);
  // Geometry & function intents carry "title"; equation/chart/diagram carry
  // "caption". Surface whichever exists so the figure's author-supplied label
  // always renders.
  const caption =
    ("title" in intent && intent.title) || ("caption" in intent && intent.caption) || undefined;

  if (model.unsupported) {
    return <UnsupportedCard reason={model.unsupportedReason ?? "Unsupported visualization"} chalk={chalk} accent={accent} caption={caption} />;
  }

  switch (model.adapterId) {
    case "jsxgraph":
      return <JsxGraphSurface intent={intent} state={state} chalk={chalk} accent={accent} scale={scale} onState={onState} />;
    case "katex":
      return <EquationSurface intent={intent as Extract<VisualizationIntent, { type: "equation" }>} chalk={chalk} accent={accent} scale={scale} caption={caption} />;
    default:
      return <UnsupportedCard reason="No renderer for this intent" chalk={chalk} accent={accent} caption={caption} />;
  }
}

/* ───────────────────────── JSXGraph (geometry + function) ───────────────────────── */

function JsxGraphSurface({
  intent,
  state,
  chalk,
  accent,
  scale,
  onState,
}: {
  intent: VisualizationIntent;
  state?: VisualizationState;
  chalk: string;
  accent: string;
  scale: number;
  onState?: (next: VisualizationState) => void;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const onStateRef = useRef(onState);
  onStateRef.current = onState;

  // Persisted point positions to seed the board with. Keyed on the intent
  // identity (NOT on the live `state` prop) so that an echo of our own drag
  // back down from the parent does NOT re-init the board mid-drag. When the
  // intent changes (or the block is restored on session reopen) this is
  // recomputed fresh and the new positions are applied.
  const seedKey = useMemo(() => JSON.stringify(intent), [intent]);
  const seedPositions = useMemo(
    () => (state?.pointPositions as Record<string, [number, number]>) ?? {},
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [seedKey]
  );

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    // Unique board container id (JSXGraph attaches by id).
    const containerId = `jsxcell-${Math.random().toString(36).slice(2, 9)}`;
    host.id = containerId;

    const isGeometry = intent.type === "geometry";
    const isFunction = intent.type === "function";

    // The figure's true extent, in user units.
    const figureBox = computeBoundingBox(intent, { pointPositions: seedPositions });

    // Under `keepaspectratio` JSXGraph reconciles the box against the container
    // by picking a "dominating interval", and which one it picks depends on
    // both the container and the box — that is where figures lost their edges.
    // We take that decision away from it: expand the figure box symmetrically
    // until its aspect EXACTLY matches the container, so the fit is an identity
    // and the whole figure is guaranteed visible with square units.
    const fitted = () => fitBoxToAspect(figureBox, host.clientWidth, host.clientHeight);

    const board: Board = JXG.JSXGraph.initBoard(containerId, {
      boundingbox: fitted(),
      keepaspectratio: isGeometry,
      showCopyright: false,
      showNavigation: false,
      pan: { enabled: false, needShift: false },
      zoom: { wheel: false, needShift: false, factorX: 1, factorY: 1 },
      axis: false,
      grid: false,
      defaultAxes: {},
    });

    // Seed from persisted positions (stable per intent; see seedPositions).
    const positions: Record<string, [number, number]> = { ...seedPositions };
    const created: Record<string, GeometryElement> = {};

    // Chalk-styled axes (carried from placeholder Graph2D: strokeWidth 1.6, opacity 0.75).
    const axisAttrs = {
      strokeColor: chalk,
      strokeWidth: 1.6,
      highlight: false,
      ticks: {
        strokeColor: chalk,
        strokeWidth: 1.2,
        majorHeight: 4,
        minorHeight: 0,
        ticksDistance: 1,
        label: {
          fontSize: 10,
          color: chalk,
          opacity: 0.85,
          anchorX: "middle",
          cssStyle: "font-family: monospace",
        } as LabelAttrs,
      },
    };
    // Only draw axes when the origin actually lies inside the FIGURE's box.
    // A geometry figure centered away from (0,0) — e.g. a circle centered at
    // (5, 5) — would otherwise get an axis line and arrowhead slicing across it
    // from off-canvas, which reads as "parts going off the line". Function
    // plots always include x=0 in a sensible band, so they keep their axes.
    // Tested against the figure box, not the aspect-fitted one, so a wide
    // container doesn't drag the origin into view and re-introduce the artifact.
    const [fxMin, fyMax, fxMax, fyMin] = figureBox;
    const originInView =
      isFunction ||
      (0 >= fxMin && 0 <= fxMax && 0 >= fyMin && 0 <= fyMax);
    if (originInView) {
      try {
        board.create("axis", [[0, 0], [1, 0]], axisAttrs);
        board.create("axis", [[0, 0], [0, 1]], axisAttrs);
      } catch {
        /* axes optional — geometry boards may omit them gracefully */
      }
    }

    if (isGeometry) {
      renderGeometry(board, intent, created, positions, chalk, accent);
    } else if (isFunction) {
      renderFunction(board, intent as FunctionIntent, chalk, accent);
    }

    // ── Persist drag positions (Task #6) ──
    const reportState = () => {
      const nextPos: Record<string, [number, number]> = {};
      let changed = false;
      for (const [id, obj] of Object.entries(created)) {
        const p = obj as Partial<Point> & { X?: () => number; Y?: () => number };
        if (typeof p.X === "function" && typeof p.Y === "function") {
          const x = p.X();
          const y = p.Y();
          nextPos[id] = [x, y];
          if (!positions[id] || positions[id][0] !== x || positions[id][1] !== y) {
            positions[id] = [x, y];
            changed = true;
          }
        }
      }
      if (changed && onStateRef.current) {
        // Base-merge on the stable seed, NOT the live `state` prop — echoing our
        // own drag back as a new `state` would otherwise re-init the board.
        onStateRef.current({ pointPositions: { ...seedPositions, ...nextPos } });
      }
    };
    if (isGeometry && onState) {
      board.on("update", reportState);
    }

    board.update();

    // JSXGraph sizes its SVG to the host, and the host's height comes from the
    // figure's aspect (see BoardHost). On every resize we recompute the
    // aspect-matched box for the CURRENT container and apply it, so the whole
    // figure stays visible at any column width. Drag persistence is unaffected —
    // resizing does not re-init the board.
    //
    // We always apply a freshly-computed box rather than letting resizeContainer
    // round-trip through getBoundingBox(): that getter returns the currently
    // *visible* box, so feeding it back on each resize compounds the padding
    // and the figure creeps toward a corner. `dontset`/`dontSetBoundingBox`
    // both true keeps React the sole owner of the container's inline size and
    // skips that round-trip. For geometry we recompute from the LIVE point
    // positions, so a point the learner dragged outward is brought back into
    // frame on the next resize instead of staying stranded off-canvas.
    const resize = () => {
      const w = host.clientWidth;
      const h = host.clientHeight;
      if (w > 0 && h > 0) {
        try {
          board.resizeContainer(w, h, true, true);
          const liveBox = isGeometry
            ? computeBoundingBox(intent, { pointPositions: positions })
            : figureBox;
          board.setBoundingBox(fitBoxToAspect(liveBox, w, h), isGeometry, "reset");
          board.fullUpdate();
        } catch {
          /* board already freed */
        }
      }
    };
    const ro = new ResizeObserver(resize);
    ro.observe(host);

    return () => {
      ro.disconnect();
      if (isGeometry && onState) board.off("update", reportState);
      JXG.JSXGraph.freeBoard(board);
    };
    // Re-init only when the visual identity changes. We intentionally do NOT
    // depend on `state.pointPositions`: `saveBlockState` echoes our own drag
    // back down as a new `state` prop, which would re-init the board mid-drag.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intent, chalk, accent, scale]);

  const isGeometry = intent.type === "geometry";
  const heightPx = Math.round(230 * Math.max(0.55, Math.min(scale, 1.4)));
  const title = "title" in intent ? intent.title : undefined;

  return <BoardHost hostRef={hostRef} isGeometry={isGeometry} intent={intent} seedPositions={seedPositions} heightPx={heightPx} title={title} />;
}

/** Build JSXGraph objects for a geometry intent, honoring persisted positions. */
function renderGeometry(
  board: Board,
  intent: GeometryIntent,
  created: Record<string, GeometryElement>,
  positions: Record<string, [number, number]>,
  chalk: string,
  accent: string
) {
  const ref = (id: string): GeometryElement | undefined => created[id];
  const lineStyle = (o: { style?: { color?: string; strokeWidth?: number; dash?: boolean } }) => ({
    strokeColor: o.style?.color ?? chalk,
    strokeWidth: o.style?.strokeWidth ?? 2.2,
    dash: o.style?.dash ? 2 : 0,
    highlight: false,
    opacity: 0.95,
    strokeLinecap: "round",
  });

  // First pass: points (everything else references points by id).
  for (const obj of intent.objects) {
    if (obj.kind === "point") {
      const pt = positions[obj.id] ?? obj.at;
      created[obj.id] = board.create("point", pt, {
        name: obj.label ?? "",
        size: 3,
        fillColor: accent,
        strokeColor: chalk,
        strokeWidth: 1.2,
        fixed: obj.draggable === false,
        showInfobox: false,
        snapToGrid: false,
        label: {
          offset: [6, 8],
          fontSize: 13,
          color: chalk,
          opacity: 0.85,
          cssStyle: "font-family: monospace",
        } as LabelAttrs,
      }) as GeometryElement;
    }
  }

  // Second pass: the rest, resolving referenced point ids from `created`.
  for (const obj of intent.objects) {
    switch (obj.kind) {
      case "point":
        continue; // already created
      case "line": {
        const [a, b] = obj.through;
        if (ref(a) && ref(b)) board.create("line", [ref(a), ref(b)], lineStyle(obj));
        break;
      }
      case "segment": {
        if (ref(obj.from) && ref(obj.to)) board.create("segment", [ref(obj.from), ref(obj.to)], lineStyle(obj));
        break;
      }
      case "circle": {
        if (ref(obj.center)) {
          const attrs = { ...lineStyle(obj), fillColor: "none" };
          if (obj.radius !== undefined) {
            board.create("circle", [ref(obj.center), obj.radius], attrs);
          } else if (obj.through && ref(obj.through)) {
            board.create("circle", [ref(obj.center), ref(obj.through)], attrs);
          }
        }
        break;
      }
      case "polygon": {
        const verts = obj.vertices.map(ref).filter(Boolean) as GeometryElement[];
        if (verts.length >= 3) board.create("polygon", verts, { ...lineStyle(obj), fillColor: accent, fillOpacity: 0.12 });
        break;
      }
      case "angle": {
        if (ref(obj.from) && ref(obj.at) && ref(obj.to)) {
          board.create("angle", [ref(obj.from), ref(obj.at), ref(obj.to)], {
            strokeColor: accent,
            strokeWidth: 1.6,
            fillColor: accent,
            fillOpacity: 0.18,
            radius: ANGLE_ARC_RADIUS,
            showAngle: obj.showMeasure !== false,
            label: { fontSize: 12, color: chalk, opacity: 0.85 } as LabelAttrs,
          });
        }
        break;
      }
      case "label": {
        if (ref(obj.anchor)) {
          board.create("text", [0, 0, obj.text], {
            anchor: ref(obj.anchor),
            fontSize: 13,
            color: chalk,
            opacity: 0.85,
            cssStyle: "font-family: monospace",
          } as LabelAttrs);
        }
        break;
      }
      case "text": {
        created[obj.id] = board.create("text", [obj.at[0], obj.at[1], obj.text], {
          fontSize: 13,
          color: chalk,
          opacity: 0.7,
          cssStyle: "font-family: monospace",
        }) as GeometryElement;
        break;
      }
      default: {
        const _exhaustive: never = obj;
        void _exhaustive;
      }
    }
  }

  // Apply teaching actions as construction-line hints where meaningful.
  if (intent.actions) {
    for (const action of intent.actions) {
      if (action === "show_measure" || action === "highlight_radius") {
        for (const obj of intent.objects) {
          const c = obj as CircleObject;
          if (c.kind === "circle" && c.center && c.through && ref(c.center) && ref(c.through)) {
            board.create("segment", [ref(c.center), ref(c.through)], {
              strokeColor: accent,
              strokeWidth: 1.5,
              dash: 2,
              opacity: 0.8,
              highlight: false,
            });
          }
        }
      }
    }
  }
}

/** Build JSXGraph functiongraph curves for a function intent. */
function renderFunction(board: Board, intent: FunctionIntent, chalk: string, accent: string) {
  const [x0, x1] = intent.domainX;
  intent.expressions.forEach((expr, i) => {
    const color = expr.color ?? (i === 0 ? accent : SERIES_PALETTE[(i - 1) % SERIES_PALETTE.length]);
    try {
      const fn = compileExpression(expr.expression);
      board.create("functiongraph", [(x: number) => fn(x), x0, x1], {
        strokeColor: color,
        strokeWidth: 2.2,
        highlight: false,
        opacity: 0.95,
        dash: 0,
      });
      if (expr.label) {
        const xLabel = x0 + (x1 - x0) * 0.82;
        const yLabel = fn(xLabel);
        if (isFinite(yLabel)) {
          board.create("text", [xLabel, yLabel, expr.label], {
            fontSize: 12,
            color: chalk,
            opacity: 0.85,
            cssStyle: "font-family: monospace",
            anchorX: "left",
          } as LabelAttrs);
        }
      }
    } catch {
      /* malformed expression — skip this curve; the rest still render */
    }
  });
}

/**
 * Compile a learner-facing math expression (e.g. "x^2 - 2*x + 1", "sin(x)",
 * "2x^2 - 1") into a numeric function with NO dynamic code generation — no
 * `eval`, no `Function` constructor. We tokenize, parse into an AST, and
 * evaluate the AST directly. This is the `eval`-free path the Studyus
 * architecture requires; the intent was already structurally validated upstream
 * (string length, finite bounds), so the only inputs here are math strings.
 *
 * Exported for unit testing of the pure parse/eval path (no JSXGraph needed).
 *
 * Grammar (recursive descent):
 *   expr   := term (('+'|'-') term)*
 *   term   := factor (('*'|'/'|implicit) factor)*
 *   factor := unary ('^' factor)?          // right-assoc
 *   unary  := ('+'|'-')? primary
 *   primary:= number | 'x' | const | func '(' expr ')' | '(' expr ')'
 * Implicit multiplication is allowed: "2x", "3sin(x)", "(x+1)(x-1)".
 */
export function compileExpression(expr: string): (x: number) => number {
  let ast: Ast | null = null;
  try {
    ast = parseExpression(expr);
  } catch {
    // Malformed expression: return a curve that never renders (all-NaN) rather
    // than throwing — the renderer skips NaN points, so one bad expression
    // never takes down the whole function board.
    return () => NaN;
  }
  const fns: Record<string, (u: number) => number> = {
    sin: Math.sin, cos: Math.cos, tan: Math.tan,
    sqrt: (u) => (u < 0 ? NaN : Math.sqrt(u)),
    abs: Math.abs, log: (u) => (u <= 0 ? NaN : Math.log(u)),
    exp: Math.exp,
  };
  return (x: number) => {
    try {
      const y = evalAst(ast, x, fns);
      return typeof y === "number" && isFinite(y) ? y : NaN;
    } catch {
      return NaN;
    }
  };
}

type Ast =
  | { t: "num"; v: number }
  | { t: "var" }
  | { t: "const"; v: number }
  | { t: "neg"; x: Ast }
  | { t: "bin"; op: "+" | "-" | "*" | "/" | "^"; l: Ast; r: Ast }
  | { t: "call"; name: string; arg: Ast };

const FN_NAMES = new Set(["sin", "cos", "tan", "sqrt", "abs", "log", "exp"]);

function evalAst(ast: Ast, x: number, fns: Record<string, (u: number) => number>): number {
  switch (ast.t) {
    case "num": return ast.v;
    case "var": return x;
    case "const": return ast.v;
    case "neg": return -evalAst(ast.x, x, fns);
    case "call": {
      const fn = fns[ast.name];
      if (!fn) throw new Error("unknown fn");
      return fn(evalAst(ast.arg, x, fns));
    }
    case "bin": {
      const l = evalAst(ast.l, x, fns);
      if (ast.op === "^") {
        const r = evalAst(ast.r, x, fns);
        return Math.pow(l, r);
      }
      const r = evalAst(ast.r, x, fns);
      switch (ast.op) {
        case "+": return l + r;
        case "-": return l - r;
        case "*": return l * r;
        case "/": return r === 0 ? NaN : l / r;
      }
    }
  }
}

/* ── Tokenizer ── */
type Tok =
  | { k: "num"; v: number }
  | { k: "x" }
  | { k: "id"; v: string }
  | { k: "op"; v: string }
  | { k: "lp" }
  | { k: "rp" }
  | { k: "end" };

function tokenize(src: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === " " || c === "\t") { i++; continue; }
    if (c >= "0" && c <= "9" || (c === "." && src[i + 1] >= "0" && src[i + 1] <= "9")) {
      let j = i + 1;
      while (j < src.length && ((src[j] >= "0" && src[j] <= "9") || src[j] === ".")) j++;
      // scientific notation: e[+|-]digits
      if (src[j] === "e" || src[j] === "E") {
        let k = j + 1;
        if (src[k] === "+" || src[k] === "-") k++;
        if (src[k] >= "0" && src[k] <= "9") {
          while (k < src.length && src[k] >= "0" && src[k] <= "9") k++;
          j = k;
        }
      }
      toks.push({ k: "num", v: parseFloat(src.slice(i, j)) });
      i = j;
      continue;
    }
    if (c === "x" || c === "X") { toks.push({ k: "x" }); i++; continue; }
    if (c >= "a" && c <= "z" || c >= "A" && c <= "Z") {
      let j = i + 1;
      while (j < src.length && ((src[j] >= "a" && src[j] <= "z") || (src[j] >= "A" && src[j] <= "Z") || src[j] === "_")) j++;
      toks.push({ k: "id", v: src.slice(i, j).toLowerCase() });
      i = j;
      continue;
    }
    if ("+-*/^".includes(c)) { toks.push({ k: "op", v: c }); i++; continue; }
    if (c === "(") { toks.push({ k: "lp" }); i++; continue; }
    if (c === ")") { toks.push({ k: "rp" }); i++; continue; }
    // anything else (commas, etc.) — unsupported, bail later
    throw new Error("unsupported char: " + c);
  }
  toks.push({ k: "end" });
  return toks;
}

/* ── Recursive-descent parser ── */
function parseExpression(src: string): Ast {
  const toks = tokenize(src.replace(/\s+/g, ""));
  let pos = 0;
  const peek = () => toks[pos];
  const next = () => toks[pos++];

  function parseExpr(): Ast {
    let node = parseTerm();
    while (true) {
      const t = peek();
      if (t.k === "op" && (t.v === "+" || t.v === "-")) { next(); node = { t: "bin", op: t.v, l: node, r: parseTerm() }; }
      else break;
    }
    return node;
  }
  function parseTerm(): Ast {
    let node = parseFactorOrUnary();
    while (true) {
      const t = peek();
      if (t.k === "op" && (t.v === "*" || t.v === "/")) { next(); node = { t: "bin", op: t.v, l: node, r: parseFactorOrUnary() }; }
      else if (t.k === "x" || t.k === "num" || t.k === "id" || t.k === "lp") {
        // implicit multiplication: "2x", "3sin(x)", "(a)(b)"
        node = { t: "bin", op: "*", l: node, r: parseImplicit() };
      }
      else break;
    }
    return node;
  }
  function parseImplicit(): Ast {
    // RHS of an implicit multiply: parse a single factor (with power+unary),
    // not a full term, so "2x^2" parses as 2*(x^2) and chains stop naturally.
    return parseFactorOrUnary();
  }
  function parseFactorOrUnary(): Ast {
    const t = peek();
    if (t.k === "op" && (t.v === "+" || t.v === "-")) {
      next();
      return { t: "neg" as const, x: parseFactorOrUnary() };
    }
    return parsePower();
  }
  function isOp(tok: Tok, v: string): boolean {
    return tok.k === "op" && tok.v === v;
  }
  function parsePower(): Ast {
    const base = parsePrimary();
    if (isOp(peek(), "^")) {
      next();
      // exponent: right-associative, may be unary (e.g. x^-2)
      const exp = parseFactorOrUnary();
      return { t: "bin" as const, op: "^" as const, l: base, r: exp };
    }
    return base;
  }
  function parsePrimary(): Ast {
    const t = next();
    if (t.k === "num") return { t: "num" as const, v: t.v };
    if (t.k === "x") return { t: "var" as const };
    if (t.k === "id") {
      // constants
      if (t.v === "pi") return { t: "const" as const, v: Math.PI };
      if (t.v === "e") return { t: "const" as const, v: Math.E };
      // functions
      if (FN_NAMES.has(t.v)) {
        if (peek().k !== "lp") throw new Error("expected ( after " + t.v);
        next(); // consume (
        const arg = parseExpr();
        if (peek().k !== "rp") throw new Error("expected )");
        next();
        return { t: "call" as const, name: t.v, arg };
      }
      throw new Error("unknown id: " + t.v);
    }
    if (t.k === "lp") {
      const inner = parseExpr();
      if (peek().k !== "rp") throw new Error("expected )");
      next();
      return inner;
    }
    throw new Error("unexpected token");
  }

  const result = parseExpr();
  if (peek().k !== "end") throw new Error("trailing tokens");
  return result;
}

/* ── Host sizing ──
   JSXGraph sizes its SVG to the host box. Geometry boards run with
   `keepaspectratio: true`, so if the host's aspect ratio does not match the
   bbox's the board letterboxes (and with a fixed-width + overflow-hidden host,
   wide bboxes get clipped). We drive the geometry host's height from the
   measured width × (bboxH / bboxW) so the figure always fills its box and is
   never cropped. Function boards run keepaspectratio:false and stretched to
   any box, so they keep the scale-derived height. */

function BoardHost({
  hostRef,
  isGeometry,
  intent,
  seedPositions,
  heightPx,
  title,
}: {
  hostRef: React.RefObject<HTMLDivElement | null>;
  isGeometry: boolean;
  intent: VisualizationIntent;
  seedPositions: Record<string, [number, number]>;
  heightPx: number;
  title?: string;
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [widthPx, setWidthPx] = useState(0);
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const ro = new ResizeObserver(() => setWidthPx(wrap.clientWidth));
    ro.observe(wrap);
    setWidthPx(wrap.clientWidth);
    return () => ro.disconnect();
  }, []);

  const bbox = useMemo(
    () => computeBoundingBox(intent, { pointPositions: seedPositions }),
    [intent, seedPositions]
  );
  const [xMin, yMax, xMax, yMin] = bbox;
  const bboxW = Math.max(1e-6, xMax - xMin);
  const bboxH = Math.max(1e-6, yMax - yMin);
  const aspect = bboxH / bboxW;

  // Keep diagrams compact while preserving enough height for labels and angle
  // arcs. The board's actual bounding box is still aspect-fitted on every
  // resize, so a clamp can add whitespace but cannot crop the figure.
  const rawGeoHeight = widthPx > 0 ? Math.round(widthPx * aspect) : heightPx;
  const geoHeight = Math.max(150, Math.min(420, rawGeoHeight));
  const hostHeight = isGeometry ? geoHeight : heightPx;
  const hostWidth = "100%";

  return (
    <figure className="m-0 w-full" style={{ width: "100%", maxWidth: "100%" }}>
      <div ref={wrapRef} className="w-full">
        <div
          ref={hostRef}
          className="jsxcell rounded"
          style={{ width: hostWidth, height: hostHeight }}
        />
      </div>
      {title && <figcaption className="mt-1 text-[13px] opacity-70">{title}</figcaption>}
    </figure>
  );
}

/**
 * Expand a figure box symmetrically until its aspect ratio exactly matches the
 * container's, so a `keepaspectratio` fit becomes an identity — the entire
 * figure is always visible, centred, with square units and no cropping.
 *
 * JSXGraph's own `keepaspectratio` reconciliation picks a "dominating interval"
 * based on both the container and the box; when the two disagree it can scale
 * the figure so parts fall outside the viewport. Matching the aspect ourselves
 * removes that decision entirely. We only ever GROW the box, never shrink it,
 * so nothing that was inside can be pushed out.
 *
 * Exported for unit testing (pure math, no JSXGraph needed).
 */
export function fitBoxToAspect(
  box: [number, number, number, number],
  containerW: number,
  containerH: number
): [number, number, number, number] {
  const [xMin, yMax, xMax, yMin] = box;
  if (!(containerW > 0) || !(containerH > 0)) return box;

  const w = xMax - xMin;
  const h = yMax - yMin;
  if (!(w > 0) || !(h > 0)) return box;

  const containerAspect = containerH / containerW; // user-units per unit width
  const boxAspect = h / w;

  const cx = (xMin + xMax) / 2;
  const cy = (yMin + yMax) / 2;

  if (boxAspect > containerAspect) {
    // Figure is taller than the container's shape → widen the box.
    const newW = h / containerAspect;
    return [cx - newW / 2, yMax, cx + newW / 2, yMin];
  }
  // Figure is wider than the container's shape → heighten the box.
  const newH = w * containerAspect;
  return [xMin, cy + newH / 2, xMax, cy - newH / 2];
}

/* Compute a JSXGraph bounding box from the intent (geometry viewport or function domain).
   Exported for unit testing of the pure geometry-extent math (no JSXGraph needed). */
export function computeBoundingBox(intent: VisualizationIntent, state?: VisualizationState): [number, number, number, number] {
  if (intent.type === "geometry") {
    const extent = geometryExtent(intent, state);

    // An author-supplied viewport is a FRAMING HINT, not a crop. Taking it
    // verbatim is how a figure loses parts: the model has no idea how big its
    // own decorations are, so a viewport it believes is generous (say
    // x∈[-2,3] around a circle of radius 3) silently cuts the rim off. We
    // union it with the figure's measured extent, so the hint can only ever
    // widen the view — never hide geometry.
    if (intent.viewport) {
      const vp = intent.viewport;
      let xMin = Math.min(vp.xMin, vp.xMax);
      let xMax = Math.max(vp.xMin, vp.xMax);
      let yMin = Math.min(vp.yMin, vp.yMax);
      let yMax = Math.max(vp.yMin, vp.yMax);
      if (extent) {
        const safe = padExtent(extent);
        xMin = Math.min(xMin, safe.xMin);
        xMax = Math.max(xMax, safe.xMax);
        yMin = Math.min(yMin, safe.yMin);
        yMax = Math.max(yMax, safe.yMax);
      }
      if (xMin === xMax) { xMin -= 1; xMax += 1; }
      if (yMin === yMax) { yMin -= 1; yMax += 1; }
      return [xMin, yMax, xMax, yMin];
    }

    if (!extent) return [-5, 5, 5, -5];
    const { xMin, xMax, yMin, yMax } = padExtent(extent);
    return [xMin, yMax, xMax, yMin];
  }
  if (intent.type === "function") {
    const [x0, x1] = intent.domainX;
    let yMin: number, yMax: number;
    if (intent.rangeY) { [yMin, yMax] = intent.rangeY; } else { yMin = -5; yMax = 5; }
    if (yMin >= yMax) { yMin = -5; yMax = 5; }
    // Keep curve strokes and labels inside the visible graph while preserving
    // the requested domain/range as the central plotting region.
    const pad = Math.max(0.15, (x1 - x0) * 0.08, (yMax - yMin) * 0.08);
    return [x0 - pad, yMax + pad, x1 + pad, yMin - pad];
  }
  return [-5, 5, 5, -5];
}

interface Extent { xMin: number; xMax: number; yMin: number; yMax: number; }

/** Add scale-relative breathing room around a geometry footprint.
 *
 *  The margin is uniform in user units (derived from the larger span) rather
 *  than per-axis: geometry boards keep square units, so a uniform user-unit
 *  margin is a uniform pixel margin on every side. It is also purely
 *  proportional — the old `Math.max(1, …)` floor meant a 0.4-unit triangle got
 *  a ±1 margin and shrank to a speck, while a 40-unit figure got the same
 *  relative treatment. Proportional margin draws the shape smaller than its
 *  frame at every scale, which is what leaves room for labels, angle arcs and
 *  stroke width to land inside the viewport. */
function padExtent(extent: Extent): Extent {
  const spanX = extent.xMax - extent.xMin;
  const spanY = extent.yMax - extent.yMin;
  const span = Math.max(spanX, spanY);
  const pad = span > 0 ? span * 0.18 : 0.5;
  let { xMin, xMax, yMin, yMax } = extent;
  xMin -= pad; xMax += pad; yMin -= pad; yMax += pad;
  if (xMin === xMax) { xMin -= 0.5; xMax += 0.5; }
  if (yMin === yMax) { yMin -= 0.5; yMax += 0.5; }
  return { xMin, xMax, yMin, yMax };
}

/**
 * True bounding extent of a geometry figure — the union of EVERY object's
 * footprint, not just the declared points. A circle reaches `radius` in all
 * directions from its center; a `through`-defined circle's radius is the
 * distance from its center to the through-point. Segments/lines/polygons are
 * bounded by their endpoints (already points), and free text carries its own
 * coordinate. Without this the bbox was point-only, so a circle whose rim
 * extends past its center point (the common case) got cropped — exactly the
 * clipped half-circle in the reported figure.
 */
function geometryExtent(intent: GeometryIntent, state?: VisualizationState): Extent | null {
  const coordOf = (o: Extract<GeometryObject, { kind: "point" }>): [number, number] =>
    state?.pointPositions?.[o.id] ?? o.at;

  // Resolve any referenced point (by id) to its live/declared coordinate.
  const pointCoord = (id: string): [number, number] | null => {
    const p = intent.objects.find(
      (o): o is Extract<GeometryObject, { kind: "point" }> => o.kind === "point" && o.id === id
    );
    return p ? coordOf(p) : null;
  };

  let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity;
  let seen = false;
  const include = (x: number, y: number) => {
    if (!isFinite(x) || !isFinite(y)) return;
    xMin = Math.min(xMin, x); xMax = Math.max(xMax, x);
    yMin = Math.min(yMin, y); yMax = Math.max(yMax, y);
    seen = true;
  };

  for (const obj of intent.objects) {
    switch (obj.kind) {
      case "point":
        include(coordOf(obj)[0], coordOf(obj)[1]);
        break;
      case "text": {
        include(obj.at[0], obj.at[1]);
        break;
      }
      case "circle": {
        const center = pointCoord(obj.center);
        if (!center) break;
        let r: number | null = null;
        if (typeof obj.radius === "number") {
          r = Math.abs(obj.radius);
        } else if (obj.through) {
          const t = pointCoord(obj.through);
          if (t) r = Math.hypot(t[0] - center[0], t[1] - center[1]);
        }
        if (r != null && isFinite(r)) {
          // The rim reaches r in every direction — this is the box the figure
          // actually occupies, and what was missing before.
          include(center[0] - r, center[1] - r);
          include(center[0] + r, center[1] + r);
        } else {
          include(center[0], center[1]);
        }
        break;
      }
      case "angle": {
        // The angle arc is drawn at a fixed user-unit radius around its vertex
        // (see renderGeometry), so on a small figure it reaches past every
        // declared point. Include the arc's own footprint or it gets clipped.
        const vertex = pointCoord(obj.at);
        if (vertex) {
          include(vertex[0] - ANGLE_ARC_RADIUS, vertex[1] - ANGLE_ARC_RADIUS);
          include(vertex[0] + ANGLE_ARC_RADIUS, vertex[1] + ANGLE_ARC_RADIUS);
        }
        break;
      }
      // line/segment/polygon/label are bounded by the points they reference,
      // which are included in the point pass above. (A `line` is drawn
      // infinite, but it exits through the frame edge by construction — it can
      // never be "missing" the way a bounded object can.)
      default:
        break;
    }
  }

  if (!seen) return null;
  return { xMin, xMax, yMin, yMax };
}

/* ───────────────────────── KaTeX (equation) ───────────────────────── */

function EquationSurface({
  intent,
  chalk,
  accent,
  scale,
  caption,
}: {
  intent: Extract<VisualizationIntent, { type: "equation" }>;
  chalk: string;
  accent: string;
  scale: number;
  caption?: string;
}) {
  const html = useMemo(() => renderMath(intent.latex, true, {}).html, [intent.latex]);
  return (
    <figure className="m-0 max-w-[420px]">
      <div
        className="katex-chalk rounded-lg border px-4 py-3"
        style={{ borderColor: `${accent}55`, fontSize: 26 * Math.max(0.7, Math.min(scale, 1.3)), color: chalk }}
        dangerouslySetInnerHTML={{ __html: html }}
      />
      {caption && <figcaption className="mt-1 text-[13px] opacity-70">{caption}</figcaption>}
    </figure>
  );
}

/* ───────────────────────── Honest unsupported card ───────────────────────── */

function UnsupportedCard({ reason, chalk, accent, caption }: { reason: string; chalk: string; accent: string; caption?: string }) {
  return (
    <figure className="m-0 max-w-[420px]">
      <div className="rounded-lg border-2 border-dashed px-4 py-3" style={{ borderColor: `${accent}66`, color: chalk }}>
        <div className="flex items-center gap-2 text-[13px] opacity-80">
          <span aria-hidden>∿</span>
          <span>{reason}</span>
        </div>
      </div>
      {caption && <figcaption className="mt-1 text-[13px] opacity-70">{caption}</figcaption>}
    </figure>
  );
}
