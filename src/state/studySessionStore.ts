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
export const STUDY_SESSIONS_CHANGED_EVENT = "studyus:study-sessions-changed";

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

/** Permanently remove one persisted study session. No-op if the id is unknown. */
export function deleteStudySession(id: string): void {
  const sessions = read().filter((item) => item.id !== id);
  localStorage.setItem(KEY, JSON.stringify(sessions));
  emitSessionsChanged();
}
