/**
 * The Guide to Mastery — the app's central operating loop.
 *
 * The core rule this module enforces:
 *
 *   The agent carries the structure. The student carries the thinking.
 *   Mastery means the student can eventually carry both.
 *
 * Two things live here and nowhere else:
 *
 *  1. The six-stage ladder (Encounter → Understand → Construct → Apply →
 *     Transfer → Master), including which widgets constitute each stage's
 *     teaching vocabulary and what the stage's exit condition is.
 *
 *  2. The Mastery Gate. Mastery is a *verdict computed from five kinds of
 *     evidence*, never a claim the model is allowed to make. A model that
 *     writes "MASTERED" into its speech has asserted nothing: the card renders
 *     the verdict this module computes from the evidence scores, and the
 *     weakest link is always named.
 *
 * The consequence: the tutor can never say "you got 90%, therefore mastered."
 * A learner with excellent procedure and poor transfer is not masterful, and
 * this module is what makes that structurally true rather than aspirational.
 */

import type { MasteryEvidence, MasteryEvidenceDimension, WidgetKind } from "./widgets/types";
import { MASTERY_EVIDENCE_DIMENSIONS } from "./widgets/types";

/* ── The six stages ── */

export const MASTERY_STAGES = [
  "encounter",
  "understand",
  "construct",
  "apply",
  "transfer",
  "master",
] as const;

export type MasteryStage = typeof MASTERY_STAGES[number];

export interface MasteryStageSpec {
  id: MasteryStage;
  ordinal: number;
  label: string;
  /** The learner-facing question the stage answers. */
  question: string;
  goal: string;
  agentRole: string;
  studentRole: string;
  /** The condition that must hold before the stage may be left. */
  exitCondition: string;
  /** This stage's teaching vocabulary. Widgets outside it are not forbidden,
   *  but the agent must justify departing from the stage's vocabulary. */
  widgets: WidgetKind[];
  /** Visualization intent types that belong to this stage (Graph/Geometry/
   *  Equation are built-in visualizations, not widgets). */
  visualizations: string[];
}

export const MASTERY_STAGE_SPECS: Record<MasteryStage, MasteryStageSpec> = {
  encounter: {
    id: "encounter",
    ordinal: 1,
    label: "Encounter",
    question: "What is this?",
    goal: "Build intuition. The learner meets the concept before being buried in notation.",
    agentRole: "Introduce and visualize",
    studentRole: "Observe and predict",
    exitCondition: "The learner has a mental picture of what this thing is.",
    widgets: ["roadmap", "concept_card", "question", "animation"],
    visualizations: ["function", "geometry"],
  },
  understand: {
    id: "understand",
    ordinal: 2,
    label: "Understand",
    question: "Why does it work?",
    goal: "Build a mental model. Expose the machinery gradually and correct misconceptions, not just answers.",
    agentRole: "Explain, question, connect",
    studentRole: "Explain ideas in their own words",
    exitCondition: "The learner can answer: what is it, why does it work, and when does it matter?",
    widgets: ["comparison", "annotation", "slider", "reveal", "reflection"],
    visualizations: ["equation"],
  },
  construct: {
    id: "construct",
    ordinal: 3,
    label: "Construct",
    question: "Let's build the ability.",
    goal: "Learn the method with the board genuinely shared. The agent starts a problem; the learner performs the next step; the ratio shifts toward the learner.",
    agentRole: "Work beside the learner, then intentionally stop helping",
    studentRole: "Solve with guidance",
    exitCondition: "The learner can solve a standard problem with only minimal hints.",
    widgets: ["scratchpad", "example", "hint", "mistake_check", "question"],
    visualizations: [],
  },
  apply: {
    id: "apply",
    ordinal: 4,
    label: "Apply",
    question: "Can you actually use it?",
    goal: "Use it independently. Problems vary on the surface while the underlying concept stays fixed; watch for transfer, not pattern matching.",
    agentRole: "Give problems and diagnose",
    studentRole: "Solve and adapt",
    exitCondition: "The learner reliably solves ordinary problems without being led through the procedure.",
    widgets: ["challenge", "hint", "mistake_check"],
    visualizations: ["function", "equation"],
  },
  transfer: {
    id: "transfer",
    ordinal: 5,
    label: "Transfer",
    question: "Can you use the idea somewhere new?",
    goal: "Deliberately change context, representation, difficulty, assumptions, and problem structure so the learner must reason from principles.",
    agentRole: "Vary context and difficulty",
    studentRole: "Reason from principles",
    exitCondition: "The learner recognizes the underlying idea even when the problem doesn't look familiar.",
    widgets: ["challenge", "comparison", "question", "reflection"],
    visualizations: ["function", "geometry"],
  },
  master: {
    id: "master",
    ordinal: 6,
    label: "Master",
    question: "You don't need me.",
    goal: "The agent deliberately withdraws. The board becomes sparse: no giant hints, no worked example, no leading questions.",
    agentRole: "Test, space, verify",
    studentRole: "Demonstrate independence",
    exitCondition: "The learner can recall, explain, apply, solve something unfamiliar, and recognize when the idea should be used.",
    widgets: ["retrieval_check", "reflection", "memory_hook", "mastery_card"],
    visualizations: [],
  },
};

export function getStageSpec(stage: MasteryStage): MasteryStageSpec {
  return MASTERY_STAGE_SPECS[stage];
}

export function nextStage(stage: MasteryStage): MasteryStage | null {
  const index = MASTERY_STAGES.indexOf(stage);
  return index >= 0 && index < MASTERY_STAGES.length - 1 ? MASTERY_STAGES[index + 1] : null;
}

export function previousStage(stage: MasteryStage): MasteryStage | null {
  const index = MASTERY_STAGES.indexOf(stage);
  return index > 0 ? MASTERY_STAGES[index - 1] : null;
}

export function isMasteryStage(value: unknown): value is MasteryStage {
  return typeof value === "string" && (MASTERY_STAGES as readonly string[]).includes(value);
}

/** Which stages a widget is part of the vocabulary for. */
export function stagesForWidget(kind: WidgetKind): MasteryStage[] {
  return MASTERY_STAGES.filter((stage) => MASTERY_STAGE_SPECS[stage].widgets.includes(kind));
}

/** True when a widget belongs to the stage's declared teaching vocabulary. */
export function isWidgetInStageVocabulary(kind: WidgetKind, stage: MasteryStage): boolean {
  return MASTERY_STAGE_SPECS[stage].widgets.includes(kind);
}

/* ── The Mastery Gate ── */

/**
 * Minimum evidence per dimension. Transfer and independence are held to the
 * same bar as the rest deliberately: the failure mode this gate exists to
 * prevent is a learner with 95% procedure and 60% transfer being told they
 * have mastered a concept.
 */
export const MASTERY_THRESHOLD = 85;

/** Below this on any dimension, the learner is not merely "not yet" — that
 *  dimension needs targeted repair before the concept advances at all. */
export const MASTERY_REPAIR_THRESHOLD = 60;

export const MASTERY_DIMENSION_LABEL: Record<MasteryEvidenceDimension, string> = {
  recall: "Recall",
  understanding: "Understanding",
  procedure: "Procedure",
  transfer: "Transfer",
  independence: "Independence",
};

export const MASTERY_DIMENSION_MEANING: Record<MasteryEvidenceDimension, string> = {
  recall: "Reproduces the definition, notation, and rules unprompted and without notes.",
  understanding: "Explains why the idea works and when it applies, in their own words.",
  procedure: "Executes the method accurately on standard problems.",
  transfer: "Recognizes and applies the idea in unfamiliar contexts and representations.",
  independence: "Works without hints, worked examples, or leading questions.",
};

export type MasteryVerdict = "mastered" | "not_yet" | "needs_repair";

export interface MasteryAssessment {
  verdict: MasteryVerdict;
  mastered: boolean;
  /** The lowest-scoring dimension. Always named, even when mastered. */
  weakestLink: MasteryEvidenceDimension;
  weakestScore: number;
  /** Every dimension below MASTERY_THRESHOLD, weakest first. */
  unmetDimensions: MasteryEvidenceDimension[];
  /** Dimensions below MASTERY_REPAIR_THRESHOLD needing targeted repair. */
  repairDimensions: MasteryEvidenceDimension[];
  /** Mean across the five dimensions. Informational only — it is deliberately
   *  NOT the gate, because averaging is exactly how poor transfer gets hidden
   *  behind strong procedure. */
  average: number;
  /** One-line learner-facing summary. */
  summary: string;
}

function clampScore(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

/**
 * Compute the mastery verdict from the five kinds of evidence.
 *
 * Mastery requires EVERY dimension to clear the threshold. This is the whole
 * point of the gate — it is a conjunction, never an average.
 */
export function assessMastery(evidence: MasteryEvidence): MasteryAssessment {
  const scores = MASTERY_EVIDENCE_DIMENSIONS.map((dimension) => ({
    dimension,
    score: clampScore(evidence[dimension]),
  }));

  const ranked = [...scores].sort((a, b) => a.score - b.score || MASTERY_EVIDENCE_DIMENSIONS.indexOf(a.dimension) - MASTERY_EVIDENCE_DIMENSIONS.indexOf(b.dimension));
  const weakest = ranked[0];
  const unmetDimensions = ranked.filter((entry) => entry.score < MASTERY_THRESHOLD).map((entry) => entry.dimension);
  const repairDimensions = ranked.filter((entry) => entry.score < MASTERY_REPAIR_THRESHOLD).map((entry) => entry.dimension);
  const average = scores.reduce((total, entry) => total + entry.score, 0) / scores.length;

  const mastered = unmetDimensions.length === 0;
  const verdict: MasteryVerdict = mastered
    ? "mastered"
    : repairDimensions.length > 0
      ? "needs_repair"
      : "not_yet";

  const weakestLabel = MASTERY_DIMENSION_LABEL[weakest.dimension];
  const summary = mastered
    ? `Mastered. Weakest evidence is still ${weakestLabel.toLowerCase()} at ${Math.round(weakest.score)}% — worth a spaced retrieval check later.`
    : verdict === "needs_repair"
      ? `Not yet. ${weakestLabel} is at ${Math.round(weakest.score)}% and needs targeted repair before moving on.`
      : `Not yet. Weakest link: ${weakestLabel.toLowerCase()} at ${Math.round(weakest.score)}%.`;

  return {
    verdict,
    mastered,
    weakestLink: weakest.dimension,
    weakestScore: Math.round(weakest.score),
    unmetDimensions,
    repairDimensions,
    average: Math.round(average),
    summary,
  };
}

/* ── Forgetting and repair ── */

/**
 * Mastery is not permanent. After the learner leaves, the tutor watches for
 * forgetting: the memory hook is stored, the retrieval check resurfaces later,
 * and a struggling retrieval moves the learner back temporarily.
 *
 *   Mastered → forgetting detected → retrieval → targeted repair → mastered again
 *
 * So the learner's state is never "finished / unfinished". It is "currently
 * mastered, with evidence of how robust that mastery is".
 */
export type RetentionState = "fresh" | "due_soon" | "due" | "overdue";

/** Spacing schedule in days, indexed by the number of successful retrievals. */
export const RETRIEVAL_SPACING_DAYS = [1, 3, 7, 16, 35, 70];

export function retrievalIntervalDays(successfulRetrievals: number): number {
  const index = Math.min(Math.max(0, Math.floor(successfulRetrievals)), RETRIEVAL_SPACING_DAYS.length - 1);
  return RETRIEVAL_SPACING_DAYS[index];
}

export function nextRetrievalDate(from: Date, successfulRetrievals: number): Date {
  const next = new Date(from.getTime());
  next.setDate(next.getDate() + retrievalIntervalDays(successfulRetrievals));
  return next;
}

export function retentionState(dueAt: Date, now: Date = new Date()): RetentionState {
  const msPerDay = 86_400_000;
  const daysUntilDue = (dueAt.getTime() - now.getTime()) / msPerDay;
  if (daysUntilDue > 2) return "fresh";
  if (daysUntilDue > 0) return "due_soon";
  if (daysUntilDue > -7) return "due";
  return "overdue";
}

/**
 * After a retrieval attempt, decide whether the concept stays mastered or drops
 * back for targeted repair. A failed retrieval on a "mastered" concept is
 * exactly the forgetting signal the loop exists to catch.
 */
export function applyRetrievalOutcome(
  current: { stage: MasteryStage; successfulRetrievals: number },
  passed: boolean
): { stage: MasteryStage; successfulRetrievals: number; repairTriggered: boolean } {
  if (passed) {
    return {
      stage: current.stage,
      successfulRetrievals: current.successfulRetrievals + 1,
      repairTriggered: false,
    };
  }
  // Forgetting detected: move back to Understand for targeted repair rather
  // than restarting the whole ladder. The learner has not lost the encounter.
  return {
    stage: current.stage === "master" ? "understand" : current.stage,
    successfulRetrievals: 0,
    repairTriggered: true,
  };
}

/* ── Prompt-facing rendering ── */

/** The evidence table the tutor is required to show instead of a raw score. */
export function formatEvidenceTable(evidence: MasteryEvidence): string {
  const assessment = assessMastery(evidence);
  const rows = MASTERY_EVIDENCE_DIMENSIONS.map((dimension) => {
    const label = MASTERY_DIMENSION_LABEL[dimension].padEnd(15, " ");
    return `${label}${String(Math.round(clampScore(evidence[dimension]))).padStart(3, " ")}%`;
  });
  return [
    ...rows,
    "",
    `MASTERED: ${assessment.mastered ? "Yes" : "Not yet"}`,
    `Weakest link: ${MASTERY_DIMENSION_LABEL[assessment.weakestLink]}`,
  ].join("\n");
}

/** Compact stage ladder for the tutor prompt. */
export function formatStageLadder(): string {
  return MASTERY_STAGES.map((stage) => {
    const spec = MASTERY_STAGE_SPECS[stage];
    return `${spec.ordinal}. ${spec.label.toUpperCase()} — "${spec.question}" · agent: ${spec.agentRole} · learner: ${spec.studentRole}\n` +
      `   widgets: ${spec.widgets.join(", ")}${spec.visualizations.length ? ` · visualizations: ${spec.visualizations.join(", ")}` : ""}\n` +
      `   exit: ${spec.exitCondition}`;
  }).join("\n");
}
