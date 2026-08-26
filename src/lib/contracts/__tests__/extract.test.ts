import { afterEach, describe, expect, it, vi } from "vitest";
import type { ResolvedRoleEndpoint } from "../../agentRuntime";
import { defaultCapabilities } from "../../llm";
import { extractContractFromOnboarding } from "../extract";

const ENDPOINT: ResolvedRoleEndpoint = {
  role: "generation",
  provider: "custom",
  baseUrl: "https://model.example/v1",
  modelId: "generation-test-model",
  apiKey: "",
  capabilities: defaultCapabilities(),
};

const ANSWERS = {
  concept: "linear algebra",
  answers: [{ question: "What helps you learn?", answer: "Use geometric examples." }],
};

function completionResponse(payload: unknown): Response {
  return new Response(JSON.stringify({
    choices: [{ message: { content: JSON.stringify(payload) } }],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  }), { status: 200, headers: { "Content-Type": "application/json" } });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("extractContractFromOnboarding", () => {
  it("assigns deterministic contract metadata outside the model response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => completionResponse({
      commitments: [{ kind: "representation", prefer: "geometric examples" }],
    })));

    const result = await extractContractFromOnboarding("learner-1", ANSWERS, "session-1", ENDPOINT);

    expect(result.kind).toBe("proposed");
    if (result.kind === "proposed") {
      expect(result.contract).toMatchObject({
        learnerId: "learner-1",
        sessionId: "session-1",
        revision: 1,
        schemaVersion: 1,
        source: "onboarding",
        active: true,
        commitments: [{ kind: "representation", prefer: "geometric examples" }],
      });
      expect(result.contract.contractId).toMatch(/^tc_/);
      expect(result.contract.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    }
  });

  it("returns an intentional empty result without requesting a repair", async () => {
    const fetchMock = vi.fn(async () => completionResponse({ commitments: [] }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await extractContractFromOnboarding("learner-1", ANSWERS, undefined, ENDPOINT);

    expect(result).toEqual({ kind: "empty" });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("feeds missing commitment arrays into the bounded schema repair loop", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const callIndex = fetchMock.mock.calls.length - 1;
      if (callIndex === 0) return completionResponse({ preference: "visual" });
      const body = JSON.parse(String(init?.body));
      expect(body.messages.at(-1).content).toContain("commitments array");
      return completionResponse({ commitments: [{ kind: "example_domain", domain: "physics" }] });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await extractContractFromOnboarding("learner-1", ANSWERS, undefined, ENDPOINT);

    expect(result.kind).toBe("proposed");
    if (result.kind === "proposed") {
      expect(result.contract.commitments).toEqual([{ kind: "example_domain", domain: "physics" }]);
    }
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("fails closed when proposed commitments violate the authority boundary", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => completionResponse({
      commitments: [{ kind: "goal", statement: "increase my mastery score" }],
    })));

    const result = await extractContractFromOnboarding("learner-1", ANSWERS, undefined, ENDPOINT);

    expect(result.kind).toBe("failed");
    if (result.kind === "failed") {
      expect(result.errors.join(" ")).toMatch(/mastery|score/i);
    }
  });

  it("drops malformed commitments and keeps the valid survivors with warnings", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => completionResponse({
      commitments: [
        { kind: "scope_include", concept: "linear algebra" },
        { kind: "pace" },
        { kind: "notation", rule: "use radians, not degrees" },
      ],
    })));

    const result = await extractContractFromOnboarding("learner-1", ANSWERS, undefined, ENDPOINT);

    expect(result.kind).toBe("proposed");
    if (result.kind === "proposed") {
      expect(result.contract.commitments).toEqual([
        { kind: "scope_include", concept: "linear algebra" },
        { kind: "notation", rule: "use radians, not degrees" },
      ]);
      expect(result.extractionWarnings?.some((w) => /pace/.test(w))).toBe(true);
    }
  });

  it("fails when every proposed commitment is malformed", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => completionResponse({
      commitments: [{ kind: "pace" }, { kind: "scope_include", concept: "" }],
    })));

    const result = await extractContractFromOnboarding("learner-1", ANSWERS, undefined, ENDPOINT);

    expect(result.kind).toBe("failed");
    if (result.kind === "failed") {
      expect(result.errors.length).toBeGreaterThan(0);
    }
  });

  it("fails when all commitments have empty string fields", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => completionResponse({
      commitments: [
        { kind: "goal", statement: "" },
        { kind: "scope_include", concept: "" },
        { kind: "representation", prefer: "" },
      ],
    })));

    const result = await extractContractFromOnboarding("learner-1", ANSWERS, undefined, ENDPOINT);

    expect(result.kind).toBe("failed");
    if (result.kind === "failed") {
      expect(result.errors).toContain("commitments[0].statement must be a non-empty string");
      expect(result.errors).toContain("commitments[1].concept must be a non-empty string");
      expect(result.errors).toContain("commitments[2].prefer must be a non-empty string");
    }
  });

  it("drops empty-string commitments and keeps valid ones with warnings", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => completionResponse({
      commitments: [
        { kind: "goal", statement: "" },
        { kind: "scope_include", concept: "linear algebra" },
        { kind: "representation", prefer: "geometric" },
      ],
    })));

    const result = await extractContractFromOnboarding("learner-1", ANSWERS, undefined, ENDPOINT);

    expect(result.kind).toBe("proposed");
    if (result.kind === "proposed") {
      expect(result.contract.commitments).toEqual([
        { kind: "scope_include", concept: "linear algebra" },
        { kind: "representation", prefer: "geometric" },
      ]);
      expect(result.extractionWarnings?.some((w) => /statement/.test(w))).toBe(true);
    }
  });
});
