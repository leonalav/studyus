/**
 * Turning learner interactions into ledger evidence.
 *
 * This is where the engine actually gets its facts. Everything upstream is
 * vocabulary and everything downstream is inference; this module is the one
 * place where "the learner did something" becomes "the ledger knows something".
 *
 * The rule that governs it, stated once here because it is easy to erode:
 *
 *   **Interaction telemetry is context, never evidence.**
 *
 * Dragging a slider, scrubbing an animation, rotating a camera, toggling a
 * legend, panning a viewport — none of these are recorded as evidence about the
 * learner. They are exploration, and exploration must stay free. The moment a
 * learner suspects that moving a slider is being scored, they stop moving the
 * slider, and the representation becomes decorative. Only a committed answer to
 * an explicit prompt crosses into the ledger.
 *
 * There is no keystroke-dynamics analysis, no affect inference, no continuous
 * playback trace. Response time is recorded because it is a coarse and
 * legitimate signal about fluency; nothing finer-grained is.
 */

import { gradeAnswerableWidget } from "../widgets/validate";
import type { WidgetIntent, WidgetState } from "../widgets/types";
import { recordEvidence } from "./store";
import {
  type Correctness,
  type EvidenceType,
  type LearningActivityContract,
  type LearningEvidenceEvent,
  type SupportLevel,
} from "./types";

/**
 * The evidence type each widget kind produces when answered.
 *
 * `undefined` means the widget produces no evidence at all, however the learner
 * interacts with it. A roadmap is orientation; reading one says nothing about
 * what the learner knows, and pretending otherwise inflates every number
 * downstream.
 */
const WIDGET_EVIDENCE_TYPE: Partial<Record<WidgetIntent["kind"], EvidenceType>> = {
  question: "selection",
  retrieval_check: "retrieval",
  mistake_check: "selection",
  challenge: "construction",
  reflection: "explanation",
  scratchpad: "construction",
  // Answered only via an attached `respond` prompt; see below.
  animation: "prediction",
  slider: "observation",
  hint: "observation",
  annotation: "observation",
};

/**
 * Refine the evidence type using the actual response format.
 *
 * A `question` widget with a short-answer or numeric format is a construction,
 * not a selection: the learner produced the answer rather than recognising it.
 * Filing both as `selection` would make production evidence invisible and leave
 * a learner stuck below Construct forever despite doing constructive work.
 */
function refineEvidenceType(
  intent: WidgetIntent,
  base: EvidenceType,
  contract?: LearningActivityContract
): EvidenceType {
  const format = (intent as { format?: string }).format;
  if (base === "selection" && (format === "short_answer" || format === "numeric")) {
    return "construction";
  }
  // A transfer-mode activity relabels its evidence as transfer, since the point
  // of the activity is what the changed context showed.
  if (contract?.mode === "transfer" && base !== "retrieval") return "transfer";
  if (contract?.mode === "retrieval") return "retrieval";
  return base;
}

/**
 * Map a graded result onto the four-state correctness.
 *
 * `undefined` from the grader means the answer is not machine-checkable — an
 * open reflection, a free scratchpad. That is `unknown`, not `incorrect`.
 * Recording it as incorrect would fabricate failures out of open questions, and
 * those fabricated failures would drive regression and repair routing.
 */
function toCorrectness(graded: boolean | undefined, state: WidgetState): Correctness {
  const hasResponse =
    Boolean(state.responseText?.trim()) || Boolean(state.selectedOptionId);
  if (!hasResponse) return "blank";
  if (graded === true) return "correct";
  if (graded === false) return "incorrect";
  return "unknown";
}

export interface WidgetEvidenceContext {
  learnerId: string;
  sessionId?: string;
  /** The contract the widget was placed under, when there was one. */
  contract?: LearningActivityContract;
  /** Fallback skills when no contract is attached. */
  fallbackSkillIds?: string[];
  /** Support ceiling actually in force when the learner answered. */
  supportCeiling?: SupportLevel;
  /** Milliseconds from render to submit, when the surface tracked it. */
  responseTimeMs?: number;
  /** Whether this answer serviced a delayed, scheduled retrieval. */
  delayed?: boolean;
  /**
   * Stable identity for the specific task instance the learner answered.
   *
   * Supplied by the caller because a widget intent does not know where it was
   * placed: the board block id is the only thing that distinguishes two
   * structurally identical questions on the same board. Without it every
   * question on a skill collapses into one task, and the predicates — which
   * count DISTINCT task families and instances — would read a learner who
   * answered five different problems as a learner who answered one.
   */
  taskId?: string;
}

/**
 * Record a widget submission as evidence, or decline to.
 *
 * Returns `undefined` when the interaction is not evidence — which is the
 * common case and must stay cheap and silent. Callers should not treat a
 * `undefined` return as an error.
 */
export async function recordWidgetEvidence(
  intent: WidgetIntent,
  state: WidgetState,
  context: WidgetEvidenceContext
): Promise<LearningEvidenceEvent | undefined> {
  // Presentational widgets never produce evidence, and exploration widgets only
  // do so when the agent attached an explicit prompt to answer.
  const baseType = WIDGET_EVIDENCE_TYPE[intent.kind];
  if (!baseType) return undefined;

  const isExploration =
    intent.kind === "slider" ||
    intent.kind === "animation" ||
    intent.kind === "hint" ||
    intent.kind === "annotation";
  if (isExploration && (intent as { respond?: unknown }).respond === undefined) {
    return undefined;
  }
  if (state.submitted !== true) return undefined;

  const contract = context.contract;
  const skillIds = contract?.targetSkillIds?.length
    ? contract.targetSkillIds
    : context.fallbackSkillIds?.length
      ? context.fallbackSkillIds
      : ["unspecified"];

  const graded = gradeAnswerableWidget(intent as never, state);
  const correctness = toCorrectness(graded, state);
  const evidenceType = refineEvidenceType(intent, baseType, contract);

  // Hint exposure is read from the widget's own state rather than from what the
  // policy allowed. What the learner actually opened is the fact that bears on
  // independence; the ceiling is only what was permitted.
  const hintExposure = Math.max(
    0,
    Math.min(3, Math.round(state.hintLevelOpened ?? 0))
  );

  const response =
    state.responseText?.trim() ||
    (state.selectedOptionId ? `selected:${state.selectedOptionId}` : "");

  return recordEvidence({
    learnerId: context.learnerId,
    skillIds,
    taskId: context.taskId ?? intent.id ?? `${intent.kind}:unanchored`,
    taskFamily: contract?.taskFamily ?? `${intent.kind}:${skillIds[0]}`,
    contextVariant: contract?.contextVariant ?? "same",
    activityId: contract?.activityId,
    sessionId: context.sessionId,
    evidenceType,
    response,
    correctness,
    rubricCriterionIds: contract?.successCriteria ?? [],
    supportLevel: context.supportCeiling ?? contract?.supportCeiling ?? 0,
    hintExposure,
    responseTimeMs: context.responseTimeMs,
    selfRatedConfidence: state.confidence,
    // A deterministically graded answer is certain; an ungraded one is not
    // scored at all, so no confidence is asserted about it.
    evaluatorConfidence: graded === undefined ? undefined : 100,
    delayed: context.delayed ?? false,
    source: "widget",
  });
}

/**
 * Record an assessment item result as evidence.
 *
 * The assessment engine already grades deterministically against an answer key;
 * this simply routes that verdict into the same ledger the tutor reads, so that
 * a quiz result and a board answer are the same kind of fact. Before this
 * bridge existed the two lived in separate worlds, and a learner could ace an
 * assessment while the tutor kept treating them as a beginner.
 */
export async function recordAssessmentEvidence(params: {
  learnerId: string;
  sessionId?: string;
  skillIds: string[];
  itemId: string;
  taskFamily: string;
  response: string;
  correct: boolean | undefined;
  /** Assessment items are unaided by definition unless stated otherwise. */
  supportLevel?: SupportLevel;
  responseTimeMs?: number;
  selfRatedConfidence?: number;
  /** True for a delayed/spaced assessment rather than an immediate check. */
  delayed?: boolean;
  evidenceType?: EvidenceType;
}): Promise<LearningEvidenceEvent> {
  return recordEvidence({
    learnerId: params.learnerId,
    skillIds: params.skillIds,
    taskId: params.itemId,
    taskFamily: params.taskFamily,
    contextVariant: "same",
    sessionId: params.sessionId,
    evidenceType: params.evidenceType ?? (params.delayed ? "retrieval" : "procedure"),
    response: params.response,
    correctness:
      params.correct === true ? "correct" : params.correct === false ? "incorrect" : "unknown",
    rubricCriterionIds: [],
    supportLevel: params.supportLevel ?? 0,
    hintExposure: 0,
    responseTimeMs: params.responseTimeMs,
    selfRatedConfidence: params.selfRatedConfidence,
    evaluatorConfidence: params.correct === undefined ? undefined : 100,
    delayed: params.delayed ?? false,
    source: "assessment",
  });
}

/**
 * Record an evidence event the tutor observed in conversation.
 *
 * The model is allowed to REPORT an observation — "the learner explained the
 * chain rule correctly in their own words" — and it is allowed to say how
 * confident it is in that judgement. It is not allowed to assert a mastery
 * score, a stage, or an independence level: those are computed from events like
 * this one, and letting the model write them directly is exactly the loop this
 * refactor exists to cut.
 *
 * `evaluatorConfidence` is carried through and down-weights the event, so a
 * hedged judgement moves the numbers less than a certain one.
 */
export async function recordTutorObservation(params: {
  learnerId: string;
  sessionId?: string;
  skillIds: string[];
  taskId: string;
  taskFamily: string;
  evidenceType: EvidenceType;
  response: string;
  correctness: Correctness;
  supportLevel: SupportLevel;
  hintExposure: number;
  contextVariant?: LearningActivityContract["contextVariant"];
  activityId?: string;
  evaluatorConfidence?: number;
  delayed?: boolean;
}): Promise<LearningEvidenceEvent> {
  return recordEvidence({
    learnerId: params.learnerId,
    skillIds: params.skillIds,
    taskId: params.taskId,
    taskFamily: params.taskFamily,
    contextVariant: params.contextVariant ?? "same",
    activityId: params.activityId,
    sessionId: params.sessionId,
    evidenceType: params.evidenceType,
    response: params.response,
    correctness: params.correctness,
    rubricCriterionIds: [],
    supportLevel: params.supportLevel,
    hintExposure: params.hintExposure,
    // A conversational judgement is never as certain as a graded key. Cap it so
    // an over-confident model cannot give its own opinion the weight of a mark
    // scheme.
    evaluatorConfidence: Math.min(85, params.evaluatorConfidence ?? 70),
    delayed: params.delayed ?? false,
    source: "tutor_turn",
  });
}
