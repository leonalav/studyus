import { describe, it, expect } from "vitest";
import { pairOnboardingReply, renderOnboardingReply } from "./tutor";
import type { OnboardingAnswers, OnboardingQuestion } from "./tutor";

const questions: OnboardingQuestion[] = [
  { id: "q1", question: "How comfortable are you with limits already?", kind: "free" },
  {
    id: "q2",
    question: "Which part do you expect to trip you up?",
    kind: "choice",
    options: ["The definitions", "The algebra", "Keeping the steps straight"],
  },
  { id: "q3", question: "Is there a deadline pushing this?", kind: "free" },
];

describe("pairing the learner's reply", () => {
  it("matches answers to questions positionally and strips numbering", () => {
    const paired = pairOnboardingReply("Limits", questions, "1. Fairly ok\n2. Epsilon-delta\n3. Friday");
    expect(paired.answers.map((entry) => entry.answer)).toEqual(["Fairly ok", "Epsilon-delta", "Friday"]);
  });

  it("pairs typed replies onto choice questions the same as free ones", () => {
    const paired = pairOnboardingReply("Limits", questions, "ok\nThe algebra\nFriday");
    expect(paired.answers[1]).toEqual({ question: "Which part do you expect to trip you up?", answer: "The algebra" });
  });

  it("treats skip words as no answer rather than inventing one", () => {
    const paired = pairOnboardingReply("Limits", questions, "skip\nn/a\n-");
    expect(paired.answers.every((entry) => entry.answer === "")).toBe(true);
  });

  it("tolerates a learner who answers nothing at all", () => {
    // The hand-off has to work in exactly this case, which is why it is now
    // written by the counsellor rather than assuming answers exist.
    const paired = pairOnboardingReply("Limits", questions, "");
    expect(paired.answers).toHaveLength(3);
    expect(paired.answers.every((entry) => entry.answer === "")).toBe(true);
  });
});

describe("rendering the form submission back into the chat", () => {
  const base: OnboardingAnswers = {
    concept: "Limits",
    answers: [
      { question: "How comfortable are you with limits already?", answer: "Fairly ok" },
      { question: "Which part do you expect to trip you up?", answer: "The algebra" },
      { question: "Is there a deadline pushing this?", answer: "" },
    ],
  };

  it("echoes the learner's answers numbered, and nothing else", () => {
    const reply = renderOnboardingReply(base);
    expect(reply).toContain("1. Fairly ok");
    expect(reply).toContain("2. The algebra");
    // The questions are carried by the form card, not echoed back.
    expect(reply).not.toContain("How comfortable");
  });

  it("marks skipped questions without inventing an answer", () => {
    const reply = renderOnboardingReply(base);
    expect(reply).toContain("3. (skipped)");
    expect(reply).not.toMatch(/not given/i);
  });
});
