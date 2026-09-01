/**
 * Effort Parameter — controls how in-depth the study plan and overview are.
 *
 * Five levels: Auto, Standard, High, Extra High, Max. Auto resolves to one of
 * the four explicit levels at the tutor harness based on the concept and the
 * learner's intake answers. The four explicit levels map to concrete
 * plan/curriculum constraints via EFFORT_PLAN_CONSTRAINTS.
 *
 * Placement (v1): the SessionCard footer on the hero page. State is local to
 * the SessionCard and threaded into the greeting turn via the onPrepare
 * callback. Auto is the default for first-time learners; explicit selections
 * persist for the duration of the session only.
 */

import type { OnboardingAnswers } from "../data/tutor";

export type EffortParameter = "auto" | "standard" | "high" | "extra_high" | "max";

export type ExplicitEffort = Exclude<EffortParameter, "auto">;

export type CurriculumDepth = "surface" | "medium" | "deep" | "exhaustive";

export interface EffortConstraints {
  minSteps: number;
  maxSteps: number;
  includePrerequisites: boolean;
  includeTimeEstimates: boolean;
  includeSuccessCriteria: boolean;
  includePitfalls: boolean;
  includeSubActivities: boolean;
  curriculumDepth: CurriculumDepth;
  /**
   * Split of maxResponseTokens between the parallel plan agent and the
   * parallel overview agent. Each value is in [0, 1] and the pair sums to 1.
   * At higher effort, the plan widget grows linearly with sub-activities,
   * time estimates, success criteria, and pitfalls while the overview has
   * hard schema caps — so the split skews in favor of the plan.
   *
   * Custom-endpoint note: the bound endpoint's advertised `maxTokens`
   * governs the actual ceiling. Custom endpoints vary widely (Ollama
   * defaults 2048, LM Studio 4096, self-hosted vLLM 8192+); at "max" effort
   * with a 2048-token budget the plan agent would receive only ~1430 tokens
   * and produce a truncated widget. The runtime trusts whatever the endpoint
   * advertises — there is no clamp here. Endpoints too small for the chosen
   * effort should surface a schema_invalid failure rather than be silently
   * truncated, so the learner sees a real failure and can drop an effort
   * level.
   */
  tokenSplit: { plan: number; overview: number };
}

export interface EffortLevelMeta {
  id: EffortParameter;
  label: string;
  desc: string;
}

export const EFFORT_LEVELS: EffortLevelMeta[] = [
  {
    id: "auto",
    label: "Auto",
    desc: "Adapts to the concept and your intake answers",
  },
  {
    id: "standard",
    label: "Standard",
    desc: "2–4 concise phases; surface-level overview",
  },
  {
    id: "high",
    label: "High",
    desc: "4–6 phases with time estimates and success criteria",
  },
  {
    id: "extra_high",
    label: "Extra High",
    desc: "6–8 phases with prerequisites, pitfalls, sub-activities",
  },
  {
    id: "max",
    label: "Max",
    desc: "8–12 detailed phases; exhaustive curriculum scope",
  },
];

export const EFFORT_PLAN_CONSTRAINTS: Record<ExplicitEffort, EffortConstraints> = {
  standard: {
    minSteps: 2,
    maxSteps: 4,
    includePrerequisites: false,
    includeTimeEstimates: false,
    includeSuccessCriteria: false,
    includePitfalls: false,
    includeSubActivities: false,
    curriculumDepth: "surface",
    tokenSplit: { plan: 0.5, overview: 0.5 },
  },
  high: {
    minSteps: 4,
    maxSteps: 6,
    includePrerequisites: false,
    includeTimeEstimates: true,
    includeSuccessCriteria: true,
    includePitfalls: false,
    includeSubActivities: false,
    curriculumDepth: "medium",
    tokenSplit: { plan: 0.55, overview: 0.45 },
  },
  extra_high: {
    minSteps: 6,
    maxSteps: 8,
    includePrerequisites: true,
    includeTimeEstimates: true,
    includeSuccessCriteria: true,
    includePitfalls: true,
    includeSubActivities: true,
    curriculumDepth: "deep",
    tokenSplit: { plan: 0.65, overview: 0.35 },
  },
  max: {
    minSteps: 8,
    maxSteps: 12,
    includePrerequisites: true,
    includeTimeEstimates: true,
    includeSuccessCriteria: true,
    includePitfalls: true,
    includeSubActivities: true,
    curriculumDepth: "exhaustive",
    tokenSplit: { plan: 0.7, overview: 0.3 },
  },
};

/**
 * Resolve the Auto choice to an explicit level. The heuristic is deliberately
 * conservative: when in doubt, return "high" so the learner gets a substantive
 * plan rather than a 2-step summary that hides depth.
 *
 * - No intake answers → "high" (we have no signal, so don't undershoot)
 * - Broad concept + no familiarity → "extra_high"
 * - Broad concept + some familiarity → "high"
 * - Narrow concept + no familiarity → "high"
 * - Narrow concept + some familiarity → "standard"
 * - Intake includes an explicit goal → "high"
 */
export function resolveAutoEffort(
  concept: string | undefined,
  onboarding: OnboardingAnswers | undefined
): ExplicitEffort {
  if (!onboarding) return "high";

  const broad = (concept?.length ?? 0) > 30;
  const selfReported = String(onboarding.selfReportedFamiliarity ?? "").toLowerCase();
  const noFamiliarity =
    selfReported.includes("never") ||
    selfReported.includes("new") ||
    selfReported === "";
  const hasGoal = (onboarding.concept ?? "").length > 0;

  if (broad && noFamiliarity) return "extra_high";
  if (broad && !noFamiliarity) return "high";
  if (!broad && !noFamiliarity) return "standard";
  if (hasGoal) return "high";
  return "high";
}

/** Look up the constraint table for an explicit effort level. */
export function effortConstraintsFor(effort: ExplicitEffort): EffortConstraints {
  return EFFORT_PLAN_CONSTRAINTS[effort];
}

/** Resolve a raw EffortParameter (which may be "auto") to its explicit level. */
export function resolveEffort(
  raw: EffortParameter | undefined,
  concept: string | undefined,
  onboarding: OnboardingAnswers | undefined
): ExplicitEffort {
  if (!raw || raw === "auto") return resolveAutoEffort(concept, onboarding);
  return raw;
}

/**
 * Render the effort level as a short reminder block for the tutor's system
 * prompt. The phrasing is deliberately directive: the constraint table is the
 * contract the tutor builds the plan and overview against, and the wording
 * names the specific structural elements so the model cannot mistake "include
 * time estimates" for "mention time in passing".
 *
 * Phase 0 calls this on every turn (placed in the system prompt so it
 * survives history truncation). Phase 4 will also pass the `EffortConstraints`
 * object directly into the plan/overview validators, so this reminder is
 * guidance for prose and the validator is the authority on schema.
 */
export function formatEffortReminder(effort: ExplicitEffort): string {
  const cfg = EFFORT_PLAN_CONSTRAINTS[effort];
  const lines: string[] = [`EFFORT LEVEL: ${effort.toUpperCase()}`];
  lines.push(`Plan: ${cfg.minSteps}–${cfg.maxSteps} phases (must be in this range).`);
  lines.push(`Curriculum overview depth: ${cfg.curriculumDepth}.`);
  const include: string[] = [];
  if (cfg.includePrerequisites) include.push("prerequisite identification in plan");
  if (cfg.includeTimeEstimates) include.push("time estimate as the FIRST detail item of every plan step");
  if (cfg.includeSuccessCriteria) include.push("success criterion as the LAST detail item of every plan step");
  if (cfg.includePitfalls) include.push("a common pitfall as an intermediate detail item");
  if (cfg.includeSubActivities) include.push("2–4 sub-activities per plan step (more details[] entries)");
  if (include.length > 0) {
    lines.push(`MUST include: ${include.join("; ")}.`);
  } else {
    lines.push("Standard structural items only — do not pad with extra sections.");
  }
  lines.push("Do NOT exceed the step range to look thorough. A short plan that hits every criterion is better than a longer plan that dilutes them.");
  return lines.join("\n");
}
