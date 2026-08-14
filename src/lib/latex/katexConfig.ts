import type { KatexOptions } from 'katex'

/**
 * Single source of truth for KaTeX configuration and math delimiters.
 *
 * Both `Visuals.tsx` `Latex` and `VisualizationSurface.tsx` `EquationSurface`
 * import from here so the two call sites can no longer drift apart. Ported
 * from leonalav/studyus-provisional-repo (pure TS, drop-in).
 */

export interface Delimiter {
  left: string
  right: string
  display: boolean
}

/**
 * Delimiters recognised as math, longest-opening-first so `$$` is matched
 * before `$` and `\[`/`\(` before their single-char cousins. This ordering
 * matters both for KaTeX's auto-render and for the shared regex below.
 */
export const DELIMITERS: readonly Delimiter[] = Object.freeze([
  { left: '\\[', right: '\\]', display: true },
  { left: '$$', right: '$$', display: true },
  { left: '\\(', right: '\\)', display: false },
  { left: '$', right: '$', display: false },
])

/**
 * The one regex that splits prose from math. Capturing group so
 * `String.prototype.split` keeps the delimited chunks. Order mirrors
 * DELIMITERS: `\[…\]`, `$$…$$`, `\(…\)`, then single `$…$` (which forbids a
 * newline and an empty body so a lone `$` in prose isn't mistaken for math).
 *
 * Exported as a factory too, because a shared global-flag RegExp carries
 * `lastIndex` state and is unsafe to reuse across `.exec()` loops.
 */
export const MATH_DELIMITER_SOURCE =
  '(\\\\\\[[\\s\\S]*?\\\\\\]|\\$\\$[\\s\\S]*?\\$\\$|\\\\\\([\\s\\S]*?\\\\\\)|\\$[^$\\n]+?\\$)'

/** Fresh global regex — never share a `lastIndex`-bearing instance. */
export function mathDelimiterRegex(): RegExp {
  return new RegExp(MATH_DELIMITER_SOURCE, 'g')
}

/**
 * Macros expanded before parsing. Kept deliberately small: these are common
 * shorthands a tutoring model reaches for that vanilla KaTeX lacks, plus the
 * blackboard-bold number sets students expect. Growing this set is cheap and
 * safe; it only ever adds capability.
 */
export const MACROS: Readonly<Record<string, string>> = Object.freeze({
  '\\RR': '\\mathbb{R}',
  '\\NN': '\\mathbb{N}',
  '\\ZZ': '\\mathbb{Z}',
  '\\QQ': '\\mathbb{Q}',
  '\\CC': '\\mathbb{C}',
  '\\eps': '\\varepsilon',
  '\\dd': '\\mathrm{d}',
  '\\diff': '\\mathrm{d}',
})

/**
 * A fresh, MUTABLE macro map for one KaTeX call.
 *
 * KaTeX treats the `macros` option as scratch space: expanding `\\begin{cases}`
 * (or aligned/matrix/array) makes it define `\\cr` inside the map. Sharing one
 * object across calls also leaks those definitions between renders. Always hand
 * KaTeX its own copy.
 */
export function freshMacros(): Record<string, string> {
  return { ...MACROS }
}

/**
 * The frozen, shared KaTeX options.
 *
 * `strict: 'ignore'` — a tutoring model emits imperfect LaTeX constantly
 * (Unicode operators, `\text` quirks, mismatched fonts). Treating every
 * warning as an error would fail renders that a human reads fine. We repair
 * what we can upstream in `normalize()` and want KaTeX to be lenient about the
 * rest rather than throw. (Hard *parse* errors are still caught by the render
 * ladder; `strict` only governs the soft warnings.)
 *
 * `trust` is a PREDICATE, not `true`. Blanket `trust: true` would enable
 * `\includegraphics`, `\href`, `\url`, `\htmlClass` etc. — arbitrary URLs and
 * DOM injection sourced from model output, which is untrusted. We allow only
 * `\color` (purely visual, no navigation or resource load) and deny
 * everything else. This keeps colour available for pedagogy without opening a
 * link/script vector.
 */
export const KATEX_OPTIONS: Readonly<KatexOptions> = Object.freeze({
  throwOnError: false,
  strict: 'ignore',
  output: 'html',
  // NOT the frozen MACROS object. KaTeX WRITES into the macros map while
  // expanding multi-line environments — it stores `\\cr` there — so passing a
  // frozen object throws "Cannot add property \\cr, object is not extensible"
  // and fails EVERY \begin{cases}/aligned/matrix render straight through to
  // the raw-source fallback. `macros()` hands out a fresh mutable copy.
  macros: { ...MACROS },
  // Typed loosely: `@types/katex` and the version bundled with the `katex`
  // package ship slightly different `TrustContext` unions (neither lists
  // `\color`), so we accept a structural `{ command?: string }` and compare the
  // command string. Only `\color` is trusted.
  trust: (context: { command?: string }) => context.command === '\\color',
} as KatexOptions)

/**
 * Options for a *validation* parse: identical to the render options but with
 * `throwOnError: true` so a genuine parse failure surfaces instead of
 * rendering a red error node. `strict` stays lenient so validation matches
 * what the renderer will actually accept.
 */
export const KATEX_VALIDATE_OPTIONS: Readonly<KatexOptions> = Object.freeze({
  ...KATEX_OPTIONS,
  throwOnError: true,
})
