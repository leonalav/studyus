/**
 * Corpus retrieval — brute-force cosine over an in-memory embedding matrix.
 *
 * Phase 2 item 4 of the graph-engineered tutor plan. The corpus is small
 * (≤ ~50 hand-authored LessonStep JSONs per subject), so brute-force is well
 * below the FAISS/HNSW threshold and keeps the dependency surface flat.
 *
 * The cosine computation exploits the fact that `embedTexts()` L2-normalizes
 * its output: cosine similarity between two unit vectors equals their dot
 * product, which is one multiply-accumulate loop per pair.
 *
 * This module is pure data — no DB, no IPC, no LLM calls. It is intended to
 * be wired into `buildPolicyBrief` as the `corpusRef` on `LessonStep`
 * (Phase 2 item 5, NOT in this PR).
 */

import type { Embedding } from "../embeddings";

/** A single corpus record paired with its precomputed embedding. */
export type CorpusEntry = {
  readonly id: string;
  readonly file: string;
  readonly text: string;
  readonly embedding: Embedding;
};

/** A retrieval hit. `score` is cosine similarity rounded to 6 decimals. */
export type RetrieveHit = {
  readonly id: string;
  readonly file: string;
  readonly score: number;
};

/**
 * A frozen corpus index. `search` is a closure over the packed matrix — for
 * ≤ ~1000 entries per subject, a single linear scan is sub-millisecond on
 * any modern machine and far simpler than a graph index.
 */
export type CorpusIndex = {
  readonly size: number;
  readonly dim: number;
  search(query: Embedding, k: number): RetrieveHit[];
};

/**
 * Flatten a LessonStep JSON into a single string for embedding. The fields are
 * concatenated in fixed order so two semantically equivalent steps produce
 * the same vector regardless of JSON key ordering.
 *
 *   id → route → stage → mode → contextVariant → targetSkill →
 *   each `proseSlots[i].hint` → `requiredVisualizationKind` (if present) →
 *   each `requiredEvidence` entry
 *
 * Fields are joined with `"\n"`.
 */
export function entryTextFromJson(json: Record<string, unknown>): string {
  const fields: string[] = [];
  const pushStr = (v: unknown): void => {
    if (typeof v === "string" && v.length > 0) {
      fields.push(v);
    }
  };

  pushStr(json["id"]);
  pushStr(json["route"]);
  pushStr(json["stage"]);
  pushStr(json["mode"]);
  pushStr(json["contextVariant"]);
  pushStr(json["targetSkill"]);

  const proseSlots = json["proseSlots"];
  if (Array.isArray(proseSlots)) {
    for (const slot of proseSlots) {
      if (slot !== null && typeof slot === "object") {
        pushStr((slot as Record<string, unknown>)["hint"]);
      }
    }
  }

  pushStr(json["requiredVisualizationKind"]);

  const evidence = json["requiredEvidence"];
  if (Array.isArray(evidence)) {
    for (const e of evidence) {
      pushStr(e);
    }
  }

  return fields.join("\n");
}

/**
 * Pack a corpus of `CorpusEntry` into a flat `Float32Array` of length
 * `size * dim` and freeze it behind a `search()` closure. All entries must
 * share a single `(model, dim)` — mixing models silently yields nonsense
 * scores, so we reject up front.
 */
export function buildCorpusIndex(entries: readonly CorpusEntry[]): CorpusIndex {
  const size = entries.length;
  if (size === 0) {
    return {
      size: 0,
      dim: 0,
      search: () => [],
    };
  }

  const firstEntry = entries[0]!;
  const model = firstEntry.embedding.model;
  const dim = firstEntry.embedding.dim;
  for (const e of entries) {
    if (e.embedding.model !== model || e.embedding.dim !== dim) {
      throw new Error("mixed embedding models in corpus");
    }
  }

  const matrix = new Float32Array(size * dim);
  const ids = new Array<string>(size);
  const files = new Array<string>(size);
  for (let i = 0; i < size; i++) {
    const entry = entries[i]!;
    const values = entry.embedding.values;
    if (values.length !== dim) {
      throw new Error("mixed embedding models in corpus");
    }
    matrix.set(values, i * dim);
    ids[i] = entry.id;
    files[i] = entry.file;
  }

  return {
    size,
    dim,
    search(query: Embedding, k: number): RetrieveHit[] {
      if (query.dim !== dim) {
        throw new Error(
          `retrieve.search: query dim ${query.dim} does not match corpus dim ${dim}`,
        );
      }
      if (k <= 0 || size === 0) {
        return [];
      }
      const q = query.values;

      // Brute-force: score every entry, then take the top-k.
      const scores = new Array<{ idx: number; score: number }>(size);
      for (let i = 0; i < size; i++) {
        const off = i * dim;
        let dot = 0;
        for (let j = 0; j < dim; j++) {
          dot += matrix[off + j]! * q[j]!;
        }
        // Rounding to 6 decimals so callers (and the test) see a stable score
        // independent of tiny floating-point reorderings.
        scores[i] = { idx: i, score: Number(dot.toFixed(6)) };
      }
      scores.sort((a, b) => b.score - a.score);

      const n = Math.min(k, size);
      const out: RetrieveHit[] = new Array(n);
      for (let r = 0; r < n; r++) {
        const hit = scores[r]!;
        out[r] = { id: ids[hit.idx]!, file: files[hit.idx]!, score: hit.score };
      }
      return out;
    },
  };
}
