import { describe, it, expect } from "vitest";
import { renderOnboardingQuestions, pairOnboardingReply } from "./tutor";
import type { OnboardingQuestion } from "./tutor";

const questions: OnboardingQuestion[] = [
  { id: "q1", question: "How comfortable are you with limits already?" },
  { id: "q2", question: "Which part do you expect to trip you up?" },
  { id: "q3", question: "Is there a deadline pushing this?" },
];

describe("the counsellor's script is its own words", () => {
  it("adds numbering and nothing else", () => {
    const script = renderOnboardingQuestions("Let's get you set up.", questions);
    expect(script).toContain("1. How comfortable are you with limits already?");
    expect(script).toContain("3. Is there a deadline pushing this?");
    expect(script.startsWith("Let's get you set up.")).toBe(true);
  });

  it("no longer announces how many agents are bound", () => {
    // This used to be appended by the app on every single session opener.
    const script = renderOnboardingQuestions("Hello.", questions);
    expect(script).not.toMatch(/agent/i);
    expect(script).not.toMatch(/@ ?mention/i);
  });

  it("no longer appends a fixed sign-off", () => {
    // The invitation to answer and the permission to skip are now written by
    // the counsellor as `closing`, so they can differ per learner.
    const script = renderOnboardingQuestions("Hello.", questions);
    expect(script).not.toMatch(/Feel free to skip/i);
    expect(script).not.toMatch(/one answer per line/i);
    expect(script).not.toMatch(/we'll begin/i);
  });

  it("ends on the last question when the counsellor wrote no closing", () => {
    const script = renderOnboardingQuestions("Hello.", questions);
    expect(script.trimEnd().endsWith("3. Is there a deadline pushing this?")).toBe(true);
  });
});

describe("pairing the learner's reply", () => {
  it("matches answers to questions positionally and strips numbering", () => {
    const paired = pairOnboardingReply("Limits", questions, "1. Fairly ok\n2. Epsilon-delta\n3. Friday");
    expect(paired.answers.map((entry) => entry.answer)).toEqual(["Fairly ok", "Epsilon-delta", "Friday"]);
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
