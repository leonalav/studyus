/**
 * Helpers for the session roadmap widget.
 *
 * The `roadmapLedger` is the structural home of roadmap logic now that the
 * `enforceRoadmapProgress` enforcer has been removed. Construction and
 * positioning of roadmap widgets used to be defended by an order-sensitive
 * chain of checks; the surviving invariants live here as plain functions the
 * harness calls explicitly.
 *
 * Phase 1 only wires the helpers. The harness does not call
 * `getOrCreateRoadmapBlock` from `askTutorTurn` yet — that wiring is Phase 3
 * work, when the post-LLM compiler reads a `LessonStep` and emits board ops
 * directly. For now this module exists so the helpers have a stable home, the
 * dedup logic does not disappear into a deleted enforcer, and unit tests
 * still pass.
 */

import { MASTERY_STAGES, MASTERY_STAGE_SPECS, isMasteryStage, type MasteryStage } from "../mastery";
import type { BoardDoc } from "../../data/boards";
import { type BoardOp, type BoardBlockSpec } from "../tutor";
import type { RoadmapStep, RoadmapWidget, WidgetKind } from "../widgets/types";

/**
 * Locate the lesson roadmap already on the board.
 *
 * A session is allowed one roadmap. The first top-level (or nested-in-row)
 * roadmap widget is the map; later placements are duplicates the runtime must
 * rewrite into updates of this one.
 */
export function findBoardRoadmap(
  board: BoardDoc | undefined
): { anchor: string; index: number; intent: RoadmapWidget } | null {
  if (!board) return null;

  const walk = (
    blocks: BoardDoc["blocks"],
    pathPrefix: number[]
  ): { anchor: string; index: number; intent: RoadmapWidget } | null => {
    for (let i = 0; i < blocks.length; i += 1) {
      const block = blocks[i];
      if (block.kind === "widget" && block.intent.kind === "roadmap") {
        // Prefer the top-level index for targetIndex fallbacks; nested roadmaps
        // still expose their stable anchor, which update_widget prefers.
        return {
          anchor: block.id,
          index: pathPrefix.length === 0 ? i : pathPrefix[0] ?? i,
          intent: block.intent,
        };
      }
      if (block.kind === "row") {
        const nested = walk(block.children, pathPrefix.length === 0 ? [i] : pathPrefix);
        if (nested) return nested;
      }
    }
    return null;
  };

  return walk(board.blocks, []);
}

/**
 * Resolve a roadmap step id to a mastery stage when the id (or label) names one.
 * Custom lesson steps that do not map onto the ladder return null and are left
 * alone — this path only autowires Guide-to-Mastery roadmaps.
 *
 * Matching is exact (after normalizing to letters) against the stage id or the
 * published stage label. Substring includes (`"application".includes("apply")`)
 * are deliberately rejected: they silently promote free-form lesson steps onto
 * the mastery ladder and mark them done when the ledger moves.
 */
export function stageFromRoadmapStep(step: Pick<RoadmapStep, "id" | "label">): MasteryStage | null {
  const candidates = [step.id, step.label]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .map((value) => value.trim().toLowerCase().replace(/[^a-z]/g, ""));
  for (const candidate of candidates) {
    if (!candidate) continue;
    if (isMasteryStage(candidate)) return candidate;
    for (const stage of MASTERY_STAGES) {
      const label = MASTERY_STAGE_SPECS[stage].label.toLowerCase().replace(/[^a-z]/g, "");
      if (candidate === stage || candidate === label) return stage;
    }
  }
  return null;
}

/** True when a board block spec is a roadmap widget. */
export function isRoadmapBlockSpec(block: BoardBlockSpec): block is Extract<BoardBlockSpec, { kind: "widget" }> & {
  intent: RoadmapWidget;
} {
  return block.kind === "widget" && block.intent.kind === "roadmap";
}

/**
 * Any board op that would put a roadmap on the board or rewrite one in place.
 * Covers place/update and the block-shaped insert/replace/thread paths so a
 * second map cannot slip through a non-place channel.
 */
export function opCarriesRoadmap(op: BoardOp): boolean {
  if (op.op === "place_widget" || op.op === "update_widget") {
    return op.intent.kind === "roadmap";
  }
  if (op.op === "insert_after" || op.op === "replace_block") {
    return isRoadmapBlockSpec(op.block);
  }
  if (op.op === "spawn_thread") {
    return op.initialBlocks.some((block) => isRoadmapBlockSpec(block));
  }
  return false;
}

/**
 * Align roadmap step states to a demonstrated mastery stage.
 *
 * Steps that map onto the Guide to Mastery ladder become `done` when they sit
 * strictly before `liveStage`, `current` when they are the live stage, and
 * `upcoming` otherwise. Steps that do not map onto a stage keep their prior
 * state — we never invent progress for free-form lesson checkpoints.
 *
 * This is the only place that may mark a stage step done. Callers must pass a
 * stage that the evidence ledger (or an observed regression) actually moved to;
 * there is no weaker unsupported promotion path.
 */
export function buildRoadmapIntentForStage(
  existing: RoadmapWidget,
  liveStage: MasteryStage
): RoadmapWidget {
  const liveIndex = MASTERY_STAGES.indexOf(liveStage);
  let assignedCurrent = false;

  const steps: RoadmapStep[] = existing.steps.map((step) => {
    const mapped = stageFromRoadmapStep(step);
    if (!mapped) return { ...step };

    const stepIndex = MASTERY_STAGES.indexOf(mapped);
    let state: RoadmapStep["state"];
    if (stepIndex < liveIndex) {
      state = "done";
    } else if (stepIndex === liveIndex && !assignedCurrent) {
      state = "current";
      assignedCurrent = true;
    } else {
      state = "upcoming";
    }
    return { ...step, state };
  });

  // If no step mapped onto the live stage, leave the first non-done step as
  // current so the board still shows a single pointer — never invent a new step.
  if (!assignedCurrent) {
    const pointer = steps.find((step) => step.state !== "done");
    if (pointer) pointer.state = "current";
  }

  // At most one current — validator invariant, enforced here too.
  let sawCurrent = false;
  for (const step of steps) {
    if (step.state === "current") {
      if (sawCurrent) step.state = "upcoming";
      else sawCurrent = true;
    }
  }

  return { ...existing, steps };
}

export function isRoadmapWidgetOp(
  op: BoardOp
): op is Extract<BoardOp, { op: "place_widget" | "update_widget" }> & { intent: RoadmapWidget } {
  return (
    (op.op === "place_widget" || op.op === "update_widget") &&
    op.intent.kind === "roadmap"
  );
}

/** Strip roadmap widgets from a spawn_thread's initial block list. */
export function stripRoadmapsFromThread(op: Extract<BoardOp, { op: "spawn_thread" }>): BoardOp | null {
  const initialBlocks = op.initialBlocks.filter((block) => !isRoadmapBlockSpec(block));
  if (initialBlocks.length === op.initialBlocks.length) return op;
  if (initialBlocks.length === 0) return null;
  return { ...op, initialBlocks };
}

/** True when two roadmap intents disagree on step ids or states (order-sensitive). */
export function roadmapIntentDiffers(a: RoadmapWidget, b: RoadmapWidget): boolean {
  if (a.steps.length !== b.steps.length) return true;
  return a.steps.some(
    (step, i) => step.id !== b.steps[i]?.id || step.state !== b.steps[i]?.state
  );
}

/**
 * Look up the session roadmap, returning the anchor of the existing map (with
 * its intent) or null when none exists yet.
 *
 * Phase 3 will call this from the post-LLM compiler; the dedicated
 * `getOrCreateRoadmapBlock` helper described in the engineering plan lives
 * here as a named seam so the wiring has somewhere to land. Until then the
 * helper exists as documentation of the contract: a place_widget roadmap when
 * one already exists must be rewritten to update_widget, and an empty board
 * may receive a fresh place_widget.
 */
export function getOrCreateRoadmapBlock(
  board: BoardDoc | undefined,
  step: { permittedWidgetKinds: readonly WidgetKind[] }
): { action: "update"; anchor: string; intent: RoadmapWidget } | { action: "place" } | null {
  if (!step.permittedWidgetKinds.includes("roadmap")) return null;
  const existing = findBoardRoadmap(board);
  if (existing) return { action: "update", anchor: existing.anchor, intent: existing.intent };
  return { action: "place" };
}