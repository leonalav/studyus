import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Chalkboard, THEMES, FONTS, type BoardTheme, type BoardView, type Stroke } from "./Chalkboard";
import { getVisualizationPrewarmTargets, prewarmVisualizationAdapters } from "./VisualizationSurface";
import { BoardToolbar, type PanelId, type PenTool } from "./BoardToolbar";
import { ThreadsPanel, SettingsPanel, ChatDock, type AgentActivity, type ChatMsg } from "./BoardPanels";
import { buildSubBoard, boardToMarkdown, DOMAIN_META, type BoardDoc } from "../../data/boards";
import { validateVisualizationIntent } from "../../lib/visualization/validate";
import type { VisualizationIntent, VisualizationState } from "../../lib/visualization/types";
import {
  askTutorTurn,
  ensureChalkboardSession,
  getSessionThreads,
  recordSessionThread,
  type BoardOp,
  type SessionThreadLog,
} from "../../lib/tutor";
import { ContextMenu, ContextMenuTarget } from "../ContextMenu";
import { toPng } from "html-to-image";
import { saveStudySession, type StoredStudySession } from "../../state/studySessionStore";
import type { OnboardingAnswers } from "../../data/tutor";
import {
  PREFERENCES_CHANGED_EVENT,
  loadPreferences,
  type StudyusPreferences,
} from "../../lib/preferences";

interface Props {
  initialBoard: BoardDoc;
  initialSession?: StoredStudySession;
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

  const [theme, setTheme] = useState<BoardTheme>(
    () => THEMES.find((item) => item.id === initialSession?.appearance?.themeId) ?? THEMES[0]
  );
  const [fontId, setFontId] = useState(initialSession?.appearance?.fontId ?? "gloria");
  const [fontScale, setFontScale] = useState(initialSession?.appearance?.fontScale ?? 1);
  const [latex, setLatex] = useState(initialSession?.appearance?.latex ?? true);

  const [panel, setPanel] = useState<PanelId>(null);
  const [chatOpen, setChatOpen] = useState(true);
  const [chatCollapsed, setChatCollapsed] = useState(false);
  const [messages, setMessages] = useState<ChatMsg[]>(initialSession?.messages ?? []);
  const [typing, setTyping] = useState(false);
  const [speechCaption, setSpeechCaption] = useState<string | null>(null);

  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [attachments, setAttachments] = useState<{ name: string; kind: "file" | "image" | "audio" | "code"; url?: string }[]>([]);
  const [agentStatus, setAgentStatus] = useState<"idle" | "thinking" | "writing" | "error">("idle");
  const [agentActivity, setAgentActivity] = useState<AgentActivity | null>(null);
  const [threadLog, setThreadLog] = useState<SessionThreadLog[]>([]);
  const [pacing, setPacing] = useState(() => {
    const tutor = loadPreferences().tutor;
    return { sessionLength: tutor.sessionLength, breakEvery: tutor.breakEvery };
  });
  const [penTool, setPenTool] = useState<PenTool>("pen");
  const [penColor, setPenColor] = useState("#fbbf24");
  const clearInkRef = useRef<() => void>(() => {});
  const boardRootRef = useRef<HTMLDivElement | null>(null);

  /* One persisted chalkboard session per room entry; the tutor harness writes
     both sides of the conversation into session_messages under this id. */
  const [sessionId] = useState(() => initialSession?.id ?? `session-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
  const resolvedBoundNodes = useMemo(
    () => boundNodes ?? initialSession?.boundNodes ?? [],
    [boundNodes, initialSession?.boundNodes]
  );

  useEffect(() => {
    const onPreferencesChanged = (event: Event) => {
      const next = (event as CustomEvent<StudyusPreferences>).detail;
      if (next?.tutor) {
        setPacing({ sessionLength: next.tutor.sessionLength, breakEvery: next.tutor.breakEvery });
      }
    };
    window.addEventListener(PREFERENCES_CHANGED_EVENT, onPreferencesChanged);
    return () => window.removeEventListener(PREFERENCES_CHANGED_EVENT, onPreferencesChanged);
  }, []);

  useEffect(() => {
    const breakTimer = window.setInterval(() => {
      notify(`You have studied for another ${pacing.breakEvery} minutes — consider a short break`);
    }, pacing.breakEvery * 60_000);
    const sessionTimer = window.setTimeout(() => {
      notify(`You reached your preferred ${pacing.sessionLength}-minute session length`);
    }, pacing.sessionLength * 60_000);
    return () => {
      window.clearInterval(breakTimer);
      window.clearTimeout(sessionTimer);
    };
  }, [notify, pacing.breakEvery, pacing.sessionLength]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        await ensureChalkboardSession({
          id: sessionId,
          title: initialBoard.title,
          domain: initialBoard.domain,
          boundNodes: resolvedBoundNodes,
        });
        const persisted = await getSessionThreads(sessionId);
        if (!cancelled) {
          setThreadLog((current) => mergeThreadLogs(current, persisted));
        }
      } catch {
        if (!cancelled) notify("Thread history could not be loaded");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId, initialBoard.title, initialBoard.domain, resolvedBoundNodes, notify]);

  /* The in-flight tutor call is aborted when the room unmounts. */
  const abortRef = useRef<AbortController | null>(null);
  const activityTurnRef = useRef(0);
  useEffect(() => () => abortRef.current?.abort(), []);
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [viewMap, setViewMap] = useState<Record<string, BoardView>>(initialSession?.viewMap ?? {});
  const [strokeMap, setStrokeMap] = useState<Record<string, Stroke[]>>(initialSession?.strokeMap ?? {});
  const [contextMenu, setContextMenu] = useState<ContextMenuTarget | null>(null);

  const msgId = useRef(
    (initialSession?.messages ?? []).reduce((highest, message) => Math.max(highest, message.id), 0)
  );
  const speechTurnRef = useRef(0);
  const board = boards.find((b) => b.id === activeId) ?? boards[0];
  const fontCss = FONTS.find((f) => f.id === fontId)?.css ?? FONTS[0].css;

  const speakTutorText = useCallback((text: string, announce = false) => {
    if (!("speechSynthesis" in window) || typeof SpeechSynthesisUtterance === "undefined") {
      if (announce) notify("Speech playback is not supported on this device");
      return false;
    }

    const speechTurn = ++speechTurnRef.current;
    window.speechSynthesis.cancel();
    setSpeechCaption(loadPreferences().appearance.captions ? text : null);
    const utterance = new SpeechSynthesisUtterance(text);
    const clearCaption = () => {
      if (speechTurnRef.current === speechTurn) setSpeechCaption(null);
    };
    utterance.onend = clearCaption;
    utterance.onerror = clearCaption;
    window.speechSynthesis.speak(utterance);
    if (announce) notify("Reading the latest tutor reply aloud");
    return true;
  }, [notify]);

  useEffect(() => () => {
    speechTurnRef.current += 1;
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
  }, []);

  const sessionSnapshot = useMemo<StoredStudySession>(() => ({
    id: sessionId,
    title: board.title,
    domain: board.domain,
    boundNodes: resolvedBoundNodes,
    boards,
    activeId,
    messages,
    viewMap,
    strokeMap,
    appearance: {
      themeId: theme.id,
      fontId,
      fontScale,
      latex,
    },
    updatedAt: new Date().toISOString(),
  }), [sessionId, board.title, board.domain, resolvedBoundNodes, boards, activeId, messages, viewMap, strokeMap, theme.id, fontId, fontScale, latex]);
  const latestSessionSnapshot = useRef(sessionSnapshot);
  latestSessionSnapshot.current = sessionSnapshot;

  useEffect(() => {
    const timer = window.setTimeout(() => saveStudySession(sessionSnapshot), 500);
    return () => window.clearTimeout(timer);
  }, [sessionSnapshot]);

  // A learner can leave within the debounce window. Flush the latest complete
  // board/chat state on unmount so Past Notes is always the exact final frame.
  useEffect(() => () => saveStudySession(latestSessionSnapshot.current), []);

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

  const logThread = useCallback(async (thread: BoardDoc): Promise<SessionThreadLog> => {
    if (!thread.parentId || !thread.thread) {
      throw new Error("Only branched boards can be recorded as threads");
    }
    // The session initialization effect normally completes first, but ensuring
    // the parent row here keeps the audit write safe even after an immediate
    // learner action on a newly opened room.
    await ensureChalkboardSession({
      id: sessionId,
      title: initialBoard.title,
      domain: initialBoard.domain,
      boundNodes: resolvedBoundNodes,
    });
    const entry = await recordSessionThread({
      sessionId,
      boardId: thread.id,
      parentBoardId: thread.parentId,
      title: thread.title,
      reason: thread.thread.reason,
      createdBy: thread.thread.createdBy,
      createdAt: thread.thread.createdAt,
    });
    setThreadLog((current) => mergeThreadLogs(current, [entry]));
    return entry;
  }, [sessionId, initialBoard.title, initialBoard.domain, resolvedBoundNodes]);

  /* branch from highlighted text */
  const handleAsk = useCallback(
    async (selection: string, question: string) => {
      await captureActive();
      const sub = buildSubBoard(selection, question, board);
      try {
        await logThread(sub);
      } catch {
        // Preserve learner-created branching even if durable storage is
        // temporarily unavailable. Agent-created threads remain stricter: they
        // are not created unless their audit row succeeds.
        notify("Branch opened, but its audit log could not be saved");
      }
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
    [board, captureActive, logThread, notify, pushTutor]
  );

  /* chat replies — routed through the tutor harness, which resolves the bound
     tutor role, validates structured output, and persists both messages */
  const handleSend = useCallback(
    async (text: string, imageData?: string) => {
      const activityTurn = ++activityTurnRef.current;
      const targetBoardId = board.id;
      setMessages((m) => [...m, { id: ++msgId.current, role: "user", text, imageData }]);
      setAgentStatus("thinking");
      setAgentActivity({
        kind: "planning",
        label: "Planning a response",
        detail: "Reading your request and the current board context",
      });
      setTyping(true);

      // Overlap only the likely heavy adapter with model latency. Generic
      // diagrams, function graphs, and 3D scenes use other renderers and should
      // not pay the ECharts/Cytoscape parse cost speculatively.
      const prewarmTargets = getVisualizationPrewarmTargets(text);
      if (prewarmTargets.length > 0) prewarmVisualizationAdapters(prewarmTargets);

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
        setTyping(false);
        setMessages((m) => [...m, { id: ++msgId.current, role: "tutor", text: turn.speech }]);
        if (loadPreferences().tutor.voiceReplies) speakTutorText(turn.speech);

        // Validated board operations are applied serially. The chat activity
        // widget describes the concrete operation that is actually executing;
        // it never guesses at hidden model work.
        if (turn.boardOps.length > 0) {
          setAgentStatus("writing");
          for (let index = 0; index < turn.boardOps.length; index += 1) {
            const op = turn.boardOps[index];
            setAgentActivity(activityForBoardOp(op, index, turn.boardOps.length));
            await new Promise((resolve) => window.setTimeout(resolve, 360));

            if (op.op === "spawn_thread") {
              const thread = buildAgentThread(board, op);
              try {
                // Record first: an agent branch is only added to the session
                // after its durable audit row exists.
                await logThread(thread);
                setBoards((current) => current.some((item) => item.id === thread.id) ? current : [...current, thread]);
                notify(`Tutor created thread: ${thread.title}`);
              } catch {
                notify("The agent thread could not be logged, so it was not created");
              }
              continue;
            }

            setBoards((current) =>
              current.map((item) => item.id === targetBoardId ? applyBoardOp(item, op, item.domain) : item)
            );
          }
        }

        setAgentStatus("idle");
        setAgentActivity({
          kind: "complete",
          label: "Response ready",
          detail: turn.boardOps.length > 0 ? "Finished the requested board updates" : "Finished composing the explanation",
        });
        window.setTimeout(() => {
          if (activityTurnRef.current === activityTurn) setAgentActivity(null);
        }, 1100);
      } catch (e: any) {
        setAgentStatus("error");
        setAgentActivity({
          kind: "error",
          label: "Could not finish",
          detail: "The tutor stopped safely without applying unvalidated output",
        });
        if (e?.failureClass === "schema_invalid") {
          // askTutorTurn has its own deterministic schema recovery. Keep this
          // UI boundary as defense in depth so a future schema change can never
          // leak an internal version/attempt error into the learner's chat.
          const retryMessage = "Let's try that once more—please resend the request in one short sentence, and I'll answer it cleanly.";
          notify("Tutor is ready to retry");
          setMessages((m) => [
            ...m,
            { id: ++msgId.current, role: "tutor", text: retryMessage },
          ]);
        } else {
          const message = e?.message ?? "Tutor unavailable";
          notify(`Tutor: ${message}`);
          setMessages((m) => [
            ...m,
            { id: ++msgId.current, role: "system", text: `tutor error: ${message}` },
          ]);
        }
        setAgentStatus("idle");
        window.setTimeout(() => {
          if (activityTurnRef.current === activityTurn) setAgentActivity(null);
        }, 1800);
      } finally {
        setTyping(false);
        if (abortRef.current === controller) abortRef.current = null;
      }
    },
    [attachments, board, logThread, notify, onboarding, sessionId, resolvedBoundNodes, speakTutorText]
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
          writing={agentStatus === "writing" || !written.has(board.id)}
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

      {speechCaption && (
        <div
          data-tutor-caption
          role="status"
          aria-live="polite"
          className="anim-toast absolute bottom-5 left-1/2 z-50 max-h-28 w-[min(680px,calc(100%_-_32px))] -translate-x-1/2 overflow-y-auto rounded-lg border border-white/15 bg-black/85 px-4 py-2.5 text-center text-[14px] leading-relaxed text-white shadow-2xl backdrop-blur-md"
        >
          <span className="mr-2 font-mono text-[10px] uppercase tracking-[0.12em] text-white/55">Tutor</span>
          {speechCaption}
        </div>
      )}

      {panel === "threads" && (
        <ThreadsPanel
          boards={boards}
          previews={previews}
          threadLog={threadLog}
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
          activity={agentActivity}
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
            if (last) speakTutorText(last.text, true);
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

function mergeThreadLogs(...groups: SessionThreadLog[][]): SessionThreadLog[] {
  const byBoard = new Map<string, SessionThreadLog>();
  for (const group of groups) {
    for (const entry of group) byBoard.set(entry.boardId, entry);
  }
  return [...byBoard.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

function buildAgentThread(parent: BoardDoc, op: Extract<BoardOp, { op: "spawn_thread" }>): BoardDoc {
  const createdAt = new Date().toISOString();
  const blocks = op.initialBlocks
    .map((spec) => blockSpecToBlock(spec as unknown as Record<string, unknown>, parent.domain))
    .filter((block): block is NonNullable<typeof block> => block !== null);
  return {
    id: `board-agent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    title: op.title,
    subtitle: `AI thread · ${parent.title}`,
    domain: parent.domain,
    blocks,
    parentId: parent.id,
    thread: {
      createdBy: "agent",
      reason: op.reason,
      createdAt,
    },
  };
}

function activityForBoardOp(op: BoardOp, index: number, total: number): AgentActivity {
  const progress = { current: index + 1, total };
  switch (op.op) {
    case "visualize":
      return {
        kind: "visualizing",
        label: op.intent.type === "function" || op.intent.type === "chart" ? "Drawing a graph" : "Building a visualization",
        detail: `Rendering a validated ${op.intent.type} visualization`,
        progress,
      };
    case "update_visualization":
      return {
        kind: "visualizing",
        label: "Updating the visualization",
        detail: "Applying validated visual data and interaction changes",
        progress,
      };
    case "revise_text":
      return {
        kind: "revising",
        label: "Editing board text",
        detail: "Revising the requested passage in place",
        progress,
      };
    case "replace_block":
      return {
        kind: "revising",
        label: "Replacing a board section",
        detail: "Swapping in the validated revision",
        progress,
      };
    case "delete_block":
      return {
        kind: "revising",
        label: "Removing a board section",
        detail: "Deleting the targeted block",
        progress,
      };
    case "insert_after":
      return {
        kind: "writing",
        label: "Inserting new material",
        detail: "Placing a new block beside the relevant explanation",
        progress,
      };
    case "spawn_thread":
      return {
        kind: "spawning",
        label: "Creating a study thread",
        detail: `Logging “${op.title}” in Threads`,
        progress,
      };
    case "write_latex":
      return {
        kind: "writing",
        label: "Typesetting an equation",
        detail: "Writing validated mathematical notation on the board",
        progress,
      };
    case "write_title":
      return { kind: "writing", label: "Writing a section title", detail: "Organizing the board explanation", progress };
    case "write_bullets":
      return { kind: "writing", label: "Writing key points", detail: "Adding a concise explanation to the board", progress };
    case "write_callout":
      return { kind: "writing", label: "Adding a key takeaway", detail: "Highlighting an important idea", progress };
    case "write_text":
      return { kind: "writing", label: "Writing on the board", detail: "Adding the next part of the explanation", progress };
  }
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
