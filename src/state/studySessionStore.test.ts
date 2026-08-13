import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  deleteStudySession,
  getStudySession,
  listStudySessions,
  pastePastNoteClipboard,
  readPastNoteClipboard,
  renameStudySession,
  saveStudySession,
  subscribeToStudySessions,
  writePastNoteClipboard,
  type StoredStudySession,
} from "./studySessionStore";

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => Array.from(values.keys())[index] ?? null,
    removeItem: (key) => {
      values.delete(key);
    },
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}

const session: StoredStudySession = {
  id: "session-1",
  title: "Orbital mechanics",
  domain: "physics",
  boards: [],
  activeId: "",
  messages: [],
  viewMap: {},
  strokeMap: {},
  updatedAt: "2026-08-12T00:00:00.000Z",
};

describe("study session subscriptions", () => {
  beforeEach(() => {
    vi.stubGlobal("window", new EventTarget());
    vi.stubGlobal("localStorage", memoryStorage());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renames and copies the complete saved-note snapshot", () => {
    const detailed = {
      ...session,
      boards: [{ id: "board-1", title: "Orbits", subtitle: "", domain: "physics" as const, blocks: [] }],
      activeId: "board-1",
      messages: [{ id: 1, role: "tutor" as const, text: "Keep this transcript." }],
    };
    saveStudySession(detailed);

    expect(renameStudySession(session.id, "  Circular motion  ")?.title).toBe("Circular motion");
    expect(writePastNoteClipboard(session.id, "copy")?.session.boards).toEqual(detailed.boards);
    const pasted = pastePastNoteClipboard();

    expect(pasted?.id).not.toBe(session.id);
    expect(pasted?.title).toBe("Circular motion copy");
    expect(pasted?.boards).toEqual(detailed.boards);
    expect(pasted?.messages).toEqual(detailed.messages);
    expect(getStudySession(session.id)?.title).toBe("Circular motion");
    expect(listStudySessions()).toHaveLength(2);
  });

  it("cuts by moving an existing snapshot on paste and clears the clipboard", () => {
    saveStudySession(session);
    expect(writePastNoteClipboard(session.id, "cut")?.mode).toBe("cut");
    const pasted = pastePastNoteClipboard();

    expect(pasted?.id).toBe(session.id);
    expect(listStudySessions()).toHaveLength(1);
    expect(readPastNoteClipboard()).toBeNull();
  });

  it("broadcasts same-window saves and deletes to every session list", () => {
    const firstList = vi.fn();
    const secondList = vi.fn();
    const unsubscribeFirst = subscribeToStudySessions(firstList);
    const unsubscribeSecond = subscribeToStudySessions(secondList);

    saveStudySession(session);
    expect(listStudySessions().map((item) => item.id)).toEqual([session.id]);
    expect(firstList).toHaveBeenCalledTimes(1);
    expect(secondList).toHaveBeenCalledTimes(1);

    deleteStudySession(session.id);
    expect(listStudySessions()).toEqual([]);
    expect(firstList).toHaveBeenCalledTimes(2);
    expect(secondList).toHaveBeenCalledTimes(2);

    unsubscribeFirst();
    unsubscribeSecond();
    saveStudySession(session);
    expect(firstList).toHaveBeenCalledTimes(2);
    expect(secondList).toHaveBeenCalledTimes(2);
  });
});
