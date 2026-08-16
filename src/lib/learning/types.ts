/**
 * The instructional policy engine's vocabulary.
 *
 * This module is the single home for the types that make Studyus evidence-led
 * rather than prompt-directed. The thesis it encodes:
 *
 *   The policy engine decides what evidence is missing and which learning move
 *   is warranted. The LLM decides how to explain, question, represent, and
 *   encourage within that policy.
 *
 * Everything here is deliberately renderer-agnostic. A `LearningActivityContract`
 * names target skills, a stage, a mode, a task family, a support ceiling and the
 * evidence the activity is expected to produce — it never names a widget
 * component, a chart library, or a DOM shape. `visualization/router.ts` remains
 * the sole renderer authority and must stay unaware that this module exists.
 *
 * Three invariants are load-bearing and are enforced in code elsewhere in this
 * directory rather than requested of the model in a prompt:
 *
 *  1. Mastery percentages are COMPUTED from the evidence ledger. A model may
 *     report observations; it may never author a mastery number.
 *  2. Correct-after-hint never raises independence, and substantive support
 *     always schedules an unaided reconstruction on a near-but-not-identical
 *     task.
 *  3. Interaction telemetry (drags, playback scrubs, camera moves, viewport
 *     changes, legend toggles) is CONTEXT, never evidence.
 */

import type { MasteryStage } from "../mastery";
import type { WidgetKind } from "../widgets/types";

/* ─────────────────────────────────────────────────────────────
   Activity contract
   ───────────────────────────────────────────────────────────── */

/**
 * What an activity is for, instructionally.
 *
 * `mode` is the pedagogical posture of the activity, and it constrains what the
 * resulting evidence is allowed to mean. A correct answer produced in
 * `guided_practice` is not the same fact about the learner as the same answer
 * produced in `independent_practice`, and the ledger must be able to tell them
 * apart years later.
 */
export const ACTIVITY_MODES = [
  "diagnostic",
  "explore",
  "guided_practice",
  "independent_practice",
  "transfer",
  "retrieval",
  "repair",
] as const;

export type ActivityMode = typeof ACTIVITY_MODES[number];

/**
 * How far this task has been moved from the one the skill was taught on.
 *
 * Transfer claims are only meaningful relative to this. "The learner can apply
 * it" means nothing without knowing whether the numbers, the representation,
 * the context, or the constraints changed.
 */
export const CONTEXT_VARIANTS = [
  "same",
  "changed_numbers",
  "changed_representation",
  "changed_context",
  "changed_constraints",
] as const;

export type ContextVariant = typeof CONTEXT_VARIANTS[number];

/**
 * The support ceiling for an activity, as a hard cap rather than a suggestion.
 *
 *  0 — unaided. No hints, no worked steps, no leading questions.
 *  1 — orientation only. A nudge toward where to look; never a step.
 *  2 — structural. Name the method or decompose the problem, not the answer.
 *  3 — worked. A step may be shown, and independence evidence is forfeited.
 */
export type SupportLevel = 0 | 1 | 2 | 3;

export const SUPPORT_LEVELS: readonly SupportLevel[] = [0, 1, 2, 3];

export const SUPPORT_LEVEL_LABEL: Record<SupportLevel, string> = {
  0: "unaided",
  1: "orientation only",
  2: "structural",
  3: "worked step permitted",
};

export const SUPPORT_LEVEL_MEANING: Record<SupportLevel, string> = {
  0: "No hints, no worked steps, no leading questions. The learner must produce the whole response themselves.",
  1: "You may orient the learner toward where to look or which idea is relevant. You may not name the method or perform a step.",
  2: "You may name the method or decompose the problem into sub-steps. You may not execute any step that carries the answer.",
  3: "You may demonstrate a step. Independence evidence is forfeited for this task and an unaided reconstruction becomes mandatory.",
};

/**
 * The kind of cognitive act an activity asks for.
 *
 * This is what distinguishes evidence types from each other in the ledger. A
 * learner who can select the right answer and a learner who can construct it
 * are in different states, and averaging them is how poor understanding hides
 * behind good recognition.
 */
export const EVIDENCE_TYPES = [
  "prediction",
  "observation",
  "construction",
  "selection",
  "procedure",
  "explanation",
  "transfer",
  "retrieval",
] as const;

export type EvidenceType = typeof EVIDENCE_TYPES[number];

export const EVIDENCE_TYPE_MEANING: Record<EvidenceType, string> = {
  prediction: "The learner committed to an outcome BEFORE seeing it. Only counts when locked before the reveal.",
  observation: "The learner reported what actually happened in a representation they controlled.",
  construction: "The learner built the object, expression, or argument themselves.",
  selection: "The learner chose among supplied options. Weakest evidence type; recognition is not production.",
  procedure: "The learner executed a method accurately end to end.",
  explanation: "The learner stated the mechanism in their own words, not a restatement of yours.",
  transfer: "The learner succeeded on a changed representation, context, or constraint set.",
  retrieval: "The learner produced it from memory after a delay, unaided.",
};

/**
 * The role a representation plays in an activity.
 *
 * Declared per representation so the board can never become decorative. A
 * representation with no role is not placed.
 */
export const REPRESENTATION_ROLES = [
  "introduce",
  "contrast",
  "decompose",
  "quantify",
  "verify",
  "abstract",
] as const;

export type RepresentationRole = typeof REPRESENTATION_ROLES[number];

export const REPRESENTATION_ROLE_MEANING: Record<RepresentationRole, string> = {
  introduce: "Give the learner a first concrete referent for an idea they have not met.",
  contrast: "Place two cases side by side so the learner can see which feature actually matters.",
  decompose: "Break a compound object or procedure into the parts that can be reasoned about separately.",
  quantify: "Attach numbers, scales, or units so a qualitative intuition becomes checkable.",
  verify: "Let the learner test their own claim against something they did not author.",
  abstract: "Move from the worked instance to the general statement.",
};

/** A representation the activity places, with its declared instructional role. */
export interface RepresentationAssignment {
  /** Widget kind or visualization intent type. Semantic, never a component name. */
  representation: string;
  role: RepresentationRole;
  /** Why THIS representation rather than speech alone. */
  rationale?: string;
}

/**
 * The contract an instructional activity is placed under.
 *
 * Every widget and visualization the tutor places belongs to exactly one
 * contract. The contract is what makes the resulting learner interaction
 * interpretable as evidence: without it, "the learner answered B" is a click,
 * and with it, it is a `selection` on skill `s.deriv.chain` at support ceiling 1
 * in a `changed_representation` variant.
 */
export interface LearningActivityContract {
  /** Stable id, referenced by every evidence event the activity produces. */
  activityId: string;
  /** Skills this activity is evidence about. At least one. */
  targetSkillIds: string[];
  stage: MasteryStage;
  mode: ActivityMode;
  /** The planner route this activity was placed to serve. Stage predicates read
   *  it — "the learner discriminated a contrast pair" is only checkable if the
   *  ledger knows which activity was the contrast pair. */
  route?: LearningRoute;
  /** Groups tasks that are interchangeable instances of the same demand, so a
   *  reconstruction can be scheduled on a near-but-not-identical sibling. */
  taskFamily: string;
  contextVariant: ContextVariant;
  supportCeiling: SupportLevel;
  /** The evidence types this activity is designed to produce. */
  expectedEvidence: EvidenceType[];
  /** Observable, machine-checkable-where-possible success criteria. */
  successCriteria: string[];
  /** Declared role for each representation placed. */
  representationRoles: RepresentationAssignment[];
  /** Widget kinds the policy permits for this activity, if constrained. */
  permittedWidgetKinds?: WidgetKind[];
  createdAt: string;
}

/* ─────────────────────────────────────────────────────────────
   Evidence ledger
   ───────────────────────────────────────────────────────────── */

/** Where an evidence event came from. */
export const EVIDENCE_SOURCES = [
  "widget",
  "assessment",
  "tutor_turn",
  "review",
] as const;

export type EvidenceSource = typeof EVIDENCE_SOURCES[number];

/**
 * Correctness as a four-state fact, not a boolean.
 *
 * `unknown` and `blank` are distinct from `incorrect` on purpose: a blank
 * response is not a wrong answer, and treating it as one manufactures evidence
 * of a misconception the learner never expressed.
 */
export const CORRECTNESS_VALUES = ["correct", "partial", "incorrect", "blank", "unknown"] as const;

export type Correctness = typeof CORRECTNESS_VALUES[number];

/**
 * One immutable observation about one learner on one or more skills.
 *
 * This is the atom the whole engine is built from. Skill states, mastery
 * verdicts, review scheduling, and hypothesis support are all DERIVED from
 * these rows; none of them is ever written by the model directly.
 */
export interface LearningEvidenceEvent {
  evidenceId: string;
  learnerId: string;
  skillIds: string[];
  /** The specific task instance. */
  taskId: string;
  /** The interchangeable-instance family the task belongs to. */
  taskFamily: string;
  contextVariant: ContextVariant;
  /** The activity contract this event was produced under, when there was one. */
  activityId?: string;
  sessionId?: string;
  evidenceType: EvidenceType;
  /** The learner's actual response, bounded. Kept so a verdict can be audited. */
  response: string;
  correctness: Correctness;
  /** Rubric criteria this event bears on, for assessment-sourced evidence. */
  rubricCriterionIds: string[];
  /** Support actually in force when the response was produced. */
  supportLevel: SupportLevel;
  /** Highest hint level the learner actually opened. Distinct from the ceiling:
   *  a learner may work unaided under a ceiling of 2. */
  hintExposure: number;
  responseTimeMs?: number;
  /** 0–100, learner-reported. Compared against correctness to detect
   *  over/under-confidence. Never used as evidence of knowledge. */
  selfRatedConfidence?: number;
  /** 0–100. How much the grader trusts its own judgement of this response. */
  evaluatorConfidence?: number;
  /** True when produced after a scheduled delay rather than in-lesson. Delayed
   *  unaided retrieval is the only evidence that supports a Master claim. */
  delayed: boolean;
  source: EvidenceSource;
  timestamp: string;
}

/** The subset a caller must supply; the ledger fills in the rest. */
export type LearningEvidenceInput =
  Omit<LearningEvidenceEvent, "evidenceId" | "learnerId" | "timestamp" | "delayed" | "rubricCriterionIds" | "hintExposure"> &
  Partial<Pick<LearningEvidenceEvent, "evidenceId" | "learnerId" | "timestamp" | "delayed" | "rubricCriterionIds" | "hintExposure">>;

/* ─────────────────────────────────────────────────────────────
   Skill state
   ───────────────────────────────────────────────────────────── */

/**
 * The computed state of one learner on one skill.
 *
 * Every field here is a function of the evidence ledger. Recomputing this from
 * scratch must always yield the same answer — that is what makes it auditable
 * and what stops a persuasive model turn from inflating it.
 */
export interface SkillState {
  learnerId: string;
  skillId: string;
  /** Per-skill position on the ladder. Replaces the old per-SESSION stage. */
  stage: MasteryStage;
  /** Evidence that justified entry into the current stage. */
  stageEvidenceIds: string[];
  /** Computed 0–100 per mastery dimension. Never model-authored. */
  recall: number;
  understanding: number;
  procedure: number;
  transfer: number;
  independence: number;
  /** Count of unaided successes at support level 0. */
  unaidedSuccesses: number;
  /** Count of successes that required support level >= 2. */
  supportedSuccesses: number;
  totalEvidenceCount: number;
  /** Successful DELAYED retrievals. Drives the spacing interval index. */
  successfulRetrievals: number;
  /** Set when substantive support was given and the reconstruction is not yet
   *  satisfied. Blocks independence credit until cleared. */
  reconstructionDueTaskFamily?: string;
  lastEvidenceAt?: string;
  updatedAt: string;
}

export function emptySkillState(learnerId: string, skillId: string): SkillState {
  return {
    learnerId,
    skillId,
    stage: "encounter",
    stageEvidenceIds: [],
    recall: 0,
    understanding: 0,
    procedure: 0,
    transfer: 0,
    independence: 0,
    unaidedSuccesses: 0,
    supportedSuccesses: 0,
    totalEvidenceCount: 0,
    successfulRetrievals: 0,
    updatedAt: new Date().toISOString(),
  };
}

/* ─────────────────────────────────────────────────────────────
   Learner-model hypotheses
   ───────────────────────────────────────────────────────────── */

/**
 * What kind of problem a hypothesis proposes.
 *
 * The distinction is instructionally decisive and is exactly what free-text
 * learner-model statements erase. A misconception needs a contrast case; a
 * missing prerequisite needs prerequisite repair; a procedural slip needs
 * practice; a careless error needs neither and re-teaching it is insulting.
 */
export const HYPOTHESIS_KINDS = [
  "misconception",
  "missing_prerequisite",
  "procedural_slip",
  "careless_error",
  "language_issue",
  "low_confidence",
  "overconfidence",
  "disengagement",
] as const;

export type HypothesisKind = typeof HYPOTHESIS_KINDS[number];

export const HYPOTHESIS_KIND_REMEDY: Record<HypothesisKind, string> = {
  misconception: "A specific wrong belief is producing consistent wrong answers. Repair with a contrast case that makes the belief fail visibly. Re-explaining the correct rule does not touch it.",
  missing_prerequisite: "An earlier skill is absent. Drop to the prerequisite and verify it before returning. Continuing at this level will keep failing.",
  procedural_slip: "The method is understood but execution is unreliable. Needs spaced practice on the procedure, not re-explanation of the concept.",
  careless_error: "A one-off execution error with no pattern behind it. Point at it and move on. Re-teaching is a misdiagnosis.",
  language_issue: "The obstacle is terminology or phrasing, not the idea. Rephrase or define; do not reteach the concept.",
  low_confidence: "The learner can do it but does not trust that they can. Needs unaided success they can see, not more help.",
  overconfidence: "The learner rates themselves above their evidence. Needs a discriminating task whose failure is informative.",
  disengagement: "Responses have gone short, blank, or perfunctory. Change the demand; do not escalate it.",
};

export const HYPOTHESIS_STATUSES = ["suspected", "supported", "resolved", "disputed"] as const;

export type HypothesisStatus = typeof HYPOTHESIS_STATUSES[number];

/**
 * A revisable, skill-linked, testable claim about the learner.
 *
 * The critical field is `nextBestTest`. A hypothesis with no test attached is a
 * label, and labels accumulate into a learner model that nothing can ever
 * remove. Every hypothesis must name the observation that would confirm or kill
 * it.
 */
export interface LearnerHypothesis {
  hypothesisId: string;
  learnerId: string;
  skillId: string;
  kind: HypothesisKind;
  /** The claim, stated so it could be wrong. */
  statement: string;
  status: HypothesisStatus;
  /** Evidence event ids supporting the claim. */
  supportingEvidenceIds: string[];
  /** Evidence event ids that count against it. */
  contradictingEvidenceIds: string[];
  /** The observation that would confirm or refute this. Required. */
  nextBestTest: string;
  firstObserved: string;
  lastObserved: string;
  learnerDisputed: boolean;
  disputeNote?: string;
}

/* ─────────────────────────────────────────────────────────────
   Spaced review
   ───────────────────────────────────────────────────────────── */

export const REVIEW_TASK_STATES = ["scheduled", "due", "completed", "lapsed", "retired"] as const;

export type ReviewTaskState = typeof REVIEW_TASK_STATES[number];

export const RETRIEVAL_TYPES = ["free_recall", "cued_recall", "applied", "discrimination"] as const;

export type RetrievalType = typeof RETRIEVAL_TYPES[number];

/**
 * A scheduled retrieval obligation.
 *
 * The existing spacing helpers computed intervals that nothing ever acted on.
 * This is the row that makes the schedule real: it persists, it comes due, it is
 * surfaced at session start, and failing it routes the learner into targeted
 * repair rather than a restart.
 */
export interface ReviewTask {
  reviewId: string;
  learnerId: string;
  skillId: string;
  /** Family to draw the review item from — never the identical task instance. */
  taskFamily: string;
  dueAt: string;
  /** Index into RETRIEVAL_SPACING_DAYS. Advances on pass, resets on fail. */
  intervalIndex: number;
  state: ReviewTaskState;
  /** Reviews are unaided by definition. Kept explicit so the ceiling is
   *  enforced by data rather than by remembering to. */
  requiredMode: "unaided";
  retrievalType: RetrievalType;
  /** Set when this review exists because support was given and an unaided
   *  reconstruction is owed. */
  reconstruction: boolean;
  createdAt: string;
  lastAttemptedAt?: string;
  attemptCount: number;
}

/* ─────────────────────────────────────────────────────────────
   The planner's output
   ───────────────────────────────────────────────────────────── */

/**
 * The instructional move the policy engine has decided is warranted.
 *
 * This is the whole point of the refactor. The tutor prompt no longer asks the
 * model to decide what to do next; it tells the model what move the evidence
 * requires and leaves the model free to decide how to make that move well.
 */
export const LEARNING_ROUTES = [
  "diagnostic_probe",
  "prediction",
  "contrast_case",
  "prerequisite_repair",
  "faded_example",
  "guided_retry",
  "independent_practice",
  "transfer_check",
  "due_retrieval",
] as const;

export type LearningRoute = typeof LEARNING_ROUTES[number];

export const LEARNING_ROUTE_INSTRUCTION: Record<LearningRoute, string> = {
  diagnostic_probe:
    "You do not yet know where the learner actually is. Ask the one question whose answer discriminates between the competing explanations. Do not teach first — a probe that follows an explanation measures your explanation, not their knowledge.",
  prediction:
    "Make the learner commit to an outcome BEFORE anything is revealed. Lock the prediction, then show the result. An unlocked prediction produces no evidence, and revealing first destroys the only chance to get it.",
  contrast_case:
    "A specific wrong belief is in play. Place two cases that differ ONLY in the feature that matters and ask which behaves differently and why. Restating the correct rule will not dislodge the belief; watching it fail will.",
  prerequisite_repair:
    "An earlier skill is missing and is causing the failures at this level. Drop to that prerequisite, verify it directly, and return only once it holds. Do not keep pushing the current skill.",
  faded_example:
    "Show the reasoning with the critical step left for the learner. Each successive example must leave more to them. A fully worked example at this point teaches copying.",
  guided_retry:
    "The learner has attempted and missed. Hand the SAME demand back with the minimum support that unblocks them, and no more. Do not re-explain from the beginning and do not complete the step.",
  independent_practice:
    "The learner can do this with help; now find out whether they can do it without. Support ceiling is binding — no hints, no leading questions, no worked steps, even if they ask.",
  transfer_check:
    "Change the representation, context, or constraints while holding the underlying idea fixed. If the learner only pattern-matched, this is where it shows. Require the justification, not just the answer.",
  due_retrieval:
    "A scheduled retrieval is due. Surface it before new teaching, unaided. Its outcome is evidence about retention, so do not coach it — a coached retrieval measures nothing.",
};

/**
 * A planned instructional move, with its justification traceable to evidence.
 *
 * `rationaleEvidenceIds` is what makes the engine auditable: every move can be
 * traced back to the specific observations that made it the right move.
 */
export interface NextLearningMove {
  route: LearningRoute;
  targetSkillIds: string[];
  stage: MasteryStage;
  mode: ActivityMode;
  contextVariant: ContextVariant;
  supportCeiling: SupportLevel;
  /** The evidence types this move must produce to be worth making. */
  requiredEvidence: EvidenceType[];
  /** Widget kinds the model may use for this move. */
  permittedWidgetKinds: WidgetKind[];
  /** Evidence events that justify this move. */
  rationaleEvidenceIds: string[];
  /** Human-readable justification, for the prompt and for the audit trail. */
  rationale: string;
  /** Set when the move is servicing a due review task. */
  reviewId?: string;
  /** Set when the move exists to discharge an owed reconstruction. */
  reconstructionTaskFamily?: string;
  /**
   * The task family this move's evidence must be filed under.
   *
   * Load-bearing for anything with an outstanding obligation. A review is
   * settled by matching `(skill, taskFamily)`, so a due retrieval whose
   * evidence lands under a route-derived family instead of the reviewed one
   * settles nothing: the review stays open, comes due again the next session,
   * and the learner is asked the same question forever while their answers
   * pile up somewhere the scheduler never looks.
   */
  taskFamily?: string;
}

/* ─────────────────────────────────────────────────────────────
   Skill graph
   ───────────────────────────────────────────────────────────── */

/**
 * A skill and its prerequisites.
 *
 * The curriculum sequence says what order material is PRESENTED in. The skill
 * graph says what depends on what. They are different claims and conflating
 * them is why "the learner is stuck on section 4" so often actually means "the
 * learner never had section 2's skill".
 */
export interface SkillNode {
  skillId: string;
  label: string;
  /** Skill ids that must hold before this one is teachable. */
  prerequisites: string[];
  /** Curriculum node this skill is taught under, when known. */
  curriculumNode?: string;
  description?: string;
}

export interface SkillGraph {
  nodes: Map<string, SkillNode>;
}

/** Prerequisites of a skill, nearest first, without cycling. */
export function prerequisiteChain(graph: SkillGraph, skillId: string, limit = 8): string[] {
  const seen = new Set<string>([skillId]);
  const out: string[] = [];
  let frontier = graph.nodes.get(skillId)?.prerequisites ?? [];

  while (frontier.length > 0 && out.length < limit) {
    const next: string[] = [];
    for (const id of frontier) {
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(id);
      if (out.length >= limit) break;
      next.push(...(graph.nodes.get(id)?.prerequisites ?? []));
    }
    frontier = next;
  }
  return out;
}

export function buildSkillGraph(nodes: SkillNode[]): SkillGraph {
  return { nodes: new Map(nodes.map((node) => [node.skillId, node])) };
}

/* ─────────────────────────────────────────────────────────────
   Guards
   ───────────────────────────────────────────────────────────── */

export function isActivityMode(value: unknown): value is ActivityMode {
  return typeof value === "string" && (ACTIVITY_MODES as readonly string[]).includes(value);
}

export function isContextVariant(value: unknown): value is ContextVariant {
  return typeof value === "string" && (CONTEXT_VARIANTS as readonly string[]).includes(value);
}

export function isEvidenceType(value: unknown): value is EvidenceType {
  return typeof value === "string" && (EVIDENCE_TYPES as readonly string[]).includes(value);
}

export function isCorrectness(value: unknown): value is Correctness {
  return typeof value === "string" && (CORRECTNESS_VALUES as readonly string[]).includes(value);
}

export function isEvidenceSource(value: unknown): value is EvidenceSource {
  return typeof value === "string" && (EVIDENCE_SOURCES as readonly string[]).includes(value);
}

export function isSupportLevel(value: unknown): value is SupportLevel {
  return value === 0 || value === 1 || value === 2 || value === 3;
}

export function isLearningRoute(value: unknown): value is LearningRoute {
  return typeof value === "string" && (LEARNING_ROUTES as readonly string[]).includes(value);
}

export function isHypothesisKind(value: unknown): value is HypothesisKind {
  return typeof value === "string" && (HYPOTHESIS_KINDS as readonly string[]).includes(value);
}

export function isRetrievalType(value: unknown): value is RetrievalType {
  return typeof value === "string" && (RETRIEVAL_TYPES as readonly string[]).includes(value);
}

export function isRepresentationRole(value: unknown): value is RepresentationRole {
  return typeof value === "string" && (REPRESENTATION_ROLES as readonly string[]).includes(value);
}

/** Clamp to a valid support level. Out-of-range values fail CLOSED to unaided. */
export function coerceSupportLevel(value: unknown): SupportLevel {
  if (isSupportLevel(value)) return value;
  if (typeof value === "number" && Number.isFinite(value)) {
    const rounded = Math.round(value);
    if (rounded <= 0) return 0;
    if (rounded >= 3) return 3;
    return rounded as SupportLevel;
  }
  return 0;
}
