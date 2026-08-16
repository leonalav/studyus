/**
 * Assembling the policy brief for a tutor turn.
 *
 * This module is the seam between the policy engine and the tutor harness. It
 * gathers everything the engine knows — per-skill state, due reviews, open
 * hypotheses, the support the learner has earned — decides the move, and
 * renders it as a prompt block.
 *
 * The tutor harness does not make instructional decisions. It calls
 * `buildPolicyBrief`, drops the rendered block into the prompt, and records the
 * resulting evidence. That division is the point: it means "the learner is never
 * asked to work independently before they can do it with help" is a property of
 * a function that can be tested, rather than a sentence in a prompt that can be
 * ignored under sampling.
 */

import type { MasteryStage } from "../mastery";
import { ensureSkillGraphBackfilled } from "./skillGraph";
import { formatMoveDirective, planNextMove, readSignals, type PolicySignals } from "./policy";
import { evaluateStageExit } from "./predicates";
import {
  decideSupport,
  formatRoutingTable,
  readAttemptSignal,
  type AttemptSignal,
  type SupportDecision,
} from "./support";
import {
  DEFAULT_LEARNER_ID,
  getDueReviews,
  getHypotheses,
  getSkillEvidence,
  getSkillState,
  normalizeSkillId,
  rebuildSkillState,
} from "./store";
import {
  buildSkillGraph,
  emptySkillState,
  prerequisiteChain,
  type LearnerHypothesis,
  type LearningActivityContract,
  type LearningEvidenceEvent,
  type NextLearningMove,
  type ReviewTask,
  type SkillNode,
  type SkillState,
  type LearningRoute,
} from "./types";
import { getSkillNodes, recordActivityContract } from "./store";

export interface PolicyBrief {
  /** The skill the turn is about. */
  skillId: string;
  state: SkillState;
  move: NextLearningMove;
  support: SupportDecision;
  /** What the learner's message itself showed: attempt, help request, or neither. */
  attempt: AttemptSignal;
  signals: PolicySignals;
  dueReviews: ReviewTask[];
  hypotheses: LearnerHypothesis[];
  /** The rendered prompt block. */
  prompt: string;
}

export interface PolicyBriefInput {
  learnerId?: string;
  /** The skill in focus this turn, however the caller resolved it. */
  skillId: string;
  /** The learner's message, read for attempt and help-seeking signals. */
  learnerMessage: string;
  /** Support already spent on this task family this episode. */
  supportAlreadyUsed?: 0 | 1 | 2 | 3;
  /** Set when the learner's last graded response was wrong. */
  lastAttemptFailed?: boolean;
  /** Session-level stage, used only as a floor for a skill with no evidence. */
  fallbackStage?: MasteryStage;
}

/**
 * Build the full policy brief for one turn.
 *
 * Reads state; writes nothing. Evidence is recorded after the turn completes, so
 * that a failed model call cannot leave the ledger claiming the learner did
 * something they never saw.
 */
export async function buildPolicyBrief(input: PolicyBriefInput): Promise<PolicyBrief> {
  const learnerId = input.learnerId ?? DEFAULT_LEARNER_ID;
  const skillId = normalizeSkillId(input.skillId);

  // Curricula and assessments ingested before the skill graph existed have no
  // edges, and a missing edge is invisible: prerequisite repair simply never
  // fires. Repair the graph once, before the first decision is taken on it.
  await ensureSkillGraphBackfilled();

  const [events, existingState, dueReviews, hypotheses, nodes] = await Promise.all([
    getSkillEvidence(skillId, learnerId),
    getSkillState(skillId, learnerId),
    getDueReviews(learnerId, new Date(), 2),
    getHypotheses(learnerId, skillId),
    getSkillNodes(),
  ]);

  const state =
    existingState ??
    ({
      ...emptySkillState(learnerId, skillId),
      // A brand-new skill inherits the session's stage as a starting point so a
      // learner mid-lesson is not thrown back to Encounter by the mere fact
      // that the skill was only just named. Evidence overrides it immediately.
      stage: input.fallbackStage ?? "encounter",
    } satisfies SkillState);

  const weakPrerequisites = await findWeakPrerequisites(learnerId, skillId, nodes);

  const move = planNextMove({
    state,
    events,
    dueReviews,
    hypotheses: hypotheses.filter((hypothesis) => !hypothesis.learnerDisputed),
    weakPrerequisites,
  });

  const attempt = readAttemptSignal(input.learnerMessage, {
    attemptFailed: input.lastAttemptFailed,
    supportAlreadyUsed: input.supportAlreadyUsed ?? 0,
  });
  const support = decideSupport(attempt, move.supportCeiling);
  const signals = readSignals(events);

  return {
    skillId,
    state,
    move,
    support,
    attempt,
    signals,
    dueReviews,
    hypotheses,
    prompt: formatPolicyBrief({ state, events, move, support, hypotheses, dueReviews }),
  };
}

/**
 * Prerequisites that are themselves weak.
 *
 * Only the nearest few are checked; walking the whole graph would be both slow
 * and pointless, since a failure three levels down is not the proximate cause
 * of a failure here.
 */
async function findWeakPrerequisites(
  learnerId: string,
  skillId: string,
  nodes: SkillNode[]
): Promise<{ skillId: string; state: SkillState }[]> {
  if (nodes.length === 0) return [];
  const graph = buildSkillGraph(nodes);
  const chain = prerequisiteChain(graph, skillId, 4);
  const out: { skillId: string; state: SkillState }[] = [];

  for (const prereqId of chain) {
    const state = await getSkillState(prereqId, learnerId);
    if (!state) continue;
    // "Weak" means the prerequisite has evidence AND that evidence is poor.
    // A prerequisite with no evidence at all is unknown, not weak, and
    // dropping into repair on an unknown is how a competent learner gets
    // marched through material they already have.
    if (state.totalEvidenceCount >= 2 && (state.procedure < 60 || state.understanding < 60)) {
      out.push({ skillId: prereqId, state });
    }
  }
  return out;
}

/**
 * Render the brief as the prompt block the tutor receives.
 *
 * Structured as: where the learner actually is → what the gate still needs →
 * what move to make → how much help is allowed → how to route this specific
 * message. The model is given the reasoning, not just the verdict, because a
 * model that understands why a ceiling exists holds it better than one merely
 * told to.
 */
export function formatPolicyBrief(params: {
  state: SkillState;
  events: LearningEvidenceEvent[];
  move: NextLearningMove;
  support: SupportDecision;
  hypotheses: LearnerHypothesis[];
  dueReviews: ReviewTask[];
}): string {
  const { state, events, move, support } = params;
  const sections: string[] = [];

  sections.push(
    [
      `EVIDENCE STATE — skill "${state.skillId}" (computed from ${state.totalEvidenceCount} recorded observation${state.totalEvidenceCount === 1 ? "" : "s"}; these numbers are derived, and you must not restate, revise, or invent them)`,
      `Stage: ${state.stage}`,
      `Recall ${state.recall} · Understanding ${state.understanding} · Procedure ${state.procedure} · Transfer ${state.transfer} · Independence ${state.independence}`,
      `Unaided successes: ${state.unaidedSuccesses} · Supported successes: ${state.supportedSuccesses} · Successful delayed retrievals: ${state.successfulRetrievals}`,
    ].join("\n")
  );

  const gate = evaluateStageExit(state.stage, events);
  sections.push(
    [
      `STAGE GATE: ${gate.summary}`,
      gate.satisfied
        ? "This gate is met by the ledger. You do not need to argue for advancement; it happens automatically when the evidence supports it."
        : `Still missing: ${gate.missing.join("; ")}`,
      "Advancement is decided by these predicates, not by your judgement that the learner seems ready. Produce the missing evidence and the stage moves on its own.",
    ].join("\n")
  );

  sections.push(formatMoveDirective(move));

  if (support.instruction) {
    sections.push(`SUPPORT DECISION FOR THIS TURN\n${support.instruction}`);
  }

  const live = params.hypotheses.filter(
    (hypothesis) =>
      !hypothesis.learnerDisputed &&
      (hypothesis.status === "suspected" || hypothesis.status === "supported")
  );
  if (live.length > 0) {
    sections.push(
      [
        "OPEN HYPOTHESES ABOUT THIS LEARNER — these are provisional claims, not facts. Treat them as things to test, and let the learner's work overturn them.",
        ...live
          .slice(0, 4)
          .map(
            (hypothesis) =>
              `- [${hypothesis.status}] ${hypothesis.kind.replace(/_/g, " ")}: ${hypothesis.statement}\n  Next best test: ${hypothesis.nextBestTest}`
          ),
      ].join("\n")
    );
  }

  sections.push(formatRoutingTable());

  return sections.join("\n\n");
}

/**
 * The session-opening brief: due reviews before new material.
 *
 * Returns an empty string when nothing is due, so the caller can append it
 * unconditionally. Capped at two — a learner returning after a month has a long
 * queue, and opening a session with all of it is how spaced repetition becomes
 * the thing people quit.
 */
export async function buildSessionOpeningBrief(
  learnerId = DEFAULT_LEARNER_ID,
  now: Date = new Date()
): Promise<string> {
  const due = await getDueReviews(learnerId, now, 2);
  if (due.length === 0) return "";

  const lines = due.map((task) => {
    const overdueDays = Math.max(
      0,
      Math.floor((now.getTime() - new Date(task.dueAt).getTime()) / 86_400_000)
    );
    const why = task.reconstruction
      ? "an unaided reconstruction is owed — the learner's success here came with substantive support"
      : `scheduled retrieval, ${overdueDays === 0 ? "due today" : `${overdueDays} day${overdueDays === 1 ? "" : "s"} overdue`}`;
    return `- ${task.skillId} (family "${task.taskFamily}"): ${why}. Retrieval type: ${task.retrievalType.replace(/_/g, " ")}.`;
  });

  return [
    "DUE RETRIEVALS — surface these before new teaching.",
    ...lines,
    "Each must be unaided: no hints, no worked steps, no narrowing of the option space, even if asked. A coached retrieval measures the coaching, and the whole value of a scheduled review is that it is uncoached.",
    "If a retrieval fails, do not simply supply the answer. Route into targeted repair on the specific thing that was lost, then reschedule.",
  ].join("\n");
}

/**
 * Persist the contract the turn's board activity is placed under.
 *
 * A contract is what turns an interaction into evidence. Without one, "the
 * learner selected option B" is a click; with one, it is a `selection` on
 * `chain_rule` at support ceiling 1 in a `changed_representation` variant,
 * against a named task family, produced to serve a named route. Only the second
 * can be reasoned about — the stage predicates count distinct task families,
 * the review queue settles on `(skill, taskFamily)`, and transfer credit
 * depends on the context variant. All three read fields that live here.
 *
 * The contract is derived from the planner's move rather than authored by the
 * model, which is the same separation the whole engine rests on: the policy
 * engine decides what evidence is needed and the model decides how to elicit
 * it. Letting the model declare its own contract would let it declare its own
 * task family and context variant, and with those it could satisfy a breadth
 * requirement by renaming the same task five times.
 *
 * Returns the contract so a caller can attach it to the widgets it places, and
 * `undefined` if persistence failed — an activity the ledger cannot describe
 * should produce evidence with no contract rather than evidence with a
 * contract nothing recorded.
 */
/**
 * The task family for a move that carries no obligation family of its own.
 *
 * Scoped to the turn that posed it, because two different problems posed on
 * two different turns are two families, not one.
 */
export function routeTaskFamily(
  skillId: string,
  route: LearningRoute,
  turnOrdinal: number
): string {
  return `${skillId}:${route}#${turnOrdinal}`;
}

export async function recordMoveActivity(params: {
  learnerId: string;
  sessionId: string;
  skillId: string;
  move: NextLearningMove;
  turnOrdinal: number;
}): Promise<LearningActivityContract | undefined> {
  const { move } = params;
  const contract: LearningActivityContract = {
    activityId: `act-${params.sessionId}-${params.turnOrdinal}`,
    targetSkillIds: move.targetSkillIds.length ? move.targetSkillIds : [params.skillId],
    stage: move.stage,
    mode: move.mode,
    route: move.route,
    // A route name is not a task family. Every independent-practice turn on a
    // skill would otherwise be filed under the single family
    // "<skill>:independent_practice", and the stage predicates count DISTINCT
    // families: a learner could solve five different problems perfectly and
    // unaided and the Apply gate would still read "have 0", because all five
    // collapsed into one family. The gate would be unreachable through the
    // board no matter how well anyone did.
    //
    // So when the move carries no obligation family of its own, the family is
    // scoped to the activity that posed it — each turn poses a different
    // problem, so each is its own family. When the move DOES carry a family it
    // is used verbatim: that value is an obligation (a due review or an owed
    // reconstruction) and reviews are settled by exact (skill, taskFamily)
    // match, so appending anything here would leave the debt uncleared forever.
    taskFamily: move.taskFamily ?? routeTaskFamily(params.skillId, move.route, params.turnOrdinal),
    contextVariant: move.contextVariant,
    supportCeiling: move.supportCeiling,
    expectedEvidence: move.requiredEvidence,
    // The move's rationale evidence is what justified this activity; carrying
    // the ids forward is what makes "why was I asked this" answerable later.
    successCriteria: move.rationaleEvidenceIds,
    representationRoles: [],
    permittedWidgetKinds: move.permittedWidgetKinds,
    createdAt: new Date().toISOString(),
  };

  try {
    await recordActivityContract(contract, params.sessionId, params.learnerId);
    return contract;
  } catch (error) {
    console.warn("[policy] could not persist the activity contract for this turn", error);
    return undefined;
  }
}

/** Recompute a skill's state after a turn's evidence has been written. */
export async function refreshSkillAfterTurn(
  learnerId: string,
  skillIds: string[]
): Promise<SkillState[]> {
  const out: SkillState[] = [];
  for (const skillId of skillIds) {
    out.push(await rebuildSkillState(learnerId, skillId));
  }
  return out;
}
