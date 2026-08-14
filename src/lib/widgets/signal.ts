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

    // Exploration widgets. Moving a slider, playing an animation, opening a
    // hint or reading an annotation is thinking, not reporting, and must never
    // wake the tutor on its own. But when the agent attached a `respond`
    // prompt, committing an answer to it IS the learner's turn — the same
    // commit-once rule as any other answerable widget.
    case "slider":
    case "animation":
    case "hint":
    case "annotation":
      return intent.respond !== undefined && nowSubmitted && !wasSubmitted;

    // No response affordance by design: these present, they do not ask.
    case "reveal":
    case "roadmap":
    case "concept_card":
    case "comparison":
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

    // The exploration widgets. What makes these worth a turn is not that the
    // learner touched a control, but that they committed to a claim ABOUT what
    // the control showed them. Each directive names the specific evidence the
    // answer provides, so the tutor does not treat it as small talk.
    case "slider": {
      lines.push(`I explored the ${label.toLowerCase()} for ${intent.label}.`);
      if (typeof state.sliderValue === "number") {
        lines.push(`I left it at ${intent.parameter} = ${state.sliderValue}${intent.unit ?? ""}.`);
      }
      if (intent.respond) lines.push(`You asked: "${intent.respond.prompt}"`);
      lines.push(`My answer: "${state.responseText?.trim() || "(blank)"}"`);
      lines.push(
        `[This is my account of what varying ${intent.parameter} does. Check whether I described the RELATIONSHIP or just read off a number — the second is not understanding. If I only reported values, ask what happens as ${intent.parameter} approaches its limits.]`
      );
      break;
    }

    case "animation": {
      lines.push(`I responded to the ${label.toLowerCase()} on the board.`);
      if (intent.predictPrompt) lines.push(`The prediction you asked for: "${intent.predictPrompt}"`);
      else if (intent.respond) lines.push(`You asked: "${intent.respond.prompt}"`);
      lines.push(`My answer: "${state.responseText?.trim() || "(blank)"}"`);
      lines.push(
        `[A prediction committed before watching is evidence of a mental model; agreeing with the animation afterwards is not. Tell me specifically where my prediction matched the motion and where it did not, and name the mechanism behind any mismatch.]`
      );
      break;
    }

    case "hint": {
      const opened = state.hintLevelOpened ?? 0;
      lines.push(`I opened ${opened === 0 ? "no hints" : `hint level ${opened}`} and then answered.`);
      if (intent.respond) lines.push(`You asked: "${intent.respond.prompt}"`);
      lines.push(`My answer: "${state.responseText?.trim() || "(blank)"}"`);
      lines.push(
        opened >= 3
          ? `[I needed the deepest hint, so this is evidence of LOW independence on this step. Judge the answer, then plan an unscaffolded retry of the same idea before treating it as learned.]`
          : `[I used hint level ${opened} of ${intent.steps.length}. Factor that into independence: the answer counts for less the more it was scaffolded. Do not offer a deeper hint unless my answer shows I am still stuck.]`
      );
      break;
    }

    case "annotation": {
      lines.push(`I responded to the annotation${intent.targetLabel ? ` on ${intent.targetLabel}` : ""}.`);
      if (intent.respond) lines.push(`You asked: "${intent.respond.prompt}"`);
      lines.push(`My answer: "${state.responseText?.trim() || "(blank)"}"`);
      lines.push(
        `[You pointed at something specific; check whether my answer engages with THAT rather than restating the surrounding idea. If I missed the point being marked, re-mark it more narrowly instead of explaining it for me.]`
      );
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
    case "slider":
    case "animation":
    case "hint":
    case "annotation":
      return state.responseText?.trim()
        ? `Answered the ${label}: "${truncate(state.responseText.trim())}"`
        : `Responded to the ${label}.`;
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

/**
 * Compose one tutor turn from a completed cluster.
 *
 * The whole point of a cluster is that the agent judges the answers *together*.
 * Three questions probing one idea tell a story no single answer does: two
 * right and one wrong is a specific, locatable gap, whereas the same three
 * delivered as three separate turns would be diagnosed three times in isolation
 * and probably "corrected" three times too.
 *
 * So the message stacks each member's own pedagogical message and closes with a
 * directive to respond to the SET. Ordering follows board order, which is the
 * order the learner met them in.
 */
export function buildClusterSignalMessage(
  members: { intent: WidgetIntent; state: WidgetState }[],
  stage: MasteryStage,
  label?: string
): string {
  const spec = MASTERY_STAGE_SPECS[stage];
  const lines: string[] = [];

  const heading = label?.trim()
    ? `I finished "${label.trim()}" on the board — ${members.length} activities that go together.`
    : `I finished a set of ${members.length} activities on the board that go together.`;
  lines.push(heading, "");

  members.forEach((member, index) => {
    lines.push(`(${index + 1}/${members.length}) ${buildWidgetSignalMessage(member.intent, member.state, stage)}`);
    lines.push("");
  });

  const graded = members.filter((member) => typeof member.state.correct === "boolean");
  const wrong = graded.filter((member) => member.state.correct === false).length;
  const right = graded.length - wrong;

  if (graded.length > 0) {
    lines.push(
      wrong === 0
        ? `[All ${graded.length} graded answers are right. Do NOT just celebrate — check whether the reasoning was sound rather than lucky, and treat this as evidence toward the stage's exit condition, not proof of it.]`
        : right === 0
          ? `[All ${graded.length} graded answers are wrong. Something upstream is missing: find the single misconception that explains ALL of them rather than diagnosing each answer separately, and repair that.]`
          : `[${right} of ${graded.length} graded answers are right and ${wrong} wrong. The contrast is the diagnosis: work out what the wrong ones share that the right ones do not, and repair that specific gap. Do not re-teach what they already got right.]`
    );
  }

  lines.push(
    `[Respond to this set as a whole, in ONE reply. Do not answer each activity separately. Judge these answers together against this stage's exit condition: ${spec.exitCondition}]`
  );

  return lines.filter((line, index, all) => !(line === "" && all[index + 1] === "")).join("\n").trim();
}

/** Learner-facing transcript line for a completed cluster. Never reveals
 *  correctness — that is the tutor's to deliver, in context. */
export function buildClusterSignalDisplayText(
  members: { intent: WidgetIntent; state: WidgetState }[],
  label?: string
): string {
  return label?.trim()
    ? `I completed "${label.trim()}" (${members.length} activities)`
    : `I completed a set of ${members.length} activities on the board`;
}
