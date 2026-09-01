/**
 * Embedding module — turn text into 384-dim MiniLM vectors for the corpus
 * retriever. Phase 2 item 3 of the graph-engineered tutor plan; the pure
 * retrieval surface lives in `src/lib/lessonSteps/retrieve.ts`.
 *
 * Two backends, chosen at runtime by `detectBackend()`:
 *
 *   - **tauri-rust** — native Tauri command (`embed_texts`) backed by a
 *     Rust-side ONNX/candle inference engine. Not yet implemented on the
 *     Rust side; selecting it throws a clear TODO so the wiring gap is
 *     visible rather than silently falling back. The Rust work is a
 *     follow-on (item not in this PR).
 *
 *   - **transformers.js** — `@huggingface/transformers` v3 in the browser
 *     single-file build, where no Tauri runtime is present. The pipeline is
 *     loaded lazily on first `embedTexts()` call and memoized for the
 *     process lifetime.
 *
 * The runtime selector mirrors `isTauriRuntime()` from `src/lib/tauri.ts`;
 * if no Tauri runtime is present we always run the JS path.
 */

// Type declarations for `@huggingface/transformers` live in
// `src/types/transformers.d.ts`. That file exists because the package is not
// yet a declared dependency (PR lists it for approval); once added, the
// package's own `.d.ts` supersedes ours.

import { pipeline, env, type FeatureExtractionPipeline } from "@huggingface/transformers";
import { isTauriRuntime } from "./tauri";

env.allowLocalModels = false; // we use the Hub; no vendored weights.

/** The single model this module knows how to embed with. */
export type EmbeddingModel = "all-MiniLM-L6-v2";

/** Runtime backend selector for `embedTexts()`. */
export type EmbeddingBackend =
  | { kind: "tauri-rust"; modelId: EmbeddingModel }
  | { kind: "transformers-js"; modelId: EmbeddingModel };

/** A single embedding record. `dim` is fixed by `model` (384 for MiniLM). */
export type Embedding = {
  readonly model: EmbeddingModel;
  readonly dim: number;
  readonly values: Float32Array;
};

/** Either a bare string or an object that carries a stable id alongside it. */
export type TextInput = string | { id: string; text: string };

/**
 * Compute embeddings for a batch of strings. The transformers.js path lazily
 * boots a feature-extraction pipeline on first call and reuses it thereafter.
 * The tauri-rust path is a TODO stub until `src-tauri/src/lib.rs` exposes an
 * `embed_texts` command.
 *
 * Returned order matches input order. Empty input is rejected.
 */
export async function embedTexts(
  inputs: readonly TextInput[],
  opts?: { backend?: EmbeddingBackend },
): Promise<Embedding[]> {
  if (inputs.length === 0) {
    throw new Error("embedTexts: empty input");
  }
  const backend = opts?.backend ?? detectBackend();

  if (backend.kind === "tauri-rust") {
    // TODO(phase2): when src-tauri/src/lib.rs exposes an `embed_texts`
    // command, replace this throw with:
    //   const t = tauriInternals();
    //   if (!t) throw new TauriUnavailableError("…");
    //   const vectors = await t.invoke<number[][]>("embed_texts", {
    //     model: backend.modelId,
    //     texts: inputs.map(toText),
    //   });
    //   return vectors.map((row) => ({ model: backend.modelId, dim: row.length, values: Float32Array.from(row) }));
    throw new Error(
      "tauri-rust embedding backend not yet wired; expected src-tauri/src/lib.rs to expose embed_texts",
    );
  }

  const texts = inputs.map(toText);
  const pipe = await getTransformersPipeline();
  const output = (await pipe(texts)) as TransformersTensor;
  const vectors = meanPoolAndNormalize(output, texts.length);
  return vectors.map((values) => ({
    model: backend.modelId,
    dim: values.length,
    values,
  }));
}

/** Choose the backend based on the runtime: Tauri → native, else JS. */
export function detectBackend(): EmbeddingBackend {
  return isTauriRuntime()
    ? { kind: "tauri-rust", modelId: "all-MiniLM-L6-v2" }
    : { kind: "transformers-js", modelId: "all-MiniLM-L6-v2" };
}

/* ── internal: transformers.js pipeline management ── */

let pipelinePromise: Promise<FeatureExtractionPipeline> | null = null;

/**
 * Lazy pipeline factory. We pick the `Xenova/all-MiniLM-L6-v2` mirror because
 * it is the published identifier in the transformers.js ecosystem (the
 * canonical HuggingFace model name is `all-MiniLM-L6-v2`; both names point at
 * the same weights).
 */
function getTransformersPipeline(): Promise<FeatureExtractionPipeline> {
  const existing = pipelinePromise;
  if (existing !== null) {
    return existing;
  }
  const created = pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2");
  pipelinePromise = created;
  return created;
}

/** Shape of a transformers.js output tensor — we only read `data` and `dims`. */
type TransformersTensor = {
  data: Float32Array;
  dims: readonly number[];
};

/**
 * Mean-pool over the token dimension and L2-normalize each row. transformers.js
 * returns token-level embeddings of shape `[batch, seq_len, hidden_dim]`
 * (collapsing to `[seq_len, hidden_dim]` when `batch === 1`). The corpus
 * retriever expects unit-length vectors so cosine reduces to a dot product.
 */
function meanPoolAndNormalize(
  tensor: TransformersTensor,
  expectedBatch: number,
): Float32Array[] {
  const dims = tensor.dims;
  let batch: number;
  let seqLen: number;
  let hiddenDim: number;
  if (dims.length === 3) {
    batch = dims[0]!;
    seqLen = dims[1]!;
    hiddenDim = dims[2]!;
  } else if (dims.length === 2) {
    batch = 1;
    seqLen = dims[0]!;
    hiddenDim = dims[1]!;
  } else {
    throw new Error(
      `embedTexts: unexpected transformers.js tensor dims ${JSON.stringify(dims)}`,
    );
  }
  if (batch !== expectedBatch) {
    throw new Error(
      `embedTexts: batch size mismatch (expected ${expectedBatch}, got ${batch})`,
    );
  }

  const out: Float32Array[] = [];
  for (let b = 0; b < batch; b++) {
    const pooled = new Float32Array(hiddenDim);
    const base = b * seqLen * hiddenDim;
    for (let s = 0; s < seqLen; s++) {
      const offset = base + s * hiddenDim;
      for (let h = 0; h < hiddenDim; h++) {
        pooled[h]! += tensor.data[offset + h]!;
      }
    }
    if (seqLen > 1) {
      for (let h = 0; h < hiddenDim; h++) {
        pooled[h]! /= seqLen;
      }
    }

    // L2-normalize; keep the zero vector when the pooled row was identically
    // zero so callers can still see a deterministic length.
    let normSq = 0;
    for (let h = 0; h < hiddenDim; h++) {
      const v = pooled[h]!;
      normSq += v * v;
    }
    const norm = Math.sqrt(normSq);
    if (norm > 0) {
      for (let h = 0; h < hiddenDim; h++) {
        pooled[h]! /= norm;
      }
    }
    out.push(pooled);
  }
  return out;
}

function toText(input: TextInput): string {
  return typeof input === "string" ? input : input.text;
}
