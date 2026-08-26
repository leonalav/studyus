/**
 * Persistence for the evidence ledger and everything derived from it.
 *
 * Two rules shape this module:
 *
 *  1. **The ledger is append-only.** `recordEvidence` inserts; nothing updates
 *     or deletes a `learning_evidence` row in normal operation. A mistaken
 *     observation is corrected by recording a further observation, because a
 *     history that can be rewritten cannot justify a verdict.
 *
 *  2. **Derived state is always rebuildable.** `skill_state` is a cache of a
 *     pure function of the ledger. `rebuildSkillState` recomputes it from
 *     scratch, and every write path goes through that function rather than
 *     incrementally patching numbers — incremental updates are how derived
 *     state silently drifts away from the evidence it claims to summarize.
 */

import { getDb, saveDbSync } from "../../db/database";
import { retrievalIntervalDays } from "../mastery";
import { deriveSkillState, isSubstantiveSupport, nextReviewDueAt } from "./evidence";
import {
  isContextVariant,
  isCorrectness,
  isEvidenceSource,
  isEvidenceType,
  isHypothesisKind,
  isRetrievalType,
  isSelfReportedFamiliarity,
  coerceSupportLevel,
  type LearnerHypothesis,
  type LearningActivityContract,
  type LearningEvidenceEvent,
  type LearningEvidenceInput,
  type ReviewTask,
  type ReviewTaskState,
  type SelfReportedFamiliarity,
  type SkillNode,
  type SkillState,
} from "./types";

export const DEFAULT_LEARNER_ID = "default_learner";

/** Bounds on learner- and model-authored free text entering the ledger. */
const MAX_RESPONSE_CHARS = 2000;
const MAX_SKILL_IDS = 8;
const MAX_CRITERION_IDS = 20;

function nowIso(): string {
  return new Date().toISOString();
}

function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function parseList(value: unknown): string[] {
  if (typeof value !== "string" || !value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

/** Normalize a free-form identifier into a stable skill id. */
export function normalizeSkillId(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80) || "unspecified";
}

/* ─────────────────────────────────────────────────────────────
   Evidence
   ───────────────────────────────────────────────────────────── */

/**
 * Append one observation to the ledger and rebuild the affected skill states.
 *
 * Returns the stored event so the caller can cite its id — every stage advance,
 * hypothesis, and mastery number in the app is expected to be traceable to
 * specific evidence ids, and that is only possible if callers get them back.
 */
export async function recordEvidence(input: LearningEvidenceInput): Promise<LearningEvidenceEvent> {
  const db = await getDb();

  const skillIds = [...new Set(input.skillIds.map(normalizeSkillId))].slice(0, MAX_SKILL_IDS);
  if (skillIds.length === 0) skillIds.push("unspecified");

  const event: LearningEvidenceEvent = {
    evidenceId: input.evidenceId ?? newId("ev"),
    learnerId: input.learnerId ?? DEFAULT_LEARNER_ID,
    skillIds,
    taskId: input.taskId.slice(0, 200),
    taskFamily: input.taskFamily.slice(0, 200),
    contextVariant: isContextVariant(input.contextVariant) ? input.contextVariant : "same",
    activityId: input.activityId,
    sessionId: input.sessionId,
    evidenceType: isEvidenceType(input.evidenceType) ? input.evidenceType : "observation",
    response: (input.response ?? "").slice(0, MAX_RESPONSE_CHARS),
    correctness: isCorrectness(input.correctness) ? input.correctness : "unknown",
    rubricCriterionIds: (input.rubricCriterionIds ?? []).slice(0, MAX_CRITERION_IDS),
    supportLevel: coerceSupportLevel(input.supportLevel),
    // Hint exposure defaults to the ceiling only when unknown would understate
    // it. Defaulting to 0 would let an unreported hint mint independence.
    hintExposure: Number.isFinite(input.hintExposure)
      ? Math.max(0, Math.min(3, Math.round(input.hintExposure as number)))
      : coerceSupportLevel(input.supportLevel),
    responseTimeMs: input.responseTimeMs,
    selfRatedConfidence: input.selfRatedConfidence,
    evaluatorConfidence: input.evaluatorConfidence,
    delayed: input.delayed ?? false,
    // Coerced like every other enum on this row. An unrecognised source used to
    // reach the SQL binding as `undefined`, which sql.js rejects with an opaque
    // "wrong API use" error — the caller loses the evidence and gets a message
    // that names neither the field nor the row. Attributing an event to an
    // unknown origin is a much smaller problem than dropping it.
    source: isEvidenceSource(input.source) ? input.source : "tutor_turn",
    timestamp: input.timestamp ?? nowIso(),
  };

  db.run(
    `INSERT OR REPLACE INTO learning_evidence (
      evidence_id, learner_id, skill_ids, task_id, task_family, context_variant,
      activity_id, session_id, evidence_type, response, correctness,
      rubric_criterion_ids, support_level, hint_exposure, response_time_ms,
      self_rated_confidence, evaluator_confidence, delayed, source, timestamp
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?);`,
    [
      event.evidenceId,
      event.learnerId,
      JSON.stringify(event.skillIds),
      event.taskId,
      event.taskFamily,
      event.contextVariant,
      event.activityId ?? null,
      event.sessionId ?? null,
      event.evidenceType,
      event.response,
      event.correctness,
      JSON.stringify(event.rubricCriterionIds),
      event.supportLevel,
      event.hintExposure,
      event.responseTimeMs ?? null,
      event.selfRatedConfidence ?? null,
      event.evaluatorConfidence ?? null,
      event.delayed ? 1 : 0,
      event.source,
      event.timestamp,
    ]
  );

  for (const skillId of event.skillIds) {
    await rebuildSkillState(event.learnerId, skillId);
  }
  await applyReviewConsequences(event);
  await applyHypothesisConsequences(event);

  saveDbSync();
  return event;
}

function rowToEvidence(row: any[]): LearningEvidenceEvent {
  return {
    evidenceId: String(row[0]),
    learnerId: String(row[1]),
    skillIds: parseList(row[2]),
    taskId: String(row[3]),
    taskFamily: String(row[4]),
    contextVariant: isContextVariant(row[5]) ? row[5] : "same",
    activityId: row[6] ? String(row[6]) : undefined,
    sessionId: row[7] ? String(row[7]) : undefined,
    evidenceType: isEvidenceType(row[8]) ? row[8] : "observation",
    response: String(row[9] ?? ""),
    correctness: isCorrectness(row[10]) ? row[10] : "unknown",
    rubricCriterionIds: parseList(row[11]),
    supportLevel: coerceSupportLevel(row[12]),
    hintExposure: Number(row[13] ?? 0),
    responseTimeMs: row[14] === null || row[14] === undefined ? undefined : Number(row[14]),
    selfRatedConfidence: row[15] === null || row[15] === undefined ? undefined : Number(row[15]),
    evaluatorConfidence: row[16] === null || row[16] === undefined ? undefined : Number(row[16]),
    delayed: Number(row[17]) === 1,
    source: String(row[18]) as LearningEvidenceEvent["source"],
    timestamp: String(row[19]),
  };
}

const EVIDENCE_COLUMNS = `evidence_id, learner_id, skill_ids, task_id, task_family, context_variant,
  activity_id, session_id, evidence_type, response, correctness, rubric_criterion_ids,
  support_level, hint_exposure, response_time_ms, self_rated_confidence,
  evaluator_confidence, delayed, source, timestamp`;

/**
 * All evidence bearing on one skill, oldest first.
 *
 * Filtered in JS rather than SQL because `skill_ids` is a JSON array — an event
 * can be evidence about several skills at once, which is the normal case for a
 * task that exercises a method and its prerequisite together.
 */
export async function getSkillEvidence(
  skillId: string,
  learnerId = DEFAULT_LEARNER_ID,
  limit = 200
): Promise<LearningEvidenceEvent[]> {
  const db = await getDb();
  const normalized = normalizeSkillId(skillId);
  const res = db.exec(
    `SELECT ${EVIDENCE_COLUMNS} FROM learning_evidence WHERE learner_id = ? ORDER BY timestamp ASC;`,
    [learnerId]
  );
  const rows = res[0]?.values ?? [];
  return rows
    .map(rowToEvidence)
    .filter((event) => event.skillIds.includes(normalized))
    .slice(-limit);
}

export async function getSessionEvidence(sessionId: string, limit = 100): Promise<LearningEvidenceEvent[]> {
  const db = await getDb();
  const res = db.exec(
    `SELECT ${EVIDENCE_COLUMNS} FROM learning_evidence WHERE session_id = ? ORDER BY timestamp ASC LIMIT ?;`,
    [sessionId, limit]
  );
  return (res[0]?.values ?? []).map(rowToEvidence);
}

export async function getEvidenceByIds(ids: string[]): Promise<LearningEvidenceEvent[]> {
  if (ids.length === 0) return [];
  const db = await getDb();
  const placeholders = ids.map(() => "?").join(",");
  const res = db.exec(
    `SELECT ${EVIDENCE_COLUMNS} FROM learning_evidence WHERE evidence_id IN (${placeholders}) ORDER BY timestamp ASC;`,
    ids
  );
  return (res[0]?.values ?? []).map(rowToEvidence);
}

/* ─────────────────────────────────────────────────────────────
   Skill state
   ───────────────────────────────────────────────────────────── */

/**
 * Recompute one skill's state from the ledger and persist the result.
 *
 * Always a full recomputation. Cheap at these volumes, and it means the cache
 * can never disagree with the evidence — a class of bug that in a learning
 * system shows up as a learner being told they have mastered something they
 * have not.
 */
export async function rebuildSkillState(
  learnerId: string,
  skillId: string
): Promise<SkillState> {
  const db = await getDb();
  const normalized = normalizeSkillId(skillId);
  const events = await getSkillEvidence(normalized, learnerId);
  const previous = await getSkillState(normalized, learnerId);
  const state = deriveSkillState(learnerId, normalized, events, previous);

  db.run(
    `INSERT OR REPLACE INTO skill_state (
      learner_id, skill_id, stage, stage_evidence_ids, recall, understanding,
      procedure, transfer, independence, unaided_successes, supported_successes,
      total_evidence_count, successful_retrievals, reconstruction_due_task_family,
      last_evidence_at, updated_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?);`,
    [
      state.learnerId,
      state.skillId,
      state.stage,
      JSON.stringify(state.stageEvidenceIds),
      state.recall,
      state.understanding,
      state.procedure,
      state.transfer,
      state.independence,
      state.unaidedSuccesses,
      state.supportedSuccesses,
      state.totalEvidenceCount,
      state.successfulRetrievals,
      state.reconstructionDueTaskFamily ?? null,
      state.lastEvidenceAt ?? null,
      state.updatedAt,
    ]
  );
  saveDbSync();
  return state;
}

function rowToSkillState(row: any[]): SkillState {
  return {
    learnerId: String(row[0]),
    skillId: String(row[1]),
    stage: String(row[2]) as SkillState["stage"],
    stageEvidenceIds: parseList(row[3]),
    recall: Number(row[4]),
    understanding: Number(row[5]),
    procedure: Number(row[6]),
    transfer: Number(row[7]),
    independence: Number(row[8]),
    unaidedSuccesses: Number(row[9]),
    supportedSuccesses: Number(row[10]),
    totalEvidenceCount: Number(row[11]),
    successfulRetrievals: Number(row[12]),
    reconstructionDueTaskFamily: row[13] ? String(row[13]) : undefined,
    lastEvidenceAt: row[14] ? String(row[14]) : undefined,
    updatedAt: String(row[15]),
  };
}

const SKILL_STATE_COLUMNS = `learner_id, skill_id, stage, stage_evidence_ids, recall, understanding,
  procedure, transfer, independence, unaided_successes, supported_successes,
  total_evidence_count, successful_retrievals, reconstruction_due_task_family,
  last_evidence_at, updated_at`;

export async function getSkillState(
  skillId: string,
  learnerId = DEFAULT_LEARNER_ID
): Promise<SkillState | undefined> {
  const db = await getDb();
  const res = db.exec(
    `SELECT ${SKILL_STATE_COLUMNS} FROM skill_state WHERE learner_id = ? AND skill_id = ?;`,
    [learnerId, normalizeSkillId(skillId)]
  );
  const row = res[0]?.values?.[0];
  return row ? rowToSkillState(row) : undefined;
}

export async function getAllSkillStates(learnerId = DEFAULT_LEARNER_ID): Promise<SkillState[]> {
  const db = await getDb();
  const res = db.exec(
    `SELECT ${SKILL_STATE_COLUMNS} FROM skill_state WHERE learner_id = ? ORDER BY updated_at DESC;`,
    [learnerId]
  );
  return (res[0]?.values ?? []).map(rowToSkillState);
}

/* ─────────────────────────────────────────────────────────────
   Review queue
   ───────────────────────────────────────────────────────────── */

const REVIEW_COLUMNS = `review_id, learner_id, skill_id, task_family, due_at, interval_index,
  state, required_mode, retrieval_type, reconstruction, created_at, last_attempted_at, attempt_count`;

function rowToReview(row: any[]): ReviewTask {
  return {
    reviewId: String(row[0]),
    learnerId: String(row[1]),
    skillId: String(row[2]),
    taskFamily: String(row[3]),
    dueAt: String(row[4]),
    intervalIndex: Number(row[5]),
    state: String(row[6]) as ReviewTaskState,
    requiredMode: "unaided",
    retrievalType: isRetrievalType(row[8]) ? row[8] : "cued_recall",
    reconstruction: Number(row[9]) === 1,
    createdAt: String(row[10]),
    lastAttemptedAt: row[11] ? String(row[11]) : undefined,
    attemptCount: Number(row[12] ?? 0),
  };
}

/**
 * Schedule a retrieval.
 *
 * The unique partial index on (learner, skill, family) for open states means
 * re-scheduling an already-pending review updates it rather than stacking
 * duplicates — otherwise a learner returning after a fortnight would be met
 * with fourteen copies of the same review.
 */
export async function scheduleReview(params: {
  learnerId?: string;
  skillId: string;
  taskFamily: string;
  dueAt: Date;
  intervalIndex?: number;
  retrievalType?: ReviewTask["retrievalType"];
  reconstruction?: boolean;
}): Promise<ReviewTask> {
  const db = await getDb();
  const learnerId = params.learnerId ?? DEFAULT_LEARNER_ID;
  const skillId = normalizeSkillId(params.skillId);
  const taskFamily = params.taskFamily.slice(0, 200);

  const existing = db.exec(
    `SELECT ${REVIEW_COLUMNS} FROM review_tasks
     WHERE learner_id = ? AND skill_id = ? AND task_family = ? AND state IN ('scheduled','due') LIMIT 1;`,
    [learnerId, skillId, taskFamily]
  );
  const existingRow = existing[0]?.values?.[0];

  const task: ReviewTask = {
    reviewId: existingRow ? String(existingRow[0]) : newId("rv"),
    learnerId,
    skillId,
    taskFamily,
    dueAt: params.dueAt.toISOString(),
    intervalIndex: params.intervalIndex ?? 0,
    state: "scheduled",
    requiredMode: "unaided",
    retrievalType: params.retrievalType ?? "cued_recall",
    // A reconstruction obligation survives rescheduling: an unaided redo that
    // was owed does not stop being owed because a routine review landed on the
    // same family.
    reconstruction: params.reconstruction || (existingRow ? Number(existingRow[9]) === 1 : false),
    createdAt: existingRow ? String(existingRow[10]) : nowIso(),
    lastAttemptedAt: existingRow && existingRow[11] ? String(existingRow[11]) : undefined,
    attemptCount: existingRow ? Number(existingRow[12] ?? 0) : 0,
  };

  db.run(
    `INSERT OR REPLACE INTO review_tasks (
      ${REVIEW_COLUMNS}
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?);`,
    [
      task.reviewId,
      task.learnerId,
      task.skillId,
      task.taskFamily,
      task.dueAt,
      task.intervalIndex,
      task.state,
      task.requiredMode,
      task.retrievalType,
      task.reconstruction ? 1 : 0,
      task.createdAt,
      task.lastAttemptedAt ?? null,
      task.attemptCount,
    ]
  );
  saveDbSync();
  return task;
}

/**
 * Reviews that are due now, most overdue first.
 *
 * Capped by the caller at 1–2 at session start. A learner who has been away for
 * a month has a long queue, and opening with all of it is how spaced repetition
 * turns into a chore people quit.
 */
export async function getDueReviews(
  learnerId = DEFAULT_LEARNER_ID,
  now: Date = new Date(),
  limit = 2
): Promise<ReviewTask[]> {
  const db = await getDb();
  const res = db.exec(
    `SELECT ${REVIEW_COLUMNS} FROM review_tasks
     WHERE learner_id = ? AND state IN ('scheduled','due','lapsed') AND due_at <= ?
     ORDER BY reconstruction DESC, due_at ASC LIMIT ?;`,
    [learnerId, now.toISOString(), limit]
  );
  return (res[0]?.values ?? []).map(rowToReview);
}

export async function getOpenReviews(learnerId = DEFAULT_LEARNER_ID): Promise<ReviewTask[]> {
  const db = await getDb();
  const res = db.exec(
    `SELECT ${REVIEW_COLUMNS} FROM review_tasks
     WHERE learner_id = ? AND state IN ('scheduled','due','lapsed') ORDER BY due_at ASC;`,
    [learnerId]
  );
  return (res[0]?.values ?? []).map(rowToReview);
}

/**
 * Record the outcome of a review and reschedule.
 *
 * Pass advances the interval index along the spacing schedule; fail resets it to
 * the start AND marks the task lapsed so the planner routes into repair rather
 * than simply asking again later. Re-asking a question the learner just failed
 * is not spacing, it is nagging.
 */
export async function completeReview(
  reviewId: string,
  passed: boolean,
  now: Date = new Date()
): Promise<ReviewTask | undefined> {
  const db = await getDb();
  const res = db.exec(`SELECT ${REVIEW_COLUMNS} FROM review_tasks WHERE review_id = ?;`, [reviewId]);
  const row = res[0]?.values?.[0];
  if (!row) return undefined;
  const task = rowToReview(row);

  const intervalIndex = passed ? task.intervalIndex + 1 : 0;
  const dueAt = new Date(now.getTime());
  dueAt.setDate(dueAt.getDate() + retrievalIntervalDays(intervalIndex));

  const updated: ReviewTask = {
    ...task,
    intervalIndex,
    // A passed reconstruction discharges the obligation; a failed one keeps it.
    reconstruction: passed ? false : task.reconstruction,
    state: passed ? "scheduled" : "lapsed",
    dueAt: dueAt.toISOString(),
    lastAttemptedAt: now.toISOString(),
    attemptCount: task.attemptCount + 1,
  };

  db.run(
    `UPDATE review_tasks SET interval_index = ?, state = ?, due_at = ?, reconstruction = ?,
      last_attempted_at = ?, attempt_count = ? WHERE review_id = ?;`,
    [
      updated.intervalIndex,
      updated.state,
      updated.dueAt,
      updated.reconstruction ? 1 : 0,
      updated.lastAttemptedAt ?? null,
      updated.attemptCount,
      reviewId,
    ]
  );
  saveDbSync();
  return updated;
}

export async function retireReview(reviewId: string): Promise<void> {
  const db = await getDb();
  db.run("UPDATE review_tasks SET state = 'retired' WHERE review_id = ?;", [reviewId]);
  saveDbSync();
}

/**
 * Apply an evidence event's consequences to the review queue.
 *
 * Two obligations are discharged or created here, and both are code-enforced
 * rather than left to the model to remember:
 *
 *  - **Substantive support schedules a reconstruction.** Whenever the learner
 *    succeeded only with structural help or better, an unaided redo on a
 *    near-but-not-identical task in the same family is queued for the next day.
 *    This is what stops "correct after three hints" from being filed as
 *    competence.
 *  - **A retrieval outcome advances or resets the schedule** for the family it
 *    was drawn from.
 */
async function applyReviewConsequences(event: LearningEvidenceEvent): Promise<void> {
  const succeeded = event.correctness === "correct" || event.correctness === "partial";

  for (const skillId of event.skillIds) {
    // Only a DEFINITE verdict settles a review. A retrieval whose correctness
    // is unknown or blank is not a failed retrieval — it is an unmarked one,
    // and the two must not be conflated.
    //
    // This matters because the most common retrieval in the product is
    // conversational, and a conversation cannot be graded: the tutor reports
    // "unknown" for anything it did not positively identify as wrong. Settling
    // on `correctness === "correct"` would therefore read every ordinary
    // spoken review as a failure, mark the skill lapsed, and reset the spacing
    // interval to zero. The learner would answer a review correctly, in
    // words, and be punished for it — their intervals collapsing toward daily
    // while the ledger recorded a competence they never lost.
    //
    // Leaving the review open is the honest outcome: the obligation has not
    // been discharged, because nothing was actually measured. It comes due
    // again and gets a markable task next time.
    const settles =
      event.correctness === "correct" ||
      event.correctness === "partial" ||
      event.correctness === "incorrect";

    if (event.evidenceType === "retrieval" && settles) {
      const open = await getOpenReviews(event.learnerId);
      const match = open.find(
        (task) => task.skillId === skillId && task.taskFamily === event.taskFamily
      );
      if (match) {
        // Partial recall is a pass for scheduling purposes: the trace was
        // there and needed only prompting, which is what the next interval is
        // meant to test. Treating it as a lapse would reset a learner who is
        // remembering most of it back to day one.
        await completeReview(match.reviewId, event.correctness !== "incorrect");
        continue;
      }
    }

    if (succeeded && isSubstantiveSupport(event)) {
      const dueAt = new Date();
      dueAt.setDate(dueAt.getDate() + 1);
      await scheduleReview({
        learnerId: event.learnerId,
        skillId,
        taskFamily: event.taskFamily,
        dueAt,
        intervalIndex: 0,
        retrievalType: "applied",
        reconstruction: true,
      });
      continue;
    }

    // An unaided success is what schedules ordinary forward spacing.
    if (event.correctness === "correct" && event.supportLevel === 0 && event.hintExposure === 0) {
      const state = await getSkillState(skillId, event.learnerId);
      if (state) {
        await scheduleReview({
          learnerId: event.learnerId,
          skillId,
          taskFamily: event.taskFamily,
          dueAt: nextReviewDueAt(state),
          intervalIndex: state.successfulRetrievals,
          retrievalType: state.stage === "master" ? "free_recall" : "cued_recall",
        });
      }
    }
  }
}

/**
 * Kinds of hypothesis that an unaided success genuinely refutes.
 *
 * Being deliberate about this list is the whole point. A clean independent
 * answer really does count against "they believe the wrong rule", "they are
 * missing the prerequisite", "they cannot execute the procedure", "the wording
 * is the obstacle", and "they can do it but do not believe they can". It counts
 * against none of the others:
 *
 *  - **overconfidence** is not refuted by success; success is what an
 *    overconfident learner expects, and their calibration is the open question.
 *  - **careless_error** describes a rate, not a capability. One clean answer is
 *    exactly what a careless learner produces most of the time.
 *  - **disengagement** is about effort, not correctness, and is handled below
 *    on its own terms.
 */
const REFUTED_BY_UNAIDED_SUCCESS: ReadonlySet<LearnerHypothesis["kind"]> = new Set([
  "misconception",
  "missing_prerequisite",
  "procedural_slip",
  "language_issue",
  "low_confidence",
]);

/** A response long enough to represent real effort rather than a shrug. */
const SUBSTANTIVE_RESPONSE_CHARS = 25;

/**
 * Let new evidence count against standing hypotheses.
 *
 * This is the path by which the learner model gets SMALLER, and it matters more
 * than the path by which it grows. A model that only ever accumulates claims
 * becomes a permanent record of a learner's worst day: months later the tutor
 * is still routing around a misconception the learner fixed in one session,
 * teaching the person they used to be. Automatic contradiction means the
 * learner does not have to argue their way out of a label — demonstrating the
 * skill is the argument.
 *
 * The learner's own dispute is respected absolutely: a disputed hypothesis is
 * left exactly as it is, because re-touching it would be the system relitigating
 * a claim the learner has already rejected.
 */
async function applyHypothesisConsequences(event: LearningEvidenceEvent): Promise<void> {
  const unaidedSuccess =
    event.correctness === "correct" && event.supportLevel === 0 && event.hintExposure === 0;
  const substantive =
    event.correctness !== "blank" && event.response.trim().length >= SUBSTANTIVE_RESPONSE_CHARS;
  if (!unaidedSuccess && !substantive) return;

  for (const skillId of event.skillIds) {
    const open = (await getHypotheses(event.learnerId, skillId)).filter(
      (hypothesis) =>
        !hypothesis.learnerDisputed &&
        (hypothesis.status === "suspected" || hypothesis.status === "supported")
    );

    for (const hypothesis of open) {
      if (unaidedSuccess && REFUTED_BY_UNAIDED_SUCCESS.has(hypothesis.kind)) {
        await contradictHypothesis(hypothesis.hypothesisId, event.evidenceId);
        continue;
      }
      // Disengagement is a claim about effort. Real work refutes it whether or
      // not the work was right — and treating a wrong but serious attempt as
      // continued disengagement is how a struggling learner gets written off.
      if (substantive && hypothesis.kind === "disengagement") {
        await contradictHypothesis(hypothesis.hypothesisId, event.evidenceId);
      }
    }
  }
}

/* ─────────────────────────────────────────────────────────────
   Policy-only onboarding entry signals
   ───────────────────────────────────────────────────────────── */

export async function upsertEntrySignal(params: {
  learnerId?: string;
  sessionId: string;
  skillId: string;
  familiarity: SelfReportedFamiliarity;
}): Promise<void> {
  const sessionId = params.sessionId.trim();
  if (!sessionId || !isSelfReportedFamiliarity(params.familiarity)) return;
  const db = await getDb();
  db.run(
    `INSERT OR REPLACE INTO learner_entry_signals (
      learner_id, session_id, skill_id, familiarity, created_at
    ) VALUES (?, ?, ?, ?, ?);`,
    [
      params.learnerId ?? DEFAULT_LEARNER_ID,
      sessionId,
      normalizeSkillId(params.skillId),
      params.familiarity,
      nowIso(),
    ]
  );
  saveDbSync();
}

export async function getEntrySignal(
  sessionId: string | undefined,
  skillId: string,
  learnerId = DEFAULT_LEARNER_ID
): Promise<SelfReportedFamiliarity | undefined> {
  if (!sessionId?.trim()) return undefined;
  const db = await getDb();
  const res = db.exec(
    `SELECT familiarity FROM learner_entry_signals
     WHERE learner_id = ? AND session_id = ? AND skill_id = ? LIMIT 1;`,
    [learnerId, sessionId.trim(), normalizeSkillId(skillId)]
  );
  const familiarity = res[0]?.values?.[0]?.[0];
  return isSelfReportedFamiliarity(familiarity) ? familiarity : undefined;
}

/* ─────────────────────────────────────────────────────────────
   Activity contracts
   ───────────────────────────────────────────────────────────── */

export async function recordActivityContract(
  contract: LearningActivityContract,
  sessionId?: string,
  learnerId = DEFAULT_LEARNER_ID
): Promise<void> {
  const db = await getDb();
  db.run(
    `INSERT OR REPLACE INTO learning_activities (
      activity_id, session_id, learner_id, target_skill_ids, stage, mode, route,
      task_family, context_variant, support_ceiling, expected_evidence,
      success_criteria, representation_roles, permitted_widget_kinds, created_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?);`,
    [
      contract.activityId,
      sessionId ?? null,
      learnerId,
      JSON.stringify(contract.targetSkillIds),
      contract.stage,
      contract.mode,
      contract.route ?? null,
      contract.taskFamily,
      contract.contextVariant,
      contract.supportCeiling,
      JSON.stringify(contract.expectedEvidence),
      JSON.stringify(contract.successCriteria),
      JSON.stringify(contract.representationRoles),
      contract.permittedWidgetKinds ? JSON.stringify(contract.permittedWidgetKinds) : null,
      contract.createdAt,
    ]
  );
  saveDbSync();
}

export async function getActivityContract(
  activityId: string
): Promise<LearningActivityContract | undefined> {
  const db = await getDb();
  const res = db.exec(
    `SELECT activity_id, target_skill_ids, stage, mode, route, task_family, context_variant,
      support_ceiling, expected_evidence, success_criteria, representation_roles,
      permitted_widget_kinds, created_at
     FROM learning_activities WHERE activity_id = ?;`,
    [activityId]
  );
  const row = res[0]?.values?.[0];
  if (!row) return undefined;
  return {
    activityId: String(row[0]),
    targetSkillIds: parseList(row[1]),
    stage: String(row[2]) as LearningActivityContract["stage"],
    mode: String(row[3]) as LearningActivityContract["mode"],
    route: (row[4] ? String(row[4]) : undefined) as LearningActivityContract["route"],
    taskFamily: String(row[5]),
    contextVariant: isContextVariant(row[6]) ? row[6] : "same",
    supportCeiling: coerceSupportLevel(row[7]),
    expectedEvidence: parseList(row[8]) as LearningActivityContract["expectedEvidence"],
    successCriteria: parseList(row[9]),
    representationRoles: (() => {
      try {
        const parsed = JSON.parse(String(row[10] ?? "[]"));
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    })(),
    permittedWidgetKinds: row[11]
      ? (parseList(row[11]) as LearningActivityContract["permittedWidgetKinds"])
      : undefined,
    createdAt: String(row[12]),
  };
}

/**
 * Bind a board block to the activity contract it was placed under.
 *
 * Called at placement, not at submission. The binding is what lets a widget
 * answered many turns later be filed against its own task family and context
 * variant instead of whichever contract happens to be newest at that moment.
 * Re-placing the same block id rebinds it, since the block has genuinely been
 * reissued under a new contract.
 */
export async function bindBlockToActivity(
  sessionId: string,
  blockId: string,
  activityId: string
): Promise<void> {
  const session = sessionId.trim();
  const block = blockId.trim();
  const activity = activityId.trim();
  if (!session || !block || !activity) return;
  const db = await getDb();
  db.run(
    `INSERT OR REPLACE INTO board_block_activities (session_id, block_id, activity_id, created_at)
     VALUES (?, ?, ?, ?);`,
    [session, block, activity, new Date().toISOString()]
  );
  saveDbSync();
}

/**
 * The contract a specific board block was placed under.
 *
 * Returns `undefined` for blocks placed before binding existed (or placed
 * outside a policy-governed turn); callers decide their own fallback rather
 * than being silently handed an unrelated contract.
 */
export async function getActivityForBlock(
  sessionId: string,
  blockId: string
): Promise<LearningActivityContract | undefined> {
  const session = sessionId.trim();
  const block = blockId.trim();
  if (!session || !block) return undefined;
  const db = await getDb();
  const res = db.exec(
    "SELECT activity_id FROM board_block_activities WHERE session_id = ? AND block_id = ? LIMIT 1;",
    [session, block]
  );
  const id = res[0]?.values?.[0]?.[0];
  return id ? getActivityContract(String(id)) : undefined;
}

/** The most recent contract placed in a session, for evidence attribution. */
export async function getLatestSessionActivity(
  sessionId: string
): Promise<LearningActivityContract | undefined> {
  const db = await getDb();
  const res = db.exec(
    "SELECT activity_id FROM learning_activities WHERE session_id = ? ORDER BY created_at DESC LIMIT 1;",
    [sessionId]
  );
  const id = res[0]?.values?.[0]?.[0];
  return id ? getActivityContract(String(id)) : undefined;
}

/** Whether this learner/session has already received direct instruction for a skill. */
export async function hasDirectInstructionActivity(
  learnerId: string,
  sessionId: string | undefined,
  skillId: string
): Promise<boolean> {
  if (!sessionId?.trim()) return false;
  const db = await getDb();
  const res = db.exec(
    `SELECT target_skill_ids FROM learning_activities
     WHERE learner_id = ? AND session_id = ? AND route = 'direct_instruction'
     ORDER BY created_at DESC;`,
    [learnerId, sessionId.trim()]
  );
  const normalized = normalizeSkillId(skillId);
  return (res[0]?.values ?? []).some((row) =>
    parseList(row[0]).some((target) => normalizeSkillId(target) === normalized)
  );
}

/* ─────────────────────────────────────────────────────────────
   Hypotheses
   ───────────────────────────────────────────────────────────── */

const HYPOTHESIS_COLUMNS = `hypothesis_id, learner_id, skill_id, kind, statement, status,
  supporting_evidence_ids, contradicting_evidence_ids, next_best_test,
  first_observed, last_observed, learner_disputed, dispute_note`;

function rowToHypothesis(row: any[]): LearnerHypothesis {
  return {
    hypothesisId: String(row[0]),
    learnerId: String(row[1]),
    skillId: String(row[2]),
    kind: isHypothesisKind(row[3]) ? row[3] : "misconception",
    statement: String(row[4]),
    status: String(row[5]) as LearnerHypothesis["status"],
    supportingEvidenceIds: parseList(row[6]),
    contradictingEvidenceIds: parseList(row[7]),
    nextBestTest: String(row[8]),
    firstObserved: String(row[9]),
    lastObserved: String(row[10]),
    learnerDisputed: Number(row[11]) === 1,
    disputeNote: row[12] ? String(row[12]) : undefined,
  };
}

/**
 * Record or reinforce a hypothesis about the learner.
 *
 * A hypothesis with no `nextBestTest` is rejected outright. This is the single
 * rule that keeps the learner model falsifiable: a claim you have not said how
 * to test is a label, and labels are what turn a learner model into a permanent
 * record of the worst day someone had.
 *
 * Repeat observations promote `suspected` to `supported` rather than creating a
 * second row, so the model sees one strengthening claim rather than five copies.
 */
export async function upsertHypothesis(params: {
  learnerId?: string;
  skillId: string;
  kind: LearnerHypothesis["kind"];
  statement: string;
  nextBestTest: string;
  evidenceIds?: string[];
}): Promise<LearnerHypothesis> {
  const statement = params.statement.trim().slice(0, 1000);
  const nextBestTest = params.nextBestTest.trim().slice(0, 600);
  if (!statement) throw new Error("A hypothesis must state a claim.");
  if (!nextBestTest) {
    throw new Error(
      "A hypothesis must carry the observation that would confirm or refute it. Untestable claims about a learner are not recorded."
    );
  }

  const db = await getDb();
  const learnerId = params.learnerId ?? DEFAULT_LEARNER_ID;
  const skillId = normalizeSkillId(params.skillId);
  const now = nowIso();

  const existing = db.exec(
    `SELECT ${HYPOTHESIS_COLUMNS} FROM learner_hypotheses
     WHERE learner_id = ? AND skill_id = ? AND kind = ? AND lower(statement) = lower(?)
       AND learner_disputed = 0 LIMIT 1;`,
    [learnerId, skillId, params.kind, statement]
  );
  const row = existing[0]?.values?.[0];

  if (row) {
    const prior = rowToHypothesis(row);
    const supporting = [...new Set([...prior.supportingEvidenceIds, ...(params.evidenceIds ?? [])])].slice(-20);
    // Two independent observations is the bar for promoting a suspicion to a
    // supported claim. One wrong answer is a data point, not a diagnosis.
    const status: LearnerHypothesis["status"] =
      prior.status === "resolved" ? "suspected" : supporting.length >= 2 ? "supported" : prior.status;

    db.run(
      `UPDATE learner_hypotheses SET supporting_evidence_ids = ?, status = ?, last_observed = ?, next_best_test = ?
       WHERE hypothesis_id = ?;`,
      [JSON.stringify(supporting), status, now, nextBestTest, prior.hypothesisId]
    );
    saveDbSync();
    return { ...prior, supportingEvidenceIds: supporting, status, lastObserved: now, nextBestTest };
  }

  const hypothesis: LearnerHypothesis = {
    hypothesisId: newId("hy"),
    learnerId,
    skillId,
    kind: params.kind,
    statement,
    status: "suspected",
    supportingEvidenceIds: (params.evidenceIds ?? []).slice(-20),
    contradictingEvidenceIds: [],
    nextBestTest,
    firstObserved: now,
    lastObserved: now,
    learnerDisputed: false,
  };

  db.run(
    `INSERT INTO learner_hypotheses (${HYPOTHESIS_COLUMNS}) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?);`,
    [
      hypothesis.hypothesisId,
      hypothesis.learnerId,
      hypothesis.skillId,
      hypothesis.kind,
      hypothesis.statement,
      hypothesis.status,
      JSON.stringify(hypothesis.supportingEvidenceIds),
      JSON.stringify(hypothesis.contradictingEvidenceIds),
      hypothesis.nextBestTest,
      hypothesis.firstObserved,
      hypothesis.lastObserved,
      0,
      null,
    ]
  );
  saveDbSync();
  return hypothesis;
}

export async function getHypotheses(
  learnerId = DEFAULT_LEARNER_ID,
  skillId?: string
): Promise<LearnerHypothesis[]> {
  const db = await getDb();
  const res = skillId
    ? db.exec(
        `SELECT ${HYPOTHESIS_COLUMNS} FROM learner_hypotheses
         WHERE learner_id = ? AND skill_id = ? ORDER BY last_observed DESC;`,
        [learnerId, normalizeSkillId(skillId)]
      )
    : db.exec(
        `SELECT ${HYPOTHESIS_COLUMNS} FROM learner_hypotheses
         WHERE learner_id = ? ORDER BY last_observed DESC;`,
        [learnerId]
      );
  return (res[0]?.values ?? []).map(rowToHypothesis);
}

/**
 * Record evidence that counts AGAINST a hypothesis.
 *
 * The path that lets the learner model shrink. A hypothesis contradicted twice
 * resolves — the learner has demonstrated it is no longer true, and continuing
 * to plan around it would mean teaching the learner they used to be.
 */
export async function contradictHypothesis(
  hypothesisId: string,
  evidenceId: string
): Promise<void> {
  const db = await getDb();
  const res = db.exec(`SELECT ${HYPOTHESIS_COLUMNS} FROM learner_hypotheses WHERE hypothesis_id = ?;`, [
    hypothesisId,
  ]);
  const row = res[0]?.values?.[0];
  if (!row) return;
  const prior = rowToHypothesis(row);
  const contradicting = [...new Set([...prior.contradictingEvidenceIds, evidenceId])].slice(-20);
  const status: LearnerHypothesis["status"] = contradicting.length >= 2 ? "resolved" : prior.status;

  db.run(
    "UPDATE learner_hypotheses SET contradicting_evidence_ids = ?, status = ?, last_observed = ? WHERE hypothesis_id = ?;",
    [JSON.stringify(contradicting), status, nowIso(), hypothesisId]
  );
  saveDbSync();
}

/** Learner-facing dispute. A disputed hypothesis never enters prompt context. */
export async function disputeHypothesis(hypothesisId: string, note: string): Promise<void> {
  const db = await getDb();
  db.run(
    "UPDATE learner_hypotheses SET learner_disputed = 1, status = 'disputed', dispute_note = ? WHERE hypothesis_id = ?;",
    [note.slice(0, 600), hypothesisId]
  );
  saveDbSync();
}

/* ─────────────────────────────────────────────────────────────
   Skill graph
   ───────────────────────────────────────────────────────────── */

export async function upsertSkillNode(node: SkillNode): Promise<void> {
  const db = await getDb();
  db.run(
    `INSERT OR REPLACE INTO skill_nodes (skill_id, label, prerequisites, curriculum_node, description)
     VALUES (?,?,?,?,?);`,
    [
      normalizeSkillId(node.skillId),
      node.label.slice(0, 200),
      JSON.stringify(node.prerequisites.map(normalizeSkillId)),
      node.curriculumNode ?? null,
      node.description?.slice(0, 600) ?? null,
    ]
  );
  saveDbSync();
}

export async function getSkillNodes(): Promise<SkillNode[]> {
  const db = await getDb();
  const res = db.exec(
    "SELECT skill_id, label, prerequisites, curriculum_node, description FROM skill_nodes;"
  );
  return (res[0]?.values ?? []).map((row) => ({
    skillId: String(row[0]),
    label: String(row[1]),
    prerequisites: parseList(row[2]),
    curriculumNode: row[3] ? String(row[3]) : undefined,
    description: row[4] ? String(row[4]) : undefined,
  }));
}

/* ─────────────────────────────────────────────────────────────
   Learning plans
   ───────────────────────────────────────────────────────────── */

import type { LearningPlan } from "./plan";

const ACTIVE_PLANS_KEY = "studyus_active_plans";

export function savePlan(plan: LearningPlan): void {
  const plans = getAllPlans();
  const index = plans.findIndex((p) => p.id === plan.id);
  if (index >= 0) {
    plans[index] = plan;
  } else {
    plans.push(plan);
  }
  localStorage.setItem(ACTIVE_PLANS_KEY, JSON.stringify(plans));
}

export function getPlan(planId: string): LearningPlan | undefined {
  return getAllPlans().find((p) => p.id === planId);
}

export function getAllPlans(): LearningPlan[] {
  const stored = localStorage.getItem(ACTIVE_PLANS_KEY);
  return stored ? JSON.parse(stored) : [];
}

export function getActivePlanForSkill(skillId: string): LearningPlan | undefined {
  return getAllPlans().find((p) => p.skillId === skillId && p.status === "active");
}

export function deletePlan(planId: string): void {
  const plans = getAllPlans().filter((p) => p.id !== planId);
  localStorage.setItem(ACTIVE_PLANS_KEY, JSON.stringify(plans));
}

/* ─────────────────────────────────────────────────────────────
   Prerequisite coverage
   ───────────────────────────────────────────────────────────── */

/**
 * Record that a prerequisite skill was covered by an agent-spawned review thread.
 * Uses ON CONFLICT to update the timestamp if the skill was already covered.
 */
export function recordPrerequisiteCovered(skillId: string, source = "thread"): void {
  const db = getDb();
  const now = new Date().toISOString();

  db.run(`
    INSERT INTO prerequisite_coverage (skill_id, covered_at, source)
    VALUES (?, ?, ?)
    ON CONFLICT(skill_id) DO UPDATE SET covered_at = excluded.covered_at, source = excluded.source;
  `, [normalizeSkillId(skillId), now, source]);

  saveDbSync();
}

export interface PrerequisiteCoverage {
  skillId: string;
  coveredAt: string;
  source: string;
}

/**
 * Get all prerequisite skills that have been covered by agent-spawned threads.
 */
export function getPrerequisiteCoverages(): PrerequisiteCoverage[] {
  const db = getDb();
  const res = db.exec("SELECT skill_id, covered_at, source FROM prerequisite_coverage ORDER BY covered_at DESC;");
  return (res[0]?.values ?? []).map((row) => ({
    skillId: String(row[0]),
    coveredAt: String(row[1]),
    source: String(row[2]),
  }));
}

/**
 * Check if a specific prerequisite skill has been covered.
 */
export function isPrerequisiteCovered(skillId: string): boolean {
  const db = getDb();
  const res = db.exec("SELECT 1 FROM prerequisite_coverage WHERE skill_id = ? LIMIT 1;", [normalizeSkillId(skillId)]);
  return (res[0]?.values?.length ?? 0) > 0;
}

export function wasPrerequisiteRecentlyCovered(skillId: string, withinDays = 7): boolean {
  const coverage = getPrerequisiteCoverages().find((c) => c.skillId === normalizeSkillId(skillId));
  if (!coverage) return false;

  const coveredDate = new Date(coverage.coveredAt);
  const daysSince = (Date.now() - coveredDate.getTime()) / (1000 * 60 * 60 * 24);
  return daysSince <= withinDays;
}
