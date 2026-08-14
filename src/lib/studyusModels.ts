/**
 * App-provided models.
 *
 * These are billed in credits and served through Studyus rather than the
 * learner's own account. Mechanically they are ordinary OpenAI-compatible
 * endpoints — they bind to roles and get called exactly like a custom endpoint,
 * which is the whole point: no second code path to keep correct.
 *
 * What differs is disclosure. The underlying model identifier and the API key
 * are Studyus's, not the learner's:
 *
 *  - Showing the model id would leak which vendor sits behind each tier and let
 *    a learner replicate it directly, which is the product.
 *  - Showing the key field implies the learner supplies one. They do not, and a
 *    key box they must leave blank reads as a broken form.
 *
 * So `SettingsModal` hides both for `provider === "studyus"` and renders the
 * credit cost instead. The values still travel to `bindModelRole` untouched.
 */

import type { SavedModelEndpoint } from "./preferences";

export interface StudyusModelSpec {
  id: string;
  /** Learner-facing name. Deliberately opaque about the vendor. */
  label: string;
  /** Credits consumed per request. */
  credits: number;
  /** One line on when to reach for this tier. */
  blurb: string;
  vision: boolean;
  /** Routed identifier. Never rendered in the UI. */
  model: string;
  baseUrl: string;
}

/** Credit cost is the only thing that distinguishes these tiers to the learner. */
export const STUDYUS_MODELS: StudyusModelSpec[] = [
  {
    id: "studyus-model-1",
    label: "studyus-model-1",
    credits: 0.25,
    blurb: "Fastest and cheapest. Good for drilling, recall and short answers.",
    vision: false,
    model: "studyus/tier-1",
    baseUrl: "https://api.studyus.app/v1",
  },
  {
    id: "studyus-model-2",
    label: "studyus-model-2",
    credits: 0.5,
    blurb: "Balanced. The default for ordinary tutoring and board work.",
    vision: true,
    model: "studyus/tier-2",
    baseUrl: "https://api.studyus.app/v1",
  },
  {
    id: "studyus-model-3",
    label: "studyus-model-3",
    credits: 1,
    blurb: "Deepest reasoning. Use it for proofs, transfer tasks and marking.",
    vision: true,
    model: "studyus/tier-3",
    baseUrl: "https://api.studyus.app/v1",
  },
];

/** Formatted credit cost, e.g. "0.25 credits" / "1 credit". */
export function formatCredits(credits: number): string {
  return `${credits} ${credits === 1 ? "credit" : "credits"}`;
}

export function studyusModelSpec(id: string): StudyusModelSpec | undefined {
  return STUDYUS_MODELS.find((model) => model.id === id);
}

/** The saved-endpoint form of an app model. */
export function toSavedEndpoint(spec: StudyusModelSpec, active: boolean): SavedModelEndpoint {
  return {
    id: spec.id,
    label: spec.label,
    provider: "studyus",
    baseUrl: spec.baseUrl,
    model: spec.model,
    // Managed by Studyus. Never a learner-entered value, and never displayed.
    keyMasked: "managed",
    active,
    vision: spec.vision,
  };
}

/**
 * Ensure the three app models exist in the saved endpoint list.
 *
 * Idempotent, and it re-syncs the routing fields of models the learner already
 * has, so changing a tier's underlying model in a later release reaches existing
 * installs. Their `active` flag is preserved — that is the learner's choice, not
 * ours. Custom endpoints are passed through untouched.
 */
export function ensureStudyusModels(saved: SavedModelEndpoint[]): SavedModelEndpoint[] {
  const custom = saved.filter((endpoint) => endpoint.provider !== "studyus");
  const anyActive = saved.some((endpoint) => endpoint.active);

  const app = STUDYUS_MODELS.map((spec, index) => {
    const existing = saved.find(
      (endpoint) => endpoint.provider === "studyus" && endpoint.id === spec.id
    );
    // With nothing active at all, default to the balanced tier rather than the
    // cheapest: a first impression made by the weakest model is a bad trade.
    const fallbackActive = !anyActive && index === 1;
    return toSavedEndpoint(spec, existing?.active ?? fallbackActive);
  });

  return [...app, ...custom];
}
