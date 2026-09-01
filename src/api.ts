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
  disputeHypothesis as backendDisputeHypothesis,
  upsertHypothesis as backendUpsertHypothesis,
  getHypotheses as backendGetHypotheses,
} from "./lib/learning/store";
import type { LearnerHypothesis } from "./lib/learning/types";

import {
  testModelEndpoint as backendTestModelEndpoint,
  bindModelRole as backendBindModelRole,
  bindAllModelRoles as backendBindAllModelRoles,
  getSanitizedSettings as backendGetSanitizedSettings,
  ModelEndpointConfig,
  AgentRole,
  VisionEndpointRecord,
  VisionEndpointConfig,
  getVisionEndpoints as backendGetVisionEndpoints,
  getActiveVisionEndpoint as backendGetActiveVisionEndpoint,
  saveVisionEndpoint as backendSaveVisionEndpoint,
  activateVisionEndpoint as backendActivateVisionEndpoint,
  deleteVisionEndpoint as backendDeleteVisionEndpoint,
  testVisionEndpoint as backendTestVisionEndpoint,
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

export type { AttemptForTakingDTO, AttemptResultDTO, CurriculumNodeRecord, ModelEndpointConfig, AgentRole, GenerationRequest, GenerationResult, RubricEvaluation, RubricEvaluationRequest, TutorTurn, TutorTurnRequest, SessionMessage, GeneratedOnboarding, VisionEndpointRecord, VisionEndpointConfig };
// Note: `LearnerModelEntry` is exported below as an alias for `LearnerHypothesis`
// (Phase 1 cleanup: the free-form `learner_model_entries` table is gone).
// Keeping it out of the bundled re-export above avoids the duplicate declaration.
export type { Commitment, TurnContract } from "./lib/contracts/types";
export { describeCommitment, commitmentKindLabel } from "./lib/contracts/format";

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

/**
 * Phase 1 cleanup: the free-form `learner_model_entries` table is gone. The
 * structured `learner_hypotheses` ledger is the only durable home of learner
 * claims; `LearnerHypothesis` replaces `LearnerModelEntry` in the public API
 * surface. The `getLearnerPromptSummary` helper in `learning/promptSummary`
 * provides the prompt-time view.
 */
export type LearnerModelEntry = LearnerHypothesis;

export async function getLearnerModelEntries(learnerId = "default_learner"): Promise<LearnerHypothesis[]> {
  return backendGetHypotheses(learnerId);
}

export async function disputeLearnerModelEntry(hypothesisId: string, note: string): Promise<void> {
  return backendDisputeHypothesis(hypothesisId, note);
}

export async function recordLearnerModelEntry(params: {
  learnerId?: string;
  skillId: string;
  kind: LearnerHypothesis["kind"];
  statement: string;
  nextBestTest: string;
  evidenceIds?: string[];
}): Promise<LearnerHypothesis> {
  return backendUpsertHypothesis({
    learnerId: params.learnerId,
    skillId: params.skillId,
    kind: params.kind,
    statement: params.statement,
    nextBestTest: params.nextBestTest,
    evidenceIds: params.evidenceIds,
  });
}

export async function getActiveTutorContextLearnerSummary(learnerId = "default_learner"): Promise<string> {
  const { getLearnerPromptSummary, formatLearnerPromptSummary } = await import("./lib/learning/promptSummary");
  return formatLearnerPromptSummary(await getLearnerPromptSummary(learnerId));
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

/* ─────────────────────────────────────────────────────────────
   VISION ENDPOINTS (for curriculum OCR)
   ───────────────────────────────────────────────────────────── */

/** List all configured vision endpoints. */
export async function getVisionEndpoints(): Promise<VisionEndpointRecord[]> {
  return backendGetVisionEndpoints();
}

/** Get the currently active vision endpoint. */
export async function getActiveVisionEndpoint(): Promise<VisionEndpointRecord | null> {
  return backendGetActiveVisionEndpoint();
}

/** Save or update a vision endpoint. Creates a new one if `id` is not provided. */
export async function saveVisionEndpoint(
  config: VisionEndpointConfig & { label: string; id?: string }
): Promise<VisionEndpointRecord> {
  return backendSaveVisionEndpoint(config);
}

/** Activate a vision endpoint by id. Deactivates all others. */
export async function activateVisionEndpoint(id: string): Promise<void> {
  return backendActivateVisionEndpoint(id);
}

/** Delete a vision endpoint by id. */
export async function deleteVisionEndpoint(id: string): Promise<void> {
  return backendDeleteVisionEndpoint(id);
}

/** Test a vision endpoint configuration before saving. */
export async function testVisionEndpoint(config: VisionEndpointConfig): Promise<{
  reachable: boolean;
  authenticated: boolean;
  modelAvailable: boolean;
  error?: string;
}> {
  return backendTestVisionEndpoint(config);
}
