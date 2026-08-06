/**
 * Assessment Store — Persistence Layer
 *
 * Manages forms, attempts, and analytics using localStorage.
 * Provides CRUD operations and reactive subscriptions.
 *
 * All state transitions go through the state machine in stateMachine.ts.
 * The store never allows invalid transitions.
 */

import type {
  AssessmentAttempt,
  AssessmentForm,
  AssessmentItem,
  AttemptParams,
  AttemptResponse,
  AttemptStatus,
  CriterionMastery,
  SubjectKey,
} from "./types";
import { canTransitionAttempt, isExpired } from "./stateMachine";
import { gradeAttempt } from "./grader";

// ─── Storage Keys ────────────────────────────────────────────────────────────

const FORMS_KEY = "studyus_assessment_forms";
const ATTEMPTS_KEY = "studyus_assessment_attempts";
const MASTERY_KEY = "studyus_criterion_mastery";
const DRAFT_KEY = "studyus_attempt_draft_";

// ─── Form Persistence ────────────────────────────────────────────────────────

export function saveForm(form: AssessmentForm): void {
  const forms = loadForms();
  const idx = forms.findIndex((f) => f.id === form.id);
  if (idx >= 0) forms[idx] = form;
  else forms.push(form);
  localStorage.setItem(FORMS_KEY, JSON.stringify(forms));
}

export function loadForms(): AssessmentForm[] {
  try {
    return JSON.parse(localStorage.getItem(FORMS_KEY) ?? "[]");
  } catch {
    return [];
  }
}

export function loadForm(id: string): AssessmentForm | undefined {
  return loadForms().find((f) => f.id === id);
}

// ─── Attempt Persistence ─────────────────────────────────────────────────────

export function saveAttempt(attempt: AssessmentAttempt): void {
  const attempts = loadAttempts();
  const idx = attempts.findIndex((a) => a.id === attempt.id);
  if (idx >= 0) attempts[idx] = attempt;
  else attempts.push(attempt);
  localStorage.setItem(ATTEMPTS_KEY, JSON.stringify(attempts));
}

export function loadAttempts(): AssessmentAttempt[] {
  try {
    return JSON.parse(localStorage.getItem(ATTEMPTS_KEY) ?? "[]");
  } catch {
    return [];
  }
}

export function loadAttempt(id: string): AssessmentAttempt | undefined {
  return loadAttempts().find((a) => a.id === id);
}

export function getAttemptsForSubject(subject: SubjectKey): AssessmentAttempt[] {
  return loadAttempts().filter((a) => {
    const form = loadForm(a.formId);
    return form?.subject === subject;
  });
}

export function getActiveAttempts(): AssessmentAttempt[] {
  return loadAttempts().filter(
    (a) => a.status === "active" || a.status === "created"
  );
}

export function getCompletedAttempts(): AssessmentAttempt[] {
  return loadAttempts().filter((a) => a.status === "completed");
}

// ─── Draft Autosave ──────────────────────────────────────────────────────────

export function saveDraft(attemptId: string, responses: Record<string, AttemptResponse>): void {
  localStorage.setItem(DRAFT_KEY + attemptId, JSON.stringify(responses));
}

export function loadDraft(attemptId: string): Record<string, AttemptResponse> | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY + attemptId);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function clearDraft(attemptId: string): void {
  localStorage.removeItem(DRAFT_KEY + attemptId);
}

// ─── Attempt Lifecycle ───────────────────────────────────────────────────────

/**
 * Create a new attempt for a form.
 */
export function createAttempt(
  form: AssessmentForm,
  params: AttemptParams,
  assistancePolicy: "closed_book" | "socratic" | "progressive" = "progressive",
): AssessmentAttempt {
  // Initialize responses for all items
  const responses: Record<string, AttemptResponse> = {};
  const itemOrder: string[] = [];

  for (const item of form.items) {
    itemOrder.push(item.id);
    responses[item.id] = {
      id: `resp-${item.id}-${Date.now()}`,
      attemptId: "", // set below
      itemId: item.id,
      status: "unseen",
      flagged: false,
      hintsConsumed: 0,
      attemptCount: 0,
    };
  }

  const attempt: AssessmentAttempt = {
    id: `att-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    formId: form.id,
    status: "created",
    startedAt: Date.now(),
    deadlineAt: form.timeLimitMinutes
      ? Date.now() + form.timeLimitMinutes * 60 * 1000
      : undefined,
    responses,
    itemOrder,
    currentIndex: 0,
    assistancePolicy,
    params,
  };

  // Fix attemptId in responses
  for (const resp of Object.values(responses)) {
    resp.attemptId = attempt.id;
  }

  // Transition to active
  attempt.status = "active";

  saveAttempt(attempt);
  return attempt;
}

/**
 * Transition an attempt's status. Validates the transition.
 */
export function transitionAttemptStatus(
  attemptId: string,
  newStatus: AttemptStatus,
): AssessmentAttempt {
  const attempt = loadAttempt(attemptId);
  if (!attempt) throw new Error(`Attempt ${attemptId} not found`);

  if (!canTransitionAttempt(attempt.status, newStatus)) {
    throw new Error(`Invalid transition: ${attempt.status} → ${newStatus}`);
  }

  attempt.status = newStatus;
  if (newStatus === "completed" || newStatus === "expired") {
    attempt.submittedAt = Date.now();
  }

  saveAttempt(attempt);
  return attempt;
}

/**
 * Submit an attempt: transition through submission_review → grading → completed.
 */
export function submitAttemptForGrading(attemptId: string): AssessmentAttempt {
  const attempt = loadAttempt(attemptId);
  if (!attempt) throw new Error(`Attempt ${attemptId} not found`);

  const form = loadForm(attempt.formId);
  if (!form) throw new Error(`Form ${attempt.formId} not found`);

  // Check if already completed
  if (attempt.status === "completed") return attempt;
  if (attempt.status === "expired") return attempt;

  // Check deadline
  if (isExpired(attempt.deadlineAt)) {
    attempt.status = "expired";
    attempt.submittedAt = Date.now();
    saveAttempt(attempt);
    return attempt;
  }

  // Commit all draft responses
  for (const resp of Object.values(attempt.responses)) {
    if (resp.status === "draft" || resp.status === "presented") {
      resp.status = "committed";
      resp.committedAt = Date.now();
    }
  }

  // Transition: active → submission_review
  attempt.status = "submission_review";
  saveAttempt(attempt);

  // Grade immediately (deterministic, no async needed for MCQ/rubric)
  attempt.status = "grading";
  saveAttempt(attempt);

  try {
    const { totalScore, totalMax } = gradeAttempt(form.items, attempt.responses);
    attempt.totalScore = totalScore;
    attempt.totalMax = totalMax;
    attempt.status = "completed";
  } catch (err) {
    attempt.status = "grading_blocked";
    console.error("Grading failed:", err);
  }

  attempt.submittedAt = Date.now();
  saveAttempt(attempt);

  // Update mastery analytics
  updateMastery(attempt, form.items);

  // Clear draft
  clearDraft(attemptId);

  return attempt;
}

/**
 * Retry grading for a blocked attempt.
 */
export function retryGrading(attemptId: string): AssessmentAttempt {
  const attempt = loadAttempt(attemptId);
  if (!attempt) throw new Error(`Attempt ${attemptId} not found`);
  if (attempt.status !== "grading_blocked") {
    throw new Error(`Attempt is not in grading_blocked state: ${attempt.status}`);
  }

  const form = loadForm(attempt.formId);
  if (!form) throw new Error(`Form ${attempt.formId} not found`);

  attempt.status = "grading";
  saveAttempt(attempt);

  try {
    const { totalScore, totalMax } = gradeAttempt(form.items, attempt.responses);
    attempt.totalScore = totalScore;
    attempt.totalMax = totalMax;
    attempt.status = "completed";
  } catch {
    attempt.status = "grading_blocked";
  }

  saveAttempt(attempt);
  return attempt;
}

// ─── Response Updates ────────────────────────────────────────────────────────

/**
 * Save a response (MCQ selection or text answer).
 */
export function saveResponse(
  attemptId: string,
  itemId: string,
  update: Partial<AttemptResponse>,
): AssessmentAttempt {
  const attempt = loadAttempt(attemptId);
  if (!attempt) throw new Error(`Attempt ${attemptId} not found`);
  if (attempt.status !== "active") {
    throw new Error(`Cannot save response: attempt is ${attempt.status}`);
  }

  const response = attempt.responses[itemId];
  if (!response) throw new Error(`No response for item ${itemId}`);

  Object.assign(response, update);

  // Auto-transition status
  if (update.responseText !== undefined || update.mcqSelection !== undefined) {
    if (response.status === "unseen" || response.status === "presented") {
      response.status = "draft";
    }
  }

  saveAttempt(attempt);
  return attempt;
}

/**
 * Commit a response (final answer for grading).
 */
export function commitResponse(attemptId: string, itemId: string): AssessmentAttempt {
  const attempt = loadAttempt(attemptId);
  if (!attempt) throw new Error(`Attempt ${attemptId} not found`);

  const response = attempt.responses[itemId];
  if (!response) throw new Error(`No response for item ${itemId}`);

  if (response.status === "draft" || response.status === "presented") {
    response.status = "committed";
    response.committedAt = Date.now();
  }

  saveAttempt(attempt);
  return attempt;
}

/**
 * Mark/unmark a response as flagged for review.
 */
export function flagResponse(attemptId: string, itemId: string, flagged: boolean): AssessmentAttempt {
  const attempt = loadAttempt(attemptId);
  if (!attempt) throw new Error(`Attempt ${attemptId} not found`);

  const response = attempt.responses[itemId];
  if (!response) throw new Error(`No response for item ${itemId}`);

  response.flagged = flagged;
  saveAttempt(attempt);
  return attempt;
}

/**
 * Mark a response as seen.
 */
export function markSeen(attemptId: string, itemId: string): AssessmentAttempt {
  const attempt = loadAttempt(attemptId);
  if (!attempt) throw new Error(`Attempt ${attemptId} not found`);

  const response = attempt.responses[itemId];
  if (!response) throw new Error(`No response for item ${itemId}`);

  if (response.status === "unseen") {
    response.status = "presented";
    response.firstSeenAt = Date.now();
  }

  saveAttempt(attempt);
  return attempt;
}

// ─── Criterion Mastery Analytics ─────────────────────────────────────────────

export function loadMastery(): CriterionMastery[] {
  try {
    return JSON.parse(localStorage.getItem(MASTERY_KEY) ?? "[]");
  } catch {
    return [];
  }
}

function updateMastery(attempt: AssessmentAttempt, items: AssessmentItem[]): void {
  const mastery = loadMastery();
  const masteryMap = new Map<string, CriterionMastery>();
  for (const m of mastery) {
    masteryMap.set(`${m.nodeId}:${m.criterionId}`, m);
  }

  for (const item of items) {
    const response = attempt.responses[item.id];
    if (!response || response.status !== "graded") continue;

    if (response.criterionScores) {
      // Rubric-based: update per criterion
      for (const cs of response.criterionScores) {
        const key = `${item.nodeId}:${cs.criterionId}`;
        const existing = masteryMap.get(key) ?? {
          nodeId: item.nodeId,
          criterionId: cs.criterionId,
          attempts: 0,
          correct: 0,
          assisted: 0,
          lastAttemptAt: 0,
          masteryPct: 0,
        };
        existing.attempts++;
        if (cs.awarded >= cs.maxMarks * 0.7) existing.correct++;
        if (response.hintsConsumed > 0) existing.assisted++;
        existing.lastAttemptAt = Date.now();
        existing.masteryPct = Math.round((existing.correct / existing.attempts) * 100);
        masteryMap.set(key, existing);
      }
    } else {
      // MCQ: single criterion
      const key = `${item.nodeId}:mcq`;
      const existing = masteryMap.get(key) ?? {
        nodeId: item.nodeId,
        criterionId: "mcq",
        attempts: 0,
        correct: 0,
        assisted: 0,
        lastAttemptAt: 0,
        masteryPct: 0,
      };
      existing.attempts++;
      if (response.isCorrect) existing.correct++;
      if (response.hintsConsumed > 0) existing.assisted++;
      existing.lastAttemptAt = Date.now();
      existing.masteryPct = Math.round((existing.correct / existing.attempts) * 100);
      masteryMap.set(key, existing);
    }
  }

  localStorage.setItem(MASTERY_KEY, JSON.stringify(Array.from(masteryMap.values())));
}

// ─── Aggregate Stats ─────────────────────────────────────────────────────────

export interface AggregateStats {
  totalAttempts: number;
  completedAttempts: number;
  averageScore: number;
  bySubject: Record<SubjectKey, { attempts: number; avgScore: number }>;
}

export function computeAggregateStats(): AggregateStats {
  const attempts = loadAttempts();
  const completed = attempts.filter((a) => a.status === "completed" && a.totalScore != null);
  const avgScore = completed.length > 0
    ? Math.round(completed.reduce((s, a) => s + ((a.totalScore ?? 0) / (a.totalMax ?? 1)) * 100, 0) / completed.length)
    : 0;

  const bySubject: Record<string, { attempts: number; totalPct: number }> = {};
  for (const a of completed) {
    const form = loadForm(a.formId);
    const subject = form?.subject ?? "math";
    if (!bySubject[subject]) bySubject[subject] = { attempts: 0, totalPct: 0 };
    bySubject[subject].attempts++;
    bySubject[subject].totalPct += ((a.totalScore ?? 0) / (a.totalMax ?? 1)) * 100;
  }

  const bySubjectResult: Record<string, { attempts: number; avgScore: number }> = {};
  for (const [subj, data] of Object.entries(bySubject)) {
    bySubjectResult[subj] = {
      attempts: data.attempts,
      avgScore: Math.round(data.totalPct / data.attempts),
    };
  }

  return {
    totalAttempts: attempts.length,
    completedAttempts: completed.length,
    averageScore: avgScore,
    bySubject: bySubjectResult as Record<SubjectKey, { attempts: number; avgScore: number }>,
  };
}
