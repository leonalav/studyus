import {
  loadPreferences,
  type NotificationChannel,
  type NotificationEventId,
  type SummaryCadence,
} from "./preferences";

export const IN_APP_NOTIFICATION_EVENT = "studyus:notification";
const LAST_SUMMARY_KEY = "studyus.notifications.last-summary.v1";

export interface InAppNotificationDetail {
  title: string;
  body: string;
}

export type NotificationDelivery = "disabled" | "in-app" | "desktop" | "both" | "permission-needed";

function wantsInApp(channel: NotificationChannel): boolean {
  return channel === "in-app" || channel === "both";
}

function wantsDesktop(channel: NotificationChannel): boolean {
  return channel === "desktop" || channel === "both";
}

function sendInApp(title: string, body: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<InAppNotificationDetail>(IN_APP_NOTIFICATION_EVENT, {
    detail: { title, body },
  }));
}

function sendDesktop(title: string, body: string): boolean {
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return false;
  try {
    const notification = new Notification(title, { body, tag: `studyus-${title.toLowerCase().replace(/\W+/g, "-")}` });
    notification.onclick = () => {
      window.focus();
      notification.close();
    };
    return true;
  } catch {
    return false;
  }
}

function deliver(channel: NotificationChannel, title: string, body: string): NotificationDelivery {
  const inApp = wantsInApp(channel);
  const desktopRequested = wantsDesktop(channel);
  const desktop = desktopRequested && sendDesktop(title, body);

  if (inApp) sendInApp(title, body);
  if (inApp && desktop) return "both";
  if (desktop) return "desktop";
  if (inApp) return "in-app";
  return desktopRequested ? "permission-needed" : "disabled";
}

/** Deliver a real application event through the user's saved channels. */
export function notifyStudyusEvent(
  event: NotificationEventId,
  title: string,
  body: string
): NotificationDelivery {
  const rule = loadPreferences().notifications.events[event];
  if (!rule.enabled) return "disabled";
  return deliver(rule.channel, title, body);
}

/** Must be called from a click/tap handler so browsers are allowed to prompt. */
export async function requestDesktopNotificationPermission(): Promise<NotificationPermission | "unsupported"> {
  if (typeof Notification === "undefined") return "unsupported";
  if (Notification.permission === "granted" || Notification.permission === "denied") {
    return Notification.permission;
  }
  try {
    return await Notification.requestPermission();
  } catch {
    return "denied";
  }
}

export function getDesktopNotificationPermission(): NotificationPermission | "unsupported" {
  return typeof Notification === "undefined" ? "unsupported" : Notification.permission;
}

export function sendNotificationPreview(
  channel: NotificationChannel,
  title = "Studyus notifications are ready",
  body = "This is how saved study alerts will be delivered."
): NotificationDelivery {
  return deliver(channel, title, body);
}

export function cadenceMilliseconds(cadence: SummaryCadence): number | null {
  switch (cadence) {
    case "daily":
      return 24 * 60 * 60 * 1000;
    case "weekly":
      return 7 * 24 * 60 * 60 * 1000;
    case "monthly":
      return 30 * 24 * 60 * 60 * 1000;
    case "off":
      return null;
  }
}

/**
 * Checks due summaries while Studyus is running. The first run records a
 * baseline instead of immediately bothering a new user. Browser notifications
 * cannot run while the local app is closed without a server/push service, so
 * the Settings copy states this limitation explicitly.
 */
export function checkScheduledSummary(now = Date.now()): boolean {
  if (typeof window === "undefined") return false;
  const summary = loadPreferences().notifications.summary;
  const period = cadenceMilliseconds(summary.cadence);
  if (period === null) return false;

  let last = 0;
  try {
    last = Number(window.localStorage.getItem(LAST_SUMMARY_KEY) || 0);
  } catch {
    return false;
  }

  if (!Number.isFinite(last) || last <= 0) {
    try { window.localStorage.setItem(LAST_SUMMARY_KEY, String(now)); } catch {}
    return false;
  }
  if (now - last < period) return false;

  deliver(
    summary.channel,
    "Your Studyus summary is ready",
    "Review your recent study sessions, saved notes, and test activity."
  );
  try { window.localStorage.setItem(LAST_SUMMARY_KEY, String(now)); } catch {}
  return true;
}

export function startNotificationRuntime(): () => void {
  if (typeof window === "undefined") return () => undefined;
  checkScheduledSummary();
  const timer = window.setInterval(() => checkScheduledSummary(), 60_000);
  return () => window.clearInterval(timer);
}
