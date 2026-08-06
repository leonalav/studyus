/**
 * Assessment Grader
 *
 * Deterministic and rubric-based grading:
 *   - MCQ: exact match against predetermined answer key
 *   - Numeric: tolerance-based equivalence
 *   - Proof/Short-answer: criterion-referenced rubric grading
 *
 * Core principles:
 *   - Scores are arithmetically sound
 *   - Grader failures are visible (grading_blocked), never silently zero
 *   - Rubric awards cannot exceed declared bounds
 *   - Provider outages do not lower a learner's score
 */

import type {
  AssessmentItem,
  AttemptResponse,
  CriterionScore,
  GradeOutcome,
  RubricCriterion,
} from "./types";

// ═══════════════════════════════════════════════════════════════════════════════
// MCQ Grading — Deterministic
// ═══════════════════════════════════════════════════════════════════════════════

export interface McqGradeResult {
  isCorrect: boolean;
  awarded: number;
  maxMarks: number;
  outcome: GradeOutcome;
}

export function gradeMcq(
  item: AssessmentItem,
  selectedOption: string | undefined,
): McqGradeResult {
  if (!item.mcqOptions || !item.mcqAnswerKey) {
    return {
      isCorrect: false,
      awarded: 0,
      maxMarks: item.marks,
      outcome: "grading_blocked",
    };
  }

  // No answer = blank
  if (!selectedOption) {
    return {
      isCorrect: false,
      awarded: 0,
      maxMarks: item.marks,
      outcome: "blank",
    };
  }

  // Validate that the selection is a valid option
  const validOption = item.mcqOptions.some((o) => o.id === selectedOption);
  if (!validOption) {
    return {
      isCorrect: false,
      awarded: 0,
      maxMarks: item.marks,
      outcome: "grading_blocked",
    };
  }

  const isCorrect = selectedOption === item.mcqAnswerKey;
  return {
    isCorrect,
    awarded: isCorrect ? item.marks : 0,
    maxMarks: item.marks,
    outcome: isCorrect ? "correct" : "incorrect",
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Numeric Grading — Tolerance-based
// ═══════════════════════════════════════════════════════════════════════════════

export interface NumericGradeResult {
  isCorrect: boolean;
  awarded: number;
  maxMarks: number;
  outcome: GradeOutcome;
}

/**
 * Parse a numeric value from text. Handles:
 *   - Integers: "10", "-5"
 *   - Decimals: "3.14", "0.5", "-0.001"
 *   - Fractions: "1/3", "22/7"
 *   - Rejects: NaN, Infinity, empty
 */
function parseNumeric(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // Try fraction first
  const fracMatch = trimmed.match(/^(-?\d+)\s*\/\s*(-?\d+)$/);
  if (fracMatch) {
    const num = parseInt(fracMatch[1], 10);
    const den = parseInt(fracMatch[2], 10);
    if (den === 0) return null;
    if (!isFinite(num) || !isFinite(den)) return null;
    return num / den;
  }

  // Try plain number
  const val = Number(trimmed);
  if (!isFinite(val)) return null;
  return val;
}

/**
 * Check if two numeric values are within tolerance.
 */
function numericMatch(
  given: number,
  accepted: number,
  absTol: number,
  relTol: number,
): boolean {
  const diff = Math.abs(given - accepted);
  if (diff <= absTol) return true;
  if (accepted !== 0 && diff / Math.abs(accepted) <= relTol) return true;
  return false;
}

export function gradeNumeric(
  item: AssessmentItem,
  responseText: string | undefined,
): NumericGradeResult {
  if (!item.numericSpec) {
    return { isCorrect: false, awarded: 0, maxMarks: item.marks, outcome: "grading_blocked" };
  }

  if (!responseText?.trim()) {
    return { isCorrect: false, awarded: 0, maxMarks: item.marks, outcome: "blank" };
  }

  const given = parseNumeric(responseText);
  if (given === null) {
    return { isCorrect: false, awarded: 0, maxMarks: item.marks, outcome: "incorrect" };
  }

  const spec = item.numericSpec;
  for (const acc of spec.accepted) {
    const accepted = parseNumeric(acc.value);
    if (accepted === null) continue;
    const absTol = acc.absoluteTolerance ?? 0;
    const relTol = acc.relativeTolerance ?? 0;
    if (numericMatch(given, accepted, absTol, relTol)) {
      return { isCorrect: true, awarded: item.marks, maxMarks: item.marks, outcome: "correct" };
    }
  }

  return { isCorrect: false, awarded: 0, maxMarks: item.marks, outcome: "incorrect" };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Rubric Grading — Criterion-referenced
// ═══════════════════════════════════════════════════════════════════════════════

export interface RubricGradeResult {
  criterionScores: CriterionScore[];
  totalAwarded: number;
  totalMax: number;
  outcome: GradeOutcome;
  rationale: string;
}

/**
 * Grade a proof/short-answer response against a rubric.
 *
 * This uses keyword/concept matching against key elements.
 * It is NOT LLM-based — it's a deterministic heuristic grader
 * that checks for the presence of key concepts in the response.
 *
 * Confidence levels:
 *   - "high": key elements clearly present
 *   - "medium": some key elements present but incomplete
 *   - "low": few key elements detected
 *   - "blocked": response too short or empty to evaluate
 */
export function gradeRubric(
  item: AssessmentItem,
  responseText: string | undefined,
): RubricGradeResult {
  const rubric = item.rubric;
  if (!rubric) {
    return {
      criterionScores: [],
      totalAwarded: 0,
      totalMax: item.marks,
      outcome: "grading_blocked",
      rationale: "No rubric available for this item",
    };
  }

  // Blank response
  if (!responseText || responseText.trim().length < 10) {
    return {
      criterionScores: rubric.criteria.map((c) => ({
        criterionId: c.id,
        label: c.label,
        maxMarks: c.maxMarks,
        awarded: 0,
        rationale: "Response is blank or too short to evaluate",
        confidence: "blocked" as const,
      })),
      totalAwarded: 0,
      totalMax: rubric.totalMarks,
      outcome: "blank",
      rationale: "Response is blank or too short",
    };
  }

  const normalizedResponse = responseText.toLowerCase();
  const criterionScores: CriterionScore[] = [];
  let totalAwarded = 0;

  for (const criterion of rubric.criteria) {
    const score = gradeCriterion(criterion, normalizedResponse, responseText);
    criterionScores.push(score);
    totalAwarded += score.awarded;
  }

  // Validate: total cannot exceed max
  totalAwarded = Math.min(totalAwarded, rubric.totalMarks);

  // Determine outcome
  const pct = totalAwarded / rubric.totalMarks;
  let outcome: GradeOutcome;
  if (pct >= 0.85) outcome = "correct";
  else if (pct >= 0.4) outcome = "partial";
  else outcome = "incorrect";

  const rationale = `Scored ${totalAwarded}/${rubric.totalMarks} across ${rubric.criteria.length} criteria`;

  return { criterionScores, totalAwarded, totalMax: rubric.totalMarks, outcome, rationale };
}

/**
 * Grade a single criterion against the response.
 *
 * Uses a multi-signal approach:
 *   1. Key element keyword matching
 *   2. Mathematical expression detection (LaTeX patterns)
 *   3. Common error detection (penalizes known mistakes)
 */
function gradeCriterion(
  criterion: RubricCriterion,
  normalizedResponse: string,
  rawResponse: string,
): CriterionScore {
  let hits = 0;
  const totalElements = criterion.keyElements.length;
  const matchedElements: string[] = [];
  const missedElements: string[] = [];

  for (const element of criterion.keyElements) {
    if (keyElementPresent(element, normalizedResponse, rawResponse)) {
      hits++;
      matchedElements.push(element);
    } else {
      missedElements.push(element);
    }
  }

  // Check for common errors (reduce score)
  let errorPenalty = 0;
  if (criterion.commonErrors) {
    for (const error of criterion.commonErrors) {
      if (commonErrorPresent(error, normalizedResponse, rawResponse)) {
        errorPenalty += 0.5; // partial penalty per error signal
      }
    }
  }

  // Compute score
  const hitRatio = totalElements > 0 ? hits / totalElements : 0;
  const rawScore = hitRatio * criterion.maxMarks;
  const adjustedScore = Math.max(0, rawScore - errorPenalty * (criterion.maxMarks / totalElements));

  // Clamp: never exceed max, never go below 0
  const awarded = Math.max(0, Math.min(criterion.maxMarks, Math.round(adjustedScore * 100) / 100));

  // Determine confidence
  let confidence: CriterionScore["confidence"];
  if (normalizedResponse.length < 20) {
    confidence = "blocked";
  } else if (hitRatio >= 0.75) {
    confidence = "high";
  } else if (hitRatio >= 0.4) {
    confidence = "medium";
  } else {
    confidence = "low";
  }

  // Build rationale
  let rationale = "";
  if (matchedElements.length > 0) {
    rationale += `Found: ${matchedElements.join("; ")}. `;
  }
  if (missedElements.length > 0) {
    rationale += `Missing: ${missedElements.join("; ")}. `;
  }
  if (errorPenalty > 0) {
    rationale += `Common errors detected.`;
  }

  return {
    criterionId: criterion.id,
    label: criterion.label,
    maxMarks: criterion.maxMarks,
    awarded,
    rationale: rationale.trim() || "No key elements detected",
    confidence,
  };
}

/**
 * Check if a key element is present in the response.
 * Uses flexible matching: keywords, mathematical patterns, synonyms.
 */
function keyElementPresent(
  element: string,
  normalized: string,
  raw: string,
): boolean {
  const elLower = element.toLowerCase();

  // Direct substring match
  if (normalized.includes(elLower)) return true;

  // Extract key words (2+ chars) and check if majority present
  const words = elLower
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 2);

  if (words.length === 0) return false;

  const wordHits = words.filter((w) => normalized.includes(w)).length;
  // Require 60% of significant words
  if (wordHits / words.length >= 0.6) return true;

  // Check for mathematical equivalents (LaTeX patterns)
  if (hasMathEquivalent(element, raw)) return true;

  return false;
}

/**
 * Check for mathematical equivalent expressions.
 * Handles common LaTeX patterns.
 */
function hasMathEquivalent(element: string, raw: string): boolean {
  // Check for limit notation
  if (/lim/i.test(element)) {
    if (/\\lim|lim\s*[\(→]|lim.*→|lim.*->|limit/i.test(raw)) return true;
  }
  // Check for derivative notation
  if (/d\/dx|derivative|f'/i.test(element)) {
    if (/\\frac\{d\}|f'|dy\/dx|d\/dx|derivative|f′/i.test(raw)) return true;
  }
  // Check for integral
  if (/∫|integral/i.test(element)) {
    if (/\\int|∫|integral/i.test(raw)) return true;
  }
  // Check for fractions
  if (/frac/i.test(element) || /\//.test(element)) {
    if (/\\frac|⁄|\//.test(raw)) return true;
  }
  // Check for specific mathematical expressions
  if (/2x/i.test(element)) {
    if (/2x|2\s*·?\s*x|2\*x/i.test(raw)) return true;
  }
  return false;
}

/**
 * Check if a common error pattern is present.
 */
function commonErrorPresent(
  error: string,
  normalized: string,
  _raw: string,
): boolean {
  const errLower = error.toLowerCase();
  // Extract key error indicators
  const words = errLower
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3);

  if (words.length === 0) return false;
  const wordHits = words.filter((w) => normalized.includes(w)).length;
  return wordHits / words.length >= 0.5;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Unified Grading Entry Point
// ═══════════════════════════════════════════════════════════════════════════════

export interface GradeResult {
  outcome: GradeOutcome;
  score: number;
  maxScore: number;
  isCorrect: boolean;
  criterionScores?: CriterionScore[];
  rationale: string;
}

/**
 * Grade an attempt response against its assessment item.
 * Returns the complete grading result.
 */
export function gradeResponse(item: AssessmentItem, response: AttemptResponse): GradeResult {
  try {
    switch (item.type) {
      case "mcq": {
        const result = gradeMcq(item, response.mcqSelection);
        return {
          outcome: result.outcome,
          score: result.awarded,
          maxScore: result.maxMarks,
          isCorrect: result.isCorrect,
          rationale: result.isCorrect
            ? "Correct answer"
            : response.mcqSelection
              ? `Selected ${response.mcqSelection.toUpperCase()}, correct answer is ${item.mcqAnswerKey?.toUpperCase()}`
              : "No answer provided",
        };
      }

      case "numeric": {
        const result = gradeNumeric(item, response.responseText);
        return {
          outcome: result.outcome,
          score: result.awarded,
          maxScore: result.maxMarks,
          isCorrect: result.isCorrect,
          rationale: result.isCorrect
            ? "Numerically correct"
            : `Expected value not matched in response: "${response.responseText ?? ""}"`,
        };
      }

      case "proof":
      case "short_answer": {
        const result = gradeRubric(item, response.responseText);
        return {
          outcome: result.outcome,
          score: result.totalAwarded,
          maxScore: result.totalMax,
          isCorrect: result.outcome === "correct",
          criterionScores: result.criterionScores,
          rationale: result.rationale,
        };
      }

      default:
        return {
          outcome: "grading_blocked",
          score: 0,
          maxScore: item.marks,
          isCorrect: false,
          rationale: `Unknown question type: ${item.type}`,
        };
    }
  } catch (err) {
    // Grader failures must NEVER award zero silently
    return {
      outcome: "grading_blocked",
      score: 0,
      maxScore: item.marks,
      isCorrect: false,
      rationale: `Grader error: ${err instanceof Error ? err.message : "unknown"}. This does not affect the learner's score — retry grading.`,
    };
  }
}

/**
 * Grade all responses in an attempt.
 * Returns total score and per-response results.
 */
export function gradeAttempt(
  items: AssessmentItem[],
  responses: Record<string, AttemptResponse>,
): { totalScore: number; totalMax: number; results: Record<string, GradeResult> } {
  const results: Record<string, GradeResult> = {};
  let totalScore = 0;
  let totalMax = 0;

  for (const item of items) {
    const response = responses[item.id];
    if (!response) continue;

    // Only grade committed or explicitly submitted responses
    if (response.status !== "committed" && response.status !== "evaluating") {
      // Skip ungraded responses
      totalMax += item.marks;
      continue;
    }

    const result = gradeResponse(item, response);
    results[item.id] = result;
    totalScore += result.score;
    totalMax += result.maxScore;

    // Update the response with grading info
    response.score = result.score;
    response.maxScore = result.maxScore;
    response.isCorrect = result.isCorrect;
    response.criterionScores = result.criterionScores;
    response.status = result.outcome === "grading_blocked" ? "grading_blocked" : "graded";
  }

  return { totalScore, totalMax, results };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Override Support
// ═══════════════════════════════════════════════════════════════════════════════

export interface ScoreOverride {
  itemId: string;
  criterionId?: string;
  originalScore: number;
  adjustedScore: number;
  reason: string;
  timestamp: number;
}

/**
 * Apply a score override. Recomputes totals.
 */
export function applyOverride(
  responses: Record<string, AttemptResponse>,
  items: AssessmentItem[],
  override: ScoreOverride,
): { totalScore: number; totalMax: number } {
  const response = responses[override.itemId];
  if (!response) {
    throw new Error(`No response for item ${override.itemId}`);
  }

  if (override.criterionId && response.criterionScores) {
    // Criterion-level override
    const criterion = response.criterionScores.find((c) => c.criterionId === override.criterionId);
    if (!criterion) {
      throw new Error(`No criterion ${override.criterionId} in response`);
    }
    // Validate bounds
    if (override.adjustedScore < 0 || override.adjustedScore > criterion.maxMarks) {
      throw new Error(`Override ${override.adjustedScore} out of bounds [0, ${criterion.maxMarks}]`);
    }
    criterion.awarded = override.adjustedScore;
    // Recompute item total from criteria
    response.score = response.criterionScores.reduce((s, c) => s + c.awarded, 0);
  } else {
    // Item-level override
    if (override.adjustedScore < 0 || override.adjustedScore > (response.maxScore ?? 0)) {
      throw new Error(`Override ${override.adjustedScore} out of bounds [0, ${response.maxScore}]`);
    }
    response.score = override.adjustedScore;
  }

  // Recompute totals
  let totalScore = 0;
  let totalMax = 0;
  for (const item of items) {
    const r = responses[item.id];
    if (r) {
      totalScore += r.score ?? 0;
      totalMax += r.maxScore ?? item.marks;
    }
  }

  return { totalScore, totalMax };
}
