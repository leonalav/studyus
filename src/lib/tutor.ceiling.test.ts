import { describe, it, expect } from "vitest";
import { enforceSupportCeiling, turnLeavesLearnerSomethingToDo, type BoardOp, type TutorTurn } from "./tutor";
import { createLessonStep } from "./lessonStep";
import type { BoardDoc } from "../data/boards";
import type { WidgetIntent, WidgetKind } from "./widgets/types";

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
  it("preserves the permitted direct-instruction presentation vocabulary", () => {
    const allowed: WidgetKind[] = ["concept_card", "example", "annotation"];
    const result = enforceSupportCeiling(
      turn([
        { op: "place_widget", intent: { kind: "concept_card", term: "Limit", definition: "A value approached by a function." } },
        { op: "place_widget", intent: example },
        { op: "place_widget", intent: question },
        {
          op: "spawn_thread",
          title: "Instruction",
          reason: "A bounded explanation",
          initialBlocks: [
            { kind: "widget", intent: example },
            { kind: "widget", intent: question },
          ],
        },
      ]),
      0,
      { route: "direct_instruction", permittedWidgetKinds: allowed }
    );

    expect(result.boardOps).toHaveLength(3);
    expect(result.boardOps.some((op) => op.op === "place_widget" && op.intent.kind === "question")).toBe(false);
    const thread = result.boardOps.find((op) => op.op === "spawn_thread");
    expect(thread?.op).toBe("spawn_thread");
    if (thread?.op === "spawn_thread") {
      expect(thread.initialBlocks).toHaveLength(1);
      expect(thread.initialBlocks[0].kind).toBe("widget");
    }
  });

  it("removes a hint entirely at ceiling 0", () => {
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
describe("One commitment per cycle — LessonStep invariants", () => {
  // Phase 1 cleanup: `enforceLearnerAgency` is gone. Its invariant — "a
  // presentation-only turn that hands the learner nothing to do violates
  // policy" — now lives on `LessonStep` at construction. A presentation
  // route (`direct_instruction`) without prose slots is unservable, and a
  // step with an empty permitted vocabulary is unservable. The
  // `turnLeavesLearnerSomethingToDo` helper remains as a pure predicate for
  // Phase 3 callers that re-check a finished turn against the structural
  // step.
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

  it("flags a purely explanatory turn as leaving the learner nothing to do", () => {
    expect(turnLeavesLearnerSomethingToDo(explanatoryTurn)).toBe(false);
  });

  it("lets an explanation stand while the learner is mid-task (helper check)", () => {
    // The helper itself doesn't care about the board — that decision moved
    // upstream. Phase 3 will check it against the structural step.
    expect(turnLeavesLearnerSomethingToDo(explanatoryTurn)).toBe(false);
  });

  it("LessonStep rejects direct_instruction with zero prose slots (the runtime check)", () => {
    expect(() =>
      createLessonStep({
        route: "direct_instruction",
        targetSkillIds: ["chain_rule"],
        stage: "understand",
        mode: "instruction",
        supportCeiling: 3,
        requiredEvidence: [],
        permittedWidgetKinds: ["concept_card", "example"],
        proseSlots: [],
        maxBoardOps: 4,
      })
    ).toThrow(/unservable.*direct_instruction.*prose slot/i);
  });

  it("does not count a presentational widget as an open commitment (helper only)", () => {
    // Reading a roadmap is not owing an answer. The helper inspects a turn,
    // not the board, so it correctly flags a presentation-only turn as one
    // that hands nothing back; Phase 3 wires the open-commitment check.
    const board: BoardDoc = {
      ...openQuestion,
      blocks: [
        { id: "blk1", kind: "widget", intent: { kind: "roadmap", id: "r", steps: [{ id: "s1", label: "Start" }] } },
      ],
    };
    expect(turnLeavesLearnerSomethingToDo(explanatoryTurn)).toBe(false);
    void board;
  });

  it("finds an open commitment nested inside a row (helper data shape)", () => {
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
    expect(turnLeavesLearnerSomethingToDo(explanatoryTurn)).toBe(false);
    void board;
  });

  it("never suppresses the structural check for a turn that already hands work back", () => {
    const active = turn([{ op: "place_widget", intent: question }]);
    expect(turnLeavesLearnerSomethingToDo(active)).toBe(true);
  });

  it("leaves a pure-speech turn alone regardless of the board", () => {
    const speechOnly = turn([], "Yes, exactly — the inside function is x squared.");
    expect(turnLeavesLearnerSomethingToDo(speechOnly)).toBe(true);
  });
});

/**
 * The exposition budget (post-Phase 1) is structurally bounded by
 * `LessonStep.proseSlots`. A `direct_instruction` step must carry at least
 * one prose slot and the runtime asks `turnLeavesLearnerSomethingToDo` to
 * confirm a finished turn actually said what the step promised.
 */
describe("Exposition budget — LessonStep + helper", () => {
  const presentationalTurn: TutorTurn = {
    speech: "The derivative of x squared is 2x by the power rule.",
    boardOps: [{ op: "write_latex", tex: "\\frac{d}{dx}x^2 = 2x" }],
    evidenceRefs: [],
  };

  const activeTurn: TutorTurn = {
    speech: "Try this yourself.",
    boardOps: [
      {
        op: "place_widget",
        intent: {
          kind: "question",
          id: "q1",
          prompt: "What is the derivative of x^3?",
          format: "short_answer",
        },
      },
    ],
    evidenceRefs: [],
  };

  it("recognizes a presentation-only turn as exposition", () => {
    expect(turnLeavesLearnerSomethingToDo(presentationalTurn)).toBe(false);
  });

  it("recognizes a turn with an actionable widget as not exposition", () => {
    expect(turnLeavesLearnerSomethingToDo(activeTurn)).toBe(true);
  });

  it("LessonStep requires prose slots for direct_instruction", () => {
    expect(() =>
      createLessonStep({
        route: "direct_instruction",
        targetSkillIds: ["x_squared"],
        stage: "understand",
        mode: "instruction",
        supportCeiling: 3,
        requiredEvidence: [],
        permittedWidgetKinds: ["example", "concept_card"],
        proseSlots: [],
        maxBoardOps: 4,
      })
    ).toThrow(/unservable/i);
  });

  it("LessonStep accepts a direct_instruction step with a single concise prose slot", () => {
    const step = createLessonStep({
      route: "direct_instruction",
      targetSkillIds: ["x_squared"],
      stage: "understand",
      mode: "instruction",
      supportCeiling: 3,
      requiredEvidence: [],
      permittedWidgetKinds: ["example", "concept_card"],
      proseSlots: [{ blockId: "slot-1", hint: "Walk through d/dx x^2.", tone: "worked" }],
      maxBoardOps: 4,
    });
    expect(step.proseSlots).toHaveLength(1);
    expect(step.proseSlots[0].tone).toBe("worked");
  });

  it("consecutive presentation-only turns would increment the streak (helper)", () => {
    const turnA: TutorTurn = {
      speech: "First explanation.",
      boardOps: [{ op: "write_text", text: "Key concept." }],
      evidenceRefs: [],
    };
    const turnB: TutorTurn = {
      speech: "Second explanation.",
      boardOps: [{ op: "write_latex", tex: "E = mc^2" }],
      evidenceRefs: [],
    };
    // Both are presentation-only: the helper flags them, and Phase 3's
    // exposition counter would increment on each.
    expect(turnLeavesLearnerSomethingToDo(turnA)).toBe(false);
    expect(turnLeavesLearnerSomethingToDo(turnB)).toBe(false);
  });

  it("a turn with an active widget resets the streak to 0 (helper)", () => {
    expect(turnLeavesLearnerSomethingToDo(activeTurn)).toBe(true);
  });

  it("a presentation-only turn would increment the streak (helper)", () => {
    expect(turnLeavesLearnerSomethingToDo(presentationalTurn)).toBe(false);
  });
});
