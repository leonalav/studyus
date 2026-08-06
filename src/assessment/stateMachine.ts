/**
 * State machine logic for attempt and response transitions.
 *
 * All transitions are validated deterministically — no LLM or UI code
 * decides what state an attempt or response can be in.
 */

import {
  type AttemptStatus,
  type ResponseStatus,
  VALID_ATTEMPT_TRANSITIONS,
} from "./types";

// ─── Attempt transitions ─────────────────────────────────────────────────────

export function canTransitionAttempt(from: AttemptStatus, to: AttemptStatus): boolean {
  return VALID_ATTEMPT_TRANSITIONS[from]?.includes(to) ?? false;
}

/**
 * Advance an attempt to a new status. Throws if the transition is invalid.
 */
export function transitionAttempt(current: AttemptStatus, next: AttemptStatus): AttemptStatus {
  if (!canTransitionAttempt(current, next)) {
    throw new Error(`Invalid attempt transition: ${current} → ${next}`);
  }
  return next;
}

/**
 * Submit an attempt. Idempotent — submitting an already-completed attempt
 * returns the same status without side effects.
 */
export function submitAttempt(current: AttemptStatus): AttemptStatus {
  if (current === "completed" || current === "expired" || current === "abandoned") {
    return current; // idempotent
  }
  if (current === "active") return "submission_review";
  if (current === "submission_review") return "submission_review"; // already there
  throw new Error(`Cannot submit attempt in state: ${current}`);
}

// ─── Response transitions ────────────────────────────────────────────────────

const VALID_RESPONSE_TRANSITIONS: Record<ResponseStatus, ResponseStatus[]> = {
  unseen: ["presented"],
  presented: ["draft", "committed", "skipped", "timed_out"],
  draft: ["committed", "skipped", "timed_out", "draft"], // re-saving draft stays in draft
  committed: ["evaluating"],
  evaluating: ["graded", "grading_blocked"],
  graded: [],
  skipped: [],
  timed_out: [],
  grading_blocked: [],
};

export function canTransitionResponse(from: ResponseStatus, to: ResponseStatus): boolean {
  return VALID_RESPONSE_TRANSITIONS[from]?.includes(to) ?? false;
}

export function transitionResponse(current: ResponseStatus, next: ResponseStatus): ResponseStatus {
  if (!canTransitionResponse(current, next)) {
    throw new Error(`Invalid response transition: ${current} → ${next}`);
  }
  return next;
}

// ─── Deadline enforcement ────────────────────────────────────────────────────

/**
 * Returns remaining seconds. Negative means expired.
 * Returns null if there's no deadline.
 */
export function remainingSeconds(deadlineAt?: number, now?: number): number | null {
  if (deadlineAt == null) return null;
  const t = now ?? Date.now();
  return Math.ceil((deadlineAt - t) / 1000);
}

export function isExpired(deadlineAt?: number, now?: number): boolean {
  const r = remainingSeconds(deadlineAt, now);
  return r !== null && r <= 0;
}
