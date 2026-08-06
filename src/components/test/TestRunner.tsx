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
} from "lucide-react";
import { QUESTION_BANK, type SubjectKey, type QuestionFormat } from "../../data/curriculum";
import { autosaveDraft, submitAttempt, AttemptResultDTO } from "../../api";

interface Props {
  subject: SubjectKey;
  format: QuestionFormat;
  count: number;
  rigor: "casual" | "challenging" | "rigorous";
  docs: { id: string; name: string }[];
  docId: string | null;
  selected: string[];
  onExit: () => void;
  onNotify: (t: string) => void;
}

interface Question {
  id: string;
  text: string;
  hint?: string;
  format: "mcq" | "proof";
  options?: { id: string; text: string; correct?: boolean }[];
}

const MCQ_POOL: Question[] = QUESTION_BANK.filter((q) => q.format === "mcq").map((q) => ({
  id: q.id,
  text: q.prompt,
  format: "mcq",
  options: [
    { id: "a", text: sampleAnswersFor(q.id, "a") },
    { id: "b", text: sampleAnswersFor(q.id, "b") },
    { id: "c", text: sampleAnswersFor(q.id, "c") },
    { id: "d", text: sampleAnswersFor(q.id, "d") },
  ],
}));

const PROOF_POOL: Question[] = QUESTION_BANK.filter((q) => q.format === "proof").map((q) => ({
  id: q.id,
  text: q.prompt,
  hint: q.difficulty === "easy" ? "Name the definition first." : "Work step by step, justify each line.",
  format: "proof",
}));

const PROOF_REQUIREMENT = "Name the differentiation rule you apply at each step.";

function sampleAnswersFor(qid: string, opt: string) {
  const table: Record<string, string[]> = {
    q1: ["Quadruples", "Doubles", "Halves (b)", "Stays the same"],
    q3: ["3·cos(3x²)·2x (a)", "cos(3x²)", "6x·cos(3x²)", "−sin(3x²)·6x"],
    q5: ["8", "10 (a)", "32", "1,024"],
    q7: ["Zero", "One", "Two (c)", "Three"],
    q9: ["2 ATP", "4 ATP (c)", "8 ATP", "36 ATP"],
    q11: ["e^(x²) + C", "2e^(x²) + C (a)", "x·e^(x²) + C", "0"],
    q12: ["Linear", "Square root (b)", "Quadratic", "Inverse"],
  };
  return table[qid]?.[{ a: 0, b: 1, c: 2, d: 3 }[opt] ?? 0] ?? "—";
}

export function TestRunner({
  format,
  count,
  rigor,
  docs,
  docId,
  selected,
  onExit,
  onNotify,
}: Props) {
  const [attemptId] = useState(() => `attempt-active-1`);
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, { mcq?: string; proof?: string }>>({});
  const [saveStatus, setSaveStatus] = useState<"saved" | "saving" | "error">("saved");
  const [confirmSubmitOpen, setConfirmSubmitOpen] = useState(false);
  const [submissionResult, setSubmissionResult] = useState<AttemptResultDTO | null>(null);
  const [time, setTime] = useState(0);
  const startTime = useRef(Date.now());
  const docName = docs.find((d) => d.id === docId)?.name.replace(/\.pdf$/i, "") ?? "Mixed study set";

  const questions = useMemo(() => {
    if (format === "mcq") return MCQ_POOL.slice(0, count);
    if (format === "proof") return PROOF_POOL.slice(0, count);
    const half = Math.ceil(count / 2);
    return [...MCQ_POOL.slice(0, half), ...PROOF_POOL.slice(0, count - half)];
  }, [format, count]);

  const total = questions.length;
  const q = questions[index];
  const isProof = format === "proof";
  const isMixed = format === "mixed";
  const onlyProof = isProof;

  useEffect(() => {
    setIndex((i) => Math.min(i, total - 1));
  }, [total]);

  useEffect(() => {
    const t = window.setInterval(() => setTime(Math.floor((Date.now() - startTime.current) / 1000)), 1000);
    return () => window.clearInterval(t);
  }, []);

  // Debounced draft autosave to backend SQLite
  const saveTimeoutRef = useRef<any>(null);
  const handleDraftChange = (itemId: string, responseVal: string) => {
    setSaveStatus("saving");
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(async () => {
      try {
        await autosaveDraft(attemptId, itemId, responseVal, [], index + 1);
        setSaveStatus("saved");
      } catch {
        setSaveStatus("error");
      }
    }, 400);
  };

  const answered = questions.filter((item) => {
    const a = answers[item.id];
    if (!a) return false;
    if (item.format === "mcq") return !!a.mcq;
    return !!a.proof?.trim();
  }).length;

  const select = (val: string) => {
    if (!q) return;
    setAnswers((current) => ({ ...current, [q.id]: { ...current[q.id], mcq: val } }));
    handleDraftChange(q.id, val);
  };

  const setProof = (val: string) => {
    if (!q) return;
    setAnswers((current) => ({ ...current, [q.id]: { ...current[q.id], proof: val } }));
    handleDraftChange(q.id, val);
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
      const res = await submitAttempt(attemptId);
      setSubmissionResult(res);
      onNotify(`Exam submitted · Final score: ${res.aggregateScore}/${res.totalPossibleMarks}`);
    } catch {
      onNotify("Submission error. Attempt recorded as retryable.");
    }
  };

  const toggleProof = () => {
    onNotify(isProof ? "Already in proof-only mode" : "Switched to proof-only layout");
  };

  if (submissionResult) {
    return (
      <SubmittedView
        questions={questions}
        result={submissionResult}
        onRetake={() => {
          setAnswers({});
          setSubmissionResult(null);
          setIndex(0);
          startTime.current = Date.now();
          onNotify("Retake started");
        }}
        onExit={onExit}
        onNotify={onNotify}
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
            <span>{q?.format === "proof" ? "Proof-based" : q?.format === "mcq" ? "Multiple choice" : "Mixed"}</span>
          </div>

          {q && q.format === "mcq" ? (
            <McqQuestion
              q={q}
              selected={answers[q.id]?.mcq}
              onSelect={select}
              showHints={rigor !== "rigorous"}
            />
          ) : q && q.format === "proof" ? (
            <ProofQuestion
              q={q}
              answer={answers[q.id]?.proof ?? ""}
              onChange={setProof}
              showHints={rigor !== "rigorous"}
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
                const done = a?.mcq || a?.proof?.trim();
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
            <p className="text-[12px] text-fg">{docName}</p>
            <p className="mt-1 font-mono text-[10.5px] text-dim">
              {selected.length} concept{selected.length === 1 ? "" : "s"} · {format} · {rigor}
            </p>
          </div>
          <button
            onClick={toggleProof}
            className="rounded-md border border-edge bg-raise px-3 py-2 text-[11.5px] text-mut transition-colors hover:bg-white/[0.07] hover:text-fg"
          >
            Switch to proof-only layout
          </button>
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

/* ── MCQ ── */

function McqQuestion({
  q,
  selected,
  onSelect,
  showHints,
}: {
  q: Question;
  selected?: string;
  onSelect: (id: string) => void;
  showHints: boolean;
}) {
  return (
    <div>
      <h2 className="text-[24px] font-semibold leading-snug text-fg">{q.text}</h2>
      {showHints && q.hint && (
        <p className="mt-2 text-[12.5px] text-dim">Hint · {q.hint}</p>
      )}
      <div className="mt-5 space-y-2.5">
        {q.options?.map((opt) => {
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
  showHints,
}: {
  q: Question;
  answer: string;
  onChange: (v: string) => void;
  showHints: boolean;
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
        <h2 className="text-[24px] font-semibold leading-snug text-fg">{q.text}</h2>
        <div className="mt-3 rounded-md border border-dashed border-accent/40 bg-accent/[0.04] px-3 py-2">
          <div className="mb-0.5 font-mono text-[10px] uppercase tracking-wider text-accent">Requirement</div>
          <p className="text-[12.5px] text-fg/90">{PROOF_REQUIREMENT}</p>
        </div>
        {showHints && q.hint && (
          <p className="mt-2 text-[12.5px] text-dim">Hint · {q.hint}</p>
        )}

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
  questions,
  result,
  onRetake,
  onExit,
  onNotify,
  time,
}: {
  questions: Question[];
  result: AttemptResultDTO;
  onRetake: () => void;
  onExit: () => void;
  onNotify: (t: string) => void;
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
