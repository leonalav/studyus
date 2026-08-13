import { useEffect, useRef, useState } from "react";
import {
  Check,
  CheckCircle2,
  ChevronDown,
  FilePenLine,
  GitBranch,
  LoaderCircle,
  Minus,
  Network,
  Paperclip,
  Image as ImageIcon,
  Mic,
  Undo2,
  X,
} from "lucide-react";
import type { SessionThreadLog } from "../../lib/tutor";
import type { Block, BoardDoc } from "../../data/boards";
import { DOMAIN_META } from "../../data/boards";
import { WIDGET_LABEL } from "../../lib/widgets/types";
import { THEMES, FONTS, type BoardTheme } from "./Chalkboard";
import { startLiveDictation, type LiveDictation } from "../../lib/voice";

/* ══ Threads ══ */

export function ThreadsPanel({
  boards,
  previews,
  threadLog,
  theme,
  fontCss,
  activeId,
  onPick,
  onClose,
}: {
  boards: BoardDoc[];
  previews: Record<string, string>;
  threadLog: SessionThreadLog[];
  theme: BoardTheme;
  fontCss: string;
  activeId: string;
  onPick: (id: string) => void;
  onClose: () => void;
}) {
  const [filter, setFilter] = useState<"all" | "agent" | "learner">("all");
  const loggedByBoard = new Map(threadLog.map((entry) => [entry.boardId, entry]));
  const visibleBoards = boards.filter((item) => {
    if (filter === "all") return true;
    const creator = item.thread?.createdBy ?? loggedByBoard.get(item.id)?.createdBy;
    return creator === filter;
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="absolute inset-0 z-50 grid place-items-center bg-transparent" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        className="anim-toast w-[min(900px,92vw)] overflow-hidden rounded-xl border border-white/15 bg-white/[0.07] shadow-[0_24px_70px_rgba(0,0,0,0.45)] ring-1 ring-inset ring-white/10 backdrop-blur-2xl backdrop-saturate-150"
      >
        <div className="flex items-center justify-between border-b border-edge px-4 py-3">
          <h3 className="text-[13.5px] font-semibold text-fg">Select a board to bring on screen</h3>
          <button onClick={onClose} className="text-[12px] text-dim transition-colors hover:text-fg">
            Close
          </button>
        </div>

        <div className="flex gap-1 border-b border-edge px-4 pt-2" role="tablist" aria-label="Thread filters">
          {([
            ["all", "All boards", boards.length],
            ["agent", "Agent-created", boards.filter((item) => item.thread?.createdBy === "agent" || loggedByBoard.get(item.id)?.createdBy === "agent").length],
            ["learner", "Your branches", boards.filter((item) => item.thread?.createdBy === "learner" || loggedByBoard.get(item.id)?.createdBy === "learner").length],
          ] as const).map(([id, label, count]) => (
            <button
              key={id}
              role="tab"
              aria-selected={filter === id}
              onClick={() => setFilter(id)}
              className={`rounded-t px-3 py-1.5 text-[12px] transition-colors ${filter === id ? "border-b-2 border-accent font-medium text-fg" : "text-dim hover:text-mut"}`}
            >
              {label} <span className="ml-1 font-mono text-[9px] opacity-60">{count}</span>
            </button>
          ))}
        </div>

        <div className="grid max-h-[52vh] grid-cols-2 gap-3 overflow-y-auto p-4 sm:grid-cols-3">
          {visibleBoards.length === 0 && (
            <div className="col-span-full grid min-h-[180px] place-items-center rounded-lg border border-dashed border-edge bg-black/10 text-center">
              <div>
                <GitBranch size={20} className="mx-auto mb-2 text-dim" />
                <div className="text-[12px] text-mut">No threads in this category yet</div>
              </div>
            </div>
          )}
          {visibleBoards.map((b) => {
            const meta = DOMAIN_META[b.domain];
            const isMain = !b.parentId;
            const log = loggedByBoard.get(b.id);
            const creator = b.thread?.createdBy ?? log?.createdBy;
            const reason = b.thread?.reason ?? log?.reason ?? b.subtitle;
            const createdAt = b.thread?.createdAt ?? log?.createdAt;
            return (
              <button
                key={b.id}
                onClick={() => onPick(b.id)}
                className={`group overflow-hidden rounded-lg border-2 text-left transition-all ${
                  b.id === activeId ? "border-accent bg-accent/10" : "border-edge bg-raise hover:border-white/25"
                }`}
              >
                <div className="relative h-[126px] overflow-hidden" style={{ background: theme.bg }}>
                  {previews[b.id] ? (
                    <img
                      src={previews[b.id]}
                      alt={`Saved state of ${b.title}`}
                      className="h-full w-full object-cover object-left-top"
                    />
                  ) : (
                    <BoardStateFallback board={b} theme={theme} fontCss={fontCss} />
                  )}
                  <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/20 to-transparent" />
                  <span
                    className="absolute right-1.5 top-1.5 rounded px-1.5 py-0.5 font-mono text-[8.5px] uppercase tracking-wide"
                    style={{ background: `${meta.accent}26`, color: meta.accent }}
                  >
                    {isMain ? "main" : creator === "agent" ? "AI thread" : "branch"}
                  </span>
                </div>
                <div className="px-2.5 py-2">
                  <div className="truncate text-[12.5px] font-medium text-fg">{b.title}</div>
                  <div className="mt-0.5 line-clamp-2 min-h-[28px] text-[10px] leading-[1.35] text-mut" title={reason}>
                    {reason}
                  </div>
                  <div className="mt-1.5 flex items-center justify-between gap-2 font-mono text-[9px] text-dim">
                    <span>{b.blocks.length} blocks · {meta.label}</span>
                    {createdAt && <span>{formatThreadTime(createdAt)}</span>}
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        <div className="flex items-center justify-between border-t border-edge px-4 py-2.5">
          <span className="font-mono text-[10.5px] text-dim">Threads are logged when you or the tutor branch the board</span>
          <span className="rounded bg-accent px-3 py-1.5 text-[12px] font-medium text-white">{threadLog.length} logged</span>
        </div>
      </div>
    </div>
  );
}

function formatThreadTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "logged";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/* Content-based fallback for browsers that block DOM-to-image capture. */
function BoardStateFallback({ board, theme, fontCss }: { board: BoardDoc; theme: BoardTheme; fontCss: string }) {
  return (
    <div className="absolute left-0 top-0 origin-top-left" style={{ width: 920, transform: "scale(0.285)", padding: 28, color: theme.chalk, fontFamily: fontCss }}>
      <div className="space-y-5">
        {board.blocks.map((block) => <MiniBlock key={block.id} block={block} />)}
      </div>
    </div>
  );
}

function MiniBlock({ block }: { block: Block }) {
  switch (block.kind) {
    case "title":
      return <div className="text-[38px] leading-tight">{block.text}</div>;
    case "text":
      return <div className="max-w-[650px] text-[19px] leading-relaxed opacity-90">{block.text}</div>;
    case "bullets":
      return <div className="space-y-1 text-[18px] opacity-90">{block.items.map((item) => <div key={item}>› {item}</div>)}</div>;
    case "latex":
      return <div><div className="font-mono text-[22px]">{block.tex}</div><div className="text-[14px] opacity-60">{block.caption}</div></div>;
    case "callout":
      return <div className="inline-block rounded-lg border-2 border-dashed border-current px-4 py-2 text-[18px] opacity-80">{block.text}</div>;
    case "visualization": {
      const title = "title" in block.intent && block.intent.title ? block.intent.title : block.intent.type;
      return <div className="inline-block rounded-lg border border-current/50 px-3 py-2 text-[16px] opacity-80">∿ {title}</div>;
    }
    case "widget": {
      // Thread previews are static thumbnails, so a widget is summarized by its
      // label rather than rendered interactively.
      const title = block.intent.title ?? WIDGET_LABEL[block.intent.kind];
      return <div className="inline-block rounded-lg border border-current/50 px-3 py-2 text-[16px] opacity-80">▤ {title}</div>;
    }
    case "row":
      return <div className="grid grid-cols-2 gap-8">{block.children.map((child) => <MiniBlock key={child.id} block={child} />)}</div>;
  }
}

/* ══ Settings (Temporary Agent Endpoint section removed completely) ══ */

export function SettingsPanel({
  theme,
  setTheme,
  fontId,
  setFontId,
  fontScale,
  setFontScale,
  latex,
  setLatex,
  boardRevertsWithMessage,
  setBoardRevertsWithMessage,
  onClose,
}: {
  theme: BoardTheme;
  setTheme: (t: BoardTheme) => void;
  fontId: string;
  setFontId: (f: string) => void;
  fontScale: number;
  setFontScale: (n: number) => void;
  latex: boolean;
  setLatex: (b: boolean) => void;
  boardRevertsWithMessage: boolean;
  setBoardRevertsWithMessage: (b: boolean) => void;
  onClose: () => void;
}) {
  return (
    <div className="anim-toast absolute right-4 top-[68px] z-40 w-[298px] overflow-hidden rounded-lg border border-edge bg-[#161616]/97 shadow-[0_20px_56px_rgba(0,0,0,0.6)] backdrop-blur-md">
      <div className="flex items-center justify-between border-b border-edge px-3 py-2.5">
        <h3 className="text-[12.5px] font-semibold text-fg">Board settings</h3>
        <button onClick={onClose} className="text-[12px] text-dim hover:text-fg">
          Close
        </button>
      </div>

      <div className="max-h-[54vh] overflow-y-auto p-3">
        <Label>Board style</Label>
        <div className="mb-4 grid grid-cols-3 gap-2">
          {THEMES.map((t) => (
            <button
              key={t.id}
              onClick={() => setTheme(t)}
              className={`overflow-hidden rounded-md border-2 transition-all ${
                theme.id === t.id ? "border-accent" : "border-edge hover:border-white/25"
              }`}
            >
              <div className="h-11 w-full" style={{ background: t.bg }} />
              <div className="px-1 py-1 text-[9.5px] leading-tight text-mut">{t.label}</div>
            </button>
          ))}
        </div>

        <Label>Handwriting</Label>
        <div className="mb-4 space-y-1">
          {FONTS.map((f) => (
            <button
              key={f.id}
              onClick={() => setFontId(f.id)}
              className={`flex w-full items-center justify-between rounded px-2 py-1.5 text-left transition-colors ${
                fontId === f.id ? "bg-white/[0.09]" : "hover:bg-white/[0.06]"
              }`}
            >
              <span className="text-[15px] text-fg" style={{ fontFamily: f.css }}>
                {f.label}
              </span>
              {fontId === f.id && <Check size={13} className="text-accent" />}
            </button>
          ))}
        </div>

        <Label>Text size · {Math.round(fontScale * 100)}%</Label>
        <input
          type="range"
          min={0.75}
          max={1.5}
          step={0.05}
          value={fontScale}
          onChange={(e) => setFontScale(parseFloat(e.target.value))}
          className="mb-4 w-full accent-[#2383e2]"
        />

        <button
          onClick={() => setLatex(!latex)}
          className="flex w-full items-center gap-2.5 rounded-md border border-edge bg-raise px-2.5 py-2 text-left transition-colors hover:bg-white/[0.07]"
        >
          <span className="flex-1">
            <span className="block text-[12.5px] text-fg">LaTeX rendering</span>
            <span className="block text-[10.5px] text-dim">KaTeX for equations</span>
          </span>
          <span className={`h-4 w-7 rounded-full p-0.5 transition-colors ${latex ? "bg-accent" : "bg-[#3a3a38]"}`}>
            <span className={`block h-3 w-3 rounded-full bg-white transition-transform ${latex ? "translate-x-3" : ""}`} />
          </span>
        </button>

        <div className="mt-4">
          <Label>Reverting a message</Label>
          <button
            onClick={() => setBoardRevertsWithMessage(!boardRevertsWithMessage)}
            className="flex w-full items-center gap-2.5 rounded-md border border-edge bg-raise px-2.5 py-2 text-left transition-colors hover:bg-white/[0.07]"
          >
            <span className="flex-1">
              <span className="block text-[12.5px] text-fg">Board reverts too</span>
              <span className="block text-[10.5px] leading-snug text-dim">
                {boardRevertsWithMessage
                  ? "Undoing a message also undoes what the tutor drew for it"
                  : "Undoing a message keeps everything on the board"}
              </span>
            </span>
            <span className={`h-4 w-7 flex-none rounded-full p-0.5 transition-colors ${boardRevertsWithMessage ? "bg-accent" : "bg-[#3a3a38]"}`}>
              <span className={`block h-3 w-3 rounded-full bg-white transition-transform ${boardRevertsWithMessage ? "translate-x-3" : ""}`} />
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <div className="mb-1.5 font-mono text-[10px] uppercase tracking-wider text-dim">{children}</div>;
}

function MMButton({
  children,
  onClick,
  title,
  label,
  disabled = false,
}: {
  children: React.ReactNode;
  onClick: () => void;
  title: string;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      disabled={disabled}
      className="flex items-center gap-1 rounded px-1.5 py-1 text-[9.5px] text-white/45 transition-colors hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-transparent disabled:hover:text-white/45"
    >
      {children}
      <span className="font-medium">{label}</span>
    </button>
  );
}

/* ══ Chat dock — floating panel like the reference ══ */

export interface ChatMsg {
  id: number;
  role: "tutor" | "user" | "system";
  text: string;
  imageData?: string;
  /** Board state as it stood immediately BEFORE this message was sent.
   *
   *  Reverting to a message restores this snapshot, so undoing a question also
   *  undoes everything the tutor drew in response to it. Captured only on user
   *  messages, which are the only revertable points. Optional because sessions
   *  saved before board-revert existed have no snapshot — those revert the
   *  transcript alone rather than failing. */
  boardSnapshot?: BoardSnapshot;
}

/** The board half of a revert point. Cloned at capture time so later mutation
 *  of the live boards cannot reach back and corrupt the history. */
export interface BoardSnapshot {
  boards: BoardDoc[];
  activeId: string;
}

export type AgentActivityKind =
  | "planning"
  | "thinking"
  | "responding"
  | "writing"
  | "visualizing"
  | "revising"
  | "spawning"
  | "complete"
  | "error";

export interface AgentActivity {
  kind: AgentActivityKind;
  label: string;
  detail: string;
  progress?: { current: number; total: number };
}

function AgentActivityWidget({ activity }: { activity: AgentActivity }) {
  // Planning/thinking is intentionally a tiny neutral presence. The expanded
  // blue activity card is reserved for an actual board/tool operation.
  if (["planning", "thinking", "responding"].includes(activity.kind)) {
    return (
      <div className="flex items-center gap-2 px-1 py-1 text-[9.5px] text-white/45" role="status" aria-live="polite">
        <span className="flex items-center gap-0.5" aria-hidden="true">
          {[0, 1, 2].map((i) => <span key={i} className="h-1.5 w-1.5 rounded-full bg-white/55 animate-bounce" style={{ animationDelay: `${i * 140}ms` }} />)}
        </span>
        <span>agent is thinking...</span>
      </div>
    );
  }

  const done = activity.kind === "complete";
  const failed = activity.kind === "error";
  const active = !done && !failed;
  const Icon = done
    ? CheckCircle2
    : failed
      ? X
      : activity.kind === "spawning"
        ? GitBranch
        : activity.kind === "visualizing"
          ? Network
          : activity.kind === "revising"
            ? FilePenLine
            : LoaderCircle;
  const progress = activity.progress;
  const percentage = progress ? Math.max(0, Math.min(100, (progress.current / progress.total) * 100)) : 0;

  return (
    <div
      className={`agent-activity relative overflow-hidden rounded-lg border px-2.5 py-2 ${
        done
          ? "border-[#4fb477]/25 bg-[#4fb477]/8"
          : failed
            ? "border-[#f87171]/25 bg-[#f87171]/8"
            : "agent-activity-active border-[#7dd3fc]/20 bg-[#2383e2]/10"
      }`}
      role="status"
      aria-live="polite"
      aria-label={`${activity.label}. ${activity.detail}`}
    >
      <div className="flex items-start gap-2">
        <span
          className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-md ${
            done ? "bg-[#4fb477]/15 text-[#86efac]" : failed ? "bg-[#f87171]/15 text-[#fca5a5]" : "bg-[#2383e2]/20 text-[#7dd3fc]"
          }`}
        >
          <Icon
            size={14}
            aria-hidden="true"
            className={active && Icon === LoaderCircle ? "animate-spin" : ""}
          />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center justify-between gap-2">
            <span className="truncate text-[10.5px] font-medium text-white/85">{activity.label}</span>
            {progress && (
              <span className="shrink-0 font-mono text-[8.5px] text-white/35">
                {progress.current}/{progress.total}
              </span>
            )}
          </span>
          <span className="mt-0.5 block text-[9.5px] leading-snug text-white/45">{activity.detail}</span>
        </span>
      </div>
      {progress && (
        <div className="mt-2 h-0.5 overflow-hidden rounded-full bg-white/8" aria-hidden="true">
          <div
            className="h-full rounded-full bg-[#7dd3fc]/70 transition-[width] duration-300 motion-reduce:transition-none"
            style={{ width: `${percentage}%` }}
          />
        </div>
      )}
    </div>
  );
}

function GenerativeTutorText({ text, animate }: { text: string; animate: boolean }) {
  const [visibleLength, setVisibleLength] = useState(animate ? 0 : text.length);

  useEffect(() => {
    if (!animate || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setVisibleLength(text.length);
      return;
    }

    setVisibleLength(0);
    let frame = 0;
    let revealed = 0;
    let last = performance.now();
    const step = (now: number) => {
      if (now - last >= 22) {
        const remaining = text.length - revealed;
        const increment = Math.max(1, Math.min(5, Math.ceil(remaining / 28)));
        revealed = Math.min(text.length, revealed + increment);
        setVisibleLength(revealed);
        last = now;
      }
      if (revealed < text.length) frame = window.requestAnimationFrame(step);
    };
    frame = window.requestAnimationFrame(step);
    return () => window.cancelAnimationFrame(frame);
  }, [animate, text]);

  const generating = visibleLength < text.length;
  return (
    <div className={`text-[10.5px] leading-[1.5] text-white/82 ${animate ? "generative-text" : ""}`}>
      <span aria-hidden={generating}>• {text.slice(0, visibleLength)}</span>
      {generating && <span className="generative-caret ml-0.5 inline-block h-[1em] w-px translate-y-[2px] bg-[#7dd3fc]" aria-hidden="true" />}
      {generating && <span className="sr-only">{text}</span>}
    </div>
  );
}

export interface ChatAttachment {
  name: string;
  kind: "file" | "image" | "audio" | "code";
  url?: string;
  mimeType?: string;
  textContent?: string;
}

export function ChatDock({
  messages,
  onSend,
  onRevertMessage,
  collapsed,
  setCollapsed,
  onClose,
  typing,
  attachments,
  onAddAttachment,
  onClearAttachments,
  onRemoveAttachment,
  rewinding,
  agentStatus,
  activity,
}: {
  chatOpen?: boolean;
  messages: ChatMsg[];
  onSend: (t: string, imgData?: string) => void;
  onRevertMessage: (messageId: number) => void;
  collapsed: boolean;
  setCollapsed: (b: boolean) => void;
  onClose: () => void;
  typing: boolean;
  attachments: ChatAttachment[];
  onAddAttachment: (
    kind: ChatAttachment["kind"],
    name?: string,
    url?: string,
    mimeType?: string,
    textContent?: string
  ) => void;
  onClearAttachments: () => void;
  onRemoveAttachment: (index: number) => void;
  onSpeakLast: () => void;
  rewinding: boolean;
  agentStatus?: "idle" | "thinking" | "writing" | "error";
  activity?: AgentActivity | null;
}) {
  const [val, setVal] = useState("");
  const [isRecordingVoice, setIsRecordingVoice] = useState(false);
  const [attachmentError, setAttachmentError] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  // Messages present when the dock mounts are restored history. Only tutor
  // messages arriving afterwards receive the live generative-text treatment.
  const initialMessageIds = useRef(new Set(messages.map((message) => message.id)));
  const imageInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dictationRef = useRef<LiveDictation | null>(null);

  useEffect(() => () => dictationRef.current?.stop(), []);

  /* draggable position */
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const dragRef = useRef<{ dx: number; dy: number } | null>(null);
  const shellRef = useRef<HTMLDivElement>(null);

  const toggleVoiceDictation = () => {
    if (isRecordingVoice) {
      dictationRef.current?.stop();
      dictationRef.current = null;
      setIsRecordingVoice(false);
      return;
    }
    const live = startLiveDictation(
      (text) => setVal(text),
      () => setIsRecordingVoice(false)
    );
    if (live) {
      dictationRef.current = live;
      setIsRecordingVoice(true);
    }
  };

  const readImageAttachment = (file: File) => {
    // The Tutor transport accepts data URLs up to 8M characters. Reject before
    // FileReader allocates a larger base64 copy in the webview.
    if (!file.type.startsWith("image/")) {
      setAttachmentError("Choose an image file.");
      return;
    }
    if (file.size > 5_000_000) {
      setAttachmentError("Images must be 5 MB or smaller.");
      return;
    }
    setAttachmentError("");
    const reader = new FileReader();
    reader.onload = (evt) => {
      const url = evt.target?.result;
      if (typeof url === "string" && url.startsWith("data:image/")) {
        onAddAttachment("image", file.name, url, file.type);
      } else setAttachmentError("That image could not be read.");
    };
    reader.onerror = () => setAttachmentError("That image could not be read.");
    reader.readAsDataURL(file);
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) readImageAttachment(file);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    const extension = file.name.toLowerCase().match(/\.[^.]+$/)?.[0] ?? "";
    if (file.type.startsWith("image/")) {
      readImageAttachment(file);
      return;
    }
    if (extension !== ".txt" && extension !== ".md") {
      setAttachmentError("Only .txt, .md, and image files are supported.");
      return;
    }
    if (file.size > 120_000) {
      setAttachmentError("Text files must be 120 KB or smaller.");
      return;
    }

    setAttachmentError("");
    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result;
      if (typeof text === "string") {
        onAddAttachment(
          "file",
          file.name,
          undefined,
          extension === ".md" ? "text/markdown" : "text/plain",
          text
        );
      } else setAttachmentError("That text file could not be read.");
    };
    reader.onerror = () => setAttachmentError("That text file could not be read.");
    reader.readAsText(file);
  };

  const startDrag = (e: React.MouseEvent) => {
    const box = shellRef.current?.getBoundingClientRect();
    if (!box) return;
    dragRef.current = { dx: e.clientX - box.left, dy: e.clientY - box.top };
    e.preventDefault();
  };

  useEffect(() => {
    const move = (e: MouseEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const w = shellRef.current?.offsetWidth ?? 520;
      const h = shellRef.current?.offsetHeight ?? 200;
      const x = Math.min(Math.max(8, e.clientX - d.dx), window.innerWidth - w - 8);
      const y = Math.min(Math.max(8, e.clientY - d.dy), window.innerHeight - h - 8);
      setPos({ x, y });
    };
    const up = () => (dragRef.current = null);
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
  }, []);

  const shellStyle: React.CSSProperties = pos
    ? { left: pos.x, top: pos.y, transform: "none" }
    : {};
  const shellClass = pos
    ? "absolute z-40 w-[min(520px,calc(100vw-32px))]"
    : "absolute left-1/2 top-[68px] z-40 w-[min(520px,calc(100vw-32px))] -translate-x-1/2";

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, typing]);

  const send = () => {
    if (rewinding || (!val.trim() && attachments.length === 0)) return;
    const imgAtt = attachments.find((a) => a.kind === "image");
    onSend(val.trim(), imgAtt?.url);
    setVal("");
  };

  const attachmentsBar = (attachments.length > 0 || attachmentError) ? (
    <div className="flex items-center gap-1.5 overflow-x-auto border-b border-white/[0.08] px-2.5 py-1.5">
      {attachmentError && <span className="shrink-0 font-mono text-[9.5px] text-red-300" role="alert">{attachmentError}</span>}
      {attachments.length === 0 ? (
        !attachmentError && <span className="font-mono text-[9.5px] text-white/30">No attachments · click File, Image, or Voice below</span>
      ) : (
        <>
          {attachments.map((a, i) => (
            <span key={i} className="flex items-center gap-1.5 rounded bg-white/[0.07] px-2 py-1 font-mono text-[10px] text-white/85">
              <span className="h-1.5 w-1.5 rounded-full bg-accent" />
              {a.name}
              <button
                onClick={() => onRemoveAttachment(i)}
                aria-label={`Remove ${a.name}`}
                title={`Remove ${a.name}`}
                className="grid h-3.5 w-3.5 place-items-center rounded text-white/45 transition-colors hover:bg-white/10 hover:text-white"
              >
                <X size={9} />
              </button>
            </span>
          ))}
          <button onClick={onClearAttachments} className="ml-auto font-mono text-[9.5px] text-white/40 hover:text-white">
            clear
          </button>
        </>
      )}
    </div>
  ) : null;

  const multimodalRow = (
    <div className="relative flex items-center gap-0.5 px-2 py-1">
      <input
        ref={fileInputRef}
        type="file"
        accept=".txt,.md,image/*"
        hidden
        onChange={handleFileUpload}
      />
      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        hidden
        onChange={handleImageUpload}
      />

      <MMButton disabled={rewinding} onClick={() => fileInputRef.current?.click()} title="Attach a file" label="File">
        <Paperclip size={13} />
      </MMButton>
      <MMButton disabled={rewinding} onClick={() => imageInputRef.current?.click()} title="Attach an image" label="Image">
        <ImageIcon size={13} />
      </MMButton>
      <MMButton disabled={rewinding} onClick={toggleVoiceDictation} title="Voice input / Dictation" label="Voice">
        <Mic size={13} className={isRecordingVoice ? "text-accent animate-pulse" : ""} />
      </MMButton>
    </div>
  );

  /* Collapsed = only the thin bar */
  if (collapsed) {
    // While the agent is thinking/writing, the "Chat" button becomes an
    // animated typing bubble so the collapsed bar still signals activity.
    const busy = Boolean(activity && activity.kind !== "complete" && activity.kind !== "error")
      || typing
      || (agentStatus != null && agentStatus !== "idle" && agentStatus !== "error");
    return (
      <div ref={shellRef} className={shellClass} style={shellStyle}>
        <div
          onMouseDown={startDrag}
          className="flex cursor-grab items-center gap-2 rounded-md border border-white/8 bg-[#343436]/58 px-2 py-1.5 shadow-[0_8px_24px_rgba(0,0,0,0.25)] active:cursor-grabbing"
        >
          {busy ? (
            <button
              onMouseDown={(e) => e.stopPropagation()}
              onClick={() => setCollapsed(false)}
              className="flex h-[22px] max-w-[180px] items-center gap-1.5 rounded bg-accent/20 px-2 text-[9.5px] text-white/85"
              title={activity?.detail ?? (agentStatus === "writing" ? "Agent writing on the board…" : "Agent thinking…")}
              aria-label={activity?.label ?? "Agent is responding"}
            >
              <LoaderCircle size={11} className="shrink-0 animate-spin text-[#7dd3fc] motion-reduce:animate-none" />
              <span className="truncate">{activity?.label ?? "Working…"}</span>
            </button>
          ) : (
            <button
              onMouseDown={(e) => e.stopPropagation()}
              onClick={() => setCollapsed(false)}
              title="Expand the AI Response panel"
              className="rounded bg-white/10 px-2 py-1 text-[10px] font-medium text-white/75 transition-colors hover:bg-white/20 hover:text-white"
            >
              Chat
            </button>
          )}
          <textarea
            value={val}
            rows={Math.min(5, Math.max(1, val.split(/\r?\n/).length))}
            aria-label="AI Response message"
            onChange={(e) => setVal(e.target.value)}
            onMouseDown={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            disabled={rewinding}
            placeholder={rewinding ? "Returning conversation…" : busy ? "Studyus is responding…" : "Ask anything about the board…"}
            className="max-h-[90px] min-w-0 flex-1 resize-none overflow-y-auto cursor-text bg-transparent text-[11px] leading-[18px] text-white outline-none placeholder:text-white/35 disabled:cursor-wait disabled:opacity-60"
          />
          <button
            onClick={send}
            disabled={rewinding || !val.trim()}
            className={`rounded px-2.5 py-1 text-[10px] font-medium transition-all ${
              !rewinding && val.trim() ? "bg-white text-black active:scale-95" : "bg-white/10 text-white/30"
            }`}
          >
            Send
          </button>
        </div>
      </div>
    );
  }

  return (
    <div ref={shellRef} className={shellClass} style={shellStyle}>
      {/* Floating Pill Window for Active Voice Soundwaves */}
      {isRecordingVoice && (
        <div className="anim-toast absolute -top-12 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 rounded-full border border-accent/40 bg-[#1c1c1e]/95 px-4 py-2 shadow-2xl backdrop-blur-md">
          <span className="h-2.5 w-2.5 rounded-full bg-accent animate-ping" />
          <span className="font-mono text-[11px] font-medium text-fg">Listening…</span>
          <div className="flex items-center gap-1 h-4">
            <span className="h-3 w-1 rounded bg-accent animate-bounce" style={{ animationDelay: "0ms" }} />
            <span className="h-4 w-1 rounded bg-accent animate-bounce" style={{ animationDelay: "150ms" }} />
            <span className="h-2 w-1 rounded bg-accent animate-bounce" style={{ animationDelay: "300ms" }} />
            <span className="h-4 w-1 rounded bg-accent animate-bounce" style={{ animationDelay: "450ms" }} />
            <span className="h-2.5 w-1 rounded bg-accent animate-bounce" style={{ animationDelay: "600ms" }} />
          </div>
          <button
            onClick={toggleVoiceDictation}
            className="ml-1 rounded-full bg-white/10 px-2 py-0.5 font-mono text-[9.5px] text-white hover:bg-white/20"
          >
            Done
          </button>
        </div>
      )}

      <div className="anim-toast overflow-hidden rounded-md border border-white/8 bg-[#343436]/58 shadow-[0_12px_32px_rgba(0,0,0,0.25)]">
        {/* compact title bar */}
        <div
          onMouseDown={startDrag}
          className="flex h-8 cursor-grab items-center gap-2 border-b border-white/[0.08] px-2.5 active:cursor-grabbing"
        >
          <div className="text-[10px] font-semibold text-white/75">AI Response</div>
          <div className="mx-auto max-w-[280px] flex-1 truncate rounded bg-white/[0.07] px-2 py-1 text-center font-mono text-[8.5px] text-white/52">
            Ask anything about the shared chalkboard
          </div>
          <button
            onMouseDown={(e) => e.stopPropagation()}
            onClick={() => setCollapsed(true)}
            className="rounded px-1 py-0.5 text-white/40 transition-colors hover:bg-white/10 hover:text-white"
            title="Collapse"
          >
            <Minus size={13} />
          </button>
          <button
            onMouseDown={(e) => e.stopPropagation()}
            onClick={onClose}
            className="rounded px-1 py-0.5 text-[9px] text-white/40 transition-colors hover:bg-white/10 hover:text-white"
          >
            Esc
          </button>
        </div>

        {/* message stream */}
        <div className="max-h-[210px] space-y-2 overflow-y-auto px-3 py-2.5">
          {messages.map((m) => {
            if (m.role === "system") {
              return (
                <div key={m.id} className="anim-msg rounded bg-white/[0.04] px-2 py-1 font-mono text-[9.5px] text-white/40">
                  {m.text}
                </div>
              );
            }
            if (m.role === "user") {
              return (
                <div key={m.id} className="anim-msg space-y-1">
                  <div className="text-right text-[8.5px] uppercase tracking-[0.12em] text-white/30">You</div>
                  <div className="ml-auto max-w-[90%] rounded bg-white/[0.07] px-2 py-1.5 text-[10.5px] leading-relaxed text-white/82">
                    <div>{m.text}</div>
                    {m.imageData && (
                      <img
                        src={m.imageData}
                        alt="User uploaded attachment"
                        className="mt-2 max-h-[160px] max-w-full rounded-md border border-white/10 object-contain"
                      />
                    )}
                    <div className="mt-1 flex justify-end">
                      <button
                        type="button"
                        onClick={() => {
                          setVal(m.text);
                          onRevertMessage(m.id);
                        }}
                        disabled={rewinding}
                        aria-label="Revert to this message"
                        title="Revert to this message"
                        className="grid h-5 w-5 place-items-center rounded text-white/35 transition-colors hover:bg-white/10 hover:text-white/80 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#7dd3fc]/70 disabled:cursor-wait disabled:opacity-35"
                      >
                        <Undo2 size={11} aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            }
            return (
              <div key={m.id} className="anim-msg">
                <div className="mb-0.5 text-[8.5px] uppercase tracking-[0.12em] text-white/30">
                  AI Response
                </div>
                <GenerativeTutorText text={m.text} animate={!initialMessageIds.current.has(m.id)} />
              </div>
            );
          })}
          {activity ? (
            <AgentActivityWidget activity={activity} />
          ) : (typing || (agentStatus && agentStatus !== "idle")) ? (
            <AgentActivityWidget
              activity={{
                kind: agentStatus === "writing" ? "writing" : agentStatus === "error" ? "error" : "thinking",
                label: agentStatus === "writing" ? "Updating the board" : agentStatus === "error" ? "Could not finish" : "agent is thinking...",
                detail: agentStatus === "writing" ? "Applying validated board changes" : agentStatus === "error" ? "The operation stopped safely" : "Reading your request and board context",
              }}
            />
          ) : null}
          <div ref={endRef} />
        </div>

        {/* attachment strip */}
        {attachmentsBar}

        {/* composer with multimodal row + send */}
        <div className="border-t border-white/[0.08]">
          {multimodalRow}
          <div className="flex items-center gap-2 px-2.5 pb-2">
            <textarea
              value={val}
              rows={Math.min(5, Math.max(1, val.split(/\r?\n/).length))}
              aria-label="AI Response message"
              onChange={(e) => setVal(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              disabled={rewinding}
              placeholder={rewinding ? "Returning conversation…" : "what if I want to…"}
              className="max-h-[90px] min-w-0 flex-1 resize-none overflow-y-auto rounded bg-black/15 px-2 py-1.5 text-[10px] leading-relaxed text-white outline-none placeholder:text-white/30 disabled:cursor-wait disabled:opacity-60"
            />
            <button
              onClick={send}
              disabled={rewinding || (!val.trim() && attachments.length === 0)}
              className={`rounded px-2.5 py-1.5 text-[9.5px] font-medium transition-all ${
                !rewinding && (val.trim() || attachments.length > 0) ? "bg-white text-black active:scale-95" : "bg-white/10 text-white/30"
              }`}
            >
              Submit
            </button>
          </div>
        </div>
      </div>

      <div className="mt-1 flex justify-end">
        <button
          onClick={() => setCollapsed(true)}
          className="flex items-center gap-1 rounded border border-white/10 bg-[#343436]/90 px-2 py-0.5 text-[9px] text-white/45 transition-colors hover:text-white/75"
        >
          <ChevronDown size={11} />
          Collapse to bar
        </button>
      </div>
    </div>
  );
}
