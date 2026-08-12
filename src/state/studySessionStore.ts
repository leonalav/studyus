import type { BoardDoc } from "../data/boards";
import type { BoardView, Stroke } from "../components/board/Chalkboard";
import type { ChatMsg } from "../components/board/BoardPanels";

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
    return Array.isArray(value) ? value as StoredStudySession[] : [];
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
  const sessions = read().filter((item) => item.id !== session.id);
  localStorage.setItem(KEY, JSON.stringify([session, ...sessions].slice(0, 50)));
  emitSessionsChanged();
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
