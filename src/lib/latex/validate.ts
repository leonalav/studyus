import katex from 'katex'
import { KATEX_VALIDATE_OPTIONS, freshMacros } from './katexConfig'

/**
 * KaTeX-backed validation, memoised. `render.ts` uses this to decide whether a
 * normalised string is safe to hand to the renderer, and callers can use the
 * result to drive a fallback ladder rather than discovering the failure as a
 * red error node in the DOM.
 */

export type ValidateResult = { ok: true } | { ok: false; error: string }

// Bounded LRU-ish cache. Keyed by a cheap string hash of `tex + displayMode`.
// We cap the size and evict the oldest insertion so a long tutoring session
// that streams thousands of distinct expressions can't grow this without
// bound.
const CACHE_LIMIT = 512
const cache = new Map<string, ValidateResult>()

/** djb2 — small, fast, good enough to key a render cache. */
function hash(s: string): string {
  let h = 5381
  for (let i = 0; i < s.length; i++) {
    h = (h * 33) ^ s.charCodeAt(i)
  }
  // >>> 0 to get an unsigned 32-bit value.
  return (h >>> 0).toString(36)
}

/**
 * Attempt a KaTeX parse with `throwOnError: true`. Returns a discriminated
 * result. Memoised by `hash(tex + '\x00' + displayMode)`.
 */
export function validate(tex: string, displayMode: boolean): ValidateResult {
  const key = hash(`${tex}\x00${displayMode ? 'D' : 'I'}`)
  const hit = cache.get(key)
  if (hit) {
    // Refresh recency: delete + re-set moves it to the end of insertion order.
    cache.delete(key)
    cache.set(key, hit)
    return hit
  }

  let result: ValidateResult
  try {
    katex.renderToString(tex, { ...KATEX_VALIDATE_OPTIONS, macros: freshMacros(), displayMode })
    result = { ok: true }
  } catch (e) {
    result = { ok: false, error: e instanceof Error ? e.message : String(e) }
  }

  cache.set(key, result)
  if (cache.size > CACHE_LIMIT) {
    // Evict oldest insertion (first key in iteration order).
    const oldest = cache.keys().next().value
    if (oldest !== undefined) cache.delete(oldest)
  }
  return result
}

/** Test-only hook so cache state doesn't leak between test cases. */
export function _clearValidateCache(): void {
  cache.clear()
}
