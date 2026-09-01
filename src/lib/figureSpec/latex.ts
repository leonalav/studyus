/**
 * Tiny LaTeX-to-JavaScript expression translator.
 *
 * Handles the polynomial shapes that show up in textbook figures and that the
 * agent is told to emit in `figureSpec` prompts:
 *
 *   "x^2"             → "x**2"
 *   "x^3 - 4*x"       → "x**3 - 4*x"
 *   "(1/2)*x^2 + 3"    → "(1/2)*x**2 + 3"
 *   "sin(x)"          → "sin(x)"
 *   "x^2 + 1"         → "x**2 + 1"
 *
 * It is intentionally NOT a full LaTeX parser — the validator
 * (`lib/widgets/validate.ts`) enforces a length cap and the same safe-
 * expression evaluator that gates slider readouts, so the surface is
 * already locked down. This translator just makes the common forms usable
 * in scene-curve expressions. The renderer (`WidgetSurface.tsx`'s
 * `evaluateReadout`) treats `^` as `**`, so we keep `^` as `**` here too.
 *
 * Supported:
 *   - variables: x, u (the scene curve parameter), and named constants
 *   - exponent operator `^`: a^b → a**b (integer b ≥ 0, capped at 8)
 *   - binary: + - * /
 *   - grouping: ( )
 *   - functions: sin, cos, tan, csc, sec, cot, exp, log, sqrt, abs
 *   - implicit multiplication: `2x`, `3x^2`, `)(`, `x(`, `(x` (the last two
 *     for `(x+1)(x-1)`)
 */

/**
 * Thrown by `latexToJsExpression` when the LaTeX contains a token the
 * translator does not support. Per-kind compilers wrap this as a
 * `FigureSpecCompileError` so the agent's repair loop sees one error
 * vocabulary, not two.
 */
export class FigureSpecLatexError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FigureSpecLatexError";
  }
}

const FUNCTIONS = new Set(["sin", "cos", "tan", "csc", "sec", "cot", "exp", "log", "sqrt", "abs"]);
/** Recognised identifiers. Anything else is rejected — keeps injection off
 *  the wire even before the validator's own gate runs. */
const ALLOWED_IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Cap the exponent — protects the scene renderer from blowing up. */
const MAX_EXPONENT = 8;

export function latexToJsExpression(latex: string): string {
  const trimmed = (latex || "").trim();
  if (trimmed.length === 0) return "0";
  const tokens = tokenize(trimmed);

  // Allow-list check on identifiers.
  for (const id of tokens) {
    if (!ALLOWED_IDENT.test(id)) continue;
    if (FUNCTIONS.has(id)) continue;
    if (id === "x" || id === "u" || id === "pi" || id === "e" || id === "PI" || id === "E") continue;
    throw new FigureSpecLatexError(`unsupported identifier ${id}`);
  }

  // Walk and emit, splicing `*` for implicit multiplication and `**` for `^`.
  const out: string[] = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const tok = tokens[i];
    const next = tokens[i + 1];

    if (tok === "^") {
      // Translate a^b to "a**b". The base is the last token in `out`; the
      // exponent is the next token. The exponent must be a non-negative
      // integer — fractional or symbolic exponents would not survive the
      // expression-evaluator's allowed vocabulary.
      const expTok = next;
      if (expTok === undefined) {
        throw new FigureSpecLatexError("trailing ^ without exponent");
      }
      const expN = Number(expTok);
      if (!Number.isInteger(expN) || expN < 0 || expN > MAX_EXPONENT) {
        throw new FigureSpecLatexError(`unsupported exponent ${expTok}`);
      }
      out.push("**");
      out.push(expTok);
      i += 1;
      continue;
    }

    out.push(tok);
    if (next === undefined) continue;

    const tokIsCloseParen = tok === ")";
    const nextIsOpenParen = next === "(";
    const tokIsNumber = /^[0-9]+(\.[0-9]+)?$/.test(tok);
    const tokIsIdent = ALLOWED_IDENT.test(tok);
    const nextIsIdent = ALLOWED_IDENT.test(next);
    const nextIsNumber = /^[0-9]+(\.[0-9]+)?$/.test(next);
    // Implicit multiplication: number|ident followed by ident|open-paren.
    if ((tokIsNumber || tokIsIdent || tokIsCloseParen) && (nextIsIdent || nextIsNumber || nextIsOpenParen)) {
      out.push("*");
    }
  }

  return out.join("");
}

function tokenize(s: string): string[] {
  const tokens: string[] = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === " " || c === "\t") {
      i += 1;
      continue;
    }
    if (c === "(" || c === ")" || c === "+" || c === "-" || c === "*" || c === "/" || c === "^") {
      tokens.push(c);
      i += 1;
      continue;
    }
    if (/[0-9.]/.test(c)) {
      let j = i;
      while (j < s.length && /[0-9.]/.test(s[j])) j += 1;
      tokens.push(s.slice(i, j));
      i = j;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i;
      while (j < s.length && /[A-Za-z0-9_]/.test(s[j])) j += 1;
      tokens.push(s.slice(i, j));
      i = j;
      continue;
    }
    // Anything else (LaTeX backslashes, braces, etc.) is unsupported.
    throw new FigureSpecLatexError(`unsupported character ${c} at ${i}`);
  }
  return tokens;
}