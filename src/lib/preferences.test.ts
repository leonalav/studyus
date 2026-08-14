import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_PREFERENCES,
  MAX_TUTOR_VERSIONS,
  applyAppearancePreferences,
  buildTutorPreferenceReminder,
  sanitizePreferences,
} from "./preferences";
import { cadenceMilliseconds } from "./notifications";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("persisted Studyus preferences", () => {
  it("defaults board-reverts-with-message on, and round-trips the learner's choice", () => {
    // Default on: a transcript and a board that disagree about what has been
    // taught is the more confusing state.
    expect(sanitizePreferences({}).appearance.boardRevertsWithMessage).toBe(true);
    expect(
      sanitizePreferences({ appearance: { boardRevertsWithMessage: false } }).appearance.boardRevertsWithMessage
    ).toBe(false);
    // Junk falls back to the default rather than throwing or disabling revert.
    expect(
      sanitizePreferences({ appearance: { boardRevertsWithMessage: "no" } }).appearance.boardRevertsWithMessage
    ).toBe(true);
  });

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
      boardRevertsWithMessage: true,
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
    expect(parsed.tutor.schemaVersion).toBe(2);
    expect(parsed.tutor.identity.name).toBe(DEFAULT_PREFERENCES.tutor.identity.name);
    expect(parsed.tutor.sessionLength).toBe(10);
    expect(parsed.tutor.breakEvery).toBe(60);
    expect(parsed.tutor.difficulty).toBe("adaptive");
    // The three app-provided models are part of the product, not a user
    // setting, so they are seeded even from an empty/garbage blob.
    expect(parsed.modelEndpoints.map((endpoint) => endpoint.id)).toEqual([
      "studyus-model-1",
      "studyus-model-2",
      "studyus-model-3",
    ]);
    expect(parsed.modelEndpoints.every((endpoint) => endpoint.provider === "studyus")).toBe(true);
  });

  it("preserves the original Inter font and honest email channel choices", () => {
    const parsed = sanitizePreferences({
      appearance: { font: "inter" },
      notifications: {
        events: { testReady: { enabled: true, channel: "email" } },
        summary: { cadence: "daily", channel: "email" },
      },
    });

    expect(parsed.appearance.font).toBe("inter");
    expect(parsed.notifications.events.testReady).toEqual({ enabled: true, channel: "email" });
    expect(parsed.notifications.summary).toEqual({ cadence: "daily", channel: "email" });
  });

  it("sanitizes Tutor Studio policy, numeric enums, tool gates, and runtime bounds", () => {
    const parsed = sanitizePreferences({
      tutor: {
        memory: { minimumEvidence: 3, retentionDays: 90 },
        tools: { geometry: false, diagrams: false, madeUpTool: true },
        privacy: { allowCurriculumInPrompts: false, allowImageDataInPrompts: false, allowFileDataInPrompts: false },
        advanced: { temperature: 999, maxResponseTokens: 12, requestTimeoutSeconds: 500 },
        versions: Array.from({ length: MAX_TUTOR_VERSIONS + 2 }, (_, index) => ({
          id: `v${index}`,
          label: `Version ${index}`,
          createdAt: "2026-08-12T00:00:00.000Z",
          serializedDefinition: "{}",
        })),
      },
    }).tutor;

    expect(parsed.memory).toMatchObject({ minimumEvidence: 3, retentionDays: 90 });
    expect(parsed.tools.geometry).toBe(false);
    expect(parsed.tools.diagrams).toBe(false);
    expect(parsed.tools).not.toHaveProperty("madeUpTool");
    expect(parsed.privacy.allowCurriculumInPrompts).toBe(false);
    expect(parsed.privacy.allowImageDataInPrompts).toBe(false);
    expect(parsed.privacy.allowFileDataInPrompts).toBe(false);
    expect(parsed.tools.fileProcessing).toBe(true);
    expect(parsed.versions).toHaveLength(MAX_TUTOR_VERSIONS);
    expect(parsed.advanced).toMatchObject({
      temperature: 100,
      maxResponseTokens: 512,
      requestTimeoutSeconds: 180,
    });
    expect(sanitizePreferences({ tutor: { memory: { minimumEvidence: 2.6 } } }).tutor.memory.minimumEvidence)
      .toBe(DEFAULT_PREFERENCES.tutor.memory.minimumEvidence);
    expect(sanitizePreferences({ tutor: { advanced: { requestTimeoutSeconds: 60 } } }).tutor.advanced.requestTimeoutSeconds)
      .toBe(180);
  });

  it("compiles constitution, privacy-aware memory, and disabled tools into agent policy", () => {
    const tutor = sanitizePreferences({
      tutor: {
        constitution: { hardRules: ["Always define notation before using it."] },
        memory: { mode: "persistent", includeInPrompt: true },
        privacy: { allowLearnerModelInPrompts: false },
        tools: { geometry: false },
        assessment: { rubricInstructions: "Award method credit when the setup is valid." },
        advanced: { requestTimeoutSeconds: 75 },
      },
    }).tutor;
    const reminder = buildTutorPreferenceReminder(tutor);

    expect(reminder).toContain("Always define notation before using it.");
    expect(reminder).toContain("learner-model context withheld");
    expect(reminder).toContain("Disabled geometry");
    expect(reminder).toContain("Award method credit when the setup is valid.");
    expect(reminder).toContain("75-second request timeout");
  });

  it("keeps one active endpoint and never stores unknown endpoint fields", () => {
    const parsed = sanitizePreferences({
      modelEndpoints: [
        { id: "a", label: "A", provider: "openai", baseUrl: "https://a.test/v1", model: "gpt-4o", keyMasked: "••••1234", active: true, apiKey: "secret" },
        { id: "b", label: "B", provider: "custom", baseUrl: "https://b.test/v1", model: "b", keyMasked: "not set", active: true, vision: false },
      ],
    });

    const custom = parsed.modelEndpoints.filter((endpoint) => endpoint.provider !== "studyus");
    expect(parsed.modelEndpoints.filter((endpoint) => endpoint.active)).toHaveLength(1);
    expect(custom[0]).not.toHaveProperty("apiKey");
    expect(custom[0].vision).toBe(true);
    expect(custom[1].vision).toBe(false);
    // Seeding app models must never drop what the learner saved.
    expect(custom.map((endpoint) => endpoint.id)).toEqual(["a", "b"]);
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
    expect(reminder).toContain("verbosity 72/100");
    expect(reminder).toContain("DIFFICULTY: harder");
    expect(reminder).toContain("target 45 minutes");
    expect(reminder).toContain("break after about 15 minutes");
    expect(reminder).toContain("Auto-notes are enabled");
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
