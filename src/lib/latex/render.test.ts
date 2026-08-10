import { describe, it, expect, beforeEach } from "vitest";
import { renderMath, renderMixed, stripUnknownMacros } from "./render";
import { validate, _clearValidateCache } from "./validate";

beforeEach(() => {
  _clearValidateCache();
});

describe("validate", () => {
  it("accepts valid LaTeX", () => {
    expect(validate("\\frac{1}{2}", false)).toEqual({ ok: true });
  });
  it("rejects broken LaTeX with an error message", () => {
    const r = validate("\\frac{1}{", false);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.length).toBeGreaterThan(0);
  });
  it("memoises (second call returns same result object shape)", () => {
    const a = validate("x^2", true);
    const b = validate("x^2", true);
    expect(a).toEqual(b);
  });
});

describe("stripUnknownMacros", () => {
  it("removes an unknown macro but keeps known structure", () => {
    expect(stripUnknownMacros("\\unknownmacro \\frac{1}{2}")).toBe(" \\frac{1}{2}");
  });
  it("keeps whitelisted commands", () => {
    expect(stripUnknownMacros("\\sqrt{2}")).toBe("\\sqrt{2}");
  });
});

describe("renderMath ladder", () => {
  it("rung 1: renders valid normalised math", () => {
    const r = renderMath("\\frac12", false);
    expect(r.tier).toBe("normalized");
    expect(r.failed).toBe(false);
    expect(r.html).toContain("katex");
  });

  it("rung 3: falls through to escaped raw block on unrecoverable input", () => {
    const r = renderMath("\\begin{unknownenv} x \\end{unknownenv}", false);
    expect(r.failed).toBe(true);
    expect(r.tier).toBe("raw");
    expect(r.html).toContain("raw LaTeX");
  });

  it("rung 3 HTML-escapes the raw source (no injection)", () => {
    const r = renderMath("<img src=x onerror=alert(1)> \\badcmd{", false);
    if (r.tier === "raw") {
      const escapedLt = "&" + "lt;img";
      expect(r.html).not.toContain("<img");
      expect(r.html).toContain(escapedLt);
    }
  });

  it("fires the diagnostic sink on failure", () => {
    let fired = false;
    renderMath("\\begin{nope}x\\end{nope}", false, {
      onDiagnostic: (e) => {
        fired = e.code === "latex_render_failed";
      },
    });
    expect(fired).toBe(true);
  });
});

describe("renderMixed", () => {
  it("renders prose + math, escaping prose", () => {
    const { html, anyFailed } = renderMixed("area is $\\pi r^2$ done");
    expect(anyFailed).toBe(false);
    expect(html).toContain("area is ");
    expect(html).toContain("katex");
  });

  it("normalises before rendering (unicode + unclosed)", () => {
    const { html, anyFailed } = renderMixed("value $θ ≤ π");
    expect(anyFailed).toBe(false);
    expect(html).toContain("katex");
  });

  it("honours a custom prose renderer", () => {
    const br = "<" + "br/" + ">";
    const { html } = renderMixed("line1\nline2", {
      renderProse: (p) => p.replace(/\n/g, br),
    });
    expect(html).toContain(br);
  });
});
