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
  callStructuredAgent,
  invalid,
  resolveRoleEndpoint,
  type ValidationResult,
} from "./agentRuntime";
import { TEST_GENERATION_AGENT_PROMPT_V1 } from "./llm";
import { getEvidenceForSelectedNodes, simpleHash, type CurriculumChunkRecord } from "./curriculum";

export const GENERATION_PROMPT_VERSION = "generation_v1";
export const GENERATION_SCHEMA_VERSION = "assessment_items_v1";
export const GENERATION_VERSION = "2.0.0";

export type GeneratedItemType = "mcq" | "numeric" | "proof";
export type QuestionFormatRequest = "mcq" | "proof" | "mixed";
export type RigorLevel = "casual" | "challenging" | "rigorous";

const ITEM_TYPES = ["mcq", "numeric", "proof"] as const;
const BLOOM_TARGETS = ["remember", "understand", "apply", "analyze", "evaluate", "create"] as const;

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
  evidenceRefs: string[];
}

export interface GenerationRequest {
  subject: string;
  format: QuestionFormatRequest;
  count: number;
  rigor: RigorLevel;
  nodeIds: string[];
  sourceName?: string;
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

/* ─────────────────────────────────────────────────────────────
   SCHEMA VALIDATION
   ───────────────────────────────────────────────────────────── */

const MARK_EPSILON = 1e-6;

/**
 * Validates a generated item batch. Every rule the generation prompt states is
 * checked here, because an unchecked rule is an unenforced rule.
 */
export function validateGeneratedItems(
  payload: unknown,
  opts: { evidenceRefs: Set<string>; expectedCount: number; allowedNodes: Set<string> }
): ValidationResult<GeneratedItem[]> {
  const errors: string[] = [];
  const root = asRecord(payload, "response", errors);
  if (!root) return invalid(...errors);

  const rawItems = asArray(root.items, "items", errors);
  if (!rawItems) return invalid(...errors);

  if (rawItems.length !== opts.expectedCount) {
    errors.push(`items must contain exactly ${opts.expectedCount} entries (got ${rawItems.length})`);
  }

  const out: GeneratedItem[] = [];
  const seenStems = new Set<string>();

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
        if (typeof r !== "string" || !opts.evidenceRefs.has(r.trim())) {
          errors.push(
            `${path}.evidence_refs[${j}] must be one of the supplied evidence handles ` +
              `(${[...opts.evidenceRefs].join(", ")}); got ${JSON.stringify(r)}`
          );
        } else {
          refs.push(r.trim());
        }
      });
    }

    if (itemType === null || stem === null || maxMarks === null || bloom === null || objective === null || node === null) {
      return;
    }

    if (maxMarks <= 0) errors.push(`${path}.maximum_marks must be greater than 0`);

    if (!opts.allowedNodes.has(node)) {
      errors.push(
        `${path}.curriculum_node "${node}" is not one of the selected nodes: ${[...opts.allowedNodes].join(", ")}`
      );
    }

    const stemKey = stem.toLowerCase().replace(/\s+/g, " ");
    if (seenStems.has(stemKey)) errors.push(`${path}.stem duplicates an earlier item`);
    seenStems.add(stemKey);

    const item: GeneratedItem = {
      ordinal: i + 1,
      itemType,
      stem,
      maximumMarks: maxMarks,
      bloomTarget: bloom,
      learningObjective: objective,
      curriculumNode: node,
      evidenceRefs: refs,
    };

    if (itemType === "mcq") {
      const rawOptions = asArray(rec.options, `${path}.options`, errors);
      if (!rawOptions) return;
      if (rawOptions.length < 3 || rawOptions.length > 6) {
        errors.push(`${path}.options must contain between 3 and 6 options`);
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
        accepted.push({
          value,
          absolute_tolerance:
            aRec.absolute_tolerance !== undefined && aRec.absolute_tolerance !== null
              ? String(aRec.absolute_tolerance)
              : "0",
          relative_tolerance:
            aRec.relative_tolerance !== undefined && aRec.relative_tolerance !== null
              ? String(aRec.relative_tolerance)
              : "0",
        });
      });

      item.numericAccepted = accepted;
      item.numericUnit = typeof rec.unit === "string" && rec.unit.trim() ? rec.unit.trim() : null;
    } else {
      // Open response: rubric required, answer key forbidden.
      const rawCriteria = asArray(rec.criteria, `${path}.criteria`, errors);
      if (!rawCriteria) return;
      if (rawCriteria.length === 0) errors.push(`${path}.criteria must contain at least one criterion`);

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
      item.referenceSolution =
        typeof rec.reference_solution === "string" && rec.reference_solution.trim()
          ? rec.reference_solution.trim()
          : null;
      item.responseRequirement =
        typeof rec.response_requirement === "string" && rec.response_requirement.trim()
          ? rec.response_requirement.trim()
          : null;
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
  casual: "Target recall and single-step application. Bloom levels: remember, understand, apply.",
  challenging: "Target multi-step application and analysis. Bloom levels: apply, analyze.",
  rigorous:
    "Target analysis, evaluation and synthesis. Multi-step reasoning with non-obvious traps. Bloom levels: analyze, evaluate, create.",
};

function formatGuidance(format: QuestionFormatRequest, count: number): string {
  if (format === "mcq") {
    return `Emit ${count} items. Use "mcq" for conceptual questions and "numeric" for calculations. Do not emit "proof" items.`;
  }
  if (format === "proof") {
    return `Emit ${count} items, all of item_type "proof" (derivation, explanation or design). Each carries an analytic rubric and no answer key.`;
  }
  const openCount = Math.floor(count / 2);
  return `Emit ${count} items: ${count - openCount} of type "mcq" or "numeric", and ${openCount} of type "proof".`;
}

export function buildGenerationUserPrompt(req: GenerationRequest, cards: EvidenceCard[]): string {
  const parts: string[] = [];

  parts.push(`SUBJECT: ${req.subject}`);
  if (req.sourceName) parts.push(`SOURCE DOCUMENT: ${req.sourceName}`);
  parts.push(`RIGOR: ${req.rigor} — ${RIGOR_GUIDANCE[req.rigor]}`);
  parts.push(formatGuidance(req.format, req.count));

  parts.push(
    `CURRICULUM EVIDENCE — cite these handles and no others:\n` +
      cards
        .map(
          (c) =>
            `[${c.ref}] node=${c.nodeId} section=${c.sectionNumber ?? "—"} page=${c.page} title="${c.nodeTitle}"\n` +
            `      ${c.text}`
        )
        .join("\n")
  );

  parts.push(
    `ALLOWED curriculum_node values (use the node id exactly): ${[...new Set(cards.map((c) => c.nodeId))].join(", ")}`
  );

  parts.push(
    `Return JSON only:\n` +
      `{\n` +
      `  "items": [\n` +
      `    {\n` +
      `      "item_type": "mcq" | "numeric" | "proof",\n` +
      `      "stem": "<the question as the learner sees it>",\n` +
      `      "maximum_marks": <number > 0>,\n` +
      `      "bloom_target": "remember"|"understand"|"apply"|"analyze"|"evaluate"|"create",\n` +
      `      "learning_objective": "<short objective>",\n` +
      `      "curriculum_node": "<one of the allowed node ids>",\n` +
      `      "evidence_refs": ["E1", ...],\n` +
      `\n` +
      `      // item_type "mcq" only:\n` +
      `      "options": [{ "id": "a", "text": "<option text>", "correct": true|false,\n` +
      `                    "misconception": "<why a learner picks this>" /* required when correct is false, null when true */ }],\n` +
      `\n` +
      `      // item_type "numeric" only:\n` +
      `      "accepted": [{ "value": "<number or a/b>", "absolute_tolerance": "<number>", "relative_tolerance": "<number>" }],\n` +
      `      "unit": "<unit or null>",\n` +
      `\n` +
      `      // item_type "proof" only:\n` +
      `      "criteria": [{ "id": "c1", "description": "<observable requirement>", "max_mark": <number> }],\n` +
      `      "reference_solution": "<full solution, never shown to the learner>",\n` +
      `      "response_requirement": "<one line telling the learner what the response must contain>"\n` +
      `    }\n` +
      `  ]\n` +
      `}\n\n` +
      `HARD RULES:\n` +
      `- Criterion max_mark values must sum EXACTLY to that item's maximum_marks.\n` +
      `- Exactly one mcq option may have "correct": true.\n` +
      `- Never write the option letter inside option text (no "... (b)" suffixes).\n` +
      `- "proof" items must NOT contain "options", "accepted" or "answer_key".\n` +
      `- Every item must cite at least one evidence handle from the list above.`
  );

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
  let evidenceCitations = 0;

  db.run("BEGIN TRANSACTION;");
  try {
    db.run(
      `INSERT INTO assessment_forms (id, title, subject, format, config_json, mode, curriculum_scope, generation_version, validation_status, feedback_policy, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'FORMATIVE', ?, ?, 'validated', 'immediate_criterion', ?, ?);`,
      [
        formId,
        title,
        req.subject,
        req.format,
        JSON.stringify({ count: req.count, rigor: req.rigor, nodeIds: req.nodeIds, sourceName: req.sourceName ?? null }),
        req.nodeIds.join(","),
        GENERATION_VERSION,
        now,
        now,
      ]
    );

    for (const item of items) {
      const itemId = `item-${stamp}-${item.ordinal}`;

      db.run(
        `INSERT INTO assessment_items (id, form_id, stable_ordinal, stem, item_type, maximum_marks, bloom_target, learning_objective, curriculum_node, answer_spec_json, provenance, generation_version)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'agent_generated', ?);`,
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

    db.run(
      `INSERT INTO assessment_attempts (id, form_id, learner_id, status, mode, assistance_policy, started_at, deadline_at, submitted_at, completed_at, current_ordinal, aggregate_score, grading_status, audit_created_at, audit_updated_at)
       VALUES (?, ?, 'default_learner', 'active', 'FORMATIVE', 'progressive_hints', ?, NULL, NULL, NULL, 1, 0, 'unseen', ?, ?);`,
      [attemptId, formId, now, now, now]
    );

    db.run("COMMIT;");
  } catch (err) {
    db.run("ROLLBACK;");
    throw err;
  }

  saveDbSync();
  return { formId, attemptId, evidenceCitations };
}

/* ─────────────────────────────────────────────────────────────
   PUBLIC ENTRY POINT
   ───────────────────────────────────────────────────────────── */

export async function generateAssessment(req: GenerationRequest): Promise<GenerationResult> {
  const report = (pct: number, stage: string) => req.onProgress?.(pct, stage);
  if (req.nodeIds.length === 0) {
    throw new AgentRuntimeError(
      "Select at least one curriculum section before generating a test.",
      "schema_invalid"
    );
  }
  const count = Math.max(1, Math.min(30, Math.round(req.count)));

  report(5, "Fetching curriculum evidence…");
  const { nodes, chunks } = await getEvidenceForSelectedNodes(req.nodeIds);
  if (chunks.length === 0) {
    throw new AgentRuntimeError(
      "The selected sections contain no extracted text, so no evidence-grounded items can be generated. Re-import the source document.",
      "schema_invalid"
    );
  }

  const cards = buildEvidenceCards(nodes, chunks);
  const endpoint = await resolveRoleEndpoint("generation");

  // The structured agent call is the long pole — it owns the widest band
  // (10%→90%). Validation + persistence fill the final 90%→100%.
  report(10, "Generating grounded questions…");
  const result = await callStructuredAgent({
    role: "generation",
    endpoint,
    system: TEST_GENERATION_AGENT_PROMPT_V1,
    user: buildGenerationUserPrompt({ ...req, count }, cards),
    promptVersion: GENERATION_PROMPT_VERSION,
    schemaVersion: GENERATION_SCHEMA_VERSION,
    temperature: 0.4,
    signal: req.signal,
    validate: (payload) =>
      validateGeneratedItems(payload, {
        evidenceRefs: new Set(cards.map((c) => c.ref)),
        expectedCount: count,
        allowedNodes: new Set(cards.map((c) => c.nodeId)),
      }),
  });

  report(90, "Validating against evidence…");
  const scopeLabel = nodes.length === 1 ? nodes[0].title : `${nodes.length} sections`;
  const title = `${req.subject} · ${scopeLabel}`;

  const db = await getDb();
  report(95, "Saving the test…");
  const persisted = persistGeneratedForm({ db, req: { ...req, count }, items: result.value, cards, title });
  report(100, "Ready");

  return {
    formId: persisted.formId,
    attemptId: persisted.attemptId,
    title,
    itemCount: result.value.length,
    modelId: result.modelId,
    latencyMs: result.latencyMs,
    repaired: result.repaired,
    evidenceCitations: persisted.evidenceCitations,
  };
}

/* Re-exported so callers can hash excerpt text consistently. */
export { simpleHash };
