import { useEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import {
  PenLine,
  RotateCcw,
  ChevronDown,
  Volume2,
  Copy,
  ArrowUp,
  Check,
  Paperclip,
  Image as ImageIcon,
  Mic,
  AtSign,
  X,
} from "lucide-react";
import {
  renderOnboardingQuestions,
  pairOnboardingReply,
  type Intent,
  type OnboardingAnswers,
  type OnboardingQuestion,
} from "../data/tutor";
import { generateOnboardingQuestions, transcribeNode } from "../api";
import { countBoundAgents } from "../lib/agentRuntime";
import { SUBJECT_LIST, type SubjectKey } from "../data/curriculum";
import { startLiveDictation, type LiveDictation } from "../lib/voice";
import { useCurricula, type StoredCurriculum } from "../state/curriculumStore";
import type { CurriculumStudySelection } from "../types/curriculumStudy";

interface Msg {
  id: number;
  role: "tutor" | "user";
  text: string;
}

/** Onboarding is delivered through the chat itself, not a bolted-on form, and
 *  the questions are written by the tutor agent for the concept the learner
 *  picked — there is no fixed question script. After the first prompt Studyus
 *  asks the agent for an interview, posts it as a normal tutor message, and the
 *  learner replies in the same chat input (one answer per line). Those answers
 *  are paired back onto the generated questions and threaded to the tutor as a
 *  consistent system reminder for the session. */
type OnboardingStage = "idle" | "generating" | "asking" | "preparing" | "done";

interface PendingOnboarding {
  concept: string;
  agentCount: number;
  boundNodes: string[];
  prompt: string;
  questions: OnboardingQuestion[];
}

type Depth = "auto" | "simple" | "detailed";

interface Props {
  notify: (text: string) => void;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  onPrepare: (prompt: string, boundNodes?: string[], onboarding?: OnboardingAnswers) => void;
  selectedSection?: CurriculumStudySelection | null;
  onSelectedSectionChange?: (selection: CurriculumStudySelection | null) => void;
}

const DEPTHS: { id: Depth; label: string; desc: string }[] = [
  { id: "auto", label: "Auto", desc: "Adapts to the question" },
  { id: "simple", label: "Simple", desc: "Two-sentence answers" },
  { id: "detailed", label: "Detailed", desc: "Full reasoning + next steps" },
];

const COMMANDS: { token: string; label: string; desc: string; intent: Intent; depth?: Depth }[] = [
  { token: "explain", label: "Explain", desc: "Break the idea down step by step", intent: "explain" },
  { token: "practice", label: "Practice", desc: "Generate a problem and check my work", intent: "practice" },
  { token: "quiz", label: "Quiz", desc: "Test me with a quick question", intent: "quiz" },
  { token: "simplify", label: "Simplify", desc: "Use a shorter, clearer explanation", intent: "explain", depth: "simple" },
  { token: "notes", label: "Notes", desc: "Turn this topic into key points", intent: "explain" },
  { token: "focus", label: "Focus", desc: "Pull out the one idea to remember", intent: "explain", depth: "simple" },
];

export function SessionCard({
  notify,
  inputRef,
  onPrepare,
  selectedSection = null,
  onSelectedSectionChange,
}: Props) {
  const { curricula } = useCurricula();
  const [started, setStarted] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [typing, setTyping] = useState(false);
  const [input, setInput] = useState("");
  const [notesOpen, setNotesOpen] = useState(false);
  const [notes, setNotes] = useState<string[]>([]);
  const [depth, setDepth] = useState<Depth>("auto");
  const [depthOpen, setDepthOpen] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [focused, setFocused] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [recording, setRecording] = useState(false);
  const [attachments, setAttachments] = useState<string[]>([]);
  const [commandPosition, setCommandPosition] = useState({ left: 0, top: 0 });
  const [ctxSubject, setCtxSubject] = useState<SubjectKey | null>(null);
  const [ctxDoc, setCtxDoc] = useState<string | null>(null);
  const [ctxSubsection, setCtxSubsection] = useState<string | null>(null);
  const [onboardingStage, setOnboardingStage] = useState<OnboardingStage>("idle");
  const [pendingOnboarding, setPendingOnboarding] = useState<PendingOnboarding | null>(null);
  /** Real preparation progress shown in the chatbox after onboarding answers:
   *  transcribing the chosen subsection + readying the chalkboard. */
  const [prep, setPrep] = useState<{ pct: number; stage: string }>({ pct: 0, stage: "" });

  const idRef = useRef(0);
  const timersRef = useRef<number[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const depthRef = useRef<HTMLDivElement>(null);
  const commandRef = useRef<HTMLDivElement>(null);
  const commandButtonRef = useRef<HTMLButtonElement>(null);
  const paletteRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const imageRef = useRef<HTMLInputElement>(null);
  const dictationRef = useRef<LiveDictation | null>(null);

  useEffect(() => () => dictationRef.current?.stop(), []);

  // Input is locked while the tutor drafts questions, while the preparation
  // pass runs, and whenever the tutor is typing — no second submit can slip in.
  const busy = typing || onboardingStage === "generating" || onboardingStage === "preparing";

  // A concept picked from the Curriculum tab carries stable source/node ids.
  // Hydrate the same picker state used by an in-card selection so onboarding,
  // transcription, and every Tutor turn receive the real selected subsection.
  useEffect(() => {
    if (!selectedSection) return;
    const document = curricula.find((item) => item.id === selectedSection.sourceId);
    if (!document) return;
    setCtxSubject(document.subject === "unsorted" ? null : document.subject);
    setCtxDoc(document.id);
    setCtxSubsection(selectedSection.nodeId);
  }, [curricula, selectedSection]);

  // reset on subject change
  useEffect(() => {
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];
    setStarted(false);
    setMessages([]);
    setNotes([]);
    setTyping(false);
    setInput("");
    setSpeaking(false);
    setCommandOpen(false);
    setRecording(false);
    setAttachments([]);
    setOnboardingStage("idle");
    setPendingOnboarding(null);
    setPrep({ pct: 0, stage: "" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (depthRef.current && !depthRef.current.contains(e.target as Node)) setDepthOpen(false);
      if (
        commandRef.current &&
        !commandRef.current.contains(e.target as Node) &&
        paletteRef.current &&
        !paletteRef.current.contains(e.target as Node)
      ) {
        setCommandOpen(false);
      }
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages, typing]);

  useEffect(() => {
    if (!commandOpen) return;

    const updatePosition = () => {
      const anchor = commandButtonRef.current ?? commandRef.current;
      if (!anchor) return;
      const rect = anchor.getBoundingClientRect();
      const menuWidth = 320;
      const menuHeight = 306;
      const top = rect.top > menuHeight + 18 ? rect.top - menuHeight - 8 : rect.bottom + 8;
      const left = Math.min(Math.max(12, rect.left), window.innerWidth - menuWidth - 12);
      setCommandPosition({ left, top: Math.max(12, top) });
    };

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [commandOpen, input]);

  function start() {
    setStarted(true);
    setNotes([]);
    setMessages([]);
  }

  function submit(raw?: string, intent?: Intent) {
    const text = (raw ?? input).trim();
    if (!text || busy) return;
    setStarted(true);

    const commandMatch = text.match(/(?:^|\s)@(explain|practice|quiz|simplify|notes|focus)\b/i);
    const command = commandMatch
      ? COMMANDS.find((item) => item.token === commandMatch[1].toLowerCase())
      : undefined;
    const displayText = command ? text.replace(commandMatch![0], "").trim() || `@${command.token}` : text;

    // Onboarding is collected through the chat, not a form. When we're waiting
    // for the answers, this submit IS the learner's reply: pair it back onto the
    // AI-generated questions, then run the real preparation pass (transcribe the
    // chosen subsection, ready the chalkboard) behind a progress bar.
    if (onboardingStage === "asking" && pendingOnboarding) {
      setMessages((m) => [...m, { id: ++idRef.current, role: "user", text: displayText }]);
      setInput("");
      setCommandOpen(false);
      const answers = pairOnboardingReply(
        pendingOnboarding.concept,
        pendingOnboarding.questions,
        displayText
      );
      void runPreparation(pendingOnboarding, answers);
      return;
    }

    setMessages((m) => [...m, { id: ++idRef.current, role: "user", text: displayText }]);
    setInput("");
    setCommandOpen(false);
    void intent;
    void command;

    // First prompt of a fresh session: ask the tutor agent to write the
    // onboarding interview, then post it and wait for the learner's reply.
    if (onboardingStage === "idle" && messages.length === 0) {
      void beginOnboarding(displayText);
    }
  }

  /** Ask the tutor agent to write this session's onboarding interview for the
   *  chosen concept, then post it as a normal tutor chat message and arm the
   *  next submit to pair the reply. The questions are AI-generated per concept —
   *  never a fixed script. If the agent is unbound or errors, we fall back to
   *  starting the session directly (no fabricated questions) and surface why. */
  async function beginOnboarding(prompt: string) {
    const boundNodes = collectBoundNodeIds(curricula, ctxDoc, ctxSubsection);
    const concept = resolveConcept(
      curricula,
      ctxDoc,
      ctxSubsection,
      selectedSection?.label.trim() || prompt
    );
    const agentCount = await safeAgentCount();

    setOnboardingStage("generating");
    setTyping(true);
    try {
      const { intro, questions } = await generateOnboardingQuestions({
        concept,
        boundNodes,
        agentCount,
      });
      const script = renderOnboardingQuestions(intro, questions, agentCount);
      setPendingOnboarding({ concept, agentCount, boundNodes, prompt, questions });
      setOnboardingStage("asking");
      setTyping(false);
      setMessages((m) => [...m, { id: ++idRef.current, role: "tutor", text: script }]);
    } catch (error) {
      // No canned fallback questions — if the interviewer can't run, tell the
      // learner why and take them straight into the session.
      setTyping(false);
      setOnboardingStage("done");
      notify(
        error instanceof Error
          ? `Couldn't generate onboarding (${error.message}) — starting the session directly.`
          : "Couldn't generate onboarding — starting the session directly."
      );
      onPrepare(prompt, boundNodes);
    }
  }

  /**
   * Real preparation pass, run after the learner answers the onboarding
   * questions and before the chalkboard opens.
   *
   * Every step below is actual work, and the bar only advances when a step
   * genuinely completes — there is no timed fake animation. The long pole is
   * transcribing the chosen subsection: `transcribeNode` rasterizes that node's
   * pages and vision-transcribes them into curriculum_chunks, reporting real
   * per-page progress. A node that was already transcribed is a cache hit and
   * passes through in a tick.
   */
  async function runPreparation(pending: PendingOnboarding, answers: OnboardingAnswers) {
    const { prompt, boundNodes, concept } = pending;
    setOnboardingStage("preparing");
    setPendingOnboarding(null);
    // The tutor explicitly acknowledges the intake before any preparation
    // begins. This also makes the hand-off clear when the learner skipped all
    // five questions.
    setMessages((m) => [...m, {
      id: ++idRef.current,
      role: "tutor",
      text: "Okay, got it. Stay tuned as we'll be loading up the right environment for our study session!",
    }]);
    setPrep({ pct: 0, stage: "Waiting for the tutor hand-off…" });
    await new Promise<void>((resolve) => window.setTimeout(resolve, 450));
    setPrep({ pct: 4, stage: "Reading your answers…" });
    // Yield once so the preparation card paints before extraction starts. This
    // is not a simulated timer: it simply lets the user see the first real
    // completed stage even when a cached section makes the remaining work fast.
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

    try {
      // Transcribe every bound node so the tutor has real evidence to ground on.
      // Progress is apportioned across nodes; within a node we get page-level
      // callbacks, so the bar tracks actual pages processed.
      if (boundNodes.length > 0) {
        const span = 86; // 4% → 90%
        for (let i = 0; i < boundNodes.length; i++) {
          const base = 4 + (span * i) / boundNodes.length;
          const slice = span / boundNodes.length;
          setPrep({
            pct: Math.round(base),
            stage:
              boundNodes.length > 1
                ? `Reading ${concept} · section ${i + 1} of ${boundNodes.length}…`
                : `Reading ${concept} from your curriculum…`,
          });
          await transcribeNode(boundNodes[i], (page, last) => {
            const within = last > 0 ? Math.min(1, Math.max(0, page / last)) : 1;
            setPrep({
              pct: Math.round(base + slice * within),
              stage: `Transcribing page ${page} of ${concept}…`,
            });
          });
        }
      } else {
        setPrep({ pct: 45, stage: "No curriculum bound — preparing free study…" });
      }

      setPrep({ pct: 94, stage: "Preparing the chalkboard…" });
      setPrep({ pct: 100, stage: "Ready" });
      setOnboardingStage("done");
      onPrepare(prompt, boundNodes, answers);
    } catch (error) {
      // Transcription is best-effort: the desktop-only pdfium path is absent in
      // the browser build, and a node may have no readable pages. Enter the
      // session anyway with whatever evidence exists, and say what happened.
      setOnboardingStage("done");
      notify(
        error instanceof Error
          ? `Could not read the curriculum section (${error.message}) — starting with what's available.`
          : "Could not read the curriculum section — starting with what's available."
      );
      onPrepare(prompt, boundNodes, answers);
    } finally {
      setPrep({ pct: 0, stage: "" });
    }
  }

  function copyTranscript() {
    const text = messages
      .map((m) => `${m.role === "tutor" ? "Studyus" : "You"}: ${m.text}`)
      .join("\n\n");
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(
        () => notify("Transcript copied to clipboard"),
        () => notify("Nothing to copy yet")
      );
    } else {
      notify("Transcript copied to clipboard");
    }
  }

  const chips: { label: string; intent: Intent }[] = [
    { label: "Explain the core idea", intent: "explain" },
    { label: "Give me a practice problem", intent: "practice" },
    { label: "Quiz me", intent: "quiz" },
  ];

  const commandMatch = input.match(/(?:^|\s)@([a-z]*)$/i);
  const commandQuery = commandMatch?.[1].toLowerCase() ?? "";
  const visibleCommands = COMMANDS.filter(
    (command) => !commandQuery || command.token.startsWith(commandQuery) || command.label.toLowerCase().startsWith(commandQuery)
  );

  function insertCommand(command: (typeof COMMANDS)[number]) {
    const prefix = input.replace(/(?:^|\s)@[a-z]*$/i, "").trimEnd();
    setInput(`${prefix}${prefix ? " " : ""}@${command.token} `);
    setCommandOpen(false);
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }

  function handleMedia(files: FileList | null, kind: "file" | "image") {
    if (!files?.length) return;
    const names = Array.from(files).map((file) => file.name);
    setAttachments((current) => [...current, ...names]);
    notify(`${kind === "image" ? "Image" : "File"} attached`);
  }

  return (
    <section className="anim-fade-up overflow-hidden rounded-lg border border-edge bg-card shadow-[0_1px_3px_rgba(0,0,0,0.45)]">
      {/* header */}
      <div className="relative flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1 border-b border-edge-soft px-4 py-3">
        <h3 className="shrink-0 text-[15px] font-semibold text-fg">Tutor</h3>
        <ContextPicker
          subject={ctxSubject}
          setSubject={setCtxSubject}
          doc={ctxDoc}
          setDoc={(value) => {
            setCtxDoc(value);
            setCtxSubsection(null);
          }}
          subsection={ctxSubsection}
          setSubsection={setCtxSubsection}
          externalSelection={selectedSection}
          onSelectionChange={onSelectedSectionChange}
          notify={notify}
        />
        <span className="ml-auto flex items-center gap-1.5 font-mono text-[11px] text-dim">
          <span className={`h-1.5 w-1.5 rounded-full ${started ? "bg-ok" : "bg-faint"}`} />
          {started ? (busy ? "thinking" : "in session") : "ready"}
        </span>
      </div>

      {/* toolbar */}
      <div className="flex items-center justify-between px-4 pb-1 pt-2.5">
        <button
          onClick={() => setNotesOpen((v) => !v)}
          className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[13px] font-medium transition-colors ${
            notesOpen ? "bg-white/[0.09] text-fg" : "bg-raise text-mut hover:bg-white/[0.09] hover:text-fg"
          }`}
        >
          <PenLine size={13} />
          Notes
          {notes.length > 0 && (
            <span className="rounded-full bg-accent/20 px-1.5 font-mono text-[10px] text-accent">{notes.length}</span>
          )}
        </button>
        <div className="flex items-center gap-2">
          {started && (
            <button
              onClick={() => {
                start();
                notify("Session restarted");
              }}
              className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[13px] text-mut transition-colors hover:bg-white/[0.06] hover:text-fg"
            >
              <RotateCcw size={13} />
              Restart
            </button>
          )}
        </div>
      </div>

      {/* The main surface is the composer, not a second narrow chat bar. */}
      <div className="px-4 pb-4 pt-3">
        {started && messages.length > 0 && (
          <div ref={scrollRef} className="mb-3 max-h-[220px] space-y-4 overflow-y-auto pr-1">
            {messages.map((m) =>
              m.role === "tutor" ? (
                <div key={m.id} className="anim-msg">
                  <div className="mb-0.5 font-mono text-[10px] uppercase tracking-wider text-dim">Studyus</div>
                  <p className="whitespace-pre-wrap text-[14px] leading-relaxed text-fg/90">
                    {m.text}
                  </p>
                </div>
              ) : (
                <div key={m.id} className="anim-msg flex justify-end">
                  <div className="max-w-[80%] rounded-md border border-edge bg-raise px-3 py-2">
                    <div className="mb-0.5 text-right font-mono text-[10px] uppercase tracking-wider text-dim">You</div>
                    <p className="text-[13.5px] leading-relaxed text-fg">{m.text}</p>
                  </div>
                </div>
              )
            )}
            {typing && (
              <div className="anim-msg flex items-center gap-1 pb-1">
                {[0, 1, 2].map((i) => (
                  <span
                    key={i}
                    className="typing-dot h-1.5 w-1.5 rounded-full bg-mut"
                    style={{ animationDelay: `${i * 0.15}s` }}
                  />
                ))}
              </div>
            )}

            {/* Post-onboarding preparation: a real progress bar for transcribing
                the chosen subsection and readying the chalkboard. The bar only
                advances on actual completed work (per-page transcription
                callbacks), never a timed animation. */}
            {onboardingStage === "preparing" && (
              <div className="anim-msg rounded-md border border-edge bg-raise/60 px-3 py-2.5">
                <div className="mb-1.5 flex items-center gap-2">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
                  <span className="font-mono text-[10.5px] uppercase tracking-wider text-dim">
                    {prep.stage || "Preparing…"}
                  </span>
                  <span className="ml-auto font-mono text-[10px] text-dim">{prep.pct}%</span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-edge">
                  <div
                    className="h-full rounded-full bg-accent transition-[width] duration-300 ease-out"
                    style={{ width: `${Math.max(2, prep.pct)}%` }}
                  />
                </div>
              </div>
            )}
          </div>
        )}

        <div
          ref={commandRef}
          className={`relative overflow-visible rounded-lg border bg-ink/45 transition-colors ${
            focused ? "border-accent/60" : "border-edge"
          }`}
        >
          <div className="pointer-events-none absolute left-3.5 top-3 font-mono text-[10px] uppercase tracking-wider text-dim">
            {onboardingStage === "generating"
              ? "Onboarding · preparing your questions"
              : onboardingStage === "asking"
                ? "Onboarding · answer each line"
                : onboardingStage === "preparing"
                  ? "Preparing your session…"
                  : started
                    ? "Your next prompt"
                    : "Write to Studyus"}
          </div>
          <textarea
            ref={inputRef}
            value={input}
            disabled={busy}
            onChange={(e) => {
              const next = e.target.value;
              setInput(next);
              setCommandOpen(/(?:^|\s)@[a-z]*$/i.test(next));
            }}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder={
              onboardingStage === "generating"
                ? "Studyus is preparing your onboarding questions…"
                : onboardingStage === "preparing"
                  ? "Studyus is reading your curriculum and setting up the chalkboard…"
                  : busy
                    ? "Studyus is drafting..."
                    : onboardingStage === "asking"
                      ? "Answer each question — one per line — then press Enter to begin"
                      : "Tell Studyus what to study, paste a problem, or type @..."
            }
            rows={5}
            className="min-h-[180px] w-full resize-none bg-transparent px-3.5 pb-3 pt-8 text-[14px] leading-relaxed text-fg outline-none placeholder:text-faint disabled:cursor-not-allowed"
          />

          {attachments.length > 0 && (
            <div className="flex flex-wrap gap-1.5 px-3.5 pb-2">
              {attachments.map((name, index) => (
                <span key={`${name}-${index}`} className="flex max-w-[190px] items-center gap-1.5 rounded border border-edge bg-raise px-2 py-1 text-[11px] text-mut">
                  <Paperclip size={11} className="shrink-0 text-accent" />
                  <span className="truncate">{name}</span>
                  <button
                    onClick={() => setAttachments((items) => items.filter((_, i) => i !== index))}
                    className="text-dim transition-colors hover:text-fg"
                    aria-label={`Remove ${name}`}
                  >
                    <X size={11} />
                  </button>
                </span>
              ))}
            </div>
          )}

          <div className="flex items-center justify-between border-t border-edge-soft px-2.5 py-2">
            <div className="flex items-center gap-0.5">
              <input ref={fileRef} type="file" className="hidden" onChange={(e) => handleMedia(e.target.files, "file")} />
              <input ref={imageRef} type="file" accept="image/*" className="hidden" onChange={(e) => handleMedia(e.target.files, "image")} />
              <button
                onClick={() => fileRef.current?.click()}
                disabled={busy}
                className="grid h-7 w-7 place-items-center rounded-md text-mut transition-colors hover:bg-white/[0.07] hover:text-fg disabled:text-faint"
                aria-label="Attach a file"
                title="Attach a file"
              >
                <Paperclip size={15} />
              </button>
              <button
                onClick={() => imageRef.current?.click()}
                disabled={busy}
                className="grid h-7 w-7 place-items-center rounded-md text-mut transition-colors hover:bg-white/[0.07] hover:text-fg disabled:text-faint"
                aria-label="Add an image"
                title="Add an image"
              >
                <ImageIcon size={15} />
              </button>
              <button
                onClick={() => {
                  if (recording) {
                    dictationRef.current?.stop();
                    dictationRef.current = null;
                    setRecording(false);
                    notify("Voice input stopped");
                    return;
                  }
                  const live = startLiveDictation(
                    (text) => setInput(text),
                    (message) => { setRecording(false); notify(message); }
                  );
                  if (live) {
                    dictationRef.current = live;
                    setRecording(true);
                    notify("Voice input is listening — words will appear live");
                  }
                }}
                disabled={busy}
                className={`grid h-7 w-7 place-items-center rounded-md transition-colors hover:bg-white/[0.07] disabled:text-faint ${
                  recording ? "text-accent" : "text-mut hover:text-fg"
                }`}
                aria-label="Use voice input"
                title="Use voice input"
              >
                <Mic size={15} />
              </button>
              <button
                ref={commandButtonRef}
                onClick={() => {
                  const next = `${input}${input && !input.endsWith(" ") ? " " : ""}@`;
                  setInput(next);
                  setCommandOpen(true);
                  window.setTimeout(() => inputRef.current?.focus(), 0);
                }}
                disabled={busy}
                className="flex h-7 items-center gap-1 rounded-md px-2 text-[11px] font-medium text-mut transition-colors hover:bg-white/[0.07] hover:text-fg disabled:text-faint"
                aria-label="Open commands"
                title="Type @ for commands"
              >
                <AtSign size={14} />
                Commands
              </button>
            </div>
            <span className="hidden font-mono text-[10px] text-dim sm:block">Shift + Enter for a new line</span>
            <button
              onClick={() => submit()}
              disabled={busy || !input.trim()}
              aria-label="Send prompt"
              className={`grid h-8 w-8 shrink-0 place-items-center rounded-md transition-all ${
                !busy && input.trim() ? "bg-accent text-white hover:bg-accent-deep active:scale-95" : "bg-raise text-faint"
              }`}
            >
              <ArrowUp size={15} strokeWidth={2.5} />
            </button>
          </div>

        </div>

        {commandOpen &&
          visibleCommands.length > 0 &&
          createPortal(
            <div
              ref={paletteRef}
              className="anim-toast fixed z-[80] w-[320px] rounded-md border border-edge bg-raise p-1 shadow-[0_18px_48px_rgba(0,0,0,0.65)]"
              style={{ left: commandPosition.left, top: commandPosition.top }}
            >
              <div className="flex items-center justify-between px-2.5 pb-1 pt-1.5">
                <span className="font-mono text-[10px] uppercase tracking-wider text-dim">Studyus commands</span>
                <span className="font-mono text-[10px] text-dim">@</span>
              </div>
              {visibleCommands.map((command) => (
                <button
                  key={command.token}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => insertCommand(command)}
                  className="flex w-full items-center gap-2.5 rounded px-2.5 py-2 text-left transition-colors hover:bg-white/[0.07]"
                >
                  <span className="grid h-6 w-6 place-items-center rounded border border-edge bg-card font-mono text-[11px] text-accent">@</span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] text-fg">{command.token}</span>
                    <span className="block truncate text-[11px] text-dim">{command.desc}</span>
                  </span>
                  <span className="font-mono text-[10px] text-dim">enter</span>
                </button>
              ))}
            </div>,
            document.body
          )}

        {started && !busy && (
          <div className="anim-fade-up mt-3 flex flex-wrap gap-2">
            {chips.map((c) => (
              <button
                key={c.label}
                onClick={() => submit(c.label, c.intent)}
                className="rounded-full border border-edge bg-raise px-3 py-1.5 text-[12.5px] text-mut transition-all hover:border-accent/50 hover:text-fg active:scale-[0.97]"
              >
                {c.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* notes panel */}
      {notesOpen && (
        <div className="border-t border-edge-soft bg-[#1e1e1d] px-4 py-3">
          <div className="mb-2 font-mono text-[10px] uppercase tracking-wider text-dim">Auto-notes</div>
          {notes.length === 0 ? (
            <p className="text-[12.5px] text-dim">Key points will collect here as the session goes.</p>
          ) : (
            <ul className="space-y-1.5">
              {notes.map((n, i) => (
                <li key={i} className="anim-msg flex items-start gap-2 text-[13px] text-fg/85">
                  <Check size={13} className="mt-0.5 shrink-0 text-ok" strokeWidth={2.5} />
                  {n}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* footer */}
      <div className="flex items-center gap-3 border-t border-edge-soft px-4 py-2.5">
        <div className="relative flex items-center gap-2" ref={depthRef}>
          <span className="font-mono text-[11px] text-dim">Depth:</span>
          <button
            onClick={() => setDepthOpen((v) => !v)}
            className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[12px] font-medium text-fg transition-colors hover:bg-white/[0.06]"
          >
            {DEPTHS.find((d) => d.id === depth)?.label}
            <ChevronDown size={12} className={`text-dim transition-transform ${depthOpen ? "rotate-180" : ""}`} />
          </button>
          {depthOpen && (
            <div className="anim-toast absolute bottom-8 left-0 z-30 w-52 rounded-md border border-edge bg-raise p-1 shadow-[0_10px_30px_rgba(0,0,0,0.5)]">
              {DEPTHS.map((d) => (
                <button
                  key={d.id}
                  onClick={() => {
                    setDepth(d.id);
                    setDepthOpen(false);
                    notify(`Depth set to ${d.label}`);
                  }}
                  className="flex w-full items-center gap-2.5 rounded px-2 py-1.5 text-left transition-colors hover:bg-white/[0.06]"
                >
                  <span className="flex-1">
                    <span className="block text-[13px] text-fg">{d.label}</span>
                    <span className="block text-[11px] text-dim">{d.desc}</span>
                  </span>
                  {depth === d.id && <Check size={13} className="text-accent" />}
                </button>
              ))}
            </div>
          )}
        </div>
        <span className="hidden h-3 w-px bg-edge sm:block" />
        <p className="hidden min-w-0 flex-1 truncate text-[12px] text-dim sm:block">
          Studyus shows its reasoning step by step — verify anything.
        </p>
        <div className="ml-auto flex items-center gap-1">
          <button
            onClick={() => {
              setSpeaking((s) => !s);
              notify(speaking ? "Stopped reading aloud" : "Reading the last reply aloud");
            }}
            aria-label="Read aloud"
            className="grid h-7 w-7 place-items-center rounded-md text-mut transition-colors hover:bg-white/[0.06] hover:text-fg"
          >
            {speaking ? (
              <span className="flex h-3.5 items-end gap-[2px]">
                {[0, 1, 2].map((i) => (
                  <span
                    key={i}
                    className="speak-bar w-[2.5px] rounded-sm bg-accent"
                    style={{ height: "100%", animationDelay: `${i * 0.18}s` }}
                  />
                ))}
              </span>
            ) : (
              <Volume2 size={15} />
            )}
          </button>
          <button
            onClick={copyTranscript}
            aria-label="Copy transcript"
            className="grid h-7 w-7 place-items-center rounded-md text-mut transition-colors hover:bg-white/[0.06] hover:text-fg"
          >
            <Copy size={15} />
          </button>
        </div>
      </div>

    </section>
  );
}

/* ── Subject → curriculum → concept picker. Sits between the "Tutor" heading
      and the session-status pill; its title IS the chosen subconcept. ── */

function ContextPicker({
  subject,
  setSubject,
  doc,
  setDoc,
  subsection,
  setSubsection,
  externalSelection,
  onSelectionChange,
  notify,
}: {
  subject: SubjectKey | null;
  setSubject: (s: SubjectKey | null) => void;
  doc: string | null;
  setDoc: (d: string | null) => void;
  subsection: string | null;
  setSubsection: (s: string | null) => void;
  externalSelection?: CurriculumStudySelection | null;
  onSelectionChange?: (selection: CurriculumStudySelection | null) => void;
  notify: (t: string) => void;
}) {
  const { curricula } = useCurricula();
  const [open, setOpen] = useState(false);
  /** Which step of the drill-down is showing. Choosing a PDF advances to
   *  "concepts", which renders that PDF's real bookmarks. */
  const [step, setStep] = useState<"subject" | "docs" | "concepts">("subject");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  // Reopening lands on the deepest step that still has a selection, so the
  // learner sees the concept list they were last browsing.
  useEffect(() => {
    if (!open) return;
    setStep(doc ? "concepts" : subject ? "docs" : "subject");
  }, [open, doc, subject]);

  const meta = SUBJECT_LIST.find((s) => s.id === subject);
  const docs = subject ? curricula.filter((c) => c.subject === subject) : [];
  const selectedDoc = curricula.find((c) => c.id === doc);
  const docName = selectedDoc?.name.replace(/\.pdf$/i, "") ?? null;

  const selectedNode = selectedDoc ? findNodeDeep(selectedDoc.nodes, subsection) : null;
  // The picker's title is the chosen subconcept — that is what replaces
  // "Add context" once a concept is picked from the PDF's bookmarks.
  const label = selectedNode
<<<<<<< HEAD
    ? formatNodeLabel(selectedNode)
=======
    ? [selectedNode.sectionNumber, selectedNode.title].filter(Boolean).join(" ")
>>>>>>> 2b4dc7d769d9c94350cc86df59df7fd71e52800e
    : docName ?? meta?.label ?? externalSelection?.label ?? "Add context";

  return (
    <div className="relative" ref={wrapRef}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex max-w-[280px] items-center gap-1.5 rounded-md px-1.5 py-0.5 text-[15px] transition-colors hover:bg-white/[0.06]"
      >
        {meta && <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: meta.accent }} />}
        <span className={`truncate ${meta || externalSelection ? "text-fg" : "text-mut"}`}>{label}</span>
        <ChevronDown size={13} className={`shrink-0 text-dim transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="anim-toast absolute left-0 top-9 z-40 w-[290px] overflow-hidden rounded-lg border border-edge bg-raise shadow-[0_18px_50px_rgba(0,0,0,0.55)]">
          {step === "subject" ? (
            <>
              <div className="border-b border-edge-soft px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-dim">
                Choose a subject
              </div>
              <div className="p-1">
                {SUBJECT_LIST.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => {
                      setSubject(s.id);
                      setDoc(null);
                      onSelectionChange?.(null);
                      setStep("docs");
                    }}
                    className="flex w-full items-center gap-2.5 rounded px-2.5 py-2 text-left transition-colors hover:bg-white/[0.07]"
                  >
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: s.accent }} />
                    <span className="flex-1 text-[13px] text-fg">{s.label}</span>
                    <ChevronRightSmall />
                  </button>
                ))}
              </div>
            </>
          ) : step === "docs" ? (
            <>
              <div className="flex items-center gap-2 border-b border-edge-soft px-3 py-2">
                <button
                  onClick={() => {
                    setSubject(null);
                    setDoc(null);
                    onSelectionChange?.(null);
                    setStep("subject");
                  }}
                  className="font-mono text-[10px] uppercase tracking-wider text-dim transition-colors hover:text-fg"
                >
                  ← subjects
                </button>
                <span className="ml-auto flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full" style={{ background: meta?.accent }} />
                  <span className="text-[11.5px] font-medium text-fg">{meta?.label}</span>
                </span>
              </div>
              <div className="px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider text-dim">
                Curriculum PDFs
              </div>
              <div className="max-h-[220px] overflow-y-auto p-1 pt-0">
                {docs.length === 0 && (
                  <p className="px-2.5 py-3 text-[12px] text-dim">No curriculum for this subject yet.</p>
                )}
                {docs.map((d) => (
                  <button
                    key={d.id}
                    onClick={() => {
                      // Picking a PDF opens its Concepts list rather than closing
                      // the menu — the learner still has to choose a subconcept,
                      // and that choice becomes this picker's title.
                      setDoc(d.id);
                      setSubsection(null);
                      onSelectionChange?.(null);
                      setExpanded(new Set(d.nodes.slice(0, 1).map((n) => n.id)));
                      setStep("concepts");
                    }}
                    className={`flex w-full items-start gap-2.5 rounded px-2.5 py-2 text-left transition-colors hover:bg-white/[0.07] ${
                      doc === d.id ? "bg-white/[0.06]" : ""
                    }`}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12.5px] text-fg">{d.name.replace(/\.pdf$/i, "")}</span>
                      <span className="block font-mono text-[10px] text-dim">
                        {d.pageCount} pages · {d.nodes.length} sections
                      </span>
                    </span>
                    <ChevronRightSmall />
                  </button>
                ))}
                <button
                  onClick={() => {
                    setDoc(null);
                    setSubsection(null);
                    onSelectionChange?.(null);
                    setOpen(false);
                    notify("Studying without a curriculum");
                  }}
                  className="mt-1 w-full rounded border border-dashed border-edge px-2.5 py-1.5 text-[11.5px] text-dim transition-colors hover:text-fg"
                >
                  No curriculum — free study
                </button>
              </div>
            </>
          ) : (
            /* Concepts — the chosen PDF's real bookmark tree. Selecting a leaf
               sets the subconcept that titles this picker. */
            <>
              <div className="flex items-center gap-2 border-b border-edge-soft px-3 py-2">
                <button
                  onClick={() => setStep("docs")}
                  className="font-mono text-[10px] uppercase tracking-wider text-dim transition-colors hover:text-fg"
                >
                  ← PDFs
                </button>
                <span className="ml-auto min-w-0 truncate text-[11.5px] font-medium text-fg">
                  {docName}
                </span>
              </div>
              <div className="px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider text-dim">
                Concepts
              </div>
              <div className="max-h-[260px] overflow-y-auto p-1 pt-0">
                {(selectedDoc?.nodes.length ?? 0) === 0 && (
                  <p className="px-2.5 py-3 text-[12px] text-dim">
                    This PDF has no indexed bookmarks yet.
                  </p>
                )}
                {selectedDoc?.nodes.map((node) => (
                  <ConceptRow
                    key={node.id}
                    node={node}
                    depth={0}
                    selectedId={subsection}
                    expanded={expanded}
                    onToggleExpand={(id) =>
                      setExpanded((cur) => {
                        const next = new Set(cur);
                        if (next.has(id)) next.delete(id);
                        else next.add(id);
                        return next;
                      })
                    }
                    onPick={(picked) => {
<<<<<<< HEAD
                      const pickedLabel = formatNodeLabel(picked);
=======
                      const pickedLabel = [picked.sectionNumber, picked.title]
                        .filter(Boolean)
                        .join(" ");
>>>>>>> 2b4dc7d769d9c94350cc86df59df7fd71e52800e
                      setSubsection(picked.id);
                      onSelectionChange?.({ sourceId: doc!, nodeId: picked.id, label: pickedLabel });
                      setOpen(false);
                      notify(`Studying ${pickedLabel}`);
                    }}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** One bookmark row in the Concepts tree. Renders its children recursively so
 *  nested subsections stay reachable; the caret expands, the label picks. */
function ConceptRow({
  node,
  depth,
  selectedId,
  expanded,
  onToggleExpand,
  onPick,
}: {
  node: StoredCurriculum["nodes"][number];
  depth: number;
  selectedId: string | null;
  expanded: Set<string>;
  onToggleExpand: (id: string) => void;
  onPick: (node: StoredCurriculum["nodes"][number]) => void;
}) {
  const hasChildren = (node.children?.length ?? 0) > 0;
  const isOpen = expanded.has(node.id);
  const selected = node.id === selectedId;

  return (
    <>
      <div
        className={`flex items-center gap-1 rounded transition-colors hover:bg-white/[0.07] ${
          selected ? "bg-white/[0.08]" : ""
        }`}
        style={{ paddingLeft: depth * 12 }}
      >
        {hasChildren ? (
          <button
            onClick={() => onToggleExpand(node.id)}
            className="grid h-5 w-5 shrink-0 place-items-center rounded text-dim transition-colors hover:text-fg"
            aria-label={isOpen ? "Collapse" : "Expand"}
          >
            <ChevronDown size={11} className={`transition-transform ${isOpen ? "" : "-rotate-90"}`} />
          </button>
        ) : (
          <span className="h-5 w-5 shrink-0" />
        )}
        <button
          onClick={() => onPick(node)}
          className="flex min-w-0 flex-1 items-center gap-2 py-1.5 pr-2 text-left"
        >
          <span className={`min-w-0 flex-1 truncate text-[12.5px] ${selected ? "text-fg" : "text-mut"}`}>
            {formatNodeLabel(node)}
          </span>
          {selected && <Check size={12} className="shrink-0 text-accent" />}
        </button>
      </div>
      {hasChildren && isOpen &&
        node.children!.map((child) => (
          <ConceptRow
            key={child.id}
            node={child}
            depth={depth + 1}
            selectedId={selectedId}
            expanded={expanded}
            onToggleExpand={onToggleExpand}
            onPick={onPick}
          />
        ))}
    </>
  );
}

/** Find a node anywhere in the bookmark tree by id. */
function findNodeDeep(
  nodes: StoredCurriculum["nodes"],
  id: string | null
): StoredCurriculum["nodes"][number] | null {
  if (!id) return null;
  for (const node of nodes) {
    if (node.id === id) return node;
    const deeper = findNodeDeep(node.children ?? [], id);
    if (deeper) return deeper;
  }
  return null;
}

function ChevronRightSmall() {
  return <ChevronDown size={12} className="-rotate-90 text-dim" />;
}

function formatNodeLabel(node: { sectionNumber: string | null; title: string }): string {
  const number = node.sectionNumber?.trim();
  const title = node.title.trim();
  if (number && title === number) return number;
  if (number && title.startsWith(number) && /^[\s.:)]+/.test(title.slice(number.length))) {
    return title;
  }
  return [number, title].filter(Boolean).join(" ");
}

/** Concept shown to the learner during onboarding: the picked subsection's
 *  title when a curriculum node is selected, otherwise the free-form prompt
 *  (or a neutral default when the prompt is empty). */
function resolveConcept(
  curricula: StoredCurriculum[],
  docId: string | null,
  subsectionId: string | null,
  prompt: string
): string {
  if (subsectionId) {
    const doc = curricula.find((c) => c.id === docId);
    const node = doc ? findNodeDeep(doc.nodes, subsectionId) : null;
<<<<<<< HEAD
    if (node) return formatNodeLabel(node);
=======
    if (node) return [node.sectionNumber, node.title].filter(Boolean).join(" ") || node.title;
>>>>>>> 2b4dc7d769d9c94350cc86df59df7fd71e52800e
  }
  if (docId) {
    const doc = curricula.find((c) => c.id === docId);
    if (doc) return doc.name.replace(/\.pdf$/i, "");
  }
  return prompt.trim() || "this section";
}

async function safeAgentCount(): Promise<number> {
  try {
    return await countBoundAgents();
  } catch {
    return 0;
  }
}

/** Collect the curriculum node ids the tutor should ground on for a study turn.
 *  A picked subsection anchors the tutor to that section AND every node nested
 *  beneath it. A picked doc with no subsection anchors to the whole document.
 *  Free-form study (no doc) yields no bound nodes — the tutor gets no evidence. */
function collectBoundNodeIds(
  curricula: StoredCurriculum[],
  docId: string | null,
  subsectionId: string | null
): string[] {
  if (!docId) return [];
  const doc = curricula.find((c) => c.id === docId);
  if (!doc) return [];
  if (!subsectionId) return doc.nodes.map((n) => n.id);
  const ids: string[] = [];
  const walk = (node: StoredCurriculum["nodes"][number]): void => {
    ids.push(node.id);
    node.children?.forEach(walk);
  };
  const roots = doc.nodes;
  for (const root of roots) {
    if (root.id === subsectionId) {
      walk(root);
      return ids;
    }
    const found = findInChildren(root, subsectionId);
    if (found) {
      walk(found);
      return ids;
    }
  }
  return [subsectionId];
}

function findInChildren(
  node: StoredCurriculum["nodes"][number],
  target: string
): StoredCurriculum["nodes"][number] | null {
  if (!node.children) return null;
  for (const child of node.children) {
    if (child.id === target) return child;
    const deeper = findInChildren(child, target);
    if (deeper) return deeper;
  }
  return null;
}
