import { getDb, saveDbSync } from "../db/database";

export type EntryKind =
  | "misconception"
  | "criterion_deficit"
  | "intervention_response"
  | "retention_estimate"
  | "calibration";

export type EntryState = "open" | "weakening" | "resolved" | "disputed";

export interface LearnerModelEntry {
  id: string;
  learnerId: string;
  entryKind: EntryKind;
  curriculumNode?: string | null;
  criterionId?: string | null;
  statement: string;
  evidenceRefs: string[];
  observationCount: number;
  firstObserved: string;
  lastObserved: string;
  lastConfirmed: string;
  state: EntryState;
  learnerVisible: boolean;
  learnerDisputed: boolean;
  disputeNote?: string | null;
}

export interface InterventionOutcomeRecord {
  id: string;
  learnerId: string;
  shape: string;
  nodeId?: string | null;
  criterionId?: string | null;
  hintLevelReached: number;
  transferCheckPassed: boolean;
  timeToUnassistedSuccessS?: number | null;
  timestamp: string;
}

export async function recordLearnerModelEntry({
  learnerId = "default_learner",
  entryKind,
  curriculumNode,
  criterionId,
  statement,
  evidenceRefs,
}: {
  learnerId?: string;
  entryKind: EntryKind;
  curriculumNode?: string;
  criterionId?: string;
  statement: string;
  evidenceRefs: string[];
}): Promise<LearnerModelEntry> {
  const db = await getDb();
  const now = new Date().toISOString();
  const id = `lme-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const refsJson = JSON.stringify(evidenceRefs);

  db.run(`
    INSERT INTO learner_model_entries (id, learner_id, entry_kind, curriculum_node, criterion_id, statement, evidence_refs, observation_count, first_observed, last_observed, last_confirmed, state, learner_visible, learner_disputed)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, 'open', 1, 0);
  `, [id, learnerId, entryKind, curriculumNode || null, criterionId || null, statement, refsJson, now, now, now]);

  saveDbSync();

  return {
    id,
    learnerId,
    entryKind,
    curriculumNode: curriculumNode || null,
    criterionId: criterionId || null,
    statement,
    evidenceRefs,
    observationCount: 1,
    firstObserved: now,
    lastObserved: now,
    lastConfirmed: now,
    state: "open",
    learnerVisible: true,
    learnerDisputed: false,
  };
}

export async function getLearnerModelEntries(learnerId = "default_learner"): Promise<LearnerModelEntry[]> {
  const db = await getDb();
  const res = db.exec(`
    SELECT id, learner_id, entry_kind, curriculum_node, criterion_id, statement, evidence_refs, observation_count, first_observed, last_observed, last_confirmed, state, learner_visible, learner_disputed, dispute_note
    FROM learner_model_entries
    WHERE learner_id = ?
    ORDER BY last_observed DESC;
  `, [learnerId]);

  if (!res[0]) return [];

  return res[0].values.map((r) => {
    let refs: string[] = [];
    try { refs = JSON.parse(r[6] as string); } catch { refs = []; }
    return {
      id: r[0] as string,
      learnerId: r[1] as string,
      entryKind: r[2] as EntryKind,
      curriculumNode: r[3] as string | null,
      criterionId: r[4] as string | null,
      statement: r[5] as string,
      evidenceRefs: refs,
      observationCount: r[7] as number,
      firstObserved: r[8] as string,
      lastObserved: r[9] as string,
      lastConfirmed: r[10] as string,
      state: r[11] as EntryState,
      learnerVisible: (r[12] as number) === 1,
      learnerDisputed: (r[13] as number) === 1,
      disputeNote: r[14] as string | null,
    };
  });
}

export async function disputeLearnerModelEntry(entryId: string, note: string): Promise<void> {
  const db = await getDb();
  db.run(`
    UPDATE learner_model_entries
    SET learner_disputed = 1,
        state = 'disputed',
        dispute_note = ?
    WHERE id = ?;
  `, [note, entryId]);
  saveDbSync();
}

export async function getActiveTutorContextLearnerSummary(learnerId = "default_learner"): Promise<string> {
  const entries = await getLearnerModelEntries(learnerId);
  // Exclude disputed entries from active prompt context
  const activeEntries = entries.filter((e) => !e.learnerDisputed && e.state !== "resolved");

  if (activeEntries.length === 0) {
    return "Learner model: No active misconceptions recorded.";
  }

  const summaries = activeEntries.map(
    (e) => `- [${e.entryKind}] ${e.statement} (observed ${e.observationCount}x, evidence: ${e.evidenceRefs.slice(0, 2).join(", ")})`
  );

  return "LEARNER MODEL SUMMARY (Undisputed):\n" + summaries.join("\n");
}

export async function recordInterventionOutcome({
  learnerId = "default_learner",
  shape,
  nodeId,
  criterionId,
  hintLevelReached,
  transferCheckPassed,
  timeToUnassistedSuccessS,
}: {
  learnerId?: string;
  shape: string;
  nodeId?: string;
  criterionId?: string;
  hintLevelReached: number;
  transferCheckPassed: boolean;
  timeToUnassistedSuccessS?: number;
}): Promise<void> {
  const db = await getDb();
  const now = new Date().toISOString();
  const id = `io-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

  db.run(`
    INSERT INTO intervention_outcomes (id, learner_id, shape, node_id, criterion_id, hint_level_reached, transfer_check_passed, time_to_unassisted_success_s, timestamp)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);
  `, [
    id,
    learnerId,
    shape,
    nodeId || null,
    criterionId || null,
    hintLevelReached,
    transferCheckPassed ? 1 : 0,
    timeToUnassistedSuccessS || null,
    now,
  ]);

  saveDbSync();
}
