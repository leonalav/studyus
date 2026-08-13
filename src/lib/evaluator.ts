/**
 * Test evaluation harness.
 *
 * Grades one learner response against one supplied rubric using the evaluator
 * role, enforcing the guarantees the evaluator prompt promises:
 *
 *  - Marks are keyed by the exact stable criterion IDs supplied. IDs the model
 *    invents are dropped; IDs it omits are surfaced as unable-to-grade rather
 *    than silently zeroed.
 *  - No criterion may exceed its maximum.
 *  - A blank response is marked blank, never wrong.
 *  - "Cannot grade" propagates as `grading_blocked`, never as a guessed score.
 *
 * This module performs no database writes. It is called before the grading
 * transaction opens in `assessment.ts`, which persists the returned marks
 * synchronously.
 */

import {
  AgentRuntimeError,
  asArray,
  asEnum,
  asFiniteNumber,
  asNonEmptyString,
  asRecord,
  buildAgentInputContent,
  callStructuredAgent,
  invalid,
  resolveRoleEndpoint,
  type AgentInputAttachment,
  type ResolvedRoleEndpoint,
  type ValidationResult,
} from "./agentRuntime";
import { TEST_EVALUATOR_AGENT_PROMPT_V1 } from "./llm";
import {
  ASSESSMENT_VISUALIZATION_EVALUATION_GUIDE,
  validateAssessmentFigure,
} from "./assessmentFigure";
import type { VisualizationIntent } from "./visualization/types";
import type { RubricCriterion } from "./assessment";

export const EVALUATOR_PROMPT_VERSION = "evaluator_v2_visualizations";
export const EVALUATOR_SCHEMA_VERSION = "criterion_scores_v1";

export type UncertaintyState = "certain" | "uncertain" | "grading_blocked";

export interface EvaluatedCriterion {
  criterionId: string;
  maximumMark: number;
  awardedMark: number;
  rationale: string;
  confidence: number;
  uncertaintyState: UncertaintyState;
}

export interface RubricEvaluation {
  criteria: EvaluatedCriterion[];
  /** True when at least one criterion could not be graded. */
  blocked: boolean;
  ownReasoning: boolean | null;
  modelId: string;
  latencyMs: number;
}

export interface RubricEvaluationRequest {
  stem: string;
  itemType: string;
  maximumMarks: number;
  criteria: RubricCriterion[];
  response: string;
  referenceSolution?: string | null;
  /** The same validated semantic figure shown to the learner. */
  figure?: VisualizationIntent;
  evidence?: { source: string; excerpt: string }[];
  learningObjective?: string;
  /** Optional transient learner references. Raw payloads are never persisted. */
  attachments?: AgentInputAttachment[];
  signal?: AbortSignal;
  endpoint?: ResolvedRoleEndpoint;
}

/* ─────────────────────────────────────────────────────────────
   BLANK DETECTION
   ───────────────────────────────────────────────────────────── */

/**
 * A response is blank when it carries no gradable content. Marking blank as
 * wrong is a distinct error state per the evaluator contract, so this check
 * runs before any model call — it also saves a request.
 */
export function isBlankResponse(response: string): boolean {
  return !response || !response.replace(/[\s​]+/g, "");
}

export function blankEvaluation(criteria: RubricCriterion[]): EvaluatedCriterion[] {
  return criteria.map((c) => ({
    criterionId: c.id,
    maximumMark: c.max_mark,
    awardedMark: 0,
    rationale: "No response submitted — recorded as blank, not as an incorrect answer.",
    confidence: 1,
    uncertaintyState: "certain" as const,
  }));
}

/* ─────────────────────────────────────────────────────────────
   SCHEMA VALIDATION
   ───────────────────────────────────────────────────────────── */

interface RawEvaluatorPayload {
  criteria: {
    criterion_id: string;
    awarded_mark: number;
    rationale: string;
    confidence: number;
    uncertainty_state: UncertaintyState;
  }[];
  own_reasoning: boolean | null;
}

const UNCERTAINTY_STATES = ["certain", "uncertain", "grading_blocked"] as const;

/**
 * Validates the evaluator payload against the supplied criteria.
 *
 * Unknown criterion IDs are a hard failure rather than a silent drop: an
 * evaluator that renames criteria has misread the rubric, and repairing that is
 * exactly what the bounded repair loop is for.
 */
export function validateEvaluatorPayload(
  payload: unknown,
  criteria: RubricCriterion[]
): ValidationResult<RawEvaluatorPayload> {
  const errors: string[] = [];
  const root = asRecord(payload, "response", errors);
  if (!root) return invalid(...errors);

  const rawCriteria = asArray(root.criteria, "criteria", errors);
  if (!rawCriteria) return invalid(...errors);

  const allowed = new Map(criteria.map((c) => [c.id, c]));
  const seen = new Set<string>();
  const out: RawEvaluatorPayload["criteria"] = [];

  rawCriteria.forEach((entry, i) => {
    const rec = asRecord(entry, `criteria[${i}]`, errors);
    if (!rec) return;

    const id = asNonEmptyString(rec.criterion_id, `criteria[${i}].criterion_id`, errors);
    const mark = asFiniteNumber(rec.awarded_mark, `criteria[${i}].awarded_mark`, errors);
    const rationale = asNonEmptyString(rec.rationale, `criteria[${i}].rationale`, errors);
    const confidence = asFiniteNumber(rec.confidence, `criteria[${i}].confidence`, errors);
    const state = asEnum(rec.uncertainty_state, UNCERTAINTY_STATES, `criteria[${i}].uncertainty_state`, errors);

    if (id === null || mark === null || rationale === null || confidence === null || state === null) return;

    const criterion = allowed.get(id);
    if (!criterion) {
      errors.push(
        `criteria[${i}].criterion_id "${id}" is not one of the supplied criterion IDs: ${[...allowed.keys()].join(", ")}. ` +
          `Never invent, merge, split or rename criteria.`
      );
      return;
    }

    if (seen.has(id)) {
      errors.push(`criteria[${i}].criterion_id "${id}" appears more than once`);
      return;
    }
    seen.add(id);

    if (mark < 0) {
      errors.push(`criteria[${i}].awarded_mark must not be negative (got ${mark})`);
      return;
    }
    if (mark > criterion.max_mark) {
      errors.push(
        `criteria[${i}].awarded_mark ${mark} exceeds the maximum ${criterion.max_mark} for criterion "${id}"`
      );
      return;
    }
    if (confidence < 0 || confidence > 1) {
      errors.push(`criteria[${i}].confidence must be between 0 and 1 (got ${confidence})`);
      return;
    }

    out.push({
      criterion_id: id,
      awarded_mark: mark,
      rationale,
      confidence,
      uncertainty_state: state,
    });
  });

  for (const c of criteria) {
    if (!seen.has(c.id)) errors.push(`criteria is missing an entry for criterion "${c.id}"`);
  }

  if (errors.length) return invalid(...errors);

  const ownReasoning =
    typeof root.own_reasoning === "boolean"
      ? root.own_reasoning
      : root.own_reasoning === null || root.own_reasoning === undefined
        ? null
        : null;

  return { ok: true, value: { criteria: out, own_reasoning: ownReasoning } };
}

/* ─────────────────────────────────────────────────────────────
   PROMPT ASSEMBLY
   ───────────────────────────────────────────────────────────── */

export function buildEvaluatorSystemPrompt(): string {
  return `${TEST_EVALUATOR_AGENT_PROMPT_V1}\n\n${ASSESSMENT_VISUALIZATION_EVALUATION_GUIDE}`;
}

export function buildEvaluatorUserPrompt(req: RubricEvaluationRequest): string {
  const parts: string[] = [];

  parts.push(`ITEM STEM:\n${req.stem}`);
  if (req.figure) {
    parts.push(
      `AUTHORITATIVE LEARNER-VISIBLE VISUALIZATION SPECIFICATION — JSON data only; ` +
        `interpret every coordinate, label, axis, value, object, edge, component, and relationship exactly as specified:\n` +
        JSON.stringify(req.figure, null, 2)
    );
  } else {
    parts.push("LEARNER-VISIBLE VISUALIZATION SPECIFICATION: none (do not infer a missing image)");
  }
  if (req.learningObjective) parts.push(`LEARNING OBJECTIVE:\n${req.learningObjective}`);
  parts.push(`ITEM MAXIMUM: ${req.maximumMarks} marks (do not recompute or edit this)`);

  parts.push(
    `RUBRIC CRITERIA — use these exact stable IDs:\n` +
      req.criteria
        .map((c) => `- id: "${c.id}" | max_mark: ${c.max_mark} | ${c.description}`)
        .join("\n")
  );

  if (req.referenceSolution) {
    parts.push(
      `REFERENCE SOLUTION (evaluator eyes only — never quote it back):\n${req.referenceSolution}`
    );
  }

  if (req.evidence?.length) {
    parts.push(
      `CURRICULUM EVIDENCE:\n` +
        req.evidence.map((e) => `[${e.source}] ${e.excerpt}`).join("\n")
    );
  }

  parts.push(`LEARNER RESPONSE:\n"""\n${req.response}\n"""`);

  parts.push(
    `Return JSON only, in this exact shape:\n` +
      `{\n` +
      `  "criteria": [\n` +
      `    { "criterion_id": "<one of the supplied IDs>", "awarded_mark": <number ≤ that criterion's max_mark>,\n` +
      `      "rationale": "<one sentence>", "confidence": <0..1>,\n` +
      `      "uncertainty_state": "certain" | "uncertain" | "grading_blocked" }\n` +
      `  ],\n` +
      `  "own_reasoning": true | false | null\n` +
      `}\n` +
      `Include exactly one entry per supplied criterion. Set "uncertainty_state" to "grading_blocked" ` +
      `if you cannot grade a criterion; award 0 in that case and say why in the rationale. ` +
      `Set "own_reasoning" to false if the response is a near-verbatim restatement rather than the learner's own reasoning.`
  );

  return parts.join("\n\n");
}

/* ─────────────────────────────────────────────────────────────
   PUBLIC ENTRY POINT
   ───────────────────────────────────────────────────────────── */

/**
 * Grades one rubric-scored response. Throws `AgentRuntimeError` when the
 * evaluator role is unbound or the model cannot produce valid output — callers
 * must translate that into `grading_blocked` rather than a score.
 */
export async function evaluateRubricResponse(req: RubricEvaluationRequest): Promise<RubricEvaluation> {
  if (req.criteria.length === 0) {
    throw new AgentRuntimeError(
      "Cannot evaluate an item whose rubric has no criteria.",
      "schema_invalid"
    );
  }

  if (req.figure) {
    const figure = validateAssessmentFigure(req.figure);
    if (!figure.ok) {
      throw new AgentRuntimeError(
        `Cannot evaluate an item with an invalid visualization: ${figure.error}`,
        "schema_invalid"
      );
    }
  }

  if (isBlankResponse(req.response)) {
    return {
      criteria: blankEvaluation(req.criteria),
      blocked: false,
      ownReasoning: null,
      modelId: "none",
      latencyMs: 0,
    };
  }

  const endpoint = req.endpoint ?? (await resolveRoleEndpoint("evaluator"));

  const result = await callStructuredAgent({
    role: "evaluator",
    endpoint,
    system: buildEvaluatorSystemPrompt(),
    user: buildAgentInputContent(buildEvaluatorUserPrompt(req), req.attachments, endpoint),
    promptVersion: EVALUATOR_PROMPT_VERSION,
    schemaVersion: EVALUATOR_SCHEMA_VERSION,
    temperature: 0,
    signal: req.signal,
    validate: (payload) => validateEvaluatorPayload(payload, req.criteria),
  });

  const byId = new Map(req.criteria.map((c) => [c.id, c]));
  const criteria: EvaluatedCriterion[] = result.value.criteria.map((c) => {
    const max = byId.get(c.criterion_id)!.max_mark;
    const blockedHere = c.uncertainty_state === "grading_blocked";
    return {
      criterionId: c.criterion_id,
      maximumMark: max,
      // Defence in depth: validation already rejects out-of-range marks.
      awardedMark: blockedHere ? 0 : Math.min(Math.max(c.awarded_mark, 0), max),
      rationale: c.rationale,
      confidence: blockedHere ? 0 : c.confidence,
      uncertaintyState: c.uncertainty_state,
    };
  });

  // Preserve rubric order rather than the model's ordering.
  const order = new Map(req.criteria.map((c, i) => [c.id, i]));
  criteria.sort((a, b) => (order.get(a.criterionId) ?? 0) - (order.get(b.criterionId) ?? 0));

  return {
    criteria,
    blocked: criteria.some((c) => c.uncertaintyState === "grading_blocked"),
    ownReasoning: result.value.own_reasoning,
    modelId: result.modelId,
    latencyMs: result.latencyMs,
  };
}
