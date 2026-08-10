import { describe, it, expect } from "vitest";
import {
  normalize,
  extractSegments,
  stripFences,
  convertEnvironments,
  balanceDelimiters,
  unicodeToCommands,
  stripInvisibles,
  escapeSpecials,
  stripBoldInMath,
  repairLeftRight,
  expandFrac,
  wrapBareMath,
} from "./normalize";

// ─── Per-rule tables ─────────────────────────────────────────────────────────

describe("stripFences", () => {
  const cases: [string, string][] = [
    ['```latex\n$x$\n```', '$x$\n'],
    ['```\n$x$\n```', '$x$\n'],
    ['```tex $y$ ```', '$y$ '],
    ['\\begin{document}$x$\\end{document}', '$x$'],
    ['no fences here', 'no fences here'],
  ];
  for (const [input, expected] of cases) {
    it(`strips ${JSON.stringify(input)}`, () => {
      expect(stripFences(input)).toBe(expected);
    });
  }
});

describe("convertEnvironments", () => {
  it("converts equation to $$", () => {
    expect(convertEnvironments("\\begin{equation}x=1\\end{equation}")).toBe("$$x=1$$");
  });
  it("converts equation* and strips label", () => {
    expect(convertEnvironments("\\begin{equation*}x=1\\label{eq:a}\\end{equation*}")).toBe("$$x=1$$");
  });
  it("wraps align body in aligned and strips tag", () => {
    expect(convertEnvironments("\\begin{align}a&=b\\\\c&=d\\tag{1}\\end{align}")).toBe(
      "$$\\begin{aligned}\na&=b\\\\c&=d\n\\end{aligned}$$",
    );
  });
  it("leaves ordinary math alone", () => {
    expect(convertEnvironments("$x=1$")).toBe("$x=1$");
  });
});

describe("balanceDelimiters", () => {
  const cases: [string, string][] = [
    ["$x = 1", "$x = 1$"],
    ["$$x = 1", "$$x = 1$$"],
    ["\\[x=1", "\\[x=1\\]"],
    ["\\(x=1", "\\(x=1\\)"],
    ["balanced $x$ text", "balanced $x$ text"],
    ["a lone trailing $", "a lone trailing "],
    ["value is $", "value is "],
    ["escaped \\$5 and \\$6", "escaped \\$5 and \\$6"],
  ];
  for (const [input, expected] of cases) {
    it(`balances ${JSON.stringify(input)}`, () => {
      expect(balanceDelimiters(input)).toBe(expected);
    });
  }
});

describe("unicodeToCommands", () => {
  const cases: [string, string][] = [
    ["$θ$", "$\\theta $"],
    ["$π r^2$", "$\\pi  r^2$"],
    ["$a ≤ b$", "$a \\le  b$"],
    ["$a ≥ b$", "$a \\ge  b$"],
    ["$a ≠ b$", "$a \\ne  b$"],
    ["$2 × 3$", "$2 \\times  3$"],
    ["$a · b$", "$a \\cdot  b$"],
    ["$∫ f$", "$\\int  f$"],
    ["$√2$", "$\\sqrt 2$"],
    ["$∞$", "$\\infty $"],
    ["$a → b$", "$a \\to  b$"],
    ["$Δx$", "$\\Delta x$"],
    ["$x²$", "$x^{2}$"],
    ["$x³$", "$x^{3}$"],
    ["$x²³$", "$x^{23}$"],
  ];
  for (const [input, expected] of cases) {
    it(`maps ${JSON.stringify(input)}`, () => {
      expect(unicodeToCommands(input)).toBe(expected);
    });
  }
  it("does NOT touch unicode in prose", () => {
    expect(unicodeToCommands("the angle θ is 30° and π appears")).toBe(
      "the angle θ is 30° and π appears",
    );
  });
});

describe("stripInvisibles", () => {
  it("drops zero-width space inside math", () => {
    expect(stripInvisibles("$x\u200b=1$")).toBe("$x=1$");
  });
  it("drops BOM/zero-width no-break inside math", () => {
    expect(stripInvisibles("$x\ufeff=1$")).toBe("$x=1$");
  });
  it("turns NBSP into a normal space inside math", () => {
    expect(stripInvisibles("$x\u00a0=\u202f1$")).toBe("$x = 1$");
  });
  it("leaves invisibles in prose alone", () => {
    expect(stripInvisibles("prose\u200bhere")).toBe("prose\u200bhere");
  });
});

describe("escapeSpecials", () => {
  const cases: [string, string][] = [
    ["$50\\%$", "$50\\%$"],
    ["$50%$", "$50\\%$"],
    ["$a#b$", "$a\\#b$"],
    ["$100% done#1$", "$100\\% done\\#1$"],
  ];
  for (const [input, expected] of cases) {
    it(`escapes ${JSON.stringify(input)}`, () => {
      expect(escapeSpecials(input)).toBe(expected);
    });
  }
  it("leaves % in prose alone", () => {
    expect(escapeSpecials("a 50% chance")).toBe("a 50% chance");
  });
});

describe("stripBoldInMath", () => {
  const cases: [string, string][] = [
    ["$**x**$", "$x$"],
    ["$a = **b**$", "$a = b$"],
    ["plain $x$", "plain $x$"],
  ];
  for (const [input, expected] of cases) {
    it(`unwraps ${JSON.stringify(input)}`, () => {
      expect(stripBoldInMath(input)).toBe(expected);
    });
  }
  it("leaves **bold** prose alone", () => {
    expect(stripBoldInMath("this is **important** text")).toBe("this is **important** text");
  });
});

describe("repairLeftRight", () => {
  const cases: [string, string][] = [
    ["$\\left( x $", "$\\left( x \\right.$"],
    ["$ x \\right)$", "$\\left. x \\right)$"],
    ["$\\left( x \\right)$", "$\\left( x \\right)$"],
    ["$\\leftarrow$", "$\\leftarrow$"],
  ];
  for (const [input, expected] of cases) {
    it(`repairs ${JSON.stringify(input)}`, () => {
      expect(repairLeftRight(input)).toBe(expected);
    });
  }
});

describe("expandFrac", () => {
  const cases: [string, string][] = [
    ["$\\frac12$", "$\\frac{1}{2}$"],
    ["$\\frac ab$", "$\\frac{a}{b}$"],
    ["$\\frac x2$", "$\\frac{x}{2}$"],
    ["$\\frac{1}{2}$", "$\\frac{1}{2}$"],
    ["$\\dfrac34$", "$\\dfrac{3}{4}$"],
    ["$\\frac{a+b}{c}$", "$\\frac{a+b}{c}$"],
    ["$\\frac\\pi2$", "$\\frac{\\pi}{2}$"],
  ];
  for (const [input, expected] of cases) {
    it(`expands ${JSON.stringify(input)}`, () => {
      expect(expandFrac(input)).toBe(expected);
    });
  }
});

describe("wrapBareMath", () => {
  const cases: [string, string][] = [
    ["r = f(\\theta)", "$r = f(\\theta)$"],
    ["x^2 + y^2 = 1", "$x^2 + y^2 = 1$"],
    ["  a = b  ", "  $a = b$  "],
  ];
  for (const [input, expected] of cases) {
    it(`wraps ${JSON.stringify(input)}`, () => {
      expect(wrapBareMath(input)).toBe(expected);
    });
  }
  it("does NOT wrap a real sentence", () => {
    expect(wrapBareMath("The value of x is 5.")).toBe("The value of x is 5.");
  });
  it("does NOT wrap when delimited math already present", () => {
    expect(wrapBareMath("here $x=1$ and r = f(t)")).toBe("here $x=1$ and r = f(t)");
  });
  it("does NOT wrap plain prose without math signal", () => {
    expect(wrapBareMath("hello world")).toBe("hello world");
  });
});

// ─── extractSegments: prose/math split ───────────────────────────────────────

describe("extractSegments", () => {
  it("splits prose and math, preserving delimiters", () => {
    expect(extractSegments("a $x$ b $$y$$ c")).toEqual([
      { kind: "prose", text: "a " },
      { kind: "math", text: "$x$" },
      { kind: "prose", text: " b " },
      { kind: "math", text: "$$y$$" },
      { kind: "prose", text: " c" },
    ]);
  });
  it("handles all-prose", () => {
    expect(extractSegments("just prose")).toEqual([{ kind: "prose", text: "just prose" }]);
  });
  it("re-joins losslessly", () => {
    const src = "compute $\\int_0^1 x\\,dx$ then \\[y=2\\] done";
    expect(extractSegments(src).map((s) => s.text).join("")).toBe(src);
  });
});

// ─── Corpus of realistic model-emitted failures ──────────────────────────────

const CORPUS: {
  note: string;
  raw: string;
  expect?: string;
  expectContains?: string[];
}[] = [
  {
    note: "fenced block the model wrapped around display math",
    raw: "```latex\n$$\\int_0^1 x^2\\,dx = \\frac13$$\n```",
    expectContains: ["$$", "\\frac{1}{3}"],
  },
  {
    note: "unclosed inline dollar from a truncated stream",
    raw: "The derivative is $f'(x) = 2x",
    expect: "The derivative is $f'(x) = 2x$",
  },
  {
    note: "unicode operators emitted literally",
    raw: "Given $θ ≤ π$ we have area $A = π r²$",
    expectContains: ["\\theta", "\\le", "\\pi", "r^{2}"],
  },
  {
    note: "equation environment KaTeX rejects at top level",
    raw: "\\begin{equation}\nE = mc^2\n\\label{einstein}\n\\end{equation}",
    expectContains: ["$$", "E = mc^2"],
  },
  {
    note: "zero-width space glued into an expression",
    raw: "$a\u200b+\u200bb$",
    expect: "$a+b$",
  },
  {
    note: "bare percent meant literally",
    raw: "A $20%$ increase",
    expect: "A $20\\%$ increase",
  },
  {
    note: "frac shorthand from a terse model",
    raw: "The slope is $\\frac12$",
    expect: "The slope is $\\frac{1}{2}$",
  },
  {
    note: "orphaned \\left from a copy-paste",
    raw: "$\\left( \\frac{a}{b}$",
    expectContains: ["\\left(", "\\right."],
  },
  {
    note: "undelimited polar equation emitted as prose",
    raw: "r = f(\\theta)",
    expect: "$r = f(\\theta)$",
  },
  {
    note: "markdown bold bleeding into math",
    raw: "the value $**x**$ matters",
    expect: "the value $x$ matters",
  },
];

describe("normalize corpus (real model failures)", () => {
  for (const c of CORPUS) {
    it(c.note, () => {
      const out = normalize(c.raw);
      if (c.expect !== undefined) expect(out).toBe(c.expect);
      if (c.expectContains) {
        for (const needle of c.expectContains) expect(out).toContain(needle);
      }
      // Every corpus entry must not leave a label/tag behind.
      expect(out).not.toContain("\\label");
      expect(out).not.toContain("\\tag");
    });
  }
});

// ─── End-to-end through normalize() ──────────────────────────────────────────

describe("normalize (end to end)", () => {
  it("composes fence-strip → env → balance → inside-math passes", () => {
    const raw = "```latex\n\\begin{equation}θ = \\frac12 π\\label{a}\\end{equation}\n```";
    const out = normalize(raw);
    expect(out).toContain("$$");
    expect(out).toContain("\\theta");
    expect(out).toContain("\\frac{1}{2}");
    expect(out).toContain("\\pi");
    expect(out).not.toContain("\\label");
    expect(out).not.toContain("```");
  });

  it("leaves a clean expression untouched", () => {
    const clean = "The area is $\\pi r^2$ exactly.";
    expect(normalize(clean)).toBe(clean);
  });

  it("handles empty input", () => {
    expect(normalize("")).toBe("");
  });
});

// ─── Invariants: prose preservation & idempotency ────────────────────────────

describe("prose preservation", () => {
  const proseSamples = [
    "A plain paragraph with no math at all, 50% sure, item #3.",
    "Unicode in prose: θ, π, ≤ stay literal here.",
    "Markdown **bold** and _italics_ survive.",
    "Multiple lines\nwith\nbreaks and 20% values.",
  ];
  for (const p of proseSamples) {
    it(`keeps prose byte-identical: ${JSON.stringify(p.slice(0, 30))}`, () => {
      expect(normalize(p)).toBe(p);
    });
  }
});

describe("idempotency", () => {
  const samples = [
    "```latex\n$$θ = \\frac12$$\n```",
    "The derivative is $f'(x) = 2x",
    "Given $θ ≤ π$ we have $A = π r²$",
    "\\begin{equation}E=mc^2\\label{e}\\end{equation}",
    "r = f(\\theta)",
    "A $20%$ increase and $\\left( x$",
    "plain prose, nothing to do",
    "$a\u200b+\u200bb$ inline",
  ];
  for (const s of samples) {
    it(`normalize(normalize(x)) === normalize(x): ${JSON.stringify(s.slice(0, 30))}`, () => {
      const once = normalize(s);
      expect(normalize(once)).toBe(once);
    });
  }
});
