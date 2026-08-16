/**
 * Machine-checkable stage exit predicates.
 *
 * This module replaces the single weakest link in the old harness. Stage
 * advancement previously required `stageAdvance.ready === true` plus a
 * non-empty `evidence` STRING — which means the gate was satisfied by the model
 * typing any character at all. Every "advance only on observed evidence" rule in
 * the prompt was, in practice, advisory.
 *
 * Here each stage's exit condition is a function of the evidence ledger. The
 * model's narration is still collected and shown, but it is no longer what
 * opens the gate. A model that claims readiness without matching evidence is
 * simply not advanced, and the predicate reports exactly which evidence is
 * missing so the planner can go get it.
 *
 * The predicates in order:
 *
 *   Encounter  → a LOCKED prediction plus an identified observable result.
 *   Understand → a mechanism explained in the learner's own words, plus a
 *                contrast-pair discrimination.
 *   Construct  → two critical steps produced at support level <= 1.
 *   Apply      → multiple standard items completed independently.
 *   Transfer   → success on a novel representation or context, WITH justification.
 *   Master     → delayed unaided retrieval plus unaided transfer.
 */

import { MASTERY_STAGES, type MasteryStage } from "../mastery";
import type { LearningEvidenceEvent, SkillState } from "./types";

/** How many independent items Apply requires. */
export const APPLY_INDEPENDENT_ITEMS_REQUIRED = 3;

/** How many critical steps at low support Construct requires. */
export const CONSTRUCT_CRITICAL_STEPS_REQUIRED = 2;

/** Minimum characters for a response to count as an explanation in the
 *  learner's own words. Short enough to accept a terse but real answer,
 *  long enough to reject "yes" and "i get it". */
export const MIN_EXPLANATION_CHARS = 40;

export interface StagePredicateResult {
  /** Whether the stage's exit condition is satisfied by the ledger. */
  satisfied: boolean;
  /** The evidence events that satisfied it. Empty when unsatisfied. */
  satisfiedByEvidenceIds: string[];
  /** Human-readable list of what is still missing, for the planner and prompt. */
  missing: string[];
  /** One-line explanation of the current state of this gate. */
  summary: string;
}

/* ── Evidence selectors ── */

const isSuccess = (event: LearningEvidenceEvent): boolean =>
  event.correctness === "correct" || event.correctness === "partial";

const isFullSuccess = (event: LearningEvidenceEvent): boolean => event.correctness === "correct";

/** Independent means the learner actually worked unaided, not merely that the
 *  ceiling allowed it. A learner who opened a hint is not independent even if
 *  the ceiling was 0. */
const isIndependent = (event: LearningEvidenceEvent): boolean =>
  event.supportLevel === 0 && event.hintExposure === 0;

const isLowSupport = (event: LearningEvidenceEvent): boolean =>
  event.supportLevel <= 1 && event.hintExposure <= 1;

const hasOwnWords = (event: LearningEvidenceEvent): boolean =>
  event.evidenceType === "explanation" && event.response.trim().length >= MIN_EXPLANATION_CHARS;

/** Distinct task families, so three attempts at the same item never look like
 *  three items. This is the single most common way apparent fluency is faked. */
function distinctFamilies(events: LearningEvidenceEvent[]): number {
  return new Set(events.map((event) => event.taskFamily)).size;
}

function result(
  satisfied: boolean,
  satisfiedBy: LearningEvidenceEvent[],
  missing: string[],
  summary: string
): StagePredicateResult {
  return {
    satisfied,
    satisfiedByEvidenceIds: satisfied ? satisfiedBy.map((event) => event.evidenceId) : [],
    missing: satisfied ? [] : missing,
    summary,
  };
}

/* ── Per-stage predicates ── */

/**
 * Encounter: the learner has a mental picture.
 *
 * Operationalized as a committed prediction plus a reported observation. The
 * prediction must be locked before the reveal, which is why `prediction`
 * evidence only exists when the widget enforced the lock — an unlocked guess
 * after seeing the answer is not a prediction and never enters the ledger as one.
 * Correctness of the prediction is deliberately NOT required: being wrong about
 * a prediction you committed to is exactly how Encounter is supposed to work.
 */
function encounterPredicate(events: LearningEvidenceEvent[]): StagePredicateResult {
  const predictions = events.filter((event) => event.evidenceType === "prediction");
  const observations = events.filter(
    (event) => event.evidenceType === "observation" && isSuccess(event)
  );

  const missing: string[] = [];
  if (predictions.length === 0) missing.push("a prediction the learner committed to BEFORE the result was revealed");
  if (observations.length === 0) missing.push("the learner correctly identifying what actually happened");

  const satisfied = missing.length === 0;
  return result(
    satisfied,
    [...predictions.slice(0, 1), ...observations.slice(0, 1)],
    missing,
    satisfied
      ? "Encounter satisfied: the learner committed to a prediction and read the result."
      : `Encounter not satisfied. Still needed: ${missing.join("; ")}.`
  );
}

/**
 * Understand: the learner can say what it is, why it works, and when it matters.
 *
 * Requires BOTH an own-words mechanism explanation and a contrast-pair
 * discrimination. The contrast pair is what separates understanding from
 * fluent-sounding restatement: a learner who has memorized the explanation can
 * produce it, but cannot say which of two near-identical cases behaves
 * differently and why.
 */
function understandPredicate(events: LearningEvidenceEvent[]): StagePredicateResult {
  const explanations = events.filter((event) => hasOwnWords(event) && isSuccess(event));
  const discriminations = events.filter(
    (event) =>
      isSuccess(event) &&
      (event.contextVariant === "changed_representation" || event.contextVariant === "changed_constraints") &&
      (event.evidenceType === "selection" || event.evidenceType === "explanation")
  );

  const missing: string[] = [];
  if (explanations.length === 0) {
    missing.push("the mechanism explained in the learner's own words (not a restatement of yours)");
  }
  if (discriminations.length === 0) {
    missing.push("a contrast pair correctly discriminated — which case differs, and why");
  }

  const satisfied = missing.length === 0;
  return result(
    satisfied,
    [...explanations.slice(0, 1), ...discriminations.slice(0, 1)],
    missing,
    satisfied
      ? "Understand satisfied: mechanism stated in own words and a contrast pair discriminated."
      : `Understand not satisfied. Still needed: ${missing.join("; ")}.`
  );
}

/**
 * Construct: the learner can solve a standard problem with minimal hints.
 *
 * Two critical steps produced at support level <= 1, in distinct task families.
 * "Critical step" is operationalized as a `construction` or `procedure` event:
 * selecting from options is not constructing, so recognition evidence cannot
 * satisfy this gate no matter how much of it accumulates.
 */
function constructPredicate(events: LearningEvidenceEvent[]): StagePredicateResult {
  const steps = events.filter(
    (event) =>
      (event.evidenceType === "construction" || event.evidenceType === "procedure") &&
      isSuccess(event) &&
      isLowSupport(event)
  );
  const families = distinctFamilies(steps);

  const missing: string[] = [];
  if (families < CONSTRUCT_CRITICAL_STEPS_REQUIRED) {
    missing.push(
      `${CONSTRUCT_CRITICAL_STEPS_REQUIRED - families} more critical step(s) the learner produced themselves at support level 1 or lower, on a different task family (have ${families})`
    );
  }

  const satisfied = missing.length === 0;
  return result(
    satisfied,
    steps.slice(0, CONSTRUCT_CRITICAL_STEPS_REQUIRED),
    missing,
    satisfied
      ? `Construct satisfied: ${families} critical steps produced at low support.`
      : `Construct not satisfied. Still needed: ${missing.join("; ")}.`
  );
}

/**
 * Apply: the learner reliably solves ordinary problems unled.
 *
 * Three fully-correct, genuinely independent items across distinct task
 * families. Partial credit does not count here — "reliably" is the word in the
 * exit condition, and a partially correct procedure is not reliable execution.
 */
function applyPredicate(events: LearningEvidenceEvent[]): StagePredicateResult {
  const independent = events.filter(
    (event) =>
      isFullSuccess(event) &&
      isIndependent(event) &&
      (event.evidenceType === "procedure" || event.evidenceType === "construction")
  );
  const families = distinctFamilies(independent);

  const missing: string[] = [];
  if (families < APPLY_INDEPENDENT_ITEMS_REQUIRED) {
    missing.push(
      `${APPLY_INDEPENDENT_ITEMS_REQUIRED - families} more standard item(s) solved with NO hints and no leading questions, each from a different task family (have ${families})`
    );
  }

  const satisfied = missing.length === 0;
  return result(
    satisfied,
    independent.slice(0, APPLY_INDEPENDENT_ITEMS_REQUIRED),
    missing,
    satisfied
      ? `Apply satisfied: ${families} independent successes across distinct task families.`
      : `Apply not satisfied. Still needed: ${missing.join("; ")}.`
  );
}

/**
 * Transfer: the learner recognizes the idea when it does not look familiar.
 *
 * Success on a genuinely changed representation or context, PLUS a justification.
 * The justification requirement is what stops a lucky pattern-match from
 * counting: getting the unfamiliar problem right without being able to say why
 * the idea applies is not transfer, it is a coincidence.
 */
function transferPredicate(events: LearningEvidenceEvent[]): StagePredicateResult {
  const novelSuccesses = events.filter(
    (event) =>
      isFullSuccess(event) &&
      event.supportLevel <= 1 &&
      (event.contextVariant === "changed_representation" ||
        event.contextVariant === "changed_context" ||
        event.contextVariant === "changed_constraints") &&
      (event.evidenceType === "transfer" || event.evidenceType === "construction" || event.evidenceType === "procedure")
  );

  // The justification may arrive as its own explanation event in the same
  // task family, which is how a "solve it, then say why" activity records.
  const novelFamilies = new Set(novelSuccesses.map((event) => event.taskFamily));
  const justifications = events.filter(
    (event) => hasOwnWords(event) && isSuccess(event) && novelFamilies.has(event.taskFamily)
  );

  const missing: string[] = [];
  if (novelSuccesses.length === 0) {
    missing.push("a correct solution on a changed representation, context, or constraint set at support level 1 or lower");
  } else if (justifications.length === 0) {
    missing.push("the learner's justification for WHY the idea applies in that unfamiliar setting");
  }

  const satisfied = missing.length === 0;
  return result(
    satisfied,
    [...novelSuccesses.slice(0, 1), ...justifications.slice(0, 1)],
    missing,
    satisfied
      ? "Transfer satisfied: novel-setting success with the learner's own justification."
      : `Transfer not satisfied. Still needed: ${missing.join("; ")}.`
  );
}

/**
 * Master: the learner does not need the tutor.
 *
 * The only gate that requires DELAYED evidence. Everything before this can be
 * satisfied inside one session; mastery cannot, because the claim being made is
 * about retention and retention is not observable in the moment. This is why
 * `delayed` exists as a field on the ledger.
 */
function masterPredicate(events: LearningEvidenceEvent[]): StagePredicateResult {
  const delayedRetrieval = events.filter(
    (event) => event.delayed && event.evidenceType === "retrieval" && isFullSuccess(event) && isIndependent(event)
  );
  const unaidedTransfer = events.filter(
    (event) =>
      isFullSuccess(event) &&
      isIndependent(event) &&
      (event.evidenceType === "transfer" || event.contextVariant === "changed_context")
  );

  const missing: string[] = [];
  if (delayedRetrieval.length === 0) {
    missing.push("a successful unaided retrieval AFTER a scheduled delay (not in the same session as teaching)");
  }
  if (unaidedTransfer.length === 0) {
    missing.push("an unaided success in a changed context");
  }

  const satisfied = missing.length === 0;
  return result(
    satisfied,
    [...delayedRetrieval.slice(0, 1), ...unaidedTransfer.slice(0, 1)],
    missing,
    satisfied
      ? "Master satisfied: delayed unaided retrieval plus unaided transfer."
      : `Master not satisfied. Still needed: ${missing.join("; ")}.`
  );
}

const STAGE_PREDICATES: Record<MasteryStage, (events: LearningEvidenceEvent[]) => StagePredicateResult> = {
  encounter: encounterPredicate,
  understand: understandPredicate,
  construct: constructPredicate,
  apply: applyPredicate,
  transfer: transferPredicate,
  master: masterPredicate,
};

/**
 * Evaluate one stage's exit condition against the ledger.
 *
 * Only evidence for the given skill is considered, and only evidence recorded
 * at or after the stage was entered — evidence that justified entering a stage
 * cannot also justify leaving it.
 */
export function evaluateStageExit(
  stage: MasteryStage,
  events: LearningEvidenceEvent[]
): StagePredicateResult {
  return STAGE_PREDICATES[stage](events);
}

/**
 * The highest stage whose exit condition the ledger supports, plus every
 * predicate's current state.
 *
 * Used by the planner to work out which evidence is missing, and by the prompt
 * to tell the model precisely what would count — rather than leaving it to
 * guess and then rejecting its guess.
 */
export function evaluateAllStages(
  events: LearningEvidenceEvent[]
): Record<MasteryStage, StagePredicateResult> {
  const out = {} as Record<MasteryStage, StagePredicateResult>;
  for (const stage of MASTERY_STAGES) {
    out[stage] = evaluateStageExit(stage, events);
  }
  return out;
}

/**
 * Resolve the stage a skill should now be in, from evidence alone.
 *
 * Walks forward from the current stage for as long as exit conditions are
 * satisfied. Advancement is one-way here; regression is a separate decision
 * driven by observed failure (see `policy.ts`), because dropping a learner back
 * requires a reason, not merely the absence of one.
 */
export function resolveStageFromEvidence(
  current: MasteryStage,
  events: LearningEvidenceEvent[]
): { stage: MasteryStage; advancedBy: string[]; blockedBy: string[] } {
  let stage = current;
  const advancedBy: string[] = [];

  for (;;) {
    const index = MASTERY_STAGES.indexOf(stage);
    if (index < 0 || index >= MASTERY_STAGES.length - 1) break;
    const verdict = evaluateStageExit(stage, events);
    if (!verdict.satisfied) {
      return { stage, advancedBy, blockedBy: verdict.missing };
    }
    advancedBy.push(...verdict.satisfiedByEvidenceIds);
    stage = MASTERY_STAGES[index + 1];
  }

  const finalVerdict = evaluateStageExit(stage, events);
  return { stage, advancedBy, blockedBy: finalVerdict.satisfied ? [] : finalVerdict.missing };
}

/** Compact per-stage status for the tutor prompt. */
export function formatStageGateStatus(stage: MasteryStage, events: LearningEvidenceEvent[]): string {
  const verdict = evaluateStageExit(stage, events);
  if (verdict.satisfied) {
    return `STAGE GATE (${stage}): SATISFIED by recorded evidence. The engine will advance the skill; you do not need to argue for it.`;
  }
  return (
    `STAGE GATE (${stage}): NOT satisfied. The engine advances this skill only when the ledger contains:\n` +
    verdict.missing.map((item) => `  - ${item}`).join("\n") +
    `\nAsserting readiness in your response does not advance the stage. Producing the missing evidence does.`
  );
}

/** Skills whose current stage gate is satisfied, for batch advancement. */
export function stageIsSatisfied(state: SkillState, events: LearningEvidenceEvent[]): boolean {
  return evaluateStageExit(state.stage, events).satisfied;
}
