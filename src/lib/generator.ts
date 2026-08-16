/**
 * Test generation harness.
 *
 * Produces assessment items from supplied curriculum evidence and persists them
 * as a real form + items + evidence rows, then opens a fresh attempt.
 *
 * Invariants enforced here rather than trusted from the model:
 *  - Every item cites at least one supplied evidence excerpt, and every cited
 *    excerpt must exist in the supplied set (no fabricated citations).
 *  - Rubric criteria maxima sum exactly to the item maximum.
 *  - MCQ items carry a predetermined answer key plus a misconception per
 *    distractor; the key never reaches the learner DTO.
 *  - Numeric items carry a typed answer spec with tolerances.
 *  - Open items (proof/derivation/explanation/design) carry NO answer key.
 */

import { getDb, saveDbSync } from "../db/database";
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
  type ValidationResult,
} from "./agentRuntime";
import { TEST_GENERATION_AGENT_PROMPT_V1 } from "./llm";
import {
  ASSESSMENT_VISUALIZATION_AUTHORING_GUIDE,
  stemReferencesAssessmentFigure,
  validateAssessmentFigure,
} from "./assessmentFigure";
import type { VisualizationIntent } from "./visualization/types";
import {
  ensureTextEvidenceForSelectedNodes,
  getEvidenceForSelectedNodes,
  simpleHash,
  type CurriculumChunkRecord,
} from "./curriculum";
import { maxQuestions, minQuestions } from "../data/curriculum";

export const GENERATION_PROMPT_VERSION = "generation_v3_visualizations";
export const GENERATION_SCHEMA_VERSION = "assessment_items_v3_visualizations";
export const GENERATION_VERSION = "4.0.0";

export type GeneratedItemType = "mcq" | "numeric" | "proof";
export type QuestionFormatRequest = "mcq" | "proof" | "mixed";
export type RigorLevel = "casual" | "challenging" | "rigorous";
export type BloomTarget = "remember" | "understand" | "apply" | "analyze" | "evaluate" | "create";
export type AssistancePolicy = "full_hints" | "limited_hints" | "no_hints";

const ITEM_TYPES = ["mcq", "numeric", "proof"] as const;
const QUESTION_FORMATS = ["mcq", "proof", "mixed"] as const;
const RIGOR_LEVELS = ["casual", "challenging", "rigorous"] as const;
import { linkObjectiveToCurriculumNode } from "./learning/skillGraph";
import { normalizeSkillId } from "./learning/store";

const BLOOM_TARGETS = ["remember", "understand", "apply", "analyze", "evaluate", "create"] as const;
const GENERATION_BATCH_SIZE = 6;

export interface DifficultyProfile {
  label: string;
  description: string;
  allowedBloomTargets: readonly BloomTarget[];
  bloomByType: Record<GeneratedItemType, readonly BloomTarget[]>;
  maximumMarks: Record<GeneratedItemType, number>;
  mcqOptionCount: number;
  proofCriterionCount: number;
  assistancePolicy: AssistancePolicy;
  feedbackPolicy: string;
  temperature: number;
}

/**
 * Difficulty is an executable contract, not prompt decoration. The same profile
 * drives the item blueprint, semantic validator, persisted assistance policy,
 * and the test-taking UI.
 */
export const DIFFICULTY_PROFILES: Record<RigorLevel, DifficultyProfile> = {
  casual: {
    label: "Casual",
    description: "Direct recall and single-step application with full objective hints.",
    allowedBloomTargets: ["remember", "understand", "apply"],
    bloomByType: {
      mcq: ["remember", "understand", "apply"],
      numeric: ["apply"],
      proof: ["understand", "apply"],
    },
    maximumMarks: { mcq: 1, numeric: 2, proof: 3 },
    mcqOptionCount: 3,
    proofCriterionCount: 2,
    assistancePolicy: "full_hints",
    feedbackPolicy: "immediate_criterion",
    temperature: 0.35,
  },
  challenging: {
    label: "Challenging",
    description: "Multi-step application and analysis with a limited hint budget.",
    allowedBloomTargets: ["apply", "analyze"],
    bloomByType: {
      mcq: ["apply", "analyze"],
      numeric: ["apply", "analyze"],
      proof: ["analyze", "apply"],
    },
    maximumMarks: { mcq: 2, numeric: 4, proof: 6 },
    mcqOptionCount: 4,
    proofCriterionCount: 3,
    assistancePolicy: "limited_hints",
    feedbackPolicy: "on_submission",
    temperature: 0.25,
  },
  rigorous: {
    label: "Rigorous",
    description: "Analysis, evaluation, and synthesis with strict rubrics and no hints.",
    allowedBloomTargets: ["analyze", "evaluate", "create"],
    bloomByType: {
      mcq: ["analyze", "evaluate"],
      numeric: ["analyze", "evaluate"],
      proof: ["evaluate", "create", "analyze"],
    },
    maximumMarks: { mcq: 3, numeric: 6, proof: 10 },
    mcqOptionCount: 5,
    proofCriterionCount: 4,
    assistancePolicy: "no_hints",
    feedbackPolicy: "after_completion",
    temperature: 0.15,
  },
};

export interface GeneratedOption {
  id: string;
  text: string;
  correct: boolean;
  misconception: string | null;
}

export interface GeneratedCriterion {
  id: string;
  description: string;
  max_mark: number;
}

export interface GeneratedItem {
  ordinal: number;
  itemType: GeneratedItemType;
  stem: string;
  maximumMarks: number;
  bloomTarget: string;
  learningObjective: string;
  curriculumNode: string;
  options?: GeneratedOption[];
  numericAccepted?: { value: string; absolute_tolerance?: string; relative_tolerance?: string }[];
  numericUnit?: string | null;
  criteria?: GeneratedCriterion[];
  referenceSolution?: string | null;
  responseRequirement?: string | null;
  /** Optional validated semantic figure rendered with the chalkboard toolset. */
  figure?: VisualizationIntent;
  evidenceRefs: string[];
}

export interface GenerationRequest {
  subject: string;
  format: QuestionFormatRequest;
  count: number;
  rigor: RigorLevel;
  nodeIds: string[];
  sourceName?: string;
  /** Optional transient learner references. Raw payloads are never persisted. */
  attachments?: AgentInputAttachment[];
  signal?: AbortSignal;
  /** Optional progress callback driving a dedicated progress bar in the Take a
   *  test menu. Each stage of real generation reports a 0–100 estimate and a
   *  human label; the longest stage (the structured agent call) occupies the
   *  widest band. No synthetic animation — the bar only advances on real work. */
  onProgress?: (pct: number, stage: string) => void;
}

export interface GenerationResult {
  formId: string;
  attemptId: string;
  title: string;
  itemCount: number;
  modelId: string;
  latencyMs: number;
  repaired: boolean;
  evidenceCitations: number;
}

/* ─────────────────────────────────────────────────────────────
   EVIDENCE PACKAGING
   ───────────────────────────────────────────────────────────── */

export interface EvidenceCard {
  ref: string;
  nodeId: string;
  nodeTitle: string;
  sectionNumber: string | null;
  page: number;
  excerptHash: string;
  text: string;
}

/**
 * Builds stable, model-facing citation handles (E1, E2, …) for each chunk so
 * that citations can be verified against the supplied set exactly.
 */
export function buildEvidenceCards(
  nodes: { id: string; title: string; sectionNumber: string | null }[],
  chunks: CurriculumChunkRecord[]
): EvidenceCard[] {
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  return chunks.map((c, i) => {
    const node = nodeById.get(c.nodeId);
    return {
      ref: `E${i + 1}`,
      nodeId: c.nodeId,
      nodeTitle: node?.title ?? c.nodeId,
      sectionNumber: node?.sectionNumber ?? null,
      page: c.page,
      excerptHash: c.excerptHash,
      text: c.textContent,
    };
  });
}

export interface ItemBlueprint {
  ordinal: number;
  itemType: GeneratedItemType;
  bloomTarget: BloomTarget;
  maximumMarks: number;
  curriculumNode: string;
  requiredEvidenceRef: string;
  mcqOptionCount?: number;
  proofCriterionCount?: number;
}

function requestError(message: string): never {
  throw new AgentRuntimeError(message, "schema_invalid");
}

/** Validate API input without silently clamping or changing the learner's test. */
export function normalizeGenerationRequest(req: GenerationRequest): GenerationRequest {
  const subject = typeof req.subject === "string" ? req.subject.trim() : "";
  if (!subject) requestError("Choose a subject before generating a test.");
  if (!(QUESTION_FORMATS as readonly unknown[]).includes(req.format)) {
    requestError(`Unsupported question format: ${String(req.format)}.`);
  }
  if (!(RIGOR_LEVELS as readonly unknown[]).includes(req.rigor)) {
    requestError(`Unsupported difficulty mode: ${String(req.rigor)}.`);
  }
  if (!Number.isInteger(req.count)) {
    requestError("Question count must be a whole number.");
  }

  const minimum = minQuestions(req.format);
  const maximum = maxQuestions(req.format);
  if (req.count < minimum || req.count > maximum) {
    requestError(
      `${req.format === "mixed" ? "Mixed" : req.format.toUpperCase()} tests require between ${minimum} and ${maximum} questions.`
    );
  }

  const nodeIds = Array.isArray(req.nodeIds)
    ? [...new Set(req.nodeIds.filter((id): id is string => typeof id === "string").map((id) => id.trim()).filter(Boolean))]
    : [];
  if (nodeIds.length === 0) {
    requestError("Select at least one curriculum section before generating a test.");
  }

  return {
    ...req,
    subject,
    count: req.count,
    nodeIds,
    sourceName: typeof req.sourceName === "string" && req.sourceName.trim() ? req.sourceName.trim() : undefined,
  };
}

function plannedItemTypes(format: QuestionFormatRequest, count: number): GeneratedItemType[] {
  if (format === "mcq") return Array.from({ length: count }, () => "mcq" as const);
  if (format === "proof") return Array.from({ length: count }, () => "proof" as const);
  const cycle: GeneratedItemType[] = ["mcq", "proof", "numeric"];
  return Array.from({ length: count }, (_, i) => cycle[i % cycle.length]);
}

/**
 * Construct a deterministic contract before asking the model to write prose.
 * This makes format, difficulty, marks, scope coverage, and evidence coverage
 * independently verifiable rather than relying on model interpretation.
 */
export function createAssessmentBlueprint(
  req: GenerationRequest,
  cards: EvidenceCard[]
): ItemBlueprint[] {
  const profile = DIFFICULTY_PROFILES[req.rigor];
  const cardsByNode = new Map<string, EvidenceCard[]>();
  for (const card of cards) {
    const nodeCards = cardsByNode.get(card.nodeId) ?? [];
    nodeCards.push(card);
    cardsByNode.set(card.nodeId, nodeCards);
  }
  const nodeIds = [...cardsByNode.keys()];
  if (nodeIds.length === 0) requestError("The selected curriculum scope has no usable evidence excerpts.");

  const perTypeIndex: Record<GeneratedItemType, number> = { mcq: 0, numeric: 0, proof: 0 };
  const perNodeIndex = new Map<string, number>();

  return plannedItemTypes(req.format, req.count).map((itemType, index) => {
    const nodeId = nodeIds[index % nodeIds.length];
    const nodeCards = cardsByNode.get(nodeId)!;
    const nodeUseIndex = perNodeIndex.get(nodeId) ?? 0;
    const requiredCard = nodeCards[nodeUseIndex % nodeCards.length];
    perNodeIndex.set(nodeId, nodeUseIndex + 1);

    const bloomSequence = profile.bloomByType[itemType];
    const typeIndex = perTypeIndex[itemType]++;
    const bloomTarget = bloomSequence[typeIndex % bloomSequence.length];

    return {
      ordinal: index + 1,
      itemType,
      bloomTarget,
      maximumMarks: profile.maximumMarks[itemType],
      curriculumNode: nodeId,
      requiredEvidenceRef: requiredCard.ref,
      ...(itemType === "mcq" ? { mcqOptionCount: profile.mcqOptionCount } : {}),
      ...(itemType === "proof" ? { proofCriterionCount: profile.proofCriterionCount } : {}),
    };
  });
}

/* ─────────────────────────────────────────────────────────────
   SCHEMA VALIDATION
   ───────────────────────────────────────────────────────────── */

const MARK_EPSILON = 1e-6;

/** Command verbs make the requested cognitive operation observable in the
 * learner-facing stem instead of trusting a model-provided Bloom label. */
export const BLOOM_STEM_COMMANDS: Record<BloomTarget, readonly string[]> = {
  remember: ["define", "identify", "name", "recall", "state", "list", "recognize"],
  understand: ["explain", "summarize", "describe", "classify", "compare", "interpret"],
  apply: ["apply", "calculate", "compute", "determine", "solve", "use"],
  analyze: ["analyze", "compare", "contrast", "differentiate", "examine", "infer", "derive"],
  evaluate: ["evaluate", "justify", "assess", "critique", "defend", "judge", "verify"],
  create: ["construct", "design", "develop", "formulate", "prove", "propose", "synthesize"],
};

function stemExpressesCognitiveDemand(stem: string, bloom: BloomTarget): boolean {
  const normalized = stem.toLowerCase();
  return BLOOM_STEM_COMMANDS[bloom].some((command) =>
    new RegExp(`\\b${command}\\b`, "i").test(normalized)
  );
}

/**
 * Validates a generated item batch. Every rule the generation prompt states is
 * checked here, because an unchecked rule is an unenforced rule.
 */
export function validateGeneratedItems(
  payload: unknown,
  opts: {
    blueprint: ItemBlueprint[];
    evidenceByRef: Map<string, EvidenceCard>;
    existingStemKeys?: Set<string>;
  }
): ValidationResult<GeneratedItem[]> {
  const errors: string[] = [];
  const root = asRecord(payload, "response", errors);
  if (!root) return invalid(...errors);

  const rawItems = asArray(root.items, "items", errors);
  if (!rawItems) return invalid(...errors);

  if (rawItems.length !== opts.blueprint.length) {
    errors.push(`items must contain exactly ${opts.blueprint.length} entries (got ${rawItems.length})`);
  }

  const out: GeneratedItem[] = [];
  const seenStems = new Set(opts.existingStemKeys ?? []);

  rawItems.forEach((entry, i) => {
    const path = `items[${i}]`;
    const rec = asRecord(entry, path, errors);
    if (!rec) return;

    const itemType = asEnum(rec.item_type, ITEM_TYPES, `${path}.item_type`, errors);
    const stem = asNonEmptyString(rec.stem, `${path}.stem`, errors);
    const maxMarks = asFiniteNumber(rec.maximum_marks, `${path}.maximum_marks`, errors);
    const bloom = asEnum(rec.bloom_target, BLOOM_TARGETS, `${path}.bloom_target`, errors);
    const objective = asNonEmptyString(rec.learning_objective, `${path}.learning_objective`, errors);
    const node = asNonEmptyString(rec.curriculum_node, `${path}.curriculum_node`, errors);

    const refsRaw = asArray(rec.evidence_refs, `${path}.evidence_refs`, errors);
    const refs: string[] = [];
    if (refsRaw) {
      if (refsRaw.length === 0) {
        errors.push(`${path}.evidence_refs must cite at least one supplied evidence excerpt`);
      }
      refsRaw.forEach((r, j) => {
        const ref = typeof r === "string" ? r.trim() : "";
        if (!ref || !opts.evidenceByRef.has(ref)) {
          errors.push(
            `${path}.evidence_refs[${j}] must be one of the supplied evidence handles ` +
              `(${[...opts.evidenceByRef.keys()].join(", ")}); got ${JSON.stringify(r)}`
          );
        } else {
          refs.push(ref);
        }
      });
    }

    if (itemType === null || stem === null || maxMarks === null || bloom === null || objective === null || node === null) {
      return;
    }

    if (maxMarks <= 0) errors.push(`${path}.maximum_marks must be greater than 0`);

    const plan = opts.blueprint[i];
    if (!plan) {
      errors.push(`${path} has no corresponding item blueprint`);
      return;
    }
    if (itemType !== plan.itemType) {
      errors.push(`${path}.item_type must be "${plan.itemType}" for requested format (got "${itemType}")`);
    }
    if (bloom !== plan.bloomTarget) {
      errors.push(`${path}.bloom_target must be "${plan.bloomTarget}" for this difficulty slot (got "${bloom}")`);
    }
    if (!stemExpressesCognitiveDemand(stem, plan.bloomTarget)) {
      errors.push(
        `${path}.stem must explicitly require ${plan.bloomTarget} thinking with one of these command verbs: ` +
          BLOOM_STEM_COMMANDS[plan.bloomTarget].join(", ")
      );
    }
    if (Math.abs(maxMarks - plan.maximumMarks) > MARK_EPSILON) {
      errors.push(
        `${path}.maximum_marks must be ${plan.maximumMarks} for this ${plan.itemType} difficulty slot (got ${maxMarks})`
      );
    }
    if (node !== plan.curriculumNode) {
      errors.push(`${path}.curriculum_node must be "${plan.curriculumNode}" for balanced scope coverage (got "${node}")`);
    }
    if (!refs.includes(plan.requiredEvidenceRef)) {
      errors.push(`${path}.evidence_refs must include assigned evidence handle "${plan.requiredEvidenceRef}"`);
    }
    refs.forEach((ref) => {
      const card = opts.evidenceByRef.get(ref);
      if (card && card.nodeId !== node) {
        errors.push(`${path}.evidence_refs includes ${ref} from node "${card.nodeId}", not item node "${node}"`);
      }
    });

    const stemKey = stem.toLowerCase().replace(/\s+/g, " ");
    if (seenStems.has(stemKey)) errors.push(`${path}.stem duplicates an earlier item`);
    seenStems.add(stemKey);

    const item: GeneratedItem = {
      ordinal: plan.ordinal,
      itemType,
      stem,
      maximumMarks: maxMarks,
      bloomTarget: bloom,
      learningObjective: objective,
      curriculumNode: node,
      evidenceRefs: refs,
    };

    if (rec.figure !== undefined && rec.figure !== null) {
      const figure = validateAssessmentFigure(rec.figure);
      if (!figure.ok) {
        errors.push(`${path}.figure is invalid: ${figure.error}`);
      } else {
        if (!stemReferencesAssessmentFigure(stem)) {
          errors.push(
            `${path}.stem must explicitly tell the learner to use the shown figure, graph, chart, equation, or diagram`
          );
        }
        item.figure = figure.value;
      }
    }

    if (itemType === "mcq") {
      const rawOptions = asArray(rec.options, `${path}.options`, errors);
      if (!rawOptions) return;
      if (plan.mcqOptionCount !== undefined && rawOptions.length !== plan.mcqOptionCount) {
        errors.push(
          `${path}.options must contain exactly ${plan.mcqOptionCount} options for this difficulty (got ${rawOptions.length})`
        );
      }

      const options: GeneratedOption[] = [];
      const seenIds = new Set<string>();

      rawOptions.forEach((o, j) => {
        const oRec = asRecord(o, `${path}.options[${j}]`, errors);
        if (!oRec) return;
        const id = asNonEmptyString(oRec.id, `${path}.options[${j}].id`, errors);
        const text = asNonEmptyString(oRec.text, `${path}.options[${j}].text`, errors);
        if (id === null || text === null) return;

        const normalizedId = id.toLowerCase();
        if (seenIds.has(normalizedId)) {
          errors.push(`${path}.options[${j}].id "${id}" is duplicated`);
          return;
        }
        seenIds.add(normalizedId);

        if (typeof oRec.correct !== "boolean") {
          errors.push(`${path}.options[${j}].correct must be a boolean`);
          return;
        }

        // The option letter must never appear inside the option text.
        if (/\(\s*[a-f]\s*\)\s*$/i.test(text)) {
          errors.push(
            `${path}.options[${j}].text must not embed the option letter (found a trailing "(x)" marker)`
          );
          return;
        }

        const misconception = oRec.correct
          ? null
          : asNonEmptyString(oRec.misconception, `${path}.options[${j}].misconception`, errors);

        if (!oRec.correct && misconception === null) return;

        options.push({ id: normalizedId, text, correct: oRec.correct, misconception });
      });

      const correctCount = options.filter((o) => o.correct).length;
      if (correctCount !== 1) {
        errors.push(`${path}.options must contain exactly one correct option (found ${correctCount})`);
      }

      item.options = options;
    } else if (itemType === "numeric") {
      const rawAccepted = asArray(rec.accepted, `${path}.accepted`, errors);
      if (!rawAccepted) return;
      if (rawAccepted.length === 0) errors.push(`${path}.accepted must contain at least one accepted value`);

      const accepted: GeneratedItem["numericAccepted"] = [];
      rawAccepted.forEach((a, j) => {
        const aRec = asRecord(a, `${path}.accepted[${j}]`, errors);
        if (!aRec) return;
        const value = asNonEmptyString(aRec.value, `${path}.accepted[${j}].value`, errors);
        if (value === null) return;
        if (!isFinite(Number(value)) && !/^-?\d+(\.\d+)?\s*\/\s*-?\d+(\.\d+)?$/.test(value)) {
          errors.push(`${path}.accepted[${j}].value must be a number or an "a/b" fraction (got "${value}")`);
          return;
        }
        const absoluteTolerance =
          aRec.absolute_tolerance !== undefined && aRec.absolute_tolerance !== null
            ? String(aRec.absolute_tolerance)
            : "0";
        const relativeTolerance =
          aRec.relative_tolerance !== undefined && aRec.relative_tolerance !== null
            ? String(aRec.relative_tolerance)
            : "0";
        if (!Number.isFinite(Number(absoluteTolerance)) || Number(absoluteTolerance) < 0) {
          errors.push(`${path}.accepted[${j}].absolute_tolerance must be a non-negative finite number`);
        }
        if (!Number.isFinite(Number(relativeTolerance)) || Number(relativeTolerance) < 0) {
          errors.push(`${path}.accepted[${j}].relative_tolerance must be a non-negative finite number`);
        }
        accepted.push({
          value,
          absolute_tolerance: absoluteTolerance,
          relative_tolerance: relativeTolerance,
        });
      });

      item.numericAccepted = accepted;
      item.numericUnit = typeof rec.unit === "string" && rec.unit.trim() ? rec.unit.trim() : null;
    } else {
      // Open response: rubric required, answer key forbidden.
      const rawCriteria = asArray(rec.criteria, `${path}.criteria`, errors);
      if (!rawCriteria) return;
      if (plan.proofCriterionCount !== undefined && rawCriteria.length !== plan.proofCriterionCount) {
        errors.push(
          `${path}.criteria must contain exactly ${plan.proofCriterionCount} criteria for this difficulty (got ${rawCriteria.length})`
        );
      }

      const criteria: GeneratedCriterion[] = [];
      const seenCritIds = new Set<string>();
      let sum = 0;

      rawCriteria.forEach((c, j) => {
        const cRec = asRecord(c, `${path}.criteria[${j}]`, errors);
        if (!cRec) return;
        const id = asNonEmptyString(cRec.id, `${path}.criteria[${j}].id`, errors);
        const description = asNonEmptyString(cRec.description, `${path}.criteria[${j}].description`, errors);
        const mark = asFiniteNumber(cRec.max_mark, `${path}.criteria[${j}].max_mark`, errors);
        if (id === null || description === null || mark === null) return;

        if (seenCritIds.has(id)) {
          errors.push(`${path}.criteria[${j}].id "${id}" is duplicated`);
          return;
        }
        seenCritIds.add(id);

        if (mark <= 0) {
          errors.push(`${path}.criteria[${j}].max_mark must be greater than 0`);
          return;
        }

        sum += mark;
        criteria.push({ id, description, max_mark: mark });
      });

      if (criteria.length > 0 && Math.abs(sum - maxMarks) > MARK_EPSILON) {
        errors.push(
          `${path}: criterion maxima sum to ${sum} but maximum_marks is ${maxMarks}; they must be equal`
        );
      }

      if (rec.accepted !== undefined || rec.answer_key !== undefined || rec.options !== undefined) {
        errors.push(`${path} must not include an answer key — open-response items are graded by rubric only`);
      }

      item.criteria = criteria;
      item.referenceSolution = asNonEmptyString(
        rec.reference_solution,
        `${path}.reference_solution`,
        errors
      );
      item.responseRequirement = asNonEmptyString(
        rec.response_requirement,
        `${path}.response_requirement`,
        errors
      );
    }

    out.push(item);
  });

  if (errors.length) return invalid(...errors);
  return { ok: true, value: out };
}

/* ─────────────────────────────────────────────────────────────
   PROMPT ASSEMBLY
   ───────────────────────────────────────────────────────────── */

const RIGOR_GUIDANCE: Record<RigorLevel, string> = {
  casual:
    "Use direct wording, familiar representations, and no more than one reasoning step. Avoid traps and unnecessary context.",
  challenging:
    "Require multi-step application or analysis. Distractors should encode plausible misconceptions, not superficial wording tricks.",
  rigorous:
    "Require transfer, non-obvious reasoning, evaluation, or synthesis. Use strict observable rubrics and plausible high-level distractors.",
};

export function buildGenerationUserPrompt(
  req: GenerationRequest,
  cards: EvidenceCard[],
  blueprint: ItemBlueprint[]
): string {
  const profile = DIFFICULTY_PROFILES[req.rigor];
  const parts: string[] = [];

  parts.push(`SUBJECT: ${req.subject}`);
  if (req.sourceName) parts.push(`SOURCE DOCUMENT: ${req.sourceName}`);
  parts.push(`DIFFICULTY CONTRACT: ${profile.label} — ${profile.description}\n${RIGOR_GUIDANCE[req.rigor]}`);
  parts.push(
    `ITEM BLUEPRINT — return exactly ${blueprint.length} items in this exact order:\n` +
      blueprint
        .map((slot) => {
          const structure =
            slot.itemType === "mcq"
              ? `options=${slot.mcqOptionCount}`
              : slot.itemType === "proof"
                ? `rubric_criteria=${slot.proofCriterionCount}`
                : "typed_numeric_answer=true";
          return (
            `${slot.ordinal}. item_type=${slot.itemType}; bloom_target=${slot.bloomTarget}; ` +
            `maximum_marks=${slot.maximumMarks}; curriculum_node=${slot.curriculumNode}; ` +
            `required_evidence=${slot.requiredEvidenceRef}; ${structure}; ` +
            `stem_command=${BLOOM_STEM_COMMANDS[slot.bloomTarget].join("/")}`
          );
        })
        .join("\n")
  );

  parts.push(
    `CURRICULUM EVIDENCE — use only these excerpts:\n` +
      cards
        .map(
          (c) =>
            `[${c.ref}] node=${c.nodeId} section=${c.sectionNumber ?? "—"} page=${c.page} title="${c.nodeTitle}"\n` +
            `      ${c.text.slice(0, 6000)}`
        )
        .join("\n")
  );

  parts.push(`Return one JSON object with an "items" array. Every item may include "figure": null | VisualizationIntent as defined by your assessment visualization tool guide. Use these type-specific shapes:
MCQ: {"item_type":"mcq","stem":"...","maximum_marks":1,"bloom_target":"remember","learning_objective":"...","curriculum_node":"node-id","evidence_refs":["E1"],"figure":null,"options":[{"id":"a","text":"...","correct":true,"misconception":null},{"id":"b","text":"...","correct":false,"misconception":"..."}]}
NUMERIC: {"item_type":"numeric","stem":"...","maximum_marks":2,"bloom_target":"apply","learning_objective":"...","curriculum_node":"node-id","evidence_refs":["E1"],"figure":null,"accepted":[{"value":"12.5","absolute_tolerance":"0.01","relative_tolerance":"0"}],"unit":null}
PROOF: {"item_type":"proof","stem":"...","maximum_marks":3,"bloom_target":"apply","learning_objective":"...","curriculum_node":"node-id","evidence_refs":["E1"],"figure":null,"criteria":[{"id":"c1","description":"observable requirement","max_mark":1}],"reference_solution":"full evaluator-only solution","response_requirement":"what the learner must show"}

HARD RULES:
- Match every blueprint field exactly; do not reorder, add, omit, or substitute item types.
- Each stem must explicitly use at least one of its slot's stem_command verbs so the required cognitive operation is learner-visible.
- Include each slot's required evidence handle, and cite evidence only from that item's curriculum node.
- Criterion max_mark values must sum exactly to maximum_marks and criterion IDs must be unique.
- MCQ option IDs must be unique; exactly one option is correct; every distractor has a specific misconception.
- Do not put option letters inside option text.
- Proof items contain no options, accepted values, or answer key.
- Use a figure when it materially tests a visual, spatial, structural, graphical, or data relationship supported by the evidence; otherwise use null. A figure-bearing stem must explicitly reference the visual.
- Cross-check every figure against the stem, every option/accepted value, the rubric, response requirement, and reference solution. Learner-visible figure text or styling must never identify or disclose the answer.
- Questions must be distinct and answerable using the cited evidence. Return JSON only.`);

  return parts.join("\n\n");
}

/* ─────────────────────────────────────────────────────────────
   PERSISTENCE
   ───────────────────────────────────────────────────────────── */

function toAnswerSpec(item: GeneratedItem): Record<string, unknown> {
  if (item.itemType === "mcq") {
    return {
      version: 1,
      type: "mcq",
      options: (item.options ?? []).map((o) => ({ id: o.id, text: o.text })),
      accepted: (item.options ?? []).filter((o) => o.correct).map((o) => ({ value: o.id })),
      distractor_misconceptions: (item.options ?? [])
        .filter((o) => !o.correct)
        .map((o) => ({ option_id: o.id, misconception: o.misconception })),
    };
  }
  if (item.itemType === "numeric") {
    return {
      version: 1,
      type: "numeric",
      accepted: item.numericAccepted ?? [],
      unit: item.numericUnit ?? null,
    };
  }
  return {
    version: 1,
    type: "rubric",
    criteria: item.criteria ?? [],
    reference_solution: item.referenceSolution ?? null,
    response_requirement: item.responseRequirement ?? null,
  };
}

/**
 * Writes the generated form, items, evidence and a fresh attempt in one
 * transaction. All statements are synchronous, so the transaction is safe.
 */
export function persistGeneratedForm({
  db,
  req,
  items,
  cards,
  title,
}: {
  db: any;
  req: GenerationRequest;
  items: GeneratedItem[];
  cards: EvidenceCard[];
  title: string;
}): { formId: string; attemptId: string; evidenceCitations: number } {
  const now = new Date().toISOString();
  const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const formId = `form-gen-${stamp}`;
  const attemptId = `attempt-gen-${stamp}`;
  const cardByRef = new Map(cards.map((c) => [c.ref, c]));
  const profile = DIFFICULTY_PROFILES[req.rigor];
  const figureJsonByOrdinal = new Map<number, string>();
  let evidenceCitations = 0;

  // Callers normally pass the output of validateGeneratedItems, but persistence
  // is a separate trust boundary: never write an unchecked figure even if this
  // function is called directly from another workflow.
  for (const item of items) {
    if (!item.figure) continue;
    const figure = validateAssessmentFigure(item.figure);
    if (!figure.ok) {
      throw new AgentRuntimeError(
        `Assessment item ${item.ordinal} has an invalid figure: ${figure.error}`,
        "schema_invalid"
      );
    }
    if (!stemReferencesAssessmentFigure(item.stem)) {
      throw new AgentRuntimeError(
        `Assessment item ${item.ordinal} has a figure but its stem does not reference it.`,
        "schema_invalid"
      );
    }
    figureJsonByOrdinal.set(item.ordinal, JSON.stringify(figure.value));
  }

  db.run("BEGIN TRANSACTION;");
  try {
    db.run(
      `INSERT INTO assessment_forms (id, title, subject, format, config_json, mode, curriculum_scope, generation_version, validation_status, feedback_policy, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'FORMATIVE', ?, ?, 'validated', ?, ?, ?);`,
      [
        formId,
        title,
        req.subject,
        req.format,
        JSON.stringify({
          count: req.count,
          rigor: req.rigor,
          nodeIds: req.nodeIds,
          sourceName: req.sourceName ?? null,
          assistancePolicy: profile.assistancePolicy,
          difficultyContractVersion: GENERATION_VERSION,
        }),
        req.nodeIds.join(","),
        GENERATION_VERSION,
        profile.feedbackPolicy,
        now,
        now,
      ]
    );

    for (const item of items) {
      const itemId = `item-${stamp}-${item.ordinal}`;

      db.run(
        `INSERT INTO assessment_items (id, form_id, stable_ordinal, stem, item_type, maximum_marks, bloom_target, learning_objective, curriculum_node, answer_spec_json, figure_spec_json, provenance, generation_version)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'agent_generated', ?);`,
        [
          itemId,
          formId,
          item.ordinal,
          item.stem,
          item.itemType,
          item.maximumMarks,
          item.bloomTarget,
          item.learningObjective,
          item.curriculumNode,
          JSON.stringify(toAnswerSpec(item)),
          figureJsonByOrdinal.get(item.ordinal) ?? null,
          GENERATION_VERSION,
        ]
      );

      item.evidenceRefs.forEach((ref, i) => {
        const card = cardByRef.get(ref);
        if (!card) return;
        db.run(
          `INSERT INTO item_evidence (id, item_id, source, syllabus_node, page_or_chunk, excerpt_hash, evidence_role)
           VALUES (?, ?, ?, ?, ?, ?, ?);`,
          [
            `ev-${itemId}-${i + 1}`,
            itemId,
            req.sourceName ?? card.nodeTitle,
            card.sectionNumber ?? card.nodeId,
            `p${card.page}`,
            card.excerptHash,
            i === 0 ? "primary" : "supporting",
          ]
        );
        evidenceCitations++;
      });
    }

    // Generation creates an available test, not an already-started attempt. The
    // attempt becomes active only when the learner explicitly presses Start.
    db.run(
      `INSERT INTO assessment_attempts (id, form_id, learner_id, status, mode, assistance_policy, started_at, deadline_at, submitted_at, completed_at, current_ordinal, aggregate_score, grading_status, audit_created_at, audit_updated_at)
       VALUES (?, ?, 'default_learner', 'created', 'FORMATIVE', ?, ?, NULL, NULL, NULL, 1, 0, 'unseen', ?, ?);`,
      [attemptId, formId, profile.assistancePolicy, now, now, now]
    );

    db.run("COMMIT;");
  } catch (err) {
    db.run("ROLLBACK;");
    throw err;
  }

  saveDbSync();
  return { formId, attemptId, evidenceCitations };
}

/**
 * Attach each item's learning objective to the curriculum node it was authored
 * against.
 *
 * Assessments name skills by objective while the skill graph is keyed on
 * curriculum nodes, so without this link the two are disconnected islands: a
 * repeated failure on "chain rule differentiation" would have no path to the
 * sections that come before it, and prerequisite repair would never fire for
 * exactly the learner who needs it most.
 *
 * Best-effort by design. An assessment the learner can actually sit is worth
 * more than a complete graph, and the graph converges on the next generation.
 */
async function linkGeneratedObjectivesToSkillGraph(items: GeneratedItem[]): Promise<void> {
  for (const item of items) {
    try {
      await linkObjectiveToCurriculumNode({
        skillId: normalizeSkillId(item.learningObjective),
        label: item.learningObjective,
        curriculumNodeId: item.curriculumNode,
      });
    } catch (error) {
      console.warn("[generator] could not link objective to the skill graph", error);
    }
  }
}

/* ─────────────────────────────────────────────────────────────
   PUBLIC ENTRY POINT
   ───────────────────────────────────────────────────────────── */

export async function generateAssessment(req: GenerationRequest): Promise<GenerationResult> {
  const normalized = normalizeGenerationRequest(req);
  const report = (pct: number, stage: string) => normalized.onProgress?.(pct, stage);

  report(5, "Fetching curriculum evidence…");
  let { nodes, chunks } = await getEvidenceForSelectedNodes(normalized.nodeIds);
  report(7, "Indexing selected curriculum text…");
  const extractedChunks = await ensureTextEvidenceForSelectedNodes(normalized.nodeIds);
  if (extractedChunks > 0) {
    ({ nodes, chunks } = await getEvidenceForSelectedNodes(normalized.nodeIds));
  }
  if (chunks.length === 0) {
    throw new AgentRuntimeError(
      "The selected sections contain no extracted text, so no evidence-grounded items can be generated. Open the selected curriculum section once to extract it, then try again.",
      "schema_invalid"
    );
  }

  const cards = buildEvidenceCards(nodes, chunks);
  const blueprint = createAssessmentBlueprint(normalized, cards);
  const endpoint = await resolveRoleEndpoint("generation");
  const profile = DIFFICULTY_PROFILES[normalized.rigor];
  const evidenceByRef = new Map(cards.map((card) => [card.ref, card]));
  const existingStemKeys = new Set<string>();
  const generatedItems: GeneratedItem[] = [];
  let totalLatencyMs = 0;
  let repaired = false;

  const batches: ItemBlueprint[][] = [];
  for (let i = 0; i < blueprint.length; i += GENERATION_BATCH_SIZE) {
    batches.push(blueprint.slice(i, i + GENERATION_BATCH_SIZE));
  }

  for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
    const batch = batches[batchIndex];
    const requiredRefs = new Set(batch.map((slot) => slot.requiredEvidenceRef));
    const batchCards = cards.filter((card) => requiredRefs.has(card.ref));
    const batchEvidenceByRef = new Map(batchCards.map((card) => [card.ref, card]));
    const startPct = 10 + Math.floor((batchIndex / batches.length) * 75);
    report(
      startPct,
      batches.length === 1
        ? `Generating ${profile.label.toLowerCase()} questions…`
        : `Generating question batch ${batchIndex + 1} of ${batches.length}…`
    );

    const result = await callStructuredAgent({
      role: "generation",
      endpoint,
      system: `${TEST_GENERATION_AGENT_PROMPT_V1}\n\n${ASSESSMENT_VISUALIZATION_AUTHORING_GUIDE}`,
      user: buildAgentInputContent(
        buildGenerationUserPrompt(normalized, batchCards, batch),
        normalized.attachments,
        endpoint
      ),
      promptVersion: GENERATION_PROMPT_VERSION,
      schemaVersion: GENERATION_SCHEMA_VERSION,
      temperature: profile.temperature,
      maxTokens: Math.min(16_000, Math.max(4_096, batch.length * 2_500)),
      signal: normalized.signal,
      validate: (payload) =>
        validateGeneratedItems(payload, {
          blueprint: batch,
          evidenceByRef: batchEvidenceByRef,
          existingStemKeys,
        }),
    });

    for (const item of result.value) {
      existingStemKeys.add(item.stem.toLowerCase().replace(/\s+/g, " "));
      generatedItems.push(item);
    }
    totalLatencyMs += result.latencyMs;
    repaired ||= result.repaired;
  }

  // Defensive aggregate checks before the transaction. Batch validation already
  // enforces each slot, but this catches accidental orchestration regressions.
  report(88, "Validating difficulty and scope contracts…");
  if (generatedItems.length !== normalized.count) {
    throw new AgentRuntimeError(
      `Generation produced ${generatedItems.length} items instead of the requested ${normalized.count}; nothing was saved.`,
      "schema_invalid"
    );
  }
  generatedItems.sort((a, b) => a.ordinal - b.ordinal);
  for (let i = 0; i < blueprint.length; i++) {
    const item = generatedItems[i];
    const slot = blueprint[i];
    if (!item || item.ordinal !== slot.ordinal || item.itemType !== slot.itemType || item.bloomTarget !== slot.bloomTarget) {
      throw new AgentRuntimeError(
        `Generated item ${i + 1} no longer matches its validated difficulty blueprint; nothing was saved.`,
        "schema_invalid"
      );
    }
    for (const ref of item.evidenceRefs) {
      if (!evidenceByRef.has(ref)) {
        throw new AgentRuntimeError(`Generated item ${i + 1} cites unknown evidence ${ref}; nothing was saved.`, "schema_invalid");
      }
    }
  }

  const requestedNodes = nodes.filter((node) => normalized.nodeIds.includes(node.id));
  const scopeLabel =
    requestedNodes.length === 1
      ? requestedNodes[0].title
      : `${normalized.nodeIds.length} selected section${normalized.nodeIds.length === 1 ? "" : "s"}`;
  const title = `${normalized.subject} · ${scopeLabel}`;

  const db = await getDb();
  report(95, "Saving the validated test…");
  const persisted = persistGeneratedForm({ db, req: normalized, items: generatedItems, cards, title });
  await linkGeneratedObjectivesToSkillGraph(generatedItems);
  report(100, "Ready");

  return {
    formId: persisted.formId,
    attemptId: persisted.attemptId,
    title,
    itemCount: generatedItems.length,
    modelId: endpoint.modelId,
    latencyMs: totalLatencyMs,
    repaired,
    evidenceCitations: persisted.evidenceCitations,
  };
}

/* Re-exported so callers can hash excerpt text consistently. */
export { simpleHash };
