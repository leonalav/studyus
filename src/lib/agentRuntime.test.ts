import { afterEach, describe, expect, it, vi } from "vitest";
import {
  callStructuredAgent,
  extractJsonPayload,
  invalid,
  type ResolvedRoleEndpoint,
} from "./agentRuntime";
import { defaultCapabilities } from "./llm";

const ENDPOINT: ResolvedRoleEndpoint = {
  role: "tutor",
  provider: "custom",
  baseUrl: "https://model.example/v1",
  modelId: "test-model",
  apiKey: "",
  capabilities: defaultCapabilities(),
};

function completionResponse(content: unknown): Response {
  return new Response(JSON.stringify({
    choices: [{ message: { content } }],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  }), { status: 200, headers: { "Content-Type": "application/json" } });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("structured agent runtime recovery", () => {
  it("skips prose brackets and extracts the later JSON object", () => {
    expect(extractJsonPayload('See [important note] first. {"speech":"Ready","board_ops":[],"evidence_refs":[]}'))
      .toEqual({ speech: "Ready", board_ops: [], evidence_refs: [] });
  });

  it("returns deterministic recovery after three invalid attempts instead of throwing schema_invalid", async () => {
    let requestBody: any;
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      requestBody = JSON.parse(String(init?.body));
      return completionResponse([{ type: "text", text: "Plain tutor guidance from a provider content array." }]);
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await callStructuredAgent({
      role: "tutor",
      endpoint: ENDPOINT,
      system: "Return JSON.",
      user: "Help me.",
      promptVersion: "test",
      schemaVersion: "tutor_turn_v2",
      maxRepairAttempts: 2,
      maxTokens: 4096,
      validate: () => invalid("response must be an object"),
      recover: ({ raw }) => ({ speech: raw, boardOps: [], evidenceRefs: [] }),
    });

    expect(result.value).toEqual({
      speech: "Plain tutor guidance from a provider content array.",
      boardOps: [],
      evidenceRefs: [],
    });
    expect(result.repaired).toBe(true);
    expect(result.attempts).toBe(3);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(requestBody.max_tokens).toBe(4096);
  });

  it("keeps strict callers fail-closed when they do not provide recovery", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => completionResponse("not JSON")));

    await expect(callStructuredAgent({
      role: "generation",
      endpoint: { ...ENDPOINT, role: "generation" },
      system: "Return JSON.",
      user: "Generate an assessment.",
      promptVersion: "test",
      schemaVersion: "assessment_v1",
      maxRepairAttempts: 0,
      validate: () => invalid("invalid assessment"),
    })).rejects.toMatchObject({ failureClass: "schema_invalid" });
  });
});
