import { describe, it, expect, beforeEach } from "vitest";
import { getDb } from "../db/database";
import {
  bindModelRole,
  bindAllModelRoles,
  getModelBindings,
  getSanitizedSettings,
  storeCredentialLocally,
  getCredentialLocally,
  testModelEndpoint,
} from "./llm";

describe("Three-Role LLM Engine & Security", () => {
  beforeEach(async () => {
    await getDb();
  });

  it("stores credentials securely in local secure store and never exposes them in settings", async () => {
    storeCredentialLocally("test_endpoint", "sk-secret-12345");
    expect(getCredentialLocally("test_endpoint")).toBe("sk-secret-12345");

    await bindModelRole("tutor", {
      provider: "openai",
      baseUrl: "https://api.openai.com/v1",
      modelId: "gpt-4o",
      apiKey: "sk-secret-12345",
    });

    const settings = await getSanitizedSettings();
    const settingsStr = JSON.stringify(settings);
    expect(settingsStr).not.toContain("sk-secret-12345");
  });

  it("replaces and clears stale role credentials when an assignment changes", async () => {
    await bindModelRole("tutor", {
      provider: "openai",
      baseUrl: "https://api.example/v1",
      modelId: "private-model",
      apiKey: "sk-old-provider",
    });
    expect(getCredentialLocally("role_tutor")).toBe("sk-old-provider");

    await bindModelRole("tutor", {
      provider: "custom",
      baseUrl: "http://localhost:11434/v1",
      modelId: "local-model",
    });
    expect(getCredentialLocally("role_tutor")).toBe("");
  });

  it("supports binding one model to all three roles in a single action", async () => {
    await bindAllModelRoles({
      provider: "custom",
      baseUrl: "https://local.ai/v1",
      modelId: "llama-3-70b",
    });

    const bindings = await getModelBindings();
    expect(bindings.length).toBe(3);
    expect(bindings.map((b) => b.role).sort()).toEqual(["evaluator", "generation", "tutor"]);
    expect(bindings.every((b) => b.modelId === "llama-3-70b")).toBe(true);
  });

  it("validates endpoint scheme and reports invalid URLs", async () => {
    const res = await testModelEndpoint({
      provider: "custom",
      baseUrl: "invalid-url",
      modelId: "model-1",
    });

    expect(res.reachable).toBe(false);
    expect(res.error).toContain("Invalid scheme");
  });
});
