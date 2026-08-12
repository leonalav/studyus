import { useEffect, useMemo, useRef, useState } from "react";
import katex from "katex";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Type,
  Maximize2,
  Minimize2,
  ChevronDown,
  PenLine,
  Sigma,
  Save,
  AlertCircle,
  Lightbulb,
} from "lucide-react";
import {
  getAttemptForTaking,
  createRetakeAttempt,
  autosaveDraft,
  submitAttempt,
  AttemptForTakingDTO,
  AttemptResultDTO,
} from "../../api";

interface Props {
  attemptId: string;
  title: string;
  rigor: string;
  onExit: () => void;
  onNotify: (t: string) => void;
}

interface Question {
  id: string;
  stem: string;
  format: "mcq" | "numeric" | "proof";
  maximumMarks: number;
  learningObjective: string;
  options?: { id: string; text: string }[];
  unit?: string | null;
  responseRequirement?: string | null;
  flags: string[];
}

type HintMode = "full" | "limited" | "none";

interface QuestionHintProps {
  objective: string;
  mode: HintMode;
  revealed: boolean;
  remaining: number;
  onReveal: () => void;
}

export function TestRunner({ attemptId, title, rigor, onExit, onNotify }: Props) {
  const [runnerAttemptId, setRunnerAttemptId] = useState(attemptId);
  const [dto, setDto] = useState<AttemptForTakingDTO | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, { mcq?: string; numeric?: string; proof?: string }>>({});
  const [saveStatus, setSaveStatus] = useState<"saved" | "saving" | "error">("saved");
  const [confirmSubmitOpen, setConfirmSubmitOpen] = useState(false);
  const [submissionResult, setSubmissionResult] = useState<AttemptResultDTO | null>(null);
  const [hintedItems, setHintedItems] = useState<Set<string>>(new Set());
  const questionFlagsRef = useRef<Record<string, string[]>>({});
  const pendingDraftsRef = useRef(new Map<string, {
    responseValue: string;
    flags: string[];
    ordinal: number;
  }>());
  const saveTimeoutRef = useRef<number | null>(null);
  const [time, setTime] = useState(0);
  const startTime = useRef(Date.now());

  useEffect(() => {
    setRunnerAttemptId(attemptId);
    setDto(null);
    setLoadError(null);
    setIndex(0);
    setAnswers({});
    setSubmissionResult(null);
    setHintedItems(new Set());
    questionFlagsRef.current = {};
    pendingDraftsRef.current.clear();
    startTime.current = Date.now();
    setTime(0);
  }, [attemptId]);

  /* Load the real attempt: items, drafts and flags all come from SQLite. */
  useEffect(() => {
    let cancelled = false;
    getAttemptForTaking(runnerAttemptId)
      .then((d) => {
        if (cancelled) return;
        if (!d || d.questions.length === 0) {
          setLoadError("This attempt holds no questions.");
          return;
        }
        setDto(d);
        const restored: Record<string, { mcq?: string; numeric?: string; proof?: string }> = {};
        const restoredFlags: Record<string, string[]> = {};
        const restoredHints = new Set<string>();
        for (const q of d.questions) {
          restoredFlags[q.id] = [...q.flags];
          if (q.flags.includes("hint_used")) restoredHints.add(q.id);
          const draft = q.draftResponse ?? "";
          if (!draft) continue;
          if (q.itemType === "mcq") restored[q.id] = { mcq: draft };
          else restored[q.id] = { [q.itemType === "numeric" ? "numeric" : "proof"]: draft };
        }
        questionFlagsRef.current = restoredFlags;
        setHintedItems(restoredHints);
        setAnswers(restored);
      })
      .catch(() => {
        if (!cancelled) setLoadError("Could not load the attempt.");
      });
    return () => {
      cancelled = true;
    };
  }, [runnerAttemptId]);

  const questions = useMemo<Question[]>(
    () =>
      (dto?.questions ?? []).map((q) => ({
        id: q.id,
        stem: q.stem,
        format: q.itemType === "mcq" ? "mcq" : q.itemType === "numeric" ? "numeric" : "proof",
        maximumMarks: q.maximumMarks,
        learningObjective: q.learningObjective,
        options: q.options,
        unit: q.unit,
        responseRequirement: q.responseRequirement,
        flags: q.flags,
      })),
    [dto]
  );

  const total = questions.length;
  const q = questions[index];
  const formatLabel =
    total > 0 && questions.every((x) => x.format === "proof")
      ? "proof"
      : total > 0 && questions.every((x) => x.format === "mcq")
      ? "mcq"
      : "mixed";
  const hintMode: HintMode =
    dto?.assistancePolicy === "full_hints"
      ? "full"
      : dto?.assistancePolicy === "limited_hints"
        ? "limited"
        : dto?.assistancePolicy === "no_hints"
          ? "none"
          : rigor === "casual"
            ? "full"
            : rigor === "rigorous"
              ? "none"
              : "limited";
  const hintBudget = hintMode === "limited" ? Math.max(1, Math.ceil(total * 0.2)) : 0;
  const hintsRemaining = Math.max(0, hintBudget - hintedItems.size);

  useEffect(() => {
    setIndex((i) => Math.max(0, Math.min(i, Math.max(0, total - 1))));
  }, [total]);

  useEffect(() => {
    const t = window.setInterval(() => setTime(Math.floor((Date.now() - startTime.current) / 1000)), 1000);
    return () => window.clearInterval(t);
  }, []);

  // Keep every edited question in the debounce queue. A single pending timeout
  // previously allowed a quick edit on question B to cancel question A's save.
  const flushPendingDrafts = async () => {
    if (saveTimeoutRef.current !== null) {
      window.clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = null;
    }
    const pending = [...pendingDraftsRef.current.entries()];
    if (pending.length === 0) return;

    setSaveStatus("saving");
    try {
      await Promise.all(
        pending.map(async ([itemId, draft]) => {
          const saved = await autosaveDraft(runnerAttemptId, itemId, draft.responseValue, draft.flags, draft.ordinal);
          if (!saved.success) {
            throw new Error(`Cannot save an attempt in status: ${saved.status}`);
          }
          // Do not delete a newer edit that arrived while this write was running.
          if (pendingDraftsRef.current.get(itemId) === draft) {
            pendingDraftsRef.current.delete(itemId);
          }
        })
      );
      setSaveStatus(pendingDraftsRef.current.size === 0 ? "saved" : "saving");
    } catch (error) {
      setSaveStatus("error");
      throw error;
    }
  };

  const handleDraftChange = (
    itemId: string,
    responseValue: string,
    flags = questionFlagsRef.current[itemId] ?? [],
    ordinal = index + 1
  ) => {
    pendingDraftsRef.current.set(itemId, {
      responseValue,
      flags: [...flags],
      ordinal,
    });
    setSaveStatus("saving");
    if (saveTimeoutRef.current !== null) window.clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = window.setTimeout(() => {
      void flushPendingDrafts().catch(() => undefined);
    }, 400);
  };

  const saveAndExit = async () => {
    try {
      await flushPendingDrafts();
      onExit();
    } catch {
      onNotify("Could not save the latest draft. Please retry before leaving the attempt.");
    }
  };

  const answered = questions.filter((item) => {
    const a = answers[item.id];
    if (!a) return false;
    if (item.format === "mcq") return !!a.mcq;
    if (item.format === "numeric") return !!a.numeric?.trim();
    return !!a.proof?.trim();
  }).length;

  const select = (val: string) => {
    if (!q) return;
    setAnswers((current) => ({ ...current, [q.id]: { ...current[q.id], mcq: val } }));
    handleDraftChange(q.id, val);
  };

  const setNumeric = (val: string) => {
    if (!q) return;
    setAnswers((current) => ({ ...current, [q.id]: { ...current[q.id], numeric: val } }));
    handleDraftChange(q.id, val);
  };

  const setProof = (val: string) => {
    if (!q) return;
    setAnswers((current) => ({ ...current, [q.id]: { ...current[q.id], proof: val } }));
    handleDraftChange(q.id, val);
  };

  const revealHint = () => {
    if (!q || hintMode !== "limited" || hintedItems.has(q.id) || hintsRemaining <= 0) return;
    const nextFlags = [...new Set([...(questionFlagsRef.current[q.id] ?? []), "hint_used"])];
    questionFlagsRef.current[q.id] = nextFlags;
    setHintedItems((current) => new Set(current).add(q.id));
    const currentAnswer = answers[q.id];
    const draft =
      q.format === "mcq"
        ? currentAnswer?.mcq ?? ""
        : q.format === "numeric"
          ? currentAnswer?.numeric ?? ""
          : currentAnswer?.proof ?? "";
    handleDraftChange(q.id, draft, nextFlags, index + 1);
    void flushPendingDrafts().catch(() => {
      onNotify("Could not save hint usage. Try again before leaving this question.");
    });
  };

  const requestSubmit = () => {
    if (answered < total) {
      setConfirmSubmitOpen(true);
    } else {
      executeSubmit();
    }
  };

  const executeSubmit = async () => {
    setConfirmSubmitOpen(false);
    try {
      // Scoring must observe the latest keystroke, even when Submit is pressed
      // before the 400 ms autosave debounce has elapsed.
      await flushPendingDrafts();
      const res = await submitAttempt(runnerAttemptId);
      setSubmissionResult(res);
      onNotify(`Exam submitted · Final score: ${res.aggregateScore}/${res.totalPossibleMarks}`);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : "Submission error. Attempt recorded as retryable.");
    }
  };

  const startRetake = async () => {
    try {
      const nextAttemptId = await createRetakeAttempt(runnerAttemptId);
      pendingDraftsRef.current.clear();
      setDto(null);
      setLoadError(null);
      setIndex(0);
      setAnswers({});
      setSubmissionResult(null);
      setHintedItems(new Set());
      questionFlagsRef.current = {};
      startTime.current = Date.now();
      setTime(0);
      setSaveStatus("saved");
      setRunnerAttemptId(nextAttemptId);
      onNotify("Fresh retake started");
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "Could not start a retake");
    }
  };

  if (loadError) {
    return (
      <div className="mx-auto w-full max-w-[760px] px-5 pt-16 select-none">
        <div className="rounded-lg border border-edge bg-raise p-6 text-center">
          <div className="mb-2 text-[15px] font-semibold text-fg">Attempt unavailable</div>
          <p className="mb-5 text-[13px] text-dim">{loadError}</p>
          <button
            onClick={onExit}
            className="rounded-md bg-accent px-3.5 py-2 text-[13px] font-medium text-white transition-colors hover:bg-accent-deep"
          >
            Back
          </button>
        </div>
      </div>
    );
  }

  if (!dto) {
    return (
      <div className="grid h-[calc(100vh-72px)] place-items-center select-none">
        <div className="rounded-lg border border-edge bg-raise px-5 py-4 font-mono text-[12px] text-dim">
          Loading attempt…
        </div>
      </div>
    );
  }

  if (submissionResult) {
    return (
      <SubmittedView
        result={submissionResult}
        onRetake={() => void startRetake()}
        onExit={onExit}
        time={time}
      />
    );
  }

  return (
    <div className="mx-auto flex h-[calc(100vh-72px)] w-full max-w-[1100px] flex-col px-5 pt-6 select-none">
      {/* header */}
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={() => void saveAndExit()}
            className="grid h-8 w-8 place-items-center rounded-md border border-edge bg-raise text-mut transition-colors hover:bg-white/[0.07] hover:text-fg"
            title="Back"
          >
            <ArrowLeft size={14} />
          </button>
          <span className="rounded-full border border-edge bg-raise px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-mut">
            {formatLabel}
          </span>
          <span className="rounded-full bg-accent/15 px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-accent">
            {rigor}
          </span>
          {/* Live autosave status indicator */}
          <span className="flex items-center gap-1 font-mono text-[10.5px] text-dim">
            <Save size={11} className={saveStatus === "saving" ? "animate-spin text-accent" : "text-dim"} />
            {saveStatus === "saving" ? "saving draft…" : saveStatus === "saved" ? "draft saved" : "save error"}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className="font-mono text-[12px] text-dim">
            {String(Math.floor(time / 60)).padStart(2, "0")}:{String(time % 60).padStart(2, "0")}
          </span>
          <button
            onClick={requestSubmit}
            className="rounded-md bg-accent px-3 py-1.5 text-[12.5px] font-medium text-white transition-colors hover:bg-accent-deep"
          >
            Submit exam
          </button>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-5 lg:grid-cols-[1fr_280px]">
        {/* question pane */}
        <div className="flex min-h-0 flex-col rounded-lg border border-edge bg-raise p-5">
          <div className="mb-3 flex items-center justify-between font-mono text-[10.5px] text-dim">
            <span>QUESTION {String(index + 1).padStart(2, "0")} · {String(total).padStart(2, "0")}</span>
            <span>{q?.format === "proof" ? "Proof-based" : q?.format === "numeric" ? "Numeric" : "Multiple choice"}</span>
          </div>

          {q && q.format === "mcq" ? (
            <McqQuestion
              q={q}
              selected={answers[q.id]?.mcq}
              onSelect={select}
              hint={{
                objective: q.learningObjective,
                mode: hintMode,
                revealed: hintedItems.has(q.id),
                remaining: hintsRemaining,
                onReveal: revealHint,
              }}
            />
          ) : q && q.format === "numeric" ? (
            <NumericQuestion
              q={q}
              answer={answers[q.id]?.numeric ?? ""}
              onChange={setNumeric}
              hint={{
                objective: q.learningObjective,
                mode: hintMode,
                revealed: hintedItems.has(q.id),
                remaining: hintsRemaining,
                onReveal: revealHint,
              }}
            />
          ) : q && q.format === "proof" ? (
            <ProofQuestion
              q={q}
              answer={answers[q.id]?.proof ?? ""}
              onChange={setProof}
              hint={{
                objective: q.learningObjective,
                mode: hintMode,
                revealed: hintedItems.has(q.id),
                remaining: hintsRemaining,
                onReveal: revealHint,
              }}
            />
          ) : null}

          <div className="mt-auto flex items-center justify-between pt-6">
            <button
              onClick={() => setIndex((i) => Math.max(0, i - 1))}
              disabled={index === 0}
              className="flex items-center gap-1.5 rounded-md border border-edge px-3 py-1.5 text-[12.5px] text-mut transition-colors hover:bg-white/[0.07] hover:text-fg disabled:opacity-30"
            >
              <ArrowLeft size={12} />
              Prev
            </button>
            <span className="font-mono text-[11px] text-dim">
              {answered}/{total} answered
            </span>
            <button
              onClick={() => setIndex((i) => Math.min(total - 1, i + 1))}
              disabled={index === total - 1}
              className="flex items-center gap-1.5 rounded-md bg-white/[0.06] px-3 py-1.5 text-[12.5px] text-fg transition-colors hover:bg-white/[0.12] disabled:opacity-30"
            >
              Next
              <ArrowRight size={12} />
            </button>
          </div>
        </div>

        {/* nav rail */}
        <aside className="flex min-h-0 flex-col gap-4">
          <div className="rounded-lg border border-edge bg-raise p-3">
            <div className="mb-2 font-mono text-[10px] uppercase tracking-wider text-dim">Navigation</div>
            <div className="grid grid-cols-6 gap-1.5">
              {questions.map((item, i) => {
                const a = answers[item.id];
                const done = a?.mcq || a?.numeric?.trim() || a?.proof?.trim();
                return (
                  <button
                    key={item.id}
                    onClick={() => setIndex(i)}
                    className={`grid h-7 place-items-center rounded font-mono text-[11px] transition-colors ${
                      i === index
                        ? "bg-accent text-white"
                        : done
                        ? "bg-[#86efac]/15 text-[#86efac] hover:bg-[#86efac]/25"
                        : "bg-white/[0.06] text-dim hover:bg-white/[0.12] hover:text-fg"
                    }`}
                  >
                    {i + 1}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="rounded-lg border border-edge bg-raise p-3">
            <div className="mb-2 font-mono text-[10px] uppercase tracking-wider text-dim">Set</div>
            <p className="text-[12px] text-fg">{title}</p>
            <p className="mt-1 font-mono text-[10.5px] text-dim">
              {total} question{total === 1 ? "" : "s"} · {formatLabel} · {rigor}
            </p>
          </div>
        </aside>
      </div>

      {/* Unanswered items confirmation modal */}
      {confirmSubmitOpen && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/60 p-4">
          <div className="w-[380px] rounded-xl border border-edge bg-[#222224] p-5 shadow-2xl">
            <div className="mb-2 flex items-center gap-2 text-[#fcd34d]">
              <AlertCircle size={18} />
              <h3 className="text-[15px] font-semibold text-fg">Unanswered Questions</h3>
            </div>
            <p className="mb-4 text-[13px] text-dim leading-relaxed">
              You have <span className="font-semibold text-fg">{total - answered}</span> unanswered questions remaining. Are you sure you want to finalize submission?
            </p>
            <div className="flex items-center justify-end gap-2">
              <button
                onClick={() => setConfirmSubmitOpen(false)}
                className="rounded-md px-3 py-1.5 text-[12.5px] text-mut hover:text-fg"
              >
                Keep working
              </button>
              <button
                onClick={executeSubmit}
                className="rounded-md bg-accent px-3.5 py-1.5 text-[12.5px] font-medium text-white hover:bg-accent-deep"
              >
                Submit anyway
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function QuestionHint({ objective, mode, revealed, remaining, onReveal }: QuestionHintProps) {
  if (!objective || mode === "none") return null;
  if (mode === "full" || revealed) {
    return (
      <div className="mt-2 flex items-start gap-1.5 rounded-md border border-[#86efac]/20 bg-[#86efac]/[0.05] px-2.5 py-2 text-[12.5px] text-dim">
        <Lightbulb size={13} className="mt-0.5 shrink-0 text-[#86efac]" />
        <span>{mode === "full" ? "Objective hint" : "Revealed hint"} · {objective}</span>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onReveal}
      disabled={remaining <= 0}
      className="mt-2 flex items-center gap-1.5 rounded-md border border-edge bg-card px-2.5 py-1.5 text-[12px] text-mut transition-colors hover:bg-white/[0.06] hover:text-fg disabled:cursor-not-allowed disabled:opacity-45"
    >
      <Lightbulb size={12} />
      {remaining > 0 ? `Reveal objective hint · ${remaining} remaining` : "Hint budget used"}
    </button>
  );
}

/* ── MCQ ── */

function McqQuestion({
  q,
  selected,
  onSelect,
  hint,
}: {
  q: Question;
  selected?: string;
  onSelect: (id: string) => void;
  hint: QuestionHintProps;
}) {
  return (
    <div>
      <h2 className="text-[24px] font-semibold leading-snug text-fg">{q.stem}</h2>
      <QuestionHint {...hint} />
      <div className="mt-5 space-y-2.5">
        {q.options?.length ? (
          q.options.map((opt) => {
            const on = selected === opt.id;
            return (
              <button
                key={opt.id}
                onClick={() => onSelect(opt.id)}
                className={`flex w-full items-center gap-3 rounded-md border px-3.5 py-3 text-left transition-colors ${
                  on ? "border-accent bg-accent/[0.08]" : "border-edge bg-card hover:bg-white/[0.05]"
                }`}
              >
                <span
                  className={`grid h-6 w-6 shrink-0 place-items-center rounded-full border text-[11px] font-medium ${
                    on ? "border-accent bg-accent text-white" : "border-white/20 text-mut"
                  }`}
                >
                  {opt.id.toUpperCase()}
                </span>
                <span className="text-[14px] text-fg">{opt.text}</span>
                {on && <Check size={14} className="ml-auto text-accent" />}
              </button>
            );
          })
        ) : (
          <p className="text-[12.5px] text-dim">This item has no options recorded.</p>
        )}
      </div>
    </div>
  );
}

/* ── Numeric ── */

function NumericQuestion({
  q,
  answer,
  onChange,
  hint,
}: {
  q: Question;
  answer: string;
  onChange: (v: string) => void;
  hint: QuestionHintProps;
}) {
  return (
    <div>
      <h2 className="text-[24px] font-semibold leading-snug text-fg">{q.stem}</h2>
      <QuestionHint {...hint} />
      <div className="mt-5 flex items-center gap-2">
        <input
          value={answer}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Your numeric answer"
          inputMode="decimal"
          className="w-full max-w-[260px] rounded-md border border-edge bg-card px-3.5 py-3 font-mono text-[16px] text-fg outline-none placeholder:text-faint focus:border-accent"
        />
        {q.unit && <span className="font-mono text-[13px] text-dim">{q.unit}</span>}
      </div>
      <p className="mt-2 text-[11.5px] text-faint">Enter a number, or an "a/b" fraction.</p>
    </div>
  );
}

/* ── Proof-based with LaTeX keyboard + live preview ── */

const LATEX_PRESETS = [
  { id: "frac", label: "a/b", insert: "\\frac{a}{b}" },
  { id: "pow", label: "x²", insert: "^{2}" },
  { id: "sqrt", label: "√", insert: "\\sqrt{}" },
  { id: "int", label: "∫", insert: "\\int" },
  { id: "sum", label: "Σ", insert: "\\sum_{i=1}^{n}" },
  { id: "lim", label: "lim", insert: "\\lim_{n\\to\\infty}" },
  { id: "sin", label: "sin", insert: "\\sin" },
  { id: "cos", label: "cos", insert: "\\cos" },
  { id: "pi", label: "π", insert: "\\pi" },
  { id: "theta", label: "θ", insert: "\\theta" },
  { id: "leq", label: "≤", insert: "\\leq" },
  { id: "geq", label: "≥", insert: "\\geq" },
  { id: "neq", label: "≠", insert: "\\neq" },
  { id: "infinity", label: "∞", insert: "\\infty" },
  { id: "vector", label: "vec", insert: "\\vec{}" },
  { id: "hbar", label: "ℏ", insert: "\\hbar" },
];

function ProofQuestion({
  q,
  answer,
  onChange,
  hint,
}: {
  q: Question;
  answer: string;
  onChange: (v: string) => void;
  hint: QuestionHintProps;
}) {
  const [fontSize, setFontSize] = useState(15);
  const [kbOpen, setKbOpen] = useState(true);
  const taRef = useRef<HTMLTextAreaElement>(null);

  const insert = (snippet: string) => {
    const el = taRef.current;
    if (!el) {
      onChange(answer + snippet);
      return;
    }
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const next = answer.slice(0, start) + snippet + answer.slice(end);
    onChange(next);
    requestAnimationFrame(() => {
      el.focus();
      const cursor = start + snippet.length;
      el.setSelectionRange(cursor, cursor);
    });
  };

  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 xl:grid-cols-[1fr_1.1fr]">
      <div className="flex min-h-0 flex-col">
        <h2 className="text-[24px] font-semibold leading-snug text-fg">{q.stem}</h2>
        {q.responseRequirement && (
          <div className="mt-3 rounded-md border border-dashed border-accent/40 bg-accent/[0.04] px-3 py-2">
            <div className="mb-0.5 font-mono text-[10px] uppercase tracking-wider text-accent">Requirement</div>
            <p className="text-[12.5px] text-fg/90">{q.responseRequirement}</p>
          </div>
        )}
        <QuestionHint {...hint} />

        <div className="mt-4 rounded-md border border-edge bg-card">
          <button
            onClick={() => setKbOpen((v) => !v)}
            className="flex w-full items-center justify-between px-3 py-2 text-left"
          >
            <span className="flex items-center gap-1.5 text-[11.5px] font-medium text-fg">
              <Sigma size={12} className="text-accent" />
              LaTeX keyboard
            </span>
            <ChevronDown size={13} className={`text-dim transition-transform ${kbOpen ? "" : "-rotate-90"}`} />
          </button>
          {kbOpen && (
            <div className="grid grid-cols-4 gap-1.5 px-3 pb-3">
              {LATEX_PRESETS.map((p) => (
                <button
                  key={p.id}
                  onClick={() => insert(p.insert)}
                  className="rounded border border-edge bg-raise px-2 py-1.5 text-center text-[11.5px] text-mut transition-colors hover:bg-white/[0.07] hover:text-fg"
                >
                  {p.label}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="mt-3 flex min-h-0 flex-1 flex-col rounded-md border border-edge bg-ink/60">
          <div className="flex items-center justify-between border-b border-edge px-3 py-1.5">
            <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-dim">
              <Type size={11} />
              Your proof
            </span>
            <span className="flex items-center gap-2 font-mono text-[10px] text-dim">
              <button
                onClick={() => setFontSize((s) => Math.max(11, s - 1))}
                className="grid h-5 w-5 place-items-center rounded hover:bg-white/[0.07]"
              >
                <Minimize2 size={10} />
              </button>
              {fontSize}px
              <button
                onClick={() => setFontSize((s) => Math.min(22, s + 1))}
                className="grid h-5 w-5 place-items-center rounded hover:bg-white/[0.07]"
              >
                <Maximize2 size={10} />
              </button>
            </span>
          </div>
          <textarea
            ref={taRef}
            value={answer}
            onChange={(e) => onChange(e.target.value)}
            placeholder="Type your proof here. Use the LaTeX keyboard for equations."
            className="min-h-[180px] flex-1 resize-none bg-transparent px-3 py-2.5 font-mono leading-relaxed text-fg outline-none placeholder:text-faint"
            style={{ fontSize }}
          />
        </div>
      </div>

      <div className="flex min-h-0 flex-col rounded-md border border-edge bg-card">
        <div className="flex items-center justify-between border-b border-edge px-3 py-2">
          <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-dim">
            <PenLine size={11} className="text-accent" />
            Live preview
          </span>
          <span className="rounded-full bg-accent/15 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-accent">
            KaTeX
          </span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {answer.trim() ? (
            <RenderedProof text={answer} />
          ) : (
            <p className="font-mono text-[11.5px] text-faint">
              Your typeset answer will appear here as you type.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function RenderedProof({ text }: { text: string }) {
  const parts = splitMathAndText(text);
  return (
    <div className="space-y-3 text-[14px] leading-relaxed text-fg/90">
      {parts.map((part, i) =>
        part.kind === "math" ? (
          <div key={i} className="rounded-md bg-black/20 p-2.5 text-center">
            <Katex math={part.value} />
          </div>
        ) : part.value.trim() ? (
          <p key={i} className="whitespace-pre-wrap">{part.value}</p>
        ) : null
      )}
    </div>
  );
}

function splitMathAndText(text: string): { kind: "text" | "math"; value: string }[] {
  const out: { kind: "text" | "math"; value: string }[] = [];
  const re = /(\$\$[^$]+\$|\$[^$]+\$|\\\[[\s\S]*?\\\])/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push({ kind: "text", value: text.slice(last, m.index) });
    let raw = m[0];
    if (raw.startsWith("$$")) raw = raw.slice(2, -2);
    else if (raw.startsWith("\\[")) raw = raw.slice(2, -2);
    else if (raw.startsWith("$")) raw = raw.slice(1, -1);
    out.push({ kind: "math", value: raw });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ kind: "text", value: text.slice(last) });
  return out;
}

function Katex({ math }: { math: string }) {
  const html = useMemo(() => {
    try {
      return katex.renderToString(math, { throwOnError: false, displayMode: true });
    } catch {
      return math;
    }
  }, [math]);
  return <div className="katex-chalk" dangerouslySetInnerHTML={{ __html: html }} />;
}

/* ── Submitted view consuming Authoritative DTO ── */

function SubmittedView({
  result,
  onRetake,
  onExit,
  time,
}: {
  result: AttemptResultDTO;
  onRetake: () => void;
  onExit: () => void;
  time: number;
}) {
  const total = result.totalPossibleMarks;
  const score = result.aggregateScore;
  const mm = String(Math.floor(time / 60)).padStart(2, "0");
  const ss = String(time % 60).padStart(2, "0");

  return (
    <div className="mx-auto w-full max-w-[860px] px-5 pt-10 pb-20 select-none">
      <div className="mb-2 font-mono text-[10px] uppercase tracking-wider text-dim">Authoritative Evaluation</div>
      <h1 className="mb-1 text-[40px] font-bold leading-tight text-fg tabular-nums">
        {score} <span className="text-[20px] text-dim">/ {total}</span>
      </h1>
      <p className="mb-6 text-[13.5px] text-dim">
        Criterion-referenced result evaluated deterministically by backend. Demonstrated criterion mastery.
      </p>

      <div className="mb-6 grid grid-cols-3 gap-3">
        {[
          { label: "Grading Status", val: result.status, color: "text-fg" },
          { label: "Completion Time", val: `${mm}:${ss}`, color: "text-[#fcd34d]" },
          { label: "Demonstrated Score", val: `${score}/${total}`, color: "text-[#86efac]" },
        ].map((m) => (
          <div key={m.label} className="rounded-md border border-edge bg-raise p-3">
            <div className={`text-[18px] font-semibold capitalize ${m.color}`}>{m.val}</div>
            <div className="text-[11px] text-dim">{m.label}</div>
          </div>
        ))}
      </div>

      <div className="mb-6 overflow-hidden rounded-md border border-edge">
        {result.questions.map((q, i) => (
          <div key={q.itemId} className={i > 0 ? "border-t border-edge-soft" : ""}>
            <div className="flex items-start gap-3 px-4 py-3">
              <span className="w-7 shrink-0 font-mono text-[12px] text-dim">{String(i + 1).padStart(2, "0")}</span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] text-fg">{q.stem}</div>
                <div className="mt-1 font-mono text-[10.5px] text-dim">
                  Committed: {q.committedResponse || "blank"}
                </div>
                {q.criteria.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {q.criteria.map((c) => (
                      <div key={c.criterionId} className="flex items-center justify-between text-[11px] text-dim bg-black/20 px-2 py-1 rounded">
                        <span>Criterion [{c.criterionId}]: {c.rationale}</span>
                        <span className="font-mono text-fg font-medium">{c.awardedMark}/{c.maximumMark}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <span className="shrink-0 font-mono text-[13px] font-semibold text-[#86efac]">
                {q.awardedMarks}/{q.maximumMarks}
              </span>
            </div>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={onRetake}
          className="rounded-md bg-accent px-3.5 py-2 text-[13px] font-medium text-white transition-colors hover:bg-accent-deep"
        >
          Retake exam
        </button>
        <button
          onClick={onExit}
          className="rounded-md border border-edge bg-raise px-3.5 py-2 text-[13px] text-mut transition-colors hover:bg-white/[0.07] hover:text-fg"
        >
          Back to dashboard
        </button>
      </div>
    </div>
  );
}