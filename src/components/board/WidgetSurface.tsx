/**
 * Chalkboard study-widget renderer.
 *
 * The rendering counterpart to `lib/widgets/types.ts`. Every widget here is
 * fully driven by its agent-authored intent — there is no preset content, no
 * hardcoded lesson text, and no widget that renders something the agent did not
 * configure. Interactive widgets report learner interaction back through
 * `onState`, which the board persists onto the owning block so it round-trips
 * through a saved session and reaches the agent's next turn.
 *
 * Visual language is the chalkboard glass panel from the widget board spec:
 * a bordered translucent shell, a header with a hand-drawn chalk mark, and a
 * body that adopts the board's chalk color and font.
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { renderMath } from "../../lib/latex/render";
import { gradeAnswerableWidget } from "../../lib/widgets/validate";
import { WIDGET_LABEL, type WidgetIntent, type WidgetState, type WidgetKind } from "../../lib/widgets/types";
import { assessMastery, MASTERY_DIMENSION_LABEL, MASTERY_THRESHOLD } from "../../lib/mastery";
import { MASTERY_EVIDENCE_DIMENSIONS } from "../../lib/widgets/types";

export interface WidgetSurfaceProps {
  intent: WidgetIntent;
  state?: WidgetState;
  chalk: string;
  accent: string;
  scale?: number;
  /** Past Notes and thread previews render widgets without interaction. */
  readOnly?: boolean;
  onState?: (next: WidgetState) => void;
}

/* ── Hand-drawn chalk marks (no generic UI-kit icons) ── */

const MARKS: Record<WidgetKind, string> = {
  roadmap: "M4 18c0-3 4-3 4-6s-4-3-4-6M20 6c0 3-4 3-4 6s4 3 4 6",
  concept_card: "M6 4h9l4 4v12H6zM14 4v5h5M9 13h6M9 16h4",
  slider: "M3 12h18",
  animation: "M4 16c4-9 12-9 16 0",
  comparison: "M12 4v16M6 8H4M8 8H6M6 12H4M8 12H6M18 9l3 3-3 3",
  question: "M9 9a3 3 0 1 1 4 2.8c-.9.5-1 1-1 2.2M12 17.6v.8",
  hint: "M12 3a6 6 0 0 0-3 11v2h6v-2a6 6 0 0 0-3-11zM10 20h4",
  scratchpad: "M4 20l2-5 10-10 3 3-10 10zM14 6l3 3",
  annotation: "M14 14l6 6",
  reveal: "M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6",
  example: "M5 4h10l4 4v12H5zM8 12l2 2 4-4",
  mistake_check: "M9 9l6 6M15 9l-6 6",
  memory_hook: "M12 3c-3 0-5 2-5 5 0 2 1 3 1 5v2a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2v-2c0-2 1-3 1-5 0-3-2-5-5-5zM10 19h4",
  retrieval_check: "M20 12a8 8 0 1 1-3-6.2M20 4v4h-4",
  challenge: "M6 4h12v3a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4zM9 15h6M8 20h8M12 11v4",
  reflection: "M4 5h16v9H8l-4 4z M8 9h8M8 12h5",
  mastery_card: "M12 3l2.4 5 5.4.6-4 3.7 1.1 5.3L12 20l-4.9 2.6L8.2 12l-4-3.7 5.4-.6z",
};

const EXTRA_MARK_SHAPES: Partial<Record<WidgetKind, React.ReactElement>> = {
  slider: <circle cx="15" cy="12" r="3" />,
  animation: <circle cx="8" cy="12.6" r="1.5" />,
  annotation: <circle cx="10" cy="10" r="5" />,
  mistake_check: <circle cx="12" cy="12" r="8" />,
};

const DEFAULT_TAGS: Record<WidgetKind, string> = {
  roadmap: "Path",
  concept_card: "Idea",
  slider: "Manipulate",
  animation: "Over time",
  comparison: "Side by side",
  question: "Check",
  hint: "Progressive",
  scratchpad: "Your work",
  annotation: "Agent points",
  reveal: "Hide / show",
  example: "Worked",
  mistake_check: "Find the error",
  memory_hook: "Remember",
  retrieval_check: "From earlier",
  challenge: "On your own",
  reflection: "In your words",
  mastery_card: "Evidence",
};

/* ── Small shared primitives ── */

function Tex({ tex, color, size = 15 }: { tex: string; color: string; size?: number }) {
  const html = useMemo(() => renderMath(tex, false, {}).html, [tex]);
  return <span className="katex-chalk" style={{ color, fontSize: size }} dangerouslySetInnerHTML={{ __html: html }} />;
}

function TexBlock({ tex, color, size = 18 }: { tex: string; color: string; size?: number }) {
  const html = useMemo(() => renderMath(tex, true, {}).html, [tex]);
  return <div className="katex-chalk" style={{ color, fontSize: size }} dangerouslySetInnerHTML={{ __html: html }} />;
}

function Muted({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`font-mono text-[9.5px] uppercase tracking-[0.08em] opacity-55 ${className}`}>{children}</div>;
}

/* ── Widget shell ── */

function WidgetShell({
  intent,
  chalk,
  accent,
  scale,
  children,
}: {
  intent: WidgetIntent;
  chalk: string;
  accent: string;
  scale: number;
  children: React.ReactNode;
}) {
  const title = intent.title?.trim() || WIDGET_LABEL[intent.kind];
  const tag = intent.tag?.trim() || DEFAULT_TAGS[intent.kind];
  const fontSize = 13 * Math.max(0.75, Math.min(scale, 1.35));

  return (
    <figure
      className="m-0 w-full max-w-[460px] overflow-hidden rounded-lg border shadow-[0_12px_32px_rgba(0,0,0,0.25)] backdrop-blur-md"
      data-nopan
      data-widget={intent.kind}
      style={{ borderColor: `${accent}33`, background: "rgba(52,52,54,0.34)", color: chalk, fontSize }}
    >
      <header
        className="flex items-center gap-2 border-b px-3 py-2"
        style={{ borderColor: `${accent}22` }}
      >
        <span className="grid h-[18px] w-[18px] flex-none place-items-center" style={{ color: accent }} aria-hidden>
          <svg viewBox="0 0 24 24" width={17} height={17} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
            {EXTRA_MARK_SHAPES[intent.kind]}
            <path d={MARKS[intent.kind]} />
          </svg>
        </span>
        <span className="flex-1 truncate text-[11.5px] font-semibold tracking-[0.01em] opacity-90">{title}</span>
        <span className="rounded-full px-2 py-[3px] font-mono text-[8px] uppercase tracking-[0.06em] opacity-55" style={{ background: "rgba(255,255,255,0.07)" }}>
          {tag}
        </span>
      </header>
      <div className="px-3 py-3">{children}</div>
      {intent.note ? (
        <div className="border-t px-3 py-1.5 text-[9.5px] italic opacity-50" style={{ borderColor: `${accent}18` }}>
          {intent.note}
        </div>
      ) : null}
    </figure>
  );
}

/* ── Entry point ── */

export const WidgetSurface = memo(function WidgetSurface({
  intent,
  state,
  chalk,
  accent,
  scale = 1,
  readOnly = false,
  onState,
}: WidgetSurfaceProps) {
  const emit = useCallback(
    (patch: WidgetState) => {
      if (readOnly || !onState) return;
      onState({ ...(state ?? {}), ...patch, interactedAt: new Date().toISOString() });
    },
    [onState, readOnly, state]
  );

  const shared = { chalk, accent, state: state ?? {}, emit, readOnly };

  return (
    <WidgetShell intent={intent} chalk={chalk} accent={accent} scale={scale}>
      {renderBody(intent, shared)}
    </WidgetShell>
  );
});

interface BodyProps {
  chalk: string;
  accent: string;
  state: WidgetState;
  emit: (patch: WidgetState) => void;
  readOnly: boolean;
}

function renderBody(intent: WidgetIntent, props: BodyProps) {
  switch (intent.kind) {
    case "roadmap": return <RoadmapBody intent={intent} {...props} />;
    case "concept_card": return <ConceptCardBody intent={intent} {...props} />;
    case "slider": return <SliderBody intent={intent} {...props} />;
    case "animation": return <AnimationBody intent={intent} {...props} />;
    case "comparison": return <ComparisonBody intent={intent} {...props} />;
    case "question": return <AnswerableBody intent={intent} {...props} />;
    case "retrieval_check": return <AnswerableBody intent={intent} {...props} />;
    case "hint": return <HintBody intent={intent} {...props} />;
    case "scratchpad": return <ScratchpadBody intent={intent} {...props} />;
    case "annotation": return <AnnotationBody intent={intent} {...props} />;
    case "reveal": return <RevealBody intent={intent} {...props} />;
    case "example": return <ExampleBody intent={intent} {...props} />;
    case "mistake_check": return <MistakeCheckBody intent={intent} {...props} />;
    case "memory_hook": return <MemoryHookBody intent={intent} {...props} />;
    case "challenge": return <ChallengeBody intent={intent} {...props} />;
    case "reflection": return <ReflectionBody intent={intent} {...props} />;
    case "mastery_card": return <MasteryCardBody intent={intent} {...props} />;
  }
}

/* ── 1 · Roadmap ── */

function RoadmapBody({ intent, chalk, accent }: BodyProps & { intent: Extract<WidgetIntent, { kind: "roadmap" }> }) {
  return (
    <div>
      {intent.heading ? <div className="mb-2 text-[12.5px] font-semibold opacity-90">{intent.heading}</div> : null}
      <Muted className="mb-2">Where this lesson goes</Muted>
      <ol className="m-0 list-none p-0">
        {intent.steps.map((step, index) => {
          const state = step.state ?? "upcoming";
          const done = state === "done";
          const current = state === "current";
          return (
            <li key={step.id} className="grid grid-cols-[16px_1fr] items-start gap-2.5 py-[5px]">
              <span className="relative grid h-[15px] place-items-center">
                <i
                  className="block h-[7px] w-[7px] rounded-full border-[1.4px]"
                  style={{
                    borderColor: done || current ? accent : `${chalk}55`,
                    background: done ? accent : "transparent",
                    boxShadow: done ? `0 0 8px ${accent}99` : undefined,
                  }}
                />
                {index < intent.steps.length - 1 ? (
                  <span className="absolute top-[15px] h-3 w-[1.4px]" style={{ background: `${chalk}2e` }} />
                ) : null}
              </span>
              <span>
                <span className="text-[11px]" style={{ opacity: current ? 0.98 : done ? 0.7 : 0.6, fontWeight: current ? 600 : 400 }}>
                  {step.label}
                </span>
                {step.detail ? <span className="block text-[9.5px] opacity-45">{step.detail}</span> : null}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/* ── 2 · Concept Card ── */

function ConceptCardBody({ intent, chalk, accent }: BodyProps & { intent: Extract<WidgetIntent, { kind: "concept_card" }> }) {
  return (
    <div>
      <div className="text-[20px] leading-tight" style={{ textShadow: "0 0 1px currentColor" }}>{intent.term}</div>
      {(intent.pronunciation || intent.classification) ? (
        <div className="mt-0.5 font-mono text-[9px] opacity-45">
          {[intent.pronunciation, intent.classification].filter(Boolean).join(" · ")}
        </div>
      ) : null}
      <p className="m-0 mt-2 text-[11px] leading-relaxed opacity-80">{intent.definition}</p>
      {intent.definitionLatex ? (
        <div className="mt-2 rounded border px-2.5 py-2" style={{ borderColor: `${accent}33` }}>
          <TexBlock tex={intent.definitionLatex} color={chalk} size={17} />
        </div>
      ) : null}
      {intent.facets?.length ? (
        <ul className="m-0 mt-2 list-none space-y-1 p-0">
          {intent.facets.map((facet, index) => (
            <li key={index} className="flex gap-2 text-[10.5px] opacity-75">
              <span style={{ color: accent }}>›</span>
              <span>{facet}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/* ── 6 · Slider ── */

/** Bounded evaluator for readout expressions. Supports the arithmetic and the
 *  scalar functions a teaching readout needs, and nothing else — no property
 *  access, no globals, no assignment. Returns null when unevaluatable. */
function evaluateReadout(expression: string, scope: Record<string, number>): number | null {
  const allowed: Record<string, unknown> = {
    abs: Math.abs, acos: Math.acos, asin: Math.asin, atan: Math.atan,
    cbrt: Math.cbrt, ceil: Math.ceil, cos: Math.cos, cosh: Math.cosh,
    exp: Math.exp, floor: Math.floor, hypot: Math.hypot, log: Math.log,
    log2: Math.log2, log10: Math.log10, max: Math.max, min: Math.min,
    pow: Math.pow, round: Math.round, sign: Math.sign, sin: Math.sin,
    sinh: Math.sinh, sqrt: Math.sqrt, tan: Math.tan, tanh: Math.tanh,
    pi: Math.PI, PI: Math.PI, e: Math.E, E: Math.E,
    ...scope,
  };
  // `^` reads as exponentiation in every teaching context; JS would read it as
  // bitwise xor, which silently produces nonsense instead of failing.
  const normalized = expression.replace(/\^/g, "**");
  try {
    const names = Object.keys(allowed);
    // eslint-disable-next-line no-new-func
    const fn = new Function(...names, `"use strict"; return (${normalized});`);
    const result = fn(...names.map((name) => allowed[name]));
    return typeof result === "number" && Number.isFinite(result) ? result : null;
  } catch {
    return null;
  }
}

function SliderBody({ intent, accent, state, emit, readOnly }: BodyProps & { intent: Extract<WidgetIntent, { kind: "slider" }> }) {
  const value = typeof state.sliderValue === "number"
    ? Math.min(intent.max, Math.max(intent.min, state.sliderValue))
    : intent.value;
  const step = intent.step ?? (intent.max - intent.min) / 100;
  const fraction = (value - intent.min) / (intent.max - intent.min);
  const decimals = step < 0.1 ? 3 : step < 1 ? 2 : Number.isInteger(step) ? 0 : 1;

  return (
    <div>
      <Muted className="mb-2">{intent.label}</Muted>
      <div className="mb-2 flex items-baseline justify-between">
        <span className="text-[9.5px] opacity-45">range</span>
        <b className="text-[20px] font-normal" style={{ color: "#fde68a", textShadow: "0 0 1px currentColor" }}>
          {value.toFixed(decimals)}{intent.unit ?? ""}
        </b>
      </div>
      <input
        type="range"
        min={intent.min}
        max={intent.max}
        step={step}
        value={value}
        disabled={readOnly}
        aria-label={intent.label}
        onChange={(event) => emit({ sliderValue: Number(event.target.value) })}
        className="block h-1 w-full cursor-pointer appearance-none rounded-full outline-none disabled:cursor-default [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:shadow-[0_2px_6px_rgba(0,0,0,0.4)] [&::-moz-range-thumb]:h-3.5 [&::-moz-range-thumb]:w-3.5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-white"
        style={{ background: `linear-gradient(90deg, ${accent} ${fraction * 100}%, rgba(255,255,255,0.12) ${fraction * 100}%)` }}
      />
      {intent.ticks?.length ? (
        <div className="mt-1.5 flex justify-between font-mono text-[8.5px] opacity-45">
          {intent.ticks.map((tick, index) => <span key={index}>{tick.label}</span>)}
        </div>
      ) : null}

      {intent.readouts?.length ? (
        <div className="mt-2.5 space-y-1">
          {intent.readouts.map((readout) => {
            const computed = evaluateReadout(readout.expression, { [intent.parameter]: value });
            return (
              <div key={readout.id} className="flex items-baseline justify-between rounded px-2 py-1" style={{ background: "rgba(255,255,255,0.04)" }}>
                <span className="text-[10px] opacity-65">{readout.label}</span>
                <span className="font-mono text-[11px]" style={{ color: accent }}>
                  {computed === null ? "—" : computed.toFixed(readout.precision ?? 2)}{readout.unit ?? ""}
                </span>
              </div>
            );
          })}
        </div>
      ) : null}

      {intent.observe ? <p className="m-0 mt-2 text-[10px] italic opacity-60">{intent.observe}</p> : null}
    </div>
  );
}

/* ── 7 · Animation ── */

function AnimationBody({ intent, chalk, accent, state, emit, readOnly }: BodyProps & { intent: Extract<WidgetIntent, { kind: "animation" }> }) {
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(state.animationProgress ?? 0);
  const duration = intent.durationMs ?? Math.max(1600, intent.frames.length * 1200);
  const rafRef = useRef<number | null>(null);
  const startRef = useRef(0);

  useEffect(() => {
    if (!playing) return;
    startRef.current = performance.now() - progress * duration;
    const tick = (now: number) => {
      const next = (now - startRef.current) / duration;
      if (next >= 1) {
        if (intent.loop) {
          startRef.current = now;
          setProgress(0);
          rafRef.current = requestAnimationFrame(tick);
        } else {
          setProgress(1);
          setPlaying(false);
          emit({ animationProgress: 1 });
        }
        return;
      }
      setProgress(next);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
    // `progress` is intentionally excluded: it is the animation's own output.
  }, [playing, duration, intent.loop]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
  }, []);

  const frameIndex = Math.min(intent.frames.length - 1, Math.floor(progress * intent.frames.length));
  const frame = intent.frames[frameIndex];

  const path = useMemo(() => {
    const motion = intent.motion;
    if (!motion) return null;
    const [t0, t1] = motion.tDomain;
    const samples = 96;
    const pts: [number, number][] = [];
    for (let i = 0; i <= samples; i += 1) {
      const t = t0 + ((t1 - t0) * i) / samples;
      const x = evaluateReadout(motion.xExpression, { t });
      const y = evaluateReadout(motion.yExpression, { t });
      if (x === null || y === null) continue;
      pts.push([x, y]);
    }
    if (pts.length < 2) return null;
    const xs = pts.map(([x]) => x);
    const ys = pts.map(([, y]) => y);
    const xMin = Math.min(...xs), xMax = Math.max(...xs);
    const yMin = Math.min(...ys), yMax = Math.max(...ys);
    const spanX = Math.max(1e-6, xMax - xMin);
    const spanY = Math.max(1e-6, yMax - yMin);
    const project = ([x, y]: [number, number]): [number, number] => [
      6 + ((x - xMin) / spanX) * 208,
      56 - ((y - yMin) / spanY) * 46,
    ];
    return { pts: pts.map(project), raw: pts, project };
  }, [intent.motion]);

  const headIndex = path ? Math.min(path.pts.length - 1, Math.round(progress * (path.pts.length - 1))) : 0;
  const head = path?.pts[headIndex];

  return (
    <div>
      {intent.predictPrompt ? (
        <p className="m-0 mb-2 text-[10.5px] opacity-80">
          <span style={{ color: accent }}>Predict first: </span>{intent.predictPrompt}
        </p>
      ) : null}

      <div className="relative mb-2 h-[62px] overflow-hidden rounded" style={{ background: "rgba(0,0,0,0.18)" }}>
        {path ? (
          <svg viewBox="0 0 220 62" className="absolute inset-0 h-full w-full" preserveAspectRatio="none">
            <polyline
              points={path.pts.map(([x, y]) => `${x},${y}`).join(" ")}
              fill="none"
              stroke={`${chalk}44`}
              strokeWidth={1.4}
              strokeDasharray="3 5"
            />
            {intent.motion?.trace ? (
              <polyline
                points={path.pts.slice(0, headIndex + 1).map(([x, y]) => `${x},${y}`).join(" ")}
                fill="none"
                stroke={accent}
                strokeWidth={1.8}
              />
            ) : null}
            {head ? <circle cx={head[0]} cy={head[1]} r={4} fill="#ff7a33" /> : null}
          </svg>
        ) : (
          <div
            className="absolute top-1/2 h-3 w-3 -translate-y-1/2 rounded-full"
            style={{ left: `calc(${progress * 100}% - 6px)`, background: "#ff7a33", boxShadow: "0 0 12px rgba(255,122,51,0.6)" }}
          />
        )}
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={readOnly}
          aria-label={playing ? "Pause animation" : "Play animation"}
          onClick={() => {
            if (!playing && progress >= 1) setProgress(0);
            setPlaying((current) => !current);
          }}
          className="grid h-6 w-6 flex-none place-items-center rounded-full text-white transition-colors hover:bg-white/20 disabled:opacity-40"
          style={{ background: "rgba(255,255,255,0.1)" }}
        >
          <svg viewBox="0 0 24 24" width={11} height={11} fill="currentColor">
            {playing ? <path d="M7 5h3v14H7zM14 5h3v14h-3z" /> : <path d="M7 5v14l11-7z" />}
          </svg>
        </button>
        <div className="h-[3px] flex-1 overflow-hidden rounded-full" style={{ background: "rgba(255,255,255,0.1)" }}>
          <i className="block h-full" style={{ width: `${progress * 100}%`, background: accent }} />
        </div>
        <span className="font-mono text-[9px] opacity-45">{frameIndex + 1}/{intent.frames.length}</span>
      </div>

      <div className="mt-2 min-h-[32px]">
        <p className="m-0 text-[10.5px] opacity-80">{frame.caption}</p>
        {frame.latex ? <div className="mt-1"><TexBlock tex={frame.latex} color={chalk} size={16} /></div> : null}
      </div>
    </div>
  );
}

/* ── 8 · Comparison ── */

const COLUMN_ACCENTS: Record<string, string> = {
  cyan: "#7dd3fc",
  amber: "#fde68a",
  violet: "#9b96e6",
  ember: "#ff7a33",
  neutral: "inherit",
};

function ComparisonBody({ intent, chalk, accent }: BodyProps & { intent: Extract<WidgetIntent, { kind: "comparison" }> }) {
  const columnColor = (index: number, declared?: string) =>
    declared && declared !== "neutral" ? COLUMN_ACCENTS[declared] : index === 0 ? accent : "#fde68a";

  return (
    <div>
      {intent.rows?.length ? (
        <div className="overflow-hidden">
          <table className="w-full border-collapse text-[10px]">
            <thead>
              <tr>
                <th className="p-0" />
                {intent.columns.map((column, index) => (
                  <th key={column.id} className="pb-1.5 text-left text-[11px] font-normal" style={{ color: columnColor(index, column.accent) }}>
                    {column.title}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {intent.rows.map((row) => (
                <tr key={row.id} className="border-t" style={{ borderColor: `${chalk}18` }}>
                  <td className="py-1.5 pr-3 text-[9.5px] opacity-50">{row.label}</td>
                  {row.cells.map((cell, index) => (
                    <td key={index} className="py-1.5 pr-2 opacity-80">{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="grid gap-2.5" style={{ gridTemplateColumns: `repeat(${intent.columns.length}, minmax(0, 1fr))` }}>
          {intent.columns.map((column, index) => (
            <div key={column.id} className={index > 0 ? "border-l pl-2.5" : ""} style={{ borderColor: `${chalk}1a` }}>
              <h5 className="m-0 mb-1.5 text-[12px] font-normal" style={{ color: columnColor(index, column.accent) }}>
                {column.title}
              </h5>
              <ul className="m-0 list-none space-y-1 p-0">
                {(column.items ?? []).map((item, itemIndex) => (
                  <li key={itemIndex} className="text-[9.5px] leading-snug opacity-75">{item}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
      {intent.takeaway ? (
        <p className="m-0 mt-2.5 border-t pt-2 text-[10px] opacity-75" style={{ borderColor: `${chalk}18` }}>
          {intent.takeaway}
        </p>
      ) : null}
    </div>
  );
}

/* ── 9 · Question · 17 · Retrieval Check ── */

function AnswerableBody({
  intent,
  chalk,
  accent,
  state,
  emit,
  readOnly,
}: BodyProps & { intent: Extract<WidgetIntent, { kind: "question" | "retrieval_check" }> }) {
  const [draft, setDraft] = useState(state.responseText ?? "");
  const submitted = state.submitted === true;
  const isRetrieval = intent.kind === "retrieval_check";

  const submit = (patch: WidgetState) => {
    const merged = { ...state, ...patch };
    emit({ ...patch, submitted: true, correct: gradeAnswerableWidget(intent, merged) });
  };

  const chosen = intent.options?.find((option) => option.id === state.selectedOptionId);

  return (
    <div>
      {isRetrieval && "source" in intent && intent.source ? (
        <Muted className="mb-1.5">{intent.source}</Muted>
      ) : null}
      <p className="m-0 mb-1.5 text-[11px] font-medium leading-snug opacity-90">{intent.prompt}</p>
      {intent.promptLatex ? <div className="mb-2"><TexBlock tex={intent.promptLatex} color={chalk} size={17} /></div> : null}
      {isRetrieval ? <Muted className="mb-2">No notes — from memory</Muted> : null}

      {intent.format === "multiple_choice" ? (
        <div className="grid gap-1.5">
          {(intent.options ?? []).map((option, index) => {
            const picked = state.selectedOptionId === option.id;
            const showAsCorrect = submitted && option.correct === true;
            const showAsWrong = submitted && picked && option.correct !== true;
            return (
              <button
                key={option.id}
                type="button"
                disabled={readOnly || submitted}
                onClick={() => submit({ selectedOptionId: option.id })}
                className="flex w-full items-center gap-2 rounded-md border px-2.5 py-2 text-left text-[10px] transition-colors disabled:cursor-default"
                style={{
                  borderColor: showAsCorrect ? "#86efac88" : showAsWrong ? "#fca5a588" : `${chalk}1f`,
                  background: showAsCorrect ? "rgba(134,239,172,0.1)" : showAsWrong ? "rgba(252,165,165,0.1)" : "rgba(255,255,255,0.03)",
                  opacity: submitted && !picked && !showAsCorrect ? 0.45 : 0.9,
                }}
              >
                <span className="grid h-4 w-4 flex-none place-items-center rounded font-mono text-[8.5px]" style={{ background: "rgba(255,255,255,0.08)" }}>
                  {String.fromCharCode(65 + index)}
                </span>
                <span>{option.label}</span>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="flex items-start gap-2">
          <input
            value={draft}
            disabled={readOnly || submitted}
            placeholder={intent.placeholder ?? (intent.format === "numeric" ? "Your value" : "Your answer")}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && draft.trim()) submit({ responseText: draft.trim() });
            }}
            className="min-w-0 flex-1 rounded-md border bg-black/15 px-2.5 py-1.5 text-[11px] outline-none disabled:opacity-70"
            style={{ borderColor: `${chalk}1f`, color: chalk }}
          />
          <button
            type="button"
            disabled={readOnly || submitted || !draft.trim()}
            onClick={() => submit({ responseText: draft.trim() })}
            className="rounded-md px-2.5 py-1.5 text-[10px] font-medium text-black disabled:opacity-30"
            style={{ background: accent }}
          >
            Check
          </button>
        </div>
      )}

      {submitted ? (
        <div className="mt-2 space-y-1.5">
          {state.correct === true ? (
            <div className="text-[10px]" style={{ color: "#86efac" }}>Correct.</div>
          ) : state.correct === false ? (
            <div className="text-[10px]" style={{ color: "#fca5a5" }}>Not quite.</div>
          ) : (
            <div className="text-[10px] opacity-60">Answer recorded — the tutor will read it.</div>
          )}
          {/* A distractor without its diagnosis teaches nothing, so the specific
              misconception is surfaced the moment it is selected. */}
          {chosen?.misconception && state.correct === false ? (
            <p className="m-0 rounded px-2 py-1.5 text-[10px] leading-snug opacity-85" style={{ background: "rgba(252,165,165,0.08)" }}>
              {chosen.misconception}
            </p>
          ) : null}
          {intent.explanation ? <p className="m-0 text-[10px] leading-snug opacity-75">{intent.explanation}</p> : null}
          {"expectedPoints" in intent && intent.expectedPoints?.length ? (
            <ul className="m-0 list-none space-y-0.5 p-0">
              {intent.expectedPoints.map((point, index) => (
                <li key={index} className="flex gap-1.5 text-[9.5px] opacity-70">
                  <span style={{ color: accent }}>›</span><span>{point}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/* ── 10 · Hint ── */

function HintBody({ intent, chalk, accent, state, emit, readOnly }: BodyProps & { intent: Extract<WidgetIntent, { kind: "hint" }> }) {
  const opened = state.hintLevelOpened ?? 0;
  const steps = [...intent.steps].sort((a, b) => a.level - b.level);

  return (
    <div className="space-y-1">
      {steps.map((step) => {
        const isOpen = opened >= step.level;
        // Progressive disclosure: level N is only reachable once N-1 is opened.
        const locked = step.level > opened + 1;
        return (
          <div key={step.level} className="overflow-hidden rounded-md border" style={{ borderColor: `${chalk}18` }}>
            <button
              type="button"
              disabled={readOnly || locked}
              onClick={() => emit({ hintLevelOpened: isOpen ? step.level - 1 : step.level })}
              className="flex w-full items-center gap-2 px-2.5 py-2 text-left text-[10px] transition-colors disabled:cursor-default disabled:opacity-35"
              style={{ background: isOpen ? "rgba(255,255,255,0.05)" : "transparent" }}
            >
              <span className="flex-1 opacity-85">{step.label}</span>
              <span className="font-mono text-[8px] opacity-45">
                {step.level} · {step.level === 1 ? "nudge" : step.level === 2 ? "lead" : "reveal"}
              </span>
              <span style={{ color: accent, transform: isOpen ? "rotate(90deg)" : undefined, transition: "transform .2s" }}>›</span>
            </button>
            {isOpen ? (
              <p className="m-0 px-2.5 pb-2 text-[10px] leading-snug opacity-80">{step.body}</p>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

/* ── 11 · Scratchpad ── */

function ScratchpadBody({ intent, chalk, accent, state, emit, readOnly }: BodyProps & { intent: Extract<WidgetIntent, { kind: "scratchpad" }> }) {
  const [draft, setDraft] = useState(state.responseText ?? intent.starter ?? "");
  const commit = () => {
    if (draft === (state.responseText ?? "")) return;
    emit({ responseText: draft });
  };

  return (
    <div>
      {intent.prompt ? <p className="m-0 mb-2 text-[10.5px] opacity-85">{intent.prompt}</p> : null}
      <textarea
        value={draft}
        disabled={readOnly}
        rows={intent.lines ?? 4}
        placeholder={intent.placeholder ?? "Work it out here…"}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        className="block w-full resize-y rounded-md border px-2.5 py-2 outline-none disabled:opacity-70"
        style={{
          borderColor: `${chalk}1f`,
          background: "rgba(0,0,0,0.18)",
          backgroundImage: "repeating-linear-gradient(rgba(255,255,255,0.05) 0 1px, transparent 1px 21px)",
          color: chalk,
          fontFamily: intent.mode === "math" ? "inherit" : undefined,
          fontSize: 12,
          lineHeight: "21px",
        }}
      />
      {!readOnly ? (
        <div className="mt-1.5 flex justify-end">
          <button
            type="button"
            onClick={commit}
            disabled={draft === (state.responseText ?? "")}
            className="rounded px-2 py-1 text-[9.5px] font-medium text-black disabled:opacity-25"
            style={{ background: accent }}
          >
            Save work
          </button>
        </div>
      ) : null}
    </div>
  );
}

/* ── 12 · Annotation ── */

const EMPHASIS_MARK: Record<string, string> = {
  circle: "◯",
  underline: "▁",
  arrow: "↳",
  strike: "✕",
};

function AnnotationBody({ intent, accent }: BodyProps & { intent: Extract<WidgetIntent, { kind: "annotation" }> }) {
  return (
    <div>
      {intent.targetLabel ? <Muted className="mb-2">On: {intent.targetLabel}</Muted> : null}
      <div className="space-y-2">
        {intent.marks.map((mark) => (
          <div key={mark.id} className="grid grid-cols-[auto_1fr] items-start gap-2">
            <span className="mt-[1px] font-mono text-[10px]" style={{ color: accent }} aria-hidden>
              {EMPHASIS_MARK[mark.emphasis ?? "arrow"]}
            </span>
            <div>
              <div
                className="inline-block rounded px-1.5 py-0.5 text-[11px]"
                style={{
                  background: "rgba(35,131,226,0.14)",
                  border: `1px solid ${accent}4d`,
                  color: accent,
                  textDecoration: mark.emphasis === "strike" ? "line-through" : mark.emphasis === "underline" ? "underline" : undefined,
                }}
              >
                {mark.target}
              </div>
              <p className="m-0 mt-1 text-[10px] leading-snug opacity-80">{mark.note}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── 13 · Reveal ── */

function RevealBody({ intent, chalk, state, emit, readOnly }: BodyProps & { intent: Extract<WidgetIntent, { kind: "reveal" }> }) {
  const revealed = new Set(state.revealedIds ?? []);
  const toggle = (id: string) => {
    const next = new Set(revealed);
    if (next.has(id)) next.delete(id); else next.add(id);
    emit({ revealedIds: [...next] });
  };

  return (
    <div>
      {intent.prompt ? <p className="m-0 mb-2 text-[10.5px] opacity-85">{intent.prompt}</p> : null}
      <div className="space-y-1.5">
        {intent.items.map((item) => {
          const isRevealed = revealed.has(item.id);
          return (
            <div key={item.id} className="grid grid-cols-[1fr_auto] items-center gap-2.5 rounded-md px-2.5 py-2" style={{ background: "rgba(255,255,255,0.03)" }}>
              <div className="min-w-0">
                <div className="text-[9.5px] opacity-50">{item.label}</div>
                <div style={{ filter: isRevealed ? undefined : "blur(6px)", transition: "filter .2s", userSelect: isRevealed ? "text" : "none" }}>
                  {item.contentLatex
                    ? <Tex tex={item.contentLatex} color="#fde68a" size={14} />
                    : <span className="text-[11.5px]" style={{ color: "#fde68a" }}>{item.content}</span>}
                </div>
              </div>
              <button
                type="button"
                disabled={readOnly}
                onClick={() => toggle(item.id)}
                className="flex-none rounded px-2 py-1 text-[8.5px] transition-colors hover:bg-white/15 disabled:opacity-40"
                style={{ background: "rgba(255,255,255,0.08)", color: `${chalk}b3` }}
              >
                {isRevealed ? "Hide" : intent.actionLabel ?? "Reveal"}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ── 14 · Example ── */

function ExampleBody({ intent, chalk, accent }: BodyProps & { intent: Extract<WidgetIntent, { kind: "example" }> }) {
  return (
    <div>
      {intent.problem ? <p className="m-0 mb-1.5 text-[10.5px] opacity-85">{intent.problem}</p> : null}
      {intent.problemLatex ? <div className="mb-2"><TexBlock tex={intent.problemLatex} color={chalk} size={17} /></div> : null}
      <div>
        {intent.steps.map((step, index) => (
          <div
            key={step.id}
            className="grid grid-cols-[18px_1fr] gap-2.5 py-[7px]"
            style={index > 0 ? { borderTop: `1px dashed ${chalk}1a` } : undefined}
          >
            <span className="grid h-[18px] w-[18px] place-items-center rounded font-mono text-[8.5px]" style={{ background: `${accent}24`, color: accent }}>
              {index + 1}
            </span>
            <div className="min-w-0">
              {step.latex
                ? <TexBlock tex={step.latex} color={chalk} size={16} />
                : <div className="text-[12px]" style={{ textShadow: "0 0 1px currentColor" }}>{step.expression}</div>}
              <div className="mt-0.5 text-[9px] opacity-50">{step.why}</div>
            </div>
          </div>
        ))}
      </div>
      {intent.conclusion ? (
        <p className="m-0 mt-2 border-t pt-2 text-[10px] opacity-80" style={{ borderColor: `${chalk}18` }}>{intent.conclusion}</p>
      ) : null}
    </div>
  );
}

/* ── 15 · Mistake Check ── */

function MistakeCheckBody({ intent, chalk, state, emit, readOnly }: BodyProps & { intent: Extract<WidgetIntent, { kind: "mistake_check" }> }) {
  const showCorrection = state.submitted === true;

  return (
    <div>
      <Muted className="mb-2">{intent.prompt ?? "Spot the flaw"}</Muted>
      <div className="space-y-1">
        {intent.lines.map((line) => (
          <div
            key={line.id}
            className="rounded-md px-2.5 py-2"
            style={{
              background: line.status === "error" ? "rgba(248,113,113,0.08)" : "rgba(255,255,255,0.03)",
              border: `1px solid ${line.status === "error" ? "rgba(248,113,113,0.22)" : "transparent"}`,
            }}
          >
            <div style={{ textDecoration: line.status === "error" ? "line-through" : undefined, textDecorationColor: "#fca5a5" }}>
              {line.contentLatex
                ? <Tex tex={line.contentLatex} color={chalk} size={14} />
                : <span className="text-[12px]">{line.content}</span>}
            </div>
            {line.status === "error" && line.diagnosis ? (
              <div className="mt-1 flex gap-1.5 text-[9.5px]" style={{ color: "#fca5a5" }}>
                <span aria-hidden>↳</span><span className="opacity-90">{line.diagnosis}</span>
              </div>
            ) : null}
          </div>
        ))}
      </div>

      {intent.misconception ? (
        <p className="m-0 mt-2 text-[10px] opacity-70">
          <span className="opacity-60">Underneath: </span>{intent.misconception}
        </p>
      ) : null}

      {/* The repair question comes first and the correction stays hidden behind
          it: the agent diagnoses the mistake rather than replacing the work. */}
      {intent.repairQuestion ? (
        <p className="m-0 mt-2 text-[10.5px] font-medium opacity-90">{intent.repairQuestion}</p>
      ) : null}

      {intent.correction || intent.correctionLatex ? (
        showCorrection ? (
          <div className="mt-2 rounded-md px-2.5 py-2" style={{ background: "rgba(134,239,172,0.08)", border: "1px solid rgba(134,239,172,0.22)" }}>
            {intent.correctionLatex
              ? <Tex tex={intent.correctionLatex} color="#86efac" size={14} />
              : <span className="text-[11.5px]" style={{ color: "#86efac" }}>{intent.correction}</span>}
          </div>
        ) : (
          <button
            type="button"
            disabled={readOnly}
            onClick={() => emit({ submitted: true })}
            className="mt-2 rounded px-2 py-1 text-[9px] transition-colors hover:bg-white/15 disabled:opacity-40"
            style={{ background: "rgba(255,255,255,0.08)", color: `${chalk}b3` }}
          >
            Show the correction
          </button>
        )
      ) : null}
    </div>
  );
}

/* ── 16 · Memory Hook ── */

function MemoryHookBody({ intent }: BodyProps & { intent: Extract<WidgetIntent, { kind: "memory_hook" }> }) {
  return (
    <div>
      <div className="relative rounded-md px-3.5 py-3" style={{ background: "rgba(155,150,230,0.1)", border: "1px solid rgba(155,150,230,0.25)" }}>
        <span className="absolute right-2.5 top-0 text-[28px] leading-none" style={{ color: "rgba(155,150,230,0.4)" }} aria-hidden>”</span>
        {intent.hookLatex
          ? <TexBlock tex={intent.hookLatex} color="#d9d6ff" size={17} />
          : null}
        <p className="m-0 whitespace-pre-line text-[13px] leading-snug" style={{ color: "#d9d6ff", textShadow: "0 0 1px currentColor" }}>
          {intent.hook}
        </p>
      </div>
      {intent.elaboration ? <p className="m-0 mt-2 text-[10px] leading-snug opacity-70">{intent.elaboration}</p> : null}
      {intent.resurfaceFor?.length ? (
        <div className="mt-2 flex flex-wrap gap-1">
          {intent.resurfaceFor.map((key, index) => (
            <span key={index} className="rounded-full px-2 py-0.5 font-mono text-[8px] opacity-55" style={{ background: "rgba(255,255,255,0.06)" }}>
              {key}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/* ── 18 · Challenge ── */

function ChallengeBody({ intent, chalk, accent, state, emit, readOnly }: BodyProps & { intent: Extract<WidgetIntent, { kind: "challenge" }> }) {
  const [draft, setDraft] = useState(state.responseText ?? "");

  return (
    <div>
      <span
        className="mb-2 inline-flex items-center rounded-full px-2.5 py-1 font-mono text-[8px] uppercase tracking-[0.06em]"
        style={{ background: "rgba(255,122,51,0.14)", border: "1px solid rgba(255,122,51,0.3)", color: "#ff7a33" }}
      >
        {intent.badge ?? "On your own"}
      </span>
      <p className="m-0 text-[12.5px] leading-snug" style={{ textShadow: "0 0 1px currentColor" }}>{intent.prompt}</p>
      {intent.promptLatex ? <div className="mt-1.5"><TexBlock tex={intent.promptLatex} color={chalk} size={17} /></div> : null}

      {intent.parts?.length ? (
        <ol className="m-0 mt-2 list-none space-y-1.5 p-0">
          {intent.parts.map((part, index) => (
            <li key={part.id} className="grid grid-cols-[16px_1fr] gap-2">
              <span className="font-mono text-[9px] opacity-45">{String.fromCharCode(97 + index)})</span>
              <div>
                <span className="text-[10.5px] opacity-85">{part.prompt}</span>
                {part.promptLatex ? <div className="mt-1"><Tex tex={part.promptLatex} color={chalk} size={14} /></div> : null}
              </div>
            </li>
          ))}
        </ol>
      ) : null}

      {intent.transferNote ? (
        <p className="m-0 mt-2 text-[9.5px] italic opacity-55">{intent.transferNote}</p>
      ) : null}

      {intent.successCriteria?.length ? (
        <div className="mt-2">
          <Muted className="mb-1">A complete answer</Muted>
          <ul className="m-0 list-none space-y-0.5 p-0">
            {intent.successCriteria.map((criterion, index) => (
              <li key={index} className="flex gap-1.5 text-[9.5px] opacity-70">
                <span style={{ color: accent }}>›</span><span>{criterion}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="mt-2 flex items-start gap-2">
        <textarea
          value={draft}
          disabled={readOnly}
          rows={2}
          placeholder="Your solution…"
          onChange={(event) => setDraft(event.target.value)}
          className="min-w-0 flex-1 resize-y rounded-md border bg-black/15 px-2.5 py-1.5 text-[10.5px] outline-none disabled:opacity-70"
          style={{ borderColor: `${chalk}1f`, color: chalk }}
        />
        <button
          type="button"
          disabled={readOnly || !draft.trim()}
          onClick={() => emit({ responseText: draft.trim(), submitted: true })}
          className="rounded-md px-2.5 py-1.5 text-[10px] font-medium text-black disabled:opacity-30"
          style={{ background: accent }}
        >
          Submit
        </button>
      </div>
      {state.submitted ? <div className="mt-1 text-[9.5px] opacity-55">Submitted — the tutor will review it.</div> : null}
    </div>
  );
}

/* ── 19 · Reflection ── */

function ReflectionBody({ intent, chalk, accent, state, emit, readOnly }: BodyProps & { intent: Extract<WidgetIntent, { kind: "reflection" }> }) {
  const [draft, setDraft] = useState(state.responseText ?? "");
  const words = draft.trim() ? draft.trim().split(/\s+/).length : 0;
  const minWords = intent.minWords ?? 0;
  const short = words < minWords;

  return (
    <div>
      <p className="m-0 mb-2 text-[11px] font-medium leading-snug opacity-90">{intent.prompt}</p>
      {intent.guidance?.length ? (
        <ul className="m-0 mb-2 list-none space-y-0.5 p-0">
          {intent.guidance.map((item, index) => (
            <li key={index} className="flex gap-1.5 text-[9.5px] opacity-60">
              <span style={{ color: accent }}>›</span><span>{item}</span>
            </li>
          ))}
        </ul>
      ) : null}
      <textarea
        value={draft}
        disabled={readOnly}
        rows={3}
        placeholder={intent.placeholder ?? "Explain it in your own words…"}
        onChange={(event) => setDraft(event.target.value)}
        className="block w-full resize-y rounded-md border px-2.5 py-2 text-[11px] leading-relaxed outline-none disabled:opacity-70"
        style={{ borderColor: `${chalk}1f`, background: "rgba(0,0,0,0.16)", color: chalk }}
      />
      <div className="mt-1.5 flex items-center justify-between">
        <span className="font-mono text-[8.5px] opacity-40">
          {minWords > 0 ? `${words}/${minWords} words` : `${words} words`}
        </span>
        <button
          type="button"
          disabled={readOnly || !draft.trim() || short}
          onClick={() => emit({ responseText: draft.trim(), submitted: true })}
          className="rounded px-2 py-1 text-[9.5px] font-medium text-black disabled:opacity-25"
          style={{ background: accent }}
        >
          Send to tutor
        </button>
      </div>
      {state.submitted ? <div className="mt-1 text-[9.5px] opacity-55">Sent — the tutor will evaluate your explanation.</div> : null}
    </div>
  );
}

/* ── 20 · Mastery Card ── */

function MasteryCardBody({ intent, chalk, accent }: BodyProps & { intent: Extract<WidgetIntent, { kind: "mastery_card" }> }) {
  // The verdict is computed here, never taken from the model. "You got 90%,
  // therefore mastered" is exactly the claim the mastery gate exists to refuse.
  const assessment = assessMastery(intent.evidence);

  const section = (label: string, items?: string[], mark = "✓") =>
    items?.length ? (
      <div className="mt-2">
        <Muted className="mb-1">{label}</Muted>
        <ul className="m-0 list-none space-y-0.5 p-0">
          {items.map((item, index) => (
            <li key={index} className="flex gap-1.5 text-[10px] opacity-80">
              <span style={{ color: mark === "✓" ? "#86efac" : "#fde68a" }}>{mark}</span>
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </div>
    ) : null;

  return (
    <div>
      <div className="text-[13px] font-semibold opacity-90">{intent.concept}</div>

      <div className="mt-2 space-y-1">
        {MASTERY_EVIDENCE_DIMENSIONS.map((dimension) => {
          const score = Math.round(Math.min(100, Math.max(0, intent.evidence[dimension])));
          const isWeakest = dimension === assessment.weakestLink;
          const met = score >= MASTERY_THRESHOLD;
          return (
            <div key={dimension} className="grid grid-cols-[92px_1fr_34px] items-center gap-2">
              <span className="font-mono text-[9px] opacity-60">{MASTERY_DIMENSION_LABEL[dimension]}</span>
              <span className="h-[4px] overflow-hidden rounded-full" style={{ background: "rgba(255,255,255,0.1)" }}>
                <i
                  className="block h-full rounded-full"
                  style={{ width: `${score}%`, background: met ? "#86efac" : isWeakest ? "#fca5a5" : "#fde68a" }}
                />
              </span>
              <span className="text-right font-mono text-[9px] opacity-70">{score}%</span>
            </div>
          );
        })}
      </div>

      <div
        className="mt-2.5 rounded-md px-2.5 py-2"
        style={{
          background: assessment.mastered ? "rgba(134,239,172,0.1)" : "rgba(253,230,138,0.08)",
          border: `1px solid ${assessment.mastered ? "rgba(134,239,172,0.28)" : "rgba(253,230,138,0.24)"}`,
        }}
      >
        <div className="font-mono text-[10px] uppercase tracking-[0.08em]" style={{ color: assessment.mastered ? "#86efac" : "#fde68a" }}>
          {assessment.mastered ? "Mastered" : "Mastered: not yet"}
        </div>
        <div className="mt-0.5 text-[10px] opacity-80">{assessment.summary}</div>
      </div>

      {section("Understands", intent.understands)}
      {section("Can do", intent.canDo)}
      {section("Recall", intent.recalls)}
      {section("Watch", intent.watch, "△")}

      {(intent.next || intent.reviewIn) ? (
        <div className="mt-2 border-t pt-2 text-[10px] opacity-70" style={{ borderColor: `${chalk}18` }}>
          {intent.next ? <div><span className="opacity-60">Next: </span><span style={{ color: accent }}>{intent.next}</span></div> : null}
          {intent.reviewIn ? <div className="mt-0.5"><span className="opacity-60">Retrieval check: </span>{intent.reviewIn}</div> : null}
        </div>
      ) : null}
    </div>
  );
}
