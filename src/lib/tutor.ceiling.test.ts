import { describe, it, expect } from "vitest";
import { enforceLearnerAgency, enforceSupportCeiling, type BoardOp, type TutorTurn } from "./tutor";
import type { BoardDoc } from "../data/boards";
import type { WidgetIntent } from "./widgets/types";

/**
 * The support ceiling is stated in the prompt and the model usually respects
 * it. "Usually" is the whole problem.
 *
 * The routes that carry a ceiling of zero are precisely the ones whose only
 * purpose is measurement. A hint on a due retrieval does not degrade that
 * measurement, it destroys it: there is no partial credit for a prompted
 * recall, you simply no longer know whether the learner could produce it, and
 * no later turn recovers the lost observation. A constraint that important
 * cannot depend on the model having read carefully at token 12,000.
 *
 * The second thing these tests protect is honesty. Withheld help must be
 * visible. A learner who is told help is being held back deliberately is being
 * treated as an adult; a learner whose hint quietly disappeared is being
 * gaslit by their study tool.
 */

function turn(boardOps: BoardOp[], speech = "Here's the next step."): TutorTurn {
  return { speech, boardOps, evidenceRefs: [] };
}

const hint = (levels: (1 | 2 | 3)[]): WidgetIntent => ({
  kind: "hint",
  id: "h1",
  steps: levels.map((level) => ({
    level,
    label: `Level ${level}`,
    body: `Body for level ${level}`,
  })),
});

const example: WidgetIntent = {
  kind: "example",
  id: "e1",
  problem: "Differentiate sin(x^2)",
  steps: [{ id: "s1", expression: "2x cos(x^2)", why: "chain rule" }],
};

const reveal: WidgetIntent = {
  kind: "reveal",
  id: "r1",
  items: [{ id: "i1", label: "Answer", content: "2x cos(x^2)" }],
};

const question: WidgetIntent = {
  kind: "question",
  id: "q1",
  prompt: "What is the derivative of the inside function?",
  format: "short_answer",
};

describe("Support ceiling enforcement", () => {
  it("strips a hint entirely under an unaided ceiling", () => {
    const result = enforceSupportCeiling(turn([{ op: "place_widget", intent: hint([1, 2, 3]) }]), 0);
    expect(result.boardOps).toHaveLength(0);
  });

  it("says out loud that help was withheld", () => {
    const result = enforceSupportCeiling(turn([{ op: "place_widget", intent: hint([1]) }]), 0);
    // Silent removal would leave the learner staring at a turn that promised
    // help and delivered nothing, with no way to know why.
    expect(result.speech).toContain("on purpose");
    expect(result.speech.length).toBeGreaterThan("Here's the next step.".length);
  });

  it("keeps the orientation rung and removes the deeper ones at ceiling 1", () => {
    const result = enforceSupportCeiling(turn([{ op: "place_widget", intent: hint([1, 2, 3]) }]), 1);
    expect(result.boardOps).toHaveLength(1);
    const intent = (result.boardOps[0] as { intent: WidgetIntent }).intent;
    expect(intent.kind).toBe("hint");
    if (intent.kind === "hint") {
      // Level 1 under a ceiling of 1 is legitimate help. What must be
      // unreachable is the rung that does the work for them.
      expect(intent.steps.map((s) => s.level)).toEqual([1]);
    }
  });

  it("leaves a hint untouched when every rung is within the ceiling", () => {
    const original = turn([{ op: "place_widget", intent: hint([1, 2]) }]);
    const result = enforceSupportCeiling(original, 2);
    expect(result).toBe(original);
    // No trimming means no notice: announcing a restriction that did not bite
    // would train the learner to ignore the message.
    expect(result.speech).toBe("Here's the next step.");
  });

  it("passes a turn through untouched at the top of the ladder", () => {
    const original = turn([
      { op: "place_widget", intent: hint([1, 2, 3]) },
      { op: "place_widget", intent: example },
    ]);
    expect(enforceSupportCeiling(original, 3)).toBe(original);
  });

  it("treats a worked example as the substantive support it is", () => {
    // Watching the method performed IS level-2 help, whatever the widget is
    // called. Letting it through under a zero ceiling would make the ceiling
    // trivially bypassable by choosing a different widget.
    expect(enforceSupportCeiling(turn([{ op: "place_widget", intent: example }]), 0).boardOps).toHaveLength(0);
    expect(enforceSupportCeiling(turn([{ op: "place_widget", intent: example }]), 1).boardOps).toHaveLength(0);
    expect(enforceSupportCeiling(turn([{ op: "place_widget", intent: example }]), 2).boardOps).toHaveLength(1);
  });

  it("treats a reveal as a hint with extra steps", () => {
    expect(enforceSupportCeiling(turn([{ op: "place_widget", intent: reveal }]), 0).boardOps).toHaveLength(0);
  });

  it("never removes the widget that hands work back", () => {
    const result = enforceSupportCeiling(
      turn([
        { op: "place_widget", intent: question },
        { op: "place_widget", intent: hint([2, 3]) },
      ]),
      0
    );
    // Enforcement must not turn a task into silence. The question is the point
    // of the turn; the hint was the part that broke policy.
    expect(result.boardOps).toHaveLength(1);
    expect((result.boardOps[0] as { intent: WidgetIntent }).intent.kind).toBe("question");
  });

  it("leaves presentational and housekeeping operations alone", () => {
    const ops: BoardOp[] = [
      { op: "write_text", text: "Recall that the chain rule composes two rates." },
      { op: "write_latex", tex: "\\frac{d}{dx}f(g(x))" },
      { op: "delete_block", targetIndex: 2 },
      { op: "redraw_block", targetIndex: 1 },
    ];
    const result = enforceSupportCeiling(turn(ops), 0);
    // A ceiling limits help, not speech. Over-reaching here would silently
    // delete legitimate teaching content.
    expect(result.boardOps).toHaveLength(4);
  });

  it("closes the update_widget bypass", () => {
    // Placing a compliant hint and then upgrading it in place would otherwise
    // be an obvious way around the ceiling.
    const result = enforceSupportCeiling(
      turn([{ op: "update_widget", targetAnchor: "agent-1", intent: hint([3]) }]),
      1
    );
    expect(result.boardOps).toHaveLength(0);
  });

  it("closes the block-wrapper bypass", () => {
    const result = enforceSupportCeiling(
      turn([
        { op: "insert_after", targetIndex: 0, block: { kind: "widget", intent: example } },
        { op: "replace_block", targetIndex: 1, block: { kind: "widget", intent: question } },
      ]),
      0
    );
    expect(result.boardOps).toHaveLength(1);
    expect(result.boardOps[0].op).toBe("replace_block");
  });

  it("closes the spawned-thread bypass without discarding the thread", () => {
    const result = enforceSupportCeiling(
      turn([
        {
          op: "spawn_thread",
          title: "Chain rule detour",
          reason: "Worth separating out",
          initialBlocks: [
            { kind: "text", text: "Let's look at composition on its own." },
            { kind: "widget", intent: example },
            { kind: "widget", intent: question },
          ],
        },
      ]),
      0
    );
    expect(result.boardOps).toHaveLength(1);
    const spawned = result.boardOps[0];
    expect(spawned.op).toBe("spawn_thread");
    if (spawned.op === "spawn_thread") {
      // The investigation is legitimate; only the worked example inside it was
      // off-policy. Dropping the whole thread would destroy the turn.
      expect(spawned.initialBlocks).toHaveLength(2);
      expect(spawned.initialBlocks.some((b) => b.kind === "widget" && b.intent.kind === "example")).toBe(false);
    }
  });

  it("produces a notice even when the turn had no speech at all", () => {
    const result = enforceSupportCeiling(turn([{ op: "place_widget", intent: hint([2]) }], ""), 0);
    expect(result.speech.trim().length).toBeGreaterThan(0);
  });

  it("gives a gentler explanation at ceiling 1 than at ceiling 0", () => {
    const strict = enforceSupportCeiling(turn([{ op: "place_widget", intent: hint([3]) }]), 0);
    const loose = enforceSupportCeiling(turn([{ op: "place_widget", intent: hint([1, 3]) }]), 1);
    expect(strict.speech).not.toBe(loose.speech);
    expect(loose.speech).toContain("orientation");
  });
});

/**
 * The never-passive rule is right and its old unit was wrong.
 *
 * Demanding a fresh commitment on every single turn sounds like rigour and
 * reads as harassment. A learner who asks a clarifying question halfway
 * through a problem gets answered and immediately handed a second task, so the
 * first is abandoned; do that four times and the board is a column of
 * half-answered questions. The pressure also pushes the tutor toward filler —
 * "and what do you think happens next?" — which teaches nothing and trains the
 * learner that most prompts are noise worth skimming past.
 *
 * The obligation is unchanged. Only its unit moved, from the turn to the cycle.
 */
describe("One commitment per cycle", () => {
  const openQuestion: BoardDoc = {
    id: "b1",
    title: "Chain rule",
    subtitle: "",
    domain: "math",
    blocks: [{ id: "blk1", kind: "widget", intent: question }],
  };

  const answeredQuestion: BoardDoc = {
    ...openQuestion,
    blocks: [{ id: "blk1", kind: "widget", intent: question, state: { submitted: true } }],
  };

  const explanatoryTurn = turn([{ op: "write_text", text: "The outer function is the sine." }]);

  it("nags a purely explanatory turn when nothing is outstanding", () => {
    const result = enforceLearnerAgency(explanatoryTurn, answeredQuestion);
    // With the previous task closed, an explanation that hands nothing back
    // leaves the learner watching.
    expect(result.speech).not.toBe(explanatoryTurn.speech);
  });

  it("lets an explanation stand while the learner is mid-task", () => {
    const result = enforceLearnerAgency(explanatoryTurn, openQuestion);
    // They asked something mid-problem. Answering it and letting them get back
    // to work is the correct move, not a policy violation.
    expect(result).toBe(explanatoryTurn);
  });

  it("still nags when there is no board at all", () => {
    // No board means no evidence of an open commitment, and the safe default is
    // to hand the work back.
    expect(enforceLearnerAgency(explanatoryTurn).speech).not.toBe(explanatoryTurn.speech);
  });

  it("does not count a presentational widget as an open commitment", () => {
    const board: BoardDoc = {
      ...openQuestion,
      blocks: [
        { id: "blk1", kind: "widget", intent: { kind: "roadmap", id: "r", steps: [{ id: "s1", label: "Start" }] } },
      ],
    };
    // Reading a roadmap is not owing an answer. Treating it as one would
    // silently disable the never-passive rule for any board with a roadmap on
    // it, which is most of them.
    expect(enforceLearnerAgency(explanatoryTurn, board).speech).not.toBe(explanatoryTurn.speech);
  });

  it("finds an open commitment nested inside a row", () => {
    const board: BoardDoc = {
      ...openQuestion,
      blocks: [
        {
          id: "row1",
          kind: "row",
          children: [{ id: "blk1", kind: "widget", intent: question }],
        },
      ],
    };
    expect(enforceLearnerAgency(explanatoryTurn, board)).toBe(explanatoryTurn);
  });

  it("never suppresses the check for a turn that already hands work back", () => {
    const active = turn([{ op: "place_widget", intent: question }]);
    expect(enforceLearnerAgency(active, openQuestion)).toBe(active);
    expect(enforceLearnerAgency(active, answeredQuestion)).toBe(active);
  });

  it("leaves a pure-speech turn alone regardless of the board", () => {
    const speechOnly = turn([], "Yes, exactly — the inside function is x squared.");
    expect(enforceLearnerAgency(speechOnly, answeredQuestion)).toBe(speechOnly);
  });
});
