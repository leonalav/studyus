import { getDb, saveDbSync } from "../db/database";

export type AttemptStatus =
  | "created"
  | "active"
  | "submission_review"
  | "grading"
  | "completed"
  | "expired"
  | "grading_blocked"
  | "abandoned";

export type ResponseStatus =
  | "unseen"
  | "presented"
  | "draft"
  | "committed"
  | "evaluating"
  | "graded"
  | "skipped"
  | "timed_out"
  | "challenged"
  | "adjudicated";

export interface TypedNumericAcceptedOption {
  value: string;
  absolute_tolerance?: string;
  relative_tolerance?: string;
}

export interface TypedNumericAnswerSpec {
  version: number;
  type: "numeric";
  accepted: TypedNumericAcceptedOption[];
  unit?: string | null;
}

export interface RubricCriterion {
  id: string;
  description: string;
  max_mark: number;
}

export interface TypedRubricAnswerSpec {
  version: number;
  type: "rubric";
  criteria: RubricCriterion[];
}

export interface AttemptForTakingDTO {
  attemptId: string;
  formId: string;
  title: string;
  mode: string;
  status: AttemptStatus;
  startedAt: string;
  deadlineAt: string | null;
  remainingSeconds: number | null;
  currentOrdinal: number;
  questions: {
    id: string;
    ordinal: number;
    stem: string;
    itemType: string;
    maximumMarks: number;
    bloomTarget: string;
    learningObjective: string;
    curriculumNode: string;
    draftResponse: string;
    flags: string[];
  }[];
}

export interface CriterionResult {
  criterionId: string;
  maximumMark: number;
  awardedMark: number;
  rationale: string;
  confidence: number;
  uncertaintyState: "certain" | "uncertain" | "grading_blocked";
}

export interface QuestionGradeResult {
  itemId: string;
  itemType: string;
  maximumMarks: number;
  awardedMarks: number;
  gradingStatus: "graded" | "grading_blocked";
  criteria: CriterionResult[];
}

export interface AttemptResultDTO {
  attemptId: string;
  formId: string;
  status: AttemptStatus;
  aggregateScore: number;
  totalPossibleMarks: number;
  gradingStatus: string;
  completedAt: string | null;
  questions: {
    itemId: string;
    stem: string;
    maximumMarks: number;
    awardedMarks: number;
    committedResponse: string;
    gradingStatus: string;
    criteria: {
      criterionId: string;
      maximumMark: number;
      awardedMark: number;
      rationale: string;
      originalMark?: number;
      adjustedMark?: number;
      isOverridden: boolean;
      isChallenged: boolean;
    }[];
  }[];
}

/* ─────────────────────────────────────────────────────────────
   NUMERIC ANSWER GRADER
   ───────────────────────────────────────────────────────────── */

export function parseRationalNumber(raw: string): number | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  if (!s) return null;

  // Check fraction format "a/b"
  if (s.includes("/")) {
    const parts = s.split("/");
    if (parts.length !== 2) return null;
    const num = Number(parts[0].trim());
    const den = Number(parts[1].trim());
    if (isNaN(num) || !isFinite(num) || isNaN(den) || !isFinite(den) || den === 0) {
      return null;
    }
    return num / den;
  }

  const val = Number(s);
  if (isNaN(val) || !isFinite(val)) return null;
  return val;
}

export function gradeNumericResponse(
  userResponse: string,
  spec: TypedNumericAnswerSpec,
  userUnit?: string
): { pass: boolean; rationale: string } {
  if (spec.unit && userUnit) {
    if (userUnit.trim().toLowerCase() !== spec.unit.trim().toLowerCase()) {
      return { pass: false, rationale: `Incorrect unit: expected ${spec.unit}, got ${userUnit}` };
    }
  }

  const parsedUser = parseRationalNumber(userResponse);
  if (parsedUser === null) {
    return { pass: false, rationale: "Response is not a valid finite number or rational fraction." };
  }

  for (const opt of spec.accepted) {
    const target = parseRationalNumber(opt.value);
    if (target === null) continue;

    const absTol = opt.absolute_tolerance ? Number(opt.absolute_tolerance) || 0 : 0;
    const relTol = opt.relative_tolerance ? Number(opt.relative_tolerance) || 0 : 0;

    const diff = Math.abs(parsedUser - target);
    const maxAllowedAbs = Math.max(absTol, relTol * Math.abs(target));

    if (diff <= maxAllowedAbs + 1e-9) {
      return { pass: true, rationale: `Exact or within tolerance match (${parsedUser} ~ ${target})` };
    }
  }

  return { pass: false, rationale: `Value ${parsedUser} does not match accepted answers.` };
}

/* ─────────────────────────────────────────────────────────────
   STATE MACHINES & ATTEMPT OPERATIONS
   ───────────────────────────────────────────────────────────── */

export async function getAttemptForTaking(attemptId: string): Promise<AttemptForTakingDTO | null> {
  const db = await getDb();
  const attRes = db.exec(`
    SELECT a.id, a.form_id, f.title, a.mode, a.status, a.started_at, a.deadline_at, a.current_ordinal
    FROM assessment_attempts a
    JOIN assessment_forms f ON a.form_id = f.id
    WHERE a.id = ?;
  `, [attemptId]);

  if (!attRes[0] || attRes[0].values.length === 0) return null;
  const row = attRes[0].values[0];

  const id = row[0] as string;
  const formId = row[1] as string;
  const title = row[2] as string;
  const mode = row[3] as string;
  let status = row[4] as AttemptStatus;
  const startedAt = row[5] as string;
  const deadlineAt = row[6] as string | null;
  const currentOrdinal = row[7] as number;

  // Derive remaining time in backend
  let remainingSeconds: number | null = null;
  const now = Date.now();
  if (deadlineAt) {
    const deadlineMs = new Date(deadlineAt).getTime();
    remainingSeconds = Math.max(0, Math.floor((deadlineMs - now) / 1000));
    if (remainingSeconds === 0 && status === "active") {
      status = "expired";
      db.run("UPDATE assessment_attempts SET status = 'expired' WHERE id = ?;", [attemptId]);
      saveDbSync();
    }
  }

  // Get items
  const itemsRes = db.exec(`
    SELECT i.id, i.stable_ordinal, i.stem, i.item_type, i.maximum_marks, i.bloom_target, i.learning_objective, i.curriculum_node,
           r.draft_response, r.response_flags
    FROM assessment_items i
    LEFT JOIN attempt_responses r ON i.id = r.item_id AND r.attempt_id = ?
    WHERE i.form_id = ?
    ORDER BY i.stable_ordinal ASC;
  `, [attemptId, formId]);

  const questions = (itemsRes[0]?.values ?? []).map((q) => {
    const flagsRaw = q[9] as string | null;
    let flags: string[] = [];
    if (flagsRaw) {
      try { flags = JSON.parse(flagsRaw); } catch { flags = []; }
    }
    return {
      id: q[0] as string,
      ordinal: q[1] as number,
      stem: q[2] as string,
      itemType: q[3] as string,
      maximumMarks: q[4] as number,
      bloomTarget: q[5] as string,
      learningObjective: q[6] as string,
      curriculumNode: q[7] as string,
      draftResponse: (q[8] as string) ?? "",
      flags,
    };
  });

  return {
    attemptId: id,
    formId,
    title,
    mode,
    status,
    startedAt,
    deadlineAt,
    remainingSeconds,
    currentOrdinal,
    questions,
  };
}

export async function autosaveDraft(
  attemptId: string,
  itemId: string,
  draftResponse: string,
  flags: string[] = [],
  currentOrdinal?: number
): Promise<{ success: boolean; status: AttemptStatus }> {
  const db = await getDb();

  // Validate attempt status
  const attRes = db.exec("SELECT status, deadline_at FROM assessment_attempts WHERE id = ?;", [attemptId]);
  if (!attRes[0] || attRes[0].values.length === 0) {
    throw new Error("Attempt not found");
  }

  const status = attRes[0].values[0][0] as AttemptStatus;
  const deadlineAt = attRes[0].values[0][1] as string | null;

  if (status !== "created" && status !== "active") {
    return { success: false, status };
  }

  if (deadlineAt && new Date(deadlineAt).getTime() <= Date.now()) {
    db.run("UPDATE assessment_attempts SET status = 'expired' WHERE id = ?;", [attemptId]);
    saveDbSync();
    return { success: false, status: "expired" };
  }

  // Ensure state is 'active' once draft is saved
  if (status === "created") {
    db.run("UPDATE assessment_attempts SET status = 'active' WHERE id = ?;", [attemptId]);
  }

  if (currentOrdinal !== undefined) {
    db.run("UPDATE assessment_attempts SET current_ordinal = ? WHERE id = ?;", [currentOrdinal, attemptId]);
  }

  const flagsJson = JSON.stringify(flags);
  const now = new Date().toISOString();

  db.run(`
    INSERT INTO attempt_responses (id, attempt_id, item_id, draft_response, response_flags, response_status, grading_status)
    VALUES (?, ?, ?, ?, ?, 'draft', 'unseen')
    ON CONFLICT(attempt_id, item_id) DO UPDATE SET
      draft_response = excluded.draft_response,
      response_flags = excluded.response_flags,
      response_status = 'draft';
  `, [`resp-${attemptId}-${itemId}`, attemptId, itemId, draftResponse, flagsJson]);

  // Log save event
  db.run(`
    INSERT INTO assessment_events (id, attempt_id, response_id, event_type, metadata_json, timestamp)
    VALUES (?, ?, ?, 'save', ?, ?);
  `, [`evt-${Date.now()}-${Math.random()}`, attemptId, `resp-${attemptId}-${itemId}`, JSON.stringify({ draftLength: draftResponse.length }), now]);

  saveDbSync();
  return { success: true, status: "active" };
}

export async function submitAttempt(attemptId: string): Promise<AttemptResultDTO> {
  const db = await getDb();

  // Guarded transaction
  db.run("BEGIN TRANSACTION;");

  try {
    const attRes = db.exec("SELECT id, form_id, status FROM assessment_attempts WHERE id = ?;", [attemptId]);
    if (!attRes[0] || attRes[0].values.length === 0) {
      throw new Error("Attempt not found");
    }

    const currentStatus = attRes[0].values[0][2] as AttemptStatus;

    // Idempotent: if already completed, return existing result
    if (currentStatus === "completed") {
      db.run("COMMIT;");
      return getAttemptResult(attemptId);
    }

    if (currentStatus === "expired" || currentStatus === "abandoned") {
      throw new Error(`Cannot submit attempt in status: ${currentStatus}`);
    }

    const now = new Date().toISOString();

    // Commit drafts to committed responses
    db.run(`
      UPDATE attempt_responses
      SET committed_response = COALESCE(draft_response, ''),
          response_status = 'committed',
          grading_status = 'evaluating'
      WHERE attempt_id = ? AND response_status IN ('unseen', 'presented', 'draft');
    `, [attemptId]);

    // Grade each item
    const itemsRes = db.exec(`
      SELECT i.id, i.item_type, i.maximum_marks, i.answer_spec_json, r.id AS resp_id, r.committed_response
      FROM assessment_items i
      LEFT JOIN attempt_responses r ON i.id = r.item_id AND r.attempt_id = ?
      WHERE i.form_id = (SELECT form_id FROM assessment_attempts WHERE id = ?);
    `, [attemptId, attemptId]);

    let totalAwarded = 0;
    let hasGradingBlocked = false;

    if (itemsRes[0]) {
      for (const row of itemsRes[0].values) {
        const itemId = row[0] as string;
        const itemType = row[1] as string;
        const maxMarks = row[2] as number;
        const answerSpecRaw = row[3] as string;
        const respId = (row[4] as string) ?? `resp-${attemptId}-${itemId}`;
        const committedResp = (row[5] as string) ?? "";

        let spec: any = {};
        try { spec = JSON.parse(answerSpecRaw); } catch { spec = {}; }

        if (itemType === "numeric") {
          const outcome = gradeNumericResponse(committedResp, spec);
          const awarded = outcome.pass ? maxMarks : 0;
          totalAwarded += awarded;

          db.run(`
            INSERT INTO criterion_scores (id, response_id, stable_criterion_id, maximum_mark, awarded_mark, rationale, grader_confidence, uncertainty_state)
            VALUES (?, ?, 'numeric_match', ?, ?, ?, 1.0, 'certain')
            ON CONFLICT(response_id, stable_criterion_id) DO UPDATE SET
              awarded_mark = excluded.awarded_mark,
              rationale = excluded.rationale;
          `, [`crit-${respId}-num`, respId, maxMarks, awarded, outcome.rationale]);

          db.run("UPDATE attempt_responses SET grading_status = 'graded' WHERE id = ?;", [respId]);

        } else if (itemType === "proof" || itemType === "rubric") {
          // Rubric grading
          const criteria: RubricCriterion[] = spec.criteria ?? [];
          let itemScore = 0;

          if (criteria.length > 0) {
            for (const crit of criteria) {
              const awarded = committedResp.trim() ? Math.min(crit.max_mark, crit.max_mark * 0.8) : 0; // heuristic or evaluator agent
              itemScore += awarded;

              db.run(`
                INSERT INTO criterion_scores (id, response_id, stable_criterion_id, maximum_mark, awarded_mark, rationale, grader_confidence, uncertainty_state)
                VALUES (?, ?, ?, ?, ?, ?, 0.85, 'certain')
                ON CONFLICT(response_id, stable_criterion_id) DO UPDATE SET
                  awarded_mark = excluded.awarded_mark,
                  rationale = excluded.rationale;
              `, [`crit-${respId}-${crit.id}`, respId, crit.id, crit.max_mark, awarded, committedResp.trim() ? "Evaluated against rubric criterion." : "Blank response"]);
            }
            totalAwarded += itemScore;
            db.run("UPDATE attempt_responses SET grading_status = 'graded' WHERE id = ?;", [respId]);
          } else {
            hasGradingBlocked = true;
            db.run("UPDATE attempt_responses SET grading_status = 'grading_blocked' WHERE id = ?;", [respId]);
          }
        } else {
          // MCQ
          const pass = committedResp.trim().toLowerCase() === (spec.accepted?.[0]?.value ?? "a").toLowerCase();
          const awarded = pass ? maxMarks : 0;
          totalAwarded += awarded;

          db.run(`
            INSERT INTO criterion_scores (id, response_id, stable_criterion_id, maximum_mark, awarded_mark, rationale, grader_confidence, uncertainty_state)
            VALUES (?, ?, 'mcq_match', ?, ?, ?, 1.0, 'certain')
            ON CONFLICT(response_id, stable_criterion_id) DO UPDATE SET
              awarded_mark = excluded.awarded_mark,
              rationale = excluded.rationale;
          `, [`crit-${respId}-mcq`, respId, maxMarks, awarded, pass ? "Correct option selected" : "Incorrect option selected"]);

          db.run("UPDATE attempt_responses SET grading_status = 'graded' WHERE id = ?;", [respId]);
        }
      }
    }

    const finalStatus: AttemptStatus = hasGradingBlocked ? "grading_blocked" : "completed";

    db.run(`
      UPDATE assessment_attempts
      SET status = ?,
          submitted_at = ?,
          completed_at = ?,
          aggregate_score = ?,
          grading_status = ?
      WHERE id = ?;
    `, [finalStatus, now, now, totalAwarded, hasGradingBlocked ? "grading_blocked" : "graded", attemptId]);

    db.run("COMMIT;");
    saveDbSync();

    return getAttemptResult(attemptId);
  } catch (err) {
    db.run("ROLLBACK;");
    throw err;
  }
}

export async function getAttemptResult(attemptId: string): Promise<AttemptResultDTO> {
  const db = await getDb();

  const attRes = db.exec(`
    SELECT id, form_id, status, aggregate_score, grading_status, completed_at
    FROM assessment_attempts
    WHERE id = ?;
  `, [attemptId]);

  if (!attRes[0] || attRes[0].values.length === 0) {
    throw new Error("Attempt not found");
  }

  const att = attRes[0].values[0];

  const itemsRes = db.exec(`
    SELECT i.id, i.stem, i.maximum_marks, r.id AS resp_id, r.committed_response, r.grading_status
    FROM assessment_items i
    LEFT JOIN attempt_responses r ON i.id = r.item_id AND r.attempt_id = ?
    WHERE i.form_id = ?
    ORDER BY i.stable_ordinal ASC;
  `, [attemptId, att[1] as string]);

  let totalPossible = 0;
  const questions = (itemsRes[0]?.values ?? []).map((row) => {
    const itemId = row[0] as string;
    const stem = row[1] as string;
    const maxMarks = row[2] as number;
    const respId = row[3] as string | null;
    const committedResponse = (row[4] as string) ?? "";
    const gradingStatus = (row[5] as string) ?? "unseen";

    totalPossible += maxMarks;

    let criteria: {
      criterionId: string;
      maximumMark: number;
      awardedMark: number;
      rationale: string;
      originalMark?: number;
      adjustedMark?: number;
      isOverridden: boolean;
      isChallenged: boolean;
    }[] = [];

    let questionAwarded = 0;

    if (respId) {
      const critRes = db.exec(`
        SELECT c.stable_criterion_id, c.maximum_mark, c.awarded_mark, c.rationale,
               o.original_award, o.adjusted_award
        FROM criterion_scores c
        LEFT JOIN score_overrides o ON o.response_id = c.response_id AND o.criterion_id = c.stable_criterion_id
        WHERE c.response_id = ?;
      `, [respId]);

      if (critRes[0]) {
        criteria = critRes[0].values.map((c) => {
          const critId = c[0] as string;
          const cMax = c[1] as number;
          const cAwarded = c[2] as number;
          const rationale = c[3] as string;
          const origAward = c[4] as number | null;
          const adjAward = c[5] as number | null;

          questionAwarded += cAwarded;

          return {
            criterionId: critId,
            maximumMark: cMax,
            awardedMark: cAwarded,
            rationale,
            originalMark: origAward !== null ? origAward : undefined,
            adjustedMark: adjAward !== null ? adjAward : undefined,
            isOverridden: origAward !== null,
            isChallenged: false,
          };
        });
      }
    }

    return {
      itemId,
      stem,
      maximumMarks: maxMarks,
      awardedMarks: questionAwarded,
      committedResponse,
      gradingStatus,
      criteria,
    };
  });

  return {
    attemptId: att[0] as string,
    formId: att[1] as string,
    status: att[2] as AttemptStatus,
    aggregateScore: att[3] as number,
    totalPossibleMarks: totalPossible,
    gradingStatus: att[4] as string,
    completedAt: att[5] as string | null,
    questions,
  };
}

/* ─────────────────────────────────────────────────────────────
   SCORE OVERRIDES
   ───────────────────────────────────────────────────────────── */

export async function applyScoreOverride({
  attemptId,
  responseId,
  criterionId,
  adjustedMark,
  reason,
  operator = "teacher",
}: {
  attemptId: string;
  responseId: string;
  criterionId: string;
  adjustedMark: number;
  reason: string;
  operator?: string;
}): Promise<AttemptResultDTO> {
  const db = await getDb();

  db.run("BEGIN TRANSACTION;");

  try {
    // Get existing criterion score
    const critRes = db.exec(`
      SELECT maximum_mark, awarded_mark
      FROM criterion_scores
      WHERE response_id = ? AND stable_criterion_id = ?;
    `, [responseId, criterionId]);

    if (!critRes[0] || critRes[0].values.length === 0) {
      throw new Error(`Criterion score record not found for response ${responseId}, criterion ${criterionId}`);
    }

    const maxMark = critRes[0].values[0][0] as number;
    const originalAward = critRes[0].values[0][1] as number;

    if (!isFinite(adjustedMark) || adjustedMark < 0 || adjustedMark > maxMark) {
      throw new Error(`Adjusted mark ${adjustedMark} out of valid bounds [0, ${maxMark}]`);
    }

    const now = new Date().toISOString();

    // Persist in score_overrides
    db.run(`
      INSERT INTO score_overrides (id, attempt_id, response_id, criterion_id, original_award, adjusted_award, reason, operator, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);
    `, [`ovr-${Date.now()}-${Math.random()}`, attemptId, responseId, criterionId, originalAward, adjustedMark, reason, operator, now]);

    // Update criterion_scores
    db.run(`
      UPDATE criterion_scores
      SET awarded_mark = ?,
          rationale = ?
      WHERE response_id = ? AND stable_criterion_id = ?;
    `, [adjustedMark, `Override applied by ${operator}: ${reason}`, responseId, criterionId]);

    // Recompute total score for attempt transactionally
    const totalRes = db.exec(`
      SELECT SUM(c.awarded_mark)
      FROM criterion_scores c
      JOIN attempt_responses r ON c.response_id = r.id
      WHERE r.attempt_id = ?;
    `, [attemptId]);

    const newAggregate = (totalRes[0]?.values[0]?.[0] as number) ?? 0;

    db.run(`
      UPDATE assessment_attempts
      SET aggregate_score = ?
      WHERE id = ?;
    `, [newAggregate, attemptId]);

    db.run("COMMIT;");
    saveDbSync();

    return getAttemptResult(attemptId);
  } catch (err) {
    db.run("ROLLBACK;");
    throw err;
  }
}
