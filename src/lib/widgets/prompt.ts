/**
 * The widget half of the tutor's prompt contract.
 *
 * `lib/widgets/types.ts` defines the protocol, `validate.ts` enforces it, and
 * this module is how the agent is *taught* it. Everything here is derived from
 * the same source of truth the validator uses, so the prompt can never drift
 * into advertising fields that would be rejected at the boundary.
 *
 * Two things are deliberately separated:
 *
 *  - WIDGET_FIELD_SPEC — the mechanical contract: which fields exist, which are
 *    required, what the bounds are. Getting this wrong produces schema errors.
 *  - WIDGET_TEACHING_RULE — the pedagogical contract: what the widget is FOR,
 *    and the failure mode it exists to prevent. Getting this wrong produces a
 *    technically valid widget that teaches nothing.
 *
 * The second one is the point. A Mistake Check with a `correction` and no
 * `diagnosis` validates fine and is still a tutor doing the learner's thinking
 * for them.
 */

import { WIDGET_KINDS, WIDGET_LABEL, type WidgetKind } from "./types";
import { MASTERY_STAGE_SPECS, MASTERY_STAGES, stagesForWidget } from "../mastery";

/** Mechanical field contract per widget, mirroring `validateWidgetIntent`. */
const WIDGET_FIELD_SPEC: Record<WidgetKind, string> = {
  roadmap:
    `{ "kind":"roadmap", "heading"?: string, "steps": [ { "id": string, "label": string, "detail"?: string, "state"?: "done"|"current"|"upcoming" } ] } — 1–16 steps, at most one "current".`,
  concept_card:
    `{ "kind":"concept_card", "term": string, "pronunciation"?: string, "classification"?: string, "definition": string, "definitionLatex"?: string, "facets"?: string[] }`,
  slider:
    `{ "kind":"slider", "label": string, "parameter": string, "min": number, "max": number, "step"?: number, "value": number, "unit"?: string, "ticks"?: [{ "value": number, "label": string }], "readouts"?: [{ "id": string, "label": string, "expression": string, "precision"?: number, "unit"?: string }], "observe"?: string } — min<max, value within range; readout expressions are arithmetic in "parameter" only (e.g. "0.5*g*t^2"), max 4 readouts.`,
  animation:
    `{ "kind":"animation", "frames": [ { "id": string, "caption": string, "latex"?: string } ], "motion"?: { "xExpression": string, "yExpression": string, "tDomain": [number,number], "trace"?: boolean, "guideXExpression"?: string, "guideYExpression"?: string }, "durationMs"?: number, "loop"?: boolean, "predictPrompt"?: string } — 1–12 frames; motion expressions are arithmetic in "t".`,
  comparison:
    `{ "kind":"comparison", "columns": [ { "id": string, "title": string, "items"?: string[], "accent"?: "cyan"|"amber"|"violet"|"ember"|"neutral" } ], "rows"?: [ { "id": string, "label": string, "cells": string[] } ], "takeaway"?: string } — 2–4 columns; every row's "cells" length must equal the column count; each column needs "items" unless "rows" is supplied.`,
  question:
    `{ "kind":"question", "prompt": string, "promptLatex"?: string, "format": "multiple_choice"|"short_answer"|"numeric", "options"?: [ { "id": string, "label": string, "correct"?: boolean, "misconception"?: string } ], "acceptedAnswers"?: string[], "numericAnswer"?: { "value": number, "tolerance"?: number, "unit"?: string }, "explanation"?: string, "placeholder"?: string } — multiple_choice needs 2–6 options with EXACTLY ONE correct; short_answer needs acceptedAnswers; numeric needs numericAnswer.`,
  hint:
    `{ "kind":"hint", "steps": [ { "level": 1|2|3, "label": string, "body": string } ] } — levels must start at 1 and be gapless (1, or 1&2, or 1&2&3). Level 1 nudges, 2 leads, 3 reveals the idea — never the final answer.`,
  scratchpad:
    `{ "kind":"scratchpad", "prompt"?: string, "starter"?: string, "placeholder"?: string, "lines"?: number, "mode"?: "text"|"math" }`,
  annotation:
    `{ "kind":"annotation", "targetAnchor"?: string, "targetLabel"?: string, "marks": [ { "id": string, "target": string, "note": string, "emphasis"?: "circle"|"underline"|"arrow"|"strike" } ] } — 1–8 marks; "target" is the exact fragment being pointed at.`,
  reveal:
    `{ "kind":"reveal", "prompt"?: string, "items": [ { "id": string, "label": string, "content": string, "contentLatex"?: string } ], "actionLabel"?: string } — 1–12 items, each hidden until the learner opens it.`,
  example:
    `{ "kind":"example", "problem"?: string, "problemLatex"?: string, "steps": [ { "id": string, "expression"?: string, "latex"?: string, "why": string } ], "conclusion"?: string } — 1–12 steps; EVERY step requires "why".`,
  mistake_check:
    `{ "kind":"mistake_check", "prompt"?: string, "lines": [ { "id": string, "content": string, "contentLatex"?: string, "status": "ok"|"error", "diagnosis"?: string } ], "misconception"?: string, "repairQuestion"?: string, "correction"?: string, "correctionLatex"?: string } — at least one line with status "error", and every error line REQUIRES a "diagnosis".`,
  memory_hook:
    `{ "kind":"memory_hook", "hook": string, "hookLatex"?: string, "elaboration"?: string, "resurfaceFor"?: string[] } — "hook" is the compressed thing to memorize, short enough to survive a week.`,
  retrieval_check:
    `{ "kind":"retrieval_check", "prompt": string, "promptLatex"?: string, "format": "multiple_choice"|"short_answer"|"numeric", "options"?, "acceptedAnswers"?, "numericAnswer"?, "source"?: string, "expectedPoints"?: string[], "explanation"?: string, "placeholder"?: string } — same answer rules as question. "source" says where it came from, e.g. "8.1 Derivatives · two sessions ago".`,
  challenge:
    `{ "kind":"challenge", "badge"?: string, "prompt": string, "promptLatex"?: string, "parts"?: [ { "id": string, "prompt": string, "promptLatex"?: string } ], "successCriteria"?: string[], "transferNote"?: string } — no scaffolding inside the challenge itself; put help in a separate hint widget only if asked.`,
  reflection:
    `{ "kind":"reflection", "prompt": string, "guidance"?: string[], "evaluationCriteria"?: string[], "minWords"?: number, "placeholder"?: string }`,
  mastery_card:
    `{ "kind":"mastery_card", "concept": string, "evidence": { "recall": 0-100, "understanding": 0-100, "procedure": 0-100, "transfer": 0-100, "independence": 0-100 }, "understands"?: string[], "canDo"?: string[], "recalls"?: string[], "watch"?: string[], "next"?: string, "reviewIn"?: string } — all five evidence scores are REQUIRED. The verdict and weakest link are computed by the app, not written by you.`,
};

/** What each widget is for, and the failure it prevents. */
const WIDGET_TEACHING_RULE: Record<WidgetKind, string> = {
  roadmap:
    `Open a concept by showing where the lesson goes and mark the current step. Never use it as a progress bar the learner clicks through.`,
  concept_card:
    `The durable definition, given AFTER the learner has met the idea — not as the opening move. Include the notation and how it is read aloud; unread notation is unlearned notation.`,
  slider:
    `Let the learner move one parameter and watch what changes. Always set "observe" so the drag has a question attached to it.`,
  animation:
    `Show a process across time. Set "predictPrompt" so the learner commits to a prediction before pressing play; an animation watched passively teaches nothing.`,
  comparison:
    `Put two ideas side by side when the learner is confusing them. State the "takeaway" — the single distinction the comparison exists to make land.`,
  question:
    `A check for understanding placed on the board, never asked in speech. Every distractor must carry the "misconception" it detects, so a wrong choice becomes a diagnosis instead of a red mark.`,
  hint:
    `Progressive disclosure the learner opens themselves. Respect the unlocked hint level. Level 3 reveals the idea, never the final answer.`,
  scratchpad:
    `Hand the work to the learner. Use it the moment you would otherwise have written the next algebraic step yourself.`,
  annotation:
    `Point at a specific fragment of something already on the board and say what to notice about it. Use it to teach notation ("this h → 0 is doing the real work"), not to restate the content.`,
  reveal:
    `Hide a definition, an answer, or a next step behind the learner's own decision to look. Use before an explanation so the learner tries first.`,
  example:
    `The worked demonstration. Every step needs its "why". A step without a reason is a magic trick, and the learner will copy the trick rather than the reasoning.`,
  mistake_check:
    `Diagnose the learner's work. Mark the erroring line, name the underlying "misconception", and ask a "repairQuestion" that leads them to their own correction. Withhold "correction" until they have responded — correcting for them removes the only useful part of the mistake.`,
  memory_hook:
    `The explicit "memorize this" moment. Compress the idea into something short and durable, and list "resurfaceFor" so it can be brought back later.`,
  retrieval_check:
    `Resurface earlier material from memory, with no notes and no rebuilding from the board. This is how forgetting is detected. Cite "source" so the learner sees the gap in time.`,
  challenge:
    `Independent work with the scaffolding deliberately removed. State "successCriteria" so "done" is observable. Set "transferNote" when the context or representation has intentionally changed.`,
  reflection:
    `Ask the learner to teach the idea back in their own words. Their explanation is your best evidence of understanding — a fluent procedure with an incoherent explanation is not understanding.`,
  mastery_card:
    `Close a concept by reporting evidence, not by celebrating completion. Name what they understand, what they can do, and — in "watch" — what you do not yet trust and what they are likely to forget. Never render it as a score or a completion badge.`,
};

/** Compact catalog for the per-turn prompt: contract + purpose + stage homes. */
export function formatWidgetCatalog(): string {
  return WIDGET_KINDS.map((kind) => {
    const stages = stagesForWidget(kind)
      .map((stage) => MASTERY_STAGE_SPECS[stage].label)
      .join("/");
    return `- ${WIDGET_LABEL[kind]} [${kind}]${stages ? ` · stages: ${stages}` : ""}\n` +
      `  ${WIDGET_FIELD_SPEC[kind]}\n` +
      `  Use it to: ${WIDGET_TEACHING_RULE[kind]}`;
  }).join("\n");
}

/**
 * The behavioural spec for the Guide to Mastery loop.
 *
 * This is the part that stops the agent from degrading into a well-formatted
 * answer machine. Each rule here corresponds to a specific observed failure
 * mode of tutoring models: advancing on a click, declaring mastery from a
 * score, correcting instead of diagnosing, and congratulating completion.
 */
export function formatMasteryDirective(): string {
  return [
    `GUIDE TO MASTERY — THE OPERATING LOOP (binding):`,
    `The agent carries the structure. The student carries the thinking. Mastery means the student can eventually carry both.`,
    ``,
    `Teach through the six stages below. Report the stage you are teaching in as "stage" on every turn.`,
    formatStageLadderForPrompt(),
    ``,
    `STAGE ADVANCEMENT:`,
    `- Advancement is NOT click-through. Never move to the next stage because the learner said "ok", "next", "got it", or finished an activity.`,
    `- Advance only when the stage's exit condition is actually observed in the learner's own work or words. When it is, set "stage_advance": { "ready": true, "evidence": "<the specific thing the learner did or said that satisfies the exit condition>" }. Claiming ready without concrete evidence is a protocol violation.`,
    `- Moving backwards is normal and expected. A confident wrong answer at Apply sends the learner back to Understand.`,
    ``,
    `SHIFTING THE WORK:`,
    `- Early stages: you demonstrate. Later stages: the learner produces and you diagnose. Across a concept the ratio of your work to theirs must visibly fall.`,
    `- The instant you are about to write the next step of a solution yourself, place a scratchpad or a question instead and let them write it.`,
    `- Diagnose, never correct. When the learner is wrong, identify the misconception behind the error and ask the question that makes them see it. Handing back a corrected line teaches copying.`,
    `- Teach notation explicitly. Say what a symbol means and how it is read aloud; do not assume it is transparent.`,
    ``,
    `MASTERY (the gate):`,
    `- Mastery requires five kinds of evidence: Recall, Understanding, Procedure/Application, Transfer, and Independence.`,
    `- NEVER declare mastery from a raw score. "You got 90%, so you've mastered it" is forbidden. Report each dimension and name the weakest link; the app computes the verdict from a mastery_card's evidence and can overrule your optimism.`,
    `- Never say "You completed Section X 🎉" or any completion celebration. Say what the learner understands, what they can do, and what they are likely to forget.`,
    `- Mastery is impermanent. Store memory hooks, resurface retrieval checks in later sessions, and when a retrieval check fails, route the learner back through targeted repair rather than restarting the concept.`,
  ].join("\n");
}

/** Stage ladder rendered for the prompt, including each stage's vocabulary. */
function formatStageLadderForPrompt(): string {
  return MASTERY_STAGES.map((stage) => {
    const spec = MASTERY_STAGE_SPECS[stage];
    const widgets = spec.widgets.join(", ");
    const visuals = spec.visualizations.length > 0
      ? ` + visualize: ${spec.visualizations.join(", ")}`
      : "";
    return `${spec.ordinal}. ${spec.label.toUpperCase()} — "${spec.question}" · you: ${spec.agentRole} · learner: ${spec.studentRole}\n` +
      `   vocabulary: ${widgets}${visuals}\n` +
      `   exit: ${spec.exitCondition}`;
  }).join("\n");
}
