/**
 * Assessment Framework — Public API
 *
 * This module exports the complete agentic assessment framework:
 *   - Domain types
 *   - Item bank
 *   - Form generator
 *   - Grader (MCQ + rubric)
 *   - Persistence store
 *   - State machines
 */

// Types
export type {
  BloomLevel,
  Difficulty,
  SubjectKey,
  QuestionType,
  AssessmentMode,
  AssessmentForm,
  AssessmentItem,
  AssessmentAttempt,
  AttemptResponse,
  AttemptStatus,
  AttemptParams,
  ResponseStatus,
  CriterionScore,
  CriterionMastery,
  GradeOutcome,
  RubricCriterion,
  Rubric,
  McqOption,
  Rigor,
} from "./types";
export { BLOOM_ORDER, DIFFICULTY_ORDER, bloomRank, difficultyRank } from "./types";

// Item Bank
export {
  ITEM_BANK,
  getItem,
  getItemsForSubject,
  getItemsForNodes,
  getItemsByBloom,
  bankSizeBySubject,
  totalBankSize,
} from "./itemBank";

// Generator
export {
  generateForm,
  validateForm,
  defaultBloomTarget,
  availableItemCount,
  type GenerationParams,
  type ValidationResult,
} from "./generator";

// Grader
export {
  gradeResponse,
  gradeAttempt,
  gradeMcq,
  gradeNumeric,
  gradeRubric,
  applyOverride,
  type GradeResult,
  type McqGradeResult,
  type NumericGradeResult,
  type RubricGradeResult,
  type ScoreOverride,
} from "./grader";

// State Machine
export {
  canTransitionAttempt,
  transitionAttempt,
  submitAttempt,
  canTransitionResponse,
  transitionResponse,
  remainingSeconds,
  isExpired,
} from "./stateMachine";

// Store
export {
  saveForm,
  loadForms,
  loadForm,
  saveAttempt,
  loadAttempts,
  loadAttempt,
  getAttemptsForSubject,
  getActiveAttempts,
  getCompletedAttempts,
  createAttempt,
  transitionAttemptStatus,
  submitAttemptForGrading,
  retryGrading,
  saveResponse,
  commitResponse,
  flagResponse,
  markSeen,
  saveDraft,
  loadDraft,
  clearDraft,
  loadMastery,
  computeAggregateStats,
  type AggregateStats,
} from "./store";
