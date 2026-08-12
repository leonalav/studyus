export const PREFERENCES_STORAGE_KEY = "studyus.preferences.v1";
export const PREFERENCES_CHANGED_EVENT = "studyus:preferences-changed";

export type ThemePreference = "system" | "dark" | "light";
export type FontPreference = "system" | "grotesk" | "serif" | "mono";
export type DensityPreference = "comfortable" | "compact";
export type NotificationChannel = "in-app" | "desktop" | "both";
export type NotificationEventId = "testReady" | "sessionComplete";
export type SummaryCadence = "off" | "daily" | "weekly" | "monthly";
export type TutorDifficulty = "easier" | "adaptive" | "harder";

export interface AppearancePreferences {
  theme: ThemePreference;
  font: FontPreference;
  density: DensityPreference;
  textSize: number;
  reducedMotion: boolean;
  highContrast: boolean;
  dyslexiaFriendly: boolean;
  captions: boolean;
}

export interface NotificationRule {
  enabled: boolean;
  channel: NotificationChannel;
}

export interface NotificationPreferences {
  events: Record<NotificationEventId, NotificationRule>;
  summary: {
    cadence: SummaryCadence;
    channel: NotificationChannel;
  };
}

export interface TutorStylePreference {
  id: string;
  name: string;
  tone: string;
  approach: string;
  verbosity: number;
  patience: number;
  challenge: number;
  humor: number;
  preview: string;
  built?: boolean;
}

export interface TutorPreferences {
  styles: TutorStylePreference[];
  activeStyleId: string;
  sessionLength: number;
  breakEvery: number;
  difficulty: TutorDifficulty;
  voiceReplies: boolean;
  autoNotes: boolean;
}

export interface ProfilePreferences {
  fullName: string;
  email: string;
  timezone: string;
}

export interface SavedModelEndpoint {
  id: string;
  label: string;
  provider: "openai" | "anthropic" | "custom";
  baseUrl: string;
  model: string;
  keyMasked: string;
  active: boolean;
}

export interface StudyusPreferences {
  appearance: AppearancePreferences;
  notifications: NotificationPreferences;
  tutor: TutorPreferences;
  profile: ProfilePreferences;
  modelEndpoints: SavedModelEndpoint[];
}

export const DEFAULT_TUTOR_STYLES: TutorStylePreference[] = [
  {
    id: "witty",
    name: "Witty",
    tone: "Playful",
    approach: "Analogy-first",
    verbosity: 40,
    patience: 60,
    challenge: 55,
    humor: 85,
    preview: "So an orbit is really the universe's oldest running joke: you keep falling and keep missing the ground.",
    built: true,
  },
  {
    id: "professor",
    name: "Professor",
    tone: "Formal",
    approach: "First principles",
    verbosity: 80,
    patience: 70,
    challenge: 65,
    humor: 15,
    preview: "Let us begin with the definition. An orbit is the trajectory produced when gravitational acceleration balances the required centripetal acceleration.",
    built: true,
  },
  {
    id: "coach",
    name: "Coach",
    tone: "Encouraging",
    approach: "Socratic",
    verbosity: 55,
    patience: 90,
    challenge: 75,
    humor: 30,
    preview: "You've got this. Before I say anything, tell me: what has to be true for something to keep circling instead of falling straight down?",
    built: true,
  },
  {
    id: "socratic",
    name: "Socratic",
    tone: "Neutral",
    approach: "Question-led",
    verbosity: 45,
    patience: 85,
    challenge: 80,
    humor: 20,
    preview: "Interesting. What would happen if we doubled the radius — do you expect the speed to go up or down, and why?",
    built: true,
  },
  {
    id: "concise",
    name: "Concise",
    tone: "Direct",
    approach: "Result-first",
    verbosity: 20,
    patience: 40,
    challenge: 50,
    humor: 10,
    preview: "v = √(GM/r). Halves when r quadruples. Substitute your numbers, then verify units.",
    built: true,
  },
  {
    id: "storyteller",
    name: "Storyteller",
    tone: "Narrative",
    approach: "History & context",
    verbosity: 75,
    patience: 65,
    challenge: 45,
    humor: 55,
    preview: "In 1687 Newton pictured a cannon on a tall mountain. Fire it fast enough and the ball never lands — that's an orbit, and that image is where we start.",
    built: true,
  },
];

export const DEFAULT_PREFERENCES: StudyusPreferences = {
  appearance: {
    theme: "system",
    font: "grotesk",
    density: "comfortable",
    textSize: 100,
    reducedMotion: false,
    highContrast: false,
    dyslexiaFriendly: false,
    captions: true,
  },
  notifications: {
    events: {
      testReady: { enabled: true, channel: "in-app" },
      sessionComplete: { enabled: true, channel: "in-app" },
    },
    summary: { cadence: "weekly", channel: "in-app" },
  },
  tutor: {
    styles: DEFAULT_TUTOR_STYLES,
    activeStyleId: "witty",
    sessionLength: 30,
    breakEvery: 20,
    difficulty: "adaptive",
    voiceReplies: false,
    autoNotes: true,
  },
  profile: {
    fullName: "Learner",
    email: "",
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  },
  modelEndpoints: [],
};

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function enumValue<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && allowed.includes(value as T) ? value as T : fallback;
}

function booleanValue(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function numberValue(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(max, Math.max(min, Math.round(value)))
    : fallback;
}

function textValue(value: unknown, fallback: string, maxLength: number): string {
  return typeof value === "string" ? value.slice(0, maxLength) : fallback;
}

function sanitizeRule(value: unknown, fallback: NotificationRule): NotificationRule {
  const rule = object(value);
  return {
    enabled: booleanValue(rule.enabled, fallback.enabled),
    channel: enumValue(rule.channel, ["in-app", "desktop", "both"], fallback.channel),
  };
}

function sanitizeStyle(value: unknown): TutorStylePreference | null {
  const style = object(value);
  const id = textValue(style.id, "", 100).trim();
  const name = textValue(style.name, "", 80).trim();
  if (!id || !name) return null;
  return {
    id,
    name,
    tone: textValue(style.tone, "Neutral", 60),
    approach: textValue(style.approach, "Socratic", 80),
    verbosity: numberValue(style.verbosity, 50, 0, 100),
    patience: numberValue(style.patience, 50, 0, 100),
    challenge: numberValue(style.challenge, 50, 0, 100),
    humor: numberValue(style.humor, 20, 0, 100),
    preview: textValue(style.preview, "Let's work through it together.", 1000),
    built: booleanValue(style.built, false),
  };
}

function sanitizeEndpoint(value: unknown): SavedModelEndpoint | null {
  const endpoint = object(value);
  const id = textValue(endpoint.id, "", 100).trim();
  const label = textValue(endpoint.label, "", 120).trim();
  const baseUrl = textValue(endpoint.baseUrl, "", 2000).trim();
  const model = textValue(endpoint.model, "", 300).trim();
  if (!id || !label || !baseUrl || !model) return null;
  return {
    id,
    label,
    provider: enumValue(endpoint.provider, ["openai", "anthropic", "custom"], "custom"),
    baseUrl,
    model,
    keyMasked: textValue(endpoint.keyMasked, "not set", 80),
    active: booleanValue(endpoint.active, false),
  };
}

/** Parse untrusted persisted data and merge it with safe defaults. */
export function sanitizePreferences(value: unknown): StudyusPreferences {
  const root = object(value);
  const appearance = object(root.appearance);
  const notifications = object(root.notifications);
  const events = object(notifications.events);
  const summary = object(notifications.summary);
  const tutor = object(root.tutor);
  const profile = object(root.profile);

  const parsedStyles = Array.isArray(tutor.styles)
    ? tutor.styles.map(sanitizeStyle).filter((style): style is TutorStylePreference => style !== null).slice(0, 30)
    : [];
  const styles = parsedStyles.length > 0 ? parsedStyles : DEFAULT_TUTOR_STYLES.map((style) => ({ ...style }));
  const requestedStyleId = textValue(tutor.activeStyleId, DEFAULT_PREFERENCES.tutor.activeStyleId, 100);
  const activeStyleId = styles.some((style) => style.id === requestedStyleId) ? requestedStyleId : styles[0].id;

  const endpoints = Array.isArray(root.modelEndpoints)
    ? root.modelEndpoints.map(sanitizeEndpoint).filter((endpoint): endpoint is SavedModelEndpoint => endpoint !== null).slice(0, 30)
    : [];
  if (endpoints.length > 0 && !endpoints.some((endpoint) => endpoint.active)) endpoints[0].active = true;
  if (endpoints.filter((endpoint) => endpoint.active).length > 1) {
    let foundActive = false;
    endpoints.forEach((endpoint) => {
      if (endpoint.active && foundActive) endpoint.active = false;
      if (endpoint.active) foundActive = true;
    });
  }

  return {
    appearance: {
      theme: enumValue(appearance.theme, ["system", "dark", "light"], DEFAULT_PREFERENCES.appearance.theme),
      font: enumValue(appearance.font, ["system", "grotesk", "serif", "mono"], DEFAULT_PREFERENCES.appearance.font),
      density: enumValue(appearance.density, ["comfortable", "compact"], DEFAULT_PREFERENCES.appearance.density),
      textSize: numberValue(appearance.textSize, DEFAULT_PREFERENCES.appearance.textSize, 80, 140),
      reducedMotion: booleanValue(appearance.reducedMotion, DEFAULT_PREFERENCES.appearance.reducedMotion),
      highContrast: booleanValue(appearance.highContrast, DEFAULT_PREFERENCES.appearance.highContrast),
      dyslexiaFriendly: booleanValue(appearance.dyslexiaFriendly, DEFAULT_PREFERENCES.appearance.dyslexiaFriendly),
      captions: booleanValue(appearance.captions, DEFAULT_PREFERENCES.appearance.captions),
    },
    notifications: {
      events: {
        testReady: sanitizeRule(events.testReady, DEFAULT_PREFERENCES.notifications.events.testReady),
        sessionComplete: sanitizeRule(events.sessionComplete, DEFAULT_PREFERENCES.notifications.events.sessionComplete),
      },
      summary: {
        cadence: enumValue(summary.cadence, ["off", "daily", "weekly", "monthly"], DEFAULT_PREFERENCES.notifications.summary.cadence),
        channel: enumValue(summary.channel, ["in-app", "desktop", "both"], DEFAULT_PREFERENCES.notifications.summary.channel),
      },
    },
    tutor: {
      styles,
      activeStyleId,
      sessionLength: numberValue(tutor.sessionLength, DEFAULT_PREFERENCES.tutor.sessionLength, 10, 90),
      breakEvery: numberValue(tutor.breakEvery, DEFAULT_PREFERENCES.tutor.breakEvery, 10, 60),
      difficulty: enumValue(tutor.difficulty, ["easier", "adaptive", "harder"], DEFAULT_PREFERENCES.tutor.difficulty),
      voiceReplies: booleanValue(tutor.voiceReplies, DEFAULT_PREFERENCES.tutor.voiceReplies),
      autoNotes: booleanValue(tutor.autoNotes, DEFAULT_PREFERENCES.tutor.autoNotes),
    },
    profile: {
      fullName: textValue(profile.fullName, DEFAULT_PREFERENCES.profile.fullName, 120),
      email: textValue(profile.email, DEFAULT_PREFERENCES.profile.email, 320),
      timezone: textValue(profile.timezone, DEFAULT_PREFERENCES.profile.timezone, 120),
    },
    modelEndpoints: endpoints,
  };
}

export function loadPreferences(): StudyusPreferences {
  if (typeof window === "undefined") return sanitizePreferences(DEFAULT_PREFERENCES);
  try {
    const raw = window.localStorage.getItem(PREFERENCES_STORAGE_KEY);
    return raw ? sanitizePreferences(JSON.parse(raw)) : sanitizePreferences(DEFAULT_PREFERENCES);
  } catch {
    return sanitizePreferences(DEFAULT_PREFERENCES);
  }
}

export function applyAppearancePreferences(appearance: AppearancePreferences): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const systemDark = typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-color-scheme: dark)").matches
    : true;
  const resolvedTheme = appearance.theme === "system" ? (systemDark ? "dark" : "light") : appearance.theme;

  root.dataset.themePreference = appearance.theme;
  root.dataset.theme = resolvedTheme;
  root.dataset.font = appearance.dyslexiaFriendly ? "dyslexic" : appearance.font;
  root.dataset.density = appearance.density;
  root.dataset.motion = appearance.reducedMotion ? "reduced" : "full";
  root.dataset.contrast = appearance.highContrast ? "high" : "normal";
  root.dataset.captions = appearance.captions ? "on" : "off";
  root.style.setProperty("--app-text-scale", String(appearance.textSize / 100));
  root.style.colorScheme = resolvedTheme;
}

export function savePreferences(value: StudyusPreferences): StudyusPreferences {
  const next = sanitizePreferences(value);
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // The preferences still apply for this page even if storage is blocked.
    }
  }
  applyAppearancePreferences(next.appearance);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent<StudyusPreferences>(PREFERENCES_CHANGED_EVENT, { detail: next }));
  }
  return next;
}

/** Apply saved preferences before React paints and keep System theme in sync. */
export function initializePreferences(): () => void {
  const preferences = loadPreferences();
  applyAppearancePreferences(preferences.appearance);
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => undefined;

  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const onSystemThemeChanged = () => {
    const current = loadPreferences();
    if (current.appearance.theme === "system") applyAppearancePreferences(current.appearance);
  };
  media.addEventListener?.("change", onSystemThemeChanged);
  return () => media.removeEventListener?.("change", onSystemThemeChanged);
}

export function buildTutorPreferenceReminder(preferences: TutorPreferences = loadPreferences().tutor): string {
  const style = preferences.styles.find((candidate) => candidate.id === preferences.activeStyleId) ?? preferences.styles[0];
  if (!style) return "";
  return [
    "LEARNER'S SAVED TUTOR PREFERENCES:",
    `- Voice/tone: ${style.name}; tone ${style.tone}; approach ${style.approach}.`,
    `- Response controls (0–100): verbosity ${style.verbosity}, patience ${style.patience}, challenge ${style.challenge}, humor ${style.humor}.`,
    `- Practice difficulty preference: ${preferences.difficulty}. Treat this as a real calibration target while preserving curriculum correctness and assistance-policy limits.`,
    `- Preferred session length: ${preferences.sessionLength} minutes; suggest a short break after about ${preferences.breakEvery} minutes when relevant.`,
  ].join("\n");
}
