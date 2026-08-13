import type { Tab } from "../components/TopBar";

export const TAB_SESSION_STORAGE_KEY = "studyus.tab_session.v1";
const MAX_TABS = 40;
const MAX_CLOSED_TABS = 20;

export interface PersistedTabSession {
  tabs: Tab[];
  activeTabId: string;
  closedTabs: Tab[];
}

export function createDefaultTab(): Tab {
  return { id: "home", title: "Study", kind: "board" };
}

function isTabKind(value: unknown): value is Tab["kind"] {
  return value === "board" || value === "curriculum" || value === "test" || value === "note";
}

function sanitizeTab(value: unknown): Tab | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.id !== "string" || !candidate.id.trim()) return null;
  if (typeof candidate.title !== "string" || !candidate.title.trim()) return null;
  if (!isTabKind(candidate.kind)) return null;
  return {
    id: candidate.id.slice(0, 300),
    title: candidate.title.slice(0, 160),
    kind: candidate.kind,
    ...(candidate.pinned === true ? { pinned: true } : {}),
    ...(typeof candidate.contentId === "string" && candidate.contentId.trim()
      ? { contentId: candidate.contentId.slice(0, 300) }
      : {}),
  };
}

function uniqueTabs(values: unknown[], limit: number): Tab[] {
  const seen = new Set<string>();
  const tabs: Tab[] = [];
  for (const value of values) {
    const tab = sanitizeTab(value);
    if (!tab || seen.has(tab.id)) continue;
    seen.add(tab.id);
    tabs.push(tab);
    if (tabs.length >= limit) break;
  }
  return tabs;
}

export function sanitizeTabSession(value: unknown): PersistedTabSession {
  const candidate = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const tabs = uniqueTabs(Array.isArray(candidate.tabs) ? candidate.tabs : [], MAX_TABS);
  const ensuredTabs = tabs.length > 0 ? tabs : [createDefaultTab()];
  const requestedActive = typeof candidate.activeTabId === "string" ? candidate.activeTabId : "";
  const activeTabId = ensuredTabs.some((tab) => tab.id === requestedActive)
    ? requestedActive
    : ensuredTabs[0].id;
  const openIds = new Set(ensuredTabs.map((tab) => tab.id));
  const closedTabs = uniqueTabs(
    Array.isArray(candidate.closedTabs) ? candidate.closedTabs : [],
    MAX_CLOSED_TABS
  ).filter((tab) => !openIds.has(tab.id));
  return { tabs: ensuredTabs, activeTabId, closedTabs };
}

export function loadTabSession(): PersistedTabSession {
  if (typeof localStorage === "undefined") return sanitizeTabSession(null);
  try {
    return sanitizeTabSession(JSON.parse(localStorage.getItem(TAB_SESSION_STORAGE_KEY) ?? "null"));
  } catch {
    return sanitizeTabSession(null);
  }
}

export function saveTabSession(session: PersistedTabSession): void {
  if (typeof localStorage === "undefined") return;
  const sanitized = sanitizeTabSession(session);
  localStorage.setItem(TAB_SESSION_STORAGE_KEY, JSON.stringify(sanitized));
}
