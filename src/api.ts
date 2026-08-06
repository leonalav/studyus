import {
  getAttemptForTaking as backendGetAttemptForTaking,
  autosaveDraft as backendAutosaveDraft,
  submitAttempt as backendSubmitAttempt,
  getAttemptResult as backendGetAttemptResult,
  applyScoreOverride as backendApplyScoreOverride,
  AttemptForTakingDTO,
  AttemptResultDTO,
} from "./lib/assessment";

import {
  getCurriculumTree as backendGetCurriculumTree,
  parseAndIngestPdfOutline as backendParseAndIngestPdfOutline,
  getEvidenceForSelectedNodes as backendGetEvidenceForSelectedNodes,
  CurriculumNodeRecord,
  CurriculumSourceRecord,
} from "./lib/curriculum";

import {
  getLearnerModelEntries as backendGetLearnerModelEntries,
  disputeLearnerModelEntry as backendDisputeLearnerModelEntry,
  recordLearnerModelEntry as backendRecordLearnerModelEntry,
  getActiveTutorContextLearnerSummary as backendGetActiveTutorContextLearnerSummary,
  LearnerModelEntry,
} from "./lib/learnerModel";

import {
  testModelEndpoint as backendTestModelEndpoint,
  bindModelRole as backendBindModelRole,
  bindAllModelRoles as backendBindAllModelRoles,
  getSanitizedSettings as backendGetSanitizedSettings,
  ModelEndpointConfig,
  AgentRole,
} from "./lib/llm";

export type { AttemptForTakingDTO, AttemptResultDTO, CurriculumNodeRecord, LearnerModelEntry, ModelEndpointConfig, AgentRole };

export async function getAttemptForTaking(attemptId: string): Promise<AttemptForTakingDTO | null> {
  return backendGetAttemptForTaking(attemptId);
}

export async function autosaveDraft(
  attemptId: string,
  itemId: string,
  draftResponse: string,
  flags: string[] = [],
  currentOrdinal?: number
) {
  return backendAutosaveDraft(attemptId, itemId, draftResponse, flags, currentOrdinal);
}

export async function submitAttempt(attemptId: string): Promise<AttemptResultDTO> {
  return backendSubmitAttempt(attemptId);
}

export async function getAttemptResult(attemptId: string): Promise<AttemptResultDTO> {
  return backendGetAttemptResult(attemptId);
}

export async function applyOverride(payload: {
  attemptId: string;
  responseId: string;
  criterionId: string;
  adjustedMark: number;
  reason: string;
  operator?: string;
}): Promise<AttemptResultDTO> {
  return backendApplyScoreOverride(payload);
}

export async function getCurriculumTree(sourceId: string): Promise<CurriculumNodeRecord[]> {
  return backendGetCurriculumTree(sourceId);
}

export async function parseAndIngestPdfOutline(params: {
  sourceId: string;
  name: string;
  pageCount: number;
  outline?: { title: string; destPage: number; depth: number }[];
}): Promise<CurriculumSourceRecord> {
  return backendParseAndIngestPdfOutline(params);
}

export async function getEvidenceForSelectedNodes(nodeIds: string[]) {
  return backendGetEvidenceForSelectedNodes(nodeIds);
}

export async function getLearnerModelEntries(learnerId = "default_learner"): Promise<LearnerModelEntry[]> {
  return backendGetLearnerModelEntries(learnerId);
}

export async function disputeLearnerModelEntry(entryId: string, note: string): Promise<void> {
  return backendDisputeLearnerModelEntry(entryId, note);
}

export async function recordLearnerModelEntry(params: {
  learnerId?: string;
  entryKind: any;
  curriculumNode?: string;
  criterionId?: string;
  statement: string;
  evidenceRefs: string[];
}) {
  return backendRecordLearnerModelEntry(params);
}

export async function getActiveTutorContextLearnerSummary(learnerId = "default_learner"): Promise<string> {
  return backendGetActiveTutorContextLearnerSummary(learnerId);
}

export async function testModelEndpoint(config: ModelEndpointConfig) {
  return backendTestModelEndpoint(config);
}

export async function bindModelRole(role: AgentRole, config: ModelEndpointConfig) {
  return backendBindModelRole(role, config);
}

export async function bindAllModelRoles(config: ModelEndpointConfig) {
  return backendBindAllModelRoles(config);
}

export async function getSettings() {
  return backendGetSanitizedSettings();
}
