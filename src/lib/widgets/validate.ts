/**
 * Structural validation for study-widget intents.
 *
 * Mirrors `lib/visualization/validate.ts`: bounds only, no rendering logic, and
 * fail-closed. An invalid widget is rejected with a reason the agent's repair
 * loop can act on — it is never silently coerced into a half-configured card,
 * because a half-configured teaching widget teaches the wrong thing.
 */

import {
  WIDGET_KINDS,
  type WidgetIntent,
  type WidgetKind,
  type QuestionOption,
  type QuestionFormat,
  type WidgetState,
  type MasteryEvidence,
  type SceneAccent,
  type SceneLineStyle,
} from "./types";
import {
  FIGURE_KINDS,
  COORD_MAX,
  MAX_FIGURE_EXPRESSION,
  MAX_FIGURE_DECLARED,
} from "../figureSpec/types";
import { devLog } from "../devLog";
import type { EffortConstraints } from "../effort";

/* ── Safety bounds ── */

export const MAX_TEXT_LENGTH = 600;
export const MAX_SHORT_TEXT_LENGTH = 160;
export const MAX_LATEX_LENGTH = 1000;
export const MAX_LIST_ITEMS = 12;
export const MAX_ROADMAP_STEPS = 16;
export const MAX_OPTIONS = 6;
export const MAX_COLUMNS = 4;
export const MAX_ROWS = 12;
export const MAX_STEPS = 12;
export const MAX_FRAMES = 12;
export const MAX_MARKS = 8;
export const MAX_READOUTS = 4;
export const MAX_EXPRESSION_LENGTH = 200;
export const MAX_ID_LENGTH = 64;
/** Upper bound on the scene element list. A scene is a figure, not a document;
 *  past this many primitives it has stopped being something a learner reads as
 *  one picture. */
export const MAX_SCENE_ELEMENTS = 24;
/** Upper bound on a literal `rects.count`. An expression in `t` can still
 *  produce a larger N at render time; the renderer clamps to this same ceiling. */
export const MAX_RECTS = 60;

const SCENE_ELEMENT_KINDS = ["curve", "point", "segment", "rects", "region", "arrow", "label"] as const;
const SCENE_ACCENTS: readonly SceneAccent[] = ["chalk", "accent", "amber", "cyan", "violet", "ember", "green", "red"];
const SCENE_LINE_STYLES: readonly SceneLineStyle[] = ["solid", "dashed", "dotted"];
/** Upper bound on a declared cluster size. A cluster gates the tutor signal, so
 *  an absurd size would silence the tutor for the rest of the session. */
export const MAX_CLUSTER_SIZE = 8;
const NUMBER_MIN = -1e9;
const NUMBER_MAX = 1e9;

export type ValidationResult =
  | { valid: true }
  | { valid: false; reason: string };

const ok: ValidationResult = { valid: true };
const fail = (reason: string): ValidationResult => ({ valid: false, reason });

/* ── Primitives ── */

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function text(value: unknown, max = MAX_TEXT_LENGTH): boolean {
  return typeof value === "string" && value.trim().length > 0 && value.length <= max;
}

function optionalText(value: unknown, max = MAX_TEXT_LENGTH): boolean {
  return value === undefined || value === null || text(value, max);
}

function optionalLatex(value: unknown): boolean {
  return value === undefined || value === null || text(value, MAX_LATEX_LENGTH);
}

function identifier(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0 && value.length <= MAX_ID_LENGTH;
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= NUMBER_MIN && value <= NUMBER_MAX;
}

function optionalBoolean(value: unknown): boolean {
  return value === undefined || value === null || typeof value === "boolean";
}

function stringList(value: unknown, maxItems = MAX_LIST_ITEMS, maxLength = MAX_TEXT_LENGTH): boolean {
  if (value === undefined || value === null) return true;
  if (!Array.isArray(value) || value.length > maxItems) return false;
  return value.every((item) => text(item, maxLength));
}

function requiredList(value: unknown, maxItems: number): unknown[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > maxItems) return null;
  return value;
}

/**
 * Expressions are evaluated by a bounded math evaluator at render time. This
 * check is the structural gate: length, character set, and no assignment or
 * function-definition syntax that could smuggle in state.
 */
function safeExpression(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_EXPRESSION_LENGTH) return false;
  if (/[=;{}[\]$#@`\\]/.test(trimmed)) return false;
  return /^[A-Za-z0-9_+\-*/^%.,()<>!|&:? \t]+$/.test(trimmed);
}

function optionalSafeExpression(value: unknown): boolean {
  return value === undefined || value === null || safeExpression(value);
}

function uniqueIds(items: unknown[], path: string): ValidationResult {
  const seen = new Set<string>();
  for (const item of items) {
    if (!isPlainObject(item)) return fail(`${path} entries must be objects`);
    if (!identifier(item.id)) return fail(`${path} entries need a non-empty id (max ${MAX_ID_LENGTH} chars)`);
    const id = String(item.id);
    if (seen.has(id)) return fail(`${path} contains duplicate id "${id}"`);
    seen.add(id);
  }
  return ok;
}

function validateBase(intent: Record<string, unknown>): ValidationResult {
  if (intent.id !== undefined && intent.id !== null && !identifier(intent.id)) {
    return fail(`Widget id must be a non-empty string of at most ${MAX_ID_LENGTH} characters`);
  }
  if (!optionalText(intent.title, MAX_SHORT_TEXT_LENGTH)) return fail("Widget title is empty or too long");
  if (!optionalText(intent.tag, 40)) return fail("Widget tag is empty or too long");
  if (!optionalText(intent.note, MAX_TEXT_LENGTH)) return fail("Widget note is empty or too long");
  return validateGroup(intent.group);
}

/**
 * Cluster membership.
 *
 * `size` is bounded by MAX_CLUSTER_SIZE because it gates the tutor signal: an
 * agent that declares a 500-widget cluster would silence the tutor for the rest
 * of the session, since the cluster could never complete.
 */
function validateGroup(value: unknown): ValidationResult {
  if (value === undefined || value === null) return ok;
  if (!isPlainObject(value)) return fail("Widget group must be an object");
  if (!identifier(value.id)) {
    return fail(`Widget group needs an id of at most ${MAX_ID_LENGTH} characters`);
  }
  if (!optionalText(value.label, MAX_SHORT_TEXT_LENGTH)) return fail("Widget group label is empty or too long");
  if (value.size !== undefined && value.size !== null) {
    if (!Number.isInteger(value.size) || (value.size as number) < 1) {
      return fail("Widget group size must be a positive whole number");
    }
    if ((value.size as number) > MAX_CLUSTER_SIZE) {
      return fail(`Widget group size cannot exceed ${MAX_CLUSTER_SIZE}`);
    }
  }
  return ok;
}

/* ── Main entry point ── */

export function validateWidgetIntent(intent: unknown, effortConfig?: EffortConstraints): ValidationResult {
  if (!isPlainObject(intent)) return fail("Widget intent must be an object");

  const kind = intent.kind;
  if (typeof kind !== "string") return fail("Widget intent must have a string 'kind' field");
  if (!(WIDGET_KINDS as readonly string[]).includes(kind)) {
    return fail(
      `Unknown widget kind: ${kind}. Valid kinds: ${WIDGET_KINDS.join(", ")}. ` +
      `Graphs, geometry figures, and standalone equations are not widgets — emit them with the visualize operation instead.`
    );
  }

  const base = validateBase(intent);
  if (!base.valid) return base;

  switch (kind as WidgetKind) {
    case "roadmap": return validateRoadmap(intent);
    case "plan": return validatePlan(intent, effortConfig);
    case "overview": return validateOverview(intent);
    case "concept_card": return validateConceptCard(intent);
    case "slider": return validateSlider(intent);
    case "animation": return validateAnimation(intent);
    case "comparison": return validateComparison(intent);
    case "question": return validateQuestion(intent, "question");
    case "hint": return validateHint(intent);
    case "scratchpad": return validateScratchpad(intent);
    case "annotation": return validateAnnotation(intent);
    case "reveal": return validateReveal(intent);
    case "example": return validateExample(intent);
    case "mistake_check": return validateMistakeCheck(intent);
    case "memory_hook": return validateMemoryHook(intent);
    case "retrieval_check": return validateRetrievalCheck(intent);
    case "challenge": return validateChallenge(intent);
    case "reflection": return validateReflection(intent);
    case "mastery_card": return validateMasteryCard(intent);
    case "figure_spec": return validateFigureSpec(intent);
  }
}

/** Narrowing helper for call sites that have already validated. */
export function isWidgetIntent(value: unknown): value is WidgetIntent {
  return validateWidgetIntent(value).valid;
}

/* ── Per-widget validators ── */

function validateRoadmap(intent: Record<string, unknown>): ValidationResult {
  if (!optionalText(intent.heading, MAX_SHORT_TEXT_LENGTH)) return fail("Roadmap heading is empty or too long");
  const steps = requiredList(intent.steps, MAX_ROADMAP_STEPS);
  if (!steps) return fail(`Roadmap needs 1–${MAX_ROADMAP_STEPS} steps`);
  const ids = uniqueIds(steps, "roadmap.steps");
  if (!ids.valid) return ids;
  let currentCount = 0;
  for (const step of steps as Record<string, unknown>[]) {
    if (!text(step.label, MAX_SHORT_TEXT_LENGTH)) return fail("Each roadmap step needs a label");
    if (!optionalText(step.detail, MAX_TEXT_LENGTH)) return fail("Roadmap step detail is too long");
    if (step.state !== undefined && step.state !== null) {
      if (!["done", "current", "upcoming"].includes(String(step.state))) {
        return fail("Roadmap step state must be done, current, or upcoming");
      }
      if (step.state === "current") currentCount += 1;
    }
  }
  if (currentCount > 1) return fail("A roadmap may mark at most one step as current");
  return ok;
}

/** Plan bounds: a plan with one phase is a sentence, not a route. The hard
 *  upper bound here is the maximum across all effort levels; per-level caps
 *  come from `EffortConstraints.maxSteps` and are checked below. */
const MAX_PLAN_STEPS_ABSOLUTE = 12;
const MIN_PLAN_STEPS_ABSOLUTE = 2;
const MAX_PLAN_STEP_DETAILS = 4;
const TIME_ESTIMATE_PATTERN = /\b\d+\s*(?:min|minute|minutes|hour|hours|hr|h|day|days|week|weeks)\b/i;
const SUCCESS_CRITERION_PATTERN = /(?:^|\s)(?:can|will|able\s+to|achieve|master|success(?:ful)?|succeed|know|explain|do|solve|complete|finish)\b/i;
const PITFALL_PATTERN = /(?:pitfall|common\s+mistake|warn(?:ing)?|careful|watch\s+out|avoid)/i;

/**
 * Validate a Plan widget intent, optionally against the chosen Effort level.
 *
 * The hard bounds (`MIN_PLAN_STEPS_ABSOLUTE` … `MAX_PLAN_STEPS_ABSOLUTE`) are
 * always enforced — they are the schema ceiling for the renderer regardless of
 * effort. The per-effort bounds are a tighter window: a "standard" plan with
 * 8 steps is too long for that level even though 8 is a valid number, and a
 * "max" plan with 3 steps undersells the requested depth. When `effortConfig`
 * is supplied, both windows are checked and the per-level message names the
 * level so the repair loop can do the right thing on the second attempt.
 *
 * Sub-activities / time estimates / success criteria / pitfalls are all effort
 * flags. When the flag is on, every step must include the structural element
 * the flag names. When the flag is off, the corresponding structural element
 * is not validated — standard-effort plans legitimately skip time estimates.
 */
export function validatePlan(intent: Record<string, unknown>, effortConfig?: EffortConstraints): ValidationResult {
  if (!text(intent.heading, MAX_SHORT_TEXT_LENGTH)) return fail("Plan needs a heading — what is being mastered");
  const steps = requiredList(intent.steps, MAX_PLAN_STEPS_ABSOLUTE);
  devLog("[tutor-trace] validatePlan steps:", Array.isArray(steps) ? `array len=${steps.length}` : "null", "intent.steps was:", intent.steps);
  if (!steps) return fail(`Plan needs ${MIN_PLAN_STEPS_ABSOLUTE}–${MAX_PLAN_STEPS_ABSOLUTE} steps`);
  if (steps.length < MIN_PLAN_STEPS_ABSOLUTE) {
    return fail(`Plan needs at least ${MIN_PLAN_STEPS_ABSOLUTE} steps (got ${steps.length})`);
  }

  // Per-effort count window. A plan that is valid against the schema but too
  // long for "standard" or too short for "max" fails here with an effort-aware
  // message that names the level so the repair loop can size correctly.
  if (effortConfig) {
    if (steps.length < effortConfig.minSteps) {
      return fail(`Plan needs at least ${effortConfig.minSteps} steps for the selected effort level (got ${steps.length})`);
    }
    if (steps.length > effortConfig.maxSteps) {
      return fail(`Plan must have at most ${effortConfig.maxSteps} steps for the selected effort level (got ${steps.length})`);
    }
  } else if (steps.length > MAX_PLAN_STEPS_ABSOLUTE) {
    return fail(`Plan supports at most ${MAX_PLAN_STEPS_ABSOLUTE} steps`);
  }

  const ids = uniqueIds(steps, "plan.steps");
  if (!ids.valid) return ids;

  // Collect labels once so the effort-level messages can name them when a step
  // is missing a required structural element.
  const labelsOf = (arr: Record<string, unknown>[]): string[] =>
    arr.map((step: Record<string, unknown>) => {
      const raw = step.label;
      return typeof raw === "string" && raw.trim() ? raw.trim().slice(0, 80) : "(unnamed)";
    });

  for (const step of steps as Record<string, unknown>[]) {
    if (!text(step.label, MAX_SHORT_TEXT_LENGTH)) return fail("Each plan step needs a label");
    if (!optionalLatex(step.labelLatex)) return fail("Plan step labelLatex is too long");
    if (step.details !== undefined && step.details !== null && !stringList(step.details, MAX_PLAN_STEP_DETAILS, MAX_TEXT_LENGTH)) {
      return fail(`Plan step details are 1–${MAX_PLAN_STEP_DETAILS} short lines each`);
    }
    // detailsLatex must mirror `details` one-for-one if present.
    if (step.detailsLatex !== undefined && step.detailsLatex !== null) {
      if (!Array.isArray(step.detailsLatex)) return fail("Plan step detailsLatex must be an array");
      const detailsLen = Array.isArray(step.details) ? (step.details as unknown[]).length : 0;
      if ((step.detailsLatex as unknown[]).length !== detailsLen) {
        return fail("Plan step detailsLatex length must match details length");
      }
      if (!(step.detailsLatex as unknown[]).every((entry) => optionalLatex(entry))) {
        return fail("Plan step detailsLatex entries must be valid LaTeX strings");
      }
    }
  }

  // Effort-aware structural checks. These run after the per-step shape check
  // so a malformed details[] does not short-circuit a level-aware message.
  // Each check is independent and names the offending step label(s) so the
  // model can repair the exact entry rather than the whole plan.
  if (effortConfig) {
    const stepArr = steps as Record<string, unknown>[];
    const labels = labelsOf(stepArr);
    const detailsOf = (step: Record<string, unknown>): string[] =>
      Array.isArray(step.details) ? step.details.filter((d): d is string => typeof d === "string") : [];

    if (effortConfig.includeSubActivities) {
      const missing = stepArr
        .map((s, i) => ({ s, i, label: labels[i] }))
        .filter(({ s }) => detailsOf(s).length < 2)
        .map(({ label }) => label);
      if (missing.length > 0) {
        return fail(
          `Each step must include at least 2 sub-activities (details) at the selected effort level. Missing in: ${missing.join(", ")}`
        );
      }
    }

    if (effortConfig.includeTimeEstimates) {
      const missing = stepArr
        .map((s, i) => ({ details: detailsOf(s), label: labels[i] }))
        .filter(({ details }) => details.length === 0 || !TIME_ESTIMATE_PATTERN.test(details[0]))
        .map(({ label }) => label);
      if (missing.length > 0) {
        return fail(
          `Each step must include a time estimate as its first detail item at the selected effort level (e.g. "~30 min", "~2 hours"). Missing in: ${missing.join(", ")}`
        );
      }
    }

    if (effortConfig.includeSuccessCriteria) {
      const missing = stepArr
        .map((s, i) => ({ details: detailsOf(s), label: labels[i] }))
        .filter(({ details }) => {
          if (details.length === 0) return true;
          const last = details[details.length - 1];
          return !SUCCESS_CRITERION_PATTERN.test(last);
        })
        .map(({ label }) => label);
      if (missing.length > 0) {
        return fail(
          `Each step must end with a success criterion at the selected effort level (e.g. "can solve X unaided"). Missing in: ${missing.join(", ")}`
        );
      }
    }

    if (effortConfig.includePitfalls) {
      const missing = stepArr
        .map((s, i) => ({ details: detailsOf(s), label: labels[i] }))
        .filter(({ details }) => {
          if (details.length < 2) return true;
          // A pitfall can sit anywhere among the middle details; checking each
          // entry is more forgiving than only checking the middle one.
          return !details.slice(0, -1).some((d) => PITFALL_PATTERN.test(d));
        })
        .map(({ label }) => label);
      if (missing.length > 0) {
        return fail(
          `Each step should identify a common pitfall at the selected effort level. Missing in: ${missing.join(", ")}`
        );
      }
    }
  }

  if (!optionalText(intent.agreementPrompt, MAX_SHORT_TEXT_LENGTH)) return fail("Plan agreementPrompt is too long");
  return ok;
}

/** Overview bounds: the overview exists to be COMPREHENSIVE, so its lists are
 *  deliberately larger than any other widget. The point is transparency about
 *  the full surface of the concept; an overview with one formula teaches the
 *  wrong thing by omission. */
const MAX_OVERVIEW_VOCAB = 16;
const MAX_OVERVIEW_FORMULAS = 24;
const MAX_OVERVIEW_PROPERTIES = 16;
const MAX_OVERVIEW_GRAPHS = 6;
const MAX_OVERVIEW_KEY_POINTS = 8;
const MAX_OVERVIEW_PITFALLS = 12;
const MAX_OVERVIEW_PATTERNS = 12;
const MAX_OVERVIEW_YOU_WILL = 12;

/**
 * Validate the Overview widget — the comprehensive concept map placed alongside
 * the Plan. The overview may legitimately omit most fields (a small concept
 * needs no graphs and no pitfalls), but it must ALWAYS carry at least the
 * concept name and a summary, otherwise the card is an empty box.
 */
function validateOverview(intent: Record<string, unknown>): ValidationResult {
  if (!text(intent.concept, MAX_SHORT_TEXT_LENGTH)) return fail("Overview needs a concept name");
  if (!text(intent.summary, MAX_TEXT_LENGTH)) return fail("Overview needs a plain-language summary");
  if (!optionalText(intent.subtitle, MAX_SHORT_TEXT_LENGTH)) return fail("Overview subtitle is too long");
  if (!optionalLatex(intent.summaryLatex)) return fail("Overview summaryLatex is too long");

  // Vocabulary — terms the learner must be able to read and use.
  if (intent.vocabulary !== undefined && intent.vocabulary !== null) {
    if (!Array.isArray(intent.vocabulary) || intent.vocabulary.length > MAX_OVERVIEW_VOCAB) {
      return fail(`Overview supports at most ${MAX_OVERVIEW_VOCAB} vocabulary entries`);
    }
    // Vocabulary entries are keyed by their `term`, not an explicit `id`,
    // because the term IS the identifier the learner reads. Duplicates would
    // confuse the renderer and signal a malformed intent.
    const seenTerms = new Set<string>();
    for (const entry of intent.vocabulary as Record<string, unknown>[]) {
      if (!text(entry.term, MAX_SHORT_TEXT_LENGTH)) return fail("Each vocabulary entry needs a term");
      if (seenTerms.has(String(entry.term))) return fail(`Overview vocabulary contains duplicate term "${entry.term}"`);
      seenTerms.add(String(entry.term));
      if (!optionalText(entry.meaning, MAX_TEXT_LENGTH)) return fail("Vocabulary entry meaning is too long");
      if (!optionalLatex(entry.latex)) return fail("Vocabulary entry latex is too long");
    }
  }

  // Formulas — the formal identities and relations.
  if (intent.formulas !== undefined && intent.formulas !== null) {
    if (!Array.isArray(intent.formulas) || intent.formulas.length > MAX_OVERVIEW_FORMULAS) {
      return fail(`Overview supports at most ${MAX_OVERVIEW_FORMULAS} formulas`);
    }
    const ids = uniqueIds(intent.formulas, "overview.formulas");
    if (!ids.valid) return ids;
    for (const formula of intent.formulas as Record<string, unknown>[]) {
      if (!text(formula.name, MAX_SHORT_TEXT_LENGTH)) return fail("Each formula needs a name");
      // The latex body is the only REQUIRED formula field — without it, the
      // formula entry has nothing to typeset and is just a label.
      if (!text(formula.latex, MAX_LATEX_LENGTH)) return fail("Each formula needs a latex body");
      if (!optionalText(formula.meaning, MAX_TEXT_LENGTH)) return fail("Formula meaning is too long");
      if (!optionalBoolean(formula.essential)) return fail("Formula 'essential' must be a boolean when present");
    }
  }

  // Properties — measurable quantities the learner must know the value of.
  if (intent.properties !== undefined && intent.properties !== null) {
    if (!Array.isArray(intent.properties) || intent.properties.length > MAX_OVERVIEW_PROPERTIES) {
      return fail(`Overview supports at most ${MAX_OVERVIEW_PROPERTIES} properties`);
    }
    const ids = uniqueIds(intent.properties, "overview.properties");
    if (!ids.valid) return ids;
    for (const property of intent.properties as Record<string, unknown>[]) {
      if (!text(property.name, MAX_SHORT_TEXT_LENGTH)) return fail("Each property needs a name");
      if (!text(property.value, MAX_SHORT_TEXT_LENGTH)) return fail("Each property needs a value");
      if (!optionalLatex(property.valueLatex)) return fail("Property valueLatex is too long");
      if (!optionalText(property.note, MAX_TEXT_LENGTH)) return fail("Property note is too long");
    }
  }

  // Graphs — descriptions of the visual signature of the concept.
  if (intent.graphs !== undefined && intent.graphs !== null) {
    if (!Array.isArray(intent.graphs) || intent.graphs.length > MAX_OVERVIEW_GRAPHS) {
      return fail(`Overview supports at most ${MAX_OVERVIEW_GRAPHS} graphs`);
    }
    const ids = uniqueIds(intent.graphs, "overview.graphs");
    if (!ids.valid) return ids;
    for (const graph of intent.graphs as Record<string, unknown>[]) {
      if (!text(graph.name, MAX_SHORT_TEXT_LENGTH)) return fail("Each graph needs a name");
      if (!text(graph.shape, MAX_TEXT_LENGTH)) return fail("Each graph needs a shape description");
      if (!optionalText(graph.xRange, MAX_SHORT_TEXT_LENGTH)) return fail("Graph xRange is too long");
      if (!optionalText(graph.yRange, MAX_SHORT_TEXT_LENGTH)) return fail("Graph yRange is too long");
      if (!optionalLatex(graph.sketchLatex)) return fail("Graph sketchLatex is too long");
      if (graph.keyPoints !== undefined && graph.keyPoints !== null) {
        if (!Array.isArray(graph.keyPoints) || graph.keyPoints.length > MAX_OVERVIEW_KEY_POINTS) {
          return fail(`Graph supports at most ${MAX_OVERVIEW_KEY_POINTS} key points`);
        }
        for (const point of graph.keyPoints as Record<string, unknown>[]) {
          if (!text(point.label, MAX_SHORT_TEXT_LENGTH)) return fail("Each key point needs a label");
          if (!optionalLatex(point.valueLatex)) return fail("Key point valueLatex is too long");
          if (!optionalText(point.description, MAX_TEXT_LENGTH)) return fail("Key point description is too long");
        }
      }
    }
  }

  // Pitfalls — common mistakes and misconceptions.
  if (intent.pitfalls !== undefined && intent.pitfalls !== null) {
    if (!Array.isArray(intent.pitfalls) || intent.pitfalls.length > MAX_OVERVIEW_PITFALLS) {
      return fail(`Overview supports at most ${MAX_OVERVIEW_PITFALLS} pitfalls`);
    }
    const ids = uniqueIds(intent.pitfalls, "overview.pitfalls");
    if (!ids.valid) return ids;
    for (const pitfall of intent.pitfalls as Record<string, unknown>[]) {
      if (!text(pitfall.mistake, MAX_TEXT_LENGTH)) return fail("Each pitfall needs a mistake description");
      if (!optionalText(pitfall.why, MAX_TEXT_LENGTH)) return fail("Pitfall 'why' is too long");
      if (!optionalText(pitfall.correction, MAX_TEXT_LENGTH)) return fail("Pitfall correction is too long");
      if (!optionalLatex(pitfall.correctionLatex)) return fail("Pitfall correctionLatex is too long");
    }
  }

  // Patterns — rules-of-thumb.
  if (intent.patterns !== undefined && intent.patterns !== null) {
    if (!Array.isArray(intent.patterns) || intent.patterns.length > MAX_OVERVIEW_PATTERNS) {
      return fail(`Overview supports at most ${MAX_OVERVIEW_PATTERNS} patterns`);
    }
    const ids = uniqueIds(intent.patterns, "overview.patterns");
    if (!ids.valid) return ids;
    for (const pattern of intent.patterns as Record<string, unknown>[]) {
      if (!optionalLatex(pattern.latex)) return fail("Pattern latex is too long");
      if (!optionalText(pattern.text, MAX_TEXT_LENGTH)) return fail("Pattern text is too long");
      if (!optionalText(pattern.note, MAX_TEXT_LENGTH)) return fail("Pattern note is too long");
      // A pattern with neither latex nor text has nothing to say.
      if (
        (pattern.latex === undefined || pattern.latex === null) &&
        (pattern.text === undefined || pattern.text === null)
      ) {
        return fail("Each pattern needs either a latex body or a text body");
      }
    }
  }

  if (!stringList(intent.youWillBeAbleTo, MAX_OVERVIEW_YOU_WILL)) {
    return fail(`Overview 'youWillBeAbleTo' must be at most ${MAX_OVERVIEW_YOU_WILL} short strings`);
  }
  return ok;
}

function validateConceptCard(intent: Record<string, unknown>): ValidationResult {
  if (!text(intent.term, MAX_SHORT_TEXT_LENGTH)) return fail("Concept card needs a term");
  if (!text(intent.definition, MAX_TEXT_LENGTH)) return fail("Concept card needs a definition");
  if (!optionalText(intent.pronunciation, 80)) return fail("Concept card pronunciation is too long");
  if (!optionalText(intent.classification, 80)) return fail("Concept card classification is too long");
  if (!optionalLatex(intent.definitionLatex)) return fail("Concept card definitionLatex is too long");
  if (!stringList(intent.facets, 6)) return fail(`Concept card facets must be at most 6 short strings`);
  return ok;
}

/**
 * Validate the optional response affordance shared by the exploration widgets.
 *
 * Absent is always valid: a tutor may place a slider purely to illustrate. But
 * a `respond` block with no prompt would render an input the learner cannot
 * interpret, so the prompt is required once the key is present at all.
 */
function validateRespond(value: unknown, label: string): ValidationResult {
  if (value === undefined || value === null) return ok;
  if (!isPlainObject(value)) return fail(`${label} respond must be an object`);
  if (!text(value.prompt, MAX_SHORT_TEXT_LENGTH)) return fail(`${label} respond needs a prompt`);
  if (!optionalText(value.placeholder, MAX_SHORT_TEXT_LENGTH)) return fail(`${label} respond placeholder is too long`);
  if (!optionalText(value.submitLabel, 40)) return fail(`${label} respond submitLabel is too long`);
  if (!optionalText(value.acknowledgement, MAX_SHORT_TEXT_LENGTH)) return fail(`${label} respond acknowledgement is too long`);
  return ok;
}

function validateSlider(intent: Record<string, unknown>): ValidationResult {
  if (!text(intent.label, MAX_SHORT_TEXT_LENGTH)) return fail("Slider needs a label");
  if (typeof intent.parameter !== "string" || !/^[A-Za-z][A-Za-z0-9_]{0,23}$/.test(intent.parameter)) {
    return fail("Slider parameter must be a short identifier such as 'theta' or 'h'");
  }
  if (!finiteNumber(intent.min) || !finiteNumber(intent.max)) return fail("Slider min and max must be finite numbers");
  if ((intent.min as number) >= (intent.max as number)) return fail("Slider min must be less than max");
  if (!finiteNumber(intent.value)) return fail("Slider needs a finite initial value");
  if ((intent.value as number) < (intent.min as number) || (intent.value as number) > (intent.max as number)) {
    return fail("Slider value must lie within [min, max]");
  }
  if (intent.step !== undefined && intent.step !== null) {
    if (!finiteNumber(intent.step) || (intent.step as number) <= 0) return fail("Slider step must be a positive number");
    if ((intent.step as number) > (intent.max as number) - (intent.min as number)) {
      return fail("Slider step cannot exceed the slider range");
    }
  }
  if (!optionalText(intent.unit, 24)) return fail("Slider unit is too long");
  if (!optionalText(intent.observe, MAX_TEXT_LENGTH)) return fail("Slider observe text is too long");

  if (intent.ticks !== undefined && intent.ticks !== null) {
    if (!Array.isArray(intent.ticks) || intent.ticks.length > 5) return fail("Slider supports at most 5 ticks");
    for (const tick of intent.ticks) {
      if (!isPlainObject(tick) || !finiteNumber(tick.value) || !text(tick.label, 24)) {
        return fail("Each slider tick needs a finite value and a short label");
      }
    }
  }

  if (intent.readouts !== undefined && intent.readouts !== null) {
    if (!Array.isArray(intent.readouts) || intent.readouts.length > MAX_READOUTS) {
      return fail(`Slider supports at most ${MAX_READOUTS} readouts`);
    }
    const ids = uniqueIds(intent.readouts, "slider.readouts");
    if (!ids.valid) return ids;
    for (const readout of intent.readouts as Record<string, unknown>[]) {
      if (!text(readout.label, MAX_SHORT_TEXT_LENGTH)) return fail("Each slider readout needs a label");
      if (!safeExpression(readout.expression)) {
        return fail("Slider readout expressions must be short arithmetic expressions in the slider parameter");
      }
      if (readout.precision !== undefined && readout.precision !== null) {
        if (!Number.isInteger(readout.precision) || (readout.precision as number) < 0 || (readout.precision as number) > 6) {
          return fail("Slider readout precision must be an integer between 0 and 6");
        }
      }
      if (!optionalText(readout.unit, 24)) return fail("Slider readout unit is too long");
    }
  }
  const respond = validateRespond(intent.respond, "Slider");
  if (!respond.valid) return respond;
  return ok;
}

function validateAnimation(intent: Record<string, unknown>): ValidationResult {
  const frames = requiredList(intent.frames, MAX_FRAMES);
  if (!frames) return fail(`Animation needs 1–${MAX_FRAMES} frames`);
  const ids = uniqueIds(frames, "animation.frames");
  if (!ids.valid) return ids;
  for (const frame of frames as Record<string, unknown>[]) {
    if (!text(frame.caption, MAX_TEXT_LENGTH)) return fail("Each animation frame needs a caption");
    if (!optionalLatex(frame.latex)) return fail("Animation frame latex is too long");
  }
  if (!optionalBoolean(intent.loop)) return fail("Animation loop must be a boolean");
  if (!optionalText(intent.predictPrompt, MAX_TEXT_LENGTH)) return fail("Animation predictPrompt is too long");
  if (intent.durationMs !== undefined && intent.durationMs !== null) {
    if (!finiteNumber(intent.durationMs) || (intent.durationMs as number) < 400 || (intent.durationMs as number) > 60_000) {
      return fail("Animation durationMs must be between 400 and 60000");
    }
  }

  if (intent.motion !== undefined && intent.motion !== null) {
    const motion = intent.motion;
    if (!isPlainObject(motion)) return fail("Animation motion must be an object");
    if (!safeExpression(motion.xExpression) || !safeExpression(motion.yExpression)) {
      return fail("Animation motion needs bounded xExpression and yExpression in t");
    }
    if (motion.zExpression !== undefined && motion.zExpression !== null && !safeExpression(motion.zExpression)) {
      return fail("Animation motion zExpression must be a bounded expression in t");
    }
    if (motion.easing !== undefined && motion.easing !== null &&
        !["linear", "smooth", "enter", "exit"].includes(String(motion.easing))) {
      return fail("Animation motion easing must be linear, smooth, enter or exit");
    }
    if (!optionalBoolean(motion.guideWriteOn)) return fail("Animation motion guideWriteOn must be a boolean");
    if (!optionalSafeExpression(motion.guideXExpression) || !optionalSafeExpression(motion.guideYExpression)) {
      return fail("Animation guide expressions must be bounded expressions in t");
    }
    const domain = motion.tDomain;
    if (!Array.isArray(domain) || domain.length !== 2 || !finiteNumber(domain[0]) || !finiteNumber(domain[1])) {
      return fail("Animation motion tDomain must be [start, end] finite numbers");
    }
    if ((domain[0] as number) >= (domain[1] as number)) return fail("Animation motion tDomain start must be less than end");
    if (!optionalBoolean(motion.trace)) return fail("Animation motion trace must be a boolean");
  }

  if (intent.scene !== undefined && intent.scene !== null) {
    if (!isPlainObject(intent.scene)) return fail("Animation scene must be an object");
    // A scene subsumes motion's point-and-guide; carrying both invites the
    // agent to express one fact two ways and the renderer to pick between them.
    if (intent.motion !== undefined && intent.motion !== null) {
      return fail("Animation cannot carry both motion and scene — a scene already subsumes motion's point and guide");
    }
    const sceneResult = validateScene(intent.scene);
    if (!sceneResult.valid) return sceneResult;
  }

  const checkpoints = validateAnimationCheckpoints(intent.checkpoints);
  if (!checkpoints.valid) return checkpoints;

  if (intent.controls !== undefined && intent.controls !== null) {
    const controls = intent.controls;
    if (!isPlainObject(controls)) return fail("Animation controls must be an object");
    for (const key of ["scrub", "step", "speed", "replay"]) {
      if (!optionalBoolean(controls[key])) return fail(`Animation controls.${key} must be a boolean`);
    }
  }

  const linked = validateLinkedRepresentations(intent.linkedRepresentations);
  if (!linked.valid) return linked;

  if (!optionalText(intent.reconcilePrompt, MAX_TEXT_LENGTH)) {
    return fail("Animation reconcilePrompt is too long");
  }
  if (!optionalText(intent.reconstructPrompt, MAX_TEXT_LENGTH)) {
    return fail("Animation reconstructPrompt is too long");
  }

  // A prediction the learner cannot commit is not a prediction. If the model
  // asks for one, it must also supply the means to record it, otherwise the
  // surface locks playback behind an input that does not exist.
  if (text(intent.predictPrompt, MAX_TEXT_LENGTH) && !isPlainObject(intent.respond)) {
    return fail("Animation predictPrompt requires a respond spec so the prediction can be committed before playback");
  }
  // Reconciliation only means something against a recorded prediction.
  if (text(intent.reconcilePrompt, MAX_TEXT_LENGTH) && !text(intent.predictPrompt, MAX_TEXT_LENGTH)) {
    return fail("Animation reconcilePrompt requires a predictPrompt — there is nothing to reconcile without a prediction");
  }

  const respond = validateRespond(intent.respond, "Animation");
  if (!respond.valid) return respond;
  return ok;
}

/** Upper bound on checkpoints. More than this and the animation is a quiz. */
export const MAX_CHECKPOINTS = 6;

function validateAnimationCheckpoints(value: unknown): ValidationResult {
  if (value === undefined || value === null) return ok;
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_CHECKPOINTS) {
    return fail(`Animation supports 1–${MAX_CHECKPOINTS} checkpoints`);
  }
  const ids = uniqueIds(value, "animation.checkpoints");
  if (!ids.valid) return ids;

  let previousAt = -1;
  for (const raw of value) {
    if (!isPlainObject(raw)) return fail("Each animation checkpoint must be an object");
    if (!finiteNumber(raw.at) || raw.at < 0 || raw.at > 1) {
      return fail("Animation checkpoint 'at' must be a playhead position between 0 and 1");
    }
    // Ordering is not cosmetic: the surface halts playback in sequence, and an
    // out-of-order checkpoint would either be skipped or rewind the learner.
    if (raw.at <= previousAt) {
      return fail("Animation checkpoints must be in strictly increasing playhead order");
    }
    previousAt = raw.at;

    if (!text(raw.prompt, MAX_TEXT_LENGTH)) return fail("Each animation checkpoint needs a prompt");
    if (!optionalText(raw.rationale, MAX_TEXT_LENGTH)) return fail("Animation checkpoint rationale is too long");

    if (raw.options !== undefined && raw.options !== null) {
      const options = requiredList(raw.options, MAX_OPTIONS);
      if (!options || options.length < 2) {
        return fail(`Animation checkpoint options need 2–${MAX_OPTIONS} entries`);
      }
      const optionIds = uniqueIds(options, "animation.checkpoints.options");
      if (!optionIds.valid) return optionIds;
      for (const option of options as Record<string, unknown>[]) {
        if (!text(option.label, MAX_SHORT_TEXT_LENGTH)) return fail("Animation checkpoint options need labels");
        if (!optionalBoolean(option.correct)) return fail("Animation checkpoint option 'correct' must be a boolean");
      }
      // A graded checkpoint with no key grades nothing, and silently accepting
      // every answer is worse than not asking.
      const hasKey = (options as Record<string, unknown>[]).some((option) => option.correct === true);
      if (!hasKey) return fail("Animation checkpoint options must mark exactly one correct option");
    }

    if (raw.acceptedAnswers !== undefined && raw.acceptedAnswers !== null) {
      if (!stringList(raw.acceptedAnswers, MAX_OPTIONS, MAX_SHORT_TEXT_LENGTH)) {
        return fail("Animation checkpoint acceptedAnswers must be short strings");
      }
    }
  }
  return ok;
}

/* ── Animation scene — the composed motion stage ── */

/** A scene scalar is a fixed number or a bounded expression in `t`. */
function sceneScalar(value: unknown): boolean {
  if (typeof value === "number") return finiteNumber(value);
  return typeof value === "string" && safeExpression(value);
}

function scenePointSpec(value: unknown, path: string): ValidationResult {
  if (!isPlainObject(value)) return fail(`${path} must be an object`);
  if (!sceneScalar(value.x) || !sceneScalar(value.y)) {
    return fail(`${path} needs numeric-or-expression x and y`);
  }
  return ok;
}

function optionalSceneAccent(value: unknown, path: string): ValidationResult {
  if (value === undefined || value === null) return ok;
  if (!SCENE_ACCENTS.includes(String(value) as SceneAccent)) {
    return fail(`${path} accent must be one of ${SCENE_ACCENTS.join(", ")}`);
  }
  return ok;
}

function optionalSceneLineStyle(value: unknown, path: string): ValidationResult {
  if (value === undefined || value === null) return ok;
  if (!SCENE_LINE_STYLES.includes(String(value) as SceneLineStyle)) {
    return fail(`${path} style must be one of ${SCENE_LINE_STYLES.join(", ")}`);
  }
  return ok;
}

function optionalSceneDomain(value: unknown, path: string): ValidationResult {
  if (value === undefined || value === null) return ok;
  if (!Array.isArray(value) || value.length !== 2 || !finiteNumber(value[0]) || !finiteNumber(value[1])) {
    return fail(`${path} must be [start, end] finite numbers`);
  }
  if ((value[0] as number) >= (value[1] as number)) return fail(`${path} start must be less than end`);
  return ok;
}

/**
 * Validate the composed scene stage. Same contract as every other widget field:
 * bounds only, fail closed, and a reason the repair loop can act on. Each
 * element's numeric fields are either fixed numbers or bounded arithmetic
 * expressions, so the validator can still assert something concrete — unlike a
 * free code surface, where a sandbox can only promise the code cannot *hurt*
 * you, never that the axes match the labels.
 */
export function validateScene(scene: Record<string, unknown>): ValidationResult {
  const xDomain = scene.xDomain;
  const yDomain = scene.yDomain;
  if (!Array.isArray(xDomain) || xDomain.length !== 2 || !finiteNumber(xDomain[0]) || !finiteNumber(xDomain[1])) {
    return fail("Animation scene needs xDomain [start, end] finite numbers");
  }
  if ((xDomain[0] as number) >= (xDomain[1] as number)) return fail("Animation scene xDomain start must be less than end");
  if (!Array.isArray(yDomain) || yDomain.length !== 2 || !finiteNumber(yDomain[0]) || !finiteNumber(yDomain[1])) {
    return fail("Animation scene needs yDomain [start, end] finite numbers");
  }
  if ((yDomain[0] as number) >= (yDomain[1] as number)) return fail("Animation scene yDomain start must be less than end");
  if (!optionalText(scene.xLabel, MAX_SHORT_TEXT_LENGTH)) return fail("Animation scene xLabel is too long");
  if (!optionalText(scene.yLabel, MAX_SHORT_TEXT_LENGTH)) return fail("Animation scene yLabel is too long");
  if (!optionalBoolean(scene.showGrid)) return fail("Animation scene showGrid must be a boolean");

  const elements = requiredList(scene.elements, MAX_SCENE_ELEMENTS);
  if (!elements) return fail(`Animation scene needs 1–${MAX_SCENE_ELEMENTS} elements`);
  const ids = uniqueIds(elements, "animation.scene.elements");
  if (!ids.valid) return ids;

  for (const raw of elements as Record<string, unknown>[]) {
    const kind = raw.kind;
    if (typeof kind !== "string" || !(SCENE_ELEMENT_KINDS as readonly string[]).includes(kind)) {
      return fail(`Animation scene element kind must be one of ${SCENE_ELEMENT_KINDS.join(", ")}`);
    }
    const path = `animation.scene.elements.${String(raw.id)}`;

    switch (kind) {
      case "curve": {
        if (!safeExpression(raw.xExpression) || !safeExpression(raw.yExpression)) {
          return fail(`${path} curve needs bounded xExpression and yExpression in u`);
        }
        const domain = optionalSceneDomain(raw.uDomain, `${path} uDomain`);
        if (!domain.valid) return domain;
        const style = optionalSceneLineStyle(raw.style, path);
        if (!style.valid) return style;
        if (!optionalBoolean(raw.writeOn)) return fail(`${path} writeOn must be a boolean`);
        const accent = optionalSceneAccent(raw.accent, path);
        if (!accent.valid) return accent;
        break;
      }
      case "point": {
        if (!safeExpression(raw.xExpression) || !safeExpression(raw.yExpression)) {
          return fail(`${path} point needs bounded xExpression and yExpression in t`);
        }
        if (!optionalText(raw.label, MAX_SHORT_TEXT_LENGTH)) return fail(`${path} point label is too long`);
        if (!optionalBoolean(raw.trace)) return fail(`${path} trace must be a boolean`);
        const accent = optionalSceneAccent(raw.accent, path);
        if (!accent.valid) return accent;
        break;
      }
      case "segment": {
        const from = scenePointSpec(raw.from, `${path}.from`);
        if (!from.valid) return from;
        const to = scenePointSpec(raw.to, `${path}.to`);
        if (!to.valid) return to;
        const style = optionalSceneLineStyle(raw.style, path);
        if (!style.valid) return style;
        const accent = optionalSceneAccent(raw.accent, path);
        if (!accent.valid) return accent;
        break;
      }
      case "rects": {
        if (!sceneScalar(raw.count)) return fail(`${path} rects count must be a number or an expression in t`);
        if (!sceneScalar(raw.x0) || !sceneScalar(raw.x1)) {
          return fail(`${path} rects needs numeric-or-expression x0 and x1`);
        }
        if (!safeExpression(raw.yExpression)) return fail(`${path} rects needs a bounded yExpression in x`);
        if (raw.baseline !== undefined && raw.baseline !== null && !sceneScalar(raw.baseline)) {
          return fail(`${path} rects baseline must be a number or an expression in t`);
        }
        if (
          raw.heightRule !== undefined && raw.heightRule !== null &&
          !["left", "right", "midpoint"].includes(String(raw.heightRule))
        ) {
          return fail(`${path} rects heightRule must be left, right, or midpoint`);
        }
        const fill = optionalSceneAccent(raw.fill, `${path} fill`);
        if (!fill.valid) return fill;
        const stroke = optionalSceneAccent(raw.stroke, `${path} stroke`);
        if (!stroke.valid) return stroke;
        break;
      }
      case "region": {
        if (!sceneScalar(raw.x0) || !sceneScalar(raw.x1)) {
          return fail(`${path} region needs numeric-or-expression x0 and x1`);
        }
        if (!safeExpression(raw.topExpression)) return fail(`${path} region needs a bounded topExpression in x`);
        if (raw.bottomExpression !== undefined && raw.bottomExpression !== null && !safeExpression(raw.bottomExpression)) {
          return fail(`${path} region bottomExpression must be a bounded expression in x`);
        }
        const fill = optionalSceneAccent(raw.fill, `${path} fill`);
        if (!fill.valid) return fill;
        break;
      }
      case "arrow": {
        const from = scenePointSpec(raw.from, `${path}.from`);
        if (!from.valid) return from;
        const to = scenePointSpec(raw.to, `${path}.to`);
        if (!to.valid) return to;
        if (!optionalText(raw.label, MAX_SHORT_TEXT_LENGTH)) return fail(`${path} arrow label is too long`);
        const accent = optionalSceneAccent(raw.accent, path);
        if (!accent.valid) return accent;
        break;
      }
      case "label": {
        const at = scenePointSpec(raw.at, `${path}.at`);
        if (!at.valid) return at;
        if (!optionalText(raw.text, MAX_SHORT_TEXT_LENGTH)) return fail(`${path} label text is too long`);
        if (raw.anchor !== undefined && raw.anchor !== null && !["start", "middle", "end"].includes(String(raw.anchor))) {
          return fail(`${path} label anchor must be start, middle, or end`);
        }
        if (raw.offset !== undefined && raw.offset !== null) {
          if (!isPlainObject(raw.offset) || !finiteNumber(raw.offset.x) || !finiteNumber(raw.offset.y)) {
            return fail(`${path} label offset must be { x, y } finite numbers`);
          }
        }
        const accent = optionalSceneAccent(raw.accent, path);
        if (!accent.valid) return accent;
        break;
      }
    }
  }

  return ok;
}

const LINKED_REPRESENTATIONS = ["graph", "table", "equation", "number_line", "diagram"];

function validateLinkedRepresentations(value: unknown): ValidationResult {
  if (value === undefined || value === null) return ok;
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_COLUMNS) {
    return fail(`Animation supports 1–${MAX_COLUMNS} linked representations`);
  }
  const ids = uniqueIds(value, "animation.linkedRepresentations");
  if (!ids.valid) return ids;

  for (const raw of value) {
    if (!isPlainObject(raw)) return fail("Each linked representation must be an object");
    if (!LINKED_REPRESENTATIONS.includes(String(raw.representation))) {
      return fail(`Linked representation must be one of ${LINKED_REPRESENTATIONS.join(", ")}`);
    }
    if (!text(raw.label, MAX_SHORT_TEXT_LENGTH)) return fail("Each linked representation needs a label");
    // Without naming what tracks the animation, a "linked" view is just a second
    // picture sitting next to the first.
    if (!text(raw.tracks, MAX_TEXT_LENGTH)) {
      return fail("Each linked representation must state what it tracks in the animation");
    }
  }
  return ok;
}

function validateComparison(intent: Record<string, unknown>): ValidationResult {
  const columns = requiredList(intent.columns, MAX_COLUMNS);
  if (!columns || columns.length < 2) return fail(`Comparison needs 2–${MAX_COLUMNS} columns`);
  const ids = uniqueIds(columns, "comparison.columns");
  if (!ids.valid) return ids;

  for (const column of columns as Record<string, unknown>[]) {
    if (!text(column.title, MAX_SHORT_TEXT_LENGTH)) return fail("Each comparison column needs a title");
    if (!stringList(column.items, MAX_LIST_ITEMS)) return fail("Comparison column items must be short strings");
    // Optional parallel LaTeX list. Must be present alongside `items` (if at
    // all) AND aligned with it: a one-off LaTeX bullet under a column with
    // three plain bullets misleads the learner about what was compared.
    if (column.itemsLatex !== undefined && column.itemsLatex !== null) {
      if (!Array.isArray(column.itemsLatex)) return fail("Comparison column itemsLatex must be an array");
      const items = Array.isArray(column.items) ? column.items : [];
      if (column.itemsLatex.length !== items.length) {
        return fail("Comparison column itemsLatex length must match items length");
      }
      if (!(column.itemsLatex as unknown[]).every((entry) => optionalLatex(entry))) {
        return fail("Comparison column itemsLatex entries must be valid LaTeX strings");
      }
    }
    if (column.accent !== undefined && column.accent !== null) {
      if (!["cyan", "amber", "violet", "ember", "neutral"].includes(String(column.accent))) {
        return fail("Comparison column accent must be cyan, amber, violet, ember, or neutral");
      }
    }
  }

  if (intent.rows !== undefined && intent.rows !== null) {
    if (!Array.isArray(intent.rows) || intent.rows.length > MAX_ROWS) {
      return fail(`Comparison supports at most ${MAX_ROWS} rows`);
    }
    const rowIds = uniqueIds(intent.rows, "comparison.rows");
    if (!rowIds.valid) return rowIds;
    for (const row of intent.rows as Record<string, unknown>[]) {
      if (!text(row.label, MAX_SHORT_TEXT_LENGTH)) return fail("Each comparison row needs a label");
      if (!optionalLatex(row.labelLatex)) return fail("Comparison row labelLatex is too long");
      if (!Array.isArray(row.cells) || row.cells.length !== columns.length) {
        return fail("Each comparison row must have exactly one cell per column");
      }
      if (!row.cells.every((cell) => typeof cell === "string" && cell.length <= MAX_TEXT_LENGTH)) {
        return fail("Comparison row cells must be strings within the length limit");
      }
      // cellsLatex must mirror cells one-for-one so the renderer can pair them.
      if (row.cellsLatex !== undefined && row.cellsLatex !== null) {
        if (!Array.isArray(row.cellsLatex)) return fail("Comparison row cellsLatex must be an array");
        if (row.cellsLatex.length !== (row.cells as unknown[]).length) {
          return fail("Comparison row cellsLatex length must match cells length");
        }
        if (!(row.cellsLatex as unknown[]).every((entry) => optionalLatex(entry))) {
          return fail("Comparison row cellsLatex entries must be valid LaTeX strings");
        }
      }
    }
  }

  // A comparison with neither per-column bullets nor rows renders as two empty
  // headings — structurally valid but pedagogically vacuous. Reject it.
  const hasItems = (columns as Record<string, unknown>[]).some(
    (column) => Array.isArray(column.items) && column.items.length > 0
  );
  const hasRows = Array.isArray(intent.rows) && intent.rows.length > 0;
  if (!hasItems && !hasRows) return fail("Comparison needs either column items or rows");

  if (!optionalText(intent.takeaway, MAX_TEXT_LENGTH)) return fail("Comparison takeaway is too long");
  return ok;
}

/** Shared answerable-widget validation for `question` and `retrieval_check`. */
function validateAnswerable(intent: Record<string, unknown>, label: string): ValidationResult {
  if (!text(intent.prompt, MAX_TEXT_LENGTH)) return fail(`${label} needs a prompt`);
  if (!optionalLatex(intent.promptLatex)) return fail(`${label} promptLatex is too long`);
  if (!optionalText(intent.explanation, MAX_TEXT_LENGTH)) return fail(`${label} explanation is too long`);

  const format = intent.format;
  if (typeof format !== "string" || !["multiple_choice", "short_answer", "numeric"].includes(format)) {
    return fail(`${label} format must be multiple_choice, short_answer, or numeric`);
  }

  if (format === "multiple_choice") {
    const options = requiredList(intent.options, MAX_OPTIONS);
    if (!options || options.length < 2) return fail(`${label} multiple choice needs 2–${MAX_OPTIONS} options`);
    const ids = uniqueIds(options, `${label}.options`);
    if (!ids.valid) return ids;
    let correct = 0;
    for (const option of options as Record<string, unknown>[]) {
      if (!text(option.label, MAX_TEXT_LENGTH)) return fail(`Each ${label} option needs a label`);
      if (!optionalBoolean(option.correct)) return fail(`${label} option 'correct' must be a boolean`);
      if (!optionalText(option.misconception, MAX_TEXT_LENGTH)) return fail(`${label} option misconception is too long`);
      if (option.correct === true) correct += 1;
    }
    if (correct !== 1) return fail(`${label} multiple choice must mark exactly one option correct (got ${correct})`);
  }

  if (format === "short_answer") {
    if (!Array.isArray(intent.acceptedAnswers) || intent.acceptedAnswers.length === 0) {
      return fail(`${label} short answer needs at least one accepted answer`);
    }
    if (!stringList(intent.acceptedAnswers, MAX_OPTIONS, MAX_SHORT_TEXT_LENGTH)) {
      return fail(`${label} acceptedAnswers must be short non-empty strings`);
    }
  }

  if (format === "numeric") {
    const spec = intent.numericAnswer;
    if (!isPlainObject(spec) || !finiteNumber(spec.value)) {
      return fail(`${label} numeric format needs numericAnswer.value`);
    }
    if (spec.tolerance !== undefined && spec.tolerance !== null) {
      if (!finiteNumber(spec.tolerance) || (spec.tolerance as number) < 0) {
        return fail(`${label} numericAnswer.tolerance must be a non-negative number`);
      }
    }
    if (!optionalText(spec.unit, 24)) return fail(`${label} numericAnswer.unit is too long`);
  }

  if (!optionalText(intent.placeholder, MAX_SHORT_TEXT_LENGTH)) return fail(`${label} placeholder is too long`);
  return ok;
}

function validateQuestion(intent: Record<string, unknown>, label: string): ValidationResult {
  return validateAnswerable(intent, label);
}

function validateRetrievalCheck(intent: Record<string, unknown>): ValidationResult {
  const answerable = validateAnswerable(intent, "retrieval_check");
  if (!answerable.valid) return answerable;
  if (!optionalText(intent.source, MAX_SHORT_TEXT_LENGTH)) return fail("Retrieval check source is too long");
  if (!stringList(intent.expectedPoints, 6)) return fail("Retrieval check expectedPoints must be short strings");
  return ok;
}

function validateHint(intent: Record<string, unknown>): ValidationResult {
  const steps = requiredList(intent.steps, 3);
  if (!steps) return fail("Hint needs 1–3 steps");
  const levels = new Set<number>();
  for (const step of steps as Record<string, unknown>[]) {
    if (![1, 2, 3].includes(step.level as number)) return fail("Hint step level must be 1, 2, or 3");
    if (levels.has(step.level as number)) return fail(`Hint contains duplicate level ${step.level}`);
    levels.add(step.level as number);
    if (!text(step.label, MAX_SHORT_TEXT_LENGTH)) return fail("Each hint step needs a label");
    if (!text(step.body, MAX_TEXT_LENGTH)) return fail("Each hint step needs a body");
    if (!optionalLatex(step.labelLatex)) return fail("Hint step labelLatex is too long");
    if (!optionalLatex(step.bodyLatex)) return fail("Hint step bodyLatex is too long");
  }
  // Levels must form a prefix of 1..3: a hint that opens at "reveal" has
  // skipped the nudge the learner was entitled to first.
  const sorted = [...levels].sort((a, b) => a - b);
  if (sorted.some((level, index) => level !== index + 1)) {
    return fail("Hint levels must start at 1 and increase without gaps");
  }
  const respond = validateRespond(intent.respond, "Hint");
  if (!respond.valid) return respond;
  return ok;
}

function validateScratchpad(intent: Record<string, unknown>): ValidationResult {
  if (!optionalText(intent.prompt, MAX_TEXT_LENGTH)) return fail("Scratchpad prompt is too long");
  if (!optionalText(intent.starter, MAX_TEXT_LENGTH)) return fail("Scratchpad starter is too long");
  if (!optionalText(intent.placeholder, MAX_SHORT_TEXT_LENGTH)) return fail("Scratchpad placeholder is too long");
  if (intent.lines !== undefined && intent.lines !== null) {
    if (!Number.isInteger(intent.lines) || (intent.lines as number) < 2 || (intent.lines as number) > 16) {
      return fail("Scratchpad lines must be an integer between 2 and 16");
    }
  }
  if (intent.mode !== undefined && intent.mode !== null && !["text", "math"].includes(String(intent.mode))) {
    return fail("Scratchpad mode must be text or math");
  }
  return ok;
}

function validateAnnotation(intent: Record<string, unknown>): ValidationResult {
  if (intent.targetAnchor !== undefined && intent.targetAnchor !== null && !identifier(intent.targetAnchor)) {
    return fail("Annotation targetAnchor must be a block anchor id");
  }
  if (!optionalText(intent.targetLabel, MAX_SHORT_TEXT_LENGTH)) return fail("Annotation targetLabel is too long");
  const marks = requiredList(intent.marks, MAX_MARKS);
  if (!marks) return fail(`Annotation needs 1–${MAX_MARKS} marks`);
  const ids = uniqueIds(marks, "annotation.marks");
  if (!ids.valid) return ids;
  for (const mark of marks as Record<string, unknown>[]) {
    if (!text(mark.target, MAX_SHORT_TEXT_LENGTH)) return fail("Each annotation mark needs a target fragment");
    if (!text(mark.note, MAX_TEXT_LENGTH)) return fail("Each annotation mark needs a note");
    if (!optionalLatex(mark.noteLatex)) return fail("Annotation mark noteLatex is too long");
    if (mark.emphasis !== undefined && mark.emphasis !== null) {
      if (!["circle", "underline", "arrow", "strike"].includes(String(mark.emphasis))) {
        return fail("Annotation emphasis must be circle, underline, arrow, or strike");
      }
    }
  }
  const respond = validateRespond(intent.respond, "Annotation");
  if (!respond.valid) return respond;
  return ok;
}

function validateReveal(intent: Record<string, unknown>): ValidationResult {
  if (!optionalText(intent.prompt, MAX_TEXT_LENGTH)) return fail("Reveal prompt is too long");
  if (!optionalText(intent.actionLabel, 40)) return fail("Reveal actionLabel is too long");
  const items = requiredList(intent.items, MAX_STEPS);
  if (!items) return fail(`Reveal needs 1–${MAX_STEPS} items`);
  const ids = uniqueIds(items, "reveal.items");
  if (!ids.valid) return ids;
  for (const item of items as Record<string, unknown>[]) {
    if (!text(item.label, MAX_SHORT_TEXT_LENGTH)) return fail("Each reveal item needs a label");
    if (!text(item.content, MAX_TEXT_LENGTH)) return fail("Each reveal item needs content");
    if (!optionalLatex(item.contentLatex)) return fail("Reveal item contentLatex is too long");
  }
  return ok;
}

function validateExample(intent: Record<string, unknown>): ValidationResult {
  if (!optionalText(intent.problem, MAX_TEXT_LENGTH)) return fail("Example problem is too long");
  if (!optionalLatex(intent.problemLatex)) return fail("Example problemLatex is too long");
  if (!optionalText(intent.conclusion, MAX_TEXT_LENGTH)) return fail("Example conclusion is too long");
  const steps = requiredList(intent.steps, MAX_STEPS);
  if (!steps) return fail(`Example needs 1–${MAX_STEPS} steps`);
  const ids = uniqueIds(steps, "example.steps");
  if (!ids.valid) return ids;
  for (const step of steps as Record<string, unknown>[]) {
    const hasExpression = text(step.expression, MAX_TEXT_LENGTH) || text(step.latex, MAX_LATEX_LENGTH);
    if (!hasExpression) return fail("Each example step needs an expression or latex");
    if (!optionalText(step.expression, MAX_TEXT_LENGTH)) return fail("Example step expression is too long");
    if (!optionalLatex(step.latex)) return fail("Example step latex is too long");
    if (!optionalLatex(step.whyLatex)) return fail("Example step whyLatex is too long");
    // A worked step without a reason is a magic trick, not a demonstration.
    if (!text(step.why, MAX_TEXT_LENGTH)) return fail("Each example step needs a 'why' explaining that step");
  }
  return ok;
}

function validateMistakeCheck(intent: Record<string, unknown>): ValidationResult {
  if (!optionalText(intent.prompt, MAX_TEXT_LENGTH)) return fail("Mistake check prompt is too long");
  const lines = requiredList(intent.lines, MAX_STEPS);
  if (!lines) return fail(`Mistake check needs 1–${MAX_STEPS} lines`);
  const ids = uniqueIds(lines, "mistake_check.lines");
  if (!ids.valid) return ids;

  let errors = 0;
  for (const line of lines as Record<string, unknown>[]) {
    if (!text(line.content, MAX_TEXT_LENGTH)) return fail("Each mistake check line needs content");
    if (!optionalLatex(line.contentLatex)) return fail("Mistake check contentLatex is too long");
    if (line.status !== "ok" && line.status !== "error") return fail("Mistake check line status must be ok or error");
    if (line.status === "error") {
      errors += 1;
      // The whole point of this widget is diagnosis rather than correction.
      if (!text(line.diagnosis, MAX_TEXT_LENGTH)) {
        return fail("A mistake check line marked 'error' must carry a diagnosis of what went wrong");
      }
    }
  }
  if (errors === 0) return fail("Mistake check must mark at least one line as an error");

  if (!optionalText(intent.misconception, MAX_TEXT_LENGTH)) return fail("Mistake check misconception is too long");
  if (!optionalText(intent.repairQuestion, MAX_TEXT_LENGTH)) return fail("Mistake check repairQuestion is too long");
  if (!optionalText(intent.correction, MAX_TEXT_LENGTH)) return fail("Mistake check correction is too long");
  if (!optionalLatex(intent.correctionLatex)) return fail("Mistake check correctionLatex is too long");
  return ok;
}

function validateMemoryHook(intent: Record<string, unknown>): ValidationResult {
  if (!text(intent.hook, MAX_TEXT_LENGTH)) return fail("Memory hook needs hook text");
  if (!optionalLatex(intent.hookLatex)) return fail("Memory hook hookLatex is too long");
  if (!optionalText(intent.elaboration, MAX_TEXT_LENGTH)) return fail("Memory hook elaboration is too long");
  if (!stringList(intent.resurfaceFor, 6, MAX_SHORT_TEXT_LENGTH)) {
    return fail("Memory hook resurfaceFor must be at most 6 short concept keys");
  }
  return ok;
}

function validateChallenge(intent: Record<string, unknown>): ValidationResult {
  if (!text(intent.prompt, MAX_TEXT_LENGTH)) return fail("Challenge needs a prompt");
  if (!optionalLatex(intent.promptLatex)) return fail("Challenge promptLatex is too long");
  if (!optionalText(intent.badge, 40)) return fail("Challenge badge is too long");
  if (!optionalText(intent.transferNote, MAX_TEXT_LENGTH)) return fail("Challenge transferNote is too long");
  if (!stringList(intent.successCriteria, 6)) return fail("Challenge successCriteria must be short strings");
  if (intent.parts !== undefined && intent.parts !== null) {
    if (!Array.isArray(intent.parts) || intent.parts.length > 5) return fail("Challenge supports at most 5 parts");
    const ids = uniqueIds(intent.parts, "challenge.parts");
    if (!ids.valid) return ids;
    for (const part of intent.parts as Record<string, unknown>[]) {
      if (!text(part.prompt, MAX_TEXT_LENGTH)) return fail("Each challenge part needs a prompt");
      if (!optionalLatex(part.promptLatex)) return fail("Challenge part promptLatex is too long");
    }
  }
  const preObs = intent.preObservation;
  if (preObs !== undefined && preObs !== null) {
    if (!isPlainObject(preObs)) return fail("Challenge preObservation must be an object");
    if (!text(preObs.prompt, 300)) return fail("Challenge preObservation.prompt is required (max 300 chars)");
    if (!optionalText(preObs.placeholder, 200)) return fail("Challenge preObservation.placeholder is too long (max 200 chars)");
  }
  return ok;
}

function validateReflection(intent: Record<string, unknown>): ValidationResult {
  if (!text(intent.prompt, MAX_TEXT_LENGTH)) return fail("Reflection needs a prompt");
  if (!stringList(intent.guidance, 6)) return fail("Reflection guidance must be short strings");
  if (!stringList(intent.evaluationCriteria, 6)) return fail("Reflection evaluationCriteria must be short strings");
  if (!optionalText(intent.placeholder, MAX_SHORT_TEXT_LENGTH)) return fail("Reflection placeholder is too long");
  if (intent.minWords !== undefined && intent.minWords !== null) {
    if (!Number.isInteger(intent.minWords) || (intent.minWords as number) < 0 || (intent.minWords as number) > 300) {
      return fail("Reflection minWords must be an integer between 0 and 300");
    }
  }
  return ok;
}

function validateMasteryCard(intent: Record<string, unknown>): ValidationResult {
  if (!text(intent.concept, MAX_SHORT_TEXT_LENGTH)) return fail("Mastery card needs a concept");

  // `evidence` is accepted but not required, and never trusted. The harness
  // overwrites it from the ledger before the card renders. Validating it
  // strictly here would only teach the model that authoring plausible-looking
  // mastery percentages is a legitimate move, which is the exact behaviour the
  // evidence engine exists to remove.
  const evidence = intent.evidence;
  if (evidence !== undefined && evidence !== null) {
    if (!isPlainObject(evidence)) return fail("Mastery card evidence must be an object when present");
    for (const dimension of ["recall", "understanding", "procedure", "transfer", "independence"]) {
      const score = (evidence as Record<string, unknown>)[dimension];
      if (score === undefined || score === null) continue;
      if (typeof score !== "number" || !Number.isFinite(score) || score < 0 || score > 100) {
        return fail(`Mastery card evidence.${dimension} must be a number between 0 and 100`);
      }
    }
  }
  if (!optionalText(intent.skillId, MAX_ID_LENGTH)) return fail("Mastery card skillId is too long");
  if (intent.evidenceIds !== undefined && intent.evidenceIds !== null) {
    if (!stringList(intent.evidenceIds, 24, MAX_ID_LENGTH)) {
      return fail("Mastery card evidenceIds must be short id strings");
    }
  }
  if (intent.weakestLink !== undefined && intent.weakestLink !== null) {
    if (!["recall", "understanding", "procedure", "transfer", "independence"].includes(String(intent.weakestLink))) {
      return fail("Mastery card weakestLink must be one of the five evidence dimensions");
    }
  }
  if (!stringList(intent.understands, 8)) return fail("Mastery card 'understands' must be short strings");
  if (!stringList(intent.canDo, 8)) return fail("Mastery card 'canDo' must be short strings");
  if (!stringList(intent.recalls, 8)) return fail("Mastery card 'recalls' must be short strings");
  if (!stringList(intent.watch, 8)) return fail("Mastery card 'watch' must be short strings");
  if (!optionalText(intent.next, MAX_SHORT_TEXT_LENGTH)) return fail("Mastery card 'next' is too long");
  if (!optionalText(intent.reviewIn, 60)) return fail("Mastery card reviewIn is too long");
  return ok;
}

/* ── 23 · FigureSpec — high-level textbook figure ── */

/**
 * Validate a `figure_spec` widget. We check the *spec* (the agent's
 * authoring), not the compiled primitive list — the spec is the source of
 * truth, the compile is a derived artifact. The compile-then-validate-scene
 * round-trip happens inside `compile.ts` and surfaces its own error type,
 * `FigureSpecCompileError`, which the agent's repair loop reads.
 *
 * Bounds mirror `MAX_SCENE_ELEMENTS = 24` upstream: a spec that could
 * produce more than 24 primitives is rejected with a reason. The
 * per-kind branches gate coordinates, lengths and expression sizes so a
 * textbook-spec-shaped object that nonetheless contains a hostile payload
 * (NaN, an unbounded string, an unsupported kind) is refused at the wire.
 */
export function validateFigureSpec(intent: Record<string, unknown>): ValidationResult {
  const spec = intent.spec;
  if (!isPlainObject(spec)) return fail("Figure widget needs a spec object");
  const kind = spec.kind;
  if (typeof kind !== "string" || !(FIGURE_KINDS as readonly string[]).includes(kind)) {
    return fail(`Figure spec kind must be one of ${FIGURE_KINDS.join(", ")}`);
  }

  switch (kind) {
    case "unitCircle": {
      if (!finiteNumber(spec.theta)) return fail("unitCircle.theta must be a finite number");
      if (Math.abs((spec.theta as number)) > 100) return fail("unitCircle.theta is unreasonably large");
      validateOptionalDomain(spec.domainX, "unitCircle.domainX");
      validateOptionalDomain(spec.domainY, "unitCircle.domainY");
      if (!optionalBoolean(spec.showRadius)) return fail("unitCircle.showRadius must be a boolean");
      if (!optionalBoolean(spec.showSin)) return fail("unitCircle.showSin must be a boolean");
      if (!optionalBoolean(spec.showCos)) return fail("unitCircle.showCos must be a boolean");
      if (!optionalBoolean(spec.showTan)) return fail("unitCircle.showTan must be a boolean");
      if (!optionalBoolean(spec.showLabels)) return fail("unitCircle.showLabels must be a boolean");
      break;
    }
    case "trigGraph": {
      if (!["sin", "cos", "tan", "csc", "sec", "cot"].includes(String(spec.function))) {
        return fail("trigGraph.function must be sin, cos, tan, csc, sec, or cot");
      }
      const dx = requiredTuple(spec.domainX, "trigGraph.domainX");
      if (!dx.valid) return dx;
      validateOptionalRange(spec.rangeY, "trigGraph.rangeY");
      if (!optionalBoolean(spec.showKeyPoints)) return fail("trigGraph.showKeyPoints must be a boolean");
      if (!optionalBoolean(spec.showLabels)) return fail("trigGraph.showLabels must be a boolean");
      break;
    }
    case "parabola": {
      if (!pointTuple(spec.vertex, "parabola.vertex")) return fail("parabola.vertex must be [x, y]");
      if (!["up", "down", "left", "right"].includes(String(spec.opens))) {
        return fail("parabola.opens must be up, down, left, or right");
      }
      if (spec.scale !== undefined && spec.scale !== null) {
        if (!finiteNumber(spec.scale) || (spec.scale as number) <= 0) {
          return fail("parabola.scale must be a positive number");
        }
      }
      if (!optionalBoolean(spec.showFocusDirectrix)) return fail("parabola.showFocusDirectrix must be a boolean");
      validateOptionalDomain(spec.domainX, "parabola.domainX");
      validateOptionalDomain(spec.domainY, "parabola.domainY");
      break;
    }
    case "polynomialGraph": {
      if (!text(spec.expressionLatex, MAX_FIGURE_EXPRESSION)) return fail("polynomialGraph.expressionLatex is too long or empty");
      const dx = requiredTuple(spec.domainX, "polynomialGraph.domainX");
      if (!dx.valid) return dx;
      validateOptionalRange(spec.rangeY, "polynomialGraph.rangeY");
      if (!optionalBoolean(spec.showRoots)) return fail("polynomialGraph.showRoots must be a boolean");
      if (!optionalBoolean(spec.showVertex)) return fail("polynomialGraph.showVertex must be a boolean");
      break;
    }
    case "secantTangent": {
      if (!text(spec.fLatex, MAX_FIGURE_EXPRESSION)) return fail("secantTangent.fLatex is too long or empty");
      if (!finiteNumber(spec.x0) || !finiteNumber(spec.x1)) return fail("secantTangent.x0 and x1 must be finite numbers");
      if (spec.tangentAt !== undefined && spec.tangentAt !== null && !finiteNumber(spec.tangentAt)) {
        return fail("secantTangent.tangentAt must be a finite number");
      }
      if (spec.domainPad !== undefined && spec.domainPad !== null) {
        if (!finiteNumber(spec.domainPad) || (spec.domainPad as number) <= 0) {
          return fail("secantTangent.domainPad must be a positive number");
        }
      }
      validateOptionalRange(spec.rangeY, "secantTangent.rangeY");
      if (!optionalBoolean(spec.showLabels)) return fail("secantTangent.showLabels must be a boolean");
      break;
    }
    case "limitGraph": {
      if (!text(spec.fLatex, MAX_FIGURE_EXPRESSION)) return fail("limitGraph.fLatex is too long or empty");
      if (!finiteNumber(spec.limitPoint)) return fail("limitGraph.limitPoint must be a finite number");
      if (!optionalBoolean(spec.leftArrow)) return fail("limitGraph.leftArrow must be a boolean");
      if (!optionalBoolean(spec.rightArrow)) return fail("limitGraph.rightArrow must be a boolean");
      if (spec.domainPad !== undefined && spec.domainPad !== null) {
        if (!finiteNumber(spec.domainPad) || (spec.domainPad as number) <= 0) {
          return fail("limitGraph.domainPad must be a positive number");
        }
      }
      validateOptionalRange(spec.rangeY, "limitGraph.rangeY");
      if (!optionalBoolean(spec.showLabels)) return fail("limitGraph.showLabels must be a boolean");
      break;
    }
    case "shadedArea": {
      if (!text(spec.fLatex, MAX_FIGURE_EXPRESSION)) return fail("shadedArea.fLatex is too long or empty");
      if (!finiteNumber(spec.fromX) || !finiteNumber(spec.toX)) return fail("shadedArea.fromX and toX must be finite numbers");
      if ((spec.fromX as number) >= (spec.toX as number)) return fail("shadedArea.fromX must be less than toX");
      if (spec.baseY !== undefined && spec.baseY !== null && !finiteNumber(spec.baseY)) {
        return fail("shadedArea.baseY must be a finite number");
      }
      if (spec.domainPad !== undefined && spec.domainPad !== null) {
        if (!finiteNumber(spec.domainPad) || (spec.domainPad as number) <= 0) {
          return fail("shadedArea.domainPad must be a positive number");
        }
      }
      validateOptionalRange(spec.rangeY, "shadedArea.rangeY");
      if (!optionalBoolean(spec.showLabels)) return fail("shadedArea.showLabels must be a boolean");
      break;
    }
    case "vector": {
      if (!pointTuple(spec.origin, "vector.origin")) return fail("vector.origin must be [x, y]");
      if (!pointTuple(spec.tip, "vector.tip")) return fail("vector.tip must be [x, y]");
      const origin = spec.origin as unknown as [number, number];
      const tip = spec.tip as unknown as [number, number];
      if (origin[0] === tip[0] && origin[1] === tip[1]) {
        return fail("vector.origin and tip must differ");
      }
      if (spec.label !== undefined && spec.label !== null && !text(spec.label, MAX_SHORT_TEXT_LENGTH)) {
        return fail("vector.label is too long");
      }
      if (spec.labelLatex !== undefined && spec.labelLatex !== null && !text(spec.labelLatex, MAX_LATEX_LENGTH)) {
        return fail("vector.labelLatex is too long");
      }
      break;
    }
    case "rightTriangle": {
      if (!finiteNumber(spec.adjacent) || !finiteNumber(spec.opposite)) return fail("rightTriangle.adjacent and opposite must be finite numbers");
      if ((spec.adjacent as number) <= 0 || (spec.opposite as number) <= 0) {
        return fail("rightTriangle.adjacent and opposite must be positive");
      }
      if ((spec.adjacent as number) > COORD_MAX || (spec.opposite as number) > COORD_MAX) {
        return fail("rightTriangle.adjacent and opposite are unreasonably large");
      }
      if (!optionalBoolean(spec.showRatios)) return fail("rightTriangle.showRatios must be a boolean");
      if (!optionalBoolean(spec.thetaLabel)) return fail("rightTriangle.thetaLabel must be a boolean");
      break;
    }
    case "coordinatePlane": {
      const xr = requiredTuple(spec.xRange, "coordinatePlane.xRange");
      if (!xr.valid) return xr;
      const yr = requiredTuple(spec.yRange, "coordinatePlane.yRange");
      if (!yr.valid) return yr;
      if (!Array.isArray(spec.points) || spec.points.length > MAX_FIGURE_DECLARED) {
        return fail(`coordinatePlane.points needs 0–${MAX_FIGURE_DECLARED} entries`);
      }
      for (const p of spec.points as Record<string, unknown>[]) {
        if (!finiteNumber(p.x) || !finiteNumber(p.y)) return fail("coordinatePlane point needs finite x and y");
        if (Math.abs(p.x as number) > COORD_MAX || Math.abs(p.y as number) > COORD_MAX) {
          return fail("coordinatePlane point coords are unreasonably large");
        }
        if (p.label !== undefined && p.label !== null && !text(p.label, MAX_SHORT_TEXT_LENGTH)) {
          return fail("coordinatePlane point label is too long");
        }
        if (p.labelLatex !== undefined && p.labelLatex !== null && !text(p.labelLatex, MAX_LATEX_LENGTH)) {
          return fail("coordinatePlane point labelLatex is too long");
        }
      }
      if (!optionalBoolean(spec.showOrigin)) return fail("coordinatePlane.showOrigin must be a boolean");
      if (!optionalBoolean(spec.showLabels)) return fail("coordinatePlane.showLabels must be a boolean");
      break;
    }
    case "flowchart": {
      if (!Array.isArray(spec.nodes) || spec.nodes.length === 0 || spec.nodes.length > MAX_FIGURE_DECLARED) {
        return fail(`flowchart.nodes needs 1–${MAX_FIGURE_DECLARED} entries`);
      }
      const nodeIds = new Set<string>();
      for (const n of spec.nodes as Record<string, unknown>[]) {
        if (typeof n.id !== "string" || n.id.length === 0 || n.id.length > MAX_ID_LENGTH) {
          return fail("flowchart node needs a short id string");
        }
        if (nodeIds.has(n.id)) return fail(`flowchart node ids must be unique (duplicate ${n.id})`);
        nodeIds.add(n.id);
        if (!text(n.label, MAX_TEXT_LENGTH)) return fail("flowchart node needs a non-empty label");
        if (!finiteNumber(n.x) || !finiteNumber(n.y)) return fail("flowchart node needs finite x and y");
      }
      if (spec.edges !== undefined && spec.edges !== null) {
        if (!Array.isArray(spec.edges) || spec.edges.length > MAX_FIGURE_DECLARED * 2) {
          return fail(`flowchart.edges has too many entries`);
        }
        for (const e of spec.edges as Record<string, unknown>[]) {
          if (typeof e.from !== "string" || !nodeIds.has(e.from)) return fail("flowchart edge 'from' must reference a declared node id");
          if (typeof e.to !== "string" || !nodeIds.has(e.to)) return fail("flowchart edge 'to' must reference a declared node id");
          if (e.from === e.to) return fail("flowchart edge cannot loop onto itself");
          if (e.label !== undefined && e.label !== null && !text(e.label, MAX_SHORT_TEXT_LENGTH)) {
            return fail("flowchart edge label is too long");
          }
        }
      }
      if (!optionalBoolean(spec.showLabels)) return fail("flowchart.showLabels must be a boolean");
      break;
    }
    case "freeBodyDiagram": {
      if (spec.body !== "block" && spec.body !== "sphere") return fail("freeBodyDiagram.body must be block or sphere");
      if (!Array.isArray(spec.forces) || spec.forces.length === 0 || spec.forces.length > 8) {
        return fail("freeBodyDiagram.forces needs 1–8 entries");
      }
      for (const f of spec.forces as Record<string, unknown>[]) {
        if (!finiteNumber(f.magnitude) || (f.magnitude as number) < 0) return fail("freeBodyDiagram force magnitude must be a non-negative number");
        if (!finiteNumber(f.angleDeg)) return fail("freeBodyDiagram force angleDeg must be a finite number");
        if (f.label !== undefined && f.label !== null && !text(f.label, MAX_SHORT_TEXT_LENGTH)) {
          return fail("freeBodyDiagram force label is too long");
        }
      }
      if (spec.body === "block") {
        if (spec.width !== undefined && spec.width !== null && (!finiteNumber(spec.width) || (spec.width as number) <= 0)) {
          return fail("freeBodyDiagram.width must be a positive number");
        }
        if (spec.height !== undefined && spec.height !== null && (!finiteNumber(spec.height) || (spec.height as number) <= 0)) {
          return fail("freeBodyDiagram.height must be a positive number");
        }
      }
      if (spec.at !== undefined && spec.at !== null && !pointTuple(spec.at, "freeBodyDiagram.at")) {
        return fail("freeBodyDiagram.at must be [x, y]");
      }
      if (!optionalBoolean(spec.showLabels)) return fail("freeBodyDiagram.showLabels must be a boolean");
      break;
    }
  }

  // optional accents on every kind
  if (spec.accent !== undefined && spec.accent !== null) {
    if (!(SCENE_ACCENTS as readonly string[]).includes(String(spec.accent))) {
      return fail("figure spec accent must be a known scene accent");
    }
  }
  if (spec.style !== undefined && spec.style !== null) {
    if (!(SCENE_LINE_STYLES as readonly string[]).includes(String(spec.style))) {
      return fail("figure spec style must be one of solid, dashed, dotted");
    }
  }

  // caption lives on the widget, not the spec — validate it here.
  if (!optionalText(intent.caption, MAX_TEXT_LENGTH)) return fail("Figure caption is too long");
  return ok;
}

function pointTuple(value: unknown, label: string): boolean {
  if (!Array.isArray(value) || value.length !== 2) return false;
  if (!finiteNumber(value[0]) || !finiteNumber(value[1])) return false;
  if (Math.abs(value[0] as number) > COORD_MAX || Math.abs(value[1] as number) > COORD_MAX) {
    devLog("[validate] %s coord exceeds COORD_MAX", label);
    return false;
  }
  return true;
}

function requiredTuple(value: unknown, label: string): ValidationResult {
  if (!Array.isArray(value) || value.length !== 2) return fail(`${label} must be [start, end]`);
  if (!finiteNumber(value[0]) || !finiteNumber(value[1])) return fail(`${label} must be finite numbers`);
  if ((value[0] as number) >= (value[1] as number)) return fail(`${label} start must be less than end`);
  if (Math.abs(value[0] as number) > COORD_MAX || Math.abs(value[1] as number) > COORD_MAX) {
    return fail(`${label} values are unreasonably large`);
  }
  return ok;
}

function validateOptionalDomain(value: unknown, label: string): ValidationResult {
  if (value === undefined || value === null) return ok;
  return requiredTuple(value, label);
}

function validateOptionalRange(value: unknown, label: string): ValidationResult {
  return validateOptionalDomain(value, label);
}

/* ── Learner state ── */

const MAX_RESPONSE_TEXT = 4000;

/**
 * Sanitize learner-authored widget state. Learner input is untrusted: this both
 * bounds it before persistence and guarantees the summary handed back to the
 * model cannot smuggle arbitrary payloads through a widget field.
 */
export function sanitizeWidgetState(value: unknown): WidgetState | undefined {
  if (!isPlainObject(value)) return undefined;
  const next: WidgetState = {};

  if (identifier(value.selectedOptionId)) next.selectedOptionId = String(value.selectedOptionId);
  if (typeof value.responseText === "string") next.responseText = value.responseText.slice(0, MAX_RESPONSE_TEXT);
  if (typeof value.submitted === "boolean") next.submitted = value.submitted;
  if (typeof value.correct === "boolean") next.correct = value.correct;
  if (finiteNumber(value.sliderValue)) next.sliderValue = value.sliderValue;
  if (finiteNumber(value.animationProgress)) {
    next.animationProgress = Math.min(1, Math.max(0, value.animationProgress));
  }
  if (Number.isInteger(value.hintLevelOpened)) {
    next.hintLevelOpened = Math.min(3, Math.max(0, value.hintLevelOpened as number));
  }
  if (finiteNumber(value.confidence)) {
    next.confidence = Math.min(100, Math.max(0, Math.round(value.confidence)));
  }
  if (typeof value.predictionLocked === "boolean") next.predictionLocked = value.predictionLocked;
  if (isPlainObject(value.checkpointResponses)) {
    const responses: Record<string, { response: string; correct?: boolean }> = {};
    for (const [key, raw] of Object.entries(value.checkpointResponses).slice(0, MAX_CHECKPOINTS)) {
      if (!identifier(key) || !isPlainObject(raw)) continue;
      if (typeof raw.response !== "string") continue;
      responses[key] = {
        response: raw.response.slice(0, MAX_SHORT_TEXT_LENGTH),
        ...(typeof raw.correct === "boolean" ? { correct: raw.correct } : {}),
      };
    }
    if (Object.keys(responses).length > 0) next.checkpointResponses = responses;
  }
  if (typeof value.reconcileText === "string") {
    next.reconcileText = value.reconcileText.slice(0, MAX_RESPONSE_TEXT);
  }
  if (typeof value.reconstructText === "string") {
    next.reconstructText = value.reconstructText.slice(0, MAX_RESPONSE_TEXT);
  }
  if (Array.isArray(value.revealedIds)) {
    next.revealedIds = value.revealedIds.filter(identifier).map(String).slice(0, MAX_STEPS);
  }
  // Plan agreement edits must survive reopen: without this, a learner who
  // rewrote the route before "Start learning" comes back to the tutor's draft
  // and loses the commitment they just made.
  if (isPlainObject(value.planDraft)) {
    const heading =
      typeof value.planDraft.heading === "string"
        ? value.planDraft.heading.trim().slice(0, MAX_SHORT_TEXT_LENGTH)
        : "";
    const rawSteps = Array.isArray(value.planDraft.steps) ? value.planDraft.steps : [];
    const steps = rawSteps
      .filter((step): step is Record<string, unknown> => isPlainObject(step))
      .slice(0, MAX_PLAN_STEPS_ABSOLUTE)
      .map((step, index) => {
        const id = identifier(step.id) ? String(step.id) : `step-${index + 1}`;
        const label =
          typeof step.label === "string" && step.label.trim().length > 0
            ? step.label.trim().slice(0, MAX_SHORT_TEXT_LENGTH)
            : `Step ${index + 1}`;
        const details = Array.isArray(step.details)
          ? step.details
              .filter((line): line is string => typeof line === "string" && line.trim().length > 0)
              .map((line) => line.trim().slice(0, MAX_TEXT_LENGTH))
              .slice(0, MAX_PLAN_STEP_DETAILS)
          : undefined;
        return details && details.length > 0 ? { id, label, details } : { id, label };
      })
      .filter((step) => step.label.length > 0);
    if (heading.length > 0 && steps.length > 0) {
      next.planDraft = { heading, steps };
    }
  }
  if (typeof value.interactedAt === "string" && value.interactedAt.length <= 40) {
    next.interactedAt = value.interactedAt;
  }
  return Object.keys(next).length > 0 ? next : undefined;
}

/* ── Deterministic grading ── */

/**
 * Grade an answerable widget without a model call.
 *
 * Multiple-choice and numeric correctness are deterministic facts about the
 * widget's answer key. Open-ended text is intentionally left ungraded here:
 * different valid phrasings need semantic evaluation by the tutor.
 */
export function gradeAnswerableWidget(
  intent: { format?: QuestionFormat; options?: QuestionOption[]; acceptedAnswers?: string[]; numericAnswer?: { value: number; tolerance?: number } },
  state: WidgetState
): boolean | undefined {
  if (intent.format === "multiple_choice") {
    if (!state.selectedOptionId) return undefined;
    // An option set with nothing marked correct carries no key either; scoring
    // the learner's pick against it would report a confident "wrong".
    if (!intent.options?.some((candidate) => candidate.correct === true)) return undefined;
    const option = intent.options.find((candidate) => candidate.id === state.selectedOptionId);
    return option ? option.correct === true : undefined;
  }

  const response = state.responseText?.trim();
  if (!response) return undefined;

  if (intent.format === "short_answer") {
    if (!intent.acceptedAnswers?.length) return undefined;

    // Keep only high-confidence lexical matches. Semantic paraphrases that do
    // not share enough signal remain neutral for tutor evaluation rather than
    // becoming a false failure.
    const normalize = (input: string) => input
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (intent.acceptedAnswers.some((accepted) => normalize(accepted) === normalize(response))) return true;

    const stopWords = new Set(["a", "an", "and", "at", "by", "for", "in", "is", "of", "on", "or", "the", "to", "with"]);
    const tokens = (input: string) => normalize(input)
      .split(/\s+/)
      .filter((token) => token.length > 1 && !stopWords.has(token));
    const responseTokens = new Set(tokens(response));

    for (const accepted of intent.acceptedAnswers) {
      const acceptedTokens = tokens(accepted);
      if (acceptedTokens.length === 0) continue;
      const overlap = acceptedTokens.filter((token) => responseTokens.has(token)).length;
      if (overlap === acceptedTokens.length || (acceptedTokens.length === 1 && overlap === 1)) return true;
    }

    return undefined;
  }

  if (intent.format === "numeric") {
    const spec = intent.numericAnswer;
    if (!spec) return undefined;
    // Accept a trailing unit and common notations without accepting prose.
    const match = response.replace(/,/g, "").match(/-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?/);
    if (!match) return undefined;
    const parsed = Number(match[0]);
    if (!Number.isFinite(parsed)) return undefined;
    const tolerance = spec.tolerance ?? Math.max(1e-9, Math.abs(spec.value) * 1e-6);
    return Math.abs(parsed - spec.value) <= tolerance;
  }

  return undefined;
}

/** Convenience re-export for callers validating a whole evidence block. */
export function isMasteryEvidence(value: unknown): value is MasteryEvidence {
  if (!isPlainObject(value)) return false;
  return ["recall", "understanding", "procedure", "transfer", "independence"].every((dimension) => {
    const score = value[dimension];
    return typeof score === "number" && Number.isFinite(score) && score >= 0 && score <= 100;
  });
}
