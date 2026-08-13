/**
 * Turning a learner's widget interaction into a tutor turn.
 *
 * A widget the learner answers is a *pedagogical signal*, not a form
 * submission. The Guide to Mastery makes the agent responsible for responding
 * to it: an answered question is the evidence a stage's exit condition is or is
 * not met, a chosen distractor names a misconception to diagnose, and a
 * requested hint is a data point about independence.
 *
 * Two decisions live here:
 *
 *  1. WHICH interactions deserve a turn. Dragging a slider or opening a hint is
 *     exploration and must not spam the tutor; committing an answer, finishing
 *     a reflection, or failing a retrieval check is a signal it must answer.
 *
 *  2. WHAT the tutor is told. Not "the learner clicked B" but the pedagogical
 *     content of the act: the misconception that distractor detects, the
 *     stage's exit condition, and an explicit instruction to diagnose rather
 *     than announce the score. This is what stops the agent replying "Correct!"
 *     and moving on.
 */

import type { WidgetIntent, WidgetState, QuestionOption } from "./types";
import { WIDGET_LABEL } from "./types";
import { MASTERY_STAGE_SPECS, type MasteryStage } from "../mastery";

/** A learner interaction worth a tutor turn. */
export interface WidgetSignal {
  /** Board anchor of the widget that produced it. */
  blockId: string;
  kind: WidgetIntent["kind"];
  /** The message handed to the tutor as the learner's turn. Carries the
   *  pedagogical directive and is never shown to the learner verbatim. */
  message: string;
  /** Short learner-facing summary of what they did, for the transcript. The
   *  learner should see "I answered B", not the instructions their tutor got. */
  displayText: string;
  /** Whether the learner got it right, when that is deterministically known. */
  correct?: boolean;
}

/**
 * Does this state change deserve a tutor response?
 *
 * Deliberately conservative. The cost of a missed signal is an unresponsive
 * tutor; the cost of an over-eager one is a tutor that interrupts the learner
 * mid-thought on every slider pixel.
 */
export function shouldSignalTutor(
  intent: WidgetIntent,
  previous: WidgetState | undefined,
  next: WidgetState
): boolean {
  const wasSubmitted = previous?.submitted === true;
  const nowSubmitted = next.submitted === true;

  switch (intent.kind) {
    // Committing an answer is the signal. Re-rendering an already-answered
    // widget is not.
    case "question":
    case "retrieval_check":
    case "mistake_check":
    case "challenge":
    case "reflection":
    case "scratchpad":
      return nowSubmitted && !wasSubmitted;

    // Exploration. The learner is thinking, not reporting; the tutor responds
    // when they say something, not when they move a control.
    case "slider":
    case "animation":
    case "hint":
    case "reveal":
    case "roadmap":
    case "concept_card":
    case "comparison":
    case "annotation":
    case "example":
    case "memory_hook":
    case "mastery_card":
      return false;
  }
}

/**
 * Compose the learner-turn message for a signalling interaction.
 *
 * The message is written in the learner's voice because it IS the learner's
 * turn — it flows through the same `askTutorTurn` path as a typed message, so
 * the tutor's whole contract (stage, board ops, evidence) applies unchanged.
 * The bracketed directive is addressed to the agent and states the pedagogical
 * obligation the widget's answer creates.
 */
export function buildWidgetSignalMessage(
  intent: WidgetIntent,
  state: WidgetState,
  stage: MasteryStage
): string {
  const label = WIDGET_LABEL[intent.kind];
  const spec = MASTERY_STAGE_SPECS[stage];
  const lines: string[] = [];

  switch (intent.kind) {
    case "question":
    case "retrieval_check": {
      const chosen = intent.options?.find((option) => option.id === state.selectedOptionId);
      lines.push(`I answered the ${label.toLowerCase()} on the board: "${intent.prompt}"`);
      lines.push(answerLine(intent.options, state, chosen));

      if (state.correct === false) {
        lines.push(
          chosen?.misconception
            ? `[The answer is wrong. It detects this misconception: ${chosen.misconception}. Do NOT simply give the correct answer — diagnose that specific misconception and place the widget that repairs it (a mistake_check, an annotation, or a question that makes the error visible). Then check whether I can now get it right.]`
            : `[The answer is wrong. Diagnose the reasoning behind it before correcting anything, and place a widget that repairs the specific gap rather than restating the right answer.]`
        );
      } else if (state.correct === true) {
        lines.push(
          `[The answer is right. Do not just say "correct" and move on — one right answer is not the exit condition. Confirm the reasoning was sound rather than lucky (ask for the why, or place the next widget that pressures the same idea). The current stage's exit condition is: ${spec.exitCondition}]`
        );
      } else {
        lines.push(`[Judge this answer yourself; it is not auto-gradable. Diagnose the reasoning, not just the result.]`);
      }

      if (intent.kind === "retrieval_check" && state.correct === false) {
        lines.push(`[This was a retrieval check, so this is evidence of forgetting. Route me back through targeted repair on this specific gap rather than restarting the concept.]`);
      }
      break;
    }

    case "mistake_check": {
      lines.push(`I worked through the ${label.toLowerCase()} on the board.`);
      if (intent.repairQuestion) lines.push(`Your repair question was: "${intent.repairQuestion}"`);
      if (state.responseText?.trim()) lines.push(`My response: "${state.responseText.trim()}"`);
      lines.push(`[Check whether I actually found the error myself. If I did, confirm the reasoning and move the work back to me. If I did not, do not hand over the correction — narrow the question further.]`);
      break;
    }

    case "scratchpad": {
      lines.push(`Here is my work from the scratchpad:`);
      lines.push(state.responseText?.trim() || "(I left it blank.)");
      lines.push(
        state.responseText?.trim()
          ? `[Read my actual work. Diagnose it line by line rather than re-deriving it yourself: if a line is wrong, place a mistake_check naming the specific error; if it is right, say what makes it right and hand me the next step. Do not complete the problem for me.]`
          : `[I did not attempt it. Find out what is blocking me — place a hint at the lowest useful level or a question that locates the gap. Do not solve it.]`
      );
      break;
    }

    case "challenge": {
      lines.push(`I attempted the challenge: "${intent.prompt}"`);
      if (state.responseText?.trim()) lines.push(`My answer: "${state.responseText.trim()}"`);
      if (intent.successCriteria?.length) {
        lines.push(`[Evaluate it against the criteria you set: ${intent.successCriteria.join("; ")}. Report which are met and which are not.]`);
      }
      lines.push(`[This was unscaffolded work, so it is evidence about independence${intent.transferNote ? " and transfer" : ""}. Judge it on that basis, not on neatness.]`);
      break;
    }

    case "reflection": {
      lines.push(`Here is my explanation in my own words:`);
      lines.push(state.responseText?.trim() || "(I left it blank.)");
      if (intent.evaluationCriteria?.length) {
        lines.push(`[Evaluate it against: ${intent.evaluationCriteria.join("; ")}.]`);
      }
      lines.push(`[My explanation is your best evidence of understanding. A fluent procedure with an incoherent explanation is NOT understanding. Name specifically what my explanation shows I have and what it shows I am missing.]`);
      break;
    }

    default:
      lines.push(`I interacted with the ${label.toLowerCase()} on the board.`);
      break;
  }

  lines.push(
    `[You are at stage ${spec.ordinal} (${spec.label}). Respond to what I just did on the board — do not ignore it and do not start a new topic. Only set stage_advance.ready if this interaction genuinely satisfied: ${spec.exitCondition}]`
  );

  return lines.join("\n");
}

/** Render the learner's answer for the tutor, whatever the format. */
function answerLine(
  options: QuestionOption[] | undefined,
  state: WidgetState,
  chosen: QuestionOption | undefined
): string {
  if (chosen) {
    const letter = options ? String.fromCharCode(65 + options.indexOf(chosen)) : "";
    return `I chose ${letter ? `${letter}: ` : ""}"${chosen.label}"`;
  }
  if (state.responseText?.trim()) return `I answered: "${state.responseText.trim()}"`;
  return "I submitted an answer.";
}

/**
 * What the learner sees in the transcript for their own action.
 *
 * Deliberately never reveals correctness — that is the tutor's job to deliver
 * as diagnosis, and a "✗ wrong" line in the chat would pre-empt the teaching
 * move the agent is about to make.
 */
export function buildWidgetSignalDisplayText(intent: WidgetIntent, state: WidgetState): string {
  const label = WIDGET_LABEL[intent.kind].toLowerCase();
  switch (intent.kind) {
    case "question":
    case "retrieval_check": {
      const chosen = intent.options?.find((option) => option.id === state.selectedOptionId);
      if (chosen) return `Answered the ${label}: "${truncate(chosen.label)}"`;
      if (state.responseText?.trim()) return `Answered the ${label}: "${truncate(state.responseText.trim())}"`;
      return `Answered the ${label}.`;
    }
    case "scratchpad":
      return state.responseText?.trim()
        ? `Submitted my work: "${truncate(state.responseText.trim())}"`
        : `Submitted the scratchpad without an attempt.`;
    case "reflection":
      return state.responseText?.trim()
        ? `Explained it in my own words: "${truncate(state.responseText.trim())}"`
        : `Submitted the reflection without an explanation.`;
    case "challenge":
      return state.responseText?.trim()
        ? `Attempted the challenge: "${truncate(state.responseText.trim())}"`
        : `Submitted the challenge.`;
    case "mistake_check":
      return state.responseText?.trim()
        ? `Worked through the mistake check: "${truncate(state.responseText.trim())}"`
        : `Worked through the mistake check.`;
    default:
      return `Responded to the ${label}.`;
  }
}

function truncate(text: string, max = 120): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}

/** Compose the full signal, or null when the interaction is not worth a turn. */
export function buildWidgetSignal(
  blockId: string,
  intent: WidgetIntent,
  previous: WidgetState | undefined,
  next: WidgetState,
  stage: MasteryStage
): WidgetSignal | null {
  if (!shouldSignalTutor(intent, previous, next)) return null;
  return {
    blockId,
    kind: intent.kind,
    message: buildWidgetSignalMessage(intent, next, stage),
    displayText: buildWidgetSignalDisplayText(intent, next),
    correct: typeof next.correct === "boolean" ? next.correct : undefined,
  };
}
