import { describe, it, expect } from "vitest";
import { buildWidgetSignal, buildWidgetSignalMessage, shouldSignalTutor,
  buildWidgetSignalDisplayText,
} from "./signal";
import { isNonInstructionalTutorMessage } from "../tutor";
import type { WidgetIntent } from "./types";

/**
 * A widget the learner answers into silence turns the board into a worksheet.
 * These tests pin the two halves of the contract: WHICH interactions wake the
 * tutor, and WHAT it is obliged to do about them.
 */

const question: WidgetIntent = {
  kind: "question",
  prompt: "Where does the point with polar coordinates (3, π/2) sit?",
  format: "multiple_choice",
  options: [
    { id: "a", label: "On the positive x-axis", misconception: "Treats θ as if it were 0" },
    { id: "b", label: "On the positive y-axis", correct: true },
    { id: "c", label: "On the negative x-axis", misconception: "Reads π/2 as a half turn" },
  ],
};

describe("which interactions wake the tutor", () => {
  it("signals when an answer is committed", () => {
    expect(shouldSignalTutor(question, {}, { selectedOptionId: "a", submitted: true })).toBe(true);
  });

  it("does not signal twice for an already-answered widget", () => {
    const answered = { selectedOptionId: "a", submitted: true };
    expect(shouldSignalTutor(question, answered, { ...answered, correct: false })).toBe(false);
  });

  it("does not signal on selection before submission", () => {
    expect(shouldSignalTutor(question, {}, { selectedOptionId: "a" })).toBe(false);
  });

  it("stays silent while the learner is exploring", () => {
    // Dragging, playing, revealing and opening hints are thinking, not
    // reporting. Interrupting them on every pixel would be worse than useless.
    const slider: WidgetIntent = { kind: "slider", label: "h", parameter: "h", min: 0, max: 2, value: 1 };
    expect(shouldSignalTutor(slider, { sliderValue: 1 }, { sliderValue: 0.4 })).toBe(false);

    const hint: WidgetIntent = { kind: "hint", steps: [{ level: 1, label: "Nudge", body: "…" }] };
    expect(shouldSignalTutor(hint, {}, { hintLevelOpened: 1 })).toBe(false);

    const reveal: WidgetIntent = { kind: "reveal", items: [{ id: "i1", label: "L", content: "C" }] };
    expect(shouldSignalTutor(reveal, {}, { revealedIds: ["i1"] })).toBe(false);
  });

  it("signals for every widget that asks the learner to produce something", () => {
    const producing: WidgetIntent[] = [
      question,
      { kind: "scratchpad", prompt: "Your turn." },
      { kind: "reflection", prompt: "Explain it back." },
      { kind: "challenge", prompt: "On your own." },
      { kind: "retrieval_check", prompt: "From memory?", format: "short_answer", acceptedAnswers: ["x"] },
      { kind: "mistake_check", lines: [{ id: "l1", content: "wrong", status: "error", diagnosis: "why" }] },
    ];
    for (const intent of producing) {
      expect(shouldSignalTutor(intent, {}, { submitted: true })).toBe(true);
    }
  });
});

describe("what the tutor is told", () => {
  it("names the misconception behind a wrong choice and forbids just giving the answer", () => {
    const message = buildWidgetSignalMessage(
      question,
      { selectedOptionId: "a", submitted: true, correct: false },
      "encounter"
    );
    expect(message).toContain("Treats θ as if it were 0");
    expect(message).toMatch(/Do NOT simply give the correct answer/);
    expect(message).toMatch(/diagnose that specific misconception/i);
    expect(message).toContain("On the positive x-axis");
  });

  it("refuses to let a right answer end the stage by itself", () => {
    const message = buildWidgetSignalMessage(
      question,
      { selectedOptionId: "b", submitted: true, correct: true },
      "encounter"
    );
    expect(message).toMatch(/Do not just say "correct" and move on/);
    expect(message).toMatch(/one right answer is not the exit condition/i);
    expect(message).toMatch(/sound rather than lucky/i);
  });

  it("treats a failed retrieval check as evidence of forgetting", () => {
    const retrieval: WidgetIntent = {
      kind: "retrieval_check",
      prompt: "From memory: what does f'(x) measure?",
      format: "short_answer",
      acceptedAnswers: ["the slope of the tangent"],
    };
    const message = buildWidgetSignalMessage(
      retrieval,
      { responseText: "the area under the curve", submitted: true, correct: false },
      "master"
    );
    expect(message).toMatch(/evidence of forgetting/i);
    expect(message).toMatch(/targeted repair/i);
    expect(message).toMatch(/rather than restarting the concept/i);
  });

  it("tells the tutor to diagnose scratchpad work rather than finish it", () => {
    const scratchpad: WidgetIntent = { kind: "scratchpad", prompt: "Expand (x+h)^2." };
    const attempted = buildWidgetSignalMessage(
      scratchpad,
      { responseText: "x^2 + h^2", submitted: true },
      "construct"
    );
    expect(attempted).toContain("x^2 + h^2");
    expect(attempted).toMatch(/Diagnose it line by line/i);
    expect(attempted).toMatch(/Do not complete the problem for me/i);

    const blank = buildWidgetSignalMessage(scratchpad, { submitted: true }, "construct");
    expect(blank).toMatch(/did not attempt it/i);
    expect(blank).toMatch(/Do not solve it/i);
  });

  it("treats a reflection as the primary evidence of understanding", () => {
    const reflection: WidgetIntent = { kind: "reflection", prompt: "Why do we need the limit?" };
    const message = buildWidgetSignalMessage(
      reflection,
      { responseText: "because dividing by zero breaks", submitted: true },
      "understand"
    );
    expect(message).toMatch(/best evidence of understanding/i);
    expect(message).toMatch(/fluent procedure with an incoherent explanation is NOT understanding/i);
  });

  it("always carries the current stage and its exit condition", () => {
    const message = buildWidgetSignalMessage(question, { selectedOptionId: "b", submitted: true, correct: true }, "apply");
    expect(message).toMatch(/You are at stage 4 \(Apply\)/);
    expect(message).toMatch(/Respond to what I just did on the board/i);
    expect(message).toMatch(/Only set stage_advance\.ready if this interaction genuinely satisfied/i);
  });
});

describe("the composed signal", () => {
  it("returns null for interactions that do not deserve a turn", () => {
    expect(buildWidgetSignal("w1", question, {}, { selectedOptionId: "a" }, "encounter")).toBeNull();
  });

  it("shows the learner what they did without pre-empting the diagnosis", () => {
    const signal = buildWidgetSignal(
      "w1",
      question,
      {},
      { selectedOptionId: "a", submitted: true, correct: false },
      "encounter"
    );
    expect(signal).not.toBeNull();
    expect(signal!.displayText).toBe('Answered the question: "On the positive x-axis"');
    // The transcript must not announce the verdict — that is the tutor's move.
    expect(signal!.displayText).not.toMatch(/wrong|incorrect|✗/i);
    expect(signal!.displayText).not.toContain("Treats θ");
    expect(signal!.correct).toBe(false);
  });

  it("never produces a message the board-necessity guard would silence", () => {
    // enforceTutorBoardNecessity forces board_ops:[] for social chat. A widget
    // answer must never be mistaken for one, or the tutor would be structurally
    // unable to respond on the board.
    const intents: WidgetIntent[] = [
      question,
      { kind: "scratchpad", prompt: "Your turn." },
      { kind: "reflection", prompt: "Explain." },
      { kind: "challenge", prompt: "On your own." },
    ];
    for (const intent of intents) {
      const signal = buildWidgetSignal("w1", intent, {}, { submitted: true, responseText: "ok" }, "construct");
      expect(signal).not.toBeNull();
      expect(isNonInstructionalTutorMessage(signal!.message)).toBe(false);
    }
  });
});

describe("exploration widgets signal only when the agent asked for a response", () => {
  /**
   * Slider, Animation, Hint and Annotation teach by exploration, which on its
   * own is not evidence: a learner who understood the sweep and one who dragged
   * the handle look identical. A `respond` prompt turns the exploration into a
   * claim — and only then is interacting with the widget a turn the tutor owes
   * an answer to. Without it these must stay silent, or the tutor interrupts on
   * every slider pixel.
   */
  const respond = { prompt: "What happens as h shrinks?" };

  const bare: Record<string, WidgetIntent> = {
    slider: { kind: "slider", label: "Spacing h", parameter: "h", min: 0, max: 1, value: 0.5 },
    animation: { kind: "animation", frames: [{ id: "f1", caption: "The secant pivots" }] },
    hint: { kind: "hint", steps: [{ level: 1, label: "Nudge", body: "Look at the denominator." }] },
    annotation: { kind: "annotation", marks: [{ id: "m1", target: "h → 0", note: "This does the work." }] },
  };

  for (const [kind, intent] of Object.entries(bare)) {
    it(`stays silent for a ${kind} with no respond prompt`, () => {
      // Exploration must never wake the tutor on its own.
      expect(shouldSignalTutor(intent, {}, { submitted: true, responseText: "x" })).toBe(false);
      expect(shouldSignalTutor(intent, undefined, { sliderValue: 0.2 })).toBe(false);
      expect(shouldSignalTutor(intent, undefined, { animationProgress: 1 })).toBe(false);
      expect(shouldSignalTutor(intent, undefined, { hintLevelOpened: 3 })).toBe(false);
    });

    it(`signals once for a ${kind} that has one, only on a fresh commit`, () => {
      const asked = { ...intent, respond } as WidgetIntent;
      // Exploring it still says nothing...
      expect(shouldSignalTutor(asked, undefined, { sliderValue: 0.2 })).toBe(false);
      expect(shouldSignalTutor(asked, undefined, { hintLevelOpened: 2 })).toBe(false);
      // ...committing an answer does.
      expect(shouldSignalTutor(asked, {}, { submitted: true, responseText: "It shrinks" })).toBe(true);
      // ...and re-rendering an already-answered widget does not signal twice.
      expect(
        shouldSignalTutor(asked, { submitted: true }, { submitted: true, responseText: "It shrinks" })
      ).toBe(false);
    });
  }

  it("tells the tutor a slider answer is about the relationship, not the number", () => {
    const intent: WidgetIntent = {
      kind: "slider", label: "Spacing h", parameter: "h", min: 0, max: 1, value: 0.5, respond,
    };
    const message = buildWidgetSignalMessage(intent, { sliderValue: 0.05, responseText: "The slope settles", submitted: true }, "understand");
    expect(message).toContain("The slope settles");
    expect(message).toMatch(/RELATIONSHIP/);
    expect(message).toMatch(/h = 0\.05/);
  });

  it("treats a prediction as evidence only because it was committed before watching", () => {
    const intent: WidgetIntent = {
      kind: "animation",
      frames: [{ id: "f1", caption: "Projectile arcs" }],
      predictPrompt: "Where will it land?",
      respond,
    };
    const message = buildWidgetSignalMessage(intent, { responseText: "Past the marker", submitted: true }, "apply");
    expect(message).toContain("Past the marker");
    expect(message).toContain("Where will it land?");
    expect(message).toMatch(/committed before watching/);
  });

  it("reports the hint level used as independence evidence", () => {
    const intent: WidgetIntent = {
      kind: "hint",
      steps: [
        { level: 1, label: "Nudge", body: "a" },
        { level: 2, label: "Lead", body: "b" },
        { level: 3, label: "Reveal", body: "c" },
      ],
      respond,
    };
    const deep = buildWidgetSignalMessage(intent, { hintLevelOpened: 3, responseText: "Got it", submitted: true }, "construct");
    expect(deep).toMatch(/LOW independence/);
    // The deepest hint must not be quietly treated as a clean solve.
    expect(deep).toMatch(/unscaffolded retry/);

    const light = buildWidgetSignalMessage(intent, { hintLevelOpened: 1, responseText: "Got it", submitted: true }, "construct");
    expect(light).toMatch(/hint level 1 of 3/);
    expect(light).not.toMatch(/LOW independence/);
  });

  it("never reveals correctness in the learner-facing transcript line", () => {
    const intent: WidgetIntent = { ...bare.slider, respond } as WidgetIntent;
    const text = buildWidgetSignalDisplayText(intent, { responseText: "It approaches the tangent", submitted: true, correct: false });
    expect(text).toContain("It approaches the tangent");
    expect(text).not.toMatch(/wrong|incorrect|✗/i);
  });

  it("plan agreement carries the route and the obligation to teach to it", () => {
    const intent: WidgetIntent = {
      kind: "plan",
      heading: "Convergence of series",
      steps: [
        { id: "s1", label: "Pictures before letters", details: ["strips settling to a value"] },
        { id: "s2", label: "Defend a claim" },
      ],
    };
    // Silent until the learner clicks Start learning.
    expect(shouldSignalTutor(intent, undefined, { submitted: false })).toBe(false);
    expect(shouldSignalTutor(intent, undefined, { submitted: true })).toBe(true);
    expect(shouldSignalTutor(intent, { submitted: true }, { submitted: true })).toBe(false);

    const message = buildWidgetSignalMessage(intent, { submitted: true }, "encounter");
    expect(message).toContain("I agree with the plan");
    expect(message).toContain("1. Pictures before letters");
    expect(message).toContain("2. Defend a claim");
    // The learner has authorized teaching toward the agreed plan…
    expect(message).toMatch(/authorising you to teach toward this route/i);
    // …and the next move is policy-selected, not a promise to begin the first
    // phase immediately. A deterministic policy route may legitimately skip a
    // route-bearing the policy has not selected.
    expect(message).toMatch(/the next move is policy-selected/i);
    expect(message).toMatch(/not a free pass to begin the first phase/i);
    // Defence against the regression that motivated this revision: the signal
    // must never promise to begin the first phase immediately, since the policy
    // may select a different starting point.
    expect(message).not.toContain("Begin at the first phase now");

    // An edit is part of the contract, not the tutor's private proposal.
    const edited = buildWidgetSignalMessage(
      intent,
      { submitted: true, planDraft: { heading: "Convergence of series", steps: [{ id: "e1", label: "Only the sum rule" }, { id: "e2", label: "A hard example" }] } },
      "encounter"
    );
    expect(edited).toContain("I edited the proposed plan");
    expect(edited).toContain("1. Only the sum rule");
    expect(edited).not.toContain("2. Defend a claim");
    // The edited branch carries the same policy-selected framing.
    expect(edited).toMatch(/the next move is policy-selected/i);

    const display = buildWidgetSignalDisplayText(intent, { submitted: true });
    expect(display).toContain("Agreed to the plan");
    expect(display).toContain("Convergence of series");
  });
});
