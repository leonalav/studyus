import katex from 'katex'
import { KATEX_OPTIONS, freshMacros, mathDelimiterRegex } from './katexConfig'
import { normalize, extractSegments } from './normalize'
import { validate } from './validate'

/**
 * The three-rung fallback ladder. Callers get a STRUCTURED result,
 * not a bare HTML string, so they can react to a fallback (e.g. surface the
 * `latex_render_failed` diagnostic, style the raw block, log it). No rung ever
 * silently emits broken prose — the old `catch {}` behaviour is gone.
 */

export type RenderTier = 'normalized' | 'stripped' | 'raw'

export interface RenderResult {
  /** Ready-to-inject HTML. Safe: KaTeX output with `trust` scoped, or an
   *  HTML-escaped `<code>` block at the raw tier. */
  html: string
  /** Which rung produced this. 'raw' means both KaTeX attempts failed. */
  tier: RenderTier
  /** True when we fell through to the raw-source fallback. */
  failed: boolean
  /** KaTeX error from the last failing attempt, when `failed`. */
  error?: string
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

/**
 * Rung 2 repair: strip unknown macros. A `\command` KaTeX doesn't know throws;
 * as a last-ditch measure before showing raw source, remove backslash-commands
 * that aren't in a small whitelist of structural primitives, so the surrounding
 * expression can still typeset. This is lossy and only reached after the
 * normalised parse already failed.
 */
const STRUCTURAL_WHITELIST = new Set([
  'frac', 'sqrt', 'sum', 'int', 'prod', 'lim', 'left', 'right', 'begin', 'end',
  'cdot', 'times', 'div', 'pm', 'mp', 'le', 'ge', 'ne', 'approx', 'to', 'infty',
  'theta', 'pi', 'alpha', 'beta', 'gamma', 'delta', 'Delta', 'lambda', 'mu',
  'sigma', 'omega', 'partial', 'nabla', 'text', 'mathrm', 'mathbb', 'mathbf',
  'mathcal', 'hat', 'bar', 'vec', 'dot', 'overline', 'underline', 'binom',
  'cos', 'sin', 'tan', 'log', 'ln', 'exp', 'quad', 'qquad', 'in', 'notin',
  'subset', 'cup', 'cap', 'forall', 'exists', 'emptyset', 'color', 'varphi',
  'varepsilon', 'aligned', 'array', 'cases', 'matrix', 'pmatrix', 'bmatrix',
])

export function stripUnknownMacros(tex: string): string {
  return tex.replace(/\\([a-zA-Z]+)/g, (full, name: string) =>
    STRUCTURAL_WHITELIST.has(name) ? full : '',
  )
}

/** Callback so a caller (e.g. a diagnostics store) can observe failures. */
export type DiagnosticSink = (event: {
  code: 'latex_render_failed'
  tex: string
  displayMode: boolean
  error: string
}) => void

/**
 * Render a single already-normalised (or to-be-normalised) LaTeX string
 * through the ladder. Pass `alreadyNormalized: true` when the source has been
 * run through `normalize()` upstream (e.g. `renderMixed`) to avoid doubling the
 * work.
 */
export function renderMath(
  src: string,
  displayMode: boolean,
  opts: { alreadyNormalized?: boolean; onDiagnostic?: DiagnosticSink } = {},
): RenderResult {
  // `src` is a bare math BODY (no delimiters). `normalize()` operates on
  // delimited segments, so when the caller hasn't already normalised, wrap the
  // body in delimiters matching the mode, normalise, then unwrap — this lets
  // the inside-math repairs (unicode, \frac shorthand, \left/\right) reach it.
  let tex: string
  if (opts.alreadyNormalized) {
    tex = src
  } else {
    const wrapped = displayMode ? `$$${src}$$` : `$${src}$`
    const norm = normalize(wrapped)
    tex = displayMode
      ? norm.replace(/^\$\$([\s\S]*)\$\$$/, '$1')
      : norm.replace(/^\$([\s\S]*)\$$/, '$1')
  }

  // Rung 1: normalised → render.
  const first = validate(tex, displayMode)
  if (first.ok) {
    return {
      html: katex.renderToString(tex, { ...KATEX_OPTIONS, macros: freshMacros(), displayMode }),
      tier: 'normalized',
      failed: false,
    }
  }

  // Rung 2: strip unknown macros → render.
  const stripped = stripUnknownMacros(tex)
  if (stripped !== tex && validate(stripped, displayMode).ok) {
    return {
      html: katex.renderToString(stripped, { ...KATEX_OPTIONS, macros: freshMacros(), displayMode }),
      tier: 'stripped',
      failed: false,
    }
  }

  // Rung 3: visible raw-source fallback. HTML-escape the untrusted model text.
  const errMsg = first.error || 'parse failed'
  opts.onDiagnostic?.({
    code: 'latex_render_failed',
    tex,
    displayMode,
    error: errMsg,
  })
  // The learner is not the audience for a parser failure. Label it as maths we
  // could not typeset, not as "raw LaTeX" — which reads like leaked plumbing —
  // and keep the source visible but visually demoted so the surrounding lesson
  // still reads as a lesson.
  const html =
    `<code class="latex-raw" data-latex-raw="1" title="This expression could not be typeset">` +
    `<span class="latex-raw-label">unrendered maths</span>` +
    `<span class="latex-raw-src">${escapeHtml(src)}</span></code>`
  return { html, tier: 'raw', failed: true, error: errMsg }
}

/** Strip the delimiters off a math segment, returning body + display mode. */
function unwrap(seg: string): { body: string; displayMode: boolean } {
  if (seg.startsWith('$$')) return { body: seg.slice(2, -2), displayMode: true }
  if (seg.startsWith('\\[')) return { body: seg.slice(2, -2), displayMode: true }
  if (seg.startsWith('\\(')) return { body: seg.slice(2, -2), displayMode: false }
  return { body: seg.slice(1, -1), displayMode: false }
}

export interface RenderMixedResult {
  html: string
  /** True if ANY math segment fell through to the raw fallback. */
  anyFailed: boolean
}

/**
 * Normalise a mixed prose+math string once, then render each math segment
 * through the ladder, escaping prose.
 *
 * `renderProse` lets a caller reuse its own prose formatter (e.g. `<br/>` for
 * newlines); by default prose is HTML-escaped verbatim.
 */
export function renderMixed(
  src: string,
  opts: { renderProse?: (prose: string) => string; onDiagnostic?: DiagnosticSink } = {},
): RenderMixedResult {
  if (!src.trim()) return { html: '', anyFailed: false }
  const proseFn = opts.renderProse ?? escapeHtml
  const normalized = normalize(src)
  const segments = extractSegments(normalized)
  let anyFailed = false
  const html = segments
    .map((seg) => {
      if (seg.kind === 'prose') return proseFn(seg.text)
      const { body, displayMode } = unwrap(seg.text)
      const r = renderMath(body, displayMode, {
        alreadyNormalized: true,
        onDiagnostic: opts.onDiagnostic,
      })
      if (r.failed) anyFailed = true
      return r.html
    })
    .join('')
  return { html, anyFailed }
}

// `mathDelimiterRegex` is re-exported for consumers that need the raw splitter
// without importing katexConfig directly.
export { mathDelimiterRegex }
