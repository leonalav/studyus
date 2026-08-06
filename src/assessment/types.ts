/**
 * Agentic Assessment Framework — Domain Model
 *
 * Criterion-referenced formative assessment pipeline:
 *   Curriculum evidence → validated assessment form → persistent learner attempt
 *   → deterministic/rubric grader → criterion scores → analytics
 *
 * Scores describe demonstrated criterion mastery — they are formative
 * and criterion-referenced, not psychometric ability estimates.
 */

// ─── Bloom's Taxonomy (operational levels) ───────────────────────────────────

export type BloomLevel =
  | "remember"
  | "understand"
  | "apply"
  | "analyze"
  | "evaluate"
  | "create";

export const BLOOM_ORDER: BloomLevel[] = [
  "remember",
  "understand",
  "apply",
  "analyze",
  "evaluate",
  "create",
];

export function bloomRank(level: BloomLevel): number {
  return BLOOM_ORDER.indexOf(level);
}

// ─── Question Types ──────────────────────────────────────────────────────────

export type QuestionType = "mcq" | "short_answer" | "proof" | "numeric";

export type Difficulty = "introductory" | "foundational" | "proficient" | "advanced" | "expert";

export const DIFFICULTY_ORDER: Difficulty[] = [
  "introductory",
  "foundational",
  "proficient",
  "advanced",
  "expert",
];

export function difficultyRank(d: Difficulty): number {
  return DIFFICULTY_ORDER.indexOf(d);
}

// ─── Subject & Curriculum ────────────────────────────────────────────────────

export type SubjectKey = "math" | "biology" | "chemistry" | "physics" | "programming";

export interface CurriculumNode {
  id: string;
  subject: SubjectKey;
  section: string;
  subsection: string;
  label: string;
}

// ─── MCQ Option ──────────────────────────────────────────────────────────────

export interface McqOption {
  id: string; // "a" | "b" | "c" | "d" etc.
  text: string;
}

// ─── Numeric Answer Spec ─────────────────────────────────────────────────────

export interface NumericAccepted {
  value: string;
  absoluteTolerance?: number;
  relativeTolerance?: number;
}

export interface NumericSpec {
  version: 1;
  type: "numeric";
  accepted: NumericAccepted[];
  unit?: string | null;
}

// ─── Rubric Criterion ────────────────────────────────────────────────────────

export interface RubricCriterion {
  id: string; // stable criterion id: e.g. "c1-setup", "c2-derivation"
  label: string;
  description: string;
  maxMarks: number;
  /** Key elements expected in a correct response for this criterion */
  keyElements: string[];
  /** Common errors / misconceptions to look for */
  commonErrors?: string[];
}

export interface Rubric {
  version: 1;
  criteria: RubricCriterion[];
  totalMarks: number; // must equal sum of criteria maxMarks
}

// ─── Assessment Item (a question in a form) ─────────────────────────────────

export interface AssessmentItem {
  id: string;
  /** Stable bank id (if from bank) or generated id */
  bankId?: string;
  subject: SubjectKey;
  /** Curriculum node this item assesses */
  nodeId: string;
  section: string;
  subsection: string;
  /** Bloom's taxonomy level targeted */
  bloomLevel: BloomLevel;
  /** Instructional difficulty */
  difficulty: Difficulty;
  marks: number;
  type: QuestionType;
  /** Question stem */
  stem: string;
  /** Optional hint (shown in casual/challenging modes) */
  hint?: string;
  /** MCQ-specific */
  mcqOptions?: McqOption[];
  mcqAnswerKey?: string; // predetermined correct option id
  /** Numeric-specific */
  numericSpec?: NumericSpec;
  /** Proof / short-answer rubric */
  rubric?: Rubric;
  /** Tags for adaptive selection */
  tags?: string[];
}

// ─── Assessment Form ─────────────────────────────────────────────────────────

export type AssessmentMode = "formative" | "closed_book_mock" | "practice";

export interface AssessmentForm {
  id: string;
  version: number;
  title: string;
  subject: SubjectKey;
  mode: AssessmentMode;
  difficulty: Difficulty;
  /** Targeted Bloom composition */
  bloomComposition: Record<BloomLevel, number>;
  items: AssessmentItem[];
  totalMarks: number;
  timeLimitMinutes?: number;
  /** Whether the form has passed validation */
  validated: boolean;
  createdAt: number;
}

// ─── Attempt State Machine ───────────────────────────────────────────────────

export type AttemptStatus =
  | "created"
  | "active"
  | "submission_review"
  | "grading"
  | "completed"
  | "expired"
  | "grading_blocked"
  | "abandoned";

export const VALID_ATTEMPT_TRANSITIONS: Record<AttemptStatus, AttemptStatus[]> = {
  created: ["active", "expired", "abandoned"],
  active: ["submission_review", "expired", "abandoned"],
  submission_review: ["grading", "active"], // back to active if learner cancels
  grading: ["completed", "grading_blocked"],
  grading_blocked: ["grading"], // retry grading
  completed: [],
  expired: [],
  abandoned: [],
};

// ─── Response State Machine ──────────────────────────────────────────────────

export type ResponseStatus =
  | "unseen"
  | "presented"
  | "draft"
  | "committed"
  | "evaluating"
  | "graded"
  | "skipped"
  | "timed_out"
  | "grading_blocked";

// ─── Criterion Score ─────────────────────────────────────────────────────────

export interface CriterionScore {
  criterionId: string;
  label: string;
  maxMarks: number;
  awarded: number;
  rationale: string;
  confidence: "high" | "medium" | "low" | "blocked";
}

// ─── Attempt Response ────────────────────────────────────────────────────────

export interface AttemptResponse {
  id: string;
  attemptId: string;
  itemId: string;
  status: ResponseStatus;
  /** Learner's response text or selected option */
  responseText?: string;
  mcqSelection?: string;
  numericValue?: string;
  /** Flags */
  flagged: boolean;
  confidence?: number; // self-reported 0-1
  /** Timing */
  firstSeenAt?: number;
  committedAt?: number;
  /** Grading results */
  score?: number;
  maxScore?: number;
  criterionScores?: CriterionScore[];
  isCorrect?: boolean;
  /** Hints consumed */
  hintsConsumed: number;
  /** Attempts at this item (for remediation) */
  attemptCount: number;
}

// ─── Assessment Attempt ──────────────────────────────────────────────────────

export interface AssessmentAttempt {
  id: string;
  formId: string;
  status: AttemptStatus;
  startedAt: number;
  deadlineAt?: number;
  submittedAt?: number;
  /** Aggregate score */
  totalScore?: number;
  totalMax?: number;
  /** Responses keyed by itemId */
  responses: Record<string, AttemptResponse>;
  /** Item order (may be adaptive) */
  itemOrder: string[];
  /** Current position */
  currentIndex: number;
  /** Assistance policy */
  assistancePolicy: "closed_book" | "socratic" | "progressive";
  /** Creation params for resume */
  params: AttemptParams;
}

export interface AttemptParams {
  subject: SubjectKey;
  formId: string;
  mode: AssessmentMode;
  pickedNodes: string[];
  rigor: Rigor;
}

export type Rigor = "casual" | "challenging" | "rigorous";

// ─── Grading Outcome ─────────────────────────────────────────────────────────

export type GradeOutcome =
  | "correct"
  | "partial"
  | "incorrect"
  | "blank"
  | "grading_blocked"
  | "manual_review";

// ─── Analytics ───────────────────────────────────────────────────────────────

export interface CriterionMastery {
  nodeId: string;
  criterionId: string;
  attempts: number;
  correct: number;
  assisted: number;
  lastAttemptAt: number;
  masteryPct: number;
}
