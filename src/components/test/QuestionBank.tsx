import { useEffect, useMemo, useState } from "react";
import { Check, X as XIcon, MinusCircle } from "lucide-react";
import { getDb } from "../../db/database";

type Status = "correct" | "wrong" | "unattempted";

export interface QuestionBankRecord {
  id: string;
  prompt: string;
  subject: string;
  topic: string;
  format: "mcq" | "proof";
  status: Status;
  yourAnswer: string;
  correctAnswer: string;
  reason: string;
}

export function QuestionBank({ onNotify }: { onNotify: (t: string) => void }) {
  const [subject, setSubject] = useState<string>("all");
  const [format, setFormat] = useState<"all" | "mcq" | "proof">("all");
  const [status, setStatus] = useState<"all" | Status>("all");
  const [q, setQ] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [questions, setQuestions] = useState<QuestionBankRecord[]>([]);

  // Load real question records and responses from SQLite DB
  useEffect(() => {
    (async () => {
      const db = await getDb();

      const itemsRes = db.exec(`
        SELECT i.id, i.stem, i.curriculum_node, i.item_type, i.answer_spec_json,
               r.committed_response, r.grading_status,
               c.awarded_mark, c.maximum_mark, c.rationale
        FROM assessment_items i
        LEFT JOIN attempt_responses r ON i.id = r.item_id
        LEFT JOIN criterion_scores c ON r.id = c.response_id;
      `);

      if (!itemsRes[0]) {
        setQuestions([]);
        return;
      }

      const records: QuestionBankRecord[] = itemsRes[0].values.map((row) => {
        const id = row[0] as string;
        const prompt = row[1] as string;
        const topic = (row[2] as string) || "General Concept";
        const itemType = row[3] as string;
        const specRaw = row[4] as string;
        const userResp = (row[5] as string) || "";
        const awarded = (row[7] as number) ?? 0;
        const maxMark = (row[8] as number) ?? 1;
        const rationale = (row[9] as string) || "";

        let st: Status = "unattempted";
        if (userResp.trim()) {
          st = awarded >= maxMark ? "correct" : "wrong";
        }

        let spec: any = {};
        try { spec = JSON.parse(specRaw); } catch { spec = {}; }

        const correctAnswer = spec.accepted?.[0]?.value ?? spec.reference_solution ?? "Reference solution";

        return {
          id,
          prompt,
          subject: "Physics",
          topic,
          format: itemType === "mcq" ? "mcq" : "proof",
          status: st,
          yourAnswer: userResp || "No attempt recorded",
          correctAnswer,
          reason: rationale || (st === "correct" ? "Evaluation verified requirement." : "Review required step."),
        };
      });

      setQuestions(records);
    })();
  }, []);

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    return questions.filter((item) => {
      return (
        (subject === "all" || item.subject.toLowerCase() === subject.toLowerCase()) &&
        (format === "all" || item.format === format) &&
        (status === "all" || item.status === status) &&
        (!term || item.prompt.toLowerCase().includes(term) || item.topic.toLowerCase().includes(term))
      );
    });
  }, [questions, subject, format, status, q]);

  const counts = useMemo(() => {
    const base = { correct: 0, wrong: 0, unattempted: 0 };
    for (const item of questions) {
      base[item.status] += 1;
    }
    return base;
  }, [questions]);

  const selected = selectedId ? questions.find((item) => item.id === selectedId) : null;

  return (
    <div className="mx-auto w-full max-w-[820px] px-5 pt-10 pb-16 select-none">
      <div className="mb-2 font-mono text-[10px] uppercase tracking-wider text-dim">Testing & Practice</div>
      <h1 className="mb-1 text-[36px] font-bold leading-tight tracking-tight text-fg">Question bank</h1>
      <p className="mb-6 text-[13.5px] text-dim">
        Every question you've seen, recorded with your answers and evaluation rationale in SQLite.
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
        <Pill active={subject === "physics"} onClick={() => setSubject("physics")}>
          Physics
        </Pill>
        <Pill active={subject === "math"} onClick={() => setSubject("math")}>
          Math
        </Pill>
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
        <span className="font-mono text-[10.5px] text-dim">{rows.length} questions recorded</span>
        <button
          onClick={() => onNotify(`Built a set from ${rows.length} questions`)}
          className="rounded-md bg-accent px-2.5 py-1 text-[12px] font-medium text-white transition-colors hover:bg-accent-deep"
        >
          Build test from results
        </button>
      </div>

      <div className="overflow-hidden rounded-md border border-edge bg-raise">
        {rows.map((item, i) => (
          <button
            key={item.id}
            onClick={() => setSelectedId(item.id)}
            className={`flex w-full items-start gap-3 px-3.5 py-3 text-left transition-colors hover:bg-white/[0.04] ${
              i > 0 ? "border-t border-edge-soft" : ""
            }`}
          >
            <StatusDot status={item.status} />
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
                {item.subject} · {item.topic}
              </span>
            </span>
            <StatusChip status={item.status} />
          </button>
        ))}
        {rows.length === 0 && (
          <p className="px-4 py-10 text-center text-[13px] text-dim">No recorded questions match those filters.</p>
        )}
      </div>

      {selected && (
        <QuestionDetail
          prompt={selected.prompt}
          topic={selected.topic}
          subject={selected.subject}
          format={selected.format}
          item={selected}
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
  item,
  onClose,
}: {
  prompt: string;
  topic: string;
  subject: string;
  format: "mcq" | "proof";
  item: QuestionBankRecord;
  onClose: () => void;
}) {
  const isWrong = item.status === "wrong";
  const isUnattempted = item.status === "unattempted";

  return (
    <div className="fixed inset-0 z-[80] flex justify-center bg-black/50 px-4 pt-[6vh]" onMouseDown={onClose}>
      <div
        onMouseDown={(e) => e.stopPropagation()}
        className="anim-toast flex h-fit max-h-[86vh] w-[min(720px,100%)] flex-col overflow-hidden rounded-xl border border-edge bg-[#1e1e1e] shadow-[0_28px_80px_rgba(0,0,0,0.62)]"
      >
        <div className="flex items-start gap-3 border-b border-edge px-5 py-4">
          <StatusDot status={item.status} />
          <div className="min-w-0 flex-1">
            <div className="mb-1 flex items-center gap-2 font-mono text-[10px] uppercase tracking-wider text-dim">
              <span>{subject}</span>
              <span>·</span>
              <span>{topic}</span>
              <span>·</span>
              <span>{format}</span>
              <StatusChip status={item.status} />
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
          <section>
            <div className="mb-2 flex items-center gap-2 font-mono text-[10px] uppercase tracking-wider text-dim">
              <span>Your answer</span>
            </div>
            <div
              className="whitespace-pre-wrap rounded-md border px-3.5 py-2.5 text-[13px] leading-relaxed text-fg/90"
              style={{
                borderColor: isWrong ? "rgba(252,165,165,0.35)" : "rgba(134,239,172,0.35)",
                background: isWrong ? "rgba(252,165,165,0.05)" : "rgba(134,239,172,0.05)",
              }}
            >
              {item.yourAnswer}
            </div>
          </section>

          <section>
            <div className="mb-2 flex items-center gap-2 font-mono text-[10px] uppercase tracking-wider text-dim">
              <span>Correct answer / Reference</span>
            </div>
            <div className="whitespace-pre-wrap rounded-md border border-edge bg-raise px-3.5 py-2.5 text-[13px] leading-relaxed text-fg/90">
              {item.correctAnswer}
            </div>
          </section>

          <section>
            <div className="mb-2 font-mono text-[10px] uppercase tracking-wider text-dim">
              Evaluation Rationale & Wrong Reason
            </div>
            <div
              className="rounded-md border border-dashed px-3.5 py-2.5 text-[13px] leading-relaxed text-fg/85"
              style={{
                borderColor: isWrong ? "rgba(252,165,165,0.4)" : "rgba(165,180,252,0.35)",
                background: isWrong ? "rgba(252,165,165,0.04)" : "rgba(165,180,252,0.04)",
              }}
            >
              {item.reason}
            </div>
          </section>
        </div>

        <div className="flex items-center justify-between border-t border-edge px-5 py-3">
          <span className="font-mono text-[10.5px] text-dim">
            Recorded in SQLite database.
          </span>
          <button
            onClick={onClose}
            className="rounded-md bg-accent px-3 py-1.5 text-[12px] font-medium text-white"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
