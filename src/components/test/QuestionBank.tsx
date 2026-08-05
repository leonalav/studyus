import { useMemo, useState } from "react";
import { Check, X as XIcon, MinusCircle } from "lucide-react";
import { QUESTION_BANK, SUBJECT_LIST, type SubjectKey } from "../../data/curriculum";

/* Deterministic mock history of what the student answered previously. */
type Status = "correct" | "wrong" | "unattempted";

interface AttemptRecord {
  status: Status;
  yourAnswer: string;
  correctAnswer: string;
  reason: string;
}

const ATTEMPTS: Record<string, AttemptRecord> = {
  q1: {
    status: "correct",
    yourAnswer: "Halves — v ∝ 1/√r, so quadrupling r divides v by 2.",
    correctAnswer: "Halves. v_orb = √(GM/r); if r → 4r then v → v/2.",
    reason: "You applied the inverse square-root scaling correctly.",
  },
  q2: {
    status: "wrong",
    yourAnswer:
      "T² = k·r. Substituted numbers into F_g = GMm/r² and stopped at v = √(GM/r).",
    correctAnswer:
      "Start from F_g = GMm/r² = m·(4π²r/T²). Cancel m, solve for T² = (4π²/GM)·r³.",
    reason:
      "You solved for orbital speed instead of period. Kepler's 3rd law is T² ∝ r³, not T ∝ r. Re-derive T from centripetal acceleration, not just v.",
  },
  q3: {
    status: "correct",
    yourAnswer: "6x · cos(3x²) using the chain rule.",
    correctAnswer: "d/dx sin(3x²) = cos(3x²) · 6x.",
    reason: "Correct application of the chain rule; outer derivative × inner derivative.",
  },
  q4: {
    status: "wrong",
    yourAnswer:
      "Assumed absolute convergence when |a_{n+1}/a_n| < 1 without a limit argument.",
    correctAnswer:
      "Let L = lim |a_{n+1}/a_n|. If L < 1 the series converges absolutely by comparison with a geometric series with ratio r ∈ (L, 1).",
    reason:
      "You skipped the geometric-series comparison. The ratio test needs the limit L, not a single term ratio, and the bounding step is what makes the proof rigorous.",
  },
  q5: {
    status: "correct",
    yourAnswer: "10 comparisons — log₂(1024) = 10.",
    correctAnswer: "At most ⌈log₂(1024)⌉ = 10 comparisons.",
    reason: "Correct — binary search halves the search space each step.",
  },
  q6: {
    status: "unattempted",
    yourAnswer: "",
    correctAnswer:
      "T(n) = 2T(n/2) + Θ(n). By the master theorem case 2, T(n) = Θ(n log n).",
    reason: "You haven't attempted this one yet. Try applying the master theorem.",
  },
  q7: {
    status: "wrong",
    yourAnswer: "First order (b).",
    correctAnswer: "Second order (c) — rate ∝ [A]², so doubling [A] quadruples the rate.",
    reason:
      "You picked the linear response, but the rate quadrupled — that's 2ⁿ = 4, giving n = 2.",
  },
  q8: {
    status: "correct",
    yourAnswer:
      "Increasing pressure shifts the equilibrium toward the side with fewer moles of gas.",
    correctAnswer:
      "The system opposes the change by favoring the side with fewer gaseous moles, restoring partial pressure balance.",
    reason: "Clear statement of Le Chatelier's principle.",
  },
  q9: {
    status: "wrong",
    yourAnswer: "4 ATP.",
    correctAnswer: "Net 2 ATP — 4 produced minus 2 consumed in activation steps.",
    reason: "You gave the gross yield; the question asks for the net yield.",
  },
  q10: {
    status: "unattempted",
    yourAnswer: "",
    correctAnswer:
      "A silent mutation changes a codon to another codon coding for the same amino acid due to redundancy in the genetic code.",
    reason: "Not yet attempted.",
  },
  q11: {
    status: "correct",
    yourAnswer: "e^(x²) + C, by substitution u = x².",
    correctAnswer: "∫ 2x·e^(x²) dx = e^(x²) + C.",
    reason: "Correct u-substitution.",
  },
  q12: {
    status: "wrong",
    yourAnswer: "Linear — T ∝ L.",
    correctAnswer: "Square root — T = 2π·√(L/g).",
    reason:
      "Period scales with the square root of the length, not linearly. Doubling L multiplies T by √2 ≈ 1.41.",
  },
};

export function QuestionBank({ onNotify }: { onNotify: (t: string) => void }) {
  const [subject, setSubject] = useState<SubjectKey | "all">("all");
  const [format, setFormat] = useState<"all" | "mcq" | "proof">("all");
  const [status, setStatus] = useState<"all" | Status>("all");
  const [q, setQ] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    return QUESTION_BANK.filter((item) => {
      const st = ATTEMPTS[item.id]?.status ?? "unattempted";
      return (
        (subject === "all" || item.subject === subject) &&
        (format === "all" || item.format === format) &&
        (status === "all" || st === status) &&
        (!term || item.prompt.toLowerCase().includes(term) || item.topic.toLowerCase().includes(term))
      );
    });
  }, [subject, format, status, q]);

  const counts = useMemo(() => {
    const base = { correct: 0, wrong: 0, unattempted: 0 };
    for (const item of QUESTION_BANK) {
      const st = ATTEMPTS[item.id]?.status ?? "unattempted";
      base[st] += 1;
    }
    return base;
  }, []);

  const selected = selectedId ? QUESTION_BANK.find((item) => item.id === selectedId) : null;
  const attempt = selectedId ? ATTEMPTS[selectedId] : null;

  return (
    <div className="mx-auto w-full max-w-[820px] px-5 pt-10 pb-16">
      <div className="mb-2 font-mono text-[10px] uppercase tracking-wider text-dim">Testing & Practice</div>
      <h1 className="mb-1 text-[36px] font-bold leading-tight tracking-tight text-fg">Question bank</h1>
      <p className="mb-6 text-[13.5px] text-dim">
        Every question you've seen, with your answers and where you went wrong.
      </p>

      <div className="mb-5 grid grid-cols-3 gap-2">
        <StatCard label="Correct" value={counts.correct} color="#86efac" />
        <StatCard label="Wrong" value={counts.wrong} color="#fca5a5" />
        <StatCard label="Unattempted" value={counts.unattempted} color="#a5b4fc" />
      </div>

      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search questions and topics…"
        className="mb-3 w-full rounded-md border border-edge bg-raise px-3 py-2 text-[13px] text-fg outline-none placeholder:text-faint focus:border-accent/60"
      />

      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        <Pill active={subject === "all"} onClick={() => setSubject("all")}>
          All subjects
        </Pill>
        {SUBJECT_LIST.map((s) => (
          <Pill key={s.id} active={subject === s.id} onClick={() => setSubject(s.id)}>
            {s.label}
          </Pill>
        ))}
      </div>
      <div className="mb-5 flex flex-wrap items-center gap-1.5">
        {(["all", "mcq", "proof"] as const).map((f) => (
          <Pill key={f} active={format === f} onClick={() => setFormat(f)}>
            {f === "all" ? "All formats" : f === "mcq" ? "MCQ" : "Proof"}
          </Pill>
        ))}
        <span className="mx-1 h-4 w-px bg-edge" />
        {(["all", "correct", "wrong", "unattempted"] as const).map((s) => (
          <Pill key={s} active={status === s} onClick={() => setStatus(s)}>
            {s === "all" ? "All" : s.charAt(0).toUpperCase() + s.slice(1)}
          </Pill>
        ))}
      </div>

      <div className="mb-2 flex items-center justify-between">
        <span className="font-mono text-[10.5px] text-dim">{rows.length} questions</span>
        <button
          onClick={() => onNotify(`Built a set from ${rows.length} questions`)}
          className="rounded-md bg-accent px-2.5 py-1 text-[12px] font-medium text-white transition-colors hover:bg-accent-deep"
        >
          Build test from results
        </button>
      </div>

      <div className="overflow-hidden rounded-md border border-edge">
        {rows.map((item, i) => {
          const st = ATTEMPTS[item.id]?.status ?? "unattempted";
          return (
            <button
              key={item.id}
              onClick={() => setSelectedId(item.id)}
              className={`flex w-full items-start gap-3 px-3.5 py-3 text-left transition-colors hover:bg-white/[0.04] ${
                i > 0 ? "border-t border-edge-soft" : ""
              }`}
            >
              <StatusDot status={st} />
              <span
                className="mt-0.5 shrink-0 rounded px-1.5 py-0.5 font-mono text-[9.5px] uppercase"
                style={{
                  background: item.format === "mcq" ? "rgba(125,211,252,0.14)" : "rgba(165,180,252,0.14)",
                  color: item.format === "mcq" ? "#7dd3fc" : "#a5b4fc",
                }}
              >
                {item.format}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] text-fg">{item.prompt}</span>
                <span className="block font-mono text-[10.5px] text-dim">
                  {SUBJECT_LIST.find((s) => s.id === item.subject)?.label} · {item.topic}
                </span>
              </span>
              <StatusChip status={st} />
            </button>
          );
        })}
        {rows.length === 0 && (
          <p className="px-4 py-10 text-center text-[13px] text-dim">No questions match those filters.</p>
        )}
      </div>

      {selected && attempt && (
        <QuestionDetail
          prompt={selected.prompt}
          topic={selected.topic}
          subject={SUBJECT_LIST.find((s) => s.id === selected.subject)?.label ?? ""}
          format={selected.format}
          attempt={attempt}
          onClose={() => setSelectedId(null)}
        />
      )}
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="rounded-md border border-edge bg-raise p-3">
      <div className="text-[18px] font-semibold" style={{ color }}>
        {value}
      </div>
      <div className="text-[11px] text-dim">{label}</div>
    </div>
  );
}

function Pill({ children, active, onClick }: { children: React.ReactNode; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full border px-2.5 py-1 text-[11.5px] transition-colors ${
        active ? "border-accent bg-accent/15 text-fg" : "border-edge bg-raise text-mut hover:text-fg"
      }`}
    >
      {children}
    </button>
  );
}

function StatusDot({ status }: { status: Status }) {
  const style =
    status === "correct"
      ? { bg: "bg-[#86efac]/15", ring: "border-[#86efac]", icon: <Check size={11} className="text-[#86efac]" strokeWidth={3} /> }
      : status === "wrong"
      ? { bg: "bg-[#fca5a5]/15", ring: "border-[#fca5a5]", icon: <XIcon size={11} className="text-[#fca5a5]" strokeWidth={3} /> }
      : { bg: "bg-white/[0.05]", ring: "border-white/20", icon: <MinusCircle size={11} className="text-dim" /> };
  return (
    <span
      className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border ${style.bg} ${style.ring}`}
    >
      {style.icon}
    </span>
  );
}

function StatusChip({ status }: { status: Status }) {
  const style =
    status === "correct"
      ? { bg: "bg-[#86efac]/15", fg: "text-[#86efac]", label: "Correct" }
      : status === "wrong"
      ? { bg: "bg-[#fca5a5]/15", fg: "text-[#fca5a5]", label: "Wrong" }
      : { bg: "bg-white/[0.05]", fg: "text-dim", label: "Unattempted" };
  return (
    <span className={`mt-0.5 shrink-0 rounded-full px-2 py-[1px] font-mono text-[9.5px] ${style.bg} ${style.fg}`}>
      {style.label}
    </span>
  );
}

/* ── Detail modal ─────────────────────────────────────────── */

function QuestionDetail({
  prompt,
  topic,
  subject,
  format,
  attempt,
  onClose,
}: {
  prompt: string;
  topic: string;
  subject: string;
  format: "mcq" | "proof";
  attempt: AttemptRecord;
  onClose: () => void;
}) {
  const isWrong = attempt.status === "wrong";
  const isUnattempted = attempt.status === "unattempted";

  return (
    <div className="fixed inset-0 z-[80] flex justify-center bg-black/50 px-4 pt-[6vh]" onMouseDown={onClose}>
      <div
        onMouseDown={(e) => e.stopPropagation()}
        className="anim-toast flex h-fit max-h-[86vh] w-[min(720px,100%)] flex-col overflow-hidden rounded-xl border border-edge bg-[#1e1e1e] shadow-[0_28px_80px_rgba(0,0,0,0.62)]"
      >
        {/* header */}
        <div className="flex items-start gap-3 border-b border-edge px-5 py-4">
          <StatusDot status={attempt.status} />
          <div className="min-w-0 flex-1">
            <div className="mb-1 flex items-center gap-2 font-mono text-[10px] uppercase tracking-wider text-dim">
              <span>{subject}</span>
              <span>·</span>
              <span>{topic}</span>
              <span>·</span>
              <span>{format}</span>
              <StatusChip status={attempt.status} />
            </div>
            <p className="text-[15px] font-semibold leading-snug text-fg">{prompt}</p>
          </div>
          <button
            onClick={onClose}
            className="grid h-6 w-6 place-items-center rounded text-dim transition-colors hover:bg-white/[0.07] hover:text-fg"
          >
            <XIcon size={13} />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {/* your answer */}
          <section>
            <div className="mb-2 flex items-center gap-2 font-mono text-[10px] uppercase tracking-wider text-dim">
              <span>Your answer</span>
              {!isUnattempted && (
                <span
                  className="rounded-full px-1.5 py-[1px] text-[9.5px]"
                  style={{
                    background: isWrong ? "rgba(252,165,165,0.14)" : "rgba(134,239,172,0.14)",
                    color: isWrong ? "#fca5a5" : "#86efac",
                  }}
                >
                  {isWrong ? "incorrect" : "matches"}
                </span>
              )}
            </div>
            {isUnattempted ? (
              <p className="rounded-md border border-dashed border-edge px-3 py-4 text-center text-[12.5px] text-dim">
                You haven't attempted this question yet.
              </p>
            ) : (
              <div
                className="whitespace-pre-wrap rounded-md border px-3.5 py-2.5 text-[13px] leading-relaxed text-fg/90"
                style={{
                  borderColor: isWrong ? "rgba(252,165,165,0.35)" : "rgba(134,239,172,0.35)",
                  background: isWrong ? "rgba(252,165,165,0.05)" : "rgba(134,239,172,0.05)",
                }}
              >
                {attempt.yourAnswer}
              </div>
            )}
          </section>

          {/* correct answer */}
          <section>
            <div className="mb-2 flex items-center gap-2 font-mono text-[10px] uppercase tracking-wider text-dim">
              <span>Correct answer</span>
              <span className="rounded-full bg-[#86efac]/15 px-1.5 py-[1px] text-[9.5px] text-[#86efac]">
                reference
              </span>
            </div>
            <div className="whitespace-pre-wrap rounded-md border border-edge bg-raise px-3.5 py-2.5 text-[13px] leading-relaxed text-fg/90">
              {attempt.correctAnswer}
            </div>
          </section>

          {/* explanation */}
          <section>
            <div className="mb-2 font-mono text-[10px] uppercase tracking-wider text-dim">
              {isWrong ? "Why you were wrong" : isUnattempted ? "Approach" : "Why it's right"}
            </div>
            <div
              className="rounded-md border border-dashed px-3.5 py-2.5 text-[13px] leading-relaxed text-fg/85"
              style={{
                borderColor: isWrong ? "rgba(252,165,165,0.4)" : "rgba(165,180,252,0.35)",
                background: isWrong ? "rgba(252,165,165,0.04)" : "rgba(165,180,252,0.04)",
              }}
            >
              {attempt.reason}
            </div>
          </section>
        </div>

        {/* footer */}
        <div className="flex items-center justify-between border-t border-edge px-5 py-3">
          <span className="font-mono text-[10.5px] text-dim">
            Studyus keeps this record. Re-attempt any time.
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="rounded-md px-2.5 py-1.5 text-[12px] text-mut hover:text-fg"
            >
              Close
            </button>
            <button
              onClick={onClose}
              className="rounded-md bg-accent px-3 py-1.5 text-[12px] font-medium text-white transition-colors hover:bg-accent-deep"
            >
              Re-attempt
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
