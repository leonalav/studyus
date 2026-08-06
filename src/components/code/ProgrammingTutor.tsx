/**
 * Frontend binding for the programming tutor.
 *
 * §15.4 contract: this file contains NO grading, NO selection, NO mastery
 * arithmetic, NO fade decisions, NO tier logic. It matches on `View`,
 * renders it, and sends `Input`s — everything pedagogical lives in
 * src/core. A GUI could be written against the identical Session API.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  Check,
  ChevronRight,
  Eye,
  LifeBuoy,
  Lock,
  Map as MapIcon,
  Play,
  RotateCcw,
  Terminal,
} from "lucide-react";
import { Session } from "../../core/session";
import { LocalStorageStore, exportLearnerData, resetLearnerData } from "../../store/local";
import { STUDYUS_PYTHON_PACK, CUSTOM_DETECTORS } from "../../pack/studyus-python";
import { VOICE_EN } from "../../pack/voice-en";
import type { ExercisePrompt, ExerciseReveal, Input, Response, TraceStep, View } from "../../core/types";
import { BeatChip, CodeBlock, ScaffoldChip, TierChip } from "./bits";

interface Props {
  onNotify: (text: string) => void;
  curriculum?: string;
}

export function ProgrammingTutor({ onNotify, curriculum }: Props) {
  const sessionRef = useRef<Session | null>(null);
  const [view, setView] = useState<View | null>(null);
  const promptShownAt = useRef(Date.now());

  useEffect(() => {
    const session = Session.open({
      pack: STUDYUS_PYTHON_PACK,
      store: new LocalStorageStore(),
      voice: VOICE_EN,
      customDetectors: CUSTOM_DETECTORS,
    });
    sessionRef.current = session;
    setView(session.view());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    promptShownAt.current = Date.now();
  }, [view?.kind]);

  const send = (input: Input) => {
    const session = sessionRef.current;
    if (!session) return;
    try {
      const transition = session.input(input);
      setView(transition.view);
    } catch (error) {
      onNotify((error as Error).message);
    }
  };

  if (!view) return null;

  return (
    <div className="flex min-h-0 flex-1 w-full flex-col px-5 pb-4 pt-3">
      <Header view={view} curriculum={curriculum} onMap={() => send({ type: "open-map" })} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        {view.kind === "cold-open" && (
          <CommitForm
            key={view.prompt.exerciseId}
            prompt={view.prompt}
            cold
            onCommit={(response) => send({ type: "commit", response, elapsedMs: Date.now() - promptShownAt.current })}
            onSofter={() => send({ type: "request-scaffold" })}
          />
        )}
        {view.kind === "prompting" && (
          <CommitForm
            key={view.prompt.exerciseId + view.prompt.scaffold}
            prompt={view.prompt}
            onCommit={(response) => send({ type: "commit", response, elapsedMs: Date.now() - promptShownAt.current })}
            onSofter={() => send({ type: "request-scaffold" })}
            onSkip={() => send({ type: "skip" })}
          />
        )}
        {view.kind === "revealed" && <RevealView reveal={view.reveal} onContinue={() => send({ type: "continue" })} />}
        {view.kind === "reading" && (
          <ReadingView title={view.tier3.title} body={view.tier3.body} disclaimer={view.disclaimer} onContinue={() => send({ type: "continue" })} />
        )}
        {view.kind === "map" && <MapView view={view} onClose={() => send({ type: "close-map" })} />}
        {view.kind === "done" && (
          <DoneView reason={view.summary.reason} mastered={view.summary.masteredTitles} onAgain={() => send({ type: "continue" })} />
        )}
      </div>
    </div>
  );
}

/* ── header — beat, skill, tier on every prompt (§15.3) ── */

function Header({ view, curriculum, onMap }: { view: View; curriculum?: string; onMap: () => void }) {
  if (view.kind === "cold-open") {
    return (
      <div className="mb-3 flex items-center gap-2.5">
        <span className="rounded-full border border-edge bg-raise px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-mut">
          Studyus · programming
        </span>
        {curriculum && (
          <span className="max-w-[260px] truncate rounded-full border border-[#fcd34d]/20 bg-[#fcd34d]/[0.06] px-2 py-0.5 font-mono text-[10px] text-[#fcd34d]/90" title={curriculum}>
            {curriculum}
          </span>
        )}
      </div>
    );
  }
  const beat = view.kind === "prompting" ? view.beat : view.kind === "revealed" ? view.reveal.beat : view.kind === "map" ? view.beat : undefined;
  const tier = view.kind === "prompting" ? view.tier : view.kind === "revealed" ? view.reveal.tier : undefined;
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <span className="rounded-full border border-edge bg-raise px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-mut">
        Studyus · programming
      </span>
      {beat && <BeatChip beat={beat} />}
      {tier && <TierChip tier={tier} />}
      {view.kind === "prompting" && <ScaffoldChip scaffold={view.prompt.scaffold} />}
      {curriculum && (
        <span className="max-w-[240px] truncate rounded-full border border-[#fcd34d]/20 bg-[#fcd34d]/[0.06] px-2 py-0.5 font-mono text-[10px] text-[#fcd34d]/90" title={curriculum}>
          {curriculum}
        </span>
      )}
      {(view.kind === "prompting" || view.kind === "revealed" || view.kind === "reading") && (
        <button
          onClick={onMap}
          className="ml-auto flex items-center gap-1.5 rounded-md border border-edge bg-raise px-2.5 py-1 font-mono text-[11px] text-mut transition-colors hover:bg-white/[0.07] hover:text-fg"
        >
          <MapIcon size={12} />
          capability map
        </button>
      )}
    </div>
  );
}

/* ── the commitment surface (all four beats) ── */

function CommitForm({
  prompt,
  cold = false,
  onCommit,
  onSofter,
  onSkip,
}: {
  prompt: ExercisePrompt;
  cold?: boolean;
  onCommit: (response: Response) => void;
  onSofter?: () => void;
  onSkip?: () => void;
}) {
  const [text, setText] = useState("");
  const [choice, setChoice] = useState<string | null>(null);
  const [fills, setFills] = useState<string[]>(() => Array(prompt.body.kind === "modify" ? prompt.body.holeCount : 0).fill(""));
  const [source, setSource] = useState("");
  const [dryRun, setDryRun] = useState("");

  const body = prompt.body;
  const committed =
    body.kind === "predict"
      ? text.trim().length > 0 || choice !== null
      : body.kind === "explain"
      ? text.trim().length > 0
      : body.kind === "modify"
      ? fills.some((f) => f.trim().length > 0)
      : source.trim().length > 0 && dryRun.trim().length > 0;

  const commit = () => {
    if (!committed) return;
    if (body.kind === "predict") {
      const chosen = choice !== null ? prompt.choices?.find((c) => c.id === choice)?.text ?? "" : "";
      onCommit({ kind: "text", text: chosen || text });
    } else if (body.kind === "explain") {
      onCommit({ kind: "text", text });
    } else if (body.kind === "modify") {
      onCommit({ kind: "holes", fills });
    } else {
      onCommit({ kind: "source", source, dryRun });
    }
  };

  // §15.3 sessions are short: Ctrl/Cmd+Enter commits without leaving the keyboard
  const onKeyCommit = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      commit();
    }
  };

  return (
    <div className={`mx-auto grid w-full gap-4 ${body.kind === "write" ? "lg:grid-cols-[minmax(0,1fr)_360px]" : "lg:grid-cols-[300px_minmax(0,1fr)_340px]"}`}>
      {/* left — the task, and nothing else before commitment */}
      <div className="flex flex-col gap-3">
        {!cold && (
          <div className="rounded-lg border border-edge bg-raise p-4">
            <div className="mb-1 font-mono text-[10px] uppercase tracking-wider text-dim">{prompt.skillTitle}</div>
            {body.kind === "modify" && <p className="text-[13px] leading-relaxed text-mut">{body.targetBehaviour}</p>}
            {body.kind === "write" && <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-mut">{body.specification}</p>}
            {body.kind === "write" && body.signatureHint && (
              <p className="mt-2 rounded border border-[#7dd3fc]/20 bg-[#7dd3fc]/[0.05] px-2.5 py-1.5 text-[12px] text-[#7dd3fc]/90">
                {body.signatureHint}
              </p>
            )}
          </div>
        )}
        {prompt.workedSibling && (
          <div className="rounded-lg border border-edge bg-raise p-3">
            <div className="mb-1 font-mono text-[10px] uppercase tracking-wider text-dim">a sibling, already committed on</div>
            <CodeBlock code={prompt.workedSibling.program} />
            <p className="mt-1 text-[11.5px] text-dim">{prompt.workedSibling.note}</p>
          </div>
        )}
        <div className="rounded-lg border border-edge bg-raise p-4">
          <div className="mb-2 flex items-center gap-2">
            <Lock size={11} className="text-faint" />
            <span className="font-mono text-[10px] uppercase tracking-wider text-dim">nothing is revealed until you commit</span>
          </div>
          <p className="text-[12.5px] leading-relaxed text-dim">
            {body.kind === "predict" && body.question}
            {body.kind === "explain" && body.instruction}
            {body.kind === "modify" && "Fill the blanks so the program reaches the target. Your fills are checked against the recorded run."}
            {body.kind === "write" && "Write the program, then dry-run it yourself: what does it print for the input below?"}
          </p>
          {body.kind === "write" && (
            <div className="mt-2 rounded border border-edge bg-black/30 px-2.5 py-2 font-mono text-[12px] text-fg">
              input: <span className="text-[#7dd3fc]">{body.dryRunInput.replace(/\n/g, " ⏎ ")}</span>
            </div>
          )}
        </div>
      </div>

      {/* middle — the program (or the blank page) */}
      <div onKeyDown={onKeyCommit} className="flex min-h-[280px] flex-col rounded-lg border border-edge bg-[#141414]">
        <div className="flex items-center gap-2 border-b border-edge px-3 py-2">
          <Terminal size={11} className="text-dim" />
          <span className="font-mono text-[10px] uppercase tracking-wider text-dim">
            {body.kind === "write" ? "blank file" : body.kind === "modify" ? "program with holes" : "one code block"}
          </span>
          <span className="ml-auto font-mono text-[10px] text-dim">precomputed · local-only</span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {body.kind === "predict" && <CodeBlock code={body.program} />}
          {body.kind === "explain" && <CodeBlock code={body.program} />}
          {body.kind === "modify" && (
            <HolesProgram programWithHoles={body.programWithHoles} fills={fills} setFills={setFills} />
          )}
          {body.kind === "write" && (
            <textarea
              value={source}
              onChange={(e) => setSource(e.target.value)}
              placeholder={"# write from blank\n# no starter, no hints"}
              spellCheck={false}
              className="h-[260px] w-full resize-none rounded border border-edge bg-black/30 px-3 py-2.5 font-mono text-[13px] leading-relaxed text-fg outline-none placeholder:text-faint focus:border-accent/60"
            />
          )}
        </div>

        {/* the gate */}
        <div className="border-t border-edge p-3">
          {body.kind === "predict" && prompt.choices && (
            <div className="mb-2 grid grid-cols-2 gap-1.5">
              {prompt.choices.map((c) => (
                <button
                  key={c.id}
                  onClick={() => {
                    setChoice(c.id);
                    setText("");
                  }}
                  className={`rounded border px-2 py-1.5 text-left font-mono text-[11px] transition-colors ${
                    choice === c.id ? "border-accent bg-accent/10 text-fg" : "border-edge bg-raise text-mut hover:text-fg"
                  }`}
                >
                  {c.text}
                </button>
              ))}
            </div>
          )}
          {(body.kind === "predict" || body.kind === "explain") && (
            <textarea
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                setChoice(null);
              }}
              placeholder={body.kind === "predict" ? "the exact output you expect…" : "one sentence — its purpose, not its lines…"}
              className="mb-2 h-[64px] w-full resize-none rounded border border-edge bg-black/30 px-2.5 py-2 font-mono text-[12px] text-fg outline-none placeholder:text-faint focus:border-accent/60"
            />
          )}
          {body.kind === "write" && (
            <input
              value={dryRun}
              onChange={(e) => setDryRun(e.target.value)}
              placeholder="your program's output for the shown input…"
              className="mb-2 w-full rounded border border-edge bg-black/30 px-2.5 py-2 font-mono text-[12px] text-fg outline-none placeholder:text-faint focus:border-accent/60"
            />
          )}
          <div className="flex items-center gap-2">
            {onSofter && (
              <button
                onClick={onSofter}
                title="Ask for a softer shape of the same question — it is recorded, and it affects fading."
                className="flex items-center gap-1.5 rounded-md border border-edge px-2.5 py-2 text-[12px] text-mut transition-colors hover:bg-white/[0.07] hover:text-fg"
              >
                <LifeBuoy size={12} />
                softer
              </button>
            )}
            {!cold && onSkip && (
              <button
                onClick={onSkip}
                className="rounded-md border border-edge px-2.5 py-2 text-[12px] text-mut transition-colors hover:bg-white/[0.07] hover:text-fg"
              >
                skip
              </button>
            )}
            <button
              onClick={commit}
              disabled={!committed}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-md py-2 text-[13px] font-medium transition-all ${
                committed
                  ? "bg-accent text-white hover:bg-accent-deep active:scale-[0.99]"
                  : "cursor-not-allowed bg-white/[0.06] text-faint"
              }`}
            >
              {committed ? <Play size={13} fill="currentColor" /> : <Lock size={12} />}
              {committed ? "Commit" : "Commit to unlock the reveal"}
            </button>
          </div>
        </div>
      </div>

      {/* right — deliberately empty before commitment (Law 1) */}
      {body.kind !== "write" && (
        <div className="flex flex-col rounded-lg border border-edge bg-[#141414]">
          <div className="flex items-center gap-2 border-b border-edge px-3 py-2">
            <Eye size={11} className="text-dim" />
            <span className="font-mono text-[10px] uppercase tracking-wider text-dim">reveal</span>
          </div>
          <div className="grid flex-1 place-items-center px-4 py-12 text-center">
            <div>
              <Lock size={18} className="mx-auto mb-2 text-faint" />
              <p className="text-[12px] text-dim">The outcome stays hidden until you commit. That gap is the lesson.</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function HolesProgram({
  programWithHoles,
  fills,
  setFills,
}: {
  programWithHoles: string;
  fills: string[];
  setFills: (fills: string[]) => void;
}) {
  // split each line on ___ and render inline inputs — presentation only
  const lines = programWithHoles.split("\n");
  let holeIndex = 0;
  return (
    <pre className="font-mono text-[13px] leading-[2.1]">
      {lines.map((line, i) => {
        const parts = line.split("___");
        return (
          <div key={i} className="flex items-center gap-3 rounded px-1">
            <span className="w-5 shrink-0 select-none text-right text-dim">{i + 1}</span>
            <span className="flex flex-wrap items-center gap-1 whitespace-pre text-fg/90">
              {parts.map((part, pi) => {
                const idx = holeIndex;
                if (pi < parts.length - 1) holeIndex += 1;
                return (
                  <span key={pi} className="flex items-center gap-1 whitespace-pre">
                    {part}
                    {pi < parts.length - 1 && (
                      <input
                        value={fills[idx] ?? ""}
                        onChange={(e) => {
                          const next = [...fills];
                          next[idx] = e.target.value;
                          setFills(next);
                        }}
                        aria-label={`hole ${idx + 1}`}
                        className="w-24 rounded border border-accent/40 bg-accent/[0.07] px-1.5 py-0.5 font-mono text-[12px] text-fg outline-none focus:border-accent"
                      />
                    )}
                  </span>
                );
              })}
            </span>
          </div>
        );
      })}
    </pre>
  );
}

/* ── the reveal — only reachable through a commit ── */

function RevealView({ reveal, onContinue }: { reveal: ExerciseReveal; onContinue: () => void }) {
  const [step, setStep] = useState(0);
  const [deeper, setDeeper] = useState(false);
  const outcome = reveal.judgement.outcome;
  const passed = outcome.kind === "correct" || (outcome.kind === "partial" && outcome.score >= 0.6);
  const tone = passed ? "#86efac" : "#fca5a5";

  return (
    <div className="mx-auto grid w-full max-w-[1200px] gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
      <div className="flex flex-col gap-3">
        {/* the tutor line at the moment of contradiction or confirmation */}
        <div className="rounded-lg border p-4" style={{ borderColor: `${tone}55`, background: `${tone}0d` }}>
          <div className="mb-2 flex items-center gap-2">
            <span className="font-mono text-[10px] uppercase tracking-wider text-dim">tutor</span>
            <span
              className="rounded-full px-1.5 py-[1px] font-mono text-[9.5px]"
              style={{ background: `${tone}22`, color: tone }}
            >
              {outcome.kind === "correct" ? "matched" : outcome.kind === "partial" ? `partial ${outcome.score}` : outcome.kind === "ungraded" ? "try again" : "gap"}
            </span>
          </div>
          <p className="text-[14px] leading-relaxed text-fg/95">{reveal.tutorLine}</p>
          {reveal.confidenceNote && (
            <p className="mt-3 rounded border border-[#7dd3fc]/20 bg-[#7dd3fc]/[0.05] px-2.5 py-2 text-[11.5px] leading-relaxed text-[#7dd3fc]/90">
              {reveal.confidenceNote}
            </p>
          )}
          {reveal.surfaceNote && (
            <p className="mt-2 text-[11.5px] leading-relaxed text-dim">{reveal.surfaceNote}</p>
          )}
        </div>

        {/* beat-specific evidence */}
        {reveal.beat === "predict" && reveal.trace && (
          <TraceScrubber trace={reveal.trace} step={step} setStep={setStep} actual={reveal.actual} />
        )}
        {reveal.beat === "explain" && reveal.exemplar && (
          <div className="rounded-lg border border-edge bg-raise p-4">
            <div className="mb-1 font-mono text-[10px] uppercase tracking-wider text-dim">compare yours to this</div>
            <p className="text-[13px] leading-relaxed text-fg/90">{reveal.exemplar}</p>
          </div>
        )}
        {reveal.beat === "modify" && (
          <div className="rounded-lg border border-edge bg-raise p-4">
            <div className="mb-1 font-mono text-[10px] uppercase tracking-wider text-dim">the target's recorded output</div>
            <pre className="rounded border border-edge bg-black/40 px-2.5 py-2 font-mono text-[12px] text-[#86efac]">{reveal.targetOutput}</pre>
            {!passed && (
              <p className="mt-2 text-[12px] text-mut">
                {reveal.failingHoleIndices?.length ?? 0} of the blanks miss the target. The correct fills stay hidden — the output is the clue.
              </p>
            )}
          </div>
        )}
        {reveal.beat === "write" && (
          <div className="rounded-lg border border-edge bg-raise p-4">
            <div className="mb-1 font-mono text-[10px] uppercase tracking-wider text-dim">structural verdict — your code was not executed</div>
            <p className="font-mono text-[13px] text-fg">
              {reveal.checksPassed} of {reveal.checksTotal} checks satisfied
            </p>
            {!passed && reveal.firstFailure && (
              <div className="mt-2 rounded border border-[#fca5a5]/30 bg-black/20 p-2.5">
                <div className="mb-1 font-mono text-[9.5px] uppercase tracking-wider text-[#fca5a5]">the first unmet check — nothing else</div>
                <p className="text-[12.5px] text-fg">{reveal.firstFailure.label}</p>
                {reveal.firstFailure.expected && (
                  <p className="mt-1 font-mono text-[11.5px] text-mut">
                    expected: {reveal.firstFailure.expected} · yours: {reveal.firstFailure.got}
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        <div className="flex items-center gap-2">
          {reveal.deeperLine && (
            <button
              onClick={() => setDeeper((d) => !d)}
              className="flex items-center gap-1.5 rounded-md border border-edge px-3 py-2 text-[12.5px] text-mut transition-colors hover:bg-white/[0.07] hover:text-fg"
            >
              <ChevronRight size={12} />
              {deeper ? "one level up" : "go one level deeper"}
            </button>
          )}
          <button
            onClick={onContinue}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-md bg-accent py-2 text-[13px] font-medium text-white transition-colors hover:bg-accent-deep"
          >
            Continue
            <ArrowRight size={13} />
          </button>
        </div>
        {deeper && reveal.deeperLine && (
          <div className="rounded-lg border border-edge bg-raise p-3 text-[12.5px] leading-relaxed text-mut">{reveal.deeperLine}</div>
        )}
      </div>

      {/* right column — misconception and honest limits */}
      <div className="flex flex-col gap-3">
        {reveal.matchedMisconception && (
          <div className="rounded-lg border border-[#fca5a5]/30 bg-black/20 p-3">
            <div className="mb-1 font-mono text-[9.5px] uppercase tracking-wider text-[#fca5a5]">a familiar model, detected</div>
            <div className="text-[12.5px] font-medium text-fg">{reveal.misconceptionLabel}</div>
            <p className="mt-1 text-[11.5px] leading-relaxed text-mut">{reveal.misconceptionHelp}</p>
          </div>
        )}
        <div className="rounded-lg border border-edge bg-raise p-3">
          <div className="mb-1 font-mono text-[10px] uppercase tracking-wider text-dim">grading honesty</div>
          <p className="text-[11.5px] leading-relaxed text-mut">
            {reveal.judgement.confidence === "exact" &&
              "This verdict came from recorded ground truth — an exact check."}
            {reveal.judgement.confidence === "heuristic" &&
              "This verdict came from matching, not understanding — the caveat above applies."}
            {reveal.judgement.confidence === "none" && "No gate here — nothing was graded."}
          </p>
        </div>
      </div>
    </div>
  );
}

function TraceScrubber({ trace, step, setStep, actual }: { trace: TraceStep[]; step: number; setStep: (n: number) => void; actual: string }) {
  const current = trace[Math.min(step, trace.length - 1)];
  return (
    <div className="rounded-lg border border-edge bg-raise p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-mono text-[10px] uppercase tracking-wider text-dim">step through the recorded run</span>
        <span className="font-mono text-[10px] text-dim">
          {Math.min(step, trace.length - 1) + 1}/{trace.length}
        </span>
      </div>
      <input
        type="range"
        min={0}
        max={trace.length - 1}
        value={Math.min(step, trace.length - 1)}
        onChange={(e) => setStep(parseInt(e.target.value, 10))}
        aria-label="Execution step"
        className="mb-3 w-full accent-accent"
      />
      <div className="grid gap-2 sm:grid-cols-2">
        <div>
          <div className="mb-1 font-mono text-[9.5px] uppercase tracking-wider text-dim">bindings</div>
          <div className="space-y-1">
            {Object.entries(current?.vars ?? {}).map(([key, value]) => (
              <div key={key} className="flex items-center gap-2 rounded bg-black/25 px-2 py-1 font-mono text-[11px]">
                <span className="text-[#7dd3fc]">{key}</span>
                <span className="text-dim">=</span>
                <span className="truncate text-fg">{value}</span>
              </div>
            ))}
            {Object.keys(current?.vars ?? {}).length === 0 && <p className="font-mono text-[10.5px] text-faint">no bindings yet</p>}
          </div>
        </div>
        <div>
          <div className="mb-1 font-mono text-[9.5px] uppercase tracking-wider text-dim">printed so far</div>
          <pre className="min-h-[42px] whitespace-pre-wrap rounded border border-edge bg-black/40 px-2.5 py-2 font-mono text-[11px] text-[#86efac]">
            {(current?.stdout ?? []).join("\n") || "nothing yet"}
          </pre>
          <p className="mt-1 font-mono text-[10px] text-dim">final: {actual.replace(/\n/g, " ⏎ ")}</p>
        </div>
      </div>
      {current?.note && <p className="mt-2 text-[11.5px] text-mut">{current.note}</p>}
    </div>
  );
}

/* ── Tier 3 reading — ungated, and saying so out loud (Law 8) ── */

function ReadingView({ title, body, disclaimer, onContinue }: { title: string; body: string[]; disclaimer: string; onContinue: () => void }) {
  return (
    <div className="mx-auto w-full max-w-[680px]">
      <div className="mb-4 rounded-lg border border-[#fcd34d]/25 bg-[#fcd34d]/[0.05] px-4 py-3">
        <p className="text-[12.5px] italic leading-relaxed text-[#fcd34d]/90">“{disclaimer}”</p>
      </div>
      <h2 className="mb-3 text-[22px] font-semibold text-fg">{title}</h2>
      <div className="space-y-3">
        {body.map((paragraph, i) => (
          <p key={i} className="text-[14px] leading-relaxed text-mut">
            {paragraph}
          </p>
        ))}
      </div>
      <button
        onClick={onContinue}
        className="mt-6 flex w-full items-center justify-center gap-1.5 rounded-md bg-accent py-2 text-[13px] font-medium text-white transition-colors hover:bg-accent-deep"
      >
        Read it. Move on.
        <ArrowRight size={13} />
      </button>
    </div>
  );
}

/* ── the capability map — the only ascending display (Law 4) ── */

function MapView({ view, onClose }: { view: Extract<View, { kind: "map" }>; onClose: () => void }) {
  const map = view.capability;
  const depth = useMemo(() => {
    const byId = new Map(map.nodes.map((n) => [n.id, n]));
    const cache = new Map<string, number>();
    const of = (id: string): number => {
      if (cache.has(id)) return cache.get(id)!;
      const node = byId.get(id);
      if (!node || node.prerequisites.length === 0) {
        cache.set(id, 0);
        return 0;
      }
      const d = 1 + Math.max(...node.prerequisites.map(of));
      cache.set(id, d);
      return d;
    };
    map.nodes.forEach((n) => of(n.id));
    return cache;
  }, [map]);
  const columns = useMemo(() => {
    const cols = new Map<number, typeof map.nodes>();
    for (const node of map.nodes) {
      const d = depth.get(node.id) ?? 0;
      if (!cols.has(d)) cols.set(d, []);
      cols.get(d)!.push(node);
    }
    return [...cols.entries()].sort((a, b) => a[0] - b[0]).map(([, nodes]) => nodes);
  }, [map, depth]);

  const stateStyle: Record<string, string> = {
    locked: "border-edge bg-raise opacity-50",
    open: "border-edge bg-raise",
    "in-progress": "border-accent/50 bg-accent/[0.06]",
    mastered: "border-[#86efac]/50 bg-[#86efac]/[0.06]",
  };
  const stateLabel: Record<string, string> = {
    locked: "locked",
    open: "open",
    "in-progress": "in progress",
    mastered: "you can do this now",
  };

  return (
    <div className="mx-auto w-full max-w-[980px]">
      <div className="mb-4 flex items-center gap-2">
        <p className="text-[12.5px] text-dim">What you can now do — skills, not scores. No numbers ascend here but capability.</p>
        <button
          onClick={onClose}
          className="ml-auto flex items-center gap-1.5 rounded-md border border-edge bg-raise px-3 py-1.5 text-[12px] text-mut transition-colors hover:bg-white/[0.07] hover:text-fg"
        >
          <RotateCcw size={12} />
          {view.resume ? "back to the question" : "back"}
        </button>
      </div>

      <div className="mb-5 flex flex-wrap gap-3">
        {columns.map((nodes, ci) => (
          <div key={ci} className="flex min-w-[200px] flex-1 flex-col gap-2">
            {nodes.map((node) => (
              <div key={node.id} className={`rounded-lg border p-3 ${stateStyle[node.state]}`}>
                <div className="mb-1 flex items-center gap-1.5">
                  {node.state === "locked" ? (
                    <Lock size={10} className="text-dim" />
                  ) : node.state === "mastered" ? (
                    <Check size={11} className="text-[#86efac]" strokeWidth={3} />
                  ) : (
                    <span className={`h-1.5 w-1.5 rounded-full ${node.state === "in-progress" ? "bg-accent" : "bg-dim"}`} />
                  )}
                  <span className="font-mono text-[9px] uppercase tracking-wider text-dim">{stateLabel[node.state]}</span>
                </div>
                <div className="text-[13px] font-medium leading-snug text-fg">{node.title}</div>
                <div className="mt-1 font-mono text-[10px] text-dim">{node.concepts.join(" · ")}</div>
              </div>
            ))}
          </div>
        ))}
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-lg border border-edge bg-raise p-3">
          <div className="mb-2 font-mono text-[10px] uppercase tracking-wider text-dim">readings — no gate, by design</div>
          {map.readings.map((r) => (
            <div key={r.id} className="flex items-center gap-2 py-1 text-[12px]">
              <span className={`h-1.5 w-1.5 rounded-full ${r.readAt ? "bg-[#86efac]" : "bg-white/15"}`} />
              <span className="text-mut">{r.title}</span>
              <span className="ml-auto font-mono text-[10px] text-dim">{r.readAt ? "read · returns in a week" : "unread"}</span>
            </div>
          ))}
        </div>
        <div className="rounded-lg border border-edge bg-raise p-3">
          <div className="mb-2 font-mono text-[10px] uppercase tracking-wider text-dim">two local signals — nothing else is measured</div>
          <div className="flex items-center gap-2 py-1 text-[12px] text-mut">
            <span className={`h-1.5 w-1.5 rounded-full ${map.signals.firstQuestionAnswered ? "bg-[#86efac]" : "bg-white/15"}`} />
            first question answered
          </div>
          <div className="flex items-center gap-2 py-1 text-[12px] text-mut">
            <span className={`h-1.5 w-1.5 rounded-full ${map.signals.returnedWithin24h ? "bg-[#86efac]" : "bg-white/15"}`} />
            returned the next day
          </div>
          <div className="mt-2 border-t border-edge-soft pt-2">
            {map.runtimeStatus.map((line, i) => (
              <p key={i} className="py-0.5 text-[11px] leading-relaxed text-dim">
                {line}
              </p>
            ))}
          </div>
          <div className="mt-3 flex items-center gap-2 border-t border-edge-soft pt-3">
            <button
              onClick={() => {
                const blob = new Blob([exportLearnerData()], { type: "application/json" });
                const url = URL.createObjectURL(blob);
                const anchor = document.createElement("a");
                anchor.href = url;
                anchor.download = "studyus-learner-data.json";
                anchor.click();
                URL.revokeObjectURL(url);
              }}
              className="rounded border border-edge px-2 py-1 font-mono text-[10.5px] text-mut transition-colors hover:bg-white/[0.07] hover:text-fg"
            >
              export my data
            </button>
            <button
              onClick={() => {
                if (window.confirm("Wipe all local learner data? This cannot be undone.")) {
                  resetLearnerData();
                  window.location.reload();
                }
              }}
              className="rounded border border-edge px-2 py-1 font-mono text-[10.5px] text-mut transition-colors hover:bg-white/[0.07] hover:text-fg"
            >
              reset
            </button>
            <span className="ml-auto font-mono text-[9.5px] text-faint">everything stays on this device</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── done — spacing, not celebration ── */

function DoneView({ reason, mastered, onAgain }: { reason: string; mastered: string[]; onAgain: () => void }) {
  return (
    <div className="mx-auto w-full max-w-[560px] pt-8 text-center">
      <p className="text-[14px] leading-relaxed text-mut">{reason}</p>
      {mastered.length > 0 && (
        <div className="mx-auto mt-6 max-w-[380px] rounded-lg border border-[#86efac]/30 bg-[#86efac]/[0.05] p-4 text-left">
          <div className="mb-2 font-mono text-[10px] uppercase tracking-wider text-[#86efac]">what you can now do</div>
          {mastered.map((title) => (
            <div key={title} className="flex items-center gap-2 py-0.5 text-[13px] text-fg">
              <Check size={12} className="text-[#86efac]" strokeWidth={3} />
              {title}
            </div>
          ))}
        </div>
      )}
      <button
        onClick={onAgain}
        className="mx-auto mt-6 flex items-center gap-1.5 rounded-md border border-edge bg-raise px-4 py-2 text-[12.5px] text-mut transition-colors hover:bg-white/[0.07] hover:text-fg"
      >
        <RotateCcw size={12} />
        check again
      </button>
    </div>
  );
}
