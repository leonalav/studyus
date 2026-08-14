import { describe, it, expect } from "vitest";
import {
  STARTING_CREDITS,
  creditsForModel,
  formatCreditAmount,
  summarizeCredits,
  type AgentCallRow,
} from "./credits";
import { STUDYUS_MODELS } from "./studyusModels";

const call = (over: Partial<AgentCallRow> = {}): AgentCallRow => ({
  role: "tutor",
  outcome: "success",
  modelId: "studyus/tier-2",
  tokensJson: null,
  ...over,
});

describe("pricing a request", () => {
  it("charges each tier its stated rate", () => {
    expect(creditsForModel("studyus/tier-1")).toBe(0.25);
    expect(creditsForModel("studyus/tier-2")).toBe(0.5);
    expect(creditsForModel("studyus/tier-3")).toBe(1);
  });

  it("prices a tier by its public id as well as its routed model id", () => {
    // agent_calls stores whatever was bound, which may be either form.
    for (const spec of STUDYUS_MODELS) {
      expect(creditsForModel(spec.id)).toBe(spec.credits);
      expect(creditsForModel(spec.model)).toBe(spec.credits);
    }
  });

  it("charges nothing for the learner's own endpoint", () => {
    // They are paying their vendor directly; billing them twice is dishonest.
    expect(creditsForModel("gpt-4o")).toBe(0);
    expect(creditsForModel("llama-3.1-70b")).toBe(0);
  });

  it("charges nothing rather than guessing for a missing or retired model", () => {
    expect(creditsForModel(null)).toBe(0);
    expect(creditsForModel(undefined)).toBe(0);
    expect(creditsForModel("")).toBe(0);
    expect(creditsForModel("studyus/tier-legacy")).toBe(0);
  });
});

describe("the credit balance", () => {
  it("starts every learner at 1,000 with nothing logged", () => {
    const usage = summarizeCredits([]);
    expect(usage.remaining).toBe(1000);
    expect(usage.spent).toBe(0);
    expect(usage.requests).toBe(0);
  });

  it("deducts per request, by the model that served it", () => {
    const usage = summarizeCredits([
      call({ modelId: "studyus/tier-1" }),
      call({ modelId: "studyus/tier-2" }),
      call({ modelId: "studyus/tier-3" }),
    ]);
    expect(usage.spent).toBe(1.75);
    expect(usage.remaining).toBe(STARTING_CREDITS - 1.75);
  });

  it("avoids floating-point noise in the displayed balance", () => {
    // 0.25 + 0.5 in binary floating point is not exactly 0.75.
    const usage = summarizeCredits([
      call({ modelId: "studyus/tier-1" }),
      call({ modelId: "studyus/tier-2" }),
    ]);
    expect(usage.spent).toBe(0.75);
    expect(String(usage.remaining)).not.toContain("0000");
  });

  it("charges for a failed request too", () => {
    // The model still ran and still cost money. Refunding failures silently
    // would make the counter disagree with the bill.
    const usage = summarizeCredits([call({ outcome: "error" })]);
    expect(usage.spent).toBe(0.5);
    expect(usage.requests).toBe(1);
    expect(usage.successful).toBe(0);
  });

  it("never reports a negative balance", () => {
    const many = Array.from({ length: 3000 }, () => call({ modelId: "studyus/tier-3" }));
    expect(summarizeCredits(many).remaining).toBe(0);
  });

  it("counts requests and successes separately", () => {
    const usage = summarizeCredits([
      call({ outcome: "success" }),
      call({ outcome: "error" }),
      call({ outcome: "grading_blocked" }),
    ]);
    expect(usage.requests).toBe(3);
    expect(usage.successful).toBe(1);
  });

  it("breaks requests down by role", () => {
    const usage = summarizeCredits([call({ role: "tutor" }), call({ role: "tutor" }), call({ role: "grader" })]);
    expect(usage.byRole).toEqual({ tutor: 2, grader: 1 });
  });

  it("still totals reported tokens when the provider gives them", () => {
    const usage = summarizeCredits([
      call({ tokensJson: JSON.stringify({ total: 1200 }) }),
      call({ tokensJson: JSON.stringify({ total: 800 }) }),
    ]);
    expect(usage.tokens).toBe(2000);
  });

  it("survives a malformed token blob without losing the whole summary", () => {
    const usage = summarizeCredits([call({ tokensJson: "{not json" }), call({ tokensJson: null })]);
    expect(usage.tokens).toBe(0);
    expect(usage.requests).toBe(2);
    expect(usage.spent).toBe(1);
  });
});

describe("formatting", () => {
  it("shows whole numbers cleanly and keeps real fractions", () => {
    expect(formatCreditAmount(1000)).toBe("1,000");
    expect(formatCreditAmount(999.75)).toBe("999.75");
    expect(formatCreditAmount(0)).toBe("0");
  });

  it("never renders NaN to the learner", () => {
    expect(formatCreditAmount(Number.NaN)).toBe("0");
  });
});
