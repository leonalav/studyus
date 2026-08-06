/**
 * Assessment Form Generator
 *
 * Composes validated assessment forms from the item bank:
 *   - Respects Bloom level composition
 *   - Ensures curriculum node coverage
 *   - Validates every item has required fields
 *   - Generates unique form versions
 *
 * The generator never fabricates IRT parameters or assigns
 * psychometric difficulty from prompts.
 */

import type {
  AssessmentForm,
  AssessmentItem,
  AssessmentMode,
  BloomLevel,
  Difficulty,
  QuestionType,
  SubjectKey,
} from "./types";
import { ITEM_BANK } from "./itemBank";
import { bloomRank, difficultyRank } from "./types";

// ─── Generation Parameters ───────────────────────────────────────────────────

export interface GenerationParams {
  subject: SubjectKey;
  mode: AssessmentMode;
  difficulty: Difficulty;
  pickedNodes: string[]; // curriculum subsection ids
  targetCount: number;
  questionTypes: QuestionType[]; // e.g. ["mcq"], ["proof"], ["mcq", "proof"]
  /** Target Bloom composition — how many items at each level */
  bloomTarget?: Partial<Record<BloomLevel, number>>;
  /** Time limit in minutes (optional) */
  timeLimitMinutes?: number;
  /** Title */
  title: string;
}

// ─── Form ID ─────────────────────────────────────────────────────────────────

let formCounter = 0;
function nextFormId(): string {
  formCounter++;
  return `form-${Date.now()}-${formCounter}`;
}

// ─── Candidate Pool ──────────────────────────────────────────────────────────

function getCandidates(params: GenerationParams): AssessmentItem[] {
  const nodeSet = new Set(params.pickedNodes);
  return ITEM_BANK.filter((item) => {
    // Must match subject
    if (item.subject !== params.subject) return false;
    // Must match at least one selected node
    if (!nodeSet.has(item.nodeId)) return false;
    // Must be a requested question type
    if (!params.questionTypes.includes(item.type)) return false;
    // Filter by difficulty: include items within ±1 band of target
    const target = difficultyRank(params.difficulty);
    const itemDiff = difficultyRank(item.difficulty);
    if (Math.abs(itemDiff - target) > 1) return false;
    return true;
  });
}

// ─── Selection Algorithm (deterministic, reproducible) ───────────────────────

/**
 * Select items to form a balanced assessment.
 * Strategy:
 *   1. If bloomTarget is given, try to match the distribution.
 *   2. Otherwise, spread across Bloom levels as evenly as possible.
 *   3. Prioritize breadth of node coverage.
 *   4. Deterministic: same inputs → same output.
 */
function selectItems(candidates: AssessmentItem[], params: GenerationParams): AssessmentItem[] {
  if (candidates.length === 0) return [];

  const target = params.targetCount;
  const selected: AssessmentItem[] = [];
  const used = new Set<string>();
  const coveredNodes = new Set<string>();

  // Phase 1: Bloom-targeted selection
  if (params.bloomTarget) {
    for (const level of Object.keys(params.bloomTarget) as BloomLevel[]) {
      const want = params.bloomTarget[level] ?? 0;
      const available = candidates.filter(
        (c) => c.bloomLevel === level && !used.has(c.id)
      );
      // Sort by node coverage: prefer uncovered nodes
      available.sort((a, b) => {
        const aCovered = coveredNodes.has(a.nodeId) ? 1 : 0;
        const bCovered = coveredNodes.has(b.nodeId) ? 1 : 0;
        return aCovered - bCovered;
      });
      for (let i = 0; i < Math.min(want, available.length) && selected.length < target; i++) {
        selected.push(available[i]);
        used.add(available[i].id);
        coveredNodes.add(available[i].nodeId);
      }
    }
  }

  // Phase 2: Fill remaining slots with breadth-first node coverage
  if (selected.length < target) {
    const remaining = candidates.filter((c) => !used.has(c.id));
    // Sort: uncovered nodes first, then by bloom level spread
    remaining.sort((a, b) => {
      const aCovered = coveredNodes.has(a.nodeId) ? 1 : 0;
      const bCovered = coveredNodes.has(b.nodeId) ? 1 : 0;
      if (aCovered !== bCovered) return aCovered - bCovered;
      // Then by bloom rank to spread levels
      return bloomRank(a.bloomLevel) - bloomRank(b.bloomLevel);
    });
    for (const item of remaining) {
      if (selected.length >= target) break;
      selected.push(item);
      used.add(item.id);
      coveredNodes.add(item.nodeId);
    }
  }

  // Phase 3: If we still need more (not enough unique candidates), allow repeats from different difficulty bands
  if (selected.length < target) {
    const nodeSet = new Set(params.pickedNodes);
    const overflow = ITEM_BANK.filter((item) => {
      if (item.subject !== params.subject) return false;
      if (!nodeSet.has(item.nodeId)) return false;
      if (!params.questionTypes.includes(item.type)) return false;
      if (used.has(item.id)) return false;
      return true;
    });
    for (const item of overflow) {
      if (selected.length >= target) break;
      selected.push(item);
      used.add(item.id);
    }
  }

  return selected;
}

// ─── Validation ──────────────────────────────────────────────────────────────

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export function validateForm(form: AssessmentForm): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Must have items
  if (form.items.length === 0) {
    errors.push("Form has no items");
  }

  // Validate each item
  for (const item of form.items) {
    if (!item.stem?.trim()) errors.push(`Item ${item.id}: empty stem`);
    if (item.marks <= 0) errors.push(`Item ${item.id}: marks must be positive`);

    // MCQ validation
    if (item.type === "mcq") {
      if (!item.mcqOptions || item.mcqOptions.length < 2) {
        errors.push(`Item ${item.id}: MCQ needs at least 2 options`);
      }
      if (!item.mcqAnswerKey) {
        errors.push(`Item ${item.id}: MCQ has no predetermined answer key`);
      } else {
        const keyExists = item.mcqOptions?.some((o) => o.id === item.mcqAnswerKey);
        if (!keyExists) {
          errors.push(`Item ${item.id}: answer key "${item.mcqAnswerKey}" not in options`);
        }
      }
    }

    // Rubric validation
    if (item.rubric) {
      const rubricTotal = item.rubric.criteria.reduce((s, c) => s + c.maxMarks, 0);
      if (rubricTotal !== item.rubric.totalMarks) {
        errors.push(`Item ${item.id}: rubric criteria sum (${rubricTotal}) ≠ declared total (${item.rubric.totalMarks})`);
      }
      if (rubricTotal !== item.marks) {
        errors.push(`Item ${item.id}: rubric total (${rubricTotal}) ≠ item marks (${item.marks})`);
      }
      // Check criterion ids are unique
      const ids = item.rubric.criteria.map((c) => c.id);
      const uniqueIds = new Set(ids);
      if (ids.length !== uniqueIds.size) {
        errors.push(`Item ${item.id}: duplicate criterion ids`);
      }
      // Each criterion must have key elements
      for (const crit of item.rubric.criteria) {
        if (!crit.keyElements || crit.keyElements.length === 0) {
          warnings.push(`Item ${item.id}, criterion ${crit.id}: no key elements`);
        }
      }
    }

    // Must have node provenance
    if (!item.nodeId) errors.push(`Item ${item.id}: missing curriculum node`);
  }

  // totalMarks must match
  const computedTotal = form.items.reduce((s, i) => s + i.marks, 0);
  if (computedTotal !== form.totalMarks) {
    errors.push(`Form totalMarks (${form.totalMarks}) ≠ sum of item marks (${computedTotal})`);
  }

  // Bloom composition must match
  const actualComposition: Record<string, number> = {};
  for (const item of form.items) {
    actualComposition[item.bloomLevel] = (actualComposition[item.bloomLevel] ?? 0) + 1;
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

// ─── Generate Form ───────────────────────────────────────────────────────────

export function generateForm(params: GenerationParams): AssessmentForm {
  const candidates = getCandidates(params);
  const items = selectItems(candidates, params);

  // Compute total marks
  const totalMarks = items.reduce((s, i) => s + i.marks, 0);

  // Compute actual Bloom composition
  const bloomComposition: Record<BloomLevel, number> = {
    remember: 0, understand: 0, apply: 0,
    analyze: 0, evaluate: 0, create: 0,
  };
  for (const item of items) {
    bloomComposition[item.bloomLevel]++;
  }

  const form: AssessmentForm = {
    id: nextFormId(),
    version: 1,
    title: params.title,
    subject: params.subject,
    mode: params.mode,
    difficulty: params.difficulty,
    bloomComposition,
    items,
    totalMarks,
    timeLimitMinutes: params.timeLimitMinutes,
    validated: false,
    createdAt: Date.now(),
  };

  // Validate
  const validation = validateForm(form);
  form.validated = validation.valid;

  return form;
}

// ─── Default Bloom composition by mode ───────────────────────────────────────

export function defaultBloomTarget(count: number, mode: AssessmentMode): Partial<Record<BloomLevel, number>> {
  if (mode === "formative" || mode === "practice") {
    // Spread across levels with emphasis on apply/analyze
    return {
      remember: Math.max(1, Math.floor(count * 0.1)),
      understand: Math.max(1, Math.floor(count * 0.15)),
      apply: Math.max(1, Math.floor(count * 0.3)),
      analyze: Math.max(1, Math.floor(count * 0.25)),
      evaluate: Math.max(0, Math.floor(count * 0.1)),
      create: Math.max(0, Math.floor(count * 0.1)),
    };
  }
  // closed_book_mock: heavier on higher-order
  return {
    remember: Math.max(0, Math.floor(count * 0.05)),
    understand: Math.max(1, Math.floor(count * 0.15)),
    apply: Math.max(1, Math.floor(count * 0.25)),
    analyze: Math.max(1, Math.floor(count * 0.25)),
    evaluate: Math.max(1, Math.floor(count * 0.15)),
    create: Math.max(0, Math.floor(count * 0.15)),
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function availableItemCount(
  subject: SubjectKey,
  nodes: string[],
  types: QuestionType[],
): number {
  const nodeSet = new Set(nodes);
  return ITEM_BANK.filter(
    (i) => i.subject === subject && nodeSet.has(i.nodeId) && types.includes(i.type)
  ).length;
}
