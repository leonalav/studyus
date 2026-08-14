import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  TAB_SESSION_STORAGE_KEY,
  loadTabSession,
  sanitizeTabSession,
  saveTabSession,
} from "./tabSessionStore";

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => Array.from(values.keys())[index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  };
}

describe("persisted tab sessions", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", memoryStorage());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("restores open, active, pinned, duplicated-resource, and closed-tab state", () => {
    saveTabSession({
      tabs: [
        { id: "home", title: "Study", kind: "board", pinned: true },
        { id: "note-copy", title: "Limits", kind: "note", contentId: "note-session-1" },
      ],
      activeTabId: "note-copy",
      closedTabs: [
        { id: "cur-source-1", title: "Calculus", kind: "curriculum" },
      ],
    });

    expect(loadTabSession()).toEqual({
      tabs: [
        { id: "home", title: "Study", kind: "board", pinned: true },
        { id: "note-copy", title: "Limits", kind: "note", contentId: "note-session-1" },
      ],
      activeTabId: "note-copy",
      closedTabs: [
        { id: "cur-source-1", title: "Calculus", kind: "curriculum" },
      ],
    });
    expect(localStorage.getItem(TAB_SESSION_STORAGE_KEY)).not.toBeNull();
  });

  it("fails closed to one default tab and removes invalid or duplicate records", () => {
    expect(sanitizeTabSession({
      tabs: [
        null,
        { id: "", title: "Invalid", kind: "board" },
        { id: "home", title: "Study", kind: "board" },
        { id: "home", title: "Duplicate", kind: "note" },
      ],
      activeTabId: "missing",
      closedTabs: [
        { id: "home", title: "Already open", kind: "board" },
        { id: "closed", title: "Closed note", kind: "note" },
      ],
    })).toEqual({
      tabs: [{ id: "home", title: "Study", kind: "board" }],
      activeTabId: "home",
      closedTabs: [{ id: "closed", title: "Closed note", kind: "note" }],
    });

    localStorage.setItem(TAB_SESSION_STORAGE_KEY, "not-json");
    expect(loadTabSession()).toEqual({
      tabs: [{ id: "home", title: "Study", kind: "board" }],
      activeTabId: "home",
      closedTabs: [],
    });
  });
});

describe("tab kinds and flags survive a reload", () => {
  it("keeps a marketplace tab", () => {
    // A kind missing from the guard is silently dropped on reload, which reads
    // as the tab closing itself.
    const restored = sanitizeTabSession({
      tabs: [{ id: "marketplace", title: "Marketplace", kind: "marketplace" }],
      activeTabId: "marketplace",
      closedTabs: [],
    });
    expect(restored.tabs.map((tab) => tab.kind)).toEqual(["marketplace"]);
  });

  it("keeps a favourited tab starred", () => {
    const restored = sanitizeTabSession({
      tabs: [{ id: "home", title: "Study", kind: "board", starred: true }],
      activeTabId: "home",
      closedTabs: [],
    });
    expect(restored.tabs[0].starred).toBe(true);
  });

  it("still rejects a genuinely unknown kind", () => {
    const restored = sanitizeTabSession({
      tabs: [{ id: "x", title: "X", kind: "wormhole" }],
      activeTabId: "x",
      closedTabs: [],
    });
    expect(restored.tabs.every((tab) => tab.kind !== ("wormhole" as never))).toBe(true);
  });
});
