import { describe, it, expect } from "vitest";
import {
  STUDYUS_MODELS,
  ensureStudyusModels,
  formatCredits,
  studyusModelSpec,
  toSavedEndpoint,
} from "./studyusModels";
import type { SavedModelEndpoint } from "./preferences";

const custom = (id: string, active = false): SavedModelEndpoint => ({
  id,
  label: id,
  provider: "custom",
  baseUrl: "https://local.test/v1",
  model: "llama",
  keyMasked: "not set",
  active,
  vision: false,
});

describe("the three app-provided models", () => {
  it("ships exactly the three named tiers at the stated credit prices", () => {
    expect(STUDYUS_MODELS.map((model) => [model.id, model.credits])).toEqual([
      ["studyus-model-1", 0.25],
      ["studyus-model-2", 0.5],
      ["studyus-model-3", 1],
    ]);
  });

  it("pluralises credits correctly", () => {
    expect(formatCredits(0.25)).toBe("0.25 credits");
    expect(formatCredits(1)).toBe("1 credit");
  });

  it("never exposes a learner-suppliable key", () => {
    // These are billed in credits and routed by Studyus. A key field the
    // learner must leave blank reads as a broken form.
    for (const spec of STUDYUS_MODELS) {
      expect(toSavedEndpoint(spec, false).keyMasked).toBe("managed");
    }
  });

  it("marks them with the studyus provider so the UI can hide the routing", () => {
    for (const spec of STUDYUS_MODELS) {
      expect(toSavedEndpoint(spec, false).provider).toBe("studyus");
    }
  });

  it("still carries a real model id and base url for binding", () => {
    // Hidden in the UI, but the call path is identical to a custom endpoint —
    // an empty value here would fail resolveRoleEndpoint at run time.
    for (const spec of STUDYUS_MODELS) {
      const endpoint = toSavedEndpoint(spec, false);
      expect(endpoint.model.length).toBeGreaterThan(0);
      expect(endpoint.baseUrl).toMatch(/^https:\/\//);
    }
  });
});

describe("seeding app models into saved preferences", () => {
  it("adds all three to an empty install and activates the balanced tier", () => {
    // Not the cheapest: a first impression made by the weakest model is a bad
    // trade for a fraction of a credit.
    const seeded = ensureStudyusModels([]);
    expect(seeded).toHaveLength(3);
    expect(seeded.find((endpoint) => endpoint.active)?.id).toBe("studyus-model-2");
  });

  it("is idempotent", () => {
    const once = ensureStudyusModels([]);
    expect(ensureStudyusModels(once)).toEqual(once);
  });

  it("keeps the learner's custom endpoints", () => {
    const seeded = ensureStudyusModels([custom("mine")]);
    expect(seeded.map((endpoint) => endpoint.id)).toContain("mine");
    expect(seeded).toHaveLength(4);
  });

  it("does not steal an active flag from a custom endpoint", () => {
    const seeded = ensureStudyusModels([custom("mine", true)]);
    const active = seeded.filter((endpoint) => endpoint.active);
    expect(active.map((endpoint) => endpoint.id)).toEqual(["mine"]);
  });

  it("preserves which app model the learner activated", () => {
    const seeded = ensureStudyusModels([]).map((endpoint) =>
      endpoint.id === "studyus-model-3" ? { ...endpoint, active: true } : { ...endpoint, active: false }
    );
    const again = ensureStudyusModels(seeded);
    expect(again.find((endpoint) => endpoint.active)?.id).toBe("studyus-model-3");
  });

  it("re-syncs routing fields so a tier can be repointed in a later release", () => {
    const stale = ensureStudyusModels([]).map((endpoint) =>
      endpoint.id === "studyus-model-1" ? { ...endpoint, model: "old/model", baseUrl: "https://old.test/v1" } : endpoint
    );
    const fresh = ensureStudyusModels(stale).find((endpoint) => endpoint.id === "studyus-model-1")!;
    expect(fresh.model).toBe(studyusModelSpec("studyus-model-1")!.model);
    expect(fresh.baseUrl).toBe(studyusModelSpec("studyus-model-1")!.baseUrl);
  });

  it("drops a stale app model that no longer ships", () => {
    const removed = ensureStudyusModels([
      { ...custom("studyus-model-legacy"), provider: "studyus" },
    ]);
    expect(removed.map((endpoint) => endpoint.id)).not.toContain("studyus-model-legacy");
  });
});
