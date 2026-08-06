/**
 * The tutor voice (§14) — the web equivalent of voice/en.toml.
 *
 * This file is load-bearing and test-enforced:
 *  - no line may contain the forbidden reward/failure vocabulary (Law 4, Law 6);
 *  - every contradiction line must end with a question (the anticipation of
 *    the answer is the mechanism; a line that closes the loop kills it).
 *
 * Deterministic selection: lines are chosen by hashing the attempt id, so
 * behaviour is reproducible in tests (§14.1).
 */

import { hashString } from "../core/types";

export interface VoiceFile {
  contradiction: {
    predict: { default: string[]; misconception: Record<string, string[]> };
    explain: { default: string[] };
    modify: { default: string[] };
    write: { default: string[] };
  };
  confirmation: { predict: string[]; explain: string[]; modify: string[]; write: string[] };
  tier3Disclaimer: string[];
  heuristicDisclaimer: string[];
  surfaceNote: string[];
  multistructuralPrompt: string[];
  afterFirstPair: string;
  nothingDue: string;
  scaffoldOffered: string;
}

/** Placeholders: {learner} = the committed prediction, {actual} = the recorded outcome. */
export const VOICE_EN: VoiceFile = {
  contradiction: {
    predict: {
      default: [
        "Not what happened — and the gap is the interesting part. You said {learner}. It said {actual}. What would have to be true for your version to be right?",
        "Close, but the machine disagrees: {actual}. Before I say anything else — where do you think it diverged from your version?",
        "Here's the split: you predicted {learner}, it produced {actual}. One assumption in your head is doing all the damage. Which one?",
        "You and the recorded run disagree, which means one of you is holding a rule the other isn't. It printed {actual}. Which rule is the other one holding?",
        "That's a real prediction, and it's off by something specific. It gave {actual}. Can you name the specific thing?",
      ],
      misconception: {
        "range-includes-upper": [
          "You're off by exactly one step of the loop, and that is almost always the same rule biting: range stops *before* its argument. It printed {actual}. Re-run it in your head with that rule — what does it print now?",
        ],
        "boundary-included": [
          "You let the boundary value through — and the comparison here is strict. It printed {actual}. What does the operator actually demand at the boundary?",
        ],
        "append-returns-list": [
          "You expected the list back from a method that returns nothing. It printed {actual}. Which value does the method hand over, and which one changed anyway?",
        ],
        "string-mutated-in-place": [
          "You treated the string as something that changes where it stands. It printed {actual}. Which value stayed put, and which one is brand new?",
        ],
        "dict-overwrite": [
          "You replaced the old value instead of building on it. It printed {actual}. What does the assignment do to what was already stored?",
        ],
      },
    },
    explain: {
      default: [
        "Your sentence circles the program without naming what it's for. The rubric is only keyword-matching, so use it loosely — but in one sentence, what does this program produce, and from what?",
        "That reads the lines back to me, and I'm after the purpose. If this program were a tool on a shelf, what job would it do?",
      ],
    },
    modify: {
      default: [
        "The completion doesn't reach the target yet — the finished program produces {actual}. Which hole is doing something other than what the target asks?",
        "One of the blanks isn't pulling in the target's direction. The target's result is {actual}. What would have to sit in that hole to get there?",
      ],
    },
    write: {
      default: [
        "The specification and your program disagree about something concrete, and the first unmet check is named above. What does it demand — and what did you write instead?",
        "Close to the spec, but one check is unmet. Read its label, then read your code at exactly that spot. Which assumption differs?",
      ],
    },
  },
  confirmation: {
    predict: [
      "Exactly right. Now the harder half: say what it does, in one sentence.",
      "That's it. Can you say why, without tracing it line by line?",
      "Your model and the machine agree. Hold that — and name the rule that made them agree.",
    ],
    explain: [
      "That reads like the purpose, not the transcript. Compare it with the exemplar anyway — which of the two would a stranger understand faster?",
      "The shape of that explanation is the one I'm after. What would you add for someone who has never seen a loop?",
    ],
    modify: [
      "That completion reaches the target exactly. Can you say what you changed, and why it was the minimal change?",
      "The target and your version now agree. Which hole carried the most weight — and why?",
    ],
    write: [
      "Every check you can see is satisfied. Before moving on — which part of this would you least trust on data you haven't seen?",
      "The structure holds and your dry-run agrees with the recorded case. What would you test next if a machine could run it for you?",
    ],
  },
  tier3Disclaimer: [
    "There's no single right answer here, so I'm not going to pretend to check yours. Read it, form a view, and I'll ask you about it again in a week.",
  ],
  heuristicDisclaimer: [
    "I'm matching keywords here, not really reading your explanation. Take my verdict loosely — compare yours to the exemplar and judge for yourself.",
  ],
  surfaceNote: [
    "Heads up on honesty: this page can't run Python, so nothing you write here is executed. Verdicts on this beat are structural checks plus a dry-run you evaluate yourself — treat them as a strong hint, not a trial.",
  ],
  multistructuralPrompt: [
    "That explanation narrates the lines one after another — the signal I'm after is the purpose. Try once more, in one sentence, at the level of what the program is for.",
  ],
  afterFirstPair:
    "Prediction is the road; writing from blank is the destination. The map shows where this goes.",
  nothingDue:
    "Nothing new is due right now — spacing does part of the work between sessions. Come back tomorrow.",
  scaffoldOffered:
    "Here's an easier way in — same question, softer shape. The commit still has to be yours.",
};

/** deterministic line selection — hash the attempt id so tests reproduce behaviour (§14.1) */
export function pickLine(lines: string[], seed: string): string {
  if (lines.length === 0) return "";
  return lines[hashString(seed) % lines.length];
}

export function fillLine(line: string, vars: Record<string, string>): string {
  return line.replace(/\{(\w+)\}/g, (match, key: string) => vars[key] ?? match);
}
