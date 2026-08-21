/**
 * The help-seeking ladder, enforced in code.
 *
 * The prompt previously said "default to direct help" in one rule and "the
 * learner must have made an independent attempt first" in another, and left the
 * model to reconcile them turn by turn. Prompts do not reconcile; they get
 * sampled. This module makes the reconciliation a function.
 *
 * The ladder:
 *
 *   level 0 — unaided. The learner has not attempted; nothing is unlocked.
 *   level 1 — orientation. Unlocked by a genuine attempt.
 *   level 2 — structural. Unlocked by an attempt plus a failure or an explicit
 *             stuck signal.
 *   level 3 — worked step. Unlocked only after level 2 has been used and has
 *             not resolved it. Forfeits independence and mandates an unaided
 *             reconstruction.
 *
 * Two properties matter more than the specific levels:
 *
 *  1. **The ladder only ever climbs one rung per turn.** A learner who says "just
 *     tell me" does not jump to 3. Escalation that fast is how a tutor becomes
 *     an answer key.
 *  2. **The policy ceiling always wins over the ladder.** If the planner set a
 *     ceiling of 0 for a retrieval, no amount of asking unlocks a hint. The
 *     learner's frustration is real and should be acknowledged in words; it does
 *     not change what the evidence needs to be.
 */

import type { SupportLevel } from "./types";

/** What the learner did this turn, as far as support is concerned. */
export interface AttemptSignal {
  /** The learner produced substantive work on the actual task. */
  madeAttempt: boolean;
  /** The attempt was scored wrong. */
  attemptFailed: boolean;
  /** The learner said, in some form, that they are stuck. */
  requestedHelp: boolean;
  /** The learner asked outright for the answer. */
  requestedAnswer: boolean;
  /** Support level already used on this task family this episode. */
  supportAlreadyUsed: SupportLevel;
}

export interface SupportDecision {
  /** The level the tutor may actually work at this turn. */
  granted: SupportLevel;
  /** The level the ladder would allow, ignoring the policy ceiling. */
  ladderLevel: SupportLevel;
  /** True when the ceiling, not the ladder, is what is binding. */
  ceilingBinding: boolean;
  /** Whether granting this level obliges an unaided reconstruction. */
  requiresReconstruction: boolean;
  /** What the tutor should be told, in plain terms. */
  instruction: string;
}

/** Minimum characters before a response counts as a real attempt rather than a
 *  gesture at one. Short enough to admit "x = 4", long enough to exclude "idk". */
export const MIN_ATTEMPT_CHARS = 4;

const NON_ATTEMPTS = [
  "idk",
  "i dont know",
  "i don't know",
  "no idea",
  "not sure",
  "dunno",
  "help",
  "?",
  "??",
  "???",
];

const HELP_PATTERNS = [
  /\bstuck\b/i,
  /\bhelp\b/i,
  /\bhint\b/i,
  /\bconfus/i,
  /\bdon'?t (get|understand|know how)\b/i,
  /\bno idea\b/i,
  /\bwhere do i (start|begin)\b/i,
];

const ANSWER_PATTERNS = [
  /\bjust tell me\b/i,
  /\bgive me the answer\b/i,
  /\bwhat'?s the answer\b/i,
  /\btell me the answer\b/i,
  /\bshow me the (answer|solution)\b/i,
  /\bsolve it for me\b/i,
  /\bdo it for me\b/i,
];

/**
 * Signs that a message contains work rather than only a report about work.
 *
 * Deliberately generous on symbols and specific on words: a learner who writes
 * "2xh + h^2 over h" has shown their hand, and one who writes "I tried
 * factoring but got stuck" has too. A learner who writes "this is impossible"
 * has not, at any length.
 */
const WORK_PATTERNS = [
  /[=+\-*/^<>]\s*\w/,          // an expression, not just a stray hyphen
  /\b\d+\s*[a-z(]/i,           // a coefficient applied to something
  /\b(?:i|we)\s+(?:tried|got|did|used|applied|started|wrote|calculated|assumed|thought)\b/i,
  /\bmy\s+(?:answer|working|attempt|guess)\b/i,
  /\bbecause\b/i,
  /\bso\s+(?:i|it|that|the)\b/i,
];

function containsWork(message: string): boolean {
  return WORK_PATTERNS.some((pattern) => pattern.test(message));
}

/**
 * Read a learner message for attempt and help signals.
 *
 * Kept deliberately conservative about what counts as an attempt. Treating "idk"
 * as an attempt would unlock support for having typed something, which is the
 * exact behaviour the ladder exists to prevent.
 */
export function readAttemptSignal(
  message: string,
  context: { attemptFailed?: boolean; supportAlreadyUsed?: SupportLevel } = {}
): AttemptSignal {
  const trimmed = message.trim();
  const normalized = trimmed.toLowerCase().replace(/[.!]+$/, "");
  const isNonAttempt =
    trimmed.length < MIN_ATTEMPT_CHARS || NON_ATTEMPTS.includes(normalized);

  const requestedAnswer = ANSWER_PATTERNS.some((pattern) => pattern.test(trimmed));
  const requestedHelp = requestedAnswer || HELP_PATTERNS.some((pattern) => pattern.test(trimmed));

  // A message that is ONLY a request for help is not an attempt, however long
  // it is. "I really don't understand any of this at all" is a report, not work.
  //
  // Length alone cannot make this call. Judging by length punishes the exact
  // behaviour the ladder is built to reward — attempting, then asking about the
  // specific place it broke down — because a terse, correct piece of work plus a
  // pointed question is short, while a fluent complaint is long. So look for
  // traces of work instead: notation, a computed value, or reasoning about what
  // the learner did. Only a help request with no such trace is a bare request.
  const isOnlyHelpRequest = requestedHelp && !containsWork(trimmed);

  return {
    madeAttempt: !isNonAttempt && !isOnlyHelpRequest,
    attemptFailed: context.attemptFailed ?? false,
    requestedHelp,
    requestedAnswer,
    supportAlreadyUsed: context.supportAlreadyUsed ?? 0,
  };
}

/**
 * Decide how much support the tutor may give this turn.
 *
 * The single most important line in this function is the `Math.min` against the
 * policy ceiling. Everything else is the ladder; that line is what makes the
 * ladder subordinate to the evidence the current move needs to produce.
 */
export function decideSupport(
  signal: AttemptSignal,
  policyCeiling: SupportLevel
): SupportDecision {
  let ladderLevel: SupportLevel = 0;

  if (!signal.madeAttempt) {
    // No attempt: nothing unlocks, no matter how the request was phrased.
    ladderLevel = 0;
  } else if (signal.attemptFailed || signal.requestedHelp) {
    // Attempted and blocked. Climb exactly one rung from wherever support
    // already stands, never straight to the top.
    ladderLevel = Math.min(3, Math.max(1, signal.supportAlreadyUsed + 1)) as SupportLevel;
  } else {
    // Attempted and not blocked — orientation is available if useful, but the
    // learner has not shown they need more.
    ladderLevel = 1;
  }

  const granted = Math.min(ladderLevel, policyCeiling) as SupportLevel;
  const ceilingBinding = policyCeiling < ladderLevel;

  return {
    granted,
    ladderLevel,
    ceilingBinding,
    requiresReconstruction: granted >= 2,
    instruction: buildInstruction(signal, granted, ladderLevel, policyCeiling),
  };
}

function buildInstruction(
  signal: AttemptSignal,
  granted: SupportLevel,
  ladderLevel: SupportLevel,
  ceiling: SupportLevel
): string {
  const parts: string[] = [];

  if (!signal.madeAttempt && signal.requestedAnswer) {
    parts.push(
      "The learner asked for the answer without attempting. Do not supply it and do not negotiate. Say plainly that you will help them get there and that you need to see their first move — then make the task smaller or more concrete so the first move is easy to take. Reducing the task is allowed; doing the task is not."
    );
  } else if (!signal.madeAttempt && signal.requestedHelp) {
    parts.push(
      "The learner reported being stuck but has not attempted. Do not hint yet. Find out WHERE they are stuck with one question — what the task is asking, or which step they cannot start — because helping past the wrong obstacle wastes the turn and teaches them that saying 'stuck' produces answers."
    );
  } else if (!signal.madeAttempt) {
    parts.push(
      "No attempt has been made on this task yet. Hand the work back before offering anything."
    );
  }

  if (granted === 0 && signal.madeAttempt) {
    parts.push(
      "Support level 0: you may confirm what the task is asking and nothing else. No hints, no narrowing, no leading questions, no first step."
    );
  }
  if (granted === 1) {
    parts.push(
      "Support level 1 — orientation only: point at WHERE to look or WHICH idea is in play. Do not name the method and do not perform any part of the work."
    );
  }
  if (granted === 2) {
    parts.push(
      "Support level 2 — structural: you may name the method or break the problem into steps. You may not execute the step that carries the answer. Because this is substantive support, an unaided reconstruction on a similar task is now owed and will be scheduled."
    );
  }
  if (granted === 3) {
    parts.push(
      "Support level 3 — worked step: you may demonstrate one step, then hand the next one straight back. Independence evidence for this task is forfeited and an unaided reconstruction is mandatory. Do not complete the whole problem."
    );
  }

  if (ladderLevel > ceiling) {
    parts.push(
      `The learner's behaviour would ordinarily unlock level ${ladderLevel}, but the current move caps support at ${ceiling}. Acknowledge the difficulty honestly — say that you are holding back deliberately and why — rather than pretending you have nothing to offer.`
    );
  }

  if (signal.requestedAnswer && granted < 3) {
    parts.push(
      "They asked for the answer outright. Name that you heard it. A refusal that ignores the request reads as evasion; a refusal that acknowledges it reads as a decision."
    );
  }

  return parts.join(" ");
}

/**
 * The routing table that resolves the old rule 2 / rule 3 contradiction.
 *
 * Rule 2 said the learner must attempt before any substantive response. Rule 3
 * said to default to direct help and avoid questioning. Both are right in
 * different situations and the old prompt gave no way to tell which situation
 * it was in, so behaviour came down to sampling.
 *
 * The table below decides. Order is significant: the first matching row wins.
 */
export const RESPONSE_ROUTING_TABLE = [
  {
    condition: "The selected move is direct_instruction for a confirmed cold start.",
    action: "Teach the intuition, core representation or mechanism, essential terminology, and one canonical worked example before asking for a single focused prediction or observation. Do not treat the presentation as learner evidence.",
    reason: "A first-contact learner needs a usable mental model before an Encounter prediction can be meaningful; this exception is bounded to the explicit instructional route.",
  },
  {
    condition: "The learner asks a factual question with no task in play (a definition, a fact, notation, what a symbol means).",
    action: "Answer it directly and briefly. Then return to the current move.",
    reason: "Interrogating someone who asked what a symbol means is not rigour, it is friction.",
  },
  {
    condition: "The learner explicitly asks to see, draw, plot, graph, or visualize something.",
    action: "Render it first, then attach the question the representation makes askable.",
    reason: "Withholding a requested representation to force a guess breaks trust, and the representation itself is usually the better probe.",
  },
  {
    condition: "The learner is blocked mid-task and has already attempted.",
    action: "Give the minimum support the ladder allows for their attempt, and no more.",
    reason: "They have earned support by attempting; over-supplying it takes the work back off them.",
  },
  {
    condition: "The learner asks for the answer to the current task without attempting.",
    action: "Do not supply it. Shrink the task until the first step is takeable, and ask for that step.",
    reason: "The attempt is what produces the evidence; supplying the answer produces nothing but a completed exercise.",
  },
  {
    condition: "The current move's support ceiling is 0 (retrieval, independent practice, transfer check, prediction).",
    action: "Hold the ceiling regardless of what is asked. Acknowledge the ask in words.",
    reason: "These moves exist to measure unaided performance; helping deletes the measurement.",
  },
  {
    condition: "The selected move is diagnostic_probe or prediction and the learner has produced no evidence at all on this skill.",
    action: "Probe or predict before teaching.",
    reason: "Teaching before you know where they are means teaching to an imagined learner, except when the policy has explicitly selected the bounded direct-instruction route.",
  },
  {
    condition: "None of the above.",
    action: "Carry out the planned instructional move.",
    reason: "The planner already decided this from the evidence.",
  },
] as const;

/** Render the routing table for the tutor prompt. */
export function formatRoutingTable(): string {
  const rows = RESPONSE_ROUTING_TABLE.map(
    (row, index) => `${index + 1}. IF ${row.condition}\n   THEN ${row.action}\n   (${row.reason})`
  );
  return [
    "RESPONSE ROUTING — apply the FIRST row that matches. This table replaces any general instruction about whether to ask or tell; it is how those instructions are reconciled.",
    ...rows,
  ].join("\n");
}
