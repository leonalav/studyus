/**
 * Tests for the curriculum/docling pipeline.
 *
 * These exercise the pure data-parsing layer (`parseDoclingMarkdown`,
 * `classifyPageContent`, `buildFormulaRegistry`, `extractFormulasFromMarkdown`,
 * `normaliseFormula`) so they run in jsdom without needing a Tauri runtime.
 *
 * The pipeline tests for `extractCurriculumSubsection` use a mocked Tauri
 * surface — `doclingExtractImage` and `visionExtractImage` are stubbed so
 * the page routing logic can be asserted in isolation.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildFormulaRegistry,
  classifyPageContent,
  extractCurriculumSubsection,
  extractFormulasFromMarkdown,
  normaliseFormula,
  parseDoclingMarkdown,
  parseVisionResult,
  type ExtractedPage,
  type PageAnalysis,
} from "./docling";
import { TauriUnavailableError } from "../tauri";

const SAMPLE_MARKDOWN = `# Heading

Some prose with an inline $E = mc^2$ reference.

| A | B |
|---|---|
| 1 | 2 |
| 3 | 4 |

$$
\\int_0^1 x^2 \\, dx = \\frac{1}{3}
$$

Tail paragraph with another inline $a^2 + b^2 = c^2$.
`;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("parseDoclingMarkdown", () => {
  it("extracts pipe tables and replaces them with [Table N] markers", () => {
    const { tables, cleanedMarkdown } = parseDoclingMarkdown(SAMPLE_MARKDOWN);
    expect(tables.length).toBeGreaterThanOrEqual(1);
    expect(cleanedMarkdown).not.toContain("|---|");
    expect(cleanedMarkdown).toMatch(/\[Table 1\]/);
  });

  it("handles multiple tables with sequential numbering", () => {
    const md = `# Heading

| A | B |
|---|---|
| 1 | 2 |

Mid prose.

| C | D |
|---|---|
| 9 | 8 |

Tail.
`;
    const { tables, cleanedMarkdown } = parseDoclingMarkdown(md);
    expect(tables.length).toBe(2);
    expect(cleanedMarkdown).toMatch(/\[Table 1\]/);
    expect(cleanedMarkdown).toMatch(/\[Table 2\]/);
  });

  it("returns empty arrays for markdown with no tables", () => {
    const { tables, cleanedMarkdown } = parseDoclingMarkdown("# Just a heading\n\nNo tables here.");
    expect(tables).toEqual([]);
    expect(cleanedMarkdown).toBe("# Just a heading\n\nNo tables here.");
  });

  it("appends [Table N] markers when raw tables are passed in from the Rust side", () => {
    const rawTables = [
      { id: "t1", html: "<table><tr><td>1</td></tr></table>" },
      { id: "t2", html: "<table><tr><td>2</td></tr></table>" },
    ];
    const { tables, cleanedMarkdown } = parseDoclingMarkdown("Body prose.", rawTables);
    expect(tables.map((t) => t.id)).toEqual(["t1", "t2"]);
    expect(cleanedMarkdown).toMatch(/\[Table 1\]/);
    expect(cleanedMarkdown).toMatch(/\[Table 2\]/);
  });
});

describe("classifyPageContent", () => {
  it("identifies diagram-heavy pages when imageAreaRatio > 0.4", () => {
    const analysis: PageAnalysis = { imageAreaRatio: 0.6, equationDensity: 0, textDensity: 0.3 };
    expect(classifyPageContent(analysis)).toEqual({ kind: "diagram-heavy", imageAreaRatio: 0.6 });
  });

  it("identifies formula-heavy pages when equationDensity > 0.3", () => {
    const analysis: PageAnalysis = { imageAreaRatio: 0.1, equationDensity: 0.5, textDensity: 0.3 };
    expect(classifyPageContent(analysis)).toEqual({ kind: "formula-heavy", equationDensity: 0.5 });
  });

  it("identifies text-heavy pages when textDensity > 0.6", () => {
    const analysis: PageAnalysis = { imageAreaRatio: 0.05, equationDensity: 0.05, textDensity: 0.8 };
    expect(classifyPageContent(analysis)).toEqual({ kind: "text-heavy", textDensity: 0.8 });
  });

  it("falls back to mixed when no bucket matches", () => {
    const analysis: PageAnalysis = { imageAreaRatio: 0.2, equationDensity: 0.1, textDensity: 0.4 };
    const result = classifyPageContent(analysis);
    expect(result.kind).toBe("mixed");
  });
});

describe("extractFormulasFromMarkdown", () => {
  it("pulls inline `$...$` and block `$$...$$` expressions", () => {
    const formulas = extractFormulasFromMarkdown(SAMPLE_MARKDOWN);
    const inline = formulas.filter((f) => !f.isBlock);
    const block = formulas.filter((f) => f.isBlock);

    expect(block.length).toBeGreaterThanOrEqual(1);
    expect(block.some((f) => f.expression.includes("\\int_0^1"))).toBe(true);

    expect(inline.length).toBeGreaterThanOrEqual(2);
    expect(inline.map((f) => f.expression)).toEqual(
      expect.arrayContaining(["E = mc^2", "a^2 + b^2 = c^2"]),
    );
  });

  it("ignores empty expressions", () => {
    const formulas = extractFormulasFromMarkdown("$$ $$ and $ $");
    expect(formulas).toEqual([]);
  });
});

describe("normaliseFormula", () => {
  it("strips whitespace and case for dedup", () => {
    expect(normaliseFormula("a + B")).toBe(normaliseFormula("a+b"));
    expect(normaliseFormula("A + b")).toBe(normaliseFormula("a+b"));
  });

  it("strips \\left and \\right", () => {
    expect(normaliseFormula("\\left(x+1\\right)")).toBe(normaliseFormula("(x+1)"));
  });

  it("returns empty string for blank input", () => {
    expect(normaliseFormula("")).toBe("");
    expect(normaliseFormula("   ")).toBe("");
  });
});

describe("buildFormulaRegistry", () => {
  it("dedupes formulas across pages", () => {
    const page1: ExtractedPage = {
      pageNumber: 1,
      markdown: "$a + b$",
      tables: [],
      images: [],
    };
    const page2: ExtractedPage = {
      pageNumber: 2,
      markdown: "Prose with $a + b$ again.\n\nAnd $x = 1$.",
      tables: [],
      images: [],
    };

    const registry = buildFormulaRegistry([page1, page2]);

    expect(registry.length).toBe(2);
    const ab = registry.find((e) => e.expression === "a + b");
    expect(ab).toBeDefined();
    expect(ab?.pages).toEqual([1, 2]);
    const xeq1 = registry.find((e) => e.expression === "x = 1");
    expect(xeq1?.pages).toEqual([2]);
  });

  it("returns empty registry for pages with no formulas", () => {
    const page: ExtractedPage = {
      pageNumber: 1,
      markdown: "Just prose, no math.",
      tables: [],
      images: [],
    };
    expect(buildFormulaRegistry([page])).toEqual([]);
  });
});

describe("parseVisionResult", () => {
  it("returns markdown + tables + images", () => {
    const md = `# Heading

| A | B |
|---|---|
| 1 | 2 |
`;
    const out = parseVisionResult(md, [{ id: "v1", html: "<table></table>" }]);
    expect(out.markdown).toContain("# Heading");
    expect(out.tables.length).toBe(2); // regex + raw
    expect(out.images).toEqual([]);
  });
});

describe("extractCurriculumSubsection", () => {
  beforeEach(() => {
    // Provide a Tauri runtime by injecting __TAURI_INTERNALS__ on globalThis.
    (globalThis as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {
      invoke: vi.fn(),
    };
  });

  it("returns empty result for invalid page range", async () => {
    await expect(extractCurriculumSubsection("pdf", [0, 5])).rejects.toThrow(/Invalid page range/);
    await expect(extractCurriculumSubsection("pdf", [5, 3])).rejects.toThrow(/Invalid page range/);
  });

  it("throws TauriUnavailableError when not running under Tauri", async () => {
    delete (globalThis as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    await expect(extractCurriculumSubsection("pdf", [1, 1])).rejects.toBeInstanceOf(
      TauriUnavailableError,
    );
  });

  it("returns pages and formulaRegistry on the happy path", async () => {
    const invokeMock = vi.fn(async (cmd: string) => {
      if (cmd === "render_page_range") {
        // 2 pages of fake base64 PNGs.
        return ["page1", "page2"];
      }
      if (cmd === "docling_extract_image") {
        return {
          markdown: "Body prose with $x = 1$.",
          tables: [{ id: "t1", html: "<table></table>" }],
          warnings: [],
        };
      }
      return null;
    });

    (globalThis as unknown as { __TAURI_INTERNALS__: { invoke: typeof invokeMock } }).__TAURI_INTERNALS__ = {
      invoke: invokeMock,
    };

    const result = await extractCurriculumSubsection("pdf-path", [1, 2]);
    expect(result.pages.length).toBe(2);
    expect(result.skippedPages).toEqual([]);
    expect(result.formulaRegistry.length).toBe(1);
    expect(result.formulaRegistry[0].expression).toBe("x = 1");
    expect(result.formulaRegistry[0].pages).toEqual([1, 2]);
  });

  it("retries once on transient lock error then succeeds", async () => {
    let callCount = 0;
    const invokeMock = vi.fn(async (cmd: string) => {
      if (cmd === "render_page_range") {
        return ["page1"];
      }
      if (cmd === "docling_extract_image") {
        callCount++;
        if (callCount === 1) {
          throw new Error("file lock held by another process");
        }
        return { markdown: "ok", tables: [], warnings: [] };
      }
      return null;
    });
    (globalThis as unknown as { __TAURI_INTERNALS__: { invoke: typeof invokeMock } }).__TAURI_INTERNALS__ = {
      invoke: invokeMock,
    };

    // Skip the 5-second sleep by stubbing setTimeout — or just verify the
    // page is present after the retry. With the real 5s sleep, the test
    // suite would slow down significantly; we use vi.useFakeTimers.
    vi.useFakeTimers();
    const promise = extractCurriculumSubsection("pdf-path", [1, 1]);
    await vi.runAllTimersAsync();
    const result = await promise;
    vi.useRealTimers();

    expect(result.pages.length).toBe(1);
    expect(result.skippedPages).toEqual([]);
  });

  it("skips pages that fail after retry", async () => {
    const invokeMock = vi.fn(async (cmd: string) => {
      if (cmd === "render_page_range") {
        return ["page1", "page2"];
      }
      if (cmd === "docling_extract_image") {
        throw new Error("transient 503 from upstream");
      }
      return null;
    });
    (globalThis as unknown as { __TAURI_INTERNALS__: { invoke: typeof invokeMock } }).__TAURI_INTERNALS__ = {
      invoke: invokeMock,
    };

    vi.useFakeTimers();
    const promise = extractCurriculumSubsection("pdf-path", [1, 2]);
    await vi.runAllTimersAsync();
    const result = await promise;
    vi.useRealTimers();

    expect(result.pages.length).toBe(0);
    expect(result.skippedPages).toEqual([1, 2]);
  });
});
