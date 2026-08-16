import { useEffect, useMemo, useRef, useState } from "react";
import katex from "katex";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowDown,
  Check,
  Type,
  Maximize2,
  Minimize2,
  ChevronDown,
  PenLine,
  Sigma,
  Save,
  AlertCircle,
  AlertTriangle,
  Lightbulb,
} from "lucide-react";
import {
  getAttemptForTaking,
  beginAttempt,
  createRetakeAttempt,
  autosaveDraft,
  submitAttempt,
  getAttemptResult,
  AttemptForTakingDTO,
  AttemptResultDTO,
} from "../../api";
import type { VisualizationIntent } from "../../lib/visualization/types";
import { AssessmentFigure } from "./AssessmentFigure";

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
  figure?: VisualizationIntent;
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
  const examScrollRef = useRef<HTMLDivElement>(null);
  const [scrollAvailability, setScrollAvailability] = useState({ up: false, down: false });
  const [time, setTime] = useState(0);

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
    setTime(0);
  }, [attemptId]);

  /* Load the real attempt: items, drafts and flags all come from SQLite. A
     finished attempt loads its immutable receipt instead of briefly reopening
     an editable exam. */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const d = await getAttemptForTaking(runnerAttemptId);
        if (cancelled) return;
        if (!d || d.questions.length === 0) {
          setLoadError("This attempt holds no questions.");
          return;
        }

        const finished = d.status === "completed" || d.status === "grading_blocked";
        const storedResult = finished ? await getAttemptResult(runnerAttemptId) : null;
        if (cancelled) return;

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
        setSubmissionResult(storedResult);
        setDto(d);
      } catch {
        if (!cancelled) setLoadError("Could not load the attempt.");
      }
    })();
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
        figure: q.figure,
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
    if (!dto?.startedAt) return;

    if (submissionResult) {
      if (submissionResult.durationSeconds !== null) {
        setTime(submissionResult.durationSeconds);
        return;
      }
      const completedMs = submissionResult.completedAt
        ? new Date(submissionResult.completedAt).getTime()
        : Number.NaN;
      const startedMs = new Date(submissionResult.startedAt).getTime();
      if (Number.isFinite(startedMs) && Number.isFinite(completedMs)) {
        setTime(Math.max(0, Math.floor((completedMs - startedMs) / 1000)));
      }
      return;
    }

    const startedMs = new Date(dto.startedAt).getTime();
    if (!Number.isFinite(startedMs)) return;
    const update = () => setTime(Math.max(0, Math.floor((Date.now() - startedMs) / 1000)));
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [dto?.startedAt, submissionResult]);

  // Fullscreen exam mode intentionally hides the app shell's scroller. Give the
  // runner its own persistent scroll region and keep explicit up/down controls
  // in sync as proof editors, keyboards, and previews change height.
  useEffect(() => {
    const container = examScrollRef.current;
    if (!container || !dto || submissionResult) return;

    let animationFrame = 0;
    const updateAvailability = () => {
      const next = {
        up: container.scrollTop > 2,
        down: container.scrollTop + container.clientHeight < container.scrollHeight - 2,
      };
      setScrollAvailability((current) =>
        current.up === next.up && current.down === next.down ? current : next
      );
    };

    animationFrame = window.requestAnimationFrame(updateAvailability);
    container.addEventListener("scroll", updateAvailability, { passive: true });
    window.addEventListener("resize", updateAvailability);

    const resizeObserver = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(updateAvailability);
    resizeObserver?.observe(container);
    if (container.firstElementChild) resizeObserver?.observe(container.firstElementChild);

    return () => {
      window.cancelAnimationFrame(animationFrame);
      container.removeEventListener("scroll", updateAvailability);
      window.removeEventListener("resize", updateAvailability);
      resizeObserver?.disconnect();
    };
  }, [dto, submissionResult]);

  useEffect(() => {
    examScrollRef.current?.scrollTo({ top: 0 });
  }, [index, runnerAttemptId]);

  const scrollExam = (direction: "up" | "down") => {
    const container = examScrollRef.current;
    if (!container) return;
    const distance = Math.max(320, Math.round(container.clientHeight * 0.72));
    container.scrollBy({
      top: direction === "up" ? -distance : distance,
      behavior: "smooth",
    });
  };

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
      onNotify(
        res.gradingStatus === "grading_blocked"
          ? "Exam submitted · Some answers need review"
          : `Exam submitted · Final score: ${res.aggregateScore}/${res.totalPossibleMarks}`
      );
    } catch (err) {
      onNotify(err instanceof Error ? err.message : "Submission error. Attempt recorded as retryable.");
    }
  };

  const startRetake = async () => {
    try {
      const nextAttemptId = await createRetakeAttempt(runnerAttemptId);
      await beginAttempt(nextAttemptId);
      pendingDraftsRef.current.clear();
      setDto(null);
      setLoadError(null);
      setIndex(0);
      setAnswers({});
      setSubmissionResult(null);
      setHintedItems(new Set());
      questionFlagsRef.current = {};
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
      />
    );
  }

  return (
    <>
      <div
        ref={examScrollRef}
        className="h-screen w-full overflow-y-scroll overscroll-contain [scrollbar-gutter:stable]"
      >
        <div className="mx-auto w-full max-w-[1100px] pt-6 pr-16 pb-24 pl-5 select-none xl:px-5">
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

      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_280px]">
        {/* question pane */}
        <div className="flex min-w-0 flex-col rounded-lg border border-edge bg-raise p-5">
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
        <aside className="flex min-w-0 flex-col gap-4">
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
      </div>

      <div
        className="fixed right-3 top-1/2 z-[70] flex -translate-y-1/2 flex-col overflow-hidden rounded-lg border border-edge bg-[#222224]/95 shadow-xl backdrop-blur sm:right-5"
        aria-label="Exam page scrolling controls"
      >
        <button
          type="button"
          onClick={() => scrollExam("up")}
          disabled={!scrollAvailability.up}
          aria-label="Scroll exam up"
          title="Scroll up"
          className="grid h-10 w-10 place-items-center border-b border-edge text-fg transition-colors hover:bg-white/[0.09] disabled:cursor-not-allowed disabled:text-faint disabled:opacity-45"
        >
          <ArrowUp size={17} />
        </button>
        <button
          type="button"
          onClick={() => scrollExam("down")}
          disabled={!scrollAvailability.down}
          aria-label="Scroll exam down"
          title="Scroll down"
          className="grid h-10 w-10 place-items-center text-fg transition-colors hover:bg-white/[0.09] disabled:cursor-not-allowed disabled:text-faint disabled:opacity-45"
        >
          <ArrowDown size={17} />
        </button>
      </div>
    </>
  );
}

export function QuestionPrompt({ stem, figure }: { stem: string; figure?: VisualizationIntent }) {
  return (
    <div className="min-w-0 max-w-full">
      <h2 className="break-words text-[24px] font-semibold leading-snug text-fg">{stem}</h2>
      {figure && <AssessmentFigure intent={figure} />}
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
      <QuestionPrompt stem={q.stem} figure={q.figure} />
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
      <QuestionPrompt stem={q.stem} figure={q.figure} />
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
  { id: "pow", label: "x²", insert: "x^{2}" },
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
    const start = el?.selectionStart ?? answer.length;
    const end = el?.selectionEnd ?? answer.length;
    const prefix = answer.slice(0, start);
    const unescapedPrefix = prefix.replace(/\\\$/g, "");
    const dollarMarkers = unescapedPrefix.match(/\$\$|\$/g) ?? [];
    const insideDollarMath = dollarMarkers.length % 2 === 1;
    const insideDisplayMath = prefix.lastIndexOf("\\[") > prefix.lastIndexOf("\\]");
    const insertion = insideDollarMath || insideDisplayMath ? snippet : `$${snippet}$`;
    const next = answer.slice(0, start) + insertion + answer.slice(end);
    onChange(next);
    requestAnimationFrame(() => {
      el?.focus();
      const cursor = start + insertion.length;
      el?.setSelectionRange(cursor, cursor);
    });
  };

  return (
    <div className="min-w-0">
      <QuestionPrompt stem={q.stem} figure={q.figure} />
      {q.responseRequirement && (
        <div className="mt-3 rounded-md border border-dashed border-accent/40 bg-accent/[0.04] px-3 py-2">
          <div className="mb-0.5 font-mono text-[10px] uppercase tracking-wider text-accent">Requirement</div>
          <p className="text-[12.5px] text-fg/90">{q.responseRequirement}</p>
        </div>
      )}
      <QuestionHint {...hint} />

      {/* The keyboard owns a full-width row. Keeping it out of the answer and
          preview layout prevents its contents from overflowing a compressed
          grid track on shorter screens. */}
      <section className="mt-5 overflow-hidden rounded-lg border border-edge bg-card">
        <button
          type="button"
          onClick={() => setKbOpen((value) => !value)}
          aria-expanded={kbOpen}
          className="flex w-full items-center justify-between px-4 py-3 text-left transition-colors hover:bg-white/[0.025]"
        >
          <span>
            <span className="flex items-center gap-2 text-[12.5px] font-semibold text-fg">
              <Sigma size={14} className="text-accent" />
              LaTeX keyboard
            </span>
            <span className="mt-0.5 block pl-[22px] text-[11px] text-dim">
              Insert mathematical notation at the cursor
            </span>
          </span>
          <ChevronDown
            size={14}
            className={`shrink-0 text-dim transition-transform ${kbOpen ? "" : "-rotate-90"}`}
          />
        </button>
        {kbOpen && (
          <div className="border-t border-edge-soft px-4 py-4">
            <div className="grid grid-cols-4 gap-2 sm:grid-cols-8">
              {LATEX_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => insert(preset.insert)}
                  className="grid min-h-10 place-items-center rounded-md border border-edge bg-raise px-2 py-2 text-center text-[12px] text-mut transition-colors hover:border-accent/40 hover:bg-white/[0.07] hover:text-fg"
                  title={`Insert ${preset.insert}`}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* The editable answer is a second independent full-width region. It has
          an explicit natural height and can grow, rather than being forced into
          the remaining pixels of a viewport-height flex container. */}
      <section className="mt-4 overflow-hidden rounded-lg border border-edge bg-ink/60">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-edge px-4 py-2.5">
          <span className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-wider text-dim">
            <Type size={12} className="text-accent" />
            Your proof answer
          </span>
          <span className="flex items-center gap-2 font-mono text-[10px] text-dim">
            <button
              type="button"
              onClick={() => setFontSize((size) => Math.max(11, size - 1))}
              className="grid h-6 w-6 place-items-center rounded hover:bg-white/[0.07] hover:text-fg"
              aria-label="Decrease answer font size"
            >
              <Minimize2 size={11} />
            </button>
            {fontSize}px
            <button
              type="button"
              onClick={() => setFontSize((size) => Math.min(22, size + 1))}
              className="grid h-6 w-6 place-items-center rounded hover:bg-white/[0.07] hover:text-fg"
              aria-label="Increase answer font size"
            >
              <Maximize2 size={11} />
            </button>
          </span>
        </div>
        <textarea
          ref={taRef}
          value={answer}
          onChange={(event) => onChange(event.target.value)}
          placeholder="Write your complete proof here. Use $...$ or \\[...\\] around LaTeX expressions."
          className="block min-h-[240px] w-full resize-y bg-transparent px-4 py-3.5 font-mono leading-relaxed text-fg outline-none placeholder:text-faint"
          style={{ fontSize }}
        />
      </section>

      {/* Rendered output gets its own wide row below the editor. */}
      <section className="mt-4 overflow-hidden rounded-lg border border-edge bg-card">
        <div className="flex items-center justify-between border-b border-edge px-4 py-2.5">
          <span className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-wider text-dim">
            <PenLine size={12} className="text-accent" />
            Typeset answer output
          </span>
          <span className="rounded-full bg-accent/15 px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-accent">
            KaTeX
          </span>
        </div>
        <div className="min-h-[160px] overflow-x-auto px-4 py-4">
          {answer.trim() ? (
            <RenderedProof text={answer} />
          ) : (
            <p className="font-mono text-[11.5px] text-faint">
              Your typeset proof will appear in this dedicated output area as you type.
            </p>
          )}
        </div>
      </section>
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
  const re = /(\$\$[\s\S]*?\$\$|\$[^$\n]+?\$|\\\[[\s\S]*?\\\])/g;
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

export function formatAttemptDuration(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) return "—";
  const wholeSeconds = Math.floor(seconds);
  const hours = Math.floor(wholeSeconds / 3600);
  const minutes = Math.floor((wholeSeconds % 3600) / 60);
  const remainder = wholeSeconds % 60;
  if (hours > 0) {
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
  }
  return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

export function SubmittedView({
  result,
  onRetake,
  onExit,
}: {
  result: AttemptResultDTO;
  onRetake: () => void;
  onExit: () => void;
}) {
  const total = result.totalPossibleMarks;
  const score = result.aggregateScore;
  const gradingBlocked = result.gradingStatus === "grading_blocked"
    || result.questions.some((question) => question.gradingStatus === "grading_blocked");
  const completionTime = formatAttemptDuration(result.durationSeconds);

  return (
    <div className="h-screen w-full overflow-y-auto overscroll-contain [scrollbar-gutter:stable]">
      <div className="sticky top-0 z-30 border-b border-edge bg-[#181819]/95 backdrop-blur">
        <div className="mx-auto flex w-full max-w-[860px] items-center justify-between gap-3 px-5 py-3">
          <button
            type="button"
            onClick={onExit}
            className="flex items-center gap-1.5 rounded-md border border-edge bg-raise px-3 py-1.5 text-[12.5px] text-mut transition-colors hover:bg-white/[0.08] hover:text-fg"
          >
            <ArrowLeft size={13} />
            Back to Available tests
          </button>
          <span className="font-mono text-[10px] uppercase tracking-wider text-dim">Submission receipt</span>
        </div>
      </div>

      <main className="mx-auto w-full max-w-[860px] px-5 pb-20 pt-8 select-none">
        <div className="mb-2 font-mono text-[10px] uppercase tracking-wider text-dim">Authoritative Evaluation</div>
        <h1 className="mb-1 text-[40px] font-bold leading-tight text-fg tabular-nums">
          {score} <span className="text-[20px] text-dim">/ {total}</span>
        </h1>
        <p className="mb-6 text-[13.5px] text-dim">
          {gradingBlocked
            ? "Your submission is complete. Reliably graded marks are shown below; held answers are not counted as wrong."
            : "Criterion-referenced result evaluated by the assessment backend."}
        </p>

        <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
          {[
            {
              label: "Grading Status",
              val: gradingBlocked ? "Needs review" : "Graded",
              color: gradingBlocked ? "text-[#fcd34d]" : "text-[#86efac]",
            },
            { label: "Completion Time", val: completionTime, color: "text-[#fcd34d]" },
            {
              label: gradingBlocked ? "Scored Marks" : "Demonstrated Score",
              val: `${score}/${total}`,
              color: gradingBlocked ? "text-fg" : "text-[#86efac]",
            },
          ].map((metric) => (
            <div key={metric.label} className="rounded-md border border-edge bg-raise p-3">
              <div className={`text-[18px] font-semibold ${metric.color}`}>{metric.val}</div>
              <div className="text-[11px] text-dim">{metric.label}</div>
            </div>
          ))}
        </div>

        {gradingBlocked && (
          <div className="mb-6 flex items-start gap-3 rounded-lg border border-[#fcd34d]/30 bg-[#fcd34d]/[0.06] px-4 py-3">
            <AlertTriangle size={17} className="mt-0.5 shrink-0 text-[#fcd34d]" />
            <div>
              <div className="text-[13px] font-semibold text-fg">What “Needs review” means</div>
              <p className="mt-0.5 text-[12.5px] leading-relaxed text-dim">
                Grading blocked is a real safety state, not a placeholder. At least one answer could not be graded reliably—for example, the evaluator was unavailable or an answer key was missing. Studyus holds that answer for review instead of guessing a mark.
              </p>
            </div>
          </div>
        )}

        <div className="mb-6 overflow-hidden rounded-md border border-edge">
          {result.questions.map((question, index) => {
            const heldForReview = question.gradingStatus === "grading_blocked";
            const fullMarks = question.awardedMarks >= question.maximumMarks;
            return (
              <section key={question.itemId} className={index > 0 ? "border-t border-edge-soft" : ""}>
                <div className="flex items-start gap-3 px-4 py-4">
                  <span className="w-7 shrink-0 font-mono text-[12px] text-dim">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="break-words text-[13px] leading-relaxed text-fg">{question.stem}</div>
                    {question.figure && <AssessmentFigure intent={question.figure} />}
                    <div className="mt-2 rounded-md bg-black/20 px-2.5 py-2">
                      <div className="font-mono text-[9.5px] uppercase tracking-wider text-faint">Your submitted answer</div>
                      <div className="mt-1 whitespace-pre-wrap break-words text-[12px] leading-relaxed text-dim">
                        {question.committedResponse || "Blank"}
                      </div>
                    </div>
                    {question.criteria.length > 0 && (
                      <div className="mt-2 space-y-1.5">
                        {question.criteria.map((criterion) => (
                          <div
                            key={criterion.criterionId}
                            className="flex items-start justify-between gap-3 rounded bg-black/20 px-2.5 py-2 text-[11px] text-dim"
                          >
                            <span className="min-w-0 break-words leading-relaxed">
                              Criterion [{criterion.criterionId}]: {criterion.rationale}
                            </span>
                            {!heldForReview && (
                              <span className="shrink-0 font-mono font-medium text-fg">
                                {criterion.awardedMark}/{criterion.maximumMark}
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                    {heldForReview && question.criteria.length === 0 && (
                      <p className="mt-2 rounded bg-[#fcd34d]/[0.06] px-2.5 py-2 text-[11.5px] text-[#fcd34d]">
                        No reliable automatic evaluation was recorded for this answer.
                      </p>
                    )}
                  </div>
                  {heldForReview ? (
                    <span className="shrink-0 rounded-full bg-[#fcd34d]/15 px-2 py-1 font-mono text-[9.5px] text-[#fcd34d]">
                      Needs review
                    </span>
                  ) : (
                    <span className={`shrink-0 font-mono text-[13px] font-semibold ${fullMarks ? "text-[#86efac]" : "text-[#fca5a5]"}`}>
                      {question.awardedMarks}/{question.maximumMarks}
                    </span>
                  )}
                </div>
              </section>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-2">
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
            Back to Available tests
          </button>
        </div>
      </main>
    </div>
  );
}
