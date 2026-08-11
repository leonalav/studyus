import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Chalkboard, THEMES, FONTS, type BoardTheme, type BoardView, type Stroke } from "./Chalkboard";
import { BoardToolbar, type PanelId, type PenTool } from "./BoardToolbar";
import { ThreadsPanel, SettingsPanel, ChatDock, type ChatMsg } from "./BoardPanels";
import { buildSubBoard, boardToMarkdown, DOMAIN_META, type BoardDoc } from "../../data/boards";
import { validateVisualizationIntent } from "../../lib/visualization/validate";
import type { VisualizationIntent, VisualizationState } from "../../lib/visualization/types";
import { askTutorTurn, ensureChalkboardSession } from "../../lib/tutor";
import { ContextMenu, ContextMenuTarget } from "../ContextMenu";
import { toPng } from "html-to-image";
import { saveStudySession } from "../../state/studySessionStore";
import type { OnboardingAnswers } from "../../data/tutor";

interface Props {
  initialBoard: BoardDoc;
  initialSession?: import("../../state/studySessionStore").StoredStudySession;
  /** Curriculum node ids the tutor may ground its replies on. Restored from
   *  the stored session when reopening; empty means no curriculum is bound. */
  boundNodes?: string[];
  /** Onboarding answers from the AI-generated intake interview. Threaded into
   *  every tutor turn as a consistent system reminder. Undefined for a restored
   *  session — that interview already ran. */
  onboarding?: OnboardingAnswers;
  onLeave: () => void;
  notify: (t: string) => void;
}

export function StudyRoom({ initialBoard, initialSession, boundNodes, onboarding, onLeave, notify }: Props) {
  const [boards, setBoards] = useState<BoardDoc[]>(initialSession?.boards ?? [initialBoard]);
  const [activeId, setActiveId] = useState(initialSession?.activeId ?? initialBoard.id);
  const [written, setWritten] = useState<Set<string>>(new Set((initialSession?.boards ?? []).map((item) => item.id)));

  const [theme, setTheme] = useState<BoardTheme>(THEMES[0]);
  const [fontId, setFontId] = useState("gloria");
  const [fontScale, setFontScale] = useState(1);
  const [latex, setLatex] = useState(true);

  const [panel, setPanel] = useState<PanelId>(null);
  const [chatOpen, setChatOpen] = useState(true);
  const [chatCollapsed, setChatCollapsed] = useState(false);
  const [messages, setMessages] = useState<ChatMsg[]>(initialSession?.messages ?? []);
  const [typing, setTyping] = useState(false);

  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [attachments, setAttachments] = useState<{ name: string; kind: "file" | "image" | "audio" | "code"; url?: string }[]>([]);
  const [agentStatus, setAgentStatus] = useState<"idle" | "thinking" | "writing" | "error">("idle");
  const [penTool, setPenTool] = useState<PenTool>("pen");
  const [penColor, setPenColor] = useState("#fbbf24");
  const clearInkRef = useRef<() => void>(() => {});
  const boardRootRef = useRef<HTMLDivElement | null>(null);

  /* One persisted chalkboard session per room entry; the tutor harness writes
     both sides of the conversation into session_messages under this id. */
  const [sessionId] = useState(() => initialSession?.id ?? `session-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
  const resolvedBoundNodes = boundNodes ?? initialSession?.boundNodes ?? [];
  useEffect(() => {
    void ensureChalkboardSession({ id: sessionId, title: initialBoard.title, domain: initialBoard.domain, boundNodes: resolvedBoundNodes });
  }, [sessionId, initialBoard.title, initialBoard.domain, resolvedBoundNodes]);

  /* The in-flight tutor call is aborted when the room unmounts. */
  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => () => abortRef.current?.abort(), []);
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [viewMap, setViewMap] = useState<Record<string, BoardView>>(initialSession?.viewMap ?? {});
  const [strokeMap, setStrokeMap] = useState<Record<string, Stroke[]>>(initialSession?.strokeMap ?? {});
  const [contextMenu, setContextMenu] = useState<ContextMenuTarget | null>(null);

  const msgId = useRef(0);
  const board = boards.find((b) => b.id === activeId) ?? boards[0];
  const fontCss = FONTS.find((f) => f.id === fontId)?.css ?? FONTS[0].css;

  useEffect(() => {
    const timer = window.setTimeout(() => {
      saveStudySession({
        id: sessionId,
        title: board.title,
        domain: board.domain,
        boundNodes: resolvedBoundNodes,
        boards,
        activeId,
        messages,
        viewMap,
        strokeMap,
        updatedAt: new Date().toISOString(),
      });
    }, 500);
    return () => window.clearTimeout(timer);
  }, [sessionId, board.title, board.domain, boards, activeId, messages, viewMap, strokeMap, resolvedBoundNodes]);

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    const target = e.target as HTMLElement;
    let type: ContextMenuTarget["type"] = "chalkboard_bg";

    if (target.closest("figure")) type = "graph";
    else if (target.closest("[data-block]")) type = "board_object";

    setContextMenu({
      type,
      x: e.clientX,
      y: e.clientY,
    });
  };

  const handleContextMenuAction = (actionId: string) => {
    if (actionId === "clear_board") {
      clearInkRef.current();
      notify("Board cleared");
    } else if (actionId === "ask_tutor_board" || actionId === "ask_tutor_obj") {
      notify("Asking tutor about selected content…");
    } else if (actionId === "export_board_image") {
      notify("Exporting board image…");
    } else {
      notify(`Context action executed: ${actionId}`);
    }
  };

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

  // Persist interactive visualization state (e.g. dragged point positions) into
  // the owning block so it round-trips through the saved session. Visual state
  // lives on the block, not in a side-map, because it must restore on reopen.
  const saveBlockState = useCallback(
    (blockId: string, state: VisualizationState) => {
      setBoards((current) =>
        current.map((b) =>
          b.id === activeId
            ? {
                ...b,
                blocks: b.blocks.map((blk) =>
                  blk.id === blockId && blk.kind === "visualization"
                    ? { ...blk, state }
                    : blk
                ),
              }
            : b
        )
      );
    },
    [activeId]
  );

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

  /* chat replies — routed through the tutor harness, which resolves the bound
     tutor role, validates structured output, and persists both messages */
  const handleSend = useCallback(
    async (text: string, imageData?: string) => {
      void imageData;
      setMessages((m) => [...m, { id: ++msgId.current, role: "user", text, imageData }]);
      setAgentStatus("thinking");
      setTyping(true);

      const controller = new AbortController();
      abortRef.current = controller;
      try {
        const result = await askTutorTurn({
          sessionId,
          sessionTitle: board.title,
          domain: board.domain,
          board,
          boundNodes: resolvedBoundNodes,
          onboarding: onboarding ?? undefined,
          learnerMessage: text,
          attachments: attachments.map((a) => ({ name: a.name, kind: a.kind })),
          signal: controller.signal,
        });

        const turn = result.value;
        setMessages((m) => [...m, { id: ++msgId.current, role: "tutor", text: turn.speech }]);

        // Validated board operations may append, replace, delete, or update
        // existing notebook content in place — the tutor can revise prior notes
        // and visuals instead of only stacking more text below them.
        if (turn.boardOps.length > 0) {
          setAgentStatus("writing");
          for (const op of turn.boardOps) {
            await new Promise((r) => window.setTimeout(r, 320));
            let changed = false;
            setBoards((current) =>
              current.map((b) => {
                if (b.id !== activeId) return b;
                const next = applyBoardOp(b, op as any, b.domain);
                changed = changed || next !== b;
                return next;
              })
            );
            if (changed) notify(`Tutor updated board: ${op.op}`);
          }
        }

        setAgentStatus("idle");
      } catch (e: any) {
        setAgentStatus("error");
        const message = e?.message ?? "Tutor unavailable";
        notify(`Tutor: ${message}`);
        setMessages((m) => [
          ...m,
          { id: ++msgId.current, role: "system", text: `tutor error: ${message}` },
        ]);
        setAgentStatus("idle");
      } finally {
        setTyping(false);
        if (abortRef.current === controller) abortRef.current = null;
      }
    },
    [activeId, attachments, board.domain, board.title, notify, sessionId, resolvedBoundNodes]
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
    <div
      onContextMenu={handleContextMenu}
      className="anim-teleport relative h-full w-full overflow-hidden bg-black"
    >
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
          onBlockStateChange={saveBlockState}
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

      {/* Context Menu */}
      <ContextMenu
        target={contextMenu}
        onClose={() => setContextMenu(null)}
        onAction={handleContextMenuAction}
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
          onClose={() => setPanel(null)}
        />
      )}

      {chatOpen && (
        <ChatDock
          messages={messages}
          onSend={(t, img) => { void handleSend(t, img); }}
          collapsed={chatCollapsed}
          setCollapsed={setChatCollapsed}
          onClose={() => setChatOpen(false)}
          typing={typing}
          agentStatus={agentStatus}
          attachments={attachments}
          onAddAttachment={(kind, name, url) => {
            const placeholder = name || {
              file: `file-${Date.now()}.pdf`,
              image: `image-${Date.now()}.png`,
              audio: `voice-${Date.now()}.m4a`,
              code: `snippet-${Date.now()}.py`,
            }[kind];
            setAttachments((list) => [...list, { name: placeholder, kind, url }]);
            notify(`${kind} attached`);
          }}
          onClearAttachments={() => setAttachments([])}
          onRemoveAttachment={(index) =>
            setAttachments((list) => list.filter((_, i) => i !== index))
          }
          onSpeakLast={() => {
            const last = [...messages].reverse().find((m) => m.role === "tutor");
            if (last) notify(`Reading aloud: "${last.text.slice(0, 60)}…"`);
            else notify("Nothing to read yet");
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
    case "visualize": {
      // LLM emits a VisualizationIntent (already structurally validated by the
      // agent runtime). Re-validate at the placement boundary so a corrupt or
      // drifted payload cannot reach the chalkboard as a malformed block.
      const intent = args.intent;
      const result = validateVisualizationIntent(intent);
      if (!result.valid) {
        return null;
      }
      return {
        id,
        kind: "visualization" as const,
        intent: intent as VisualizationIntent,
      };
    }
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

function blockSpecToBlock(spec: Record<string, unknown>, domain: BoardDoc["domain"], existingId?: string) {
  const kind = String(spec.kind ?? "");
  const id = existingId ?? `agent-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  switch (kind) {
    case "title":
      return { id, kind: "title" as const, text: String(spec.text ?? "Section") };
    case "text":
      return { id, kind: "text" as const, text: String(spec.text ?? "") };
    case "bullets":
      return { id, kind: "bullets" as const, items: Array.isArray(spec.items) ? spec.items.map(String) : [] };
    case "latex":
      return { id, kind: "latex" as const, tex: String(spec.tex ?? ""), caption: spec.caption ? String(spec.caption) : undefined };
    case "visualization": {
      const result = validateVisualizationIntent(spec.intent);
      if (!result.valid) return null;
      return { id, kind: "visualization" as const, intent: spec.intent as VisualizationIntent };
    }
    case "callout":
      return { id, kind: "callout" as const, text: String(spec.text ?? "") };
    default:
      void domain;
      return null;
  }
}

function mergeVisualizationState(current: VisualizationState | undefined, patch: Record<string, unknown> | undefined): VisualizationState | undefined {
  if (!patch) return current;
  const next: VisualizationState = { ...(current ?? {}) };
  if (patch.pointPositions && typeof patch.pointPositions === "object") {
    next.pointPositions = { ...(current?.pointPositions ?? {}), ...(patch.pointPositions as Record<string, [number, number]>) };
  }
  if (patch.nodePositions && typeof patch.nodePositions === "object") {
    next.nodePositions = { ...(current?.nodePositions ?? {}), ...(patch.nodePositions as Record<string, [number, number]>) };
  }
  if (patch.graph3dCamera && typeof patch.graph3dCamera === "object") {
    next.graph3dCamera = patch.graph3dCamera as VisualizationState["graph3dCamera"];
  }
  if (patch.chartViewport && typeof patch.chartViewport === 'object') {
    next.chartViewport = { ...(current?.chartViewport ?? {}), ...(patch.chartViewport as VisualizationState['chartViewport']) };
  }
  if (Array.isArray(patch.hiddenSeries)) {
    next.hiddenSeries = patch.hiddenSeries as string[];
  }
  if (patch.seriesStyleOverrides && typeof patch.seriesStyleOverrides === 'object') {
    next.seriesStyleOverrides = { ...(current?.seriesStyleOverrides ?? {}), ...(patch.seriesStyleOverrides as VisualizationState['seriesStyleOverrides']) };
  }
  if (typeof patch.scienceLayout === "string") next.scienceLayout = patch.scienceLayout;
  if (typeof patch.equationValue === "string") next.equationValue = patch.equationValue;
  return next;
}

function blockSearchText(block: BoardDoc["blocks"][number]): string {
  switch (block.kind) {
    case "title":
    case "text":
    case "callout":
      return block.text;
    case "bullets":
      return block.items.join(" \n ");
    case "latex":
      return [block.caption ?? "", block.tex].join(" ");
    case "visualization": {
      const title = "title" in block.intent ? block.intent.title ?? "" : "";
      const caption = "caption" in block.intent ? block.intent.caption ?? "" : "";
      return [block.intent.type, title, caption].join(" ");
    }
    case "row":
      return block.children.map(blockSearchText).join(" \n ");
  }
}

function resolveBoardTargetIndex(board: BoardDoc, op: Record<string, any>): number {
  if (typeof op.targetAnchor === "string" && op.targetAnchor.trim()) {
    return board.blocks.findIndex((block) => block.id === op.targetAnchor.trim());
  }
  if (Number.isInteger(op.targetIndex)) {
    return op.targetIndex >= 0 && op.targetIndex < board.blocks.length ? op.targetIndex : -1;
  }
  if (typeof op.targetMatchText === "string" && op.targetMatchText.trim()) {
    const needle = op.targetMatchText.trim().toLowerCase();
    const kind = typeof op.targetKind === "string" ? op.targetKind : null;
    return board.blocks.findIndex((block) =>
      (kind === null || block.kind === kind) && blockSearchText(block).toLowerCase().includes(needle)
    );
  }
  return -1;
}

function reviseBlockText(block: BoardDoc["blocks"][number], find: string, replace: string, replaceAll: boolean) {
  const rewrite = (text: string) => replaceAll ? text.split(find).join(replace) : text.replace(find, replace);
  switch (block.kind) {
    case "title":
      return { ...block, text: rewrite(block.text) };
    case "text":
      return { ...block, text: rewrite(block.text) };
    case "callout":
      return { ...block, text: rewrite(block.text) };
    case "latex":
      return {
        ...block,
        tex: rewrite(block.tex),
        caption: block.caption ? rewrite(block.caption) : block.caption,
      };
    case "bullets":
      return { ...block, items: block.items.map(rewrite) };
    default:
      return block;
  }
}

function applyBoardOp(board: BoardDoc, op: Record<string, any>, domain: BoardDoc["domain"]): BoardDoc {
  switch (op.op) {
    case "replace_block": {
      const index = resolveBoardTargetIndex(board, op);
      if (index < 0) return board;
      const replacement = blockSpecToBlock(op.block ?? {}, domain, board.blocks[index]?.id);
      if (!replacement) return board;
      const blocks = board.blocks.slice();
      blocks[index] = replacement;
      return { ...board, blocks };
    }
    case "insert_after": {
      const index = resolveBoardTargetIndex(board, op);
      if (index < 0) return board;
      const block = blockSpecToBlock(op.block ?? {}, domain);
      if (!block) return board;
      const blocks = board.blocks.slice();
      blocks.splice(index + 1, 0, block);
      return { ...board, blocks };
    }
    case "delete_block": {
      const index = resolveBoardTargetIndex(board, op);
      if (index < 0) return board;
      return { ...board, blocks: board.blocks.filter((_, i) => i !== index) };
    }
    case "update_visualization": {
      const index = resolveBoardTargetIndex(board, op);
      if (index < 0) return board;
      const target = board.blocks[index];
      if (target.kind !== "visualization") return board;
      if (op.intent) {
        const result = validateVisualizationIntent(op.intent);
        if (!result.valid) return board;
      }
      const blocks = board.blocks.slice();
      blocks[index] = {
        ...target,
        intent: (op.intent as VisualizationIntent | undefined) ?? target.intent,
        state: mergeVisualizationState(target.state, op.statePatch),
      };
      return { ...board, blocks };
    }
    case "revise_text": {
      const index = resolveBoardTargetIndex(board, op);
      if (index < 0 || typeof op.find !== "string") return board;
      const block = board.blocks[index];
      if (!["title", "text", "callout", "latex", "bullets"].includes(block.kind)) return board;
      const revised = reviseBlockText(block, op.find, String(op.replace ?? ""), op.replaceAll === true);
      if (revised === block) return board;
      const blocks = board.blocks.slice();
      blocks[index] = revised;
      return { ...board, blocks };
    }
    default: {
      const block = toolCallToBlock({ name: String(op.op ?? ""), args: op }, domain);
      return block ? appendBlock(board, block) : board;
    }
  }
}
