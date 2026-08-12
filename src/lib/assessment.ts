import { getDb, saveDbSync } from "../db/database";
import { AgentRuntimeError } from "./agentRuntime";
import {
  evaluateRubricResponse,
  isBlankResponse,
  blankEvaluation,
  type EvaluatedCriterion,
} from "./evaluator";

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
  assistancePolicy: string;
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
    /** Learner-facing MCQ options — never includes the answer key. */
    options?: { id: string; text: string }[];
    /** Numeric items carry an optional unit for the response box. */
    unit?: string | null;
    /** Open-response items carry a one-line response requirement. */
    responseRequirement?: string | null;
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
   MULTIPLE CHOICE GRADER
   ───────────────────────────────────────────────────────────── */

export interface TypedMcqAnswerSpec {
  version: number;
  type: "mcq";
  options?: { id: string; text: string }[];
  accepted?: { value: string }[];
  distractor_misconceptions?: { option_id: string; misconception: string }[];
}

/**
 * Grades a selected option against the item's answer key.
 *
 * An item with no answer key is unmarkable — it is reported as blocked rather
 * than compared against a guessed default, which would award or deny marks on
 * the basis of nothing.
 */
export function gradeMcqResponse(
  userResponse: string,
  spec: TypedMcqAnswerSpec
): { pass: boolean; rationale: string; blocked: boolean } {
  const accepted = (spec.accepted ?? [])
    .map((a) => String(a?.value ?? "").trim().toLowerCase())
    .filter(Boolean);

  if (accepted.length === 0) {
    return {
      pass: false,
      rationale: "This item has no recorded answer key, so it cannot be marked automatically.",
      blocked: true,
    };
  }

  const selected = userResponse.trim().toLowerCase();
  if (!selected) {
    return { pass: false, rationale: "No option selected — recorded as blank, not as incorrect.", blocked: false };
  }

  if (accepted.includes(selected)) {
    return { pass: true, rationale: "Correct option selected.", blocked: false };
  }

  const missed = (spec.distractor_misconceptions ?? []).find(
    (d) => String(d?.option_id ?? "").trim().toLowerCase() === selected
  );

  return {
    pass: false,
    rationale: missed?.misconception
      ? `Incorrect option — ${missed.misconception}`
      : "Incorrect option selected.",
    blocked: false,
  };
}

/* ─────────────────────────────────────────────────────────────
   ASYNC PRE-GRADING (runs before the write transaction)
   ───────────────────────────────────────────────────────────── */

interface PendingRubricGrade {
  responseId: string;
  criteria: EvaluatedCriterion[];
  blocked: boolean;
  /** Set when the evaluator could not be reached at all. */
  unavailableReason?: string;
}

/**
 * Grades every rubric-scored response for an attempt by calling the evaluator
 * agent. This must happen before `BEGIN TRANSACTION`, because the sql.js
 * grading loop is synchronous and cannot await.
 *
 * An unreachable or failing evaluator yields `grading_blocked` for that item —
 * never a fabricated score.
 */
async function preGradeRubricResponses(
  rows: {
    itemId: string;
    stem: string;
    itemType: string;
    maximumMarks: number;
    learningObjective: string;
    spec: any;
    responseId: string;
    committedResponse: string;
  }[]
): Promise<Map<string, PendingRubricGrade>> {
  const graded = new Map<string, PendingRubricGrade>();

  for (const row of rows) {
    const criteria: RubricCriterion[] = Array.isArray(row.spec?.criteria) ? row.spec.criteria : [];
    if (criteria.length === 0) continue;

    if (isBlankResponse(row.committedResponse)) {
      graded.set(row.responseId, {
        responseId: row.responseId,
        criteria: blankEvaluation(criteria),
        blocked: false,
      });
      continue;
    }

    try {
      const evaluation = await evaluateRubricResponse({
        stem: row.stem,
        itemType: row.itemType,
        maximumMarks: row.maximumMarks,
        criteria,
        response: row.committedResponse,
        referenceSolution: row.spec?.reference_solution ?? null,
        learningObjective: row.learningObjective,
      });
      graded.set(row.responseId, {
        responseId: row.responseId,
        criteria: evaluation.criteria,
        blocked: evaluation.blocked,
      });
    } catch (err) {
      const reason =
        err instanceof AgentRuntimeError
          ? err.message
          : `Evaluator agent failed: ${err instanceof Error ? err.message : String(err)}`;
      graded.set(row.responseId, {
        responseId: row.responseId,
        criteria: criteria.map((c) => ({
          criterionId: c.id,
          maximumMark: c.max_mark,
          awardedMark: 0,
          rationale: reason,
          confidence: 0,
          uncertaintyState: "grading_blocked" as const,
        })),
        blocked: true,
        unavailableReason: reason,
      });
    }
  }

  return graded;
}

/* ─────────────────────────────────────────────────────────────
   STATE MACHINES & ATTEMPT OPERATIONS
   ───────────────────────────────────────────────────────────── */

export async function getAttemptForTaking(attemptId: string): Promise<AttemptForTakingDTO | null> {
  const db = await getDb();
  const attRes = db.exec(`
    SELECT a.id, a.form_id, f.title, a.mode, a.assistance_policy, a.status, a.started_at, a.deadline_at, a.current_ordinal
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
  const assistancePolicy = row[4] as string;
  let status = row[5] as AttemptStatus;
  const startedAt = row[6] as string;
  const deadlineAt = row[7] as string | null;
  const currentOrdinal = row[8] as number;

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
           r.draft_response, r.response_flags, i.answer_spec_json
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

    let spec: any = {};
    try { spec = JSON.parse(q[10] as string); } catch { spec = {}; }

    const itemType = q[3] as string;

    return {
      id: q[0] as string,
      ordinal: q[1] as number,
      stem: q[2] as string,
      itemType,
      maximumMarks: q[4] as number,
      bloomTarget: q[5] as string,
      learningObjective: q[6] as string,
      curriculumNode: q[7] as string,
      draftResponse: (q[8] as string) ?? "",
      flags,
      options:
        itemType === "mcq" && Array.isArray(spec?.options)
          ? spec.options
              .map((o: any) => ({ id: String(o?.id ?? ""), text: String(o?.text ?? "") }))
              .filter((o: { id: string; text: string }) => o.id && o.text)
          : undefined,
      unit: itemType === "numeric" ? (typeof spec?.unit === "string" ? spec.unit : null) : null,
      responseRequirement:
        itemType === "proof" || itemType === "rubric"
          ? typeof spec?.response_requirement === "string" && spec.response_requirement.trim()
            ? spec.response_requirement.trim()
            : null
          : null,
    };
  });

  return {
    attemptId: id,
    formId,
    title,
    mode,
    assistancePolicy,
    status,
    startedAt,
    deadlineAt,
    remainingSeconds,
    currentOrdinal,
    questions,
  };
}

/**
 * Mark an available attempt as explicitly started by the learner.
 *
 * Generation deliberately leaves attempts in `created`. Keeping this transition
 * separate from loading means inspecting an available test can never turn its
 * Start button into Resume. The audit event also repairs the ambiguity of older
 * generated attempts that were persisted as active before they were opened.
 */
export async function beginAttempt(attemptId: string): Promise<{ status: "active"; startedNow: boolean }> {
  const db = await getDb();
  const attempt = db.exec(`
    SELECT status, deadline_at,
           (SELECT COUNT(*) FROM attempt_responses r WHERE r.attempt_id = a.id),
           (SELECT COUNT(*) FROM assessment_events e WHERE e.attempt_id = a.id AND e.event_type = 'attempt_started')
    FROM assessment_attempts a
    WHERE a.id = ?;
  `, [attemptId]);
  if (!attempt[0] || attempt[0].values.length === 0) {
    throw new Error("Attempt not found");
  }

  const [status, deadlineAt, responseCount, startEventCount] = attempt[0].values[0] as [
    AttemptStatus,
    string | null,
    number,
    number,
  ];
  if (status !== "created" && status !== "active") {
    throw new Error(`Cannot start an attempt in status: ${status}`);
  }
  if (deadlineAt && new Date(deadlineAt).getTime() <= Date.now()) {
    db.run("UPDATE assessment_attempts SET status = 'expired' WHERE id = ?;", [attemptId]);
    saveDbSync();
    throw new Error("This attempt has expired");
  }

  const now = new Date().toISOString();
  const startedNow = status === "created" || (responseCount === 0 && startEventCount === 0);
  db.run("BEGIN TRANSACTION;");
  try {
    db.run(
      `UPDATE assessment_attempts
       SET status = 'active',
           started_at = CASE WHEN ? = 1 THEN ? ELSE started_at END,
           audit_updated_at = ?
       WHERE id = ?;`,
      [startedNow ? 1 : 0, now, now, attemptId]
    );
    if (startEventCount === 0) {
      db.run(
        `INSERT INTO assessment_events (id, attempt_id, response_id, event_type, metadata_json, timestamp)
         VALUES (?, ?, NULL, 'attempt_started', ?, ?);`,
        [`evt-start-${attemptId}-${Date.now()}`, attemptId, JSON.stringify({ explicit: true }), now]
      );
    }
    db.run("COMMIT;");
  } catch (error) {
    db.run("ROLLBACK;");
    throw error;
  }
  saveDbSync();
  return { status: "active", startedNow };
}

/** Create a clean attempt for the same immutable generated form. */
export async function createRetakeAttempt(attemptId: string): Promise<string> {
  const db = await getDb();
  const source = db.exec(`
    SELECT form_id, learner_id, mode, assistance_policy
    FROM assessment_attempts
    WHERE id = ?;
  `, [attemptId]);
  if (!source[0] || source[0].values.length === 0) {
    throw new Error("Attempt not found");
  }

  const [formId, learnerId, mode, assistancePolicy] = source[0].values[0] as [string, string, string, string];
  const now = new Date().toISOString();
  const retakeId = `attempt-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  db.run(`
    INSERT INTO assessment_attempts (
      id, form_id, learner_id, status, mode, assistance_policy, started_at,
      deadline_at, submitted_at, completed_at, current_ordinal,
      aggregate_score, grading_status, audit_created_at, audit_updated_at
    ) VALUES (?, ?, ?, 'created', ?, ?, ?, NULL, NULL, NULL, 1, 0, 'unseen', ?, ?);
  `, [retakeId, formId, learnerId, mode, assistancePolicy, now, now, now]);
  saveDbSync();
  return retakeId;
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

  // A draft is also an unambiguous start signal for callers that bypass the
  // Available tests button. This transition is idempotent and logs one event.
  await beginAttempt(attemptId);

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

  const preRes = db.exec("SELECT id, form_id, status FROM assessment_attempts WHERE id = ?;", [attemptId]);
  if (!preRes[0] || preRes[0].values.length === 0) {
    throw new Error("Attempt not found");
  }

  const preStatus = preRes[0].values[0][2] as AttemptStatus;

  // Idempotent: if already completed, return the existing result untouched.
  if (preStatus === "completed") {
    return getAttemptResult(attemptId);
  }
  if (preStatus === "expired" || preStatus === "abandoned") {
    throw new Error(`Cannot submit attempt in status: ${preStatus}`);
  }

  // Read what will be graded. The response the learner sees committed is the
  // draft, so grade against the same text the transaction is about to commit.
  const planRes = db.exec(`
    SELECT i.id, i.item_type, i.maximum_marks, i.answer_spec_json, i.stem, i.learning_objective,
           r.id AS resp_id, COALESCE(r.committed_response, r.draft_response, '') AS response_text
    FROM assessment_items i
    LEFT JOIN attempt_responses r ON i.id = r.item_id AND r.attempt_id = ?
    WHERE i.form_id = (SELECT form_id FROM assessment_attempts WHERE id = ?)
    ORDER BY i.stable_ordinal ASC;
  `, [attemptId, attemptId]);

  interface PlanRow {
    itemId: string;
    itemType: string;
    maximumMarks: number;
    spec: any;
    stem: string;
    learningObjective: string;
    responseId: string;
    committedResponse: string;
  }

  const plan: PlanRow[] = (planRes[0]?.values ?? []).map((row) => {
    let spec: any = {};
    try { spec = JSON.parse(row[3] as string); } catch { spec = {}; }
    return {
      itemId: row[0] as string,
      itemType: row[1] as string,
      maximumMarks: row[2] as number,
      spec,
      stem: (row[4] as string) ?? "",
      learningObjective: (row[5] as string) ?? "",
      responseId: (row[6] as string) ?? `resp-${attemptId}-${row[0] as string}`,
      committedResponse: (row[7] as string) ?? "",
    };
  });

  // Rubric grading needs the network, so it happens before the transaction —
  // sql.js statements are synchronous and cannot await inside BEGIN/COMMIT.
  const rubricRows = plan.filter(
    (p) => (p.itemType === "proof" || p.itemType === "rubric") && Array.isArray(p.spec?.criteria) && p.spec.criteria.length > 0
  );
  const rubricGrades = await preGradeRubricResponses(rubricRows);

  db.run("BEGIN TRANSACTION;");

  try {
    const now = new Date().toISOString();

    // Commit drafts to committed responses
    db.run(`
      UPDATE attempt_responses
      SET committed_response = COALESCE(draft_response, ''),
          response_status = 'committed',
          grading_status = 'evaluating'
      WHERE attempt_id = ? AND response_status IN ('unseen', 'presented', 'draft');
    `, [attemptId]);

    let totalAwarded = 0;
    let hasGradingBlocked = false;

    const writeCriterion = (
      id: string,
      respId: string,
      criterionId: string,
      maxMark: number,
      awarded: number,
      rationale: string,
      confidence: number,
      uncertaintyState: "certain" | "uncertain" | "grading_blocked"
    ) => {
      db.run(`
        INSERT INTO criterion_scores (id, response_id, stable_criterion_id, maximum_mark, awarded_mark, rationale, grader_confidence, uncertainty_state)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(response_id, stable_criterion_id) DO UPDATE SET
          maximum_mark = excluded.maximum_mark,
          awarded_mark = excluded.awarded_mark,
          rationale = excluded.rationale,
          grader_confidence = excluded.grader_confidence,
          uncertainty_state = excluded.uncertainty_state;
      `, [id, respId, criterionId, maxMark, awarded, rationale, confidence, uncertaintyState]);
    };

    for (const row of plan) {
      const { itemId, itemType, maximumMarks: maxMarks, spec, responseId: respId, committedResponse: committedResp } = row;

      // criterion_scores.response_id is a foreign key, and an item the learner
      // never opened has no response row yet. Materialise a blank one so the
      // unattempted item is recorded as blank rather than dropped from the mark.
      db.run(`
        INSERT INTO attempt_responses (id, attempt_id, item_id, draft_response, committed_response, response_status, grading_status)
        VALUES (?, ?, ?, '', '', 'committed', 'evaluating')
        ON CONFLICT(attempt_id, item_id) DO NOTHING;
      `, [respId, attemptId, itemId]);

      if (itemType === "numeric") {
        const outcome = gradeNumericResponse(committedResp, spec);
        const blank = isBlankResponse(committedResp);
        const awarded = outcome.pass ? maxMarks : 0;
        totalAwarded += awarded;

        writeCriterion(
          `crit-${respId}-num`,
          respId,
          "numeric_match",
          maxMarks,
          awarded,
          blank ? "No response submitted — recorded as blank, not as an incorrect answer." : outcome.rationale,
          1.0,
          "certain"
        );
        db.run("UPDATE attempt_responses SET grading_status = 'graded' WHERE id = ?;", [respId]);

      } else if (itemType === "proof" || itemType === "rubric") {
        const criteria: RubricCriterion[] = Array.isArray(spec?.criteria) ? spec.criteria : [];

        if (criteria.length === 0) {
          hasGradingBlocked = true;
          db.run("UPDATE attempt_responses SET grading_status = 'grading_blocked' WHERE id = ?;", [respId]);
          continue;
        }

        const grade = rubricGrades.get(respId);
        if (!grade) {
          hasGradingBlocked = true;
          db.run("UPDATE attempt_responses SET grading_status = 'grading_blocked' WHERE id = ?;", [respId]);
          continue;
        }

        let itemScore = 0;
        for (const c of grade.criteria) {
          itemScore += c.awardedMark;
          writeCriterion(
            `crit-${respId}-${c.criterionId}`,
            respId,
            c.criterionId,
            c.maximumMark,
            c.awardedMark,
            c.rationale,
            c.confidence,
            c.uncertaintyState
          );
        }

        if (grade.blocked) {
          hasGradingBlocked = true;
          db.run("UPDATE attempt_responses SET grading_status = 'grading_blocked' WHERE id = ?;", [respId]);
        } else {
          totalAwarded += itemScore;
          db.run("UPDATE attempt_responses SET grading_status = 'graded' WHERE id = ?;", [respId]);
        }

      } else if (itemType === "mcq") {
        const outcome = gradeMcqResponse(committedResp, spec);

        if (outcome.blocked) {
          hasGradingBlocked = true;
          writeCriterion(`crit-${respId}-mcq`, respId, "mcq_match", maxMarks, 0, outcome.rationale, 0, "grading_blocked");
          db.run("UPDATE attempt_responses SET grading_status = 'grading_blocked' WHERE id = ?;", [respId]);
        } else {
          const awarded = outcome.pass ? maxMarks : 0;
          totalAwarded += awarded;
          writeCriterion(`crit-${respId}-mcq`, respId, "mcq_match", maxMarks, awarded, outcome.rationale, 1.0, "certain");
          db.run("UPDATE attempt_responses SET grading_status = 'graded' WHERE id = ?;", [respId]);
        }

      } else {
        // Unknown item type: refuse to guess a grading strategy.
        hasGradingBlocked = true;
        writeCriterion(
          `crit-${respId}-unknown`,
          respId,
          "unsupported_item_type",
          maxMarks,
          0,
          `Item type "${itemType}" has no grading strategy, so this response was not marked.`,
          0,
          "grading_blocked"
        );
        db.run("UPDATE attempt_responses SET grading_status = 'grading_blocked' WHERE id = ?;", [respId]);
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
