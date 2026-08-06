/**
 * Persistence (§16) — the Store trait lives in core; implementations are
 * thin. Every write is transactional: save() either commits the whole state
 * or throws, and Session treats a throw as "no reveal" (§8 invariant 2).
 *
 * Exactly two metrics exist (§16.2): first_question_answered and
 * returned_within_24h. Nothing else is instrumented, and nothing leaves
 * the device — there is no telemetry path in this codebase at all.
 */

import type { Attempt, Beat, ScaffoldLevel, Timestamp } from "./types";
import type { BktState } from "./bkt";

export const EVENT_FIRST_QUESTION = "first_question_answered";
export const EVENT_RETURNED_24H = "returned_within_24h";

export interface StoredAttempt extends Attempt {
  correct: boolean;
}

export interface ReviewState {
  intervalIdx: number;
  dueAt: Timestamp;
}

export interface PersistedState {
  version: 1;
  firstUseAt?: Timestamp;
  events: { name: string; at: Timestamp }[];
  attempts: StoredAttempt[];
  /** BKT per skill × beat (§13.1) */
  bkt: Record<string, Partial<Record<Beat, BktState>>>;
  /** fading levels per skill × beat (§13.4) */
  scaffolds: Record<string, Partial<Record<Beat, ScaffoldLevel>>>;
  fails: Record<string, Partial<Record<Beat, number>>>;
  /** never-repeat bookkeeping: template_id → param hashes (§10.3) */
  seen: Record<string, number[]>;
  /** Law 7 gate: a Write pass at ScaffoldLevel 'none' */
  writePassedAtNone: Record<string, boolean>;
  masteredAt: Record<string, Timestamp>;
  reviews: Record<string, ReviewState>;
  tier3ReadAt: Record<string, Timestamp>;
  lastSeen: Record<string, Timestamp>;
  /** first Predict→Explain pair completed — one-line mention point (§15.2) */
  pairAnnounced: boolean;
}

export function emptyState(): PersistedState {
  return {
    version: 1,
    events: [],
    attempts: [],
    bkt: {},
    scaffolds: {},
    fails: {},
    seen: {},
    writePassedAtNone: {},
    masteredAt: {},
    reviews: {},
    tier3ReadAt: {},
    lastSeen: {},
    pairAnnounced: false,
  };
}

/** the core-facing trait; faked in tests with MemoryStore */
export interface Store {
  load(): PersistedState;
  /** commit the whole state or throw — transactional */
  save(state: PersistedState): void;
}

export class MemoryStore implements Store {
  private state: PersistedState;

  constructor(initial?: PersistedState) {
    this.state = initial ?? emptyState();
  }

  load(): PersistedState {
    return this.state;
  }

  save(state: PersistedState): void {
    this.state = state;
  }
}


