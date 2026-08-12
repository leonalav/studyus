import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  deleteStudySession,
  listStudySessions,
  saveStudySession,
  subscribeToStudySessions,
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
