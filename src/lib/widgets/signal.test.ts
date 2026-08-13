import { describe, it, expect } from "vitest";
import { buildWidgetSignal, buildWidgetSignalMessage, shouldSignalTutor } from "./signal";
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
