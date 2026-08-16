/**
 * Deriving skill state from the evidence ledger.
 *
 * The rule this module exists to enforce: **mastery numbers are computed, never
 * asserted**. Previously a `mastery_card` carried five percentages the model had
 * written, and the app rendered a verdict computed from the model's own opinion
 * of the learner. That is not a gate; it is a mirror.
 *
 * Here the five dimensions are functions of recorded observations. The scoring
 * rules encode the pedagogy directly:
 *
 *  - Recognition is worth less than production. A `selection` event contributes
 *    a fraction of what a `construction` event does, because choosing among four
 *    options is not the same act as building the answer.
 *  - **Support caps credit.** Success at support level 3 contributes to
 *    procedure but contributes *nothing* to independence, and it cannot be
 *    laundered into independence by repetition.
 *  - Transfer is only credited by genuinely changed tasks. Doing the same
 *    problem with different numbers is practice, not transfer.
 *  - Recall is only credited by retrieval, and delayed retrieval counts far more
 *    than immediate — reproducing something ninety seconds after being told it
 *    is not memory.
 *  - Evidence decays. An observation from six weeks ago is weaker evidence about
 *    the learner *now* than one from today.
 */

import { MASTERY_STAGES, retrievalIntervalDays, type MasteryStage } from "../mastery";
import type { MasteryEvidence } from "../widgets/types";
import { resolveStageFromEvidence } from "./predicates";
import {
  emptySkillState,
  type Correctness,
  type EvidenceType,
  type LearningEvidenceEvent,
  type SkillState,
  type SupportLevel,
} from "./types";

/* ── Weighting ── */

/**
 * How much credit a success of each evidence type carries, per dimension.
 *
 * Read this table as the pedagogy of the app in numeric form. The zeroes matter
 * as much as the ones: `selection` contributes 0 to procedure because choosing
 * the right answer is not evidence that you can carry out the method, and
 * `observation` contributes 0 to everything but understanding because watching
 * is not doing.
 */
const EVIDENCE_WEIGHTS: Record<
  EvidenceType,
  { recall: number; understanding: number; procedure: number; transfer: number }
> = {
  prediction:    { recall: 0,    understanding: 0.35, procedure: 0,    transfer: 0 },
  observation:   { recall: 0,    understanding: 0.25, procedure: 0,    transfer: 0 },
  construction:  { recall: 0.15, understanding: 0.5,  procedure: 1,    transfer: 0 },
  selection:     { recall: 0.25, understanding: 0.3,  procedure: 0,    transfer: 0 },
  procedure:     { recall: 0.1,  understanding: 0.25, procedure: 1,    transfer: 0 },
  explanation:   { recall: 0.2,  understanding: 1,    procedure: 0,    transfer: 0 },
  transfer:      { recall: 0.1,  understanding: 0.6,  procedure: 0.5,  transfer: 1 },
  retrieval:     { recall: 1,    understanding: 0.2,  procedure: 0.3,  transfer: 0 },
};

/**
 * How much a success counts given the support that produced it.
 *
 * Note that level 3 is not zero across the board — a learner who completes a
 * procedure after being shown a step HAS practised the procedure, and pretending
 * otherwise would make the model unable to see progress. What level 3 forfeits
 * is *independence*, which is handled separately and absolutely.
 */
const SUPPORT_CREDIT: Record<SupportLevel, number> = {
  0: 1,
  1: 0.85,
  2: 0.6,
  3: 0.35,
};

/** Partial credit is credit, but it is not full credit. */
const CORRECTNESS_CREDIT: Record<Correctness, number> = {
  correct: 1,
  partial: 0.5,
  incorrect: 0,
  blank: 0,
  unknown: 0,
};

/** Changed tasks are what transfer means; same-task repetition is not. */
const VARIANT_TRANSFER_MULTIPLIER: Record<string, number> = {
  same: 0,
  changed_numbers: 0.2,
  changed_representation: 1,
  changed_context: 1,
  changed_constraints: 0.9,
};

/** Delayed retrieval is the only retrieval that tests memory. */
const DELAY_RECALL_MULTIPLIER = 2.5;

/** Evidence half-life in days. */
export const EVIDENCE_HALF_LIFE_DAYS = 45;

/** How many successes saturate a dimension. Set so a learner needs a genuine
 *  body of evidence to reach the 85% mastery threshold, not one good turn. */
const SATURATION = 4;

function recencyWeight(event: LearningEvidenceEvent, now: number): number {
  const age = now - new Date(event.timestamp).getTime();
  if (!Number.isFinite(age) || age <= 0) return 1;
  const days = age / 86_400_000;
  return Math.pow(0.5, days / EVIDENCE_HALF_LIFE_DAYS);
}

/**
 * Saturating map from accumulated weight to a 0–100 score.
 *
 * Deliberately concave: the first piece of evidence moves the number a lot, the
 * tenth barely at all. Reaching a high score requires breadth across evidence
 * types rather than volume within one.
 */
function saturate(weight: number): number {
  if (weight <= 0) return 0;
  return Math.round(100 * (1 - Math.exp(-weight / (SATURATION / 2))));
}

/**
 * Penalty applied for recorded failures.
 *
 * Failures do not merely fail to add credit — they subtract it, because a
 * learner who gets three right and three wrong is not in the same state as one
 * who got three right and attempted nothing else.
 */
function failureWeight(event: LearningEvidenceEvent, now: number): number {
  if (event.correctness !== "incorrect") return 0;
  return recencyWeight(event, now) * (event.supportLevel >= 2 ? 1.4 : 1);
}

/* ── Independence ── */

/**
 * Independence is computed under a hard structural rule rather than as a score.
 *
 * The rule: **correct-after-hint never raises independence.** Not "raises it
 * less" — never raises it. An independence number that can be moved by a
 * supported success is exactly the number that lets a heavily-scaffolded learner
 * be told they are ready to work alone.
 *
 * On top of that, an outstanding reconstruction obligation caps independence.
 * Until the learner has redone the thing unaided on a near-but-not-identical
 * task, the support they received is still an open question about what they can
 * actually do.
 */
function computeIndependence(events: LearningEvidenceEvent[], now: number): {
  score: number;
  unaidedSuccesses: number;
  supportedSuccesses: number;
} {
  let unaidedWeight = 0;
  let unaidedSuccesses = 0;
  let supportedSuccesses = 0;
  let unaidedFailureWeight = 0;
  const unaidedFamilies = new Set<string>();

  for (const event of events) {
    const succeeded = event.correctness === "correct" || event.correctness === "partial";
    const genuinelyUnaided = event.supportLevel === 0 && event.hintExposure === 0;

    if (succeeded && !genuinelyUnaided) {
      supportedSuccesses += 1;
      continue; // Contributes exactly nothing to independence. By design.
    }
    if (!succeeded) {
      if (genuinelyUnaided) unaidedFailureWeight += failureWeight(event, now);
      continue;
    }

    unaidedSuccesses += 1;
    unaidedFamilies.add(event.taskFamily);
    unaidedWeight += recencyWeight(event, now) * CORRECTNESS_CREDIT[event.correctness];
  }

  // Breadth requirement: repeating one task family unaided demonstrates a habit,
  // not independence. Scale by how many distinct demands were met alone.
  const breadth = Math.min(1, unaidedFamilies.size / 3);
  const net = Math.max(0, unaidedWeight * (0.4 + 0.6 * breadth) - unaidedFailureWeight * 0.5);

  return { score: saturate(net), unaidedSuccesses, supportedSuccesses };
}

/* ── Public API ── */

export interface ComputedSkillEvidence extends MasteryEvidence {
  /** Evidence ids that produced these numbers, for the audit trail. */
  evidenceIds: string[];
  eventCount: number;
}

/**
 * Compute the five mastery dimensions for one skill from its evidence.
 *
 * This is the function that must be used wherever a mastery percentage is shown.
 * There is no code path in which a model-supplied number reaches the learner.
 */
export function computeSkillEvidence(
  events: LearningEvidenceEvent[],
  now: number = Date.now()
): ComputedSkillEvidence {
  let recall = 0;
  let understanding = 0;
  let procedure = 0;
  let transfer = 0;
  let recallFailure = 0;
  let understandingFailure = 0;
  let procedureFailure = 0;
  let transferFailure = 0;

  for (const event of events) {
    const credit = CORRECTNESS_CREDIT[event.correctness];
    const weights = EVIDENCE_WEIGHTS[event.evidenceType];
    const recency = recencyWeight(event, now);

    if (credit <= 0) {
      const penalty = failureWeight(event, now);
      if (weights.recall > 0) recallFailure += penalty * weights.recall;
      if (weights.understanding > 0) understandingFailure += penalty * weights.understanding;
      if (weights.procedure > 0) procedureFailure += penalty * weights.procedure;
      if (weights.transfer > 0) transferFailure += penalty * weights.transfer;
      continue;
    }

    const support = SUPPORT_CREDIT[event.supportLevel];
    const base = credit * support * recency;
    // A grader that is unsure produces weaker evidence than one that is certain.
    const confidence = typeof event.evaluatorConfidence === "number"
      ? Math.max(0.3, Math.min(1, event.evaluatorConfidence / 100))
      : 1;
    const scaled = base * confidence;

    recall += scaled * weights.recall * (event.delayed && event.evidenceType === "retrieval" ? DELAY_RECALL_MULTIPLIER : 1);
    understanding += scaled * weights.understanding;
    procedure += scaled * weights.procedure;
    transfer += scaled * weights.transfer * (VARIANT_TRANSFER_MULTIPLIER[event.contextVariant] ?? 0);
  }

  const independence = computeIndependence(events, now);

  return {
    recall: saturate(Math.max(0, recall - recallFailure * 0.5)),
    understanding: saturate(Math.max(0, understanding - understandingFailure * 0.5)),
    procedure: saturate(Math.max(0, procedure - procedureFailure * 0.5)),
    transfer: saturate(Math.max(0, transfer - transferFailure * 0.5)),
    independence: independence.score,
    evidenceIds: events.map((event) => event.evidenceId),
    eventCount: events.length,
  };
}

/**
 * Whether an event constitutes substantive support.
 *
 * Substantive support is the trigger for a mandatory unaided reconstruction. The
 * threshold is support level 2 (structural) rather than 3, because naming the
 * method for a learner is already enough to make their subsequent success
 * uninformative about whether they could have found it.
 */
export function isSubstantiveSupport(event: LearningEvidenceEvent): boolean {
  return event.supportLevel >= 2 || event.hintExposure >= 2;
}

/**
 * Recompute a skill's full state from its evidence.
 *
 * Pure and deterministic: the same ledger always yields the same state. This is
 * what makes the engine auditable and what lets a corrupted or disputed event be
 * removed and the state simply rebuilt.
 */
export function deriveSkillState(
  learnerId: string,
  skillId: string,
  events: LearningEvidenceEvent[],
  previous?: SkillState,
  now: number = Date.now()
): SkillState {
  const base = previous ?? emptySkillState(learnerId, skillId);
  const ordered = [...events].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  const computed = computeSkillEvidence(ordered, now);
  const independence = computeIndependence(ordered, now);

  // Stage is resolved from evidence, starting at encounter so that a rebuild
  // from the ledger never depends on the order the state was written in.
  const resolved = resolveStageFromEvidence("encounter", ordered);

  // A failure AFTER reaching a stage is grounds for regression. This is the one
  // place where the engine moves a learner backwards, and it requires a specific
  // observed failure rather than merely thin evidence.
  const stage = applyRegression(resolved.stage, ordered);

  const successfulRetrievals = ordered.filter(
    (event) => event.delayed && event.evidenceType === "retrieval" && event.correctness === "correct"
  ).length;

  // An owed reconstruction stays owed until an unaided success lands in that
  // family. Checking the ledger rather than trusting a flag means the obligation
  // cannot be lost by a dropped write.
  const reconstructionDueTaskFamily = findOutstandingReconstruction(ordered);

  const last = ordered[ordered.length - 1];

  return {
    ...base,
    learnerId,
    skillId,
    stage,
    stageEvidenceIds: resolved.advancedBy.slice(-6),
    recall: computed.recall,
    understanding: computed.understanding,
    procedure: computed.procedure,
    transfer: computed.transfer,
    independence: computed.independence,
    unaidedSuccesses: independence.unaidedSuccesses,
    supportedSuccesses: independence.supportedSuccesses,
    totalEvidenceCount: ordered.length,
    successfulRetrievals,
    reconstructionDueTaskFamily,
    lastEvidenceAt: last?.timestamp,
    updatedAt: new Date(now).toISOString(),
  };
}

/**
 * Drop the learner back when recent work contradicts their stage.
 *
 * A confident wrong answer at Apply sends the learner back to Understand — this
 * was in the prompt as an instruction to the model and is now a rule. Regression
 * looks at recent unaided failures only: being wrong while heavily scaffolded is
 * expected and is not evidence that the earlier stage collapsed.
 */
function applyRegression(stage: MasteryStage, events: LearningEvidenceEvent[]): MasteryStage {
  const recent = events.slice(-5);
  const unaidedFailures = recent.filter(
    (event) => event.correctness === "incorrect" && event.supportLevel <= 1
  );
  if (unaidedFailures.length < 2) return stage;

  const index = MASTERY_STAGES.indexOf(stage);
  if (index <= 0) return stage;

  // A failed DELAYED retrieval is forgetting, which lands at Understand for
  // targeted repair rather than restarting the ladder — the learner has not
  // lost the encounter.
  const forgot = unaidedFailures.some((event) => event.delayed && event.evidenceType === "retrieval");
  if (forgot) return MASTERY_STAGES[Math.min(index, MASTERY_STAGES.indexOf("understand"))];

  return MASTERY_STAGES[index - 1];
}

/**
 * The task family the learner still owes an unaided reconstruction on.
 *
 * Scans forward: substantive support opens an obligation on that family, and an
 * unaided success in the same family closes it. The most recent still-open
 * obligation is returned. Only one is tracked at a time on purpose — stacking
 * reconstruction debt would turn a lesson into an audit.
 */
export function findOutstandingReconstruction(events: LearningEvidenceEvent[]): string | undefined {
  const open = new Map<string, string>();

  for (const event of events) {
    if (isSubstantiveSupport(event)) {
      open.set(event.taskFamily, event.evidenceId);
    }
    const unaidedSuccess =
      event.supportLevel === 0 && event.hintExposure === 0 && event.correctness === "correct";
    if (unaidedSuccess) open.delete(event.taskFamily);
  }

  const families = [...open.keys()];
  return families.length > 0 ? families[families.length - 1] : undefined;
}

/**
 * When the next retrieval of this skill should happen.
 *
 * Wraps the existing spacing schedule, which previously computed intervals that
 * nothing acted on.
 */
export function nextReviewDueAt(state: SkillState, from: Date = new Date()): Date {
  const days = retrievalIntervalDays(state.successfulRetrievals);
  const next = new Date(from.getTime());
  next.setDate(next.getDate() + days);
  return next;
}

/** Strip derived-only fields for rendering as widget-shaped evidence. */
export function toMasteryEvidence(state: SkillState): MasteryEvidence {
  return {
    recall: state.recall,
    understanding: state.understanding,
    procedure: state.procedure,
    transfer: state.transfer,
    independence: state.independence,
  };
}
