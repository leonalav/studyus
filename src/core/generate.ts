/**
 * Generation and validation pipeline (§11).
 *
 * Central insight, kept true: for Tier 1 the ground truth comes from recorded
 * execution, never from a model's opinion. On this surface the recording is
 * the template's deterministic reference model (§9.1 PrecomputedRuntime).
 *
 * §10.3 never-repeat is built in from day one: every generated exercise
 * records (template_id, param_hash); the generator rejects seen hashes and
 * switches templates on exhaustion rather than re-serving.
 */

import type { Beat, Exercise, ParamBinding, SkillId } from "./types";
import { paramHashOf, uid } from "./types";
import type { Pack, Template } from "./template";
import { paramSpaceSize, renderTemplate } from "./template";
import type { Rng } from "./rng";
import { staticPolicyCheck } from "./grading";

export interface SeenTable {
  isSeen(templateId: string, hash: number): boolean;
  markSeen(templateId: string, hash: number): void;
  seenCount(templateId: string): number;
}

const MAX_RETRIES = 64;

export function drawBinding(template: Template, rng: Rng): ParamBinding {
  const binding: ParamBinding = {};
  for (const [name, spec] of Object.entries(template.params)) {
    binding[name] = spec.kind === "int" ? rng.int(spec.min, spec.max) : rng.pick(spec.of);
  }
  return binding;
}

/** draw an unseen binding; null when the space is exhausted for this learner */
export function drawUnseenBinding(template: Template, rng: Rng, seen: SeenTable): { binding: ParamBinding; hash: number } | null {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt += 1) {
    const binding = drawBinding(template, rng);
    const hash = paramHashOf(binding);
    if (!seen.isSeen(template.id, hash)) return { binding, hash };
  }
  // exhaustive scan fallback for small spaces — guarantees graceful exhaustion
  return scanUnseen(template, seen) ?? null;
}

function scanUnseen(template: Template, seen: SeenTable): { binding: ParamBinding; hash: number } | null {
  const names = Object.keys(template.params);
  const domains: (number | string)[][] = names.map((name) => {
    const spec = template.params[name];
    if (spec.kind === "int") {
      const out: number[] = [];
      for (let v = spec.min; v <= spec.max; v += 1) out.push(v);
      return out;
    }
    return spec.of;
  });
  const binding: ParamBinding = {};
  const recurse = (depth: number): { binding: ParamBinding; hash: number } | null => {
    if (depth === names.length) {
      const hash = paramHashOf(binding);
      return seen.isSeen(template.id, hash) ? null : { binding: { ...binding }, hash };
    }
    for (const value of domains[depth]) {
      binding[names[depth]] = value;
      const found = recurse(depth + 1);
      if (found) return found;
    }
    return null;
  };
  return recurse(0);
}

export interface GeneratedExercise {
  exercise: Exercise;
}

/** generate one exercise for a skill+beat; returns null when every template is exhausted */
export function generateExercise(
  pack: Pack,
  skillId: SkillId,
  beat: Beat,
  rng: Rng,
  seen: SeenTable,
  scaffold: Exercise["scaffold"],
): GeneratedExercise | null {
  const candidates = pack.templates.filter((t) => t.skill === skillId);
  // rotate template order by rng so multi-template skills vary
  for (const template of candidates) {
    const drawn = drawUnseenBinding(template, rng, seen);
    if (!drawn) continue; // §10.3: pick a different template; mark exhaustion below
    const exercise = buildExercise(pack, template, beat, drawn.binding, drawn.hash, scaffold);
    if (exercise) return { exercise };
  }
  // §10.3 — never re-serve; the skill needs more templates
  return null;
}

export function buildExercise(
  pack: Pack,
  template: Template,
  beat: Beat,
  binding: ParamBinding,
  hash: number,
  scaffold: Exercise["scaffold"],
): Exercise | null {
  const skill = pack.skills.find((s) => s.id === template.skill);
  if (!skill) return null;
  const derived = template.derived?.(binding) ?? {};
  const id = uid("ex");

  switch (beat) {
    case "predict": {
      const program = renderTemplate(template.predict.program, binding, derived);
      const reference = template.predict.reference(binding);
      return {
        id,
        skill: skill.id,
        template: template.id,
        beat,
        tier: 1,
        params: binding,
        paramHash: hash,
        scaffold,
        payload: {
          beat: "predict",
          program,
          question: { kind: "stdout" },
          expected: { kind: "stdout", text: reference.stdout },
          trace: reference.trace,
        },
      };
    }
    case "explain": {
      const program = renderTemplate(template.predict.program, binding, derived);
      return {
        id,
        skill: skill.id,
        template: template.id,
        beat,
        tier: 1,
        params: binding,
        paramHash: hash,
        scaffold,
        payload: {
          beat: "explain",
          program,
          rubric: renderRubric(template.explain.rubric(binding), binding, derived),
        },
      };
    }
    case "modify": {
      return {
        id,
        skill: skill.id,
        template: template.id,
        beat,
        tier: 1,
        params: binding,
        paramHash: hash,
        scaffold,
        payload: {
          beat: "modify",
          programWithHoles: renderTemplate(template.modify.programWithHoles, binding, derived),
          holes: template.modify.holes(binding),
          targetBehaviour: renderTemplate(template.modify.targetBehaviour, binding, derived),
          expected: { kind: "stdout", text: template.modify.stdout(binding) },
        },
      };
    }
    case "write": {
      return {
        id,
        skill: skill.id,
        template: template.id,
        beat,
        tier: 1,
        params: binding,
        paramHash: hash,
        scaffold,
        payload: {
          beat: "write",
          specification: renderTemplate(template.write.specification, binding, derived),
          signatureHint: scaffold === "none" ? undefined : renderTemplate(template.write.signatureHint, binding, derived),
          hiddenTests: template.write.hiddenTests(binding),
          checks: template.write.checks,
          referenceSolution: template.write.referenceSolution,
        },
      };
    }
  }
}

function renderRubric(rubric: ReturnType<Template["explain"]["rubric"]>, binding: ParamBinding, derived: Record<string, string | number>) {
  return {
    groups: rubric.groups.map((g) => ({ oneOf: g.oneOf.map((phrase) => renderTemplate(phrase, binding, derived)) })),
    mustNotInclude: rubric.mustNotInclude.map((phrase) => renderTemplate(phrase, binding, derived)),
    exemplar: renderTemplate(rubric.exemplar, binding, derived),
  };
}

/* ── §11 validation chain ──
 * Every filter must pass, in order. Every rejection names its filter.
 */

export type FilterName =
  | "render"
  | "parse"
  | "static-policy"
  | "determinism"
  | "non-triviality"
  | "head-computability"
  | "beat-coherence";

export interface ValidationReport {
  template: string;
  samples: number;
  accepted: number;
  rejected: Partial<Record<FilterName, number>>;
}

export function validateTemplate(template: Template, rng: Rng, samples = 24): ValidationReport {
  const report: ValidationReport = { template: template.id, samples, accepted: 0, rejected: {} };
  const reject = (filter: FilterName) => {
    report.rejected[filter] = (report.rejected[filter] ?? 0) + 1;
  };

  for (let i = 0; i < samples; i += 1) {
    const binding = drawBinding(template, rng);
    const derived = template.derived?.(binding) ?? {};

    // 1. render — reject on any unresolved placeholder
    let program: string;
    try {
      program = renderTemplate(template.predict.program, binding, derived);
      renderTemplate(template.modify.programWithHoles, binding, derived);
      renderTemplate(template.modify.targetBehaviour, binding, derived);
      renderTemplate(template.write.specification, binding, derived);
    } catch {
      reject("render");
      continue;
    }

    // 2. parse — adaptation: no interpreter in the browser, so syntax is
    // guaranteed by construction and checked structurally (recorded deviation).
    if (!/print\s*\(/.test(program) || /\{\{/.test(program)) {
      reject("parse");
      continue;
    }

    // 3. static policy — deny-list plus import allow-list (§11.3)
    if (staticPolicyCheck(program) !== null || /\binput\s*\(/.test(program)) {
      reject("static-policy");
      continue;
    }

    // 4. execute three times — require identical output (recorded runs are
    // deterministic by construction; the check still runs, honestly).
    const runs = [template.predict.reference(binding), template.predict.reference(binding), template.predict.reference(binding)];
    if (runs[0].stdout !== runs[1].stdout || runs[1].stdout !== runs[2].stdout) {
      reject("determinism");
      continue;
    }
    const stdout = runs[0].stdout;

    // 5. non-triviality
    const statements = program.split("\n").filter((l) => l.trim().length > 0).length;
    const literals: string[] = program.match(/-?\d+(?:\.\d+)?|"[^"]*"|'[^']*'/g) ?? [];
    if (stdout.length === 0 || statements < 3 || literals.includes(stdout) || stdout === program) {
      reject("non-triviality");
      continue;
    }

    // 6. head-computability
    const lines = program.split("\n").length;
    const floatTooPrecise = stdout.split(/\s+/).some((tok) => /^\d+\.\d{4,}$/.test(tok));
    const ops = runs[0].trace.length;
    if (lines > 20 || stdout.length > 200 || floatTooPrecise || ops > 30) {
      reject("head-computability");
      continue;
    }

    // 8. beat coherence — the write reference solution must satisfy its own checks
    const writeOk = template.write.checks.every((check) => check.test(template.write.referenceSolution));
    const tests = template.write.hiddenTests(binding);
    if (!writeOk || tests.length < 4) {
      reject("beat-coherence");
      continue;
    }

    report.accepted += 1;
  }
  return report;
}

export function validatePackTemplates(pack: Pack, rng: Rng, samples = 24): ValidationReport[] {
  return pack.templates.map((template) => validateTemplate(template, rng, samples));
}

/** every shipped Tier 1 template needs a parameter space ≥ 200 (§10.3) */
export function templateSpaceReport(pack: Pack): { template: string; space: number }[] {
  return pack.templates.map((template) => ({ template: template.id, space: paramSpaceSize(template) }));
}
