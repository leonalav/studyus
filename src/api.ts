import {
  getAttemptForTaking as backendGetAttemptForTaking,
  beginAttempt as backendBeginAttempt,
  createRetakeAttempt as backendCreateRetakeAttempt,
  autosaveDraft as backendAutosaveDraft,
  submitAttempt as backendSubmitAttempt,
  getAttemptResult as backendGetAttemptResult,
  applyScoreOverride as backendApplyScoreOverride,
  AttemptForTakingDTO,
  AttemptResultDTO,
} from "./lib/assessment";

import {
  generateAssessment as backendGenerateAssessment,
  GenerationRequest,
  GenerationResult,
} from "./lib/generator";

import {
  evaluateRubricResponse as backendEvaluateRubricResponse,
  RubricEvaluation,
  RubricEvaluationRequest,
} from "./lib/evaluator";

import {
  askTutorTurn as backendAskTutorTurn,
  ensureChalkboardSession as backendEnsureChalkboardSession,
  getSessionMessages as backendGetSessionMessages,
  generateOnboardingQuestions as backendGenerateOnboardingQuestions,
  deleteChalkboardSession as backendDeleteChalkboardSession,
  TutorTurn,
  TutorTurnRequest,
  SessionMessage,
  GeneratedOnboarding,
} from "./lib/tutor";

import {
  getCurriculumTree as backendGetCurriculumTree,
  parseAndIngestPdfOutline as backendParseAndIngestPdfOutline,
  getEvidenceForSelectedNodes as backendGetEvidenceForSelectedNodes,
  transcribeNode as backendTranscribeNode,
  setSourceFilePath as backendSetSourceFilePath,
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

import { countBoundAgents as backendCountBoundAgents } from "./lib/agentRuntime";

/* ─────────────────────────────────────────────────────────────
   TAURI/PDFIUM NATIVE SEAM
   The desktop build (Tauri) exposes Rust commands for PDF rasterization, text
   extraction, and source-PDF persistence. The browser single-file build has no
   such backend, so the seam throws a typed error callers can catch and degrade
   from. The real logic lives in `./lib/tauri` (a leaf module); `src/api.ts`
   only re-exports it so the rest of the app keeps one import surface.
   ───────────────────────────────────────────────────────────── */

export {
  TauriUnavailableError,
  isTauriRuntime,
  renderPageRange,
  extractTextRange,
  saveSourcePdf,
} from "./lib/tauri";

export type { AttemptForTakingDTO, AttemptResultDTO, CurriculumNodeRecord, LearnerModelEntry, ModelEndpointConfig, AgentRole, GenerationRequest, GenerationResult, RubricEvaluation, RubricEvaluationRequest, TutorTurn, TutorTurnRequest, SessionMessage, GeneratedOnboarding };

export async function getAttemptForTaking(attemptId: string): Promise<AttemptForTakingDTO | null> {
  return backendGetAttemptForTaking(attemptId);
}

export async function beginAttempt(attemptId: string) {
  return backendBeginAttempt(attemptId);
}

export async function createRetakeAttempt(attemptId: string): Promise<string> {
  return backendCreateRetakeAttempt(attemptId);
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

/**
 * Lazily rasterize + vision-transcribe one curriculum node's page range into
 * normalized curriculum_chunks. Cache hit if chunks already exist for the node.
 * Throws TauriUnavailableError outside the desktop build. Returns the number of
 * page-chunks written (0 on cache hit).
 */
export async function transcribeNode(
  nodeId: string,
  onProgress?: (page: number, total: number) => void
): Promise<number> {
  return backendTranscribeNode(nodeId, onProgress);
}

/** Store the on-disk PDF path for a source so pdfium can open it during transcription. */
export async function setSourceFilePath(sourceId: string, filePath: string): Promise<void> {
  return backendSetSourceFilePath(sourceId, filePath);
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

/** Count of fully-bound agent roles (tutor/generation/evaluator) — surfaced to
 *  the learner during onboarding as "you have N agents available to @". */
export async function countBoundAgents(): Promise<number> {
  return backendCountBoundAgents();
}

export async function generateAssessment(req: GenerationRequest): Promise<GenerationResult> {
  return backendGenerateAssessment(req);
}

export async function evaluateRubricResponse(req: RubricEvaluationRequest): Promise<RubricEvaluation> {
  return backendEvaluateRubricResponse(req);
}

export async function askTutorTurn(req: TutorTurnRequest) {
  return backendAskTutorTurn(req);
}

/** Generate this session's onboarding intake for a concept (the counsellor's
 *  notification plus its `create_forms` tool call — AI-written, not a fixed
 *  script). Grounds on transcribed curriculum evidence when available. */
export async function generateOnboardingQuestions(req: {
  concept: string;
  boundNodes?: string[];
  signal?: AbortSignal;
}): Promise<GeneratedOnboarding> {
  return backendGenerateOnboardingQuestions(req);
}

export async function ensureChalkboardSession(session: {
  id: string;
  title: string;
  domain: any;
  boundNodes?: string[];
  assistancePolicy?: string;
}) {
  return backendEnsureChalkboardSession(session);
}

export async function getSessionMessages(sessionId: string, limit?: number): Promise<SessionMessage[]> {
  return backendGetSessionMessages(sessionId, limit);
}

/** Delete a chalkboard session row and its cascaded transcript. */
export async function deleteChalkboardSession(sessionId: string): Promise<void> {
  return backendDeleteChalkboardSession(sessionId);
}
