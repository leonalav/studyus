import { describe, it, expect } from "vitest";
import {
  MAX_ONBOARDING_QUESTIONS,
  MIN_ONBOARDING_QUESTIONS,
  validateCreateFormsPayload,
} from "./tutor";

/** A well-formed create_forms tool call: eight questions covering the
 *  expanded intake (footing, misconceptions, goal, time, style, pace,
 *  background, and the part that may trip the learner up). */
function validPayload() {
  return {
    notification: "I'm putting eight quick questions into a little form so we can calibrate — a minute at most.",
    tool_call: {
      name: "create_forms",
      arguments: {
        title: "Before we start: limits",
        invitation: "Answer whichever of these you can — skipping is fine.",
        questions: [
          {
            question: "Where are you with limits?",
            kind: "choice",
            options: ["Brand new", "A little shaky", "Comfortable already"],
            familiarityOptions: [
              { option: "Brand new", familiarity: "new" },
              { option: "A little shaky", familiarity: "shaky" },
              { option: "Comfortable already", familiarity: "confident" },
            ],
          },
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
          {
            question: "How much time can you give this in a sitting?",
            kind: "choice",
            options: ["15 minutes", "30 minutes", "An hour or more"],
          },
          {
            question: "What's the goal you're aiming at?",
            kind: "choice",
            options: ["Pass the next test", "Genuinely understand it", "Apply it elsewhere"],
          },
          {
            question: "What is a misconception you keep hitting on these ideas?",
            kind: "free",
          },
        ],
      },
    },
    handoff: "Thanks — give me a moment while I read your materials.",
  };
}

describe("validateCreateFormsPayload — onlyIf constraints", () => {
  const gatePayload = () => {
    const payload = validPayload() as any;
    payload.tool_call.arguments.questions[1].onlyIf = { questionId: "q1", anyOf: ["The definitions"] };
    payload.tool_call.arguments.questions[0].kind = "choice";
    payload.tool_call.arguments.questions[0].options = ["The definitions", "The algebra", "New to this"];
    payload.tool_call.arguments.questions[0].familiarityOptions = [
      { option: "The definitions", familiarity: "new" },
      { option: "The algebra", familiarity: "shaky" },
      { option: "New to this", familiarity: "confident" },
    ];
    return payload;
  };

  it("accepts a gate on an earlier choice question and normalizes option casing", () => {
    const payload = gatePayload();
    payload.tool_call.arguments.questions[1].onlyIf.anyOf = ["the definitions"];
    const result = validateCreateFormsPayload(payload);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.form.questions[1].onlyIf).toEqual({ questionId: "q1", anyOf: ["The definitions"] });
    }
  });

  it("rejects a gate on a question that does not come earlier", () => {
    const payload = gatePayload();
    payload.tool_call.arguments.questions[1].onlyIf = { questionId: "q4", anyOf: ["None"] };
    const result = validateCreateFormsPayload(payload);
    expect(result.ok).toBe(false);
  });

  it("rejects a gate on a free-text question — there is no option list to match", () => {
    const payload = validPayload() as any;
    payload.tool_call.arguments.questions[3].onlyIf = { questionId: "q3", anyOf: ["anything"] };
    const result = validateCreateFormsPayload(payload);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(" ")).toMatch(/choice/i);
  });

  it("rejects gate labels that are not options of the target question", () => {
    const payload = validPayload() as any;
    payload.tool_call.arguments.questions[3].onlyIf = { questionId: "q2", anyOf: ["Not a real option"] };
    const result = validateCreateFormsPayload(payload);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(" ")).toContain("q2");
  });
});

describe("validateCreateFormsPayload — the counsellor's create_forms call", () => {
  it("accepts a well-formed call and normalizes it", () => {
    const result = validateCreateFormsPayload(validPayload());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.notification).toMatch(/form/i);
    expect(result.value.form.title).toBe("Before we start: limits");
    expect(result.value.form.invitation).toContain("skipping");
    expect(result.value.form.questions).toHaveLength(8);
    expect(result.value.form.questions.map((q) => q.id)).toEqual(["q1", "q2", "q3", "q4", "q5", "q6", "q7", "q8"]);
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
    payload.tool_call.arguments.questions[2] = "What background is freshest for you?" as never;
    const result = validateCreateFormsPayload(payload);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.form.questions[2].kind).toBe("free");
  });


  it("rejects a missing or malformed footing mapping", () => {
    const absent = validPayload() as any;
    delete absent.tool_call.arguments.questions[0].familiarityOptions;
    expect(validateCreateFormsPayload(absent).ok).toBe(false);

    const freeText = validPayload() as any;
    freeText.tool_call.arguments.questions[0].kind = "free";
    freeText.tool_call.arguments.questions[0].options = undefined;
    expect(validateCreateFormsPayload(freeText).ok).toBe(false);

    const absentOption = validPayload() as any;
    absentOption.tool_call.arguments.questions[0].familiarityOptions[0].option = "Not listed";
    expect(validateCreateFormsPayload(absentOption).ok).toBe(false);
  });

  it("rejects duplicate or incomplete familiarity mappings", () => {
    const duplicateOption = validPayload() as any;
    duplicateOption.tool_call.arguments.questions[0].familiarityOptions[1].option = "Brand new";
    expect(validateCreateFormsPayload(duplicateOption).ok).toBe(false);

    const duplicateFamiliarity = validPayload() as any;
    duplicateFamiliarity.tool_call.arguments.questions[0].familiarityOptions[1].familiarity = "new";
    expect(validateCreateFormsPayload(duplicateFamiliarity).ok).toBe(false);

    const secondFooting = validPayload() as any;
    secondFooting.tool_call.arguments.questions[1].familiarityOptions = [
      { option: "The definitions", familiarity: "new" },
      { option: "The algebra", familiarity: "shaky" },
      { option: "The notation", familiarity: "confident" },
    ];
    expect(validateCreateFormsPayload(secondFooting).ok).toBe(false);
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
    // Pop twice to land BELOW the minimum, since the original payload now
    // satisfies MIN_ONBOARDING_QUESTIONS=8.
    payload.tool_call.arguments.questions.pop();
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
    payload.tool_call.arguments.questions[2] = { question: "Q?", kind: "free", options: ["a", "b"] } as never;
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
