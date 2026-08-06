/**
 * TestRunner — Agentic Assessment Interface
 *
 * Manages the full attempt lifecycle:
 *   1. Create attempt from a validated form
 *   2. Present questions with autosave
 *   3. Commit answers and submit
 *   4. Deterministic/rubric grading
 *   5. Display criterion-level results
 *
 * Key properties:
 *   - Attempts survive reloads (persisted to localStorage)
 *   - Timer is authoritative (deadline computed from persisted state)
 *   - Submission is idempotent
 *   - Grader failures never silently award zero
 *   - Answer keys shown only after completion
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import katex from "katex";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Flag,
  Clock,
  Type,
  Maximize2,
  Minimize2,
  ChevronDown,
  PenLine,
  Sigma,
  AlertTriangle,
  RotateCcw,
  Eye,
} from "lucide-react";
import type {
  AssessmentAttempt,
  AssessmentForm,
  AssessmentItem,
  AttemptResponse,
  AttemptParams,
  CriterionScore,
  SubjectKey,
} from "../../assessment/types";
import {
  createAttempt,
  saveResponse,
  flagResponse,
  markSeen,
  submitAttemptForGrading,
  retryGrading,
  loadAttempts,
  loadForm,
  saveDraft,
  saveForm,
} from "../../assessment";
import { gradeResponse } from "../../assessment/grader";
import { remainingSeconds, isExpired } from "../../assessment/stateMachine";
import { generateForm, defaultBloomTarget } from "../../assessment/generator";
import type { QuestionFormat, Rigor } from "../../data/curriculum";

// ─── LaTeX keyboard presets ─────────────────────────────────────────────────

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

interface Props {
  subject: SubjectKey;
  format: QuestionFormat;
  count: number;
  rigor: Rigor;
  docs: { id: string; name: string }[];
  docId: string | null;
  selected: string[];
  onExit: () => void;
  onNotify: (t: string) => void;
}

export function TestRunner({
  subject,
  format,
  count,
  rigor,
  selected,
  onExit,
  onNotify,
}: Props) {
  const [attempt, setAttempt] = useState<AssessmentAttempt | null>(null);
  const [form, setForm] = useState<AssessmentForm | null>(null);
  const [index, setIndex] = useState(0);
  const [time, setTime] = useState(0);
  const [showSubmitConfirm, setShowSubmitConfirm] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"saved" | "saving" | "error">("saved");
  const [initialized, setInitialized] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const startTimeRef = useRef(Date.now());
  const saveTimerRef = useRef<number | null>(null);

  // ─── Initialize attempt ─────────────────────────────────────────────────
  useEffect(() => {
    if (initialized) return;
    setInitialized(true);

    // Check for existing active attempt for this subject
    const allAttempts = loadAttempts();
    const existing = allAttempts.find(
      (a) => (a.status === "active" || a.status === "created") && a.params.subject === subject,
    );

    if (existing) {
      const existingForm = loadForm(existing.formId);
      if (existingForm) {
        setAttempt(existing);
        setForm(existingForm);
        setIndex(existing.currentIndex);
        startTimeRef.current = existing.startedAt;
        onNotify("Resumed previous attempt");
        return;
      }
    }

    // Map format to question types
    const questionTypes: ("mcq" | "proof" | "short_answer")[] =
      format === "mcq"
        ? ["mcq"]
        : format === "proof"
          ? ["proof", "short_answer"]
          : ["mcq", "proof", "short_answer"];

    // Generate new form
    const newForm = generateForm({
      subject,
      mode: "formative",
      difficulty: rigor === "casual" ? "foundational" : rigor === "challenging" ? "proficient" : "advanced",
      pickedNodes: selected,
      targetCount: count,
      questionTypes,
      bloomTarget: defaultBloomTarget(count, "formative"),
      title: `${subject} · ${format} · ${rigor}`,
    });

    if (!newForm.validated) {
      onNotify("Some items could not be validated — proceeding with available questions");
    }

    saveForm(newForm);

    // Create attempt
    const attemptParams: AttemptParams = {
      subject,
      formId: newForm.id,
      mode: "formative",
      pickedNodes: selected,
      rigor,
    };

    const assistancePolicy =
      rigor === "rigorous" ? "closed_book" : rigor === "challenging" ? "socratic" : "progressive";

    const newAttempt = createAttempt(newForm, attemptParams, assistancePolicy);

    setForm(newForm);
    setAttempt(newAttempt);
    setIndex(0);
    startTimeRef.current = newAttempt.startedAt;
    onNotify(`Test started · ${newForm.items.length} questions`);
  }, [initialized, subject, format, count, rigor, selected, onNotify]);

  // ─── Timer ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const t = window.setInterval(() => {
      setTime(Math.floor((Date.now() - startTimeRef.current) / 1000));
      if (attempt?.deadlineAt && isExpired(attempt.deadlineAt)) {
        handleAutoSubmit();
      }
    }, 1000);
    return () => window.clearInterval(t);
  }, [attempt?.deadlineAt, attempt?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Autosave ───────────────────────────────────────────────────────────
  const autosave = useCallback(
    (responses: Record<string, AttemptResponse>) => {
      if (!attempt) return;
      setSaveStatus("saving");
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = window.setTimeout(() => {
        try {
          saveDraft(attempt.id, responses);
          setSaveStatus("saved");
        } catch {
          setSaveStatus("error");
        }
      }, 500);
    },
    [attempt],
  );

  // ─── Current item ───────────────────────────────────────────────────────
  const currentItem = form?.items[index];
  const currentResponse = attempt?.responses[currentItem?.id ?? ""];

  // Mark as seen when navigating
  useEffect(() => {
    if (attempt && currentItem && (attempt.status === "active" || attempt.status === "created")) {
      const updated = markSeen(attempt.id, currentItem.id);
      setAttempt(updated);
      // Save current position
      updated.currentIndex = index;
      saveDraft(updated.id, updated.responses);
    }
  }, [index]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Handlers ───────────────────────────────────────────────────────────
  const selectMcq = useCallback(
    (optionId: string) => {
      if (!attempt || !currentItem) return;
      const updated = saveResponse(attempt.id, currentItem.id, { mcqSelection: optionId });
      setAttempt({ ...updated });
      autosave(updated.responses);
    },
    [attempt, currentItem, autosave],
  );

  const setProofText = useCallback(
    (text: string) => {
      if (!attempt || !currentItem) return;
      const updated = saveResponse(attempt.id, currentItem.id, { responseText: text });
      setAttempt({ ...updated });
      autosave(updated.responses);
    },
    [attempt, currentItem, autosave],
  );

  const toggleFlag = useCallback(() => {
    if (!attempt || !currentItem) return;
    const current = currentResponse?.flagged ?? false;
    const updated = flagResponse(attempt.id, currentItem.id, !current);
    setAttempt({ ...updated });
    onNotify(!current ? "Flagged for review" : "Unflagged");
  }, [attempt, currentItem, currentResponse, onNotify]);

  const handleAutoSubmit = useCallback(() => {
    if (!attempt || attempt.status === "completed" || attempt.status === "expired") return;
    try {
      const updated = submitAttemptForGrading(attempt.id);
      setAttempt({ ...updated });
      onNotify("Time expired — auto-submitted");
    } catch {
      // Ignore — already handled
    }
  }, [attempt, onNotify]);

  const confirmSubmit = useCallback(() => {
    if (!attempt) return;
    setShowSubmitConfirm(false);
    try {
      const updated = submitAttemptForGrading(attempt.id);
      setAttempt({ ...updated });
      onNotify("Submitted · Grading complete");
    } catch (err) {
      onNotify(`Submission error: ${err instanceof Error ? err.message : "unknown"}`);
    }
  }, [attempt, onNotify]);

  const insertLatex = useCallback(
    (snippet: string) => {
      const el = taRef.current;
      const current = currentResponse?.responseText ?? "";
      if (!el) {
        setProofText(current + snippet);
        return;
      }
      const start = el.selectionStart;
      const end = el.selectionEnd;
      const next = current.slice(0, start) + snippet + current.slice(end);
      setProofText(next);
      requestAnimationFrame(() => {
        el.focus();
        const cursor = start + snippet.length;
        el.setSelectionRange(cursor, cursor);
      });
    },
    [currentResponse, setProofText],
  );

  // ─── Computed values ────────────────────────────────────────────────────
  const answered = useMemo(() => {
    if (!attempt) return 0;
    return Object.values(attempt.responses).filter(
      (r) => r.mcqSelection || r.responseText?.trim(),
    ).length;
  }, [attempt]);

  const total = form?.items.length ?? 0;
  const showHints = rigor !== "rigorous";

  // ─── Render: loading ────────────────────────────────────────────────────
  if (!attempt || !form) {
    return (
      <div className="flex h-screen items-center justify-center bg-ink">
        <div className="text-center">
          <div className="mb-2 text-dim">Generating assessment…</div>
          <div className="font-mono text-[10px] text-faint">
            {totalBankSize()} items in bank · composing form
          </div>
        </div>
      </div>
    );
  }

  // ─── Render: completed ──────────────────────────────────────────────────
  if (attempt.status === "completed") {
    return (
      <CompletedView
        attempt={attempt}
        form={form}
        onExit={onExit}
        onRetake={() => window.location.reload()}
      />
    );
  }

  // ─── Render: grading blocked ────────────────────────────────────────────
  if (attempt.status === "grading_blocked") {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-4 bg-ink">
        <AlertTriangle size={48} className="text-[#fcd34d]" />
        <h2 className="text-2xl font-bold text-fg">Grading blocked</h2>
        <p className="max-w-md text-center text-dim">
          An error occurred during grading. Your answers are saved and your score
          is not affected.
        </p>
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              try {
                const updated = retryGrading(attempt.id);
                setAttempt({ ...updated });
                onNotify("Grading retried");
              } catch (err) {
                onNotify(`Retry failed: ${err instanceof Error ? err.message : "unknown"}`);
              }
            }}
            className="flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-white"
          >
            <RotateCcw size={14} />
            Retry grading
          </button>
          <button onClick={onExit} className="text-dim hover:text-fg">
            Back to dashboard
          </button>
        </div>
      </div>
    );
  }

  // ─── Render: submit confirmation ────────────────────────────────────────
  if (showSubmitConfirm) {
    const unanswered = total - answered;
    const flagged = Object.values(attempt.responses).filter((r) => r.flagged).length;
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
        <div className="w-[400px] rounded-xl border border-edge bg-panel p-6 shadow-2xl">
          <h3 className="mb-3 text-lg font-bold text-fg">Submit exam?</h3>
          <div className="mb-4 space-y-1 text-[13px] text-dim">
            <p>
              <span className="text-fg">{answered}</span>/{total} questions answered
            </p>
            {unanswered > 0 && <p className="text-[#fca5a5]">{unanswered} unanswered</p>}
            {flagged > 0 && <p className="text-[#fcd34d]">{flagged} flagged for review</p>}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={confirmSubmit}
              className="flex-1 rounded-md bg-accent py-2 text-sm font-medium text-white hover:bg-accent-deep"
            >
              Submit
            </button>
            <button
              onClick={() => setShowSubmitConfirm(false)}
              className="flex-1 rounded-md border border-edge py-2 text-sm text-mut hover:text-fg"
            >
              Continue
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ─── Render: active attempt ─────────────────────────────────────────────
  const remaining = remainingSeconds(attempt.deadlineAt);

  return (
    <div className="mx-auto flex h-[calc(100vh-72px)] w-full max-w-[1100px] flex-col px-5 pt-6">
      {/* header */}
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={onExit}
            className="grid h-8 w-8 place-items-center rounded-md border border-edge bg-raise text-mut transition-colors hover:bg-white/[0.07] hover:text-fg"
            title="Back"
          >
            <ArrowLeft size={14} />
          </button>
          <span className="rounded-full border border-edge bg-raise px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-mut">
            Practice Test
          </span>
          <span className="rounded-full bg-accent/15 px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-accent">
            {rigor}
          </span>
          <SaveIndicator status={saveStatus} />
        </div>
        <div className="flex items-center gap-3">
          {remaining !== null ? (
            <span className={`font-mono text-[12px] ${remaining < 60 ? "text-[#fca5a5]" : "text-dim"}`}>
              <Clock size={12} className="mr-1 inline" />
              {formatTime(remaining)}
            </span>
          ) : (
            <span className="font-mono text-[12px] text-dim">{formatTime(time)}</span>
          )}
          <button
            onClick={() => setShowSubmitConfirm(true)}
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
            <span>
              QUESTION {String(index + 1).padStart(2, "0")} · {String(total).padStart(2, "0")}
            </span>
            <div className="flex items-center gap-2">
              {currentItem && <BloomBadge level={currentItem.bloomLevel} />}
              <span>
                {currentItem?.type === "proof"
                  ? "Proof-based"
                  : currentItem?.type === "mcq"
                    ? "Multiple choice"
                    : "Short answer"}
              </span>
              <span className="text-accent">{currentItem?.marks} marks</span>
            </div>
          </div>

          {currentItem && currentItem.type === "mcq" ? (
            <McqQuestion
              q={currentItem}
              selected={currentResponse?.mcqSelection}
              onSelect={selectMcq}
              showHints={showHints}
            />
          ) : currentItem && (currentItem.type === "proof" || currentItem.type === "short_answer") ? (
            <ProofQuestion
              q={currentItem}
              answer={currentResponse?.responseText ?? ""}
              onChange={setProofText}
              showHints={showHints}
              taRef={taRef}
              insertLatex={insertLatex}
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
            <div className="flex items-center gap-3">
              <button
                onClick={toggleFlag}
                className={`flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] transition-colors ${
                  currentResponse?.flagged
                    ? "border-[#fcd34d] bg-[#fcd34d]/10 text-[#fcd34d]"
                    : "border-edge text-dim hover:text-fg"
                }`}
              >
                <Flag size={11} />
                {currentResponse?.flagged ? "Flagged" : "Flag"}
              </button>
              <span className="font-mono text-[11px] text-dim">
                {answered}/{total} answered
              </span>
            </div>
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
              {form.items.map((item, i) => {
                const r = attempt.responses[item.id];
                const done = r?.mcqSelection || r?.responseText?.trim();
                const flagged = r?.flagged;
                return (
                  <button
                    key={item.id}
                    onClick={() => setIndex(i)}
                    className={`grid h-7 place-items-center rounded font-mono text-[11px] transition-colors ${
                      i === index
                        ? "bg-accent text-white"
                        : flagged
                          ? "bg-[#fcd34d]/15 text-[#fcd34d] hover:bg-[#fcd34d]/25"
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
            <div className="mb-2 font-mono text-[10px] uppercase tracking-wider text-dim">Form</div>
            <p className="text-[12px] text-fg">{form.title}</p>
            <p className="mt-1 font-mono text-[10.5px] text-dim">
              {selected.length} concept{selected.length === 1 ? "" : "s"} · {format} · {rigor}
            </p>
            <div className="mt-2 space-y-1">
              {Object.entries(form.bloomComposition)
                .filter(([, n]) => n > 0)
                .map(([level, n]) => (
                  <div key={level} className="flex items-center justify-between text-[10.5px]">
                    <span className="capitalize text-dim">{level}</span>
                    <span className="text-fg">{n}</span>
                  </div>
                ))}
            </div>
          </div>
          <div className="rounded-lg border border-edge bg-raise p-3">
            <div className="mb-2 font-mono text-[10px] uppercase tracking-wider text-dim">
              Scoring note
            </div>
            <p className="text-[10.5px] leading-snug text-dim">
              Scores are formative and criterion-referenced. They describe demonstrated
              mastery, not psychometric ability estimates.
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// MCQ Question Component
// ═══════════════════════════════════════════════════════════════════════════════

function McqQuestion({
  q,
  selected,
  onSelect,
  showHints,
}: {
  q: AssessmentItem;
  selected?: string;
  onSelect: (id: string) => void;
  showHints: boolean;
}) {
  return (
    <div>
      <h2 className="text-[22px] font-semibold leading-snug text-fg">{q.stem}</h2>
      {showHints && q.hint && <p className="mt-2 text-[12.5px] text-dim">Hint · {q.hint}</p>}
      <div className="mt-5 space-y-2.5">
        {q.mcqOptions?.map((opt) => {
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
        })}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Proof / Short-answer Question Component
// ═══════════════════════════════════════════════════════════════════════════════

function ProofQuestion({
  q,
  answer,
  onChange,
  showHints,
  taRef,
  insertLatex,
}: {
  q: AssessmentItem;
  answer: string;
  onChange: (v: string) => void;
  showHints: boolean;
  taRef: React.RefObject<HTMLTextAreaElement | null>;
  insertLatex: (s: string) => void;
}) {
  const [fontSize, setFontSize] = useState(15);
  const [kbOpen, setKbOpen] = useState(true);

  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 xl:grid-cols-[1fr_1.1fr]">
      {/* left: question + composer */}
      <div className="flex min-h-0 flex-col">
        <h2 className="text-[22px] font-semibold leading-snug text-fg">{q.stem}</h2>
        {q.rubric && (
          <div className="mt-3 rounded-md border border-dashed border-accent/40 bg-accent/[0.04] px-3 py-2">
            <div className="mb-1 font-mono text-[10px] uppercase tracking-wider text-accent">
              Rubric · {q.rubric.criteria.length} criteria · {q.rubric.totalMarks} marks
            </div>
            <ul className="space-y-0.5">
              {q.rubric.criteria.map((c) => (
                <li key={c.id} className="text-[11.5px] text-fg/80">
                  · {c.label} ({c.maxMarks} marks) — {c.description}
                </li>
              ))}
            </ul>
          </div>
        )}
        {showHints && q.hint && <p className="mt-2 text-[12.5px] text-dim">Hint · {q.hint}</p>}

        {/* LaTeX keyboard */}
        <div className="mt-4 rounded-md border border-edge bg-card">
          <button
            onClick={() => setKbOpen((v) => !v)}
            className="flex w-full items-center justify-between px-3 py-2 text-left"
          >
            <span className="flex items-center gap-1.5 text-[11.5px] font-medium text-fg">
              <Sigma size={12} className="text-accent" />
              LaTeX keyboard
            </span>
            <ChevronDown
              size={13}
              className={`text-dim transition-transform ${kbOpen ? "" : "-rotate-90"}`}
            />
          </button>
          {kbOpen && (
            <div className="grid grid-cols-4 gap-1.5 px-3 pb-3">
              {LATEX_PRESETS.map((p) => (
                <button
                  key={p.id}
                  onClick={() => insertLatex(p.insert)}
                  className="rounded border border-edge bg-raise px-2 py-1.5 text-center text-[11.5px] text-mut transition-colors hover:bg-white/[0.07] hover:text-fg"
                >
                  {p.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* answer field */}
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

      {/* right: live preview */}
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
        <div className="flex items-center justify-between border-t border-edge px-3 py-2">
          <span className="font-mono text-[10px] text-dim">{answer.length} characters</span>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Completed View
// ═══════════════════════════════════════════════════════════════════════════════

function CompletedView({
  attempt,
  form,
  onExit,
  onRetake,
}: {
  attempt: AssessmentAttempt;
  form: AssessmentForm;
  onExit: () => void;
  onRetake: () => void;
}) {
  const [showAnswers, setShowAnswers] = useState(false);
  const score = attempt.totalScore ?? 0;
  const max = attempt.totalMax ?? form.totalMarks;
  const pct = max > 0 ? Math.round((score / max) * 100) : 0;
  const timeSec = attempt.submittedAt
    ? Math.floor((attempt.submittedAt - attempt.startedAt) / 1000)
    : 0;

  return (
    <div className="mx-auto w-full max-w-[860px] px-5 pt-10 pb-20">
      <div className="mb-2 font-mono text-[10px] uppercase tracking-wider text-dim">
        Exam submitted
      </div>
      <h1 className="mb-1 text-[40px] font-bold leading-tight text-fg tabular-nums">
        {score} <span className="text-[20px] text-dim">/ {max}</span>
      </h1>
      <p className="mb-6 text-[13px] text-dim">
        {pct}% · Graded against {form.items.length} items with criterion-referenced rubrics.
      </p>

      <div className="mb-6 grid grid-cols-4 gap-3">
        {[
          {
            label: "Score",
            val: `${pct}%`,
            color: pct >= 70 ? "text-[#86efac]" : pct >= 40 ? "text-[#fcd34d]" : "text-[#fca5a5]",
          },
          { label: "Time", val: formatTime(timeSec), color: "text-[#fcd34d]" },
          {
            label: "Correct",
            val: `${Object.values(attempt.responses).filter((r) => r.isCorrect).length}/${form.items.length}`,
            color: "text-[#86efac]",
          },
          {
            label: "Flagged",
            val: `${Object.values(attempt.responses).filter((r) => r.flagged).length}`,
            color: "text-[#fcd34d]",
          },
        ].map((m) => (
          <div key={m.label} className="rounded-md border border-edge bg-raise p-3">
            <div className={`text-[18px] font-semibold ${m.color}`}>{m.val}</div>
            <div className="text-[11px] text-dim">{m.label}</div>
          </div>
        ))}
      </div>

      {/* Criterion breakdown */}
      <div className="mb-4">
        <h3 className="mb-2 text-[14px] font-semibold text-fg">Criterion breakdown</h3>
        <div className="space-y-1.5">
          {form.items.map((item, i) => {
            const resp = attempt.responses[item.id];
            const result = resp ? gradeResponse(item, resp) : null;
            return (
              <div key={item.id} className="rounded-md border border-edge bg-raise px-3 py-2.5">
                <div className="flex items-start gap-3">
                  <span className="w-7 shrink-0 font-mono text-[12px] text-dim">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] text-fg">{item.stem}</div>
                    <div className="mt-0.5 flex items-center gap-2 font-mono text-[10.5px]">
                      <BloomBadge level={item.bloomLevel} />
                      <span className="text-dim">{item.type}</span>
                      {result && <OutcomeBadge outcome={result.outcome} />}
                    </div>
                    {resp?.criterionScores && resp.criterionScores.length > 0 && (
                      <div className="mt-2 space-y-1">
                        {resp.criterionScores.map((cs) => (
                          <CriterionBar key={cs.criterionId} cs={cs} />
                        ))}
                      </div>
                    )}
                    {showAnswers && item.type === "mcq" && (
                      <div className="mt-1 font-mono text-[10.5px] text-[#86efac]">
                        Correct: {item.mcqAnswerKey?.toUpperCase()}
                      </div>
                    )}
                    {result && (
                      <div className="mt-1 text-[11px] text-dim">{result.rationale}</div>
                    )}
                  </div>
                  <span className="shrink-0 font-mono text-[14px] font-semibold text-fg">
                    {resp?.score ?? 0}/{resp?.maxScore ?? item.marks}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={() => setShowAnswers(!showAnswers)}
          className="flex items-center gap-1.5 rounded-md border border-edge px-3 py-2 text-[12.5px] text-mut transition-colors hover:text-fg"
        >
          <Eye size={13} />
          {showAnswers ? "Hide" : "Show"} answer keys
        </button>
        <button
          onClick={onRetake}
          className="flex items-center gap-1.5 rounded-md bg-accent px-3.5 py-2 text-[13px] font-medium text-white transition-colors hover:bg-accent-deep"
        >
          <RotateCcw size={13} />
          Retake
        </button>
        <button
          onClick={onExit}
          className="rounded-md border border-edge px-3.5 py-2 text-[13px] text-mut transition-colors hover:text-fg"
        >
          Back to dashboard
        </button>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Utility Components
// ═══════════════════════════════════════════════════════════════════════════════

function SaveIndicator({ status }: { status: "saved" | "saving" | "error" }) {
  if (status === "error") return <span className="font-mono text-[10px] text-[#fca5a5]">Save error</span>;
  if (status === "saving") return <span className="font-mono text-[10px] text-[#fcd34d]">Saving…</span>;
  return <span className="font-mono text-[10px] text-[#86efac]">✓ Saved</span>;
}

function BloomBadge({ level }: { level: string }) {
  const colors: Record<string, string> = {
    remember: "#7dd3fc",
    understand: "#86efac",
    apply: "#fcd34d",
    analyze: "#fca5a5",
    evaluate: "#c4b5fd",
    create: "#f9a8d4",
  };
  return (
    <span
      className="rounded-full px-1.5 py-[1px] font-mono text-[9px] uppercase"
      style={{ background: `${colors[level] ?? "#fff"}22`, color: colors[level] ?? "#fff" }}
    >
      {level}
    </span>
  );
}

function OutcomeBadge({ outcome }: { outcome: string }) {
  const style: Record<string, { bg: string; fg: string }> = {
    correct: { bg: "rgba(134,239,172,0.15)", fg: "#86efac" },
    partial: { bg: "rgba(252,211,77,0.15)", fg: "#fcd34d" },
    incorrect: { bg: "rgba(252,165,165,0.15)", fg: "#fca5a5" },
    blank: { bg: "rgba(255,255,255,0.08)", fg: "#999" },
    grading_blocked: { bg: "rgba(252,211,77,0.15)", fg: "#fcd34d" },
    manual_review: { bg: "rgba(165,180,252,0.15)", fg: "#a5b4fc" },
  };
  const s = style[outcome] ?? style.blank;
  return (
    <span className="rounded-full px-1.5 py-[1px] text-[9px]" style={{ background: s.bg, color: s.fg }}>
      {outcome.replace("_", " ")}
    </span>
  );
}

function CriterionBar({ cs }: { cs: CriterionScore }) {
  const pct = cs.maxMarks > 0 ? (cs.awarded / cs.maxMarks) * 100 : 0;
  const color = pct >= 70 ? "#86efac" : pct >= 40 ? "#fcd34d" : "#fca5a5";
  return (
    <div className="flex items-center gap-2">
      <span className="w-24 truncate text-[10.5px] text-dim" title={cs.label}>
        {cs.label}
      </span>
      <div className="h-1.5 flex-1 rounded-full bg-white/[0.06]">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="w-10 text-right font-mono text-[10px] text-fg">
        {cs.awarded}/{cs.maxMarks}
      </span>
      <span className="w-6 text-right font-mono text-[9px]" style={{ color }}>
        {cs.confidence === "high" ? "●" : cs.confidence === "medium" ? "◐" : "○"}
      </span>
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
          <p key={i} className="whitespace-pre-wrap">
            {part.value}
          </p>
        ) : null,
      )}
    </div>
  );
}

function splitMathAndText(text: string): { kind: "text" | "math"; value: string }[] {
  const out: { kind: "text" | "math"; value: string }[] = [];
  const re = /(\$\$[^$]+\$\$|\$[^$]+\$|\\\[[\s\S]*?\\\])/g;
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

function formatTime(seconds: number): string {
  if (seconds < 0) seconds = 0;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function totalBankSize(): number {
  // Import at module level would work; using lazy access for display only
  return 55; // approximate bank size shown in loading
}
