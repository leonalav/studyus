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
import { SCRIPTS, shape, type Intent, type Subject } from "../data/tutor";
import { detectDomain, prepSteps } from "../data/boards";
import { CURRICULA, SUBJECT_LIST, type SubjectKey } from "../data/curriculum";

interface Msg {
  id: number;
  role: "tutor" | "user";
  text: string;
}

type Depth = "auto" | "simple" | "detailed";

interface Props {
  subject: Subject;
  notify: (text: string) => void;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  onPrepare: (prompt: string) => void;
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

export function SessionCard({ subject, notify, inputRef, onPrepare }: Props) {
  const [started, setStarted] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [typing, setTyping] = useState(false);
  const [streaming, setStreaming] = useState(false);
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

  const idRef = useRef(0);
  const streamRef = useRef<number | null>(null);
  const timersRef = useRef<number[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const depthRef = useRef<HTMLDivElement>(null);
  const commandRef = useRef<HTMLDivElement>(null);
  const commandButtonRef = useRef<HTMLButtonElement>(null);
  const paletteRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const imageRef = useRef<HTMLInputElement>(null);

  const busy = typing || streaming;

  // reset on subject change
  useEffect(() => {
    stopStream();
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];
    setStarted(false);
    setMessages([]);
    setNotes([]);
    setTyping(false);
    setStreaming(false);
    setInput("");
    setSpeaking(false);
    setCommandOpen(false);
    setRecording(false);
    setAttachments([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subject.id]);

  useEffect(() => () => stopStream(), []);

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

  function stopStream() {
    if (streamRef.current !== null) {
      clearInterval(streamRef.current);
      streamRef.current = null;
    }
  }

  function streamTutor(full: string, newNotes: string[]) {
    stopStream();
    const id = ++idRef.current;
    setMessages((m) => [...m, { id, role: "tutor", text: "" }]);
    setStreaming(true);
    let i = 0;
    streamRef.current = window.setInterval(() => {
      i = Math.min(full.length, i + 2 + Math.floor(Math.random() * 3));
      const slice = full.slice(0, i);
      setMessages((m) => m.map((msg) => (msg.id === id ? { ...msg, text: slice } : msg)));
      if (i >= full.length) {
        stopStream();
        setStreaming(false);
        if (newNotes.length) {
          setNotesOpen(true);
          setNotes((n) => [...n, ...newNotes]);
        }
      }
    }, 16);
  }

  function respond(intent: Intent) {
    respondWithScript(SCRIPTS[subject.id][intent]);
  }

  function respondWithScript(script: { text: string; notes: string[] }, responseDepth = depth) {
    setTyping(true);
    const t = window.setTimeout(() => {
      setTyping(false);
      streamTutor(shape(script.text, responseDepth), script.notes);
    }, 620 + Math.random() * 480);
    timersRef.current.push(t);
  }

  function start() {
    setStarted(true);
    setNotes([]);
    setMessages([]);
    respond("greet");
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
    setMessages((m) => [...m, { id: ++idRef.current, role: "user", text: displayText }]);
    setInput("");
    setCommandOpen(false);
    void intent;
    void command;

    // Prep appears as sequential agent messages inside the session — no black overlay.
    const fullPrompt = `${displayText} — ${subject.topic}`;
    const domain = detectDomain(fullPrompt);
    const steps = prepSteps(domain);
    setStreaming(true);

    let step = 0;
    const runStep = () => {
      if (step >= steps.length) {
        setStreaming(false);
        const t = window.setTimeout(() => onPrepare(fullPrompt), 480);
        timersRef.current.push(t);
        return;
      }
      const id = ++idRef.current;
      const content = steps[step];
      setMessages((m) => [...m, { id, role: "tutor", text: "" }]);
      let i = 0;
      stopStream();
      streamRef.current = window.setInterval(() => {
        i = Math.min(content.length, i + 2 + Math.floor(Math.random() * 2));
        setMessages((m) => m.map((msg) => (msg.id === id ? { ...msg, text: content.slice(0, i) } : msg)));
        if (i >= content.length) {
          stopStream();
          step += 1;
          const t = window.setTimeout(runStep, 320);
          timersRef.current.push(t);
        }
      }, 18);
    };
    runStep();
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
      <div className="relative flex items-center gap-2.5 border-b border-edge-soft px-4 py-3">
        <h3 className="text-[15px] font-semibold text-fg">Tutor</h3>
        <ContextPicker
          subject={ctxSubject}
          setSubject={setCtxSubject}
          doc={ctxDoc}
          setDoc={setCtxDoc}
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
                    {streaming && m.id === messages[messages.length - 1]?.id && (
                      <span className="caret ml-0.5 inline-block h-3.5 w-[7px] translate-y-0.5 bg-accent" />
                    )}
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
          </div>
        )}

        <div
          ref={commandRef}
          className={`relative overflow-visible rounded-lg border bg-ink/45 transition-colors ${
            focused ? "border-accent/60" : "border-edge"
          }`}
        >
          <div className="pointer-events-none absolute left-3.5 top-3 font-mono text-[10px] uppercase tracking-wider text-dim">
            {started ? "Your next prompt" : "Write to Studyus"}
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
              busy
                ? "Studyus is drafting..."
                : `Ask anything about ${subject.topic.toLowerCase()}, paste a problem, or type @...`
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
                  setRecording((value) => !value);
                  notify(recording ? "Voice input stopped" : "Voice input is listening");
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

/* ── Subject → curriculum picker that lives where "@Today" used to be ── */

function ContextPicker({
  subject,
  setSubject,
  doc,
  setDoc,
  notify,
}: {
  subject: SubjectKey | null;
  setSubject: (s: SubjectKey | null) => void;
  doc: string | null;
  setDoc: (d: string | null) => void;
  notify: (t: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const meta = SUBJECT_LIST.find((s) => s.id === subject);
  const docs = subject ? CURRICULA.filter((c) => c.subject === subject) : [];
  const docName = doc ? CURRICULA.find((c) => c.id === doc)?.name.replace(/\.pdf$/i, "") : null;

  const label = docName ?? meta?.label ?? "@Today";

  return (
    <div className="relative" ref={wrapRef}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex max-w-[280px] items-center gap-1.5 rounded-md px-1.5 py-0.5 text-[15px] transition-colors hover:bg-white/[0.06]"
      >
        {meta && <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: meta.accent }} />}
        <span className={`truncate ${meta ? "text-fg" : "text-mut"}`}>{label}</span>
        <ChevronDown size={13} className={`shrink-0 text-dim transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="anim-toast absolute left-0 top-9 z-40 w-[290px] overflow-hidden rounded-lg border border-edge bg-raise shadow-[0_18px_50px_rgba(0,0,0,0.55)]">
          {!subject ? (
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
          ) : (
            <>
              <div className="flex items-center gap-2 border-b border-edge-soft px-3 py-2">
                <button
                  onClick={() => {
                    setSubject(null);
                    setDoc(null);
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
                      setDoc(d.id);
                      setOpen(false);
                      notify(`Context set to ${d.name.replace(/\.pdf$/i, "")}`);
                    }}
                    className={`flex w-full items-start gap-2.5 rounded px-2.5 py-2 text-left transition-colors hover:bg-white/[0.07] ${
                      doc === d.id ? "bg-white/[0.06]" : ""
                    }`}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12.5px] text-fg">{d.name.replace(/\.pdf$/i, "")}</span>
                      <span className="block font-mono text-[10px] text-dim">
                        {d.pages} pages · {d.sections.length} sections
                      </span>
                    </span>
                    {doc === d.id && <Check size={12} className="mt-0.5 shrink-0 text-accent" />}
                  </button>
                ))}
                <button
                  onClick={() => {
                    setDoc(null);
                    setOpen(false);
                    notify("Studying without a curriculum");
                  }}
                  className="mt-1 w-full rounded border border-dashed border-edge px-2.5 py-1.5 text-[11.5px] text-dim transition-colors hover:text-fg"
                >
                  No curriculum — free study
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function ChevronRightSmall() {
  return <ChevronDown size={12} className="-rotate-90 text-dim" />;
}
