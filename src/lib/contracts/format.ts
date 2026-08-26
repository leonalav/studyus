import type { Commitment, TurnContract } from "./types";

/** One-line canonical statement of a commitment, shared by the review UI,
 *  the tutor prompt reminder, and repair messages. */
export function describeCommitment(commitment: Commitment): string {
  switch (commitment.kind) {
    case "scope_include":
      return `Cover "${commitment.concept}".`;
    case "scope_exclude":
      return `Do not teach or reference "${commitment.concept}".`;
    case "representation":
      return commitment.avoid
        ? `Prefer ${commitment.prefer}; avoid ${commitment.avoid}.`
        : `Prefer ${commitment.prefer}.`;
    case "pace": {
      const parts: string[] = [];
      if (commitment.sessionsPerWeek !== undefined) parts.push(`${commitment.sessionsPerWeek} sessions per week`);
      if (commitment.minutesPerSession !== undefined) parts.push(`${commitment.minutesPerSession} minutes per session`);
      return `Pace: ${parts.join(", ")}.`;
    }
    case "notation":
      return `Notation: ${commitment.rule}`;
    case "example_domain":
      return `Draw examples from ${commitment.domain}.`;
    case "goal":
      return commitment.deadline
        ? `Goal: ${commitment.statement} (by ${commitment.deadline}).`
        : `Goal: ${commitment.statement}`;
  }
}

/** Short label for grouping commitments in the review UI. */
export function commitmentKindLabel(kind: Commitment["kind"]): string {
  switch (kind) {
    case "scope_include":
      return "Include";
    case "scope_exclude":
      return "Exclude";
    case "representation":
      return "Representation";
    case "pace":
      return "Pace";
    case "notation":
      return "Notation";
    case "example_domain":
      return "Examples";
    case "goal":
      return "Goal";
  }
}

/**
 * The contract block appended to the tutor system prompt.
 *
 * States the authority boundary explicitly: these bind learner-owned choices
 * and carry no authority over engine-owned support, evidence, or mastery.
 */
export function buildContractReminder(contract: TurnContract): string {
  if (!contract.active || contract.commitments.length === 0) return "";

  const lines = contract.commitments.map((c) => `- ${describeCommitment(c)}`).join("\n");

  return [
    "LEARNER COMMITMENTS (binding):",
    lines,
    "",
    "These are the learner's own decisions about what to study, how it is represented, " +
      "which notation to use, and which examples to draw on. Honour every one of them in your speech and board ops. " +
      "A response that ignores a commitment will be rejected and returned to you for correction.",
    "These commitments carry NO authority over support level, hint depth, evidence sufficiency, " +
      "mastery values, stage exit, or advancement. Those remain engine-owned and are decided by the harness, " +
      "not by the learner and not by you.",
  ].join("\n");
}
