/**
 * One-call summary of a learner's prompt-time state.
 *
 * Replaces the older free-form `learner_model_entries` summary the prompt
 * used to receive. The numbers here are the same numbers the mastery card
 * and the policy engine read, so the prompt and the engine can never drift.
 */

import { DEFAULT_LEARNER_ID, getHypotheses, getSkillState } from "./store";
import { toMasteryEvidence } from "./evidence";
import type { MasteryEvidence } from "../widgets/types";
import type { LearnerHypothesis } from "./types";

export interface LearnerPromptSummary {
  hypotheses: LearnerHypothesis[];
  mastery: MasteryEvidence | null;
}

/**
 * Compute the learner summary the prompt will cite this turn.
 *
 * Reads hypotheses and the skill's ledger-derived mastery numbers; performs
 * no I/O beyond the database access inside the helpers. The same ledger
 * always yields the same summary — the mastery's promise is what makes the
 * prompt truthful.
 */
export async function getLearnerPromptSummary(
  learnerId: string = DEFAULT_LEARNER_ID,
  skillId?: string
): Promise<LearnerPromptSummary> {
  const hypotheses = await getHypotheses(learnerId, skillId);
  if (!skillId) {
    return { hypotheses, mastery: null };
  }
  const state = await getSkillState(skillId, learnerId);
  return {
    hypotheses,
    mastery: state ? toMasteryEvidence(state) : null,
  };
}

/**
 * Render the summary as a prompt block, in the same minimal shape the tutor
 * expects. Pure — does not read the database itself.
 */
export function formatLearnerPromptSummary(summary: LearnerPromptSummary): string {
  if (summary.hypotheses.length === 0 && !summary.mastery) {
    return "Learner model: no active claims recorded.";
  }
  const lines: string[] = [];
  if (summary.mastery) {
    const m = summary.mastery;
    lines.push(
      `MASTERY (from ledger): recall ${m.recall} · understanding ${m.understanding} · procedure ${m.procedure} · transfer ${m.transfer} · independence ${m.independence}`
    );
  }
  if (summary.hypotheses.length > 0) {
    lines.push(
      "OPEN HYPOTHESES:",
      ...summary.hypotheses.slice(0, 5).map(
        (hypothesis) =>
          `- [${hypothesis.status}] ${hypothesis.kind.replace(/_/g, " ")}: ${hypothesis.statement} (next test: ${hypothesis.nextBestTest})`
      )
    );
  }
  return lines.join("\n");
}