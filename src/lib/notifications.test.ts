import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_PREFERENCES,
  PREFERENCES_STORAGE_KEY,
  type StudyusPreferences,
} from "./preferences";
import {
  IN_APP_NOTIFICATION_EVENT,
  checkScheduledSummary,
  getDesktopNotificationPermission,
  notifyStudyusEvent,
  requestDesktopNotificationPermission,
  type InAppNotificationDetail,
} from "./notifications";

const LAST_SUMMARY_KEY = "studyus.notifications.last-summary.v1";

function installWindow(preferences: StudyusPreferences = structuredClone(DEFAULT_PREFERENCES)) {
  const values = new Map<string, string>();
  values.set(PREFERENCES_STORAGE_KEY, JSON.stringify(preferences));
  const localStorage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
    clear: () => values.clear(),
    key: (index: number) => [...values.keys()][index] ?? null,
    get length() { return values.size; },
  } satisfies Storage;
  const target = new EventTarget();
  Object.assign(target, { localStorage, focus: vi.fn() });
  vi.stubGlobal("window", target);
  return { target, values };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("local notification delivery", () => {
  it("routes enabled app events through the real in-app event surface", () => {
    const { target } = installWindow();
    let detail: InAppNotificationDetail | null = null;
    target.addEventListener(IN_APP_NOTIFICATION_EVENT, (event) => {
      detail = (event as CustomEvent<InAppNotificationDetail>).detail;
    });

    expect(notifyStudyusEvent("testReady", "Test ready", "Open Available tests.")).toBe("in-app");
    expect(detail).toEqual({ title: "Test ready", body: "Open Available tests." });
  });

  it("stays silent when an event rule is disabled", () => {
    const preferences = structuredClone(DEFAULT_PREFERENCES);
    preferences.notifications.events.sessionComplete.enabled = false;
    const { target } = installWindow(preferences);
    const listener = vi.fn();
    target.addEventListener(IN_APP_NOTIFICATION_EVENT, listener);

    expect(notifyStudyusEvent("sessionComplete", "Saved", "Session saved.")).toBe("disabled");
    expect(listener).not.toHaveBeenCalled();
  });

  it("records a summary baseline, then delivers only after its saved cadence", () => {
    const preferences = structuredClone(DEFAULT_PREFERENCES);
    preferences.notifications.summary = { cadence: "daily", channel: "in-app" };
    const { target, values } = installWindow(preferences);
    const listener = vi.fn();
    target.addEventListener(IN_APP_NOTIFICATION_EVENT, listener);
    const start = Date.UTC(2026, 7, 12, 0, 0, 0);

    expect(checkScheduledSummary(start)).toBe(false);
    expect(values.get(LAST_SUMMARY_KEY)).toBe(String(start));
    expect(checkScheduledSummary(start + 23 * 60 * 60 * 1000)).toBe(false);
    expect(checkScheduledSummary(start + 24 * 60 * 60 * 1000)).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("reports desktop delivery as unsupported instead of pretending to send", async () => {
    installWindow();
    vi.stubGlobal("Notification", undefined);

    expect(getDesktopNotificationPermission()).toBe("unsupported");
    await expect(requestDesktopNotificationPermission()).resolves.toBe("unsupported");
  });
});
