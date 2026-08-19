import { describe, it, expect } from "vitest";
import {
  buildOnboardingReminder,
  renderOnboardingReply,
  visibleOnboardingQuestions,
} from "./tutor";
import type { OnboardingAnswers, OnboardingQuestion } from "./tutor";

const questions: OnboardingQuestion[] = [
  {
    id: "q1",
    question: "Have you met limits before today?",
    kind: "choice",
    options: ["Brand new", "Seen them once", "Comfortable with them"],
  },
  { id: "q2", question: "Which part do you expect to trip you up?", kind: "free", onlyIf: { questionId: "q1", anyOf: ["Seen them once", "Comfortable with them"] } },
  { id: "q3", question: "Is there a deadline pushing this?", kind: "free" },
];

describe("question constraints (onlyIf gates)", () => {
  it("hides a gated question until its constraint answer lands", () => {
    expect(visibleOnboardingQuestions(questions, {}).map((q) => q.id)).toEqual(["q1", "q3"]);
  });

  it("keeps the gate closed on a non-matching option", () => {
    const draft = { q1: "Brand new" };
    expect(visibleOnboardingQuestions(questions, draft).map((q) => q.id)).toEqual(["q1", "q3"]);
  });

  it("opens the gate on a matching option, case-insensitively", () => {
    const draft = { q1: " comfortable with them " };
    expect(visibleOnboardingQuestions(questions, draft).map((q) => q.id)).toEqual(["q1", "q2", "q3"]);
  });
});

describe("rendering the form submission back into the chat", () => {
  const base: OnboardingAnswers = {
    concept: "Limits",
    answers: [
      { question: "Have you met limits before today?", answer: "Brand new" },
      { question: "Which part do you expect to trip you up?", answer: "" },
    ],
  };

  it("echoes the learner's answers numbered, and nothing else", () => {
    const reply = renderOnboardingReply(base);
    expect(reply).toContain("1. Brand new");
    // The questions are carried by the form card, not echoed back.
    expect(reply).not.toContain("Have you met");
  });

  it("marks skipped questions without inventing an answer", () => {
    const reply = renderOnboardingReply(base);
    expect(reply).toContain("2. (skipped)");
    expect(reply).not.toMatch(/not given/i);
  });
});

describe("the session reminder built from the answers", () => {
  it("carries a slow-down clause for a brand-new learner", () => {
    const reminder = buildOnboardingReminder({
      concept: "Limits",
      answers: [{ question: "Have you met limits before today?", answer: "Brand new" }],
    });
    expect(reminder).toContain("Brand new");
    expect(reminder).toMatch(/slow/i);
    expect(reminder).toMatch(/plain language/i);
    expect(reminder).toMatch(/one idea at a time/i);
  });
});
