/**
 * Tests for the embedding module.
 *
 * The transformers.js pipeline itself is NOT exercised here — booting it
 * requires the ONNX model download (~25 MB) and WASM init, both of which
 * belong in integration tests, not the unit suite. We mock the package so the
 * dispatch, normalization, and lazy-init paths are covered without network.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

// Hoisted mock for `@huggingface/transformers`. We stub `pipeline` with a
// deterministic fake that returns token-level embeddings with shape
// `[batch, seq_len, hidden_dim]`, then let `embedTexts` mean-pool and
// L2-normalize them. That exercises the same code path production hits when
// the real model returns `[batch, seq_len, 384]`.
vi.mock("@huggingface/transformers", () => {
  const env = { allowLocalModels: false };
  const pipeline = vi.fn(async (_task: string, model: string) => {
    return async (input: string | string[]): Promise<unknown> => {
      const texts = Array.isArray(input) ? input : [input];
      const hiddenDim = 4; // tiny dim so the fake data is easy to inspect
      const seqLen = 1;
      const dims = [texts.length, seqLen, hiddenDim];
      const data = new Float32Array(texts.length * seqLen * hiddenDim);
      // Each row gets a unit indicator vector — input i lights up index i % hiddenDim.
      for (let i = 0; i < texts.length; i++) {
        data[i * hiddenDim + (i % hiddenDim)] = 1.0;
      }
      return { data, dims, model };
    };
  });
  return { pipeline, env };
});

import { detectBackend, embedTexts } from "./embeddings";

describe("detectBackend", () => {
  // The Tauri runtime selector reads from `globalThis.__TAURI_INTERNALS__`
  // (see `src/lib/tauri.ts`). Stubbing on `globalThis` is the same write the
  // real Tauri webview performs; `vi.unstubAllGlobals()` restores the prior
  // value so tests don't leak state between cases.
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns the transformers-js backend in a plain browser env", () => {
    expect(detectBackend()).toEqual({
      kind: "transformers-js",
      modelId: "all-MiniLM-L6-v2",
    });
  });

  it("returns the tauri-rust backend when __TAURI_INTERNALS__ is present", () => {
    vi.stubGlobal("__TAURI_INTERNALS__", { invoke: vi.fn() });
    expect(detectBackend()).toEqual({
      kind: "tauri-rust",
      modelId: "all-MiniLM-L6-v2",
    });
  });
});

describe("embedTexts — input validation", () => {
  it("rejects empty input with a clear error", async () => {
    await expect(embedTexts([])).rejects.toThrow("embedTexts: empty input");
  });

  it("rejects when the tauri-rust backend is selected and the command is not wired", async () => {
    await expect(
      embedTexts(["hello world"], {
        backend: { kind: "tauri-rust", modelId: "all-MiniLM-L6-v2" },
      }),
    ).rejects.toThrow(/tauri-rust embedding backend not yet wired/);
  });
});

describe("embedTexts — transformers.js backend (mocked pipeline)", () => {
  it("returns one Embedding per input, in order, with the requested model and dim", async () => {
    const result = await embedTexts(["alpha", "beta", "gamma"]);
    expect(result).toHaveLength(3);
    for (const e of result) {
      expect(e.model).toBe("all-MiniLM-L6-v2");
      expect(e.dim).toBe(4);
      expect(e.values).toBeInstanceOf(Float32Array);
      expect(e.values.length).toBe(4);
    }
  });

  it("L2-normalizes each returned vector (unit length)", async () => {
    const [first] = await embedTexts(["alpha", "beta", "gamma"]);
    expect(first).toBeDefined();
    let normSq = 0;
    for (let i = 0; i < first!.values.length; i++) {
      const v = first!.values[i]!;
      normSq += v * v;
    }
    // Tolerance for the round-trip through Number / Float32Array.
    expect(Math.sqrt(normSq)).toBeCloseTo(1, 5);
  });

  it("preserves input order even for the {id, text} variant", async () => {
    const inputs = [
      { id: "doc-a", text: "alpha" },
      { id: "doc-b", text: "beta" },
    ];
    const result = await embedTexts(inputs);
    expect(result).toHaveLength(2);
    // Mock pipeline puts the unit indicator at index (i % hiddenDim), so the
    // two outputs are distinguishable and not all zero.
    let distinct = false;
    for (let i = 0; i < 4; i++) {
      if (result[0]!.values[i] !== result[1]!.values[i]) distinct = true;
    }
    expect(distinct).toBe(true);
  });
});
