import type { ValidationResult } from "../agentRuntime";
import {
  type Commitment,
  type TurnContract,
  COMMITMENT_KINDS,
  TURN_CONTRACT_SCHEMA_VERSION,
} from "./types";

const ENGINE_OWNED_PATTERNS: readonly RegExp[] = [
  /\bsupport[_\s-]?level\b/i,
  /\bhint[_\s-]?depth\b/i,
  /\bhint[_\s-]?ceiling\b/i,
  /\bprogressive[_\s-]?hint\b/i,
  /\bmastery\b/i,
  /\bmastery[_\s-]?stage\b/i,
  /\bmastery[_\s-]?score\b/i,
  /\bcorrectness\b/i,
  /\bscore\b/i,
  /\bgrading\b/i,
  /\brubric\b/i,
  /\bevidence[_\s-]?sufficiency\b/i,
  /\bevidence[_\s-]?threshold\b/i,
  /\bstage[_\s-]?exit\b/i,
  /\bstage[_\s-]?advance\b/i,
  /\badvancement\b/i,
  /\bgate[_\s-]?check\b/i,
  /\brouting[_\s-]?override\b/i,
  /\bpolicy[_\s-]?override\b/i,
  /\bengine[_\s-]?override\b/i,
];

function findEngineOwnedField(text: string): string | null {
  for (const pattern of ENGINE_OWNED_PATTERNS) {
    const match = pattern.exec(text)?.[0] ?? null;
    if (match) return match;
  }
  return null;
}

function validateScopeInclude(
  raw: Record<string, unknown>,
  path: string,
  errors: string[]
): Commitment | null {
  const concept = typeof raw.concept === "string" ? raw.concept.trim() : "";
  if (!concept) {
    errors.push(`${path}.concept must be a non-empty string`);
    return null;
  }
  return { kind: "scope_include", concept };
}

function validateScopeExclude(
  raw: Record<string, unknown>,
  path: string,
  errors: string[]
): Commitment | null {
  const concept = typeof raw.concept === "string" ? raw.concept.trim() : "";
  if (!concept) {
    errors.push(`${path}.concept must be a non-empty string`);
    return null;
  }
  return { kind: "scope_exclude", concept };
}

function validateRepresentation(
  raw: Record<string, unknown>,
  path: string,
  errors: string[]
): Commitment | null {
  const prefer = typeof raw.prefer === "string" ? raw.prefer.trim() : "";
  if (!prefer) {
    errors.push(`${path}.prefer must be a non-empty string`);
    return null;
  }
  const avoid = typeof raw.avoid === "string" && raw.avoid.trim() ? raw.avoid.trim() : undefined;
  const commitment: Commitment = { kind: "representation", prefer };
  if (avoid) commitment.avoid = avoid;
  return commitment;
}

function validatePace(
  raw: Record<string, unknown>,
  path: string,
  errors: string[]
): Commitment | null {
  const sessionsPerWeek =
    raw.sessionsPerWeek !== undefined && raw.sessionsPerWeek !== null
      ? Number(raw.sessionsPerWeek)
      : undefined;
  const minutesPerSession =
    raw.minutesPerSession !== undefined && raw.minutesPerSession !== null
      ? Number(raw.minutesPerSession)
      : undefined;

  if (sessionsPerWeek !== undefined && (!Number.isFinite(sessionsPerWeek) || sessionsPerWeek < 0)) {
    errors.push(`${path}.sessionsPerWeek must be a non-negative finite number`);
    return null;
  }
  if (minutesPerSession !== undefined && (!Number.isFinite(minutesPerSession) || minutesPerSession < 0)) {
    errors.push(`${path}.minutesPerSession must be a non-negative finite number`);
    return null;
  }
  if (sessionsPerWeek === undefined && minutesPerSession === undefined) {
    errors.push(`${path} pace commitment must have at least one of sessionsPerWeek or minutesPerSession`);
    return null;
  }

  const commitment: Commitment = { kind: "pace" };
  if (sessionsPerWeek !== undefined) commitment.sessionsPerWeek = Math.round(sessionsPerWeek);
  if (minutesPerSession !== undefined) commitment.minutesPerSession = Math.round(minutesPerSession);
  return commitment;
}

function validateNotation(
  raw: Record<string, unknown>,
  path: string,
  errors: string[]
): Commitment | null {
  const rule = typeof raw.rule === "string" ? raw.rule.trim() : "";
  if (!rule) {
    errors.push(`${path}.rule must be a non-empty string`);
    return null;
  }
  return { kind: "notation", rule };
}

function validateExampleDomain(
  raw: Record<string, unknown>,
  path: string,
  errors: string[]
): Commitment | null {
  const domain = typeof raw.domain === "string" ? raw.domain.trim() : "";
  if (!domain) {
    errors.push(`${path}.domain must be a non-empty string`);
    return null;
  }
  return { kind: "example_domain", domain };
}

function validateGoal(
  raw: Record<string, unknown>,
  path: string,
  errors: string[]
): Commitment | null {
  const statement = typeof raw.statement === "string" ? raw.statement.trim() : "";
  if (!statement) {
    errors.push(`${path}.statement must be a non-empty string`);
    return null;
  }
  const deadline =
    typeof raw.deadline === "string" && raw.deadline.trim() ? raw.deadline.trim() : undefined;
  const commitment: Commitment = { kind: "goal", statement };
  if (deadline) commitment.deadline = deadline;
  return commitment;
}

function validateOneCommitment(
  raw: unknown,
  index: number,
  errors: string[]
): Commitment | null {
  const path = `commitments[${index}]`;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    errors.push(`${path} must be an object`);
    return null;
  }

  const obj = raw as Record<string, unknown>;
  const kind = typeof obj.kind === "string" ? obj.kind.trim() : "";
  if (!COMMITMENT_KINDS.includes(kind as Commitment["kind"])) {
    errors.push(`${path}.kind must be one of: ${COMMITMENT_KINDS.join(", ")}`);
    return null;
  }

  // Validate kind-specific fields first.
  let commitment: Commitment | null = null;
  switch (kind) {
    case "scope_include":
      commitment = validateScopeInclude(obj, path, errors);
      break;
    case "scope_exclude":
      commitment = validateScopeExclude(obj, path, errors);
      break;
    case "representation":
      commitment = validateRepresentation(obj, path, errors);
      break;
    case "pace":
      commitment = validatePace(obj, path, errors);
      break;
    case "notation":
      commitment = validateNotation(obj, path, errors);
      break;
    case "example_domain":
      commitment = validateExampleDomain(obj, path, errors);
      break;
    case "goal":
      commitment = validateGoal(obj, path, errors);
      break;
  }

  if (commitment) {
    // Reject engine-owned field language in validated string fields.
    const textFields = Object.entries(commitment).filter(
      ([k, v]) => k !== "kind" && typeof v === "string",
    ) as Array<[string, string]>;
    for (const [key, val] of textFields) {
      const matched = findEngineOwnedField(val);
      if (matched) {
        errors.push(`${path}.${key} contains engine-owned field "${matched}" and is rejected`);
        return null;
      }
    }
  }

  return commitment;
}

function normalizeConcept(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

function commitmentKey(c: Commitment): string {
  switch (c.kind) {
    case "scope_include":
    case "scope_exclude":
      return `${c.kind}:${normalizeConcept(c.concept)}`;
    case "representation":
      return `${c.kind}:${normalizeConcept(c.prefer)}${c.avoid ? `:${normalizeConcept(c.avoid)}` : ""}`;
    case "pace":
      return `${c.kind}:${c.sessionsPerWeek ?? ""}:${c.minutesPerSession ?? ""}`;
    case "notation":
      return `${c.kind}:${normalizeConcept(c.rule)}`;
    case "example_domain":
      return `${c.kind}:${normalizeConcept(c.domain)}`;
    case "goal":
      return `${c.kind}:${normalizeConcept(c.statement)}${c.deadline ? `:${c.deadline}` : ""}`;
  }
}

// Stable first-seen deduplication.
export function normalizeCommitments(commitments: Commitment[]): Commitment[] {
  const seen = new Set<string>();
  const result: Commitment[] = [];
  for (const c of commitments) {
    const key = commitmentKey(c);
    if (!seen.has(key)) {
      seen.add(key);
      result.push(c);
    }
  }
  return result;
}

/** Validate a raw commitments array element-by-element, dropping invalid
 *  commitments and collecting their errors, returning the deduplicated valid
 *  survivors.
 *
 *  This is the lenient counterpart to `validateTurnContract`'s strict
 *  all-or-nothing loop. A stored active contract must be fully sound (one bad
 *  commitment invalidates the whole revision), but a model *proposal* may
 *  contain one malformed commitment alongside good ones — the model proposes,
 *  deterministic code disposes of the bad and keeps the good. The caller
 *  decides from `errors` whether the survivors are enough: empty survivors
 *  with errors means the model overstepped (a real failure), not "no
 *  preferences". */
export function validateCommitmentList(
  raw: unknown[]
): { commitments: Commitment[]; errors: string[] } {
  const errors: string[] = [];
  const valid: Commitment[] = [];
  for (let i = 0; i < raw.length; i++) {
    const commitment = validateOneCommitment(raw[i], i, errors);
    if (commitment) valid.push(commitment);
  }
  return { commitments: normalizeCommitments(valid), errors };
}

export function validateTurnContract(raw: unknown): ValidationResult<TurnContract> {
  const errors: string[] = [];

  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, errors: ["TurnContract must be an object"] };
  }

  const obj = raw as Record<string, unknown>;

  const contractId =
    typeof obj.contractId === "string" && obj.contractId.trim()
      ? obj.contractId.trim()
      : "";
  if (!contractId) errors.push("contractId must be a non-empty string");

  const revision = typeof obj.revision === "number" && Number.isFinite(obj.revision) && obj.revision >= 1
    ? Math.floor(obj.revision)
    : 0;
  if (revision < 1) errors.push("revision must be a positive integer");

  const learnerId =
    typeof obj.learnerId === "string" && obj.learnerId.trim()
      ? obj.learnerId.trim()
      : "";
  if (!learnerId) errors.push("learnerId must be a non-empty string");

  const schemaVersion =
    typeof obj.schemaVersion === "number" && Number.isFinite(obj.schemaVersion)
      ? obj.schemaVersion
      : 0;
  if (schemaVersion !== TURN_CONTRACT_SCHEMA_VERSION) {
    errors.push(`schemaVersion must be ${TURN_CONTRACT_SCHEMA_VERSION}, got ${schemaVersion}`);
  }

  const sessionId = typeof obj.sessionId === "string" && obj.sessionId.trim()
    ? obj.sessionId.trim()
    : undefined;
  const activityId = typeof obj.activityId === "string" && obj.activityId.trim()
    ? obj.activityId.trim()
    : undefined;
  const source = typeof obj.source === "string" && obj.source.trim()
    ? obj.source.trim()
    : undefined;

  const createdAt =
    typeof obj.createdAt === "string" && obj.createdAt.trim()
      ? obj.createdAt.trim()
      : "";
  if (!createdAt) errors.push("createdAt must be a non-empty string (ISO timestamp)");

  const active = obj.active === true || obj.active === false ? obj.active : true;
  const revokedAt = typeof obj.revokedAt === "string" && obj.revokedAt.trim()
    ? obj.revokedAt.trim()
    : undefined;
  const revokedReason = typeof obj.revokedReason === "string" && obj.revokedReason.trim()
    ? obj.revokedReason.trim()
    : undefined;

  if (active && revokedAt) {
    errors.push("an active contract cannot have a revokedAt timestamp");
  }
  if (!active && !revokedAt) {
    errors.push("a revoked contract must have a revokedAt timestamp");
  }

  if (!Array.isArray(obj.commitments)) {
    errors.push("commitments must be an array");
  } else {
    if (obj.commitments.length === 0) {
      errors.push("commitments must not be empty");
    }
    const validatedCommitments: Commitment[] = [];
    for (let i = 0; i < obj.commitments.length; i++) {
      const commitment = validateOneCommitment(obj.commitments[i], i, errors);
      if (commitment) validatedCommitments.push(commitment);
    }

    if (errors.length > 0) {
      return { ok: false, errors };
    }

    const normalized = normalizeCommitments(validatedCommitments);

    const contract: TurnContract = {
      contractId,
      revision,
      learnerId,
      schemaVersion: TURN_CONTRACT_SCHEMA_VERSION,
      commitments: normalized,
      createdAt,
      active,
    };

    if (sessionId) contract.sessionId = sessionId;
    if (activityId) contract.activityId = activityId;
    if (source) contract.source = source;
    if (revokedAt) contract.revokedAt = revokedAt;
    if (revokedReason) contract.revokedReason = revokedReason;

    return { ok: true, value: contract };
  }

  return { ok: false, errors };
}
