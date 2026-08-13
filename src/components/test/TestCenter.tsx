import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ChevronRight, Check, Play, Square, RotateCcw, GraduationCap } from "lucide-react";
import {
  SUBJECT_LIST,
  maxQuestions,
  minQuestions,
  type ExamMode,
  type QuestionFormat,
  type Rigor,
  type SubjectKey,
} from "../../data/curriculum";
import { getDb } from "../../db/database";
import { generateAssessment } from "../../api";
import { getCurriculumTree, CurriculumNodeRecord } from "../../lib/curriculum";

interface Props {
  onNotify: (t: string) => void;
  onGenerated: () => void;
}

export interface RealPdfSource {
  id: string;
  name: string;
  pageCount: number;
}

const MODES: { id: ExamMode; label: string; desc: string }[] = [
  { id: "module", label: "Module Test", desc: "Exactly one subsection of one section" },
  { id: "final", label: "Final Exam", desc: "Everything the curriculum covers" },
  { id: "custom", label: "Custom Exam", desc: "Pick any sections and subsections" },
];

const RIGORS: { id: Rigor; label: string; desc: string; color: string }[] = [
  { id: "casual", label: "Casual", desc: "Recall + single-step · full hints", color: "#86efac" },
  { id: "challenging", label: "Challenging", desc: "Application + analysis · limited hints", color: "#fcd34d" },
  { id: "rigorous", label: "Rigorous", desc: "Evaluate + synthesize · no hints", color: "#fca5a5" },
];

const FORMATS: { id: QuestionFormat; label: string; desc: string }[] = [
  { id: "mcq", label: "MCQ", desc: "Multiple choice only · max 50" },
  { id: "proof", label: "Proof-based", desc: "Typed rubric answers · max 15" },
  { id: "mixed", label: "Mixed", desc: "MCQ + constructed response · max 32" },
];

function flattenNodeIds(nodes: CurriculumNodeRecord[]): string[] {
  return nodes.flatMap((node) => [node.id, ...flattenNodeIds(node.children ?? [])]);
}

export function TestCenter({ onNotify, onGenerated }: Props) {
  const [subject, setSubject] = useState<SubjectKey>("physics");
  const [sources, setSources] = useState<RealPdfSource[]>([]);
  const [selectedSourceId, setSelectedSourceId] = useState<string>("");
  const [nodes, setNodes] = useState<CurriculumNodeRecord[]>([]);

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

  // Load real PDF sources from SQLite DB
  useEffect(() => {
    (async () => {
      const db = await getDb();
      const res = db.exec("SELECT id, name, page_count FROM curriculum_sources;");
      if (res[0]) {
        const loaded = res[0].values.map((row) => ({
          id: row[0] as string,
          name: row[1] as string,
          pageCount: row[2] as number,
        }));
        setSources(loaded);
        if (loaded.length > 0 && !selectedSourceId) {
          setSelectedSourceId(loaded[0].id);
        }
      } else {
        setSources([]);
        setSelectedSourceId("");
      }
    })();
  }, [selectedSourceId]);

  // Load real bookmarks/sections for chosen PDF source
  useEffect(() => {
    if (!selectedSourceId) return;
    (async () => {
      const tree = await getCurriculumTree(selectedSourceId);
      setNodes(tree);
      if (tree.length > 0) {
        setExpanded(new Set([tree[0].id]));
      }
    })();
  }, [selectedSourceId]);

  // Reset picks when source or mode changes
  useEffect(() => {
    setPicked(new Set());
  }, [selectedSourceId, mode]);

  const floor = minQuestions(format);
  const ceiling = maxQuestions(format);
  useEffect(() => {
    setCount((c) => Math.max(floor, Math.min(c, ceiling)));
  }, [floor, ceiling]);

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

  const allConceptIds = useMemo(() => flattenNodeIds(nodes), [nodes]);

  const effectivePicked = mode === "final" ? new Set(allConceptIds) : picked;

  const toggleConcept = (nodeId: string) => {
    if (mode === "final") return;
    setPicked((current) => {
      const next = new Set(current);
      if (mode === "module") {
        return next.has(nodeId) ? new Set<string>() : new Set([nodeId]);
      }
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  };

  const toggleSectionAll = (section: CurriculumNodeRecord) => {
    if (mode !== "custom") return;
    const ids = flattenNodeIds([section]);
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
      onNotify(mode === "module" ? "Pick one concept section first" : "Select at least one concept");
      return;
    }
    setElapsed(0);
    setRunning(true);
    onNotify(`Started ${MODES.find((m) => m.id === mode)!.label} · ${count} questions`);
  };

  const [generating, setGenerating] = useState(false);
  const [genProgress, setGenProgress] = useState<{ pct: number; stage: string }>({ pct: 0, stage: "" });

  const launch = async () => {
    if (!canStart) {
      onNotify(mode === "module" ? "Pick one concept section first" : "Select at least one concept");
      return;
    }
    if (!selectedSourceId) {
      onNotify("Upload and select a curriculum source first");
      return;
    }
    setGenerating(true);
    setGenProgress({ pct: 1, stage: "Starting…" });
    try {
      const result = await generateAssessment({
        subject,
        format,
        count,
        rigor,
        nodeIds: Array.from(effectivePicked),
        sourceName: selectedSource?.name,
        onProgress: (pct, stage) => setGenProgress({ pct, stage }),
      });
      onGenerated();
      onNotify(
        `Generated ${result.itemCount} grounded questions. Open Available tests when you are ready to start.`
      );
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "Test generation failed");
    } finally {
      setGenerating(false);
      setGenProgress({ pct: 0, stage: "" });
    }
  };

  const selectedSource = sources.find((s) => s.id === selectedSourceId);

  const renderConceptRows = (children: CurriculumNodeRecord[], depth = 1): ReactNode =>
    children.map((sub) => {
      const on = effectivePicked.has(sub.id);
      return (
        <div key={sub.id}>
          <button
            onClick={() => toggleConcept(sub.id)}
            disabled={mode === "final"}
            className="flex w-full items-center gap-2.5 border-t border-edge-soft px-3 py-2 text-left transition-colors hover:bg-white/[0.03] disabled:cursor-default"
            style={{ paddingLeft: `${Math.min(6, depth) * 18 + 22}px` }}
          >
            <span
              className={`grid h-[15px] w-[15px] shrink-0 place-items-center border transition-colors ${
                mode === "module" ? "rounded-full" : "rounded-[3px]"
              } ${on ? "border-accent bg-accent text-white" : "border-white/20"}`}
            >
              {on && <Check size={10} strokeWidth={3} />}
            </span>
            <span className={`truncate text-[12.5px] ${on ? "text-fg" : "text-mut"}`}>{sub.title}</span>
          </button>
          {sub.children?.length ? renderConceptRows(sub.children, depth + 1) : null}
        </div>
      );
    });

  return (
    <div className="mx-auto w-full max-w-[860px] px-5 pt-10 pb-20 select-none">
      <div className="mb-2 font-mono text-[10px] uppercase tracking-wider text-dim">Testing & Practice</div>
      <h1 className="mb-1 text-[36px] font-bold leading-tight tracking-tight text-fg">Take a test</h1>
      <p className="mb-7 text-[13.5px] text-dim">
        Build an exam from your uploaded PDF curriculum. Test generation & evaluator agents produce grounded items from cited evidence.
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

      {/* CURRICULUM SOURCE: Loaded from real uploaded PDFs in SQLite DB */}
      <Label>Curriculum source (Uploaded PDFs)</Label>
      <div className="mb-6 space-y-1.5">
        {sources.length === 0 && (
          <p className="rounded-md border border-dashed border-edge px-3 py-4 text-center text-[12.5px] text-dim">
            No curriculum PDF uploaded yet — click the + icon in the sidebar CURRICULUM menu to upload one.
          </p>
        )}
        {sources.map((src) => (
          <button
            key={src.id}
            onClick={() => setSelectedSourceId(src.id)}
            className={`flex w-full items-center gap-3 rounded-md border p-2.5 text-left transition-colors ${
              selectedSourceId === src.id ? "border-accent bg-accent/[0.07]" : "border-edge bg-raise hover:bg-white/[0.06]"
            }`}
          >
            <GraduationCap size={16} className="text-accent shrink-0" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-medium text-fg">{src.name}</span>
              <span className="block font-mono text-[10.5px] text-dim">
                {src.pageCount} pages · Ingested in SQLite
              </span>
            </span>
            {selectedSourceId === src.id && <Check size={14} className="text-accent shrink-0" />}
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

      {/* CONCEPTS TO BE TESTED: Rendered bookmarks of the PDF */}
      <Label>
        Concepts to be tested (Rendered Bookmarks)
        <span className="ml-2 font-mono text-[10px] normal-case text-dim">
          {mode === "final"
            ? `all ${allConceptIds.length} selected`
            : mode === "module"
            ? picked.size > 0
              ? "1 concept section selected"
              : "choose exactly one"
            : `${picked.size} selected`}
        </span>
      </Label>

      <div className={`mb-6 overflow-hidden rounded-md border border-edge bg-raise ${mode === "final" ? "opacity-60" : ""}`}>
        {nodes.length === 0 ? (
          <p className="px-4 py-6 text-center text-[12.5px] text-dim">
            {selectedSourceId
              ? "This curriculum has no indexed bookmarks yet — ingest its outline to test from specific sections."
              : "Select a curriculum source above to load its sections."}
          </p>
        ) : nodes.map((section, i) => {
          const open = expanded.has(section.id);
          const allSecIds = flattenNodeIds([section]);
          const allOn = allSecIds.every((id) => effectivePicked.has(id));

          return (
            <div key={section.id} className={i > 0 ? "border-t border-edge-soft" : ""}>
              <div className="flex items-center gap-2 bg-white/[0.02] px-3 py-2.5">
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
                <button
                  onClick={() => toggleConcept(section.id)}
                  disabled={mode === "final"}
                  className="flex items-center gap-2 min-w-0 flex-1 text-left"
                >
                  <span
                    className={`grid h-[15px] w-[15px] shrink-0 place-items-center border transition-colors ${
                      mode === "module" ? "rounded-full" : "rounded-[3px]"
                    } ${effectivePicked.has(section.id) ? "border-accent bg-accent text-white" : "border-white/20"}`}
                  >
                    {effectivePicked.has(section.id) && <Check size={10} strokeWidth={3} />}
                  </span>
                  <span className="truncate text-[13px] font-medium text-fg">{section.title}</span>
                </button>
                {mode === "custom" && (
                  <button
                    onClick={() => toggleSectionAll(section)}
                    className="rounded px-2 py-0.5 text-[11px] text-mut transition-colors hover:bg-white/[0.07] hover:text-fg"
                  >
                    {allOn ? "Clear" : "Select all"}
                  </button>
                )}
              </div>

              {open && section.children?.length ? <div>{renderConceptRows(section.children)}</div> : null}
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
          min={floor}
          max={ceiling}
          value={count}
          onChange={(e) => setCount(parseInt(e.target.value, 10))}
          className="flex-1 accent-accent"
        />
        <div className="flex items-center gap-1">
          <button
            onClick={() => setCount((c) => Math.max(floor, c - 1))}
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
            {selectedSource?.name ?? "no curriculum selected"}
          </div>
        </div>
        <button
          onClick={launch}
          disabled={!canStart || generating}
          className={`flex items-center gap-1.5 rounded-md px-4 py-2 text-[13px] font-medium transition-all ${
            canStart && !generating ? "bg-accent text-white hover:bg-accent-deep active:scale-[0.98]" : "bg-white/[0.06] text-faint"
          }`}
        >
          <Play size={13} fill="currentColor" />
          {generating ? "Generating…" : "Generate test"}
        </button>
      </div>

      {/* Dedicated, real progress bar for test generation. The harness reports an
          honest 0–100 estimate and a stage label per generation phase (evidence
          fetch → grounded item generation → validation → save); the bar only
          advances on real work, never a fake animation. */}
      {generating && (
        <div className="anim-fade-up -mt-3 mb-3 rounded-lg border border-edge bg-raise p-4">
          <div className="mb-2 flex items-center gap-2">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
            <span className="font-mono text-[11px] uppercase tracking-wider text-dim">
              {genProgress.stage || "Working…"}
            </span>
            <span className="ml-auto font-mono text-[10px] text-dim">{genProgress.pct}%</span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-edge">
            <div
              className="h-full rounded-full bg-accent transition-[width] duration-300 ease-out"
              style={{ width: `${Math.max(2, genProgress.pct)}%` }}
            />
          </div>
        </div>
      )}
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
