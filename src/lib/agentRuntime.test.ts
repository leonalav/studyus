import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildAgentInputContent,
  callStructuredAgent,
  chatCompletion,
  DEFAULT_TIMEOUT_MS,
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

describe("agent file and vision input", () => {
  it("inlines text files as untrusted reference content for every endpoint", () => {
    const content = buildAgentInputContent("Review this.", [{
      name: "notes.md",
      kind: "file",
      mimeType: "text/markdown",
      textContent: "# Newton's laws",
    }], ENDPOINT);

    expect(content).toEqual([
      { type: "text", text: "Review this." },
      expect.objectContaining({ type: "text", text: expect.stringContaining("# Newton's laws") }),
    ]);
  });

  it("rejects unsupported text extensions and malformed image data URLs", () => {
    expect(buildAgentInputContent("Review.", [
      { name: "records.csv", kind: "file", textContent: "a,b" },
    ], ENDPOINT)).toBe("Review.");
    expect(buildAgentInputContent("Inspect.", [
      { name: "fake.png", kind: "image", dataUrl: "data:image/png;base64,not valid!" },
    ], { capabilities: { ...ENDPOINT.capabilities, vision: true } })).toBe("Inspect.");
  });

  it("sends valid image data only when the assigned endpoint has vision enabled", () => {
    const attachment = { name: "figure.avif", kind: "image" as const, dataUrl: "data:image/avif;base64,AAAA" };
    expect(buildAgentInputContent("Inspect this.", [attachment], ENDPOINT)).toBe("Inspect this.");
    expect(buildAgentInputContent("Inspect this.", [attachment], {
      capabilities: { ...ENDPOINT.capabilities, vision: true },
    })).toEqual([
      { type: "text", text: "Inspect this." },
      { type: "image_url", image_url: { url: attachment.dataUrl, detail: "auto" } },
    ]);
  });

  it("keeps mixed attachment parts in the browser endpoint request body", async () => {
    const content = buildAgentInputContent("Use these.", [
      { name: "facts.txt", kind: "file", textContent: "A bounded reference." },
      { name: "plot.png", kind: "image", dataUrl: "data:image/png;base64,AAAA" },
    ], { capabilities: { ...ENDPOINT.capabilities, vision: true } });
    const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => completionResponse("ok"));
    vi.stubGlobal("fetch", fetchMock);

    await chatCompletion({
      endpoint: { ...ENDPOINT, capabilities: { ...ENDPOINT.capabilities, vision: true } },
      messages: [{ role: "user", content }],
      jsonMode: false,
      temperature: 0,
      timeoutMs: 1_000,
    });

    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body.messages[0].content).toEqual(content);
  });

  it("keeps mixed attachment parts in the native endpoint request body", async () => {
    const content = buildAgentInputContent("Use this.", [
      { name: "facts.md", kind: "file", textContent: "# Reference" },
    ], ENDPOINT);
    const invoke = vi.fn(async (_cmd: string, _args?: Record<string, unknown>) => ({
      status: 200,
      body: await completionResponse("ok").text(),
    }));
    vi.stubGlobal("__TAURI_INTERNALS__", { invoke });

    await chatCompletion({
      endpoint: ENDPOINT,
      messages: [{ role: "user", content }],
      jsonMode: false,
      temperature: 0,
      timeoutMs: 1_000,
    });

    const args = invoke.mock.calls[0][1] as { bodyJson: string };
    expect(JSON.parse(args.bodyJson).messages[0].content).toEqual(content);
  });
});

describe("agent request cancellation", () => {
  it("has no default timeout (Infinity), allowing unlimited request time)", () => {
    expect(DEFAULT_TIMEOUT_MS).toBe(Infinity);
  });

  function hangingFetch(_url: string | URL | Request, init?: RequestInit): Promise<Response> {
    return new Promise((_resolve, reject) => {
      const signal = init?.signal;
      const abort = () => reject(new DOMException("Aborted", "AbortError"));
      if (signal?.aborted) abort();
      else signal?.addEventListener("abort", abort, { once: true });
    });
  }

  it("turns the configured deadline into a timeout error", async () => {
    vi.stubGlobal("fetch", vi.fn(hangingFetch));

    await expect(chatCompletion({
      endpoint: ENDPOINT,
      messages: [{ role: "user", content: "Wait forever." }],
      jsonMode: false,
      temperature: 0,
      timeoutMs: 5,
    })).rejects.toMatchObject({ failureClass: "timeout" });
  });

  it("preserves caller cancellation as an aborted error rather than a timeout", async () => {
    vi.stubGlobal("fetch", vi.fn(hangingFetch));
    const controller = new AbortController();
    const request = chatCompletion({
      endpoint: ENDPOINT,
      messages: [{ role: "user", content: "Cancel me." }],
      jsonMode: false,
      temperature: 0,
      timeoutMs: 1_000,
      signal: controller.signal,
    });
    controller.abort();

    await expect(request).rejects.toMatchObject({ failureClass: "aborted" });
  });

  it("deadline-races a native Tauri request that cannot consume AbortSignal", async () => {
    const invoke = vi.fn(() => new Promise<never>(() => undefined));
    vi.stubGlobal("__TAURI_INTERNALS__", { invoke });

    await expect(chatCompletion({
      endpoint: ENDPOINT,
      messages: [{ role: "user", content: "Native timeout." }],
      jsonMode: false,
      temperature: 0,
      timeoutMs: 5,
    })).rejects.toMatchObject({ failureClass: "timeout" });
    expect(invoke).toHaveBeenCalledWith("chat_completion", expect.any(Object));
  });

  it("caller-cancels a native Tauri request without waiting for invoke", async () => {
    vi.stubGlobal("__TAURI_INTERNALS__", { invoke: vi.fn(() => new Promise<never>(() => undefined)) });
    const controller = new AbortController();
    const request = chatCompletion({
      endpoint: ENDPOINT,
      messages: [{ role: "user", content: "Cancel native." }],
      jsonMode: false,
      temperature: 0,
      timeoutMs: 1_000,
      signal: controller.signal,
    });
    controller.abort();

    await expect(request).rejects.toMatchObject({ failureClass: "aborted" });
  });
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
