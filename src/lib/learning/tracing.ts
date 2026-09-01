/**
 * Persistence for `turnTrace.ts` results.
 *
 * The trace is a structured timing record (`TraceResult`) emitted by every
 * tutor turn. Persisting it lets Tutor Studio's Diagnostics section show the
 * learner (or a debugging session) what each turn actually did, without
 * requiring a live replay against a model endpoint.
 *
 * The row is intentionally narrow — no learner message content, no prompt
 * text, no credentials. Phase names and numeric durations only, mirroring
 * the discipline `turnTrace.ts` itself observes.
 */

import { getDb, saveDbSync } from "../../db/database";
import type { TraceResult } from "../turnTrace";

export interface TurnTraceRecord {
  id: string;
  sessionId: string;
  learnerId: string;
  role: string;
  trace: TraceResult;
  createdAt: number;
}

const TRACE_COLUMNS = `id, session_id, learner_id, role, trace_json, created_at`;

function newTraceId(): string {
  return `tt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function rowToTrace(row: any[]): TurnTraceRecord {
  let trace: TraceResult;
  try {
    trace = JSON.parse(String(row[4])) as TraceResult;
  } catch {
    trace = { phases: [], attempts: [], totalMs: 0 };
  }
  return {
    id: String(row[0]),
    sessionId: String(row[1]),
    learnerId: String(row[2]),
    role: String(row[3]),
    trace,
    createdAt: Number(row[5]),
  };
}

/**
 * Persist a finished trace. Best-effort: a write failure must never cost the
 * learner their turn, so we swallow and log rather than re-throwing.
 */
export async function recordTurnTrace(
  trace: TraceResult,
  refs: { sessionId: string; learnerId: string; role: string }
): Promise<void> {
  try {
    const db = await getDb();
    const record: TurnTraceRecord = {
      id: newTraceId(),
      sessionId: refs.sessionId,
      learnerId: refs.learnerId,
      role: refs.role,
      trace,
      createdAt: Date.now(),
    };
    db.run(
      `INSERT INTO turn_traces (${TRACE_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?);`,
      [
        record.id,
        record.sessionId,
        record.learnerId,
        record.role,
        JSON.stringify(trace),
        record.createdAt,
      ]
    );
    saveDbSync();
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn("[tracing] could not persist turn trace", error);
  }
}

/**
 * Read the most recent traces for diagnostics. Capped at the caller-supplied
 * limit; the Tutor Studio panel requests 20.
 */
export async function getRecentTurnTraces(
  limit = 20,
  learnerId?: string
): Promise<TurnTraceRecord[]> {
  try {
    const db = await getDb();
    const res = learnerId
      ? db.exec(
          `SELECT ${TRACE_COLUMNS} FROM turn_traces
           WHERE learner_id = ? ORDER BY created_at DESC LIMIT ?;`,
          [learnerId, limit]
        )
      : db.exec(
          `SELECT ${TRACE_COLUMNS} FROM turn_traces ORDER BY created_at DESC LIMIT ?;`,
          [limit]
        );
    return (res[0]?.values ?? []).map(rowToTrace);
  } catch {
    return [];
  }
}