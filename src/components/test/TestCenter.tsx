import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronRight, Check, Play, Square, RotateCcw } from "lucide-react";
import {
  CURRICULA,
  SUBJECT_LIST,
  maxQuestions,
  type CurriculumDoc,
  type ExamMode,
  type QuestionFormat,
  type Rigor,
  type SubjectKey,
} from "../../data/curriculum";

interface Props {
  onNotify: (t: string) => void;
  onStart: (params: {
    subject: SubjectKey;
    format: QuestionFormat;
    count: number;
    rigor: Rigor;
    docId: string | null;
    picked: string[];
  }) => void;
}

const MODES: { id: ExamMode; label: string; desc: string }[] = [
  { id: "module", label: "Module Test", desc: "Exactly one subsection of one section" },
  { id: "final", label: "Final Exam", desc: "Everything the curriculum covers" },
  { id: "custom", label: "Custom Exam", desc: "Pick any sections and subsections" },
];

const RIGORS: { id: Rigor; label: string; desc: string; color: string }[] = [
  { id: "casual", label: "Casual", desc: "Hints on, no penalty", color: "#86efac" },
  { id: "challenging", label: "Challenging", desc: "Limited hints, graded", color: "#fcd34d" },
  { id: "rigorous", label: "Rigorous", desc: "No hints, strict marking", color: "#fca5a5" },
];

const FORMATS: { id: QuestionFormat; label: string; desc: string }[] = [
  { id: "mcq", label: "MCQ", desc: "Multiple choice only · max 50" },
  { id: "proof", label: "Proof-based", desc: "Typed answers only · max 15" },
  { id: "mixed", label: "Mixed", desc: "Both formats · max 32" },
];

export function TestCenter({ onNotify, onStart }: Props) {
  const [subject, setSubject] = useState<SubjectKey>("physics");
  const [docId, setDocId] = useState<string>("");
  const [mode, setMode] = useState<ExamMode>("module");
  const [rigor, setRigor] = useState<Rigor>("challenging");
  const [format, setFormat] = useState<QuestionFormat>("mixed");
  const [count, setCount] = useState(20);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // timer
  const [running, setRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const tick = useRef<number | null>(null);

  const docs = useMemo(() => CURRICULA.filter((c) => c.subject === subject), [subject]);
  const doc: CurriculumDoc | undefined = docs.find((d) => d.id === docId) ?? docs[0];

  // reset picks when subject / doc / mode changes
  useEffect(() => {
    setPicked(new Set());
    setExpanded(new Set(doc ? [doc.sections[0]?.id] : []));
  }, [subject, docId, mode]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setDocId(docs[0]?.id ?? "");
  }, [subject]); // eslint-disable-line react-hooks/exhaustive-deps

  // clamp counter to the format ceiling
  const ceiling = maxQuestions(format);
  useEffect(() => {
    setCount((c) => Math.min(c, ceiling));
  }, [ceiling]);

  useEffect(() => {
    if (!running) {
      if (tick.current) window.clearInterval(tick.current);
      return;
    }
    tick.current = window.setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => {
      if (tick.current) window.clearInterval(tick.current);
    };
  }, [running]);

  const hh = String(Math.floor(elapsed / 3600)).padStart(2, "0");
  const mm = String(Math.floor((elapsed % 3600) / 60)).padStart(2, "0");
  const ss = String(elapsed % 60).padStart(2, "0");

  const allSubIds = useMemo(
    () => (doc ? doc.sections.flatMap((s) => s.subsections.map((x) => x.id)) : []),
    [doc]
  );
  const effectivePicked = mode === "final" ? new Set(allSubIds) : picked;

  const toggleSub = (sectionId: string, subId: string) => {
    if (mode === "final") return;
    setPicked((current) => {
      const next = new Set(current);
      if (mode === "module") {
        // module = exactly one subsection
        return next.has(subId) ? new Set<string>() : new Set([subId]);
      }
      if (next.has(subId)) next.delete(subId);
      else next.add(subId);
      return next;
    });
    void sectionId;
  };

  const toggleSection = (sectionId: string) => {
    if (mode !== "custom" || !doc) return;
    const section = doc.sections.find((s) => s.id === sectionId);
    if (!section) return;
    const ids = section.subsections.map((s) => s.id);
    const allOn = ids.every((id) => picked.has(id));
    setPicked((current) => {
      const next = new Set(current);
      ids.forEach((id) => (allOn ? next.delete(id) : next.add(id)));
      return next;
    });
  };

  const canStart = effectivePicked.size > 0;

  const start = () => {
    if (!canStart) {
      onNotify(mode === "module" ? "Pick one subsection first" : "Select at least one concept");
      return;
    }
    setElapsed(0);
    setRunning(true);
    onNotify(`Started ${MODES.find((m) => m.id === mode)!.label} · ${count} questions`);
  };

  const launch = () => {
    if (!canStart) {
      onNotify(mode === "module" ? "Pick one subsection first" : "Select at least one concept");
      return;
    }
    onStart({
      subject,
      format,
      count,
      rigor,
      docId: doc?.id ?? null,
      picked: Array.from(effectivePicked),
    });
  };

  return (
    <div className="mx-auto w-full max-w-[860px] px-5 pt-10 pb-20">
      <div className="mb-2 font-mono text-[10px] uppercase tracking-wider text-dim">Testing & Practice</div>
      <h1 className="mb-1 text-[36px] font-bold leading-tight tracking-tight text-fg">Take a test</h1>
      <p className="mb-7 text-[13.5px] text-dim">
        Build an exam from your curriculum. Studyus writes the questions, grades them, and files the results.
      </p>

      {/* timer */}
      <div className="mb-7 flex items-center gap-4 rounded-lg border border-edge bg-raise p-4">
        <div className="flex items-baseline gap-1 font-mono text-[40px] leading-none tracking-tight text-fg tabular-nums">
          <Digit>{hh}</Digit>
          <span className={`pb-1 ${running ? "animate-pulse text-accent" : "text-faint"}`}>:</span>
          <Digit>{mm}</Digit>
          <span className={`pb-1 ${running ? "animate-pulse text-accent" : "text-faint"}`}>:</span>
          <Digit>{ss}</Digit>
        </div>
        <div className="flex-1">
          <div className="text-[12.5px] text-fg">{running ? "Test in progress" : elapsed > 0 ? "Paused" : "Untimed — counts up"}</div>
          <div className="font-mono text-[10.5px] text-dim">No limit · runs until you stop</div>
        </div>
        <div className="flex items-center gap-1.5">
          {!running ? (
            <button
              onClick={start}
              className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-[12.5px] font-medium text-white transition-colors hover:bg-accent-deep"
            >
              <Play size={12} fill="currentColor" />
              {elapsed > 0 ? "Resume" : "Start test"}
            </button>
          ) : (
            <button
              onClick={() => {
                setRunning(false);
                onNotify("Test paused");
              }}
              className="flex items-center gap-1.5 rounded-md border border-edge bg-white/[0.06] px-3 py-1.5 text-[12.5px] font-medium text-fg transition-colors hover:bg-white/[0.12]"
            >
              <Square size={11} />
              Stop
            </button>
          )}
          <button
            onClick={() => {
              setRunning(false);
              setElapsed(0);
            }}
            className="grid h-8 w-8 place-items-center rounded-md text-dim transition-colors hover:bg-white/[0.06] hover:text-fg"
            title="Reset timer"
          >
            <RotateCcw size={13} />
          </button>
        </div>
      </div>

      {/* subject */}
      <Label>Subject</Label>
      <div className="mb-6 flex flex-wrap gap-2">
        {SUBJECT_LIST.map((s) => (
          <button
            key={s.id}
            onClick={() => setSubject(s.id)}
            className={`rounded-md border px-3 py-1.5 text-[12.5px] font-medium transition-colors ${
              subject === s.id ? "border-transparent text-black" : "border-edge bg-raise text-mut hover:text-fg"
            }`}
            style={subject === s.id ? { background: s.accent } : undefined}
          >
            {s.label}
          </button>
        ))}
      </div>

      {/* curriculum */}
      <Label>Curriculum source</Label>
      <div className="mb-6 space-y-1.5">
        {docs.length === 0 && (
          <p className="rounded-md border border-dashed border-edge px-3 py-4 text-center text-[12.5px] text-dim">
            No curriculum PDF for this subject yet — add one from the sidebar.
          </p>
        )}
        {docs.map((d) => (
          <button
            key={d.id}
            onClick={() => setDocId(d.id)}
            className={`flex w-full items-center gap-3 rounded-md border p-2.5 text-left transition-colors ${
              doc?.id === d.id ? "border-accent bg-accent/[0.07]" : "border-edge bg-raise hover:bg-white/[0.06]"
            }`}
          >
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] text-fg">{d.name}</span>
              <span className="block font-mono text-[10.5px] text-dim">
                {d.pages} pages · {d.sections.length} sections ·{" "}
                {d.sections.reduce((n, s) => n + s.subsections.length, 0)} subsections
              </span>
            </span>
            {doc?.id === d.id && <Check size={14} className="text-accent" />}
          </button>
        ))}
      </div>

      {/* mode */}
      <Label>Exam mode</Label>
      <div className="mb-6 grid grid-cols-3 gap-2">
        {MODES.map((m) => (
          <button
            key={m.id}
            onClick={() => setMode(m.id)}
            className={`rounded-md border p-3 text-left transition-colors ${
              mode === m.id ? "border-accent bg-accent/[0.07]" : "border-edge bg-raise hover:bg-white/[0.06]"
            }`}
          >
            <div className="text-[13px] font-medium text-fg">{m.label}</div>
            <div className="mt-0.5 text-[11px] leading-snug text-dim">{m.desc}</div>
          </button>
        ))}
      </div>

      {/* concepts */}
      <Label>
        Concepts to be tested
        <span className="ml-2 font-mono text-[10px] normal-case text-dim">
          {mode === "final"
            ? `all ${allSubIds.length} selected`
            : mode === "module"
            ? picked.size > 0
              ? "1 subsection selected"
              : "choose exactly one"
            : `${picked.size} selected`}
        </span>
      </Label>
      <div className={`mb-6 overflow-hidden rounded-md border border-edge ${mode === "final" ? "opacity-60" : ""}`}>
        {doc?.sections.map((section, i) => {
          const open = expanded.has(section.id);
          const secIds = section.subsections.map((s) => s.id);
          const allOn = secIds.every((id) => effectivePicked.has(id));
          const someOn = secIds.some((id) => effectivePicked.has(id));
          return (
            <div key={section.id} className={i > 0 ? "border-t border-edge-soft" : ""}>
              <div className="flex items-center gap-2 bg-white/[0.02] px-3 py-2">
                <button
                  onClick={() =>
                    setExpanded((cur) => {
                      const next = new Set(cur);
                      next.has(section.id) ? next.delete(section.id) : next.add(section.id);
                      return next;
                    })
                  }
                  className="grid h-5 w-5 place-items-center rounded text-dim hover:bg-white/[0.07] hover:text-fg"
                >
                  <ChevronRight size={13} className={`transition-transform ${open ? "rotate-90" : ""}`} />
                </button>
                <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-fg">{section.label}</span>
                {mode === "custom" && (
                  <button
                    onClick={() => toggleSection(section.id)}
                    className="rounded px-2 py-0.5 text-[11px] text-mut transition-colors hover:bg-white/[0.07] hover:text-fg"
                  >
                    {allOn ? "Clear" : "Select all"}
                  </button>
                )}
                <span className="font-mono text-[10px] text-dim">
                  {someOn ? `${secIds.filter((id) => effectivePicked.has(id)).length}/${secIds.length}` : `${secIds.length}`}
                </span>
              </div>
              {open && (
                <div>
                  {section.subsections.map((sub) => {
                    const on = effectivePicked.has(sub.id);
                    return (
                      <button
                        key={sub.id}
                        onClick={() => toggleSub(section.id, sub.id)}
                        disabled={mode === "final"}
                        className="flex w-full items-center gap-2.5 border-t border-edge-soft px-3 py-2 pl-10 text-left transition-colors hover:bg-white/[0.03] disabled:cursor-default"
                      >
                        <span
                          className={`grid h-[15px] w-[15px] shrink-0 place-items-center border transition-colors ${
                            mode === "module" ? "rounded-full" : "rounded-[3px]"
                          } ${on ? "border-accent bg-accent text-white" : "border-white/20"}`}
                        >
                          {on && <Check size={10} strokeWidth={3} />}
                        </span>
                        <span className={`truncate text-[12.5px] ${on ? "text-fg" : "text-mut"}`}>{sub.label}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* format */}
      <Label>Question format</Label>
      <div className="mb-6 grid grid-cols-3 gap-2">
        {FORMATS.map((f) => (
          <button
            key={f.id}
            onClick={() => setFormat(f.id)}
            className={`rounded-md border p-3 text-left transition-colors ${
              format === f.id ? "border-accent bg-accent/[0.07]" : "border-edge bg-raise hover:bg-white/[0.06]"
            }`}
          >
            <div className="text-[13px] font-medium text-fg">{f.label}</div>
            <div className="mt-0.5 text-[11px] leading-snug text-dim">{f.desc}</div>
          </button>
        ))}
      </div>

      {/* rigor */}
      <Label>Test mode</Label>
      <div className="mb-6 grid grid-cols-3 gap-2">
        {RIGORS.map((r) => (
          <button
            key={r.id}
            onClick={() => setRigor(r.id)}
            className={`rounded-md border p-3 text-left transition-colors ${
              rigor === r.id ? "bg-white/[0.06]" : "border-edge bg-raise hover:bg-white/[0.06]"
            }`}
            style={rigor === r.id ? { borderColor: r.color } : undefined}
          >
            <div className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full" style={{ background: r.color }} />
              <span className="text-[13px] font-medium text-fg">{r.label}</span>
            </div>
            <div className="mt-0.5 text-[11px] leading-snug text-dim">{r.desc}</div>
          </button>
        ))}
      </div>

      {/* counter */}
      <Label>
        Question count
        <span className="ml-2 font-mono text-[10px] normal-case text-dim">max {ceiling} for {FORMATS.find((f) => f.id === format)!.label}</span>
      </Label>
      <div className="mb-7 flex items-center gap-4 rounded-md border border-edge bg-raise p-4">
        <div className="font-mono text-[30px] font-semibold leading-none text-fg tabular-nums">
          {String(count).padStart(2, "0")}
        </div>
        <input
          type="range"
          min={1}
          max={ceiling}
          value={count}
          onChange={(e) => setCount(parseInt(e.target.value, 10))}
          className="flex-1 accent-accent"
        />
        <div className="flex items-center gap-1">
          <button
            onClick={() => setCount((c) => Math.max(1, c - 1))}
            className="grid h-7 w-7 place-items-center rounded-md border border-edge text-mut transition-colors hover:bg-white/[0.08] hover:text-fg"
          >
            −
          </button>
          <button
            onClick={() => setCount((c) => Math.min(ceiling, c + 1))}
            className="grid h-7 w-7 place-items-center rounded-md border border-edge text-mut transition-colors hover:bg-white/[0.08] hover:text-fg"
          >
            +
          </button>
        </div>
      </div>

      {/* summary + launch */}
      <div className="flex items-center gap-4 rounded-lg border border-edge bg-raise p-4">
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-medium text-fg">
            {MODES.find((m) => m.id === mode)!.label} · {FORMATS.find((f) => f.id === format)!.label} ·{" "}
            {RIGORS.find((r) => r.id === rigor)!.label}
          </div>
          <div className="truncate font-mono text-[11px] text-dim">
            {count} questions · {effectivePicked.size} concept{effectivePicked.size === 1 ? "" : "s"} ·{" "}
            {doc?.name ?? "no curriculum"}
          </div>
        </div>
        <button
          onClick={launch}
          disabled={!canStart}
          className={`flex items-center gap-1.5 rounded-md px-4 py-2 text-[13px] font-medium transition-all ${
            canStart ? "bg-accent text-white hover:bg-accent-deep active:scale-[0.98]" : "bg-white/[0.06] text-faint"
          }`}
        >
          <Play size={13} fill="currentColor" />
          Generate & start
        </button>
      </div>
    </div>
  );
}

function Digit({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-md bg-black/40 px-2 py-1 ring-1 ring-white/8">{children}</span>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <div className="mb-2 text-[11.5px] font-medium uppercase tracking-wide text-dim">{children}</div>;
}
