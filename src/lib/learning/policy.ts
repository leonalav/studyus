/**
 * The policy engine: deciding which instructional move the evidence warrants.
 *
 * This is the module that carries the thesis of the whole refactor:
 *
 *   The policy engine decides WHAT evidence is missing and WHICH learning move
 *   is warranted. The LLM decides HOW to explain, question, represent, and
 *   encourage within that policy.
 *
 * Everything here is deterministic and pure — given a skill state, its ledger,
 * the open hypotheses and the due reviews, the same move comes out every time.
 * That matters for two reasons. First, an instructional decision that varies
 * with sampling temperature is not a policy. Second, the decisions can be tested
 * as ordinary functions, which is the only way a claim like "the learner is
 * never asked to practise independently before they can do it with help" can be
 * held true across a codebase rather than hoped for in a prompt.
 *
 * The planner never names a widget component, a chart library, or a phrasing.
 * It emits a route, a ceiling, a required evidence type and a permitted
 * vocabulary; the model does the teaching.
 */

import { MASTERY_STAGES, MASTERY_STAGE_SPECS, type MasteryStage } from "../mastery";
import type { WidgetKind } from "../widgets/types";
import { evaluateStageExit } from "./predicates";
import {
  HYPOTHESIS_KIND_REMEDY,
  LEARNING_ROUTE_INSTRUCTION,
  SUPPORT_LEVEL_LABEL,
  type ActivityMode,
  type ContextVariant,
  type EvidenceType,
  type LearnerHypothesis,
  type LearningEvidenceEvent,
  type LearningRoute,
  type NextLearningMove,
  type ReviewTask,
  type SkillState,
  type SupportLevel,
} from "./types";

/* ─────────────────────────────────────────────────────────────
   Widget vocabularies per route
   ───────────────────────────────────────────────────────────── */

/**
 * Which widget kinds are instructionally coherent for each route.
 *
 * This is a permission list, not a recommendation. A `due_retrieval` move may
 * not place a `hint` widget, because a hint on a retrieval destroys the only
 * measurement the retrieval exists to make. An `independent_practice` move may
 * not place `example` or `hint` for the same reason. Encoding this as data
 * rather than prose means the constraint survives a model that did not read
 * carefully.
 */
const ROUTE_WIDGETS: Record<LearningRoute, WidgetKind[]> = {
  diagnostic_probe: ["question", "mistake_check", "comparison", "scratchpad"],
  prediction: ["animation", "slider", "question", "comparison"],
  contrast_case: ["comparison", "mistake_check", "example", "question", "animation"],
  prerequisite_repair: ["concept_card", "example", "question", "hint", "animation", "slider"],
  faded_example: ["example", "scratchpad", "question", "hint", "annotation"],
  guided_retry: ["hint", "question", "scratchpad", "annotation", "mistake_check"],
  independent_practice: ["question", "challenge", "scratchpad"],
  transfer_check: ["challenge", "question", "scratchpad", "comparison"],
  due_retrieval: ["retrieval_check", "question"],
};

/** Routes whose measurement is destroyed by any support at all. */
const UNAIDED_ROUTES = new Set<LearningRoute>([
  "due_retrieval",
  "independent_practice",
  "transfer_check",
  "prediction",
]);

/** The mode each route is conducted in. */
const ROUTE_MODE: Record<LearningRoute, ActivityMode> = {
  diagnostic_probe: "diagnostic",
  prediction: "explore",
  contrast_case: "repair",
  prerequisite_repair: "repair",
  faded_example: "guided_practice",
  guided_retry: "guided_practice",
  independent_practice: "independent_practice",
  transfer_check: "transfer",
  due_retrieval: "retrieval",
};

/** The evidence each route must produce to have been worth making. */
const ROUTE_EVIDENCE: Record<LearningRoute, EvidenceType[]> = {
  diagnostic_probe: ["selection", "explanation"],
  prediction: ["prediction", "observation"],
  contrast_case: ["selection", "explanation"],
  prerequisite_repair: ["procedure", "explanation"],
  faded_example: ["construction", "procedure"],
  guided_retry: ["construction", "procedure"],
  independent_practice: ["procedure", "construction"],
  transfer_check: ["transfer", "explanation"],
  due_retrieval: ["retrieval"],
};

/**
 * The support ceiling each route permits by default.
 *
 * Ceilings tighten as evidence accumulates and are never loosened by the
 * learner asking. A learner asking for the answer is information about their
 * state, not authority over the policy.
 */
const ROUTE_CEILING: Record<LearningRoute, SupportLevel> = {
  diagnostic_probe: 0,
  prediction: 0,
  contrast_case: 1,
  prerequisite_repair: 3,
  faded_example: 2,
  guided_retry: 2,
  independent_practice: 0,
  transfer_check: 1,
  due_retrieval: 0,
};

/* ─────────────────────────────────────────────────────────────
   Signals read off the ledger
   ───────────────────────────────────────────────────────────── */

/** How many turns count as "recent" when judging the current episode. */
const RECENT_WINDOW = 6;

export interface PolicySignals {
  recentUnaidedFailures: number;
  recentSupportedSuccesses: number;
  consecutiveFailures: number;
  /** The learner is asking for answers rather than attempting. */
  helpSeeking: boolean;
  /** Responses have gone short, blank, or perfunctory. */
  disengaged: boolean;
  /** Self-rating exceeds performance. */
  overconfident: boolean;
  /** Performance exceeds self-rating. */
  underconfident: boolean;
  hasAnyEvidence: boolean;
}

export function readSignals(events: LearningEvidenceEvent[]): PolicySignals {
  const recent = events.slice(-RECENT_WINDOW);

  let consecutiveFailures = 0;
  for (let i = events.length - 1; i >= 0; i -= 1) {
    if (events[i].correctness === "incorrect") consecutiveFailures += 1;
    else break;
  }

  const rated = recent.filter(
    (event) => typeof event.selfRatedConfidence === "number" && event.correctness !== "unknown"
  );
  // Calibration is only meaningful across several judgements. One confident
  // wrong answer is a bad day; a pattern of them is a calibration problem, and
  // they call for entirely different responses.
  const calibrationGap =
    rated.length >= 2
      ? rated.reduce((sum, event) => {
          const actual = event.correctness === "correct" ? 100 : event.correctness === "partial" ? 50 : 0;
          return sum + ((event.selfRatedConfidence ?? 50) - actual);
        }, 0) / rated.length
      : 0;

  const blanks = recent.filter(
    (event) => event.correctness === "blank" || event.response.trim().length < 3
  ).length;

  return {
    recentUnaidedFailures: recent.filter(
      (event) => event.correctness === "incorrect" && event.supportLevel <= 1
    ).length,
    recentSupportedSuccesses: recent.filter(
      (event) =>
        (event.correctness === "correct" || event.correctness === "partial") &&
        (event.supportLevel >= 2 || event.hintExposure >= 2)
    ).length,
    consecutiveFailures,
    helpSeeking: recent.filter((event) => event.hintExposure >= 2).length >= 2,
    disengaged: recent.length >= 3 && blanks >= 2,
    overconfident: calibrationGap >= 30,
    underconfident: calibrationGap <= -30,
    hasAnyEvidence: events.length > 0,
  };
}

/* ─────────────────────────────────────────────────────────────
   The planner
   ───────────────────────────────────────────────────────────── */

export interface PlanInput {
  state: SkillState;
  events: LearningEvidenceEvent[];
  /** Reviews already due for this learner, most overdue first. */
  dueReviews?: ReviewTask[];
  /** Open, undisputed hypotheses about this skill. */
  hypotheses?: LearnerHypothesis[];
  /** Prerequisite skills that are themselves weak, nearest first. */
  weakPrerequisites?: { skillId: string; state: SkillState }[];
  /** True when the learner explicitly asked for a visualization this turn.
   *  Read only to satisfy the request within policy, never to skip the move. */
  explicitVisualizationRequest?: boolean;
}

/**
 * Decide the next instructional move.
 *
 * The ordering of the checks below IS the pedagogy, and it is deliberate:
 *
 *  1. **Due retrieval first.** Retention decays whether or not new material is
 *     interesting. A due review that is deferred because something new came up
 *     is a review that never happens.
 *  2. **Owed reconstruction next.** Support that was given and never redone
 *     unaided is an open question about what the learner can actually do, and
 *     everything built on top of it is built on an assumption.
 *  3. **Repeated unaided failure means a prerequisite check**, not another
 *     attempt at the same thing. Three failures in a row is the signal that the
 *     problem is below where you are teaching.
 *  4. **A supported misconception gets a contrast case**, because re-explaining
 *     the correct rule does not dislodge a wrong belief.
 *  5. Only then does normal stage progression apply.
 */
export function planNextMove(input: PlanInput): NextLearningMove {
  const { state, events } = input;
  const signals = readSignals(events);
  const stage = state.stage;

  // 1 ── Due retrieval outranks new teaching.
  const review = (input.dueReviews ?? []).find((task) => task.skillId === state.skillId);
  if (review) {
    return buildMove({
      route: "due_retrieval",
      state,
      contextVariant: review.reconstruction ? "changed_numbers" : "changed_context",
      rationale: review.reconstruction
        ? `An unaided reconstruction is owed on "${review.taskFamily}": the learner previously succeeded there only with substantive support, so that success is not yet evidence of independent capability.`
        : `A scheduled retrieval on "${review.taskFamily}" came due ${describeDue(review.dueAt)}. Retention is only measurable when the retrieval is unaided and delayed.`,
      rationaleEvidenceIds: state.stageEvidenceIds.slice(-2),
      reviewId: review.reviewId,
      reconstructionTaskFamily: review.reconstruction ? review.taskFamily : undefined,
      // Always the reviewed family, reconstruction or not: this is what lets
      // the resulting evidence settle the review rather than orphan it.
      taskFamily: review.taskFamily,
    });
  }

  // 2 ── An owed reconstruction that has not yet been queued as a review.
  if (state.reconstructionDueTaskFamily) {
    return buildMove({
      route: "independent_practice",
      state,
      contextVariant: "changed_numbers",
      rationale: `The learner's last success in "${state.reconstructionDueTaskFamily}" came with substantive support (${state.supportedSuccesses} supported vs ${state.unaidedSuccesses} unaided successes on this skill). Before anything is built on it, they need to reproduce it alone on a near-but-not-identical task.`,
      rationaleEvidenceIds: recentIds(events, 2),
      reconstructionTaskFamily: state.reconstructionDueTaskFamily,
    });
  }

  // 3 ── Repeated unaided failure: the problem is probably underneath.
  const weakPrereq = (input.weakPrerequisites ?? [])[0];
  if (signals.consecutiveFailures >= 3 || (signals.recentUnaidedFailures >= 3 && weakPrereq)) {
    if (weakPrereq) {
      return buildMove({
        route: "prerequisite_repair",
        state,
        targetSkillIds: [weakPrereq.skillId],
        rationale: `${signals.consecutiveFailures} consecutive failures on ${state.skillId}, and the prerequisite ${weakPrereq.skillId} is itself weak (procedure ${weakPrereq.state.procedure}, understanding ${weakPrereq.state.understanding}). Continuing at this level will keep producing failures that are not about this skill.`,
        rationaleEvidenceIds: recentIds(events, 3),
      });
    }
    return buildMove({
      route: "diagnostic_probe",
      state,
      rationale: `${signals.consecutiveFailures} consecutive failures with no identified cause. Further teaching before the cause is known is a guess. One discriminating question is worth more than another explanation.`,
      rationaleEvidenceIds: recentIds(events, 3),
    });
  }

  // 4 ── A supported misconception needs a contrast case, not a restatement.
  const misconception = (input.hypotheses ?? []).find(
    (hypothesis) =>
      hypothesis.status === "supported" &&
      !hypothesis.learnerDisputed &&
      hypothesis.kind === "misconception"
  );
  if (misconception) {
    return buildMove({
      route: "contrast_case",
      state,
      contextVariant: "changed_constraints",
      rationale: `Supported misconception: ${misconception.statement}. ${HYPOTHESIS_KIND_REMEDY.misconception} Next best test: ${misconception.nextBestTest}`,
      rationaleEvidenceIds: misconception.supportingEvidenceIds.slice(-3),
    });
  }

  // 4b ── A missing prerequisite the learner model already suspects.
  const prereqHypothesis = (input.hypotheses ?? []).find(
    (hypothesis) =>
      hypothesis.status === "supported" &&
      !hypothesis.learnerDisputed &&
      hypothesis.kind === "missing_prerequisite"
  );
  if (prereqHypothesis) {
    return buildMove({
      route: "prerequisite_repair",
      state,
      rationale: `Supported hypothesis of a missing prerequisite: ${prereqHypothesis.statement} ${HYPOTHESIS_KIND_REMEDY.missing_prerequisite}`,
      rationaleEvidenceIds: prereqHypothesis.supportingEvidenceIds.slice(-3),
    });
  }

  // 4c ── Overconfidence needs a discriminating task, not encouragement.
  if (signals.overconfident && state.totalEvidenceCount >= 3) {
    return buildMove({
      route: "transfer_check",
      state,
      contextVariant: "changed_context",
      rationale: `The learner is rating their confidence well above their measured performance. ${HYPOTHESIS_KIND_REMEDY.overconfidence}`,
      rationaleEvidenceIds: recentIds(events, 2),
    });
  }

  // 4d ── Persistent help-seeking: fade support rather than keep supplying it.
  if (signals.helpSeeking && signals.recentSupportedSuccesses >= 2) {
    return buildMove({
      route: "faded_example",
      state,
      rationale: `${signals.recentSupportedSuccesses} of the last ${RECENT_WINDOW} successes came at high support, and the learner is opening hints early. The support has to start coming out or the evidence will never say anything about what they can do.`,
      rationaleEvidenceIds: recentIds(events, 2),
    });
  }

  // 5 ── Normal progression: aim at the evidence the current stage still lacks.
  return planForStage(stage, state, events, signals);
}

/**
 * The default move for a stage, chosen by which exit predicate is unmet.
 *
 * This is where "what evidence is missing" becomes "what to do next". The
 * predicate module reports exactly which clause of the stage gate has not been
 * satisfied; the route is chosen to produce precisely that missing evidence
 * rather than to cover the topic again.
 */
function planForStage(
  stage: MasteryStage,
  state: SkillState,
  events: LearningEvidenceEvent[],
  signals: PolicySignals
): NextLearningMove {
  const gate = evaluateStageExit(stage, events);
  const missing = gate.missing[0] ?? "";

  const route: LearningRoute = (() => {
    switch (stage) {
      case "encounter":
        // Prediction is the only move that produces encounter evidence, because
        // encounter evidence IS a committed prediction followed by observation.
        return "prediction";
      case "understand":
        // Understanding is demonstrated by explanation. If the learner has
        // never attempted one, ask for one; if they attempted and missed,
        // contrast rather than restate.
        return signals.recentUnaidedFailures > 0 ? "contrast_case" : "diagnostic_probe";
      case "construct":
        return "faded_example";
      case "apply":
        return "independent_practice";
      case "transfer":
        return "transfer_check";
      case "master":
        return "due_retrieval";
      default:
        return "diagnostic_probe";
    }
  })();

  const spec = MASTERY_STAGE_SPECS[stage];
  const rationale = gate.satisfied
    ? `All exit predicates for ${spec.label} are met (${gate.summary}). Ready to move to ${nextStageLabel(stage)}; this move gathers the first evidence at that level.`
    : `${spec.label} is not yet complete. Missing: ${missing || gate.missing.join("; ")}. This move exists to produce that specific evidence, not to re-cover the material.`;

  return buildMove({
    route,
    state,
    rationale,
    rationaleEvidenceIds: recentIds(events, 2),
  });
}

function nextStageLabel(stage: MasteryStage): string {
  const index = MASTERY_STAGES.indexOf(stage);
  const next = MASTERY_STAGES[Math.min(index + 1, MASTERY_STAGES.length - 1)];
  return MASTERY_STAGE_SPECS[next].label;
}

function recentIds(events: LearningEvidenceEvent[], count: number): string[] {
  return events.slice(-count).map((event) => event.evidenceId);
}

function describeDue(dueAt: string): string {
  const diff = Date.now() - new Date(dueAt).getTime();
  if (!Number.isFinite(diff)) return "recently";
  const days = Math.floor(diff / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  return `${days} days ago`;
}

function buildMove(params: {
  route: LearningRoute;
  state: SkillState;
  targetSkillIds?: string[];
  contextVariant?: ContextVariant;
  rationale: string;
  rationaleEvidenceIds: string[];
  reviewId?: string;
  reconstructionTaskFamily?: string;
  taskFamily?: string;
}): NextLearningMove {
  const { route, state } = params;
  return {
    route,
    targetSkillIds: params.targetSkillIds ?? [state.skillId],
    stage: state.stage,
    mode: ROUTE_MODE[route],
    contextVariant: params.contextVariant ?? defaultVariant(route, state.stage),
    supportCeiling: resolveCeiling(route, state),
    requiredEvidence: ROUTE_EVIDENCE[route],
    permittedWidgetKinds: ROUTE_WIDGETS[route],
    rationaleEvidenceIds: params.rationaleEvidenceIds,
    rationale: params.rationale,
    reviewId: params.reviewId,
    reconstructionTaskFamily: params.reconstructionTaskFamily,
    taskFamily: params.taskFamily ?? params.reconstructionTaskFamily,
  };
}

function defaultVariant(route: LearningRoute, stage: MasteryStage): ContextVariant {
  if (route === "transfer_check") return "changed_context";
  if (route === "contrast_case") return "changed_constraints";
  if (route === "due_retrieval") return "changed_numbers";
  if (route === "independent_practice") return stage === "apply" ? "changed_numbers" : "same";
  return "same";
}

/**
 * The binding support ceiling for a move.
 *
 * Two adjustments on top of the route default, both tightening only:
 *
 *  - Unaided routes are pinned at 0 regardless of anything else. There is no
 *    state of the learner that makes a hinted retrieval informative.
 *  - A learner with strong independence gets a tighter ceiling than the route
 *    default, because giving structural help to someone who has repeatedly
 *    succeeded alone teaches them that they need it.
 *
 * The ceiling is never loosened here. Loosening happens only through the
 * help-seeking ladder in `support.ts`, which requires an attempt first.
 */
function resolveCeiling(route: LearningRoute, state: SkillState): SupportLevel {
  if (UNAIDED_ROUTES.has(route)) return 0;
  const base = ROUTE_CEILING[route];
  if (state.independence >= 70 && base > 1) return 1;
  if (state.independence >= 50 && base > 2) return 2;
  return base;
}

/* ─────────────────────────────────────────────────────────────
   Rendering the move for the prompt
   ───────────────────────────────────────────────────────────── */

/**
 * Render the planned move as the directive block for the tutor prompt.
 *
 * Deliberately written as constraints plus reasons rather than a script. The
 * model is told what the move is, what it may not do, and why the move was
 * chosen; how to make the move well is left to it. Naming widget kinds is safe
 * here because widget kinds are semantic intents, not renderers — the router
 * remains the sole authority over what actually draws.
 */
export function formatMoveDirective(move: NextLearningMove): string {
  const lines: string[] = [];
  lines.push("INSTRUCTIONAL MOVE (decided by the policy engine from recorded evidence — not negotiable)");
  lines.push(`Route: ${move.route.replace(/_/g, " ")}`);
  lines.push(`Target skill(s): ${move.targetSkillIds.join(", ")}`);
  lines.push(`Stage: ${move.stage} · Mode: ${move.mode} · Task variation: ${move.contextVariant.replace(/_/g, " ")}`);
  lines.push(`Why this move: ${move.rationale}`);
  if (move.rationaleEvidenceIds.length > 0) {
    lines.push(`Based on evidence: ${move.rationaleEvidenceIds.join(", ")}`);
  }
  lines.push("");
  lines.push(`What to do: ${LEARNING_ROUTE_INSTRUCTION[move.route]}`);
  lines.push("");
  lines.push(
    `SUPPORT CEILING: ${move.supportCeiling} (${SUPPORT_LEVEL_LABEL[move.supportCeiling]}). This is a hard cap. It does not rise because the learner asks, expresses frustration, or says they are short of time. If they ask for the answer outright, acknowledge the ask, then give them the most they are allowed and nothing beyond it.`
  );
  if (move.supportCeiling === 0) {
    lines.push(
      "At ceiling 0 you may restate the task and confirm what is being asked. You may not hint, narrow the option space, ask a leading question, or begin the work."
    );
  }
  lines.push("");
  lines.push(
    `EVIDENCE THIS TURN MUST PRODUCE: ${move.requiredEvidence.join(" or ")}. If the turn ends without the learner having produced one of these, the turn accomplished nothing measurable.`
  );
  lines.push(
    `Permitted widget kinds for this move: ${move.permittedWidgetKinds.join(", ")}. Others are off-policy for this route.`
  );
  if (move.reconstructionTaskFamily) {
    lines.push(
      `RECONSTRUCTION OWED on task family "${move.reconstructionTaskFamily}". Use a near-but-not-identical task — same demand, different surface. Re-serving the identical item tests recall of that item, not the skill.`
    );
  }
  if (move.reviewId) {
    lines.push(
      "This is a scheduled retrieval. Surface it before any new teaching, and do not coach it — its whole value is that it is uncoached."
    );
  }
  return lines.join("\n");
}
