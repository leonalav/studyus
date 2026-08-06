/**
 * Test-only oracle: plays a perfect learner by brute-forcing the pack's
 * parameter spaces to recover the binding behind a rendered prompt.
 * Tests are not the frontend — they are allowed to look behind the barrier.
 */

import type { ExercisePrompt, ParamBinding, Response } from "../types";
import type { Pack, Template } from "../template";
import { paramSpaceSize, renderTemplate } from "../template";
import { seededRng } from "../rng";
import { drawBinding } from "../generate";

function allBindings(template: Template, cap = 5000): ParamBinding[] {
  const out: ParamBinding[] = [];
  const rng = seededRng(1234);
  const space = paramSpaceSize(template);
  const seen = new Set<string>();
  const limit = Math.min(space, cap);
  while (out.length < limit) {
    const binding = drawBinding(template, rng);
    const key = JSON.stringify(binding);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(binding);
  }
  return out;
}

/** find (template, binding) whose rendered predict program matches */
export function matchPredict(pack: Pack, program: string): { template: Template; binding: ParamBinding } | null {
  for (const template of pack.templates) {
    const derivedOf = (b: ParamBinding) => template.derived?.(b) ?? {};
    for (const binding of allBindings(template)) {
      try {
        if (renderTemplate(template.predict.program, binding, derivedOf(binding)) === program) {
          return { template, binding };
        }
      } catch {
        /* incomplete binding — skip */
      }
    }
  }
  return null;
}

/** find (template, binding) whose rendered modify program AND target match.
 * The program-with-holes alone can be identical across bindings, so the
 * rendered target behaviour disambiguates. */
export function matchModify(
  pack: Pack,
  programWithHoles: string,
  targetBehaviour: string,
): { template: Template; binding: ParamBinding } | null {
  for (const template of pack.templates) {
    const derivedOf = (b: ParamBinding) => template.derived?.(b) ?? {};
    for (const binding of allBindings(template)) {
      try {
        if (
          renderTemplate(template.modify.programWithHoles, binding, derivedOf(binding)) === programWithHoles &&
          renderTemplate(template.modify.targetBehaviour, binding, derivedOf(binding)) === targetBehaviour
        ) {
          return { template, binding };
        }
      } catch {
        /* skip */
      }
    }
  }
  return null;
}

export function matchWrite(pack: Pack, specification: string): Template | null {
  return pack.templates.find((t) => t.write.specification === specification) ?? null;
}

/** produce a response guaranteed to pass the given prompt */
export function oracleResponse(pack: Pack, prompt: ExercisePrompt): Response {
  switch (prompt.body.kind) {
    case "predict": {
      const match = matchPredict(pack, prompt.body.program);
      if (!match) return { kind: "text", text: "" };
      return { kind: "text", text: match.template.predict.reference(match.binding).stdout };
    }
    case "explain": {
      const match = matchPredict(pack, prompt.body.program);
      if (!match) return { kind: "text", text: "It computes something and prints it." };
      return { kind: "text", text: match.template.explain.rubric(match.binding).exemplar };
    }
    case "modify": {
      const match = matchModify(pack, prompt.body.programWithHoles, prompt.body.targetBehaviour);
      if (!match) return { kind: "holes", fills: [] };
      const fills = match.template.modify.holes(match.binding).map((hole) => hole.accept[0]);
      return { kind: "holes", fills };
    }
    case "write": {
      const template = matchWrite(pack, prompt.body.specification);
      if (!template) return { kind: "source", source: "", dryRun: "" };
      const tests = template.write.hiddenTests({});
      return { kind: "source", source: template.write.referenceSolution, dryRun: tests[0].stdout };
    }
  }
}
