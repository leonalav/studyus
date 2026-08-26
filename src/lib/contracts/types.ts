/**
 * Learner-owned Turn Contract domain.
 *
 * Commitments are learner-owned choices: scope, representation, notation, pace,
 * example domain, goals. They are binding once approved, but they never touch
 * engine-owned authority (support level, hint depth, evidence sufficiency,
 * mastery values, stage exit, advancement).
 */

export type Commitment =
  | { kind: "scope_include"; concept: string }
  | { kind: "scope_exclude"; concept: string }
  | { kind: "representation"; prefer: string; avoid?: string }
  | { kind: "pace"; sessionsPerWeek?: number; minutesPerSession?: number }
  | { kind: "notation"; rule: string }
  | { kind: "example_domain"; domain: string }
  | { kind: "goal"; statement: string; deadline?: string };

export const COMMITMENT_KINDS: readonly Commitment["kind"][] = [
  "scope_include",
  "scope_exclude",
  "representation",
  "pace",
  "notation",
  "example_domain",
  "goal",
] as const;

export const TURN_CONTRACT_SCHEMA_VERSION = 1;

export interface ContractRevisionId {
  contractId: string;
  /** Monotonically increasing revision number within this contract lineage. */
  revision: number;
}

export interface TurnContract extends ContractRevisionId {
  learnerId: string;
  sessionId?: string;
  activityId?: string;
  /** Where the revision came from, e.g. "onboarding" or "learner_edit". */
  source?: string;
  schemaVersion: number;
  commitments: Commitment[];
  createdAt: string;
  active: boolean;
  revokedAt?: string;
  revokedReason?: string;
}
