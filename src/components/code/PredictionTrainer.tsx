import { useEffect, useMemo, useRef, useState } from "react";
import {
  Play,
  Lock,
  RotateCcw,
  ChevronRight,
  Check,
  X as XIcon,
  GripVertical,
  Terminal,
  ArrowRight,
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

interface Props {
  onNotify: (t: string) => void;
}

type Phase = "predict" | "revealed";

export function PredictionTrainer({ onNotify }: Props) {
  const [index, setIndex] = useState(0);
  const ex = EXERCISES[index];

  const [phase, setPhase] = useState<Phase>("predict");
  const [guess, setGuess] = useState("");
  const [choice, setChoice] = useState<string | null>(null);
  const [order, setOrder] = useState<string[]>([]);
  const [step, setStep] = useState(0);
  const [log, setLog] = useState<{ id: string; correct: boolean; m: Misconception }[]>([]);

  // reset per exercise
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
  }, [index]); // eslint-disable-line react-hooks/exhaustive-deps

  const isPredict = ex.kind === "predict";

  /* the gate: Run is locked until a prediction exists */
  const hasPrediction = isPredict
    ? choice !== null || guess.trim().length > 0
    : order.length > 0;

  const correct = useMemo(() => {
    if (phase !== "revealed") return false;
    if (ex.kind === "predict") {
      if (choice) return ex.choices?.find((c) => c.id === choice)?.misconception === "none";
      return checkPredict(ex, guess);
    }
    const chosen = order.filter((l) => ex.solution.includes(l));
    return (
      chosen.length === ex.solution.length &&
      order.slice(0, ex.solution.length).every((l, i) => l === ex.solution[i])
    );
  }, [phase, ex, choice, guess, order]);

  const misconception: Misconception = useMemo(() => {
    if (ex.kind !== "predict" || correct) return "none";
    if (choice) return ex.choices?.find((c) => c.id === choice)?.misconception ?? "none";
    return ex.diagnose(guess);
  }, [ex, choice, guess, correct]);

  const run = () => {
    if (!hasPrediction) {
      onNotify("Predict the output first — that's the point");
      return;
    }
    setPhase("revealed");
    setStep(0);
    setLog((l) => [...l, { id: ex.id, correct, m: misconception }]);
  };

  const next = () => {
    if (index < EXERCISES.length - 1) setIndex(index + 1);
    else onNotify("That's the whole set — nice work");
  };

  const predictedText = isPredict
    ? choice
      ? (ex as PredictExercise).choices?.find((c) => c.id === choice)?.text ?? ""
      : guess
    : order.slice(0, (ex as ParsonsExercise).solution.length).join("\n");

  const actualText = isPredict ? (ex as PredictExercise).output : (ex as ParsonsExercise).output;

  return (
    <div className="flex h-[calc(100vh-92px)] w-full flex-col px-5 pt-4">
      {/* header */}
      <div className="mb-3 flex items-center gap-3">
        <span className="rounded-full border border-edge bg-raise px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-mut">
          Prediction trainer
        </span>
        <span className="font-mono text-[11px] text-dim">
          {String(index + 1).padStart(2, "0")} / {String(EXERCISES.length).padStart(2, "0")}
        </span>
        <span className="rounded-full bg-[#fcd34d]/15 px-2 py-0.5 font-mono text-[10px] text-[#fcd34d]">
          {ex.kind === "predict" ? "predict output" : "parsons"}
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          {EXERCISES.map((e, i) => {
            const rec = log.find((l) => l.id === e.id);
            return (
              <button
                key={e.id}
                onClick={() => setIndex(i)}
                title={e.title}
                className={`h-1.5 w-5 rounded-full transition-colors ${
                  i === index
                    ? "bg-accent"
                    : rec
                    ? rec.correct
                      ? "bg-[#86efac]"
                      : "bg-[#fca5a5]"
                    : "bg-white/12"
                }`}
              />
            );
          })}
        </div>
      </div>

      {/* three columns */}
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-[300px_1fr_340px]">
        {/* ── LEFT: task + tutor ── */}
        <div className="flex min-h-0 flex-col gap-3 overflow-y-auto">
          <div className="rounded-lg border border-edge bg-raise p-4">
            <div className="mb-1 font-mono text-[10px] uppercase tracking-wider text-dim">{ex.concept}</div>
            <h2 className="mb-2 text-[17px] font-semibold leading-snug text-fg">{ex.title}</h2>
            <p className="text-[13px] leading-relaxed text-mut">{ex.brief}</p>
          </div>

          {/* the tutor stays quiet until the gap exists */}
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
                <span className="rounded-full bg-white/[0.06] px-1.5 py-[1px] font-mono text-[9px] text-dim">
                  waiting
                </span>
              )}
            </div>
            {phase === "predict" ? (
              <p className="text-[12.5px] leading-relaxed text-dim">
                I'm not saying anything yet. Commit to a prediction first — the gap between what you
                expect and what actually happens is the useful part.
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
                {!correct && ex.kind === "predict" && (
                  <div className="mt-3 rounded-md border border-[#fca5a5]/30 bg-black/20 p-2.5">
                    <div className="mb-1 font-mono text-[9.5px] uppercase tracking-wider text-[#fca5a5]">
                      Misconception detected
                    </div>
                    <div className="text-[12.5px] font-medium text-fg">
                      {MISCONCEPTION_LABEL[misconception]}
                    </div>
                    <p className="mt-1 text-[11.5px] leading-relaxed text-mut">
                      {MISCONCEPTION_HELP[misconception]}
                    </p>
                  </div>
                )}
              </>
            )}
          </div>

          {log.length > 0 && (
            <div className="rounded-lg border border-edge bg-raise p-3">
              <div className="mb-2 font-mono text-[10px] uppercase tracking-wider text-dim">
                Signals collected
              </div>
              <div className="space-y-1">
                {Object.entries(
                  log
                    .filter((l) => !l.correct)
                    .reduce<Record<string, number>>((acc, l) => {
                      acc[l.m] = (acc[l.m] ?? 0) + 1;
                      return acc;
                    }, {})
                ).map(([m, n]) => (
                  <div key={m} className="flex items-center gap-2 text-[11.5px]">
                    <span className="h-1.5 w-1.5 rounded-full bg-[#fca5a5]" />
                    <span className="flex-1 truncate text-mut">
                      {MISCONCEPTION_LABEL[m as Misconception]}
                    </span>
                    <span className="font-mono text-[10px] text-dim">×{n}</span>
                  </div>
                ))}
                {log.every((l) => l.correct) && (
                  <p className="text-[11.5px] text-[#86efac]">No broken models yet.</p>
                )}
              </div>
            </div>
          )}
        </div>

        {/* ── MIDDLE: the program block ── */}
        <div className="flex min-h-0 flex-col rounded-lg border border-edge bg-[#141414]">
          <div className="flex items-center gap-2 border-b border-edge px-3 py-2">
            <span className="font-mono text-[10px] uppercase tracking-wider text-dim">
              {ex.kind === "predict" ? "program" : "drag into order"}
            </span>
            <span className="ml-auto font-mono text-[10px] text-dim">python</span>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {ex.kind === "predict" ? (
              <CodeBlock code={ex.code} activeLine={phase === "revealed" ? ex.trace[step]?.line : undefined} />
            ) : (
              <ParsonsBoard order={order} setOrder={setOrder} locked={phase === "revealed"} solution={ex.solution} />
            )}
          </div>

          {/* the gate */}
          <div className="border-t border-edge p-3">
            {phase === "predict" ? (
              <>
                <div className="mb-2 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-dim">
                  <Lock size={10} />
                  Run is locked until you predict
                </div>
                {ex.kind === "predict" && (
                  <>
                    {ex.choices && (
                      <div className="mb-2 grid grid-cols-2 gap-1.5">
                        {ex.choices.map((c) => (
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
                      onChange={(e) => {
                        setGuess(e.target.value);
                        setChoice(null);
                      }}
                      placeholder="…or type the exact output you expect"
                      className="mb-2 h-[60px] w-full resize-none rounded border border-edge bg-black/30 px-2.5 py-2 font-mono text-[12px] text-fg outline-none placeholder:text-faint focus:border-accent/60"
                    />
                  </>
                )}
                <button
                  onClick={run}
                  disabled={!hasPrediction}
                  className={`flex w-full items-center justify-center gap-1.5 rounded-md py-2 text-[13px] font-medium transition-all ${
                    hasPrediction
                      ? "bg-accent text-white hover:bg-accent-deep active:scale-[0.99]"
                      : "cursor-not-allowed bg-white/[0.06] text-faint"
                  }`}
                >
                  {hasPrediction ? <Play size={13} fill="currentColor" /> : <Lock size={12} />}
                  {hasPrediction ? "Run" : "Predict to unlock Run"}
                </button>
              </>
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

        {/* ── RIGHT: output ── */}
        <div className="flex min-h-0 flex-col gap-3 overflow-y-auto">
          <div className="flex min-h-0 flex-col rounded-lg border border-edge bg-[#141414]">
            <div className="flex items-center gap-2 border-b border-edge px-3 py-2">
              <Terminal size={11} className="text-dim" />
              <span className="font-mono text-[10px] uppercase tracking-wider text-dim">output</span>
              {phase === "revealed" && (
                <span
                  className={`ml-auto flex items-center gap-1 rounded-full px-1.5 py-[1px] font-mono text-[9.5px] ${
                    correct ? "bg-[#86efac]/15 text-[#86efac]" : "bg-[#fca5a5]/15 text-[#fca5a5]"
                  }`}
                >
                  {correct ? <Check size={9} strokeWidth={3} /> : <XIcon size={9} strokeWidth={3} />}
                  {correct ? "match" : "gap"}
                </span>
              )}
            </div>

            {phase === "predict" ? (
              <div className="grid flex-1 place-items-center px-4 py-10 text-center">
                <div>
                  <Lock size={18} className="mx-auto mb-2 text-faint" />
                  <p className="text-[12px] text-dim">
                    Output stays hidden until you commit to a prediction.
                  </p>
                </div>
              </div>
            ) : (
              <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
                {/* side by side */}
                <div>
                  <div className="mb-1 font-mono text-[9.5px] uppercase tracking-wider text-dim">
                    You predicted
                  </div>
                  <pre
                    className="whitespace-pre-wrap rounded border px-2.5 py-2 font-mono text-[12px] leading-relaxed"
                    style={{
                      borderColor: correct ? "rgba(134,239,172,0.3)" : "rgba(252,165,165,0.3)",
                      background: correct ? "rgba(134,239,172,0.05)" : "rgba(252,165,165,0.05)",
                      color: "#e7e7e5",
                    }}
                  >
                    {predictedText || "—"}
                  </pre>
                </div>
                <div>
                  <div className="mb-1 font-mono text-[9.5px] uppercase tracking-wider text-dim">
                    Actually printed
                  </div>
                  <pre className="whitespace-pre-wrap rounded border border-edge bg-black/40 px-2.5 py-2 font-mono text-[12px] leading-relaxed text-[#86efac]">
                    {phase === "revealed" && ex.kind === "predict"
                      ? ex.trace[step]?.stdout.join("\n") || "…"
                      : actualText}
                  </pre>
                </div>
              </div>
            )}
          </div>

          {/* step slider */}
          {phase === "revealed" && ex.kind === "predict" && (
            <div className="rounded-lg border border-edge bg-raise p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="font-mono text-[10px] uppercase tracking-wider text-dim">
                  Step through execution
                </span>
                <span className="font-mono text-[10px] text-dim">
                  {step + 1}/{ex.trace.length}
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={ex.trace.length - 1}
                value={step}
                onChange={(e) => setStep(parseInt(e.target.value, 10))}
                className="mb-3 w-full accent-accent"
              />
              <div className="mb-2 flex items-center gap-1.5 font-mono text-[10.5px] text-dim">
                <ChevronRight size={11} className="text-accent" />
                line {ex.trace[step]?.line}
                {ex.trace[step]?.note && <span className="text-mut">· {ex.trace[step].note}</span>}
              </div>
              <div className="space-y-1">
                {Object.entries(ex.trace[step]?.vars ?? {}).map(([k, v]) => (
                  <div
                    key={k}
                    className="flex items-center gap-2 rounded bg-black/25 px-2 py-1 font-mono text-[11px]"
                  >
                    <span className="text-[#7dd3fc]">{k}</span>
                    <span className="text-dim">=</span>
                    <span className="truncate text-fg">{v}</span>
                  </div>
                ))}
                {Object.keys(ex.trace[step]?.vars ?? {}).length === 0 && (
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
        const n = i + 1;
        const on = activeLine === n;
        return (
          <div
            key={i}
            className="flex gap-3 rounded px-1 transition-colors"
            style={on ? { background: "rgba(35,131,226,0.16)" } : undefined}
          >
            <span className="w-5 shrink-0 select-none text-right text-dim">{n}</span>
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
}: {
  order: string[];
  setOrder: (v: string[]) => void;
  locked: boolean;
  solution: string[];
}) {
  const dragIdx = useRef<number | null>(null);

  const onDrop = (target: number) => {
    const from = dragIdx.current;
    if (from === null || from === target) return;
    const next = [...order];
    const [moved] = next.splice(from, 1);
    next.splice(target, 0, moved);
    setOrder(next);
    dragIdx.current = null;
  };

  return (
    <div className="space-y-1.5">
      {order.map((line, i) => {
        const inSolution = solution.includes(line);
        const correctSpot = locked && inSolution && solution[i] === line;
        const wrongSpot = locked && (!inSolution || solution[i] !== line);
        return (
          <div
            key={`${line}-${i}`}
            draggable={!locked}
            onDragStart={() => (dragIdx.current = i)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => onDrop(i)}
            className={`flex items-center gap-2 rounded border px-2 py-1.5 font-mono text-[12.5px] transition-colors ${
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
                ) : (
                  <XIcon size={11} className="text-[#fca5a5]" strokeWidth={3} />
                )}
              </span>
            )}
            <span className="whitespace-pre">{line}</span>
          </div>
        );
      })}
      {!locked && (
        <p className="pt-2 font-mono text-[10.5px] text-dim">
          Some lines don't belong. Drag the right ones into the right order.
        </p>
      )}
    </div>
  );
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export type { Exercise };
