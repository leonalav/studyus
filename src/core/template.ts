/**
 * Templates are data, not code (§10.2) — parameterized programs plus
 * everything needed to generate all four beats, and the pack container with
 * its load-time validation (§10.1).
 *
 * On this surface there is no interpreter (§19 forbids bundling one), so each
 * template also carries a deterministic reference model: the recorded ground
 * truth that PrecomputedRuntime (§9.1) would normally serve from disk.
 */

import type {
  Hole,
  HiddenTest,
  Misconception,
  PackId,
  ParamBinding,
  ParamSpec,
  Rubric,
  Skill,
  SkillId,
  TemplateId,
  Tier3Content,
  TraceStep,
  WriteCheck,
} from "./types";

export interface ReferenceResult {
  /** recorded stdout — the ground truth for this binding */
  stdout: string;
  /** execution trace, revealed only after commitment */
  trace: TraceStep[];
}

export interface PredictChoice {
  id: string;
  text: string;
}

export interface Template {
  id: TemplateId;
  skill: SkillId;
  tier: 1;
  params: Record<string, ParamSpec>;
  /** derived values available to rendering, e.g. n_minus_1 (§10.2) */
  derived?: (b: ParamBinding) => Record<string, string | number>;

  predict: {
    /** simple {{name}} substitution; strict on unknown placeholders */
    program: string;
    questionText: string;
    reference: (b: ParamBinding) => ReferenceResult;
    /** commitment options offered only as a requested scaffold */
    choices?: (b: ParamBinding) => PredictChoice[];
  };

  explain: {
    rubric: (b: ParamBinding) => Rubric;
  };

  modify: {
    programWithHoles: string;
    holes: (b: ParamBinding) => Hole[];
    targetBehaviour: string;
    /** recorded output of the correctly completed program */
    stdout: (b: ParamBinding) => string;
  };

  write: {
    specification: string;
    signatureHint: string;
    hiddenTests: (b: ParamBinding) => HiddenTest[];
    checks: WriteCheck[];
    referenceSolution: string;
  };
}

export interface VoiceBundleRef {
  file: string;
}

export interface Pack {
  id: PackId;
  title: string;
  version: string;
  license: string;
  attribution: string;
  language: string;
  minPython: string;
  skills: Skill[];
  templates: Template[];
  misconceptions: Misconception[];
  tier3: Tier3Content[];
}

/* ── rendering (§10.2) — simple substitution, strict unknown-placeholder errors ── */

export function renderTemplate(
  text: string,
  binding: ParamBinding,
  derived: Record<string, string | number> = {},
): string {
  return text.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => {
    if (name in binding) return String(binding[name]);
    if (name in derived) return String(derived[name]);
    throw new Error(`unresolved placeholder {{${name}}} in template text`);
  });
}

/** computed parameter space — every Tier 1 template needs ≥ 200 (§10.3) */
export function paramSpaceSize(template: Template): number {
  let size = 1;
  for (const spec of Object.values(template.params)) {
    size *= spec.kind === "int" ? spec.max - spec.min + 1 : spec.of.length;
  }
  return size;
}

/* ── pack loading and validation (§10.1): emit ALL errors at once, not the first ── */

export function validatePack(pack: Pack): string[] {
  const errors: string[] = [];

  const skillIds = new Set<string>();
  for (const skill of pack.skills) {
    if (skillIds.has(skill.id)) errors.push(`duplicate skill id: ${skill.id}`);
    skillIds.add(skill.id);
  }
  const templateIds = new Set<string>();
  for (const template of pack.templates) {
    if (templateIds.has(template.id)) errors.push(`duplicate template id: ${template.id}`);
    templateIds.add(template.id);
    if (!skillIds.has(template.skill)) errors.push(`template ${template.id} references unknown skill ${template.skill}`);
    const space = paramSpaceSize(template);
    if (space < 200) errors.push(`template ${template.id} parameter space is ${space}; ≥ 200 required`);
  }
  const misconceptionIds = new Set(pack.misconceptions.map((m) => m.id));
  if (misconceptionIds.size !== pack.misconceptions.length) errors.push("duplicate misconception ids");

  for (const skill of pack.skills) {
    for (const prereq of skill.prerequisites) {
      if (!skillIds.has(prereq)) errors.push(`skill ${skill.id} references unknown prerequisite ${prereq}`);
    }
    for (const m of skill.misconceptions) {
      if (!misconceptionIds.has(m)) errors.push(`skill ${skill.id} references unknown misconception ${m}`);
    }
    const hasTemplate = pack.templates.some((t) => t.skill === skill.id);
    if (skill.tier === 1 && !hasTemplate) errors.push(`tier 1 skill ${skill.id} has no template`);
  }

  // prerequisite cycles — detect and reject, naming the cycle (§7.3)
  const cycle = findCycle(pack.skills);
  if (cycle) errors.push(`prerequisite cycle: ${cycle.join(" → ")}`);

  return errors;
}

function findCycle(skills: Skill[]): SkillId[] | null {
  const byId = new Map(skills.map((s) => [s.id, s]));
  const state = new Map<SkillId, "visiting" | "done">();
  const path: SkillId[] = [];

  const visit = (id: SkillId): SkillId[] | null => {
    const mark = state.get(id);
    if (mark === "done") return null;
    if (mark === "visiting") {
      const start = path.indexOf(id);
      return [...path.slice(start), id];
    }
    state.set(id, "visiting");
    path.push(id);
    for (const prereq of byId.get(id)?.prerequisites ?? []) {
      if (byId.has(prereq)) {
        const found = visit(prereq);
        if (found) return found;
      }
    }
    path.pop();
    state.set(id, "done");
    return null;
  };

  for (const skill of skills) {
    const found = visit(skill.id);
    if (found) return found;
  }
  return null;
}
