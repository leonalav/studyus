import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Chalkboard, THEMES, FONTS, type BoardTheme, type BoardView, type Stroke } from "./Chalkboard";
import { BoardToolbar, type PanelId, type PenTool } from "./BoardToolbar";
import { ThreadsPanel, SettingsPanel, ChatDock, type ChatMsg } from "./BoardPanels";
import { buildSubBoard, boardToMarkdown, DOMAIN_META, type BoardDoc } from "../../data/boards";
import { defaultTools, runAgent, type AgentEndpoint } from "../../lib/agent";
import { toPng } from "html-to-image";

interface Props {
  initialBoard: BoardDoc;
  onLeave: () => void;
  notify: (t: string) => void;
}

export function StudyRoom({ initialBoard, onLeave, notify }: Props) {
  const [boards, setBoards] = useState<BoardDoc[]>([initialBoard]);
  const [activeId, setActiveId] = useState(initialBoard.id);
  const [written, setWritten] = useState<Set<string>>(new Set());

  const [theme, setTheme] = useState<BoardTheme>(THEMES[0]);
  const [fontId, setFontId] = useState("gloria");
  const [fontScale, setFontScale] = useState(1);
  const [latex, setLatex] = useState(true);

  const [panel, setPanel] = useState<PanelId>(null);
  const [chatOpen, setChatOpen] = useState(true);
  const [chatCollapsed, setChatCollapsed] = useState(false);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [typing, setTyping] = useState(false);

  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [endpoint, setEndpoint] = useState<AgentEndpoint>({
    baseUrl: "",
    model: "",
    apiKey: "",
    enabled: false,
  });
  const [attachments, setAttachments] = useState<{ name: string; kind: "file" | "image" | "audio" | "code" }[]>([]);
  const [agentStatus, setAgentStatus] = useState<"idle" | "thinking" | "writing" | "error">("idle");
  const [penTool, setPenTool] = useState<PenTool>("pen");
  const [penColor, setPenColor] = useState("#fbbf24");
  const clearInkRef = useRef<() => void>(() => {});
  const boardRootRef = useRef<HTMLDivElement | null>(null);
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [viewMap, setViewMap] = useState<Record<string, BoardView>>({});
  const [strokeMap, setStrokeMap] = useState<Record<string, Stroke[]>>({});

  const msgId = useRef(0);
  const board = boards.find((b) => b.id === activeId) ?? boards[0];
  const fontCss = FONTS.find((f) => f.id === fontId)?.css ?? FONTS[0].css;

  const captureActive = useCallback(async () => {
    const node = boardRootRef.current;
    if (!node) return;
    try {
      const image = await toPng(node, {
        cacheBust: true,
        pixelRatio: 0.45,
        skipFonts: true,
        backgroundColor: theme.swatch,
      });
      setPreviews((current) => ({ ...current, [activeId]: image }));
    } catch {
      // Threads has a content-based fallback if a browser blocks DOM capture.
    }
  }, [activeId, theme.swatch]);

  const saveView = useCallback((view: BoardView) => {
    setViewMap((current) => ({ ...current, [activeId]: view }));
  }, [activeId]);

  const saveStrokes = useCallback((strokes: Stroke[]) => {
    setStrokeMap((current) => ({ ...current, [activeId]: strokes }));
  }, [activeId]);

  /* session timer */
  useEffect(() => {
    const id = window.setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => window.clearInterval(id);
  }, []);
  const elapsed = useMemo(() => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }, [seconds]);

  /* mark board as written once its animation completes */
  useEffect(() => {
    if (written.has(board.id)) return;
    const t = window.setTimeout(() => setWritten((w) => new Set(w).add(board.id)), board.blocks.length * 620 + 400);
    return () => window.clearTimeout(t);
  }, [board.id, board.blocks.length, written]);

  const pushTutor = useCallback((text: string, delay = 700) => {
    setTyping(true);
    window.setTimeout(() => {
      setTyping(false);
      setMessages((m) => [...m, { id: ++msgId.current, role: "tutor", text }]);
    }, delay);
  }, []);

  /* greet on entry */
  useEffect(() => {
    pushTutor(
      `Board is up — ${initialBoard.title}. I'll write here as we go. Drag the board to move around, and highlight any line to branch it into its own board.`,
      900
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* branch from highlighted text */
  const handleAsk = useCallback(
    async (selection: string, question: string) => {
      await captureActive();
      const sub = buildSubBoard(selection, question, board);
      setBoards((b) => [...b, sub]);
      setActiveId(sub.id);
      setChatOpen(true);
      setChatCollapsed(false);
      setMessages((m) => [
        ...m,
        { id: ++msgId.current, role: "user", text: question ? `${question}  ("${trim(selection)}")` : `Explain: "${trim(selection)}"` },
      ]);
      pushTutor(`New board opened for "${trim(selection)}". I'm writing the breakdown now — it's saved in Threads so you can come back to it.`, 800);
      notify("Branched into a new board");
    },
    [board, captureActive, notify, pushTutor]
  );

  /* chat replies — calls the configured agent when endpoint is enabled */
  const handleSend = useCallback(
    async (text: string) => {
      setMessages((m) => [...m, { id: ++msgId.current, role: "user", text }]);
      const meta = DOMAIN_META[board.domain];

      if (!endpoint.enabled) {
        const replies = [
          `Good — look at the ${meta.label.toLowerCase()} block on the left. Start from the definition, then substitute one value at a time.`,
          `Try it on the board: change a single variable and predict what moves. I'll check your reasoning.`,
          `That connects to what's already written — trace it from the equation down to the graph and tell me what you notice.`,
          `Short answer: yes, but the reason matters more than the result. Walk me through your first step.`,
        ];
        pushTutor(replies[Math.floor(Math.random() * replies.length)], 750 + Math.random() * 500);
        return;
      }

      setAgentStatus("thinking");
      setTyping(true);
      const controller = new AbortController();
      try {
        const system = [
          "You are Studyus, the chalkboard tutor in this app.",
          `The current board is on the domain: ${meta.label} — ${board.title}.`,
          "Use the provided tools to write on the chalkboard: titles, text, bullets, latex, plot_2d, plot_3d, draw_diagram, callout.",
          "Reply with a short text message in the chat AND call the appropriate tools to write on the board. Don't repeat the same text inside tool calls.",
          "If a tool call is appropriate, prefer it over a long text reply.",
        ].join("\n");

        const attachmentsNote =
          attachments.length > 0 ? `\n\nAttached: ${attachments.map((a) => a.name).join(", ")}` : "";

        const result = await runAgent({
          endpoint,
          system,
          user: text + attachmentsNote,
          tools: defaultTools(),
          signal: controller.signal,
        });

        if (result.text) {
          setMessages((m) => [...m, { id: ++msgId.current, role: "tutor", text: result.text }]);
        }

        // Each tool call becomes a board block
        if (result.toolCalls.length > 0) {
          setAgentStatus("writing");
          for (const call of result.toolCalls) {
            const block = toolCallToBlock(call, board.domain);
            if (block) {
              await new Promise((r) => window.setTimeout(r, 480));
              setBoards((current) => {
                const next = current.map((b) => (b.id === activeId ? appendBlock(b, block) : b));
                return next;
              });
              notify(`Agent wrote: ${block.kind}`);
            }
          }
        }

        setAgentStatus("idle");
      } catch (e: any) {
        setAgentStatus("error");
        const message = e?.message ?? "Agent failed";
        notify(`Agent: ${message}`);
        setMessages((m) => [
          ...m,
          { id: ++msgId.current, role: "system", text: `agent error: ${message}` },
        ]);
        setAgentStatus("idle");
      } finally {
        setTyping(false);
        void controller;
      }
    },
    [activeId, attachments, board.domain, board.title, endpoint, notify, pushTutor]
  );

  /* markdown recording + export */
  const buildDoc = useCallback(() => {
    const head = [
      `# Studyus session notes`,
      "",
      `- **Session length:** ${elapsed}`,
      `- **Boards:** ${boards.length}`,
      `- **Subject:** ${DOMAIN_META[board.domain].label}`,
      "",
      "---",
      "",
    ].join("\n");
    const body = boards.map(boardToMarkdown).join("\n\n---\n\n");
    const chat = messages.length
      ? "\n\n---\n\n## Chat transcript\n\n" + messages.map((m) => `**${m.role === "tutor" ? "Studyus" : "You"}:** ${m.text}`).join("\n\n")
      : "";
    return head + body + chat;
  }, [boards, messages, elapsed, board.domain]);

  const download = useCallback(() => {
    const blob = new Blob([buildDoc()], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `studyus-${board.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.md`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    notify("Notes exported as .md");
  }, [buildDoc, board.title, notify]);

  const toggleRecord = () => {
    if (recording) {
      setRecording(false);
      download();
    } else {
      setRecording(true);
      notify("Recording notes — updates live");
    }
  };

  return (
    <div className="anim-teleport relative h-full w-full overflow-hidden bg-black">
      {/* the shared screen frame */}
      <div className="share-frame absolute inset-2 overflow-hidden rounded-lg">
        <Chalkboard
          board={board}
          theme={theme}
          fontCss={fontCss}
          fontScale={fontScale}
          writing={!written.has(board.id)}
          latex={latex}
          onAsk={handleAsk}
          annotating={panel === "annotate"}
          penColor={penColor}
          penTool={penTool}
          strokesKey={board.id}
          onClearRef={(fn) => (clearInkRef.current = fn)}
          onRootRef={(node) => (boardRootRef.current = node)}
          initialView={viewMap[board.id]}
          onViewChange={saveView}
          initialStrokes={strokeMap[board.id]}
          onStrokesChange={saveStrokes}
        />
      </div>

      <BoardToolbar
        active={panel}
        onToggle={(p) => {
          if (p === "chat") {
            if (!chatOpen) {
              setChatOpen(true);
              setChatCollapsed(false);
            } else if (chatCollapsed) {
              setChatCollapsed(false);
            } else {
              setChatOpen(false);
            }
            setPanel(null);
            return;
          }
          if (p === "threads") {
            void captureActive().finally(() => setPanel(p));
            return;
          }
          setPanel(p);
        }}
        recording={recording}
        onRecord={toggleRecord}
        onExport={download}

        threadCount={boards.length}
        onStop={onLeave}
        penTool={penTool}
        setPenTool={setPenTool}
        penColor={penColor}
        setPenColor={setPenColor}
        onClearInk={() => clearInkRef.current()}
        chatCount={messages.filter((m) => m.role === "tutor").length}
      />

      {/* live recording chip */}
      {recording && (
        <div className="anim-toast absolute left-4 top-[68px] z-40 flex items-center gap-2 rounded-md border border-[#c42b1c]/40 bg-[#1a1010]/95 px-2.5 py-1.5 backdrop-blur-md">
          <span className="h-2 w-2 animate-pulse rounded-full bg-[#ff5f56]" />
          <span className="font-mono text-[10.5px] text-[#ff8b80]">REC · notes.md</span>
          <span className="font-mono text-[10.5px] text-dim">{boards.reduce((n, b) => n + b.blocks.length, 0)} blocks</span>
        </div>
      )}

      {panel === "threads" && (
        <ThreadsPanel
          boards={boards}
          previews={previews}
          theme={theme}
          fontCss={fontCss}
          activeId={activeId}
          onPick={async (id) => {
            await captureActive();
            setActiveId(id);
            setPanel(null);
            notify("Board brought on screen");
          }}
          onClose={() => setPanel(null)}
        />
      )}

      {panel === "settings" && (
        <SettingsPanel
          theme={theme}
          setTheme={setTheme}
          fontId={fontId}
          setFontId={setFontId}
          fontScale={fontScale}
          setFontScale={setFontScale}
          latex={latex}
          setLatex={setLatex}
          endpoint={endpoint}
          setEndpoint={setEndpoint}
          onClose={() => setPanel(null)}
        />
      )}

      {chatOpen && (
        <ChatDock
          messages={messages}
          onSend={(t) => { void handleSend(t); }}
          collapsed={chatCollapsed}
          setCollapsed={setChatCollapsed}
          onClose={() => setChatOpen(false)}
          typing={typing}
          agentStatus={agentStatus}
          attachments={attachments}
          onAddAttachment={(kind) => {
            const placeholder = {
              file: `file-${Date.now()}.pdf`,
              image: `image-${Date.now()}.png`,
              audio: `voice-${Date.now()}.m4a`,
              code: `snippet-${Date.now()}.py`,
            }[kind];
            setAttachments((list) => [...list, { name: placeholder, kind }]);
            notify(`${kind} attached`);
          }}
          onClearAttachments={() => setAttachments([])}
          onSpeakLast={() => {
            const last = [...messages].reverse().find((m) => m.role === "tutor");
            if (last) notify(`Reading aloud: "${last.text.slice(0, 60)}…"`);
            else notify("Nothing to read yet");
          }}
          onInlineAction={(a) => {
            const label =
              a === "ask-tutor" ? "Ask the tutor to expand on the board" :
              a === "explain" ? "Explain deeper" :
              a === "example" ? "Show an example" : "Redo the last chalkboard step";
            setMessages((m) => [...m, { id: ++msgId.current, role: "user", text: label }]);
            pushTutor(`Got it — I'll handle "${label}" on the next pass.`, 600);
          }}
        />
      )}
    </div>
  );
}

function trim(s: string) {
  return s.length > 40 ? s.slice(0, 40) + "…" : s;
}

/* ── agent tool-call → block ── */

function toolCallToBlock(call: { name: string; args: Record<string, any> }, domain: BoardDoc["domain"]) {
  const id = `agent-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const args = call.args ?? {};
  const text = (k: string) => String(args[k] ?? "");

  switch (call.name) {
    case "write_title":
      return { id, kind: "title" as const, text: text("text") || "Section" };
    case "write_text":
      return { id, kind: "text" as const, text: text("text") };
    case "write_bullets":
      return {
        id,
        kind: "bullets" as const,
        items: Array.isArray(args.items) ? args.items.map(String) : [],
      };
    case "write_latex":
      return {
        id,
        kind: "latex" as const,
        tex: text("tex"),
        caption: text("caption") || undefined,
      };
    case "plot_2d": {
      const dx = Array.isArray(args.domainX) ? args.domainX : [0, 1];
      return {
        id,
        kind: "graph2d" as const,
        fn: text("fn") || "parabola",
        domainX: [Number(dx[0]) || 0, Number(dx[1]) || 1] as [number, number],
        caption: text("caption") || undefined,
        curves: Array.isArray(args.curves) ? args.curves.map(String) : undefined,
      };
    }
    case "plot_3d":
      return {
        id,
        kind: "graph3d" as const,
        surface: (text("surface") as "saddle" | "well" | "ripple") || "saddle",
        caption: text("caption") || undefined,
      };
    case "draw_diagram":
      return {
        id,
        kind: "diagram" as const,
        variant: (text("variant") as "orbit" | "atom" | "cell" | "stack" | "beaker") || "orbit",
        caption: text("caption") || undefined,
      };
    case "write_callout":
      return { id, kind: "callout" as const, text: text("text") };
    default:
      void domain;
      return null;
  }
}

function appendBlock(board: BoardDoc, block: NonNullable<ReturnType<typeof toolCallToBlock>>): BoardDoc {
  return { ...board, blocks: [...board.blocks, block] };
}
