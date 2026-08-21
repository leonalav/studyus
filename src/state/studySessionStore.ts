import type { Block, BoardDoc } from "../data/boards";
import type { BoardView, Stroke } from "../components/board/Chalkboard";
import type { ChatMsg } from "../components/board/BoardPanels";
import { sanitizeWidgetState, validateWidgetIntent } from "../lib/widgets/validate";
import type { WidgetIntent } from "../lib/widgets/types";

export interface StoredBoardAppearance {
  themeId: "classic" | "blueprint" | "carbon";
  fontId: string;
  fontScale: number;
  latex: boolean;
}

export interface StoredStudySession {
  id: string;
  title: string;
  domain: BoardDoc["domain"];
  boundNodes?: string[];
  boards: BoardDoc[];
  activeId: string;
  messages: ChatMsg[];
  viewMap: Record<string, BoardView>;
  strokeMap: Record<string, Stroke[]>;
  /** Presentation settings are part of the saved board, not viewer defaults. */
  appearance?: StoredBoardAppearance;
  updatedAt: string;
}

/**
 * Rehydrate a board tree so widgets survive reopen.
 *
 * localStorage only guarantees JSON shape. A truncated write, an older build,
 * or a partially migrated payload can leave widget intents/states that throw
 * on first paint — which is exactly how a working animation becomes "could not
 * be drawn" the next time the learner opens the note. Validate + sanitize once
 * at the storage boundary so the renderer always receives a durable payload.
 */
function hydrateBlock(block: Block): Block {
  if (block.kind === "row") {
    return { ...block, children: block.children.map(hydrateBlock) };
  }
  if (block.kind !== "widget") return block;

  const validated = validateWidgetIntent(block.intent);
  const intent = validated.valid
    ? (block.intent as WidgetIntent)
    : // Keep the block on the board even if validation fails: the surface's
      // normalizeIntent path still tries to draw what it can, and dropping the
      // block would erase the learner's interaction history.
      (block.intent as WidgetIntent);

  const state = block.state ? sanitizeWidgetState(block.state) : undefined;
  if (state === block.state && intent === block.intent) return block;
  return { ...block, intent, ...(state ? { state } : { state: undefined }) };
}

export function hydrateStudyBoards(boards: BoardDoc[] | undefined | null): BoardDoc[] {
  if (!Array.isArray(boards) || boards.length === 0) return [];
  return boards.map((board) => {
    if (!board || !Array.isArray(board.blocks)) {
      return {
        id: board?.id ?? `board-${Date.now()}`,
        title: board?.title ?? "Board",
        subtitle: board?.subtitle ?? "",
        domain: board?.domain ?? "math",
        blocks: [],
        parentId: board?.parentId,
        thread: board?.thread,
      };
    }
    return {
      ...board,
      blocks: board.blocks.map(hydrateBlock),
    };
  });
}

export function hydrateStudySession(session: StoredStudySession): StoredStudySession {
  const boards = hydrateStudyBoards(session.boards);
  const activeId =
    boards.some((board) => board.id === session.activeId)
      ? session.activeId
      : boards[0]?.id ?? session.activeId;
  return {
    ...session,
    boards,
    activeId,
    viewMap: session.viewMap && typeof session.viewMap === "object" ? session.viewMap : {},
    strokeMap: session.strokeMap && typeof session.strokeMap === "object" ? session.strokeMap : {},
    messages: Array.isArray(session.messages) ? session.messages : [],
  };
}

const KEY = "studyus.study_sessions.v1";
const CLIPBOARD_KEY = "studyus.past_note_clipboard.v1";
export const STUDY_SESSIONS_CHANGED_EVENT = "studyus:study-sessions-changed";

export interface PastNoteClipboard {
  mode: "copy" | "cut";
  session: StoredStudySession;
  copiedAt: string;
}

function emitSessionsChanged(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(STUDY_SESSIONS_CHANGED_EVENT));
  }
}

/** Subscribe both to same-window writes and cross-window localStorage changes. */
export function subscribeToStudySessions(listener: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  const onStorage = (event: StorageEvent) => {
    if (event.key === KEY) listener();
  };
  window.addEventListener(STUDY_SESSIONS_CHANGED_EVENT, listener);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(STUDY_SESSIONS_CHANGED_EVENT, listener);
    window.removeEventListener("storage", onStorage);
  };
}

function read(): StoredStudySession[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    if (!Array.isArray(value)) return [];
    return value
      .filter((item): item is StoredStudySession => Boolean(item && typeof item === "object" && typeof (item as StoredStudySession).id === "string"))
      .map((item) => hydrateStudySession(item));
  } catch {
    return [];
  }
}

export function listStudySessions(): StoredStudySession[] {
  return read().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function getStudySession(id: string): StoredStudySession | null {
  return read().find((session) => session.id === id) ?? null;
}

export function saveStudySession(session: StoredStudySession): void {
  // Always persist a hydrated copy so the on-disk form stays round-trippable:
  // widget states stay bounded, boards keep their widget blocks, and a later
  // reopen does not reintroduce a payload that once threw on paint.
  const durable = hydrateStudySession({
    ...session,
    updatedAt: session.updatedAt || new Date().toISOString(),
  });
  const sessions = read().filter((item) => item.id !== durable.id);
  try {
    localStorage.setItem(KEY, JSON.stringify([durable, ...sessions].slice(0, 50)));
    emitSessionsChanged();
  } catch (error) {
    // Quota / private mode must not crash the study room mid-turn. The in-
    // memory board remains authoritative for the current visit.
    console.error("[session] failed to persist study session", error);
  }
}

/** Rename one persisted note while retaining all boards, views, and chat. */
export function renameStudySession(id: string, title: string): StoredStudySession | null {
  const clean = title.trim().slice(0, 160);
  if (!clean) return null;
  const sessions = read();
  const index = sessions.findIndex((item) => item.id === id);
  if (index < 0) return null;
  const renamed = { ...sessions[index], title: clean, updatedAt: new Date().toISOString() };
  sessions[index] = renamed;
  localStorage.setItem(KEY, JSON.stringify(sessions));
  emitSessionsChanged();
  return renamed;
}

/** Store the full snapshot so Paste preserves board fidelity and transcript. */
export function writePastNoteClipboard(sessionId: string, mode: "copy" | "cut"): PastNoteClipboard | null {
  const session = getStudySession(sessionId);
  if (!session) return null;
  const clipboard: PastNoteClipboard = {
    mode,
    session: JSON.parse(JSON.stringify(session)) as StoredStudySession,
    copiedAt: new Date().toISOString(),
  };
  localStorage.setItem(CLIPBOARD_KEY, JSON.stringify(clipboard));
  return clipboard;
}

export function readPastNoteClipboard(): PastNoteClipboard | null {
  try {
    const value = JSON.parse(localStorage.getItem(CLIPBOARD_KEY) ?? "null") as Partial<PastNoteClipboard> | null;
    if (!value || (value.mode !== "copy" && value.mode !== "cut") || !value.session?.id) return null;
    return value as PastNoteClipboard;
  } catch {
    return null;
  }
}

/**
 * Paste the internal Past Note clipboard into the collection. Copy creates a
 * fully independent session id; Cut moves the existing note to the top without
 * deleting it during the cut/paste interval.
 */
export function pastePastNoteClipboard(): StoredStudySession | null {
  const clipboard = readPastNoteClipboard();
  if (!clipboard) return null;
  const now = new Date().toISOString();
  if (clipboard.mode === "cut") {
    const current = getStudySession(clipboard.session.id) ?? clipboard.session;
    const moved = { ...current, updatedAt: now };
    saveStudySession(moved);
    localStorage.removeItem(CLIPBOARD_KEY);
    return moved;
  }

  const suffix = Math.random().toString(36).slice(2, 7);
  const duplicate: StoredStudySession = {
    ...JSON.parse(JSON.stringify(clipboard.session)) as StoredStudySession,
    id: `session-${Date.now()}-${suffix}`,
    title: `${clipboard.session.title} copy`,
    updatedAt: now,
  };
  saveStudySession(duplicate);
  return duplicate;
}

/** Permanently remove one persisted study session. No-op if the id is unknown. */
export function deleteStudySession(id: string): void {
  const sessions = read().filter((item) => item.id !== id);
  localStorage.setItem(KEY, JSON.stringify(sessions));
  const clipboard = readPastNoteClipboard();
  if (clipboard?.mode === "cut" && clipboard.session.id === id) {
    localStorage.removeItem(CLIPBOARD_KEY);
  }
  emitSessionsChanged();
}
