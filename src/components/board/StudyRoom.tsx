import { createElement, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Chalkboard, THEMES, FONTS, type BoardTheme, type BoardView, type Stroke } from "./Chalkboard";
import { getVisualizationPrewarmTargets, prewarmVisualizationAdapters } from "./VisualizationSurface";
import { BoardToolbar, type PanelId, type PenTool } from "./BoardToolbar";
import {
  ThreadsPanel,
  SettingsPanel,
  ChatDock,
  type AgentActivity,
  type ChatAttachment,
  type BoardSnapshot,
  type ChatMsg,
} from "./BoardPanels";
import { buildSubBoard, boardToMarkdown, DOMAIN_META, type BoardDoc } from "../../data/boards";
import { validateVisualizationIntent } from "../../lib/visualization/validate";
import type { VisualizationIntent, VisualizationState } from "../../lib/visualization/types";
import { sanitizeWidgetState, validateWidgetIntent } from "../../lib/widgets/validate";
import {
  buildClusterSignalDisplayText,
  buildClusterSignalMessage,
  buildWidgetSignal,
  shouldSignalTutor,
} from "../../lib/widgets/signal";
import { clusterAllowsSignal, type ClusterMember } from "../../lib/widgets/cluster";
import { getSessionHintLevel, getSessionMasteryStage } from "../../lib/tutor";
import { recordWidgetEvidence } from "../../lib/learning/bridge";
import {
  DEFAULT_LEARNER_ID,
  bindBlockToActivity,
  getActivityForBlock,
  getLatestSessionActivity,
  recordPrerequisiteCovered,
} from "../../lib/learning/store";
import {
  clampPageSize,
  collectBoardStrokes,
  migrateStrokeMapForPaginationToggle,
  resolveLiveBoardStrokes,
} from "../../lib/boardPagination";
import { WIDGET_LABEL, type WidgetIntent, type WidgetState } from "../../lib/widgets/types";
import {
  askTutorTurn,
  ensureChalkboardSession,
  resolveTurnSkillId,
  getSessionThreads,
  recordSessionThread,
  replaceSessionTranscript,
  type BoardOp,
  type SessionThreadLog,
} from "../../lib/tutor";
import type { EffortParameter } from "../../lib/effort";
import { ContextMenu, ContextMenuTarget } from "../ContextMenu";
import { toPng } from "html-to-image";
import { hydrateStudyBoards, saveStudySession, type StoredStudySession } from "../../state/studySessionStore";
import type { OnboardingAnswers } from "../../data/tutor";
import type { TurnContract } from "../../lib/contracts/types";
import { getActiveContract } from "../../lib/contracts/store";
import { ErrorBoundary } from "../ErrorBoundary";
import {
  PREFERENCES_CHANGED_EVENT,
  loadPreferences,
  savePreferences,
  type StudyusPreferences,
} from "../../lib/preferences";

/** What produced this turn. Distinguishes the opening greeting (retryable when
 *  an unmount kills it) and a widget answer (retryable, and shown in the
 *  transcript as the learner's action) from a typed chat message. The
 *  plan_start turn is the FIRST submitted plan widget — the route-bearing
 *  turn after the greeting — and is what makes the deterministic router
 *  actually run for the new skill. */
export type TurnKind = "chat" | "greeting" | "widget" | "plan_start";

interface Props {
  initialBoard: BoardDoc;
  initialSession?: StoredStudySession;
  /** Stable session id minted in SessionCard for fresh sessions, so the
   *  contract's revision lineage and the persisted board session share one
   *  id. When omitted, StudyRoom falls back to `initialSession?.id` or mints
   *  its own (the historical path). */
  sessionId?: string;
  /** Curriculum node ids the tutor may ground its replies on. Restored from
   *  the stored session when reopening; empty means no curriculum is bound. */
  boundNodes?: string[];
  /** Onboarding answers from the AI-generated intake interview. Threaded into
   *  every tutor turn as a consistent system reminder. Undefined for a restored
   *  session — that interview already ran. */
  onboarding?: OnboardingAnswers;
  /** Learner-approved contract from the onboarding review sheet (fresh
   *  sessions only). Restored sessions load theirs from the contracts store
   *  via `getActiveContract` on mount. */
  turnContract?: TurnContract;
  /** The Effort Parameter chosen on the SessionCard. Threaded into the
   *  greeting turn so the chalkboard's plan widget is sized to match.
   *  Undefined for a restored session — the tutor harness defaults to "auto"
   *  in that case. */
  effort?: EffortParameter;
  /** Learner identity for the contracts store and evidence ledger. Defaults
   *  to `DEFAULT_LEARNER_ID` to match the rest of the app. */
  learnerId?: string;
  onLeave: () => void;
  notify: (t: string) => void;
}

export function StudyRoom({
  initialBoard,
  initialSession,
  sessionId: sessionIdProp,
  boundNodes,
  onboarding,
  turnContract,
  effort,
  learnerId,
  onLeave,
  notify,
}: Props) {
  // Hydrate on first paint so a restored Past Note never mounts a widget whose
  // state/intent still carries a one-throw-away payload from an older save.
  const [boards, setBoards] = useState<BoardDoc[]>(() => {
    const source = initialSession?.boards ?? [initialBoard];
    const hydrated = hydrateStudyBoards(source);
    return hydrated.length > 0 ? hydrated : [initialBoard];
  });
  /** Latest boards, readable from callbacks that must not re-bind whenever the
   *  board changes (every board op would otherwise rebuild them). */
  const boardsRef = useRef(boards);
  boardsRef.current = boards;
  const [activeId, setActiveId] = useState(initialSession?.activeId ?? initialBoard.id);
  const activeIdRef = useRef(activeId);
  activeIdRef.current = activeId;
  // A behaviour preference rather than a per-session appearance choice, so it
  // persists globally and stays consistent across every board the learner opens.
  const [boardRevertsWithMessage, setBoardRevertsWithMessageState] = useState(
    () => loadPreferences().appearance.boardRevertsWithMessage
  );
  const setBoardRevertsWithMessage = useCallback((next: boolean) => {
    setBoardRevertsWithMessageState(next);
    const current = loadPreferences();
    savePreferences({ ...current, appearance: { ...current.appearance, boardRevertsWithMessage: next } });
  }, []);
  // Pagination is board-render behaviour, so it lives beside
  // boardRevertsWithMessage in appearance rather than in the per-session
  // appearance blob: the learner's page density is a habit, not a property
  // of one lesson.
  const [boardPagination, setBoardPaginationState] = useState(
    () => loadPreferences().appearance.boardPagination
  );
  const [boardPageSize, setBoardPageSizeState] = useState(
    () => loadPreferences().appearance.boardPageSize
  );
  const setBoardPagination = useCallback((next: boolean) => {
    setBoardPaginationState((wasOn) => {
      if (wasOn !== next) {
        // Migrate bare ↔ #p0 so enabling/disabling pagination cannot orphan the
        // ink that is currently on screen. Later pages stay under #pN keys.
        setStrokeMap((current) => {
          const fromBoards = boardsRef.current.map((b) => b.id);
          const fromKeys = Object.keys(current)
            .map((key) => key.replace(/#p\d+$/, ""))
            .filter((id, index, all) => all.indexOf(id) === index);
          const ids = fromBoards.length > 0 ? fromBoards : fromKeys;
          return migrateStrokeMapForPaginationToggle(current, ids, next) as Record<string, Stroke[]>;
        });
      }
      return next;
    });
    const current = loadPreferences();
    savePreferences({ ...current, appearance: { ...current.appearance, boardPagination: next } });
  }, []);
  const setBoardPageSize = useCallback((next: number) => {
    const size = clampPageSize(next);
    setBoardPageSizeState(size);
    const current = loadPreferences();
    savePreferences({ ...current, appearance: { ...current.appearance, boardPageSize: size } });
  }, []);
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
  const [rewinding, setRewinding] = useState(false);
  const [speechCaption, setSpeechCaption] = useState<string | null>(null);

  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  // Attachment payloads live only for the current turn. Saved sessions retain
  // chat/board metadata, never raw learner file contents or image data URLs.
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [agentStatus, setAgentStatus] = useState<"idle" | "thinking" | "writing" | "error">("idle");
  const [agentActivity, setAgentActivity] = useState<AgentActivity | null>(null);
  const [threadLog, setThreadLog] = useState<SessionThreadLog[]>([]);
  const [pendingThreadExplanation, setPendingThreadExplanation] = useState<{
    boardId: string;
    selection: string;
    question: string;
  } | null>(null);
  const [pacing, setPacing] = useState(() => {
    const tutor = loadPreferences().tutor;
    return { sessionLength: tutor.sessionLength, breakEvery: tutor.breakEvery };
  });
  const [penTool, setPenTool] = useState<PenTool>("pen");
  const [penColor, setPenColor] = useState("#fbbf24");
  const clearInkRef = useRef<() => void>(() => {});
  const boardRootRef = useRef<HTMLDivElement | null>(null);

  /* One persisted chalkboard session per room entry; the tutor harness writes
     both sides of the conversation into session_messages under this id. The
     SessionCard-minted id is preferred so the contract's session lineage
     matches the board session row. */
  const [sessionId] = useState(
    () => sessionIdProp ?? initialSession?.id ?? `session-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
  );
  const resolvedBoundNodes = useMemo(
    () => boundNodes ?? initialSession?.boundNodes ?? [],
    [boundNodes, initialSession?.boundNodes]
  );
  const resolvedLearnerId = learnerId ?? DEFAULT_LEARNER_ID;
  // A restored session loads its active contract from the durable store on
  // mount (fresh sessions receive theirs via the `turnContract` prop). Loaded
  // lazily so a restored Past Note with no contract simply tutors without one.
  const [loadedContract, setLoadedContract] = useState<TurnContract | null>(null);
  useEffect(() => {
    if (!initialSession || turnContract) return;
    let cancelled = false;
    void (async () => {
      try {
        const active = await getActiveContract(resolvedLearnerId, initialSession.id);
        if (!cancelled && active) setLoadedContract(active);
      } catch (error) {
        console.warn("[studyroom] could not load learner contract for restored session", error);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSession?.id, turnContract]);
  const activeContract = turnContract ?? loadedContract ?? undefined;

  useEffect(() => {
    const onPreferencesChanged = (event: Event) => {
      const next = (event as CustomEvent<StudyusPreferences>).detail;
      if (next?.tutor) {
        setPacing({ sessionLength: next.tutor.sessionLength, breakEvery: next.tutor.breakEvery });
      }
      // Keep the board-settings toggle honest if the preference is changed
      // from the main Settings modal while a board is open.
      if (next?.appearance) {
        setBoardRevertsWithMessageState(next.appearance.boardRevertsWithMessage);
        setBoardPaginationState(next.appearance.boardPagination);
        setBoardPageSizeState(next.appearance.boardPageSize);
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
  const greetedRef = useRef(false);
  /** Widgets that have already woken the tutor, so a re-render or a double
   *  click on Check cannot ask the same question twice. */
  const signalledWidgets = useRef(new Set<string>());
  /** `saveWidgetState` is declared before `handleSend`; the ref breaks that
   *  cycle without reordering the component. */
  const handleSendRef = useRef<
    ((
      text: string,
      imageData?: string,
      showUserMessage?: boolean,
      options?: { kind?: TurnKind; displayText?: string; signalKey?: string; bindingPlan?: { heading: string; steps: { id: string; label: string; details?: string[] }[] } }
    ) => Promise<void>) | null
  >(null);
  /** Bumped when an opening greeting is cancelled by an unmount, so the
   *  surviving mount retries it. Bounded: a greeting is worth one retry, not an
   *  infinite loop against a dead endpoint. */
  const [greetAttempt, setGreetAttempt] = useState(0);
  const rewindRef = useRef(false);
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
    messages: pruneSnapshotsForStorage(messages),
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
    const captureOpts = {
      cacheBust: true,
      pixelRatio: 0.45,
      skipFonts: true,
      backgroundColor: theme.swatch,
    } as const;

    // Pagination slices the live chalkboard to the active page. Thread
    // thumbnails and whole-board exports must see every block, so when pages
    // are on we render a temporary non-paginated read-only board offscreen
    // and capture that instead of the viewport root.
    if (boardPagination) {
      const host = document.createElement("div");
      host.setAttribute("aria-hidden", "true");
      host.style.cssText =
        "position:fixed;left:-10000px;top:0;width:960px;height:1400px;opacity:0;pointer-events:none;overflow:hidden;";
      document.body.appendChild(host);
      const root = createRoot(host);
      try {
        const fullStrokes = collectBoardStrokes(strokeMap, activeId);
        await new Promise<void>((resolve) => {
          root.render(
            createElement(
              "div",
              { style: { width: "100%", height: "100%" } },
              createElement(Chalkboard, {
                board,
                theme,
                fontCss,
                fontScale,
                writing: false,
                latex,
                onAsk: () => {},
                annotating: false,
                penColor,
                penTool: "pen",
                strokesKey: `capture-${activeId}`,
                initialView: viewMap[activeId] ?? { x: 48, y: 36, s: 1 },
                initialStrokes: fullStrokes,
                paginate: false,
                readOnly: true,
              })
            )
          );
          // Let layout settle before html-to-image walks the tree.
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        });
        const image = await toPng(host.firstElementChild as HTMLElement, captureOpts);
        setPreviews((current) => ({ ...current, [activeId]: image }));
      } catch {
        // Threads has a content-based fallback if a browser blocks DOM capture.
      } finally {
        root.unmount();
        host.remove();
      }
      return;
    }

    const node = boardRootRef.current;
    if (!node) return;
    try {
      const image = await toPng(node, captureOpts);
      setPreviews((current) => ({ ...current, [activeId]: image }));
    } catch {
      // Threads has a content-based fallback if a browser blocks DOM capture.
    }
  }, [
    activeId,
    board,
    boardPagination,
    fontCss,
    fontScale,
    latex,
    penColor,
    strokeMap,
    theme,
    viewMap,
  ]);

  const saveView = useCallback((view: BoardView) => {
    setViewMap((current) => ({ ...current, [activeId]: view }));
  }, [activeId]);

  const [boardPage, setBoardPage] = useState(0);
  const handleBoardPageChange = useCallback((page: number) => setBoardPage(page), []);
  // Chalkboard resets to page 0 on a board switch and reports it, but that
  // report lands a commit later; resetting here keeps the ink key from
  // pointing at the previous board's page for one frame.
  useEffect(() => setBoardPage(0), [activeId]);

  /* Annotation ink is captured in viewport coordinates (Chalkboard's
     annDown uses clientX/clientY minus the canvas rect), so it is pinned to
     the screen, not to the content beneath it. With pages, ink drawn over
     page 1 would float over unrelated prose on page 2 — so ink belongs to
     (board, page). With pagination off the key is the bare board id exactly
     as before, which is why every saved session keeps its strokes. Changing
     the page size re-partitions which blocks a page holds, so ink
     re-associates rather than being destroyed. Read paths fall back across
     bare ↔ #p0 so toggling pagination never blanks on-screen ink. */
  const inkKey = boardPagination ? `${activeId}#p${boardPage}` : activeId;
  const liveStrokes = resolveLiveBoardStrokes(strokeMap, activeId, {
    paginate: boardPagination,
    page: boardPage,
  });

  const saveStrokes = useCallback((strokes: Stroke[]) => {
    setStrokeMap((current) => {
      const next: Record<string, Stroke[]> = { ...current, [inkKey]: strokes };
      // When writing page-0 ink under pagination, clear a stale bare-id copy so
      // the next disable→enable cycle does not resurrect an older stroke set.
      // When writing the bare id with pagination off, leave #pN alone so re-enabling
      // can still surface later pages in Past Notes / page navigation.
      if (boardPagination && boardPage === 0 && inkKey !== activeId) {
        delete next[activeId];
      }
      return next;
    });
  }, [inkKey, boardPagination, boardPage, activeId]);

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

  // Learner interaction with a study widget (answers, slider position, opened
  // hint levels) is persisted onto the owning block. It survives a reopen and
  // is summarized back into the tutor prompt, so the agent teaches against what
  // the learner actually did rather than guessing.
  //
  // Committing an ANSWER additionally wakes the tutor. Under the Guide to
  // Mastery the agent owns the response to a learner's work: a wrong choice is
  // a misconception to diagnose, a right one is evidence to test rather than
  // celebrate. A widget the learner answers into silence would make the board a
  // worksheet instead of a lesson.
  const saveWidgetState = useCallback(
    (blockId: string, state: WidgetState) => {
      // Called straight from a widget's event handler. React error boundaries
      // do not catch throws from handlers, so anything escaping here reaches
      // window.onerror with the board already half-updated. Every failure below
      // is contained: losing one interaction is recoverable, losing the session
      // is not.
      try {
        const safe = sanitizeWidgetState(state);
        if (!safe) return;

        const target = boardsRef.current
          .find((b) => b.id === activeId)
          ?.blocks.find((blk) => blk.id === blockId);
        const widget = target?.kind === "widget" ? target : null;

        setBoards((current) =>
          current.map((b) =>
            b.id === activeId
              ? {
                  ...b,
                  blocks: b.blocks.map((blk) =>
                    blk.id === blockId && blk.kind === "widget" ? { ...blk, state: safe } : blk
                  ),
                }
              : b
          )
        );

        if (!widget) return;

        // Record the answer in the evidence ledger BEFORE deciding whether to
        // wake the tutor, and independently of that decision. The two are
        // different questions: the tutor is woken once per cluster and never by
        // a widget already answered, whereas every graded answer is a fact the
        // ledger must hold. Tying evidence to the signal would mean the second,
        // third and fourth answers in a cluster — the ones that establish
        // breadth across task families — are the ones that never get counted.
        //
        // Deterministically graded widget answers are also the only evidence in
        // the system carrying `correct` with full evaluator confidence; a
        // conversational turn can only ever report `unknown` or `incorrect`. If
        // this call is missing, no stage gate above Encounter can be satisfied.
        void (async () => {
          try {
            // The contract the tutor placed this activity under names the task
            // family, context variant and target skills. Without it the answer
            // is filed against a widget-kind-derived family, which makes five
            // different problems on one skill look like five answers to the
            // same one and hollows out every breadth requirement downstream.
            //
            // Resolve it by BLOCK, not by recency. A learner may answer a
            // widget several turns after it was placed, by which point the
            // newest contract describes a different move on a possibly
            // different skill; filing the answer there would record real work
            // as evidence of something never asked. Only blocks placed before
            // binding existed fall back to the latest contract.
            const contract =
              (await getActivityForBlock(sessionId, blockId)) ??
              (await getLatestSessionActivity(sessionId));
            await recordWidgetEvidence(widget.intent, safe, {
              learnerId: DEFAULT_LEARNER_ID,
              sessionId,
              contract,
              taskId: `${activeId}:${blockId}`,
              fallbackSkillIds: [
                resolveTurnSkillId({
                  persistence: { boundNodes: resolvedBoundNodes },
                  board: { sessionTitle: initialBoard.title },
                }),
              ],
              // What the learner actually opened is read from widget state
              // inside the bridge; this is the ceiling that was in force.
              supportCeiling: Math.max(0, Math.min(3, await getSessionHintLevel(sessionId))) as 0 | 1 | 2 | 3,
            });
          } catch (error) {
            // A ledger write must never cost the learner their answer, which is
            // already saved above.
            console.error("[widget] failed to record evidence", error);
          }
        })();

        // Only a committed answer wakes the tutor; exploration must not. Decided
        // synchronously so a double click cannot slip two turns through the
        // await below.
        if (!shouldSignalTutor(widget.intent, widget.state, safe)) return;

        // Cluster gate. When the agent grouped this widget with others, the
        // tutor is owed ONE turn covering the whole set, not a turn per answer.
        // Built from the board as it will be after this save, since setBoards
        // above has not flushed yet.
        const members: ClusterMember[] = (boardsRef.current.find((b) => b.id === activeId)?.blocks ?? [])
          .flatMap((blk) =>
            blk.kind === "widget"
              ? [{ blockId: blk.id, intent: blk.intent, state: blk.id === blockId ? safe : blk.state }]
              : []
          );
        const { allowed, cluster } = clusterAllowsSignal(members, blockId);
        if (!allowed) return;

        // A completed cluster is claimed under its group id so that whichever
        // member finished it, the tutor is woken exactly once.
        const signalKey = cluster ? `group:${cluster.groupId}` : blockId;
        if (signalledWidgets.current.has(signalKey)) return;
        signalledWidgets.current.add(signalKey);

        const previousState = widget.state;
        void (async () => {
          try {
            const { stage } = await getSessionMasteryStage(sessionId);

            if (cluster) {
              // Answers are read in board order — the order the learner met
              // them in — so the agent sees the set as it was worked.
              const answered = cluster.answerable.map((member) => ({
                intent: member.intent,
                state: member.blockId === blockId ? safe : (member.state ?? {}),
              }));
              void handleSendRef.current?.(
                buildClusterSignalMessage(answered, stage, cluster.label),
                undefined,
                false,
                {
                  kind: "widget",
                  displayText: buildClusterSignalDisplayText(answered, cluster.label),
                  signalKey,
                }
              );
              return;
            }

            const signal = buildWidgetSignal(blockId, widget.intent, previousState, safe, stage);
            if (!signal) {
              signalledWidgets.current.delete(signalKey);
              return;
            }
            // Routed through the normal turn path so the full tutor contract
            // applies, but shown as the learner's own board action rather than a
            // chat message they did not type.
            void handleSendRef.current?.(signal.message, undefined, false, {
              kind: widget.intent.kind === "plan" ? "plan_start" : "widget",
              displayText: signal.displayText,
              signalKey: blockId,
              bindingPlan: signal.bindingPlan,
            });
          } catch (error) {
            // Release the dedupe claim, or this widget could never wake the tutor
            // again for the rest of the session — a silent dead end far worse
            // than one failed turn. The answer itself is already saved above.
            // Must be the same key that was claimed: releasing `blockId` when a
            // cluster claimed `group:…` would strand the whole cluster.
            signalledWidgets.current.delete(signalKey);
            console.error("[widget] failed to signal the tutor", error);
            notify("Your answer was saved, but the tutor could not be reached");
          }
        })();
      } catch (error) {
        console.error("[widget] failed to record interaction", error);
      }
    },
    [activeId, sessionId, resolvedBoundNodes, initialBoard.title]
  );

  /**
   * Board state as it stands right now, frozen for a revert point.
   *
   * Deep-cloned deliberately: blocks are mutated by later board ops and widget
   * answers, and a shallow copy would let those edits reach back and rewrite
   * history, so reverting would restore the present.
   */
  const captureBoardSnapshot = useCallback((): BoardSnapshot => ({
    boards: structuredClone(boardsRef.current),
    activeId: activeIdRef.current,
  }), []);

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
      // Taken before the branch board is added, so reverting this message
      // removes the branch it created rather than stranding an empty thread.
      const boardSnapshot = captureBoardSnapshot();
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
      
      const userMessage = question ? `${question}  ("${trim(selection)}")` : `Explain: "${trim(selection)}"`;
      setMessages((m) => [
        ...m,
        {
          id: ++msgId.current,
          role: "user",
          text: userMessage,
          boardSnapshot,
        },
      ]);
      pushTutor(`New board opened for "${trim(selection)}". I'm writing the breakdown now — it's saved in Threads so you can come back to it.`, 800);
      notify("Branched into a new board");
      // React applies activeId after this handler returns. Queue the explanation
      // so the effect below starts it only after the thread is the active board.
      setPendingThreadExplanation({ boardId: sub.id, selection, question });
    },
    [board, captureActive, captureBoardSnapshot, logThread, notify, pushTutor]
  );

  const handleRevertMessage = useCallback((messageId: number) => {
    if (rewindRef.current) return;
    const index = messages.findIndex((message) => message.id === messageId && message.role === "user");
    if (index < 0) return;

    const target = messages[index];
    const previousBoards = boardsRef.current;
    const previousActiveId = activeIdRef.current;
    // Roll the chalkboard back with the conversation, unless the learner has
    // chosen to keep the board as an accumulating notebook. Sessions saved
    // before snapshots existed have none, and revert the transcript alone
    // rather than failing or wiping the board.
    const revertBoard =
      loadPreferences().appearance.boardRevertsWithMessage && target.boardSnapshot !== undefined;

    // A rewind supersedes any active turn. Incrementing the turn token ensures
    // its cancellation cannot append an error or clear newer activity state.
    activityTurnRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    setTyping(false);
    setAgentStatus("idle");
    setAgentActivity(null);
    setAttachments([]);
    speechTurnRef.current += 1;
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    setSpeechCaption(null);

    const retained = messages.slice(0, index);
    rewindRef.current = true;
    setRewinding(true);
    // Reflect the rewind immediately, while locking submission until the
    // durable transcript has reached the same state.
    setMessages(retained);
    if (revertBoard && target.boardSnapshot) {
      // Clone on restore too: this snapshot stays attached to the message and
      // must survive being reverted to more than once.
      setBoards(structuredClone(target.boardSnapshot.boards));
      const restoredActive = target.boardSnapshot.activeId;
      setActiveId(
        target.boardSnapshot.boards.some((item) => item.id === restoredActive)
          ? restoredActive
          : target.boardSnapshot.boards[0]?.id ?? previousActiveId
      );
      // Widget answers on restored blocks may legitimately be re-submitted.
      signalledWidgets.current.clear();
    }
    void replaceSessionTranscript(
      sessionId,
      retained.map((message) => ({
        role: message.role === "tutor" ? "assistant" as const : message.role,
        content: message.text,
      }))
    ).then(() => {
      notify(
        revertBoard
          ? "Conversation and board returned to this message — edit it and submit again"
          : "Conversation returned to this message — the board was left as it is"
      );
    }).catch(() => {
      // The durable transcript is the source of truth. If it could not be
      // rewound, put the board back too rather than leaving chat and board
      // describing different lessons.
      setMessages(messages);
      if (revertBoard) {
        setBoards(previousBoards);
        setActiveId(previousActiveId);
      }
      notify("The conversation could not be reverted");
    }).finally(() => {
      rewindRef.current = false;
      setRewinding(false);
    });
  }, [messages, notify, sessionId]);

  /* chat replies — routed through the tutor harness, which resolves the bound
     tutor role, validates structured output, and persists both messages */
  const handleSend = useCallback(
    async (
      text: string,
      imageData?: string,
      showUserMessage = true,
      options?: { kind?: TurnKind; displayText?: string; signalKey?: string; bindingPlan?: { heading: string; steps: { id: string; label: string; details?: string[] }[] } }
    ) => {
      if (rewindRef.current) return;
      const turnKind = options?.kind ?? "chat";
      const activityTurn = ++activityTurnRef.current;
      const targetBoardId = board.id;
      // Freeze the board BEFORE this turn touches it, so reverting to this
      // message undoes everything the tutor drew in response to it.
      const boardSnapshot = captureBoardSnapshot();
      if (showUserMessage) {
        setMessages((m) => [...m, { id: ++msgId.current, role: "user", text, imageData, boardSnapshot }]);
      } else if (options?.displayText) {
        // A widget answer is the learner's turn, so it belongs in the
        // transcript — but as what they DID, never as the internal directive
        // the model receives.
        setMessages((m) => [...m, { id: ++msgId.current, role: "user", text: options.displayText!, boardSnapshot }]);
      }
      // Consume the transient payload once. The request below retains this
      // callback's immutable attachment snapshot while React clears the UI.
      setAttachments([]);
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
          context: {
            effortParameter: effort,
          },
          learner: {
            learnerId: resolvedLearnerId,
            learnerMessage: text,
            signal: controller.signal,
            onboarding: onboarding ?? undefined,
            bindingPlan: options?.bindingPlan,
            attachments: attachments.map((a) => ({
              name: a.name,
              kind: a.kind,
              mimeType: a.mimeType,
              dataUrl: a.kind === "image" ? a.url : undefined,
              textContent: a.kind === "file" ? a.textContent : undefined,
            })),
          },
          board: {
            sessionId,
            sessionTitle: board.title,
            domain: board.domain,
            board,
            turnKind,
          },
          persistence: {
            sessionId,
            learnerId: resolvedLearnerId,
            boundNodes: resolvedBoundNodes,
          },
          model: {
            turnContract: activeContract,
          },
        });

        // The learner may have rewound while the transport was settling. Never
        // let a superseded turn repopulate chat or continue mutating the board.
        if (controller.signal.aborted || activityTurnRef.current !== activityTurn) return;
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
            if (controller.signal.aborted || activityTurnRef.current !== activityTurn) return;
            const op = turn.boardOps[index];
            setAgentActivity(activityForBoardOp(op, index, turn.boardOps.length));
            if (index > 0) {
              await new Promise((resolve) => window.setTimeout(resolve, 360));
            }
            if (controller.signal.aborted || activityTurnRef.current !== activityTurn) return;

            if (op.op === "spawn_thread") {
              const thread = buildAgentThread(board, op);
              try {
                // Record first: an agent branch is only added to the session
                // after its durable audit row exists.
                await logThread(thread);
                if (controller.signal.aborted || activityTurnRef.current !== activityTurn) return;
                setBoards((current) => current.some((item) => item.id === thread.id) ? current : [...current, thread]);
                notify(`Tutor created thread: ${thread.title}`);
              } catch {
                notify("The agent thread could not be logged, so it was not created");
              }
              continue;
            }

            if (op.op === "spawn_prerequisite_thread") {
              const threadBoard = buildPrerequisiteThread(board, op);
              try {
                await recordSessionThread({
                  sessionId,
                  boardId: threadBoard.id,
                  parentBoardId: boardsRef.current[activeIdRef.current].id,
                  title: threadBoard.title,
                  reason: threadBoard.thread!.reason,
                  createdBy: "agent",
                  createdAt: threadBoard.thread!.createdAt,
                });
                if (controller.signal.aborted || activityTurnRef.current !== activityTurn) return;
                setBoards((current) => current.some((item) => item.id === threadBoard.id) ? current : [...current, threadBoard]);
                notify(`Teaching prerequisite: ${op.prerequisiteLabel}`);
                setActiveId(threadBoard.id);
              } catch {
                notify("The prerequisite thread could not be logged, so it was not created");
              }
              continue;
            }

            // Bind an interactive block to the contract this turn authored it
            // under, BEFORE it can be answered. The binding is what makes a
            // late submission resolvable to the activity the learner was
            // actually set, rather than to whatever the tutor has moved on to
            // by the time they answer.
            // Bind an interactive block to the contract this turn authored it
            // under, BEFORE it can be answered. The block id is pre-assigned
            // here precisely so the binding can be durable by the time the
            // widget is on screen: that is what makes a late submission
            // resolvable to the activity the learner was actually set, rather
            // than to whatever the tutor has moved on to by then.
            let appliedOp = op;
            if (op.op === "place_widget" && turn.activityId) {
              const blockId = `agent-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
              appliedOp = { ...op, blockId };
              try {
                await bindBlockToActivity(sessionId, blockId, turn.activityId);
              } catch {
                // An unbound block still records evidence via the fallback
                // path; losing the binding must not cost the learner the task.
              }
              if (controller.signal.aborted || activityTurnRef.current !== activityTurn) return;
            }

            setBoards((current) =>
              current.map((item) => item.id === targetBoardId ? applyBoardOp(item, appliedOp, item.domain) : item)
            );
          }
        }

        if (controller.signal.aborted || activityTurnRef.current !== activityTurn) return;
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
        // A cancellation is something WE caused: a rewind superseding this turn,
        // or the room unmounting (including React StrictMode's dev
        // mount/unmount/remount). It is never a tutor failure, so it must never
        // surface as a tutor error in the learner's chat.
        if (controller.signal.aborted || e?.failureClass === "aborted") {
          // A greeting killed by an unmount must still happen if the room is
          // still here (React StrictMode mounts, unmounts, then remounts). The
          // remount's effect has already run and skipped by now, so re-arm the
          // flag and bump a counter to actually re-run it.
          if (turnKind === "greeting") {
            greetedRef.current = false;
            setGreetAttempt((attempt) => attempt + 1);
          }
          if (activityTurnRef.current === activityTurn) {
            setAgentStatus("idle");
            setAgentActivity(null);
          }
          return;
        }
        // A widget-derived turn that errored (schema_invalid, transport, etc.)
        // must release its dedupe key here too — the saveWidgetState catch
        // block already runs only when handleSendRef.current is missing or
        // throws synchronously, so any throw from inside askTutorTurn is
        // caught here. Holding the key after a failed turn would leave the
        // learner staring at an answered widget that can never wake the tutor
        // again for the rest of the session — a silent dead end far worse
        // than one failed turn. Must be the same key that was claimed in
        // saveWidgetState: `blockId` for a single widget, `group:…` for a
        // cluster. The helper exists so this release invariant is testable.
        releaseWidgetDedupeOnFailure(signalledWidgets.current, turnKind, options?.signalKey);
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
        if (activityTurnRef.current === activityTurn) setTyping(false);
        if (abortRef.current === controller) abortRef.current = null;
      }
    },
    [attachments, board, logThread, notify, onboarding, sessionId, resolvedBoundNodes, speakTutorText, activeContract, resolvedLearnerId]
  );

  handleSendRef.current = handleSend;

  // Start a learner-created thread explanation only after React has committed
  // the new board as active. This ensures handleSend captures the thread board
  // rather than the parent board that was active when the branch was created.
  useEffect(() => {
    if (!pendingThreadExplanation || pendingThreadExplanation.boardId !== activeId || !board.thread) return;

    const { selection, question } = pendingThreadExplanation;
    setPendingThreadExplanation(null);
    void handleSendRef.current?.(
      question
        ? `The learner highlighted "${selection}" and asked: "${question}". Explain this concept clearly on the board, breaking it down step by step. Start with what they highlighted, then address their specific question.`
        : `The learner highlighted "${selection}" and wants you to explain it. Break down this concept clearly on the board, step by step, making sure to explain what it means and why it matters.`,
      undefined,
      false,
      { kind: "chat" }
    );
  }, [activeId, board.thread, pendingThreadExplanation]);

  // A fresh chalkboard opens with a tutor greeting and the first lesson turn;
  // restored sessions keep their existing transcript untouched. When the
  // learner just completed the intake form, the first turn leads with the
  // syllabus fitted to their submitted answers rather than a generic opener.
  useEffect(() => {
    if (initialSession || greetedRef.current || greetAttempt > 1) return;
    greetedRef.current = true;
    const hasIntakeAnswers = (onboarding?.answers ?? []).some((answer) => answer.answer.trim());
    void handleSend(
      hasIntakeAnswers
        ? "The learner just submitted your intake form — their answers are in the session reminder. Before any teaching: place the plan widget AND the overview widget TOGETHER. The plan is the route from where they stand to mastery, built directly on their intake answers. The overview shows the full concept map (identities, properties, graphs, vocabulary, pitfalls, patterns) so they see exactly what they'd learn before agreeing. Both are required — neither substitutes for the other. Then the roadmap. Place no teaching content. Teaching begins only when they agree to the plan (their \"Start learning\" is your go signal), and if they edit it first, the edited route is binding. Keep the chat to a short greeting that reflects what they told you."
        : "Open the lesson with a brief welcome, then place the first teaching step or orientation on the chalkboard. Keep the chat response to a short greeting.",
      undefined,
      false,
      { kind: "greeting" }
    );
  }, [handleSend, initialSession, greetAttempt, onboarding]);

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
    // Whole boards, every page. Pagination is a render-time slice inside
    // Chalkboard and never reaches board.blocks; exporting the current page
    // would silently hand the learner a fraction of their own lesson.
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
        {/* Per-block boundaries inside Chalkboard catch content failures. This
            one catches the board shell itself (pan/zoom, annotation canvas) so
            a failure there still leaves the chat dock and toolbar usable and
            the session recoverable rather than blanking the window. */}
        <ErrorBoundary
          label="Chalkboard"
          resetKey={board.id}
          fallback={(_error, reset) => (
            <div className="grid h-full w-full place-items-center bg-[#191b1f] px-6 text-center">
              <div className="max-w-sm">
                <div className="text-[14px] font-medium text-white/90">This board could not be drawn</div>
                <p className="mt-1.5 text-[12px] leading-relaxed text-white/55">
                  Your transcript and notes are safe. Reopening the board usually clears it.
                </p>
                <button
                  type="button"
                  onClick={reset}
                  className="mt-3 rounded-md bg-white/12 px-3 py-1.5 text-[12px] text-white/90 hover:bg-white/20"
                >
                  Redraw board
                </button>
              </div>
            </div>
          )}
        >
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
          strokesKey={inkKey}
          onClearRef={(fn) => (clearInkRef.current = fn)}
          onRootRef={(node) => (boardRootRef.current = node)}
          initialView={viewMap[board.id]}
          onViewChange={saveView}
          initialStrokes={liveStrokes}
          onStrokesChange={saveStrokes}
          onBlockStateChange={saveBlockState}
          onWidgetStateChange={saveWidgetState}
          paginate={boardPagination}
          pageSize={boardPageSize}
          onPageChange={handleBoardPageChange}
        />
        </ErrorBoundary>
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
            // If switching away from an agent-created prerequisite thread,
            // record the coverage and navigate back to parent
            const currentBoard = boards.find(b => b.id === activeId);
            if (currentBoard?.thread?.createdBy === "agent" && currentBoard.thread.prerequisiteSkillId) {
              handleThreadComplete(activeId, boards, setActiveId, notify);
            } else {
              setActiveId(id);
              notify("Board brought on screen");
            }
            setPanel(null);
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
          paginate={boardPagination}
          setPaginate={setBoardPagination}
          pageSize={boardPageSize}
          setPageSize={setBoardPageSize}
          boardRevertsWithMessage={boardRevertsWithMessage}
          setBoardRevertsWithMessage={setBoardRevertsWithMessage}
          onClose={() => setPanel(null)}
        />
      )}

      {chatOpen && (
        <ChatDock
          messages={messages}
          onSend={(t, img) => { void handleSend(t, img); }}
          onRevertMessage={handleRevertMessage}
          collapsed={chatCollapsed}
          setCollapsed={setChatCollapsed}
          onClose={() => setChatOpen(false)}
          typing={typing}
          agentStatus={agentStatus}
          activity={agentActivity}
          attachments={attachments}
          onAddAttachment={(kind, name, url, mimeType, textContent) => {
            const placeholder = name || {
              file: `file-${Date.now()}.txt`,
              image: `image-${Date.now()}.png`,
              audio: `voice-${Date.now()}.m4a`,
              code: `snippet-${Date.now()}.txt`,
            }[kind];
            setAttachments((list) => [...list, { name: placeholder, kind, url, mimeType, textContent }]);
            notify(`${kind} attached`);
          }}
          onClearAttachments={() => setAttachments([])}
          onRemoveAttachment={(index) =>
            setAttachments((list) => list.filter((_, i) => i !== index))
          }
          rewinding={rewinding}
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

/**
 * Handle completion of a prerequisite thread.
 * Records the coverage in the store and navigates back to the parent board
 * if resumeAfterComplete is set.
 */
function handleThreadComplete(threadId: string, boards: BoardDoc[], setActiveId: (id: string) => void, notify: (t: string) => void): void {
  const threadBoard = boards.find((b) => b.id === threadId);
  if (threadBoard?.thread?.createdBy === "agent" && threadBoard.parentId) {
    if (threadBoard.thread.prerequisiteSkillId) {
      recordPrerequisiteCovered(threadBoard.thread.prerequisiteSkillId);
    }
    // Only navigate back if resumeAfterComplete is true (default for prereq threads)
    if (threadBoard.thread.resumeAfterComplete !== false) {
      setActiveId(threadBoard.parentId);
      notify("Prerequisite review complete — returning to lesson");
    }
  }
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

/**
 * Build a prerequisite review thread for a missing foundational concept.
 * Tracks the prerequisiteSkillId so completion can be recorded in the store.
 */
function buildPrerequisiteThread(
  parent: BoardDoc,
  op: Extract<BoardOp, { op: "spawn_prerequisite_thread" }>
): BoardDoc {
  const createdAt = new Date().toISOString();
  const blocks = op.teachingBlocks
    .map((spec) => blockSpecToBlock(spec as unknown as Record<string, unknown>, parent.domain))
    .filter((block): block is NonNullable<typeof block> => block !== null);

  return {
    id: `board-prereq-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    title: `Review: ${op.prerequisiteLabel}`,
    subtitle: `Prerequisite review · ${parent.title}`,
    domain: parent.domain,
    blocks: [
      // Title block as the first element
      { id: `prereq-title-${Date.now()}`, kind: "title" as const, text: op.prerequisiteLabel },
      ...blocks,
    ],
    parentId: parent.id,
    thread: {
      createdBy: "agent",
      reason: `Teaching prerequisite: ${op.prerequisiteSkillId}`,
      createdAt,
      // Store the prerequisite skill id for completion tracking
      prerequisiteSkillId: op.prerequisiteSkillId,
      // Whether to return to parent after completing this review
      resumeAfterComplete: op.resumeAfterComplete,
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
    case "place_widget":
      return {
        kind: "visualizing",
        label: `Placing a ${WIDGET_LABEL[op.intent.kind].toLowerCase()}`,
        detail: "Adding an interactive study widget to the board",
        progress,
      };
    case "update_widget":
      return {
        kind: "revising",
        label: `Updating the ${WIDGET_LABEL[op.intent.kind].toLowerCase()}`,
        detail: "Reconfiguring the study widget in place",
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
    case "redraw_block":
      return {
        kind: "revising",
        label: "Redrawing that for you",
        detail: "Remounting the block so it renders from scratch",
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
    case "spawn_prerequisite_thread":
      return {
        kind: "spawning",
        label: "Reviewing prerequisite",
        detail: `Opening prerequisite review: ${op.prerequisiteLabel}`,
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
  // A caller may pre-assign the block id so it can record something about the
  // block (its activity contract) before the block exists on the board. Ids
  // minted here are otherwise opaque and unknowable until after the apply.
  const preassigned = typeof call.args.blockId === "string" ? call.args.blockId.trim() : "";
  const id = preassigned || `agent-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
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
    case "place_widget": {
      // Re-validate at the placement boundary: a corrupt or drifted widget
      // payload must never reach the chalkboard as a half-configured card.
      const intent = args.intent;
      if (!validateWidgetIntent(intent).valid) return null;
      return { id, kind: "widget" as const, intent: intent as WidgetIntent };
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

/**
 * Board snapshots are a full clone of every board, so keeping one on every
 * message would grow the saved session quadratically and blow the ~5MB
 * localStorage budget on a long lesson.
 *
 * Only the most recent revert points keep their snapshot. Older messages stay
 * revertable, but revert the transcript alone — the same graceful path already
 * taken by sessions saved before snapshots existed.
 */
const PERSISTED_BOARD_SNAPSHOTS = 12;

/**
 * Release the dedupe key for a widget-derived turn that did NOT complete
 * successfully — schema-invalid model output, transport failure, or any
 * other throw from `askTutorTurn`. The saveWidgetState catch block runs only
 * on the synchronous failures it can see; a failed async turn reaches here.
 *
 * The invariant is the whole point of the widget dedupe mechanism: a widget
 * that wakes the tutor once must be wake-able AGAIN if the first wake failed,
 * or the learner is stranded with an answered widget that can never produce
 * another turn. Aborts are handled separately (they are an intentional
 * dismissal, not a failure) and DO NOT need this release because the
 * saveWidgetState catch has not yet fired by the time the abort propagates.
 *
 * `signalledWidgets` is mutated in place so the caller keeps its reference;
 * the helper exists to make this guarantee unit-testable.
 *
 * Returns true when a key was actually released, so tests can assert that the
 * caller released only the correct key (not a cluster key from a different
 * widget).
 */
export function releaseWidgetDedupeOnFailure(
  signalledWidgets: Set<string>,
  turnKind: TurnKind,
  signalKey: string | undefined
): boolean {
  if (signalKey === undefined) return false;
  if (turnKind !== "widget" && turnKind !== "plan_start") return false;
  if (!signalledWidgets.has(signalKey)) return false;
  signalledWidgets.delete(signalKey);
  return true;
}

export function pruneSnapshotsForStorage(messages: ChatMsg[]): ChatMsg[] {
  let remaining = PERSISTED_BOARD_SNAPSHOTS;
  const kept = new Set<number>();
  for (let index = messages.length - 1; index >= 0 && remaining > 0; index -= 1) {
    if (messages[index].boardSnapshot) {
      kept.add(messages[index].id);
      remaining -= 1;
    }
  }
  return messages.map(({ imageData: _imageData, ...message }) =>
    message.boardSnapshot && !kept.has(message.id)
      ? { ...message, boardSnapshot: undefined }
      : message
  );
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
    case "widget": {
      if (!validateWidgetIntent(spec.intent).valid) return null;
      return { id, kind: "widget" as const, intent: spec.intent as WidgetIntent };
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
    case "widget":
      return widgetSearchText(block.intent);
    case "row":
      return block.children.map(blockSearchText).join(" \n ");
  }
}

/** Searchable text for a widget, so targetMatchText can find one by its visible
 *  content the same way it finds a text block. */
function widgetSearchText(intent: WidgetIntent): string {
  const parts: string[] = [intent.kind, WIDGET_LABEL[intent.kind], intent.title ?? "", intent.note ?? ""];
  switch (intent.kind) {
    case "roadmap":
      parts.push(intent.heading ?? "", ...intent.steps.map((step) => step.label));
      break;
    case "concept_card":
      parts.push(intent.term, intent.definition);
      break;
    case "slider":
      parts.push(intent.label, intent.parameter);
      break;
    case "animation":
      parts.push(...intent.frames.map((frame) => frame.caption));
      break;
    case "comparison":
      parts.push(...intent.columns.map((column) => column.title), intent.takeaway ?? "");
      break;
    case "question":
    case "retrieval_check":
      parts.push(intent.prompt);
      break;
    case "hint":
      parts.push(...intent.steps.map((step) => step.label));
      break;
    case "scratchpad":
      parts.push(intent.prompt ?? "", intent.starter ?? "");
      break;
    case "annotation":
      parts.push(intent.targetLabel ?? "", ...intent.marks.map((mark) => mark.target));
      break;
    case "reveal":
      parts.push(intent.prompt ?? "", ...intent.items.map((item) => item.label));
      break;
    case "example":
      parts.push(intent.problem ?? "", ...intent.steps.map((step) => step.why));
      break;
    case "mistake_check":
      parts.push(intent.prompt ?? "", intent.misconception ?? "");
      break;
    case "memory_hook":
      parts.push(intent.hook);
      break;
    case "challenge":
      parts.push(intent.prompt);
      break;
    case "reflection":
      parts.push(intent.prompt);
      break;
    case "mastery_card":
      parts.push(intent.concept);
      break;
    case "figure_spec":
      parts.push(intent.spec.kind);
      parts.push(intent.caption ?? "");
      break;
  }
  return parts.filter(Boolean).join(" ");
}

/** Drop any previous redraw suffix so repeated redraws do not grow the id
 *  unboundedly, and so the tutor's original anchor still matches. */
function stripRedrawSuffix(id: string): string {
  return id.replace(/~r[0-9a-z]+$/, "");
}

/** Monotonic, so two redraws within the same millisecond still produce
 *  different ids. An identical id would leave React's key unchanged and skip
 *  the remount entirely — the exact repair the learner asked for. */
let redrawCounter = 0;
function redrawId(id: string): string {
  redrawCounter += 1;
  return `${stripRedrawSuffix(id)}~r${redrawCounter.toString(36)}${Date.now().toString(36)}`;
}

function resolveBoardTargetIndex(board: BoardDoc, op: Record<string, any>): number {
  if (typeof op.targetAnchor === "string" && op.targetAnchor.trim()) {
    const anchor = op.targetAnchor.trim();
    const exact = board.blocks.findIndex((block) => block.id === anchor);
    if (exact >= 0) return exact;
    // A redrawn block carries a fresh id, but the tutor is still holding the
    // id it was given when the block was placed. Match through the suffix so a
    // redraw does not orphan every later update targeting that block.
    const base = stripRedrawSuffix(anchor);
    return board.blocks.findIndex((block) => stripRedrawSuffix(block.id) === base);
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

export function applyBoardOp(board: BoardDoc, op: Record<string, any>, domain: BoardDoc["domain"]): BoardDoc {
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
    case "redraw_block": {
      // "I can't see it" repair. Content is untouched; only the block's id
      // changes, and React keys the block list by id, so the old subtree
      // unmounts and a brand-new one mounts. That clears a tripped error
      // boundary, a failed lazy-loaded adapter, or a widget wedged in a bad
      // internal state — none of which a content edit would fix.
      const index = resolveBoardTargetIndex(board, op);
      if (index < 0) return board;
      const target = board.blocks[index];
      const blocks = board.blocks.slice();
      blocks[index] = { ...target, id: redrawId(target.id) };
      return { ...board, blocks };
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
    case "update_widget": {
      const index = resolveBoardTargetIndex(board, op);
      if (index < 0) return board;
      const target = board.blocks[index];
      if (target.kind !== "widget") return board;
      if (!validateWidgetIntent(op.intent).valid) return board;
      const blocks = board.blocks.slice();
      // Reconfiguring a widget keeps the learner's interaction state: a tutor
      // rewording a question must not silently erase the answer they gave.
      blocks[index] = { ...target, intent: op.intent as WidgetIntent, state: target.state };
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
