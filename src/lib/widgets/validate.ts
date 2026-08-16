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
} from "./types";

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

export function validateWidgetIntent(intent: unknown): ValidationResult {
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
      if (!Array.isArray(row.cells) || row.cells.length !== columns.length) {
        return fail("Each comparison row must have exactly one cell per column");
      }
      if (!row.cells.every((cell) => typeof cell === "string" && cell.length <= MAX_TEXT_LENGTH)) {
        return fail("Comparison row cells must be strings within the length limit");
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
  if (typeof value.interactedAt === "string" && value.interactedAt.length <= 40) {
    next.interactedAt = value.interactedAt;
  }
  return Object.keys(next).length > 0 ? next : undefined;
}

/* ── Deterministic grading ── */

/**
 * Grade an answerable widget without a model call.
 *
 * Correctness of a multiple-choice, short-answer, or numeric response is a
 * deterministic fact about the agent's own answer key. Routing it through the
 * LLM would make the learner's score depend on sampling temperature.
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
    // No answer key means UNGRADEABLE, not wrong. `[].some(...)` is false, so
    // returning it directly would score every keyless short answer as
    // incorrect — with full evaluator confidence, because a definite boolean
    // reads as a definite verdict downstream. An open-ended prompt the tutor
    // never keyed would mark the learner wrong for answering it well, drive
    // their skill state down, and manufacture the failure streak that routes
    // them into prerequisite repair they do not need.
    if (!intent.acceptedAnswers?.length) return undefined;
    const normalize = (input: string) => input.toLowerCase().replace(/\s+/g, " ").replace(/[.,;:!?]+$/, "").trim();
    const target = normalize(response);
    return intent.acceptedAnswers.some((accepted) => normalize(accepted) === target);
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
