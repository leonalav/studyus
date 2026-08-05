import { useEffect, useRef, useState } from "react";
import {
  Check,
  ChevronDown,
  Minus,
  Paperclip,
  Image as ImageIcon,
  Mic,
  Code2,
  Volume2,
  Sparkles,
} from "lucide-react";
import type { Block, BoardDoc } from "../../data/boards";
import { DOMAIN_META } from "../../data/boards";
import { THEMES, FONTS, type BoardTheme } from "./Chalkboard";

export interface AgentEndpoint {
  baseUrl: string;
  model: string;
  apiKey: string;
  enabled: boolean;
}

/* ══ Threads ══ */

export function ThreadsPanel({
  boards,
  previews,
  theme,
  fontCss,
  activeId,
  onPick,
  onClose,
}: {
  boards: BoardDoc[];
  previews: Record<string, string>;
  theme: BoardTheme;
  fontCss: string;
  activeId: string;
  onPick: (id: string) => void;
  onClose: () => void;
}) {
  return (
    <div className="absolute inset-0 z-50 grid place-items-center bg-black/55 backdrop-blur-sm" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="anim-toast w-[min(900px,92vw)] overflow-hidden rounded-xl border border-edge bg-[#161616] shadow-[0_30px_80px_rgba(0,0,0,0.65)]"
      >
        <div className="flex items-center justify-between border-b border-edge px-4 py-3">
          <h3 className="text-[13.5px] font-semibold text-fg">Select a board to bring on screen</h3>
          <button onClick={onClose} className="text-[12px] text-dim transition-colors hover:text-fg">
            Close
          </button>
        </div>

        <div className="flex gap-1 border-b border-edge px-4 pt-2">
          {["Boards", "Branches", "Saved"].map((t, i) => (
            <span
              key={t}
              className={`rounded-t px-3 py-1.5 text-[12px] ${i === 0 ? "border-b-2 border-accent font-medium text-fg" : "text-dim"}`}
            >
              {t}
            </span>
          ))}
        </div>

        <div className="grid max-h-[52vh] grid-cols-2 gap-3 overflow-y-auto p-4 sm:grid-cols-3">
          {boards.map((b) => {
            const meta = DOMAIN_META[b.domain];
            const isMain = !b.parentId;
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
                    {isMain ? "main" : "branch"}
                  </span>
                </div>
                <div className="px-2.5 py-2">
                  <div className="truncate text-[12.5px] font-medium text-fg">{b.title}</div>
                  <div className="truncate font-mono text-[10px] text-dim">
                    {b.blocks.length} blocks · {meta.label}
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        <div className="flex items-center justify-between border-t border-edge px-4 py-2.5">
          <span className="font-mono text-[10.5px] text-dim">Highlight text on a board to spawn a new branch</span>
          <span className="rounded bg-accent px-3 py-1.5 text-[12px] font-medium text-white">Share</span>
        </div>
      </div>
    </div>
  );
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
    case "diagram":
      return <div className="grid h-[150px] w-[260px] place-items-center rounded-[50%] border-2 border-current text-[18px] opacity-70">{block.caption ?? block.variant}</div>;
    case "graph2d":
    case "graph3d":
      return <div className="h-[150px] w-[280px] border-b-2 border-l-2 border-current p-4 text-[17px] opacity-70">{block.caption}</div>;
    case "row":
      return <div className="grid grid-cols-2 gap-8">{block.children.map((child) => <MiniBlock key={child.id} block={child} />)}</div>;
  }
}

/* ══ Settings ══ */

export function SettingsPanel({
  theme,
  setTheme,
  fontId,
  setFontId,
  fontScale,
  setFontScale,
  latex,
  setLatex,
  endpoint,
  setEndpoint,
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
  endpoint: AgentEndpoint;
  setEndpoint: (e: AgentEndpoint) => void;
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
          className="mb-4 flex w-full items-center gap-2.5 rounded-md border border-edge bg-raise px-2.5 py-2 text-left transition-colors hover:bg-white/[0.07]"
        >
          <span className="flex-1">
            <span className="block text-[12.5px] text-fg">LaTeX rendering</span>
            <span className="block text-[10.5px] text-dim">KaTeX for equations</span>
          </span>
          <span className={`h-4 w-7 rounded-full p-0.5 transition-colors ${latex ? "bg-accent" : "bg-[#3a3a38]"}`}>
            <span className={`block h-3 w-3 rounded-full bg-white transition-transform ${latex ? "translate-x-3" : ""}`} />
          </span>
        </button>

        <div className="mb-1 flex items-center justify-between">
          <Label>Agent endpoint (temporary)</Label>
          <span className={`rounded-full px-1.5 py-[1px] text-[9.5px] font-medium ${
            endpoint.enabled ? "bg-accent/20 text-accent" : "bg-white/8 text-dim"
          }`}>
            {endpoint.enabled ? "Live" : "Off"}
          </span>
        </div>
        <p className="mb-2 text-[10.5px] text-dim">
          OpenAI-compatible chat endpoint. Used by the agent to reply in the chat box and write on the chalkboard.
        </p>
        <div className="mb-2 flex gap-1.5">
          <input
            value={endpoint.baseUrl}
            onChange={(e) => setEndpoint({ ...endpoint, baseUrl: e.target.value })}
            placeholder="https://api.openai.com/v1"
            className="min-w-0 flex-1 rounded-md border border-edge bg-black/30 px-2 py-1.5 font-mono text-[10.5px] text-fg outline-none placeholder:text-dim focus:border-accent/60"
          />
          <button
            onClick={() => setEndpoint({ ...endpoint, enabled: !endpoint.enabled })}
            className={`rounded-md px-2.5 py-1.5 text-[10.5px] font-medium transition-colors ${
              endpoint.enabled ? "bg-accent text-white" : "border border-edge bg-white/[0.06] text-mut hover:text-fg"
            }`}
          >
            {endpoint.enabled ? "Disable" : "Enable"}
          </button>
        </div>
        <input
          value={endpoint.model}
          onChange={(e) => setEndpoint({ ...endpoint, model: e.target.value })}
          placeholder="Model (e.g. gpt-4o-mini, llama-3, etc.)"
          className="mb-2 w-full rounded-md border border-edge bg-black/30 px-2 py-1.5 font-mono text-[10.5px] text-fg outline-none placeholder:text-dim focus:border-accent/60"
        />
        <input
          type="password"
          value={endpoint.apiKey}
          onChange={(e) => setEndpoint({ ...endpoint, apiKey: e.target.value })}
          placeholder="API key (kept in-session only)"
          className="w-full rounded-md border border-edge bg-black/30 px-2 py-1.5 font-mono text-[10.5px] text-fg outline-none placeholder:text-dim focus:border-accent/60"
        />
        <p className="mt-2 font-mono text-[9.5px] text-dim">
          Resets when the session ends.
        </p>
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
}: {
  children: React.ReactNode;
  onClick: () => void;
  title: string;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="flex items-center gap-1 rounded px-1.5 py-1 text-[9.5px] text-white/45 transition-colors hover:bg-white/10 hover:text-white"
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
}

export function ChatDock({
  messages,
  onSend,
  collapsed,
  setCollapsed,
  onClose,
  typing,
  attachments,
  onAddAttachment,
  onClearAttachments,
  onSpeakLast,
  onInlineAction,
  agentStatus,
}: {
  messages: ChatMsg[];
  onSend: (t: string) => void;
  collapsed: boolean;
  setCollapsed: (b: boolean) => void;
  onClose: () => void;
  typing: boolean;
  attachments: { name: string; kind: "file" | "image" | "audio" | "code" }[];
  onAddAttachment: (kind: "file" | "image" | "audio" | "code") => void;
  onClearAttachments: () => void;
  onSpeakLast: () => void;
  onInlineAction: (a: "ask-tutor" | "explain" | "example" | "redo") => void;
  agentStatus?: "idle" | "thinking" | "writing" | "error";
}) {
  const [val, setVal] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  /* draggable position — null means "use the default anchored spot" */
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const dragRef = useRef<{ dx: number; dy: number } | null>(null);
  const shellRef = useRef<HTMLDivElement>(null);

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
    if (!val.trim()) return;
    onSend(val.trim());
    setVal("");
  };

  const attachmentsBar = (
    <div className="flex items-center gap-1.5 overflow-x-auto border-b border-white/[0.08] px-2.5 py-1.5">
      {attachments.length === 0 ? (
        <span className="font-mono text-[9.5px] text-white/30">No attachments · use the row below to add a file, image, voice or code</span>
      ) : (
        <>
          {attachments.map((a, i) => (
            <span key={i} className="flex items-center gap-1 rounded bg-white/[0.07] px-1.5 py-0.5 font-mono text-[9.5px] text-white/75">
              <span className="h-1.5 w-1.5 rounded-full bg-accent" />
              {a.name}
            </span>
          ))}
          <button onClick={onClearAttachments} className="ml-auto font-mono text-[9.5px] text-white/40 hover:text-white">
            clear
          </button>
        </>
      )}
    </div>
  );

  const multimodalRow = (
    <div className="flex items-center gap-0.5 px-2 py-1">
      <MMButton onClick={() => onAddAttachment("file")} title="Attach a file" label="File">
        <Paperclip size={13} />
      </MMButton>
      <MMButton onClick={() => onAddAttachment("image")} title="Attach an image" label="Image">
        <ImageIcon size={13} />
      </MMButton>
      <MMButton onClick={() => onAddAttachment("audio")} title="Voice input" label="Voice">
        <Mic size={13} />
      </MMButton>
      <MMButton onClick={() => onAddAttachment("code")} title="Paste a code snippet" label="Code">
        <Code2 size={13} />
      </MMButton>
      <span className="mx-1 h-4 w-px bg-white/8" />
      <MMButton onClick={() => onInlineAction("ask-tutor")} title="Ask the tutor to expand on the board" label="Ask">
        <Sparkles size={13} />
      </MMButton>
      <MMButton onClick={onSpeakLast} title="Read the last tutor answer aloud" label="Read">
        <Volume2 size={13} />
      </MMButton>
    </div>
  );

  /* Collapsed = only the thin bar. It stays collapsed while typing;
     only the Chat button expands it. */
  if (collapsed) {
    return (
      <div ref={shellRef} className={shellClass} style={shellStyle}>
        <div
          onMouseDown={startDrag}
          className="flex cursor-grab items-center gap-2 rounded-md border border-white/8 bg-[#343436]/58 px-2 py-1.5 shadow-[0_8px_24px_rgba(0,0,0,0.25)] active:cursor-grabbing"
        >
          <button
            onMouseDown={(e) => e.stopPropagation()}
            onClick={() => setCollapsed(false)}
            title="Expand the AI Response panel"
            className="rounded bg-white/10 px-2 py-1 text-[10px] font-medium text-white/75 transition-colors hover:bg-white/20 hover:text-white"
          >
            Chat
          </button>
          <input
            value={val}
            onChange={(e) => setVal(e.target.value)}
            onMouseDown={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === "Enter") send();
            }}
            placeholder="Ask anything about the board…"
            className="min-w-0 flex-1 cursor-text bg-transparent text-[11px] text-white outline-none placeholder:text-white/35"
          />
          <button
            onClick={send}
            disabled={!val.trim()}
            className={`rounded px-2.5 py-1 text-[10px] font-medium transition-all ${
              val.trim() ? "bg-white text-black active:scale-95" : "bg-white/10 text-white/30"
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
      <div className="anim-toast overflow-hidden rounded-md border border-white/8 bg-[#343436]/58 shadow-[0_12px_32px_rgba(0,0,0,0.25)]">
        {/* compact title bar — drag handle */}
        <div
          onMouseDown={startDrag}
          className="flex h-8 cursor-grab items-center gap-2 border-b border-white/[0.08] px-2.5 active:cursor-grabbing"
        >
          <div className="text-[10px] font-semibold text-white/75">AI Response</div>
          <div className="mx-auto max-w-[280px] flex-1 truncate rounded bg-white/[0.07] px-2 py-1 text-center font-mono text-[8.5px] text-white/52">
            Ask anything about the shared chalkboard
          </div>
          {pos && (
            <button
              onMouseDown={(e) => e.stopPropagation()}
              onClick={() => setPos(null)}
              className="rounded px-1 py-0.5 font-mono text-[9px] text-white/35 transition-colors hover:bg-white/10 hover:text-white"
              title="Snap back to the top"
            >
              reset
            </button>
          )}
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
          {messages.length === 0 && (
              <p className="text-[10.5px] leading-relaxed text-white/40">
              Ask about anything on the board. Answers stay here — writing happens on the chalkboard.
            </p>
          )}
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
                <div key={m.id} className="anim-msg">
                  <div className="mb-0.5 text-right text-[8.5px] uppercase tracking-[0.12em] text-white/30">You</div>
                  <div className="ml-auto max-w-[90%] rounded bg-white/[0.07] px-2 py-1.5 text-[10.5px] leading-relaxed text-white/82">
                    {m.text}
                  </div>
                </div>
              );
            }
            return (
              <div key={m.id} className="anim-msg">
                <div className="mb-0.5 text-[8.5px] uppercase tracking-[0.12em] text-white/30">AI Response</div>
                <div className="text-[10.5px] leading-[1.5] text-white/82">• {m.text}</div>
              </div>
            );
          })}
          {(typing || (agentStatus && agentStatus !== "idle")) && (
            <div className="flex items-center gap-1.5 py-1 font-mono text-[9px] text-white/45">
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className="typing-dot h-1.5 w-1.5 rounded-full bg-white/40"
                  style={{ animationDelay: `${i * 0.15}s` }}
                />
              ))}
              {agentStatus === "thinking" && "agent thinking…"}
              {agentStatus === "writing" && "agent writing on the board…"}
              {agentStatus === "error" && <span className="text-[#fca5a5]">agent error</span>}
              {(typing && !agentStatus) && "thinking"}
            </div>
          )}
          <div ref={endRef} />
        </div>

        {/* attachment strip */}
        {attachmentsBar}

        {/* composer with multimodal row + send */}
        <div className="border-t border-white/[0.08]">
          {multimodalRow}
          <div className="flex items-center gap-2 px-2.5 pb-2">
            <input
              value={val}
              onChange={(e) => setVal(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && send()}
              placeholder="what if I want to…"
              className="min-w-0 flex-1 rounded bg-black/15 px-2 py-1.5 text-[10px] text-white outline-none placeholder:text-white/30"
            />
            <button
              onClick={send}
              disabled={!val.trim()}
              className={`rounded px-2.5 py-1.5 text-[9.5px] font-medium transition-all ${
                val.trim() ? "bg-white text-black active:scale-95" : "bg-white/10 text-white/30"
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
