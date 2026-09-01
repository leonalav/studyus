/**
 * Tests for the corpus retrieval module.
 *
 * The test corpus uses hand-set unit vectors — no real embedding model is
 * involved, so each test runs in microseconds and the suite stays hermetic.
 */

import { describe, expect, it } from "vitest";
import type { Embedding } from "../embeddings";
import {
  buildCorpusIndex,
  entryTextFromJson,
  type CorpusEntry,
} from "./retrieve";

const MODEL = "all-MiniLM-L6-v2" as const;

/** Build an L2-normalized Embedding from a numeric vector. */
function embedding(values: number[]): Embedding {
  let normSq = 0;
  for (const v of values) normSq += v * v;
  const norm = Math.sqrt(normSq);
  const arr = new Float32Array(values.length);
  for (let i = 0; i < values.length; i++) arr[i] = values[i]! / norm;
  return { model: MODEL, dim: arr.length, values: arr };
}

/** Build a CorpusEntry with hand-set embedding. */
function entry(id: string, file: string, text: string, values: number[]): CorpusEntry {
  return { id, file, text, embedding: embedding(values) };
}

describe("entryTextFromJson", () => {
  it("produces a deterministic flattening for a representative LessonStep JSON", () => {
    const json: Record<string, unknown> = {
      id: "math.limits.predict-from-right",
      route: "prediction",
      stage: "encounter",
      mode: "explore",
      contextVariant: "same",
      targetSkill: "math.limits.base",
      requiredVisualizationKind: "function",
      proseSlots: [
        { blockId: "concept-1", hint: "Frame the function clearly.", tone: "inquisitive" },
        { blockId: "question-1", hint: "Offer four options.", tone: "concise" },
      ],
      requiredEvidence: ["prediction", "observation"],
    };
    const expected =
      "math.limits.predict-from-right\n" +
      "prediction\n" +
      "encounter\n" +
      "explore\n" +
      "same\n" +
      "math.limits.base\n" +
      "Frame the function clearly.\n" +
      "Offer four options.\n" +
      "function\n" +
      "prediction\n" +
      "observation";
    expect(entryTextFromJson(json)).toBe(expected);
  });

  it("omits the visualization kind when it is not present", () => {
    const json: Record<string, unknown> = {
      id: "math.limits.mc-on-limits",
      route: "guided_retry",
      stage: "apply",
      mode: "guided_practice",
      contextVariant: "changed_numbers",
      targetSkill: "math.limits.base",
      proseSlots: [{ blockId: "question-1", hint: "Stem + distractors.", tone: "concise" }],
      requiredEvidence: ["selection", "explanation"],
    };
    const expected =
      "math.limits.mc-on-limits\n" +
      "guided_retry\n" +
      "apply\n" +
      "guided_practice\n" +
      "changed_numbers\n" +
      "math.limits.base\n" +
      "Stem + distractors.\n" +
      "selection\n" +
      "explanation";
    expect(entryTextFromJson(json)).toBe(expected);
  });

  it("skips proseSlots entries with non-string hints", () => {
    const json: Record<string, unknown> = {
      id: "x",
      route: "r",
      stage: "s",
      mode: "m",
      contextVariant: "c",
      targetSkill: "t",
      proseSlots: [
        { blockId: "a", hint: "kept" },
        { blockId: "b", hint: 7 }, // dropped
        { blockId: "c" }, // dropped
      ],
      requiredEvidence: [],
    };
    expect(entryTextFromJson(json)).toBe("x\nr\ns\nm\nc\nt\nkept");
  });
});

describe("buildCorpusIndex", () => {
  it("rejects mixed-model entries", () => {
    // Cast through `unknown` so the literal model type doesn't fight us —
    // this test specifically checks the runtime rejection of mixed models.
    const foreignEmbedding = {
      model: "other-model",
      dim: 4,
      values: new Float32Array([0, 1, 0, 0]),
    } as unknown as Embedding;
    const entries: CorpusEntry[] = [
      entry("a", "a.json", "a", [1, 0, 0, 0]),
      { id: "b", file: "b.json", text: "b", embedding: foreignEmbedding },
    ];
    expect(() => buildCorpusIndex(entries)).toThrow("mixed embedding models in corpus");
  });

  it("rejects mixed-dim entries", () => {
    const entries: CorpusEntry[] = [
      entry("a", "a.json", "a", [1, 0, 0, 0]),
      entry("b", "b.json", "b", [1, 0, 0, 0, 0]),
    ];
    expect(() => buildCorpusIndex(entries)).toThrow("mixed embedding models in corpus");
  });

  it("returns an empty index for an empty corpus", () => {
    const idx = buildCorpusIndex([]);
    expect(idx.size).toBe(0);
    expect(idx.dim).toBe(0);
    expect(idx.search(embedding([1, 0]), 5)).toEqual([]);
  });

  it("reports size and dim on the index header", () => {
    const idx = buildCorpusIndex([
      entry("a", "a.json", "a", [1, 0, 0]),
      entry("b", "b.json", "b", [0, 1, 0]),
      entry("c", "c.json", "c", [0, 0, 1]),
    ]);
    expect(idx.size).toBe(3);
    expect(idx.dim).toBe(3);
  });
});

describe("CorpusIndex.search", () => {
  it("returns top-k in descending score order for a 5-entry toy corpus", () => {
    const entries: CorpusEntry[] = [
      entry("e0", "0.json", "t", [1, 0, 0, 0]),     // exact match → 1.0
      entry("e1", "1.json", "t", [0.9, 0.1, 0, 0]),  // very close
      entry("e2", "2.json", "t", [0, 1, 0, 0]),      // orthogonal
      entry("e3", "3.json", "t", [0, 0, 1, 0]),      // orthogonal
      entry("e4", "4.json", "t", [0, 0, 0, 1]),      // orthogonal
    ];
    const idx = buildCorpusIndex(entries);
    const query = embedding([1, 0, 0, 0]);
    const hits = idx.search(query, 3);

    expect(hits.map((h) => h.id)).toEqual(["e0", "e1", "e2"]);
    expect(hits[0]!.score).toBeGreaterThanOrEqual(hits[1]!.score);
    expect(hits[1]!.score).toBeGreaterThanOrEqual(hits[2]!.score);
    expect(hits[0]!.score).toBeCloseTo(1, 6);
  });

  it("with k > size returns all entries sorted", () => {
    const entries: CorpusEntry[] = [
      entry("e0", "0.json", "t", [1, 0]),         // → 1.0
      entry("e1", "1.json", "t", [0, 1]),         // → 0.0
      entry("e2", "2.json", "t", [0.7071, 0.7071]), // → ~0.7071
    ];
    const idx = buildCorpusIndex(entries);
    const query = embedding([1, 0]);
    const hits = idx.search(query, 10);

    expect(hits).toHaveLength(3);
    expect(hits.map((h) => h.id)).toEqual(["e0", "e2", "e1"]);
    expect(hits[0]!.score).toBe(1);
    expect(hits[1]!.score).toBeCloseTo(0.7071, 3);
  });

  it("returns the obvious near-match for a known query", () => {
    const entries: CorpusEntry[] = [
      entry("limits.predict", "01.json", "t", [1, 0, 0]),
      entry("derivatives.intro", "10.json", "t", [0, 1, 0]),
      entry("integrals.intro", "20.json", "t", [0, 0, 1]),
    ];
    const idx = buildCorpusIndex(entries);
    // Query is ~95% aligned with the limits entry.
    const q = embedding([0.95, 0.05, 0]);
    const hits = idx.search(q, 1);

    expect(hits[0]!.id).toBe("limits.predict");
    expect(hits[0]!.file).toBe("01.json");
    expect(hits[0]!.score).toBeGreaterThan(0.9);
  });

  it("rounds scores to 6 decimals so callers see stable values", () => {
    const entries: CorpusEntry[] = [
      entry("e0", "0.json", "t", [0.5773503, 0.5773503, 0.5773503]), // 1/sqrt(3) each
    ];
    const idx = buildCorpusIndex(entries);
    const q = embedding([0.5773503, 0.5773503, 0.5773503]);
    const hits = idx.search(q, 1);
    // Each entry value stored as Float32 rounds slightly; score should round to 6 decimals.
    expect(hits[0]!.score).toBeLessThanOrEqual(1.000001);
    expect(hits[0]!.score).toBeGreaterThan(0.999999);
  });

  it("returns an empty array for k === 0", () => {
    const idx = buildCorpusIndex([entry("e0", "0.json", "t", [1, 0])]);
    expect(idx.search(embedding([1, 0]), 0)).toEqual([]);
  });

  it("rejects a query whose dim does not match the corpus", () => {
    const idx = buildCorpusIndex([entry("e0", "0.json", "t", [1, 0, 0])]);
    expect(() => idx.search(embedding([1, 0]), 1)).toThrow(/query dim/);
  });
});
