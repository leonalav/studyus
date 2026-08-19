import { describe, it, expect } from "vitest";
import {
  MAX_ONBOARDING_QUESTIONS,
  MIN_ONBOARDING_QUESTIONS,
  validateCreateFormsPayload,
} from "./tutor";

/** A well-formed create_forms tool call: five questions with both answer
 *  kinds represented. The written fields (notification/title/invitation/
 *  handoff) are the counsellor's own words. */
function validPayload() {
  return {
    notification: "I'm putting five quick questions into a little form so we can calibrate — a minute at most.",
    tool_call: {
      name: "create_forms",
      arguments: {
        title: "Before we start: limits",
        invitation: "Answer whichever of these you can — skipping is fine.",
        questions: [
          { question: "How comfortable are you with limits already?", kind: "free" },
          {
            question: "Which part do you expect to trip you up?",
            kind: "choice",
            options: ["The definitions", "The algebra", "The notation"],
          },
          { question: "What background is freshest for you?", kind: "free" },
          {
            question: "What pace pressure are you under?",
            kind: "choice",
            options: ["None", "Coursework due this week", "Exam soon"],
          },
          { question: "How do you want to be taught?", kind: "free" },
        ],
      },
    },
    handoff: "Thanks — give me a moment while I read your materials.",
  };
}

describe("validateCreateFormsPayload — the counsellor's create_forms call", () => {
  it("accepts a well-formed call and normalizes it", () => {
    const result = validateCreateFormsPayload(validPayload());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.notification).toMatch(/form/i);
    expect(result.value.form.title).toBe("Before we start: limits");
    expect(result.value.form.invitation).toContain("skipping");
    expect(result.value.form.questions).toHaveLength(5);
    expect(result.value.form.questions.map((q) => q.id)).toEqual(["q1", "q2", "q3", "q4", "q5"]);
    expect(result.value.form.questions[1].options).toEqual(["The definitions", "The algebra", "The notation"]);
    expect(result.value.handoff).toContain("Thanks");
  });

  it("infers a choice question from options when kind is omitted", () => {
    const payload = validPayload();
    const q = payload.tool_call.arguments.questions[1] as { kind?: string };
    delete q.kind;
    const result = validateCreateFormsPayload(payload);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.form.questions[1].kind).toBe("choice");
  });

  it("accepts bare-string questions as free text", () => {
    const payload = validPayload();
    payload.tool_call.arguments.questions[0] = "How comfortable are you with limits already?" as never;
    const result = validateCreateFormsPayload(payload);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.form.questions[0].kind).toBe("free");
  });

  it("rejects any other tool name — the intake is create_forms only", () => {
    const payload = validPayload();
    payload.tool_call.name = "ask_questions";
    const result = validateCreateFormsPayload(payload);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(" ")).toContain("create_forms");
  });

  it(`rejects anything but the fixed ${MIN_ONBOARDING_QUESTIONS}–${MAX_ONBOARDING_QUESTIONS} question window`, () => {
    const payload = validPayload();
    payload.tool_call.arguments.questions.pop();
    const result = validateCreateFormsPayload(payload);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(" ")).toMatch(/questions/);
  });

  it("rejects a choice question with one, duplicate, or zero options", () => {
    for (const options of [["Only one"], ["Same", "same"], []]) {
      const payload = validPayload();
      (payload.tool_call.arguments.questions[1] as { options?: string[] }).options = options;
      const result = validateCreateFormsPayload(payload);
      expect(result.ok).toBe(false);
    }
  });

  it("rejects a free question carrying options", () => {
    const payload = validPayload();
    payload.tool_call.arguments.questions[0] = { question: "Q?", kind: "free", options: ["a", "b"] } as never;
    const result = validateCreateFormsPayload(payload);
    expect(result.ok).toBe(false);
  });

  it("rejects a blank notification — the app does not substitute copy for it", () => {
    const payload = validPayload();
    payload.notification = "  ";
    const result = validateCreateFormsPayload(payload);
    expect(result.ok).toBe(false);
  });

  it("drops blank optional fields instead of failing the intake", () => {
    const payload = validPayload();
    payload.tool_call.arguments.title = " ";
    payload.tool_call.arguments.invitation = "";
    payload.handoff = "  ";
    const result = validateCreateFormsPayload(payload);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.form.title).toBeUndefined();
      expect(result.value.form.invitation).toBeUndefined();
      expect(result.value.handoff).toBeUndefined();
    }
  });
});
