import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { boardToMarkdown, type BoardDoc } from "../../data/boards";
import { Chalkboard, THEMES } from "./Chalkboard";

/**
 * Pagination is a render-time slice. These assertions pin the three contracts
 * that keep it from corrupting export, Past Notes scroll measurement, and the
 * pre-pagination continuous-board render learners already know.
 */

function makeBoard(count: number): BoardDoc {
  return {
    id: "page-test-board",
    title: "Pagination fixture",
    subtitle: "fixture",
    domain: "math",
    blocks: Array.from({ length: count }, (_, index) => ({
      id: `b-${index + 1}`,
      kind: "text" as const,
      text: `block-${index + 1}`,
    })),
  };
}

const baseProps = {
  theme: THEMES[0],
  fontCss: "sans-serif",
  fontScale: 1,
  writing: false,
  latex: false,
  onAsk: () => {},
  annotating: false,
  penColor: "#fbbf24",
  penTool: "pen" as const,
  strokesKey: "page-test-board",
};

describe("chalkboard pagination render contracts", () => {
  it("slices the revealed prefix when pagination is on, and is byte-identical to today when off", () => {
    // Off is not "pagination with one big page" — it must be byte-for-byte the
    // render learners have today, which is why the slice collapses to
    // [0, revealed] rather than to a single giant page.
    const board = makeBoard(20);
    const on = renderToStaticMarkup(
      <Chalkboard {...baseProps} board={board} paginate pageSize={8} />
    );
    const off = renderToStaticMarkup(
      <Chalkboard {...baseProps} board={board} paginate={false} />
    );
    const today = renderToStaticMarkup(
      <Chalkboard {...baseProps} board={board} />
    );

    // Pagination is weight-aware, not a strict block-count slice: a page holds
    // roughly `pageSize` weight units, so with text-weight 0.7 and budget 8 the
    // first page fits ~11 text blocks before the budget trips. The test pins
    // that contract — pagination MUST cut somewhere on page 1, MUST NOT show
    // the whole board, and MUST report multiple pages — without coupling to
    // the exact threshold the weight table happens to use.
    expect(on).toContain("block-1");
    expect(on).not.toContain("block-20");
    expect(on).toMatch(/Page 1 of [23]/);

    for (let i = 1; i <= 20; i++) expect(off).toContain(`block-${i}`);
    expect(off).toBe(today);
  });

  it("never paginates a read-only board, even when paginate is requested", () => {
    // Past Notes measures [data-board-content]'s scrollHeight to build its own
    // scroll range; a paginated snapshot would report one page's height and
    // silently disable its up/down controls.
    const board = makeBoard(20);
    const html = renderToStaticMarkup(
      <Chalkboard {...baseProps} board={board} paginate pageSize={8} readOnly />
    );
    for (let i = 1; i <= 20; i++) expect(html).toContain(`block-${i}`);
    expect(html).not.toMatch(/Page 1 of/);
  });

  it("exports every block regardless of page — boardToMarkdown never sees a page", () => {
    // The trap: pagination is a render-time slice. If it ever reaches
    // board.blocks, the learner exports one page of their own lesson and has
    // no way to tell that the rest is missing.
    const board = makeBoard(20);
    const md = boardToMarkdown(board);
    for (let i = 1; i <= 20; i++) expect(md).toContain(`block-${i}`);
    expect(boardToMarkdown.length).toBe(1);
  });
});
