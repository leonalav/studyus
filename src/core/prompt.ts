/**
 * The safe side of the reveal barrier (§7.5).
 *
 * `buildPrompt` is the ONLY function that projects an Exercise (which
 * carries the expected outcome) into something a frontend may see before
 * commitment. It selects safe fields deliberately — program text, question,
 * target behaviour, specification, dry-run INPUT — and never touches
 * expected outputs, rubrics, exemplars, accepted fills, hidden-test
 * outputs, or reference solutions.
 */

import type { Exercise, ExercisePrompt } from "./types";
import type { Pack } from "./template";
import { renderTemplate } from "./template";

export function buildPrompt(pack: Pack, exercise: Exercise, hasPriorPredictAttempt: boolean): ExercisePrompt {
  const skill = pack.skills.find((s) => s.id === exercise.skill)!;
  const base = {
    exerciseId: exercise.id,
    skillId: exercise.skill,
    skillTitle: skill.title,
    beat: exercise.beat,
    tier: exercise.tier,
    scaffold: exercise.scaffold,
  };
  switch (exercise.payload.beat) {
    case "predict": {
      const prompt: ExercisePrompt = {
        ...base,
        body: {
          kind: "predict",
          program: exercise.payload.program,
          question: exercise.payload.question.kind === "stdout" ? "What does this print?" : "What happens?",
        },
      };
      if (exercise.scaffold === "hinted") {
        const template = pack.templates.find((t) => t.id === exercise.template);
        const choices = template?.predict.choices?.(exercise.params);
        if (choices) prompt.choices = choices;
      }
      return prompt;
    }
    case "explain":
      return {
        ...base,
        body: {
          kind: "explain",
          program: exercise.payload.program,
          instruction: "In one sentence — not line by line — what does this program do?",
        },
      };
    case "modify": {
      const prompt: ExercisePrompt = {
        ...base,
        body: {
          kind: "modify",
          programWithHoles: exercise.payload.programWithHoles,
          holeCount: exercise.payload.holes.length,
          targetBehaviour: exercise.payload.targetBehaviour,
        },
      };
      // Law 3: worked examples are remediation — only after a first attempt.
      // Law 1 guard: the sibling's recorded output must never coincide with
      // this exercise's own target outcome.
      if (exercise.scaffold === "worked-example" && hasPriorPredictAttempt) {
        const template = pack.templates.find((t) => t.id === exercise.template);
        if (template) {
          const reference = template.predict.reference(exercise.params);
          const firstLine = reference.stdout.split("\n")[0];
          const targetFirstLine =
            exercise.payload.expected.kind === "stdout" ? exercise.payload.expected.text.split("\n")[0] : "";
          if (firstLine !== targetFirstLine) {
            const derived = template.derived?.(exercise.params) ?? {};
            prompt.workedSibling = {
              program: renderTemplate(template.predict.program, exercise.params, derived),
              note: `A sibling you've already committed on — it prints ${firstLine}.`,
            };
          }
        }
      }
      return prompt;
    }
    case "write":
      return {
        ...base,
        body: {
          kind: "write",
          specification: exercise.payload.specification,
          // signature hint only at 'hinted' — never at ScaffoldLevel::None (§7.4)
          signatureHint: exercise.scaffold === "hinted" ? exercise.payload.signatureHint : undefined,
          dryRunInput: exercise.payload.hiddenTests[0]?.stdin ?? "",
        },
      };
  }
}
