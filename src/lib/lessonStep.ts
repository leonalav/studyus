/**
 * The canonical shape of one tutor turn.
 *
 * The LLM no longer invents a step on every call — the planner decides the
 * route, stage, support ceiling and permitted widget kinds, and `LessonStep`
 * is the immutable object that bundles all of those decisions into a single
 * value the harness can validate once. Construction is total: if a required
 * field is missing or its combination is incoherent, the step is unservable
 * and the planner is asked for a different move.
 *
 * Nothing here is widget-shape, prompt-shape, or renderer-shape. The
 * `LessonStep` is the contract between the policy engine and the rest of the
 * pipeline.
 */

import type { MasteryStage } from "./mastery";
import {
  ACTIVITY_MODES,
  CONTEXT_VARIANTS,
  EVIDENCE_TYPES,
  LEARNING_ROUTES,
  SUPPORT_LEVELS,
  coerceSupportLevel,
  type ActivityMode,
  type ContextVariant,
  type EvidenceType,
  type LearningRoute,
  type SupportLevel,
} from "./learning/types";
import type { WidgetKind } from "./widgets/types";
import type { VisualizationIntent } from "./visualization/types";

/* ── Prose slots ────────────────────────────────────────────────────────── */

/**
 * One prose slot the tutor must fill. The lesson step decides which slots
 * exist (one per widget that needs the tutor's voice, e.g. a hint prompt or
 * a mistake-check rationale); the LLM fills them with text.
 */
export interface ProseSlot {
  blockId: string;
  hint: string;
  tone: "concise" | "worked" | "inquisitive";
}

/* ── LessonStep ─────────────────────────────────────────────────────────── */

/** Permitted shapes for `LessonStep.requiredVisualizationKind`. Mirrors
 *  `VisualizationIntent["type"]` without dragging in the union. */
export type RequiredVisualizationKind = VisualizationIntent["type"];

/** Every input the constructor needs, before clamping and validation. */
export interface LessonStepInput {
  route: LearningRoute;
  targetSkillIds: string[];
  stage: MasteryStage;
  mode: ActivityMode;
  contextVariant?: ContextVariant;
  supportCeiling: SupportLevel;
  requiredEvidence: EvidenceType[];
  permittedWidgetKinds: WidgetKind[];
  requiredVisualizationKind?: RequiredVisualizationKind;
  proseSlots: ProseSlot[];
  maxBoardOps: number;
  corpusRef?: string;
}

/** The post-construction `LessonStep`. All fields are readonly because every
 *  invariant is decided once and never re-decided downstream. */
export type LessonStep = {
  readonly route: LearningRoute;
  readonly targetSkillIds: string[];
  readonly stage: MasteryStage;
  readonly mode: ActivityMode;
  readonly contextVariant: ContextVariant;
  readonly supportCeiling: SupportLevel;
  readonly requiredEvidence: EvidenceType[];
  readonly permittedWidgetKinds: WidgetKind[];
  readonly requiredVisualizationKind?: RequiredVisualizationKind;
  readonly proseSlots: ProseSlot[];
  readonly maxBoardOps: number;
  readonly corpusRef?: string;
};

/* ── Internal guards ────────────────────────────────────────────────────── */

function isValidEnum<T extends string | number>(
  value: unknown,
  allowed: readonly T[]
): value is T {
  return (allowed as readonly unknown[]).includes(value);
}

function isMasteryStage(value: unknown): value is MasteryStage {
  return (
    typeof value === "string" &&
    (LEARNING_ROUTES as readonly string[]).includes("direct_instruction") &&
    // MasteryStage is a narrow union, validated in mastery.ts. Re-import the
    // type guard inline to avoid a module cycle with the harness itself.
    ["encounter", "understand", "construct", "apply", "transfer", "master"].includes(value)
  );
}

/* ── Constructor ────────────────────────────────────────────────────────── */

/**
 * Validate and freeze a `LessonStepInput` into a `LessonStep`.
 *
 * The five invariants below are what used to be enforced (and order-sensitively
 * chained) inside the tutor harness. They live here now so the harness
 * validates them once at the boundary and never re-decides them downstream.
 *
 *   1. `permittedWidgetKinds` must be non-empty. A step with nothing the tutor
 *      is allowed to place cannot produce a board op and so cannot teach.
 *   2. `direct_instruction` is a presentation route — it has prose slots but
 *      no learner action. Zero prose slots means the agent has nothing to
 *      say and the step is unservable.
 *   3. A retrieval must be unaided: any support ceiling above zero would let
 *      a hinted retrieval manufacture competence evidence.
 *   4. `maxBoardOps` is clamped to `[1, 12]`. The harness never lets more
 *      ops onto the board in a single turn, and never fewer than one.
 *   5. `contextVariant` defaults to `"same"` so a step without an explicit
 *      variation is treated as literal repetition.
 *
 * Throws `Error("unservable: <reason>")` for the three rejection paths so the
 * planner sees a structured failure rather than a silent coercion.
 */
export function createLessonStep(input: LessonStepInput): LessonStep {
  if (!input.permittedWidgetKinds || input.permittedWidgetKinds.length === 0) {
    throw new Error(
      "unservable: a LessonStep must declare at least one permitted widget kind — a step with nothing for the tutor to place cannot teach."
    );
  }
  if (input.route === "direct_instruction" && (!input.proseSlots || input.proseSlots.length === 0)) {
    throw new Error(
      "unservable: direct_instruction is a presentation route and must carry at least one prose slot for the tutor's voice."
    );
  }
  if (input.supportCeiling > 0 && input.mode === "retrieval") {
    throw new Error(
      "unservable: a retrieval must be unaided — a support ceiling above 0 destroys the measurement the retrieval exists to make."
    );
  }
  if (!isValidEnum(input.route, LEARNING_ROUTES)) {
    throw new Error(`unservable: unknown route "${String(input.route)}"`);
  }
  if (!isMasteryStage(input.stage)) {
    throw new Error(`unservable: unknown mastery stage "${String(input.stage)}"`);
  }
  if (!isValidEnum(input.mode, ACTIVITY_MODES)) {
    throw new Error(`unservable: unknown activity mode "${String(input.mode)}"`);
  }
  if (input.contextVariant !== undefined && !isValidEnum(input.contextVariant, CONTEXT_VARIANTS)) {
    throw new Error(`unservable: unknown context variant "${String(input.contextVariant)}"`);
  }
  if (!isValidEnum(input.supportCeiling, SUPPORT_LEVELS)) {
    throw new Error(`unservable: support ceiling must be 0, 1, 2, or 3`);
  }
  for (const evidence of input.requiredEvidence ?? []) {
    if (!isValidEnum(evidence, EVIDENCE_TYPES)) {
      throw new Error(`unservable: unknown evidence type "${String(evidence)}"`);
    }
  }
  for (const slot of input.proseSlots ?? []) {
    if (!slot || typeof slot.blockId !== "string" || !slot.blockId.trim()) {
      throw new Error("unservable: every prose slot needs a non-empty blockId");
    }
    if (!["concise", "worked", "inquisitive"].includes(slot.tone)) {
      throw new Error(`unservable: unknown prose tone "${String(slot.tone)}"`);
    }
  }

  // Clamp `maxBoardOps` to `[1, 12]`. Below one is meaningless (no work),
  // above 12 collapses into the validator's per-turn cap with the same
  // outcome the harness used to clamp to anyway.
  const rawMax = typeof input.maxBoardOps === "number" && Number.isFinite(input.maxBoardOps)
    ? Math.round(input.maxBoardOps)
    : 1;
  const maxBoardOps = Math.min(12, Math.max(1, rawMax));

  // `contextVariant` defaults to "same". An unspecified variation is the
  // safest literal repetition; the planner that wanted a transfer check would
  // have said so explicitly.
  const contextVariant: ContextVariant = input.contextVariant ?? "same";

  const step: LessonStep = Object.freeze({
    route: input.route,
    targetSkillIds: [...input.targetSkillIds],
    stage: input.stage,
    mode: input.mode,
    contextVariant,
    supportCeiling: coerceSupportLevel(input.supportCeiling),
    requiredEvidence: [...input.requiredEvidence],
    permittedWidgetKinds: [...input.permittedWidgetKinds],
    ...(input.requiredVisualizationKind !== undefined
      ? { requiredVisualizationKind: input.requiredVisualizationKind }
      : {}),
    proseSlots: input.proseSlots.map((slot) => Object.freeze({ ...slot })),
    maxBoardOps,
    ...(input.corpusRef !== undefined ? { corpusRef: input.corpusRef } : {}),
  });

  return step;
}