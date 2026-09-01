/**
 * Minimal type declarations for `@huggingface/transformers` v3.
 *
 * The runtime dep is reported in the PR but not yet added to `package.json`
 * (user approval pending). Without these declarations the import in
 * `src/lib/embeddings.ts` fails typecheck. The runtime path is exercised
 * through `vi.mock("@huggingface/transformers", …)` in tests; once the
 * package is installed, these declarations are shadowed by the package's own
 * `.d.ts` and remain a no-op.
 *
 * Kept deliberately narrow — only the symbols the embedding module reads.
 */
declare module "@huggingface/transformers" {
  export interface FeatureExtractionPipeline {
    (input: string | string[], options?: Record<string, unknown>): Promise<unknown>;
  }
  export function pipeline(
    task: "feature-extraction",
    model: string,
    options?: Record<string, unknown>,
  ): Promise<FeatureExtractionPipeline>;
  export const env: { allowLocalModels: boolean };
}
