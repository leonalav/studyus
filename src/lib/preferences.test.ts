import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_PREFERENCES,
  applyAppearancePreferences,
  buildTutorPreferenceReminder,
  sanitizePreferences,
} from "./preferences";
import { cadenceMilliseconds } from "./notifications";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("persisted Studyus preferences", () => {
  it("applies every appearance control to global document state", () => {
    const dataset: Record<string, string> = {};
    const properties = new Map<string, string>();
    const style = {
      colorScheme: "",
      setProperty: (name: string, value: string) => properties.set(name, value),
    };
    vi.stubGlobal("document", { documentElement: { dataset, style } });
    vi.stubGlobal("window", { matchMedia: () => ({ matches: false }) });

    applyAppearancePreferences({
      theme: "system",
      font: "serif",
      density: "compact",
      textSize: 125,
      reducedMotion: true,
      highContrast: true,
      dyslexiaFriendly: true,
      captions: false,
    });

    expect(dataset).toMatchObject({
      themePreference: "system",
      theme: "light",
      font: "dyslexic",
      density: "compact",
      motion: "reduced",
      contrast: "high",
      captions: "off",
    });
    expect(style.colorScheme).toBe("light");
    expect(properties.get("--app-text-scale")).toBe("1.25");
  });

  it("fails closed to defaults and clamps untrusted values", () => {
    const parsed = sanitizePreferences({
      appearance: {
        theme: "neon",
        font: "downloaded-font",
        density: "tiny",
        textSize: 999,
        reducedMotion: "yes",
        highContrast: true,
      },
      notifications: {
        events: {
          testReady: { enabled: false, channel: "carrier-pigeon" },
          sessionComplete: { enabled: true, channel: "both" },
        },
        summary: { cadence: "hourly", channel: "desktop" },
      },
      tutor: {
        styles: [{ id: "", name: "invalid" }],
        sessionLength: 3,
        breakEvery: 900,
        difficulty: "impossible",
      },
      modelEndpoints: [
        { id: "bad", label: "Missing model", baseUrl: "https://example.test" },
      ],
    });

    expect(parsed.appearance.theme).toBe(DEFAULT_PREFERENCES.appearance.theme);
    expect(parsed.appearance.font).toBe(DEFAULT_PREFERENCES.appearance.font);
    expect(parsed.appearance.density).toBe(DEFAULT_PREFERENCES.appearance.density);
    expect(parsed.appearance.textSize).toBe(140);
    expect(parsed.appearance.reducedMotion).toBe(false);
    expect(parsed.appearance.highContrast).toBe(true);
    expect(parsed.notifications.events.testReady).toEqual({ enabled: false, channel: "in-app" });
    expect(parsed.notifications.events.sessionComplete).toEqual({ enabled: true, channel: "both" });
    expect(parsed.notifications.summary).toEqual({ cadence: "weekly", channel: "desktop" });
    expect(parsed.tutor.styles).toHaveLength(DEFAULT_PREFERENCES.tutor.styles.length);
    expect(parsed.tutor.sessionLength).toBe(10);
    expect(parsed.tutor.breakEvery).toBe(60);
    expect(parsed.tutor.difficulty).toBe("adaptive");
    expect(parsed.modelEndpoints).toEqual([]);
  });

  it("keeps one active endpoint and never stores unknown endpoint fields", () => {
    const parsed = sanitizePreferences({
      modelEndpoints: [
        { id: "a", label: "A", provider: "openai", baseUrl: "https://a.test/v1", model: "a", keyMasked: "••••1234", active: true, apiKey: "secret" },
        { id: "b", label: "B", provider: "custom", baseUrl: "https://b.test/v1", model: "b", keyMasked: "not set", active: true },
      ],
    });

    expect(parsed.modelEndpoints.filter((endpoint) => endpoint.active)).toHaveLength(1);
    expect(parsed.modelEndpoints[0]).not.toHaveProperty("apiKey");
  });

  it("builds a concrete tutor-agent reminder from the active saved style", () => {
    const preferences = sanitizePreferences({
      tutor: {
        styles: [{
          id: "careful",
          name: "Careful coach",
          tone: "Encouraging",
          approach: "Worked example",
          verbosity: 72,
          patience: 95,
          challenge: 60,
          humor: 10,
          preview: "Preview",
        }],
        activeStyleId: "careful",
        sessionLength: 45,
        breakEvery: 15,
        difficulty: "harder",
      },
    }).tutor;

    const reminder = buildTutorPreferenceReminder(preferences);
    expect(reminder).toContain("Careful coach");
    expect(reminder).toContain("verbosity 72");
    expect(reminder).toContain("difficulty preference: harder");
    expect(reminder).toContain("45 minutes");
    expect(reminder).toContain("15 minutes");
  });
});

describe("notification summary cadence", () => {
  it("maps only supported schedules to bounded intervals", () => {
    expect(cadenceMilliseconds("off")).toBeNull();
    expect(cadenceMilliseconds("daily")).toBe(86_400_000);
    expect(cadenceMilliseconds("weekly")).toBe(604_800_000);
    expect(cadenceMilliseconds("monthly")).toBe(2_592_000_000);
  });
});
