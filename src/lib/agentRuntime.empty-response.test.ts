/**
 * Test suite for empty response hardening in agentRuntime.
 * 
 * Ensures that when an LLM endpoint returns empty content (due to rate limits,
 * safety filters, or internal errors), the system gracefully recovers instead of
 * showing raw error messages to the user.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { chatCompletion, extractAssistantContent } from "./agentRuntime";
import type { ResolvedRoleEndpoint } from "./agentRuntime";

// Mock the native Tauri runtime check
vi.mock("./tauri", () => ({
  isTauriRuntime: () => false,
}));

describe("agentRuntime empty response handling", () => {
  let mockEndpoint: ResolvedRoleEndpoint;

  beforeEach(() => {
    mockEndpoint = {
      role: "tutor",
      provider: "openai",
      baseUrl: "https://api.openai.com/v1",
      modelId: "gpt-4",
      apiKey: "test-key",
      capabilities: { vision: false, jsonMode: true },
    };
  });

  describe("extractAssistantContent", () => {
    it("should extract string content", () => {
      expect(extractAssistantContent("Hello world")).toBe("Hello world");
    });

    it("should extract from content-part array", () => {
      expect(extractAssistantContent([{ type: "text", text: "Hello" }])).toBe("Hello");
    });

    it("should extract from mixed content parts", () => {
      const parts = [
        { type: "text", text: "Line 1" },
        { type: "text", text: "Line 2" },
      ];
      expect(extractAssistantContent(parts)).toBe("Line 1\nLine 2");
    });

    it("should handle content field", () => {
      expect(extractAssistantContent([{ content: "Hello" }])).toBe("Hello");
    });

    it("should return empty string for null/undefined", () => {
      expect(extractAssistantContent(null)).toBe("");
      expect(extractAssistantContent(undefined)).toBe("");
    });

    it("should stringify objects as fallback", () => {
      const obj = { key: "value" };
      expect(extractAssistantContent(obj)).toBe(JSON.stringify(obj));
    });

    it("should filter out empty parts", () => {
      const parts = [
        { type: "text", text: "Hello" },
        { type: "unknown", value: 123 },
        { type: "text", text: "World" },
      ];
      expect(extractAssistantContent(parts)).toBe("Hello\nWorld");
    });
  });

  describe("chatCompletion empty response handling", () => {
    beforeEach(() => {
      vi.clearAllMocks();
      global.fetch = vi.fn();
    });

    it("should throw empty_response error when content is empty string", async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          choices: [{ message: { content: "" } }],
          usage: { prompt_tokens: 100, completion_tokens: 0, total_tokens: 100 },
        }),
      });

      await expect(chatCompletion({
        endpoint: mockEndpoint,
        messages: [{ role: "user", content: "Hello" }],
        jsonMode: true,
        temperature: 0.7,
        timeoutMs: 30000,
      })).rejects.toThrow("empty content");
    });

    it("should throw empty_response error when content is whitespace only", async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          choices: [{ message: { content: "   \n  \t  " } }],
          usage: { prompt_tokens: 50, completion_tokens: 1, total_tokens: 51 },
        }),
      });

      await expect(chatCompletion({
        endpoint: mockEndpoint,
        messages: [{ role: "user", content: "Test" }],
        jsonMode: false,
        temperature: 0.5,
        timeoutMs: 30000,
      })).rejects.toThrow("empty content");
    });

    it("should throw empty_response error when message object is missing", async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          choices: [{}],
          usage: { prompt_tokens: 80, completion_tokens: 0, total_tokens: 80 },
        }),
      });

      await expect(chatCompletion({
        endpoint: mockEndpoint,
        messages: [{ role: "user", content: "Query" }],
        jsonMode: true,
        temperature: 0.2,
        timeoutMs: 30000,
      })).rejects.toThrow("empty content");
    });

    it("should throw empty_response error when choices array is empty", async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          choices: [],
          usage: { prompt_tokens: 120, completion_tokens: 0, total_tokens: 120 },
        }),
      });

      await expect(chatCompletion({
        endpoint: mockEndpoint,
        messages: [{ role: "user", content: "Empty choices" }],
        jsonMode: false,
        temperature: 1.0,
        timeoutMs: 30000,
      })).rejects.toThrow("empty content");
    });

    it("should return normal content when response is valid", async () => {
      const validContent = '{"speech": "Hello!", "board_ops": []}';
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          choices: [{ message: { content: validContent } }],
          usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
        }),
      });

      const result = await chatCompletion({
        endpoint: mockEndpoint,
        messages: [{ role: "user", content: "Hello" }],
        jsonMode: true,
        temperature: 0.7,
        timeoutMs: 30000,
      });

      expect(result.content).toBe(validContent);
      expect(result.usage.completion).toBe(20);
    });
  });
});
