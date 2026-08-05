import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  Check,
  ChevronRight,
  GripVertical,
  Lock,
  Play,
  RotateCcw,
  Terminal,
  X as XIcon,
} from "lucide-react";
import {
  EXERCISES,
  MISCONCEPTION_HELP,
  MISCONCEPTION_LABEL,
  checkPredict,
  type Exercise,
  type Misconception,
  type ParsonsExercise,
  type PredictExercise,
} from "../../data/coding";

export type TrainerMode = "all" | "parsons" | "predict";

interface Props {
  onNotify: (text: string) => void;
  /** The curriculum that opened this trainer, if it came from the Programming picker. */
  curriculum?: string;
  /** Programming curricula deliberately land in Parsons first. */
  initialMode?: TrainerMode;
}

type Phase = "predict" | "revealed";
type Attempt = { id: string; correct: boolean; m: Misconception };

export function PredictionTrainer({ onNotify, curriculum, initialMode = "all" }: Props) {
  const [mode, setMode] = useState<TrainerMode>(initialMode);
  const exercises = useMemo(
    () => (mode === "all" ? EXERCISES : EXERCISES.filter((exercise) => exercise.kind === mode)),
    [mode]
  );
  const [index, setIndex] = useState(0);
  const ex = exercises[index] ?? exercises[0];

  const [phase, setPhase] = useState<Phase>("predict");
  const [guess, setGuess] = useState("");
  const [choice, setChoice] = useState<string | null>(null);
  const [order, setOrder] = useState<string[]>([]);
  const [step, setStep] = useState(0);
  const [log, setLog] = useState<Attempt[]>([]);
  const dragIdx = useRef<number | null>(null);

  // A route change (for example, choosing a different Programming curriculum)
  // starts the suite at its first Parsons problem.
  useEffect(() => {
    setMode(initialMode);
    setIndex(0);
    setLog([]);
  }, [initialMode]);

  // Reset the prediction surface whenever the exercise or suite changes.
  useEffect(() => {
    setPhase("predict");
    setGuess("");
    setChoice(null);
    setStep(0);
    if (ex.kind === "parsons") {
      const pool = [...ex.solution, ...(ex.distractors ?? [])];
      setOrder(shuffle(pool));
    } else {
      setOrder([]);
    }
  }, [index, mode]); // eslint-disable-line react-hooks/exhaustive-deps

  const isPredict = ex.kind === "predict";

  // The gate is intentional: a code exercise cannot be run until the learner
  // has committed to a model of what it will do.
  const hasPrediction = isPredict
    ? choice !== null || guess.trim().length > 0
    : order.length > 0;

  const evaluate = () => {
    if (ex.kind === "predict") {
      if (choice) return ex.choices?.find((c) => c.id === choice)?.misconception === "none";
      return checkPredict(ex, guess);
    }
    const chosen = order.slice(0, ex.solution.length);
    return chosen.length === ex.solution.length && chosen.every((line, i) => line === ex.solution[i]);
  };

  const correct = phase === "revealed" && evaluate();

  const diagnose = (wasCorrect = evaluate()): Misconception => {
    if (ex.kind !== "predict" || wasCorrect) return "none";
    if (choice) return ex.choices?.find((c) => c.id === choice)?.misconception ?? "none";
    return ex.diagnose(guess);
  };

  const misconception: Misconception = diagnose(correct);

  const run = () => {
    if (!hasPrediction) {
      onNotify(isPredict ? "Predict the output first — that's the point" : "Arrange the lines first");
      return;
    }

    // Evaluate before changing phase. This keeps the attempt log honest; using
    // the pre-reveal `correct` value here would record every attempt as wrong.
    const wasCorrect = evaluate();
    const m = diagnose(wasCorrect);
    setPhase("revealed");
    setStep(0);
    setLog((current) => [
      ...current.filter((attempt) => attempt.id !== ex.id),
      { id: ex.id, correct: wasCorrect, m },
    ]);
  };

  const next = () => {
    if (index < exercises.length - 1) setIndex(index + 1);
    else onNotify(`That's the end of the ${mode === "parsons" ? "Parsons suite" : "exercise set"} — nice work`);
  };

  const switchMode = (nextMode: TrainerMode) => {
    if (nextMode === mode) return;
    setMode(nextMode);
    setIndex(0);
    setLog([]);
  };

  const predictedText = isPredict
    ? choice
      ? (ex as PredictExercise).choices?.find((c) => c.id === choice)?.text ?? ""
      : guess
    : order.slice(0, (ex as ParsonsExercise).solution.length).join("\n");
  const actualText = ex.output;

  return (
    <div className="flex min-h-0 flex-1 w-full flex-col px-5 pb-4 pt-3">
      {/* Header */}
      <div className="mb-3 flex flex-wrap items-center gap-2.5">
        <span className="rounded-full border border-edge bg-raise px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-mut">
          {mode === "parsons" ? "Parsons suite" : "Prediction trainer"}
        </span>
        <span className="font-mono text-[11px] text-dim">
          {String(index + 1).padStart(2, "0")} / {String(exercises.length).padStart(2, "0")}
        </span>
        {curriculum && (
          <span className="max-w-[260px] truncate rounded-full border border-[#fcd34d]/20 bg-[#fcd34d]/[0.06] px-2 py-0.5 font-mono text-[10px] text-[#fcd34d]/90" title={curriculum}>
            {curriculum}
          </span>
        )}
        <span className="rounded-full bg-[#fcd34d]/15 px-2 py-0.5 font-mono text-[10px] text-[#fcd34d]">
          {ex.kind === "predict" ? "predict output" : "drag + check"}
        </span>

        <div className="ml-auto flex items-center rounded-md border border-edge bg-raise p-0.5">
          {[
            { id: "parsons" as const, label: "Parsons", count: EXERCISES.filter((e) => e.kind === "parsons").length },
            { id: "predict" as const, label: "Predict output", count: EXERCISES.filter((e) => e.kind === "predict").length },
            { id: "all" as const, label: "All", count: EXERCISES.length },
          ].map((item) => (
            <button
              key={item.id}
              onClick={() => switchMode(item.id)}
              className={`rounded px-2 py-1 font-mono text-[10px] transition-colors ${
                mode === item.id ? "bg-white/[0.1] text-fg" : "text-dim hover:text-mut"
              }`}
              title={`${item.count} exercises`}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className="flex w-full items-center justify-end gap-1.5 sm:w-auto">
          {exercises.map((exercise, i) => {
            const record = log.find((attempt) => attempt.id === exercise.id);
            return (
              <button
                key={exercise.id}
                onClick={() => setIndex(i)}
                title={exercise.title}
                aria-label={`Go to ${exercise.title}`}
                className={`h-1.5 w-4 rounded-full transition-colors sm:w-5 ${
                  i === index
                    ? "bg-accent"
                    : record
                    ? record.correct
                      ? "bg-[#86efac]"
                      : "bg-[#fca5a5]"
                    : "bg-white/12"
                }`}
              />
            );
          })}
        </div>
      </div>

      {/* Three-column learning loop */}
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-y-auto lg:grid-cols-[290px_minmax(0,1fr)_390px] lg:overflow-hidden">
        {/* LEFT: task + tutor */}
        <div className="flex min-h-0 flex-col gap-3 overflow-y-auto">
          {curriculum && mode === "parsons" && (
            <div className="rounded-lg border border-[#fcd34d]/25 bg-[#fcd34d]/[0.05] px-3 py-2.5">
              <div className="mb-1 font-mono text-[9.5px] uppercase tracking-wider text-[#fcd34d]/80">Curriculum route</div>
              <p className="text-[11.5px] leading-relaxed text-mut">
                Structure first. These problems are precomputed, so there is no kernel to start and no file to manage.
              </p>
            </div>
          )}
          <div className="rounded-lg border border-edge bg-raise p-4">
            <div className="mb-1 font-mono text-[10px] uppercase tracking-wider text-dim">{ex.concept}</div>
            <h2 className="mb-2 text-[17px] font-semibold leading-snug text-fg">{ex.title}</h2>
            <p className="text-[13px] leading-relaxed text-mut">{ex.brief}</p>
          </div>

          {/* The tutor is deliberately quiet before the reveal. */}
          <div
            className={`rounded-lg border p-4 transition-colors ${
              phase === "revealed"
                ? correct
                  ? "border-[#86efac]/40 bg-[#86efac]/[0.05]"
                  : "border-[#fca5a5]/40 bg-[#fca5a5]/[0.05]"
                : "border-edge bg-raise"
            }`}
          >
            <div className="mb-2 flex items-center gap-2">
              <span className="font-mono text-[10px] uppercase tracking-wider text-dim">Tutor</span>
              {phase === "predict" && (
                <span className="rounded-full bg-white/[0.06] px-1.5 py-[1px] font-mono text-[9px] text-dim">waiting</span>
              )}
            </div>
            {phase === "predict" ? (
              <p className="text-[12.5px] leading-relaxed text-dim">
                I’m holding the explanation. Commit to a prediction first — the gap between your model and the machine is the useful part.
              </p>
            ) : (
              <>
                <p className="text-[13px] leading-relaxed text-fg/90">
                  {ex.kind === "predict"
                    ? correct
                      ? ex.tutorRight
                      : ex.tutorWrong[misconception] ?? MISCONCEPTION_HELP[misconception]
                    : correct
                    ? ex.tutorRight
                    : ex.tutorWrong}
                </p>
                <div className={`mt-3 rounded-md border p-2.5 ${correct ? "border-[#86efac]/25 bg-[#86efac]/[0.04]" : "border-[#fca5a5]/25 bg-black/20"}`}>
                  <div className={`mb-1 font-mono text-[9.5px] uppercase tracking-wider ${correct ? "text-[#86efac]" : "text-[#fca5a5]"}`}>
                    {correct ? "Model matched" : "The gap"}
                  </div>
                  <div className="text-[12px] font-medium text-fg">
                    {correct
                      ? "Your prediction and the precomputed result agree."
                      : `${outputLineCount(actualText)} actual ${outputLineCount(actualText) === 1 ? "line" : "lines"} · one mental model to inspect`}
                  </div>
                </div>
                {!correct && ex.kind === "predict" && (
                  <div className="mt-2 rounded-md border border-[#fca5a5]/30 bg-black/20 p-2.5">
                    <div className="mb-1 font-mono text-[9.5px] uppercase tracking-wider text-[#fca5a5]">Misconception detected</div>
                    <div className="text-[12.5px] font-medium text-fg">{MISCONCEPTION_LABEL[misconception]}</div>
                    <p className="mt-1 text-[11.5px] leading-relaxed text-mut">{MISCONCEPTION_HELP[misconception]}</p>
                  </div>
                )}
              </>
            )}
          </div>

          {log.length > 0 && (
            <div className="rounded-lg border border-edge bg-raise p-3">
              <div className="mb-2 font-mono text-[10px] uppercase tracking-wider text-dim">Signals collected</div>
              <div className="space-y-1">
                {Object.entries(
                  log
                    .filter((attempt) => !attempt.correct)
                    .reduce<Record<string, number>>((acc, attempt) => {
                      acc[attempt.m] = (acc[attempt.m] ?? 0) + 1;
                      return acc;
                    }, {})
                ).map(([m, n]) => (
                  <div key={m} className="flex items-center gap-2 text-[11.5px]">
                    <span className="h-1.5 w-1.5 rounded-full bg-[#fca5a5]" />
                    <span className="flex-1 truncate text-mut">{MISCONCEPTION_LABEL[m as Misconception]}</span>
                    <span className="font-mono text-[10px] text-dim">×{n}</span>
                  </div>
                ))}
                {log.length > 0 && log.every((attempt) => attempt.correct) && (
                  <p className="text-[11.5px] text-[#86efac]">No broken models yet.</p>
                )}
              </div>
            </div>
          )}
        </div>

        {/* MIDDLE: one program block / Parsons arrangement */}
        <div className="flex min-h-0 flex-col rounded-lg border border-edge bg-[#141414]">
          <div className="flex items-center gap-2 border-b border-edge px-3 py-2">
            <span className="font-mono text-[10px] uppercase tracking-wider text-dim">
              {isPredict ? "one code block" : "program structure"}
            </span>
            <span className="ml-auto font-mono text-[10px] text-dim">{isPredict ? "precomputed" : "no kernel"}</span>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {isPredict ? (
              <CodeBlock code={(ex as PredictExercise).code} activeLine={phase === "revealed" ? (ex as PredictExercise).trace[step]?.line : undefined} />
            ) : (
              <ParsonsBoard
                order={order}
                setOrder={setOrder}
                locked={phase === "revealed"}
                solution={(ex as ParsonsExercise).solution}
                dragIdx={dragIdx}
              />
            )}
          </div>

          {/* Prediction gate / Parsons check */}
          <div className="border-t border-edge p-3">
            {phase === "predict" ? (
              isPredict ? (
                <>
                  <div className="mb-2 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-dim">
                    <Lock size={10} />
                    Run is locked until you predict
                  </div>
                  {(ex as PredictExercise).choices && (
                    <div className="mb-2 grid grid-cols-2 gap-1.5">
                      {(ex as PredictExercise).choices!.map((c) => (
                        <button
                          key={c.id}
                          onClick={() => {
                            setChoice(c.id);
                            setGuess("");
                          }}
                          className={`rounded border px-2 py-1.5 text-left font-mono text-[11px] transition-colors ${
                            choice === c.id
                              ? "border-accent bg-accent/10 text-fg"
                              : "border-edge bg-raise text-mut hover:text-fg"
                          }`}
                        >
                          {c.text}
                        </button>
                      ))}
                    </div>
                  )}
                  <textarea
                    value={guess}
                    onChange={(event) => {
                      setGuess(event.target.value);
                      setChoice(null);
                    }}
                    placeholder="…or type the exact output you expect"
                    className="mb-2 h-[60px] w-full resize-none rounded border border-edge bg-black/30 px-2.5 py-2 font-mono text-[12px] text-fg outline-none placeholder:text-faint focus:border-accent/60"
                  />
                  <button
                    onClick={run}
                    disabled={!hasPrediction}
                    className={`flex w-full items-center justify-center gap-1.5 rounded-md py-2 text-[13px] font-medium transition-all ${
                      hasPrediction ? "bg-accent text-white hover:bg-accent-deep active:scale-[0.99]" : "cursor-not-allowed bg-white/[0.06] text-faint"
                    }`}
                  >
                    {hasPrediction ? <Play size={13} fill="currentColor" /> : <Lock size={12} />}
                    {hasPrediction ? "Run" : "Predict to unlock Run"}
                  </button>
                </>
              ) : (
                <>
                  <div className="mb-2 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-dim">
                    <GripVertical size={11} />
                    Arrange the lines, then check your structure
                  </div>
                  <button
                    onClick={run}
                    disabled={!hasPrediction}
                    className="flex w-full items-center justify-center gap-1.5 rounded-md bg-[#b88718] py-2 text-[13px] font-medium text-white transition-colors hover:bg-[#c99520] disabled:cursor-not-allowed disabled:bg-white/[0.06] disabled:text-faint"
                  >
                    <Check size={13} />
                    Check order
                  </button>
                </>
              )
            ) : (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    setPhase("predict");
                    setStep(0);
                  }}
                  className="flex items-center gap-1.5 rounded-md border border-edge px-3 py-2 text-[12.5px] text-mut transition-colors hover:bg-white/[0.07] hover:text-fg"
                >
                  <RotateCcw size={12} />
                  Re-predict
                </button>
                <button
                  onClick={next}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-md bg-accent py-2 text-[13px] font-medium text-white transition-colors hover:bg-accent-deep"
                >
                  Next exercise
                  <ArrowRight size={13} />
                </button>
              </div>
            )}
          </div>
        </div>

        {/* RIGHT: output */}
        <div className="flex min-h-0 flex-col gap-3 overflow-y-auto">
          <div className="flex min-h-0 flex-1 flex-col rounded-lg border border-edge bg-[#141414]">
            <div className="flex items-center gap-2 border-b border-edge px-3 py-2">
              <Terminal size={11} className="text-dim" />
              <span className="font-mono text-[10px] uppercase tracking-wider text-dim">output</span>
              {phase === "revealed" && (
                <span className={`ml-auto flex items-center gap-1 rounded-full px-1.5 py-[1px] font-mono text-[9.5px] ${correct ? "bg-[#86efac]/15 text-[#86efac]" : "bg-[#fca5a5]/15 text-[#fca5a5]"}`}>
                  {correct ? <Check size={9} strokeWidth={3} /> : <XIcon size={9} strokeWidth={3} />}
                  {correct ? "match" : "gap"}
                </span>
              )}
            </div>

            {phase === "predict" ? (
              <div className="grid flex-1 place-items-center px-4 py-10 text-center">
                <div>
                  <Lock size={18} className="mx-auto mb-2 text-faint" />
                  <p className="text-[12px] text-dim">Output stays hidden until you commit to a prediction.</p>
                </div>
              </div>
            ) : (
              <div className="min-h-0 flex-1 overflow-y-auto p-3">
                <div className="grid grid-cols-2 gap-2">
                  <div className="min-w-0">
                    <div className="mb-1 font-mono text-[9.5px] uppercase tracking-wider text-dim">
                      {isPredict ? "You predicted" : "Your arrangement"}
                    </div>
                    <pre
                      className="min-h-[76px] whitespace-pre-wrap break-words rounded border px-2.5 py-2 font-mono text-[11px] leading-relaxed"
                      style={{
                        borderColor: correct ? "rgba(134,239,172,0.3)" : "rgba(252,165,165,0.3)",
                        background: correct ? "rgba(134,239,172,0.05)" : "rgba(252,165,165,0.05)",
                        color: "#e7e7e5",
                      }}
                    >
                      {predictedText || "—"}
                    </pre>
                  </div>
                  <div className="min-w-0">
                    <div className="mb-1 font-mono text-[9.5px] uppercase tracking-wider text-dim">Actual output</div>
                    <pre className="min-h-[76px] whitespace-pre-wrap break-words rounded border border-edge bg-black/40 px-2.5 py-2 font-mono text-[11px] leading-relaxed text-[#86efac]">
                      {actualText}
                    </pre>
                  </div>
                </div>
                {isPredict && (
                  <div className="mt-3 rounded border border-edge-soft bg-black/20 px-2.5 py-2">
                    <div className="mb-1 flex items-center gap-1.5 font-mono text-[9.5px] uppercase tracking-wider text-dim">
                      <ChevronRight size={11} className="text-accent" />
                      Output at step {step + 1}
                    </div>
                    <pre className="whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-mut">
                      {(ex as PredictExercise).trace[step]?.stdout.join("\n") || "nothing printed yet"}
                    </pre>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Step slider: intentionally appears only after the result is visible. */}
          {phase === "revealed" && isPredict && (
            <div className="rounded-lg border border-edge bg-raise p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="font-mono text-[10px] uppercase tracking-wider text-dim">Step through execution</span>
                <span className="font-mono text-[10px] text-dim">
                  {step + 1}/{(ex as PredictExercise).trace.length}
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={(ex as PredictExercise).trace.length - 1}
                value={step}
                onChange={(event) => setStep(parseInt(event.target.value, 10))}
                aria-label="Execution step"
                className="mb-3 w-full accent-accent"
              />
              <div className="mb-2 flex items-center gap-1.5 font-mono text-[10.5px] text-dim">
                <ChevronRight size={11} className="text-accent" />
                line {(ex as PredictExercise).trace[step]?.line}
                {(ex as PredictExercise).trace[step]?.note && <span className="truncate text-mut">· {(ex as PredictExercise).trace[step]?.note}</span>}
              </div>
              <div className="space-y-1">
                {Object.entries((ex as PredictExercise).trace[step]?.vars ?? {}).map(([key, value]) => (
                  <div key={key} className="flex items-center gap-2 rounded bg-black/25 px-2 py-1 font-mono text-[11px]">
                    <span className="text-[#7dd3fc]">{key}</span>
                    <span className="text-dim">=</span>
                    <span className="truncate text-fg">{value}</span>
                  </div>
                ))}
                {Object.keys((ex as PredictExercise).trace[step]?.vars ?? {}).length === 0 && (
                  <p className="font-mono text-[10.5px] text-faint">no bindings yet</p>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── code block with active line highlight ── */

function CodeBlock({ code, activeLine }: { code: string; activeLine?: number }) {
  const lines = code.split("\n");
  return (
    <pre className="font-mono text-[13px] leading-[1.7]">
      {lines.map((line, i) => {
        const number = i + 1;
        const active = activeLine === number;
        return (
          <div
            key={i}
            className="flex gap-3 rounded px-1 transition-colors"
            style={active ? { background: "rgba(35,131,226,0.16)" } : undefined}
          >
            <span className="w-5 shrink-0 select-none text-right text-dim">{number}</span>
            <span className="whitespace-pre text-fg/90">{line || " "}</span>
          </div>
        );
      })}
    </pre>
  );
}

/* ── Parsons drag board ── */

function ParsonsBoard({
  order,
  setOrder,
  locked,
  solution,
  dragIdx,
}: {
  order: string[];
  setOrder: (value: string[]) => void;
  locked: boolean;
  solution: string[];
  dragIdx: React.MutableRefObject<number | null>;
}) {
  const onDrop = (target: number) => {
    const from = dragIdx.current;
    if (from === null || from === target) return;
    moveLine(from, target);
    dragIdx.current = null;
  };

  const moveLine = (from: number, target: number) => {
    const next = [...order];
    const [moved] = next.splice(from, 1);
    next.splice(target, 0, moved);
    setOrder(next);
  };

  return (
    <div className="space-y-1.5">
      {order.map((line, i) => {
        const inSolution = solution.includes(line);
        const correctSpot = locked && i < solution.length && inSolution && solution[i] === line;
        // Distractors parked after the active program are intentionally unused,
        // not wrong. A solution line in that area is still out of place.
        const unused = locked && i >= solution.length && !inSolution;
        const wrongSpot = locked && !correctSpot && !unused;
        return (
          <div
            key={`${line}-${i}`}
            draggable={!locked}
            onDragStart={() => (dragIdx.current = i)}
            onDragOver={(event) => event.preventDefault()}
            onDrop={() => onDrop(i)}
            className={`flex items-center gap-1.5 rounded border px-2 py-1.5 font-mono text-[12px] transition-colors ${
              locked
                ? correctSpot
                  ? "border-[#86efac]/40 bg-[#86efac]/[0.06] text-fg"
                  : wrongSpot
                  ? "border-[#fca5a5]/40 bg-[#fca5a5]/[0.06] text-fg/80"
                  : "border-edge bg-raise"
                : "cursor-grab border-edge bg-raise text-fg/90 hover:border-white/25 active:cursor-grabbing"
            }`}
          >
            {!locked && <GripVertical size={12} className="shrink-0 text-dim" />}
            {locked && (
              <span className="shrink-0">
                {correctSpot ? (
                  <Check size={11} className="text-[#86efac]" strokeWidth={3} />
                ) : unused ? (
                  <span className="block w-[11px] text-center text-dim">·</span>
                ) : (
                  <XIcon size={11} className="text-[#fca5a5]" strokeWidth={3} />
                )}
              </span>
            )}
            <span className="min-w-0 flex-1 whitespace-pre-wrap">{line}</span>
            {!locked && (
              <span className="ml-auto flex shrink-0 items-center gap-0.5">
                <button
                  onClick={(event) => {
                    event.stopPropagation();
                    if (i > 0) moveLine(i, i - 1);
                  }}
                  disabled={i === 0}
                  className="grid h-5 w-5 place-items-center rounded text-dim hover:bg-white/[0.08] hover:text-fg disabled:opacity-25"
                  aria-label="Move line up"
                >
                  <ArrowUp size={11} />
                </button>
                <button
                  onClick={(event) => {
                    event.stopPropagation();
                    if (i < order.length - 1) moveLine(i, i + 1);
                  }}
                  disabled={i === order.length - 1}
                  className="grid h-5 w-5 place-items-center rounded text-dim hover:bg-white/[0.08] hover:text-fg disabled:opacity-25"
                  aria-label="Move line down"
                >
                  <ArrowDown size={11} />
                </button>
              </span>
            )}
          </div>
        );
      })}
      {!locked && <p className="pt-2 font-mono text-[10.5px] text-dim">Some lines don’t belong. Drag or use the arrows to build the structure.</p>}
    </div>
  );
}

function shuffle<T>(values: T[]): T[] {
  const result = [...values];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function outputLineCount(output: string) {
  return output ? output.split("\n").length : 0;
}

export type { Exercise };
