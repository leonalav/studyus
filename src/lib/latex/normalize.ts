import { MATH_DELIMITER_SOURCE } from './katexConfig'

/**
 * Deterministic, pure LaTeX repair. No KaTeX import lives here — this module
 * only rewrites strings, so it can be unit-tested exhaustively and run on the
 * hot path without pulling in the renderer.
 *
 * The contract:
 *   - Surrounding PROSE must survive byte-identical. Only text *inside* a math
 *     segment may be rewritten by the Unicode / escaping / spacing passes.
 *   - `normalize(normalize(x)) === normalize(x)` (idempotent).
 *
 * `normalize()` composes the individual repairs below in a defensible order;
 * that order is documented at the composition site.
 */

// ─── Segment model ────────────────────────────────────────────────────────────

export interface Segment {
  /** 'prose' text is never touched by inside-math passes. */
  kind: 'prose' | 'math'
  text: string
}

/**
 * Split a source string into alternating prose/math segments on the shared
 * delimiter regex. Math segments keep their delimiters so a rewrite can see
 * whether it is inline (`$…$`) or display (`$$…$$`) context and so
 * re-joining is lossless. Prose segments (including empty ones between two
 * adjacent math blocks) are preserved verbatim.
 */
export function extractSegments(src: string): Segment[] {
  const re = new RegExp(MATH_DELIMITER_SOURCE, 'g')
  const out: Segment[] = []
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(src))) {
    if (m.index > last) out.push({ kind: 'prose', text: src.slice(last, m.index) })
    out.push({ kind: 'math', text: m[0] })
    last = m.index + m[0].length
  }
  if (last < src.length) out.push({ kind: 'prose', text: src.slice(last) })
  return out
}

/** Peel delimiters off a math segment → { open, body, close }. */
function splitDelims(seg: string): { open: string; body: string; close: string } {
  if (seg.startsWith('$$') && seg.endsWith('$$') && seg.length >= 4) {
    return { open: '$$', body: seg.slice(2, -2), close: '$$' }
  }
  if (seg.startsWith('\\[') && seg.endsWith('\\]')) {
    return { open: '\\[', body: seg.slice(2, -2), close: '\\]' }
  }
  if (seg.startsWith('\\(') && seg.endsWith('\\)')) {
    return { open: '\\(', body: seg.slice(2, -2), close: '\\)' }
  }
  if (seg.startsWith('$') && seg.endsWith('$') && seg.length >= 2) {
    return { open: '$', body: seg.slice(1, -1), close: '$' }
  }
  return { open: '', body: seg, close: '' }
}

/**
 * Apply a body-rewriting function only to the math bodies of a string, leaving
 * prose and the delimiters themselves untouched. This is the guard that keeps
 * prose byte-identical.
 */
function mapMathBodies(src: string, fn: (body: string) => string): string {
  return extractSegments(src)
    .map((s) => {
      if (s.kind === 'prose') return s.text
      const { open, body, close } = splitDelims(s.text)
      return open + fn(body) + close
    })
    .join('')
}

// ─── Repair 1: strip markdown fences and document wrappers ───────────────────

/**
 * Remove ```` ```latex ```` / ```` ``` ```` fences that models wrap around math,
 * and stray `\begin{document}` / `\end{document}`. Operates on the whole string
 * because fences live in prose, not inside a math segment.
 */
export function stripFences(src: string): string {
  let s = src
  // Opening fence with optional language tag, on its own logical position.
  s = s.replace(/```[ \t]*(?:latex|tex|math)?[ \t]*\r?\n?/gi, '')
  // Any remaining closing fences.
  s = s.replace(/```/g, '')
  s = s.replace(/\\begin\{document\}/g, '')
  s = s.replace(/\\end\{document\}/g, '')
  return s
}

// ─── Repair 2: convert LaTeX environments to $$…$$ ───────────────────────────

/**
 * Convert `equation`, `equation*`, `align`, `align*` environments (which KaTeX
 * does not accept at the top level) into plain `$$…$$`, stripping `\label{}`
 * and `\tag{}` which KaTeX rejects. `align` internals (`&`, `\\`) are handled
 * by wrapping the body in `aligned`, which KaTeX *does* support.
 */
export function convertEnvironments(src: string): string {
  return src.replace(
    /\\begin\{(equation\*?|align\*?|gather\*?|multline\*?)\}([\s\S]*?)\\end\{\1\}/g,
    (_full, env: string, body: string) => {
      let inner = body
      inner = inner.replace(/\\label\{[^}]*\}/g, '')
      inner = inner.replace(/\\tag\{[^}]*\}/g, '')
      inner = inner.replace(/\\tag\*\{[^}]*\}/g, '')
      inner = inner.trim()
      if (env.startsWith('align') || env.startsWith('gather')) {
        inner = `\\begin{aligned}\n${inner}\n\\end{aligned}`
      }
      return `$$${inner}$$`
    },
  )
}

// ─── Repair 3: balance delimiters ─────────────────────────────────────────────

/**
 * Balance `$$`, `$`, `\(…\)` and `\[…]`.
 *
 * Strategy: walk the string tracking open state. `$$` toggles a display block,
 * `$` toggles an inline block, `\[`/`\]` and `\(`/`\)` are matched pairs. If we
 * reach the end still inside a `$` or `$$` block, close it (a common truncation
 * failure). A lone trailing `$` with nothing after it is dropped rather than
 * turned into an empty math block.
 */
export function balanceDelimiters(src: string): string {
  // Drop a lone trailing '$' that opens nothing meaningful.
  let s = src

  // First, count unescaped '$' runs to detect a dangling opener. We tokenise
  // into '$$' and '$' while respecting backslash-escapes.
  let out = ''
  let i = 0
  let openInline = false
  let openDisplay = false
  const n = s.length
  while (i < n) {
    const ch = s[i]
    if (ch === '\\') {
      // Copy the escape and the following char verbatim (handles \$, \\, \[…).
      out += s[i]
      if (i + 1 < n) out += s[i + 1]
      i += 2
      continue
    }
    if (ch === '$') {
      if (s[i + 1] === '$') {
        openDisplay = !openDisplay
        out += '$$'
        i += 2
        continue
      }
      openInline = !openInline
      out += '$'
      i += 1
      continue
    }
    out += ch
    i += 1
  }

  // Close whatever is still open at EOF.
  if (openDisplay) {
    // If the only thing left open is a trailing empty display opener, drop it.
    if (/\$\$\s*$/.test(out)) out = out.replace(/\$\$\s*$/, '')
    else out += '$$'
  }
  if (openInline) {
    if (/\$\s*$/.test(out)) out = out.replace(/\$\s*$/, '')
    else out += '$'
  }

  // Balance \[ \] and \( \) by appending missing closers.
  const openBracket = (out.match(/\\\[/g) || []).length
  const closeBracket = (out.match(/\\\]/g) || []).length
  for (let k = 0; k < openBracket - closeBracket; k++) out += '\\]'

  const openParen = (out.match(/\\\(/g) || []).length
  const closeParen = (out.match(/\\\)/g) || []).length
  for (let k = 0; k < openParen - closeParen; k++) out += '\\)'

  return out
}

// ─── Repair 4: Unicode → command (inside math only) ──────────────────────────

/**
 * Map of literal Unicode characters a model emits to their LaTeX command.
 * Applied only inside math bodies. A trailing space after commands like
 * `\theta ` prevents them gluing onto the next token.
 */
const UNICODE_MAP: ReadonlyArray<[string, string]> = [
  ['θ', '\\theta '],
  ['π', '\\pi '],
  ['α', '\\alpha '],
  ['β', '\\beta '],
  ['γ', '\\gamma '],
  ['δ', '\\delta '],
  ['Δ', '\\Delta '],
  ['λ', '\\lambda '],
  ['μ', '\\mu '],
  ['σ', '\\sigma '],
  ['φ', '\\varphi '],
  ['ω', '\\omega '],
  ['∞', '\\infty '],
  ['≤', '\\le '],
  ['≥', '\\ge '],
  ['≠', '\\ne '],
  ['≈', '\\approx '],
  ['±', '\\pm '],
  ['×', '\\times '],
  ['÷', '\\div '],
  ['·', '\\cdot '],
  ['∫', '\\int '],
  ['∮', '\\oint '],
  ['∑', '\\sum '],
  ['∏', '\\prod '],
  ['√', '\\sqrt '],
  ['∂', '\\partial '],
  ['∇', '\\nabla '],
  ['→', '\\to '],
  ['←', '\\gets '],
  ['↔', '\\leftrightarrow '],
  ['⇒', '\\Rightarrow '],
  ['∈', '\\in '],
  ['∉', '\\notin '],
  ['⊂', '\\subset '],
  ['∪', '\\cup '],
  ['∩', '\\cap '],
  ['∀', '\\forall '],
  ['∃', '\\exists '],
  ['∅', '\\emptyset '],
]

const SUPERSCRIPT_MAP: Readonly<Record<string, string>> = {
  '⁰': '0',
  '¹': '1',
  '²': '2',
  '³': '3',
  '⁴': '4',
  '⁵': '5',
  '⁶': '6',
  '⁷': '7',
  '⁸': '8',
  '⁹': '9',
}

function unicodeBody(body: string): string {
  let b = body
  for (const [uni, cmd] of UNICODE_MAP) {
    if (b.includes(uni)) b = b.split(uni).join(cmd)
  }
  // Superscript digit runs: `x²³` → `x^{23}`. Collapse consecutive
  // superscript characters into a single `^{...}` group.
  b = b.replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹]+/g, (run) => {
    const digits = Array.from(run)
      .map((c) => SUPERSCRIPT_MAP[c] ?? '')
      .join('')
    return `^{${digits}}`
  })
  return b
}

export function unicodeToCommands(src: string): string {
  return mapMathBodies(src, unicodeBody)
}

// ─── Repair 5: strip zero-width / non-breaking spaces (inside math) ──────────

/**
 * Zero-width space (U+200B), BOM / zero-width no-break (U+FEFF), word joiner
 * (U+2060) and non-breaking spaces (U+00A0, U+202F) are a frequent silent
 * KaTeX parse failure. Inside math, drop the invisibles and turn NBSP into a
 * regular space.
 */
function stripInvisiblesBody(body: string): string {
  // ​ zero-width space, ﻿ BOM/zero-width no-break, ⁠ word joiner.
  //   NBSP and   narrow no-break space → regular space.
  return body
    .replace(/[​﻿⁠]/g, '')
    .replace(/[  ]/g, ' ')
}

export function stripInvisibles(src: string): string {
  return mapMathBodies(src, stripInvisiblesBody)
}

// ─── Repair 6: escape bare % and # inside math ───────────────────────────────

/**
 * Inside math, an unescaped `%` starts a LaTeX comment (eating the rest of the
 * line) and `#` is a macro-parameter marker. Models mean them literally, so
 * escape any that aren't already escaped.
 */
function escapeSpecialsBody(body: string): string {
  return body
    .replace(/(^|[^\\])%/g, '$1\\%')
    .replace(/(^|[^\\])#/g, '$1\\#')
}

export function escapeSpecials(src: string): string {
  return mapMathBodies(src, escapeSpecialsBody)
}

// ─── Repair 7: strip **bold** bleeding into math ─────────────────────────────

/**
 * Models sometimes wrap math in markdown emphasis: `$**x**$` or `**$x$**`.
 * Inside a math body, `**…**` is meaningless to KaTeX, so unwrap it. (Prose
 * bold is handled by the markdown renderer and is left alone.)
 */
function stripBoldBody(body: string): string {
  let b = body
  // Repeatedly unwrap in case of nesting like **_x_**.
  let prev
  do {
    prev = b
    b = b.replace(/\*\*([\s\S]*?)\*\*/g, '$1')
  } while (b !== prev)
  return b
}

export function stripBoldInMath(src: string): string {
  return mapMathBodies(src, stripBoldBody)
}

// ─── Repair 8: \left / \right orphan repair ──────────────────────────────────

/**
 * KaTeX throws on an unmatched `\left` or `\right`. Balance them within each
 * math body: append `\right.` for each unmatched `\left`, and prepend `\left.`
 * for each unmatched `\right`. The `.` null-delimiter keeps the render valid
 * without inventing a bracket the author didn't write.
 */
function repairLeftRightBody(body: string): string {
  const lefts = (body.match(/\\left(?![a-zA-Z])/g) || []).length
  const rights = (body.match(/\\right(?![a-zA-Z])/g) || []).length
  let b = body
  if (lefts > rights) {
    b = b + '\\right.'.repeat(lefts - rights)
  } else if (rights > lefts) {
    b = '\\left.'.repeat(rights - lefts) + b
  }
  return b
}

export function repairLeftRight(src: string): string {
  return mapMathBodies(src, repairLeftRightBody)
}

// ─── Repair 9: expand \frac shorthand ────────────────────────────────────────

/**
 * Expand `\frac12` → `\frac{1}{2}` and the general two-bare-token case
 * `\frac ab` / `\frac x2` → `\frac{a}{b}`. A "bare token" is a single
 * character or a single `\command`. Groups that already use braces are left
 * alone. `\dfrac`/`\tfrac`/`\binom` get the same treatment.
 */
function expandFracBody(body: string): string {
  const cmd = '\\\\(?:d|t)?frac|\\\\binom'
  // token = a braced group, a \command, or a single non-brace char
  const token = '\\{[^{}]*\\}|\\\\[a-zA-Z]+|[^\\s{}\\\\]'
  const re = new RegExp(`(${cmd})\\s*(${token})\\s*(${token})`, 'g')
  let b = body
  let prev
  do {
    prev = b
    b = b.replace(re, (_full, c: string, a: string, d: string) => {
      const wrap = (t: string) => (t.startsWith('{') ? t : `{${t}}`)
      return `${c}${wrap(a)}${wrap(d)}`
    })
  } while (b !== prev)
  return b
}

export function expandFrac(src: string): string {
  return mapMathBodies(src, expandFracBody)
}

// ─── Repair 10: wrap undelimited math emitted as prose ───────────────────────

/**
 * Detect a whole prose segment that is really a bare equation the model forgot
 * to delimit — e.g. `r = f(\theta)` — and wrap it in `$…$`.
 *
 * This is deliberately conservative: it only fires on a prose segment whose
 * *entire trimmed content* looks like math (contains a relation or a LaTeX
 * command, and is free of ordinary sentence words / terminal punctuation). We
 * never wrap a fragment mid-sentence, because a false positive corrupts prose.
 */
const LOOKS_LIKE_MATH =
  /^[\s]*[A-Za-z0-9_^{}()\[\]|\\+\-*/=<>.,;:!'`∀-⋿\s]*$/
const HAS_MATH_SIGNAL = /\\[a-zA-Z]+|[=<>]|\^|_\{|\\frac|[+\-*/]\s*[A-Za-z0-9]/
const HAS_PROSE_SIGNAL =
  /[.!?]\s|\b(the|are|and|of|for|with|then|let|where|thus|since|that|this|which|when|from|into|value|angle)\b/i

export function wrapBareMath(src: string): string {
  // Only act if the source has NO delimited math at all — otherwise the author
  // clearly knows how to delimit and any bare text is intentional prose.
  const segs = extractSegments(src)
  if (segs.some((s) => s.kind === 'math')) return src

  const trimmed = src.trim()
  if (!trimmed) return src
  if (!LOOKS_LIKE_MATH.test(trimmed)) return src
  if (!HAS_MATH_SIGNAL.test(trimmed)) return src
  if (HAS_PROSE_SIGNAL.test(trimmed)) return src

  // Preserve leading/trailing whitespace around the wrapped core.
  const lead = src.slice(0, src.length - src.trimStart().length)
  const tail = src.slice(src.trimEnd().length)
  return `${lead}$${trimmed}$${tail}`
}

// ─── Composition ─────────────────────────────────────────────────────────────

/**
 * Compose every repair in a defensible order:
 *
 *  1. stripFences          — remove ``` and \begin{document}; must run first so
 *                            later passes don't treat fence text as math.
 *  2. convertEnvironments  — turn equation/align into $$…$$ BEFORE delimiter
 *                            balancing, so the new $$ pairs are counted.
 *  3. wrapBareMath         — wrap an undelimited equation while it is still the
 *                            whole (delimiter-free) segment; running it after
 *                            balancing would see nothing to do, and running it
 *                            after the inside-math passes would miss the body.
 *  4. balanceDelimiters    — now that all real $$ exist, close the unclosed and
 *                            drop lone trailing $.
 *  5..10. inside-math passes (unicode, invisibles, specials, bold, left/right,
 *         frac) — run last, once delimiters are settled, so `extractSegments`
 *         sees correct math boundaries and prose stays byte-identical.
 *
 * The inside-math passes are internally order-independent except that
 * `unicodeToCommands` should precede `escapeSpecials` (neither introduces the
 * other's targets, so this is belt-and-braces).
 */
export function normalize(src: string): string {
  if (!src) return src
  let s = src
  s = stripFences(s)
  s = convertEnvironments(s)
  s = wrapBareMath(s)
  s = balanceDelimiters(s)
  s = stripInvisibles(s)
  s = unicodeToCommands(s)
  s = escapeSpecials(s)
  s = stripBoldInMath(s)
  s = repairLeftRight(s)
  s = expandFrac(s)
  return s
}
