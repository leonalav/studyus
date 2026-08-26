import { getDb, saveDbSync, beginBatch, endBatch } from "../../db/database";
import type { TurnContract } from "./types";

function nowIso(): string {
  return new Date().toISOString();
}

// Column order matches the SELECT: id, revision, learner_id, session_id,
// activity_id, source, schema_version, commitments_json, created_at, active,
// revoked_at, revoked_reason
function rowToContract(row: any[]): TurnContract {
  const commitments = JSON.parse(String(row[7]));
  const contract: TurnContract = {
    contractId: String(row[0]),
    revision: Number(row[1]),
    learnerId: String(row[2]),
    schemaVersion: Number(row[6]),
    commitments,
    createdAt: String(row[8]),
    active: Number(row[9]) === 1,
  };
  if (row[3]) contract.sessionId = String(row[3]);
  if (row[4]) contract.activityId = String(row[4]);
  if (row[5]) contract.source = String(row[5]);
  if (row[10]) contract.revokedAt = String(row[10]);
  if (row[11]) contract.revokedReason = String(row[11]);
  return contract;
}

export async function saveContract(contract: TurnContract): Promise<void> {
  const db = await getDb();
  db.run(
    `INSERT OR REPLACE INTO turn_contract_revisions
      (id, revision, learner_id, session_id, activity_id, source, schema_version, commitments_json, created_at, active, revoked_at, revoked_reason)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      contract.contractId,
      contract.revision,
      contract.learnerId,
      contract.sessionId ?? null,
      contract.activityId ?? null,
      contract.source ?? null,
      contract.schemaVersion,
      JSON.stringify(contract.commitments),
      contract.createdAt,
      contract.active ? 1 : 0,
      contract.revokedAt ?? null,
      contract.revokedReason ?? null,
    ],
  );
  saveDbSync();
}

export async function getContractById(id: string): Promise<TurnContract | null> {
  const db = await getDb();
  const rows = db.exec(
    "SELECT id, revision, learner_id, session_id, activity_id, source, schema_version, commitments_json, created_at, active, revoked_at, revoked_reason FROM turn_contract_revisions WHERE id = ?",
    [id],
  );
  if (!rows.length || !rows[0].values.length) return null;
  return rowToContract(rows[0].values[0]);
}

export async function listActiveContracts(learnerId: string): Promise<TurnContract[]> {
  const db = await getDb();
  const rows = db.exec(
    "SELECT id, revision, learner_id, session_id, activity_id, source, schema_version, commitments_json, created_at, active, revoked_at, revoked_reason FROM turn_contract_revisions WHERE learner_id = ? AND active = 1",
    [learnerId],
  );
  if (!rows.length) return [];
  return rows[0].values.map((r: any[]) => rowToContract(r));
}

/**
 * The single active contract that governs a session context.
 *
 * A session-specific active revision wins over the null-session (general
 * preferences) revision; among ties the highest revision wins. Returns null
 * when no active revision exists for either scope — restored sessions with no
 * contract simply tutor without one, never a fabricated default.
 */
export async function getActiveContract(
  learnerId: string,
  sessionId?: string,
): Promise<TurnContract | null> {
  const all = await listActiveContracts(learnerId);
  if (all.length === 0) return null;

  const sessionMatch = sessionId
    ? all.filter((c) => c.sessionId === sessionId)
    : [];
  const pool = sessionMatch.length > 0
    ? sessionMatch
    : all.filter((c) => c.sessionId === undefined);

  if (pool.length === 0) return null;
  return pool.reduce((best, c) => (c.revision > best.revision ? c : best));
}

export async function listAllContracts(learnerId: string): Promise<TurnContract[]> {
  const db = await getDb();
  const rows = db.exec(
    "SELECT id, revision, learner_id, session_id, activity_id, source, schema_version, commitments_json, created_at, active, revoked_at, revoked_reason FROM turn_contract_revisions WHERE learner_id = ?",
    [learnerId],
  );
  if (!rows.length) return [];
  return rows[0].values.map((r: any[]) => rowToContract(r));
}

export async function revokeContract(
  id: string,
  reason: string,
  revokedAt?: string,
): Promise<void> {
  const db = await getDb();
  const ts = revokedAt ?? nowIso();
  db.run(
    `UPDATE turn_contract_revisions SET active = 0, revoked_at = ?, revoked_reason = ? WHERE id = ? AND active = 1`,
    [ts, reason, id],
  );
  saveDbSync();
}

export async function createNextRevision(contract: TurnContract): Promise<TurnContract> {
  const db = await getDb();
  const supersededAt = nowIso();
  beginBatch();
  try {
    // Revoke the previous active revision in the same session scope.
    if (contract.sessionId) {
      db.run(
        `UPDATE turn_contract_revisions SET active = 0, revoked_at = ?, revoked_reason = 'superseded' WHERE learner_id = ? AND session_id = ? AND active = 1`,
        [supersededAt, contract.learnerId, contract.sessionId],
      );
    } else {
      db.run(
        `UPDATE turn_contract_revisions SET active = 0, revoked_at = ?, revoked_reason = 'superseded' WHERE learner_id = ? AND session_id IS NULL AND active = 1`,
        [supersededAt, contract.learnerId],
      );
    }

    db.run(
      `INSERT INTO turn_contract_revisions
        (id, revision, learner_id, session_id, activity_id, source, schema_version, commitments_json, created_at, active)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      [
        contract.contractId,
        contract.revision,
        contract.learnerId,
        contract.sessionId ?? null,
        contract.activityId ?? null,
        contract.source ?? null,
        contract.schemaVersion,
        JSON.stringify(contract.commitments),
        contract.createdAt,
      ],
    );
  } finally {
    endBatch();
  }
  saveDbSync();
  return contract;
}

export async function getLatestRevisionNumber(
  learnerId: string,
  sessionId?: string,
): Promise<number> {
  const db = await getDb();
  const rows = sessionId
    ? db.exec(
        "SELECT MAX(revision) FROM turn_contract_revisions WHERE learner_id = ? AND session_id = ?",
        [learnerId, sessionId],
      )
    : db.exec(
        "SELECT MAX(revision) FROM turn_contract_revisions WHERE learner_id = ? AND session_id IS NULL",
        [learnerId],
      );
  if (!rows.length || !rows[0].values.length || rows[0].values[0][0] === null) return 0;
  return Number(rows[0].values[0][0]);
}
