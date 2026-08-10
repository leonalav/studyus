import { describe, it, expect, beforeEach } from "vitest";
import { getDb } from "../db/database";
import { parseAndIngestPdfOutline, getCurriculumTree, getEvidenceForSelectedNodes, simpleHash, splitTranscriptionByPage } from "./curriculum";

describe("Curriculum Ingestion & Bookmark Tree", () => {
  beforeEach(async () => {
    await getDb();
  });

  it("ingests an OpenStax-style outline with accurate page ranges and hierarchy", async () => {
    const source = await parseAndIngestPdfOutline({
      sourceId: "cur-openstax-calc",
      name: "Calculus Vol 1.pdf",
      pageCount: 300,
      outline: [
        { title: "Chapter 1 Functions and Graphs", destPage: 1, depth: 0 },
        { title: "1.1 Review of Functions", destPage: 5, depth: 1 },
        { title: "1.2 Basic Classes of Functions", destPage: 25, depth: 1 },
        { title: "Chapter 2 Limits", destPage: 60, depth: 0 },
        { title: "2.1 A Preview of Calculus", destPage: 62, depth: 1 },
      ],
    });

    expect(source.hasOutline).toBe(true);
    expect(source.extractionStatus).toBe("authored");

    const tree = await getCurriculumTree("cur-openstax-calc");
    expect(tree.length).toBe(2);
    expect(tree[0].title).toBe("Chapter 1 Functions and Graphs");
    expect(tree[0].children?.map((n) => n.sectionNumber)).toEqual(["1.1", "1.2"]);
    expect(tree[0].children?.[0].startPage).toBe(5);
    expect(tree[0].children?.[0].endPage).toBe(24); // Derived from next sibling at page 25
  });

  it("extracts evidence chunks for multi-selected disjoint nodes", async () => {
    const db = await getDb();
    const excerpts = [
      ["test-chunk-2", "node-cur-openstax-calc-2", 60, "Limits describe local change."],
      ["test-chunk-5", "node-cur-openstax-calc-5", 62, "A preview of differential calculus."],
    ] as const;
    for (const [id, nodeId, page, text] of excerpts) {
      db.run(
        `INSERT OR REPLACE INTO curriculum_chunks (id, node_id, page, chunk_ordinal, text_content, excerpt_hash, chunk_kind)
         VALUES (?, ?, ?, 1, ?, ?, 'prose');`,
        [id, nodeId, page, text, simpleHash(text)]
      );
    }
    const evidence = await getEvidenceForSelectedNodes(["node-cur-openstax-calc-2", "node-cur-openstax-calc-5"]);
    expect(evidence.nodes.length).toBe(2);
    expect(evidence.chunks.length).toBe(2);
  });
});

describe("splitTranscriptionByPage", () => {
  it("splits on ==== PAGE n ==== markers, keyed by real page number", () => {
    const text =
      "==== PAGE 5 ====\nThe derivative is $f'(x)=2x$.\n\n==== PAGE 6 ====\nArea $A=\\pi r^2$.";
    const out = splitTranscriptionByPage(text, 5, 2);
    expect(out).toEqual([
      { page: 5, ordinal: 1, text: "The derivative is $f'(x)=2x$." },
      { page: 6, ordinal: 2, text: "Area $A=\\pi r^2$." },
    ]);
  });

  it("emits a single chunk covering the range when there are no markers", () => {
    const text = "Just one page worth of prose with $x=1$ inline.";
    const out = splitTranscriptionByPage(text, 20, 1);
    expect(out).toEqual([{ page: 20, ordinal: 1, text }]);
  });

  it("keeps everything after the last marker as one block when no further markers appear", () => {
    // Only one page marker; content that follows has no marker of its own, so it
    // accumulates into a single page-30 chunk rather than being split by prose.
    const text =
      "==== PAGE 30 ====\nIntro $a$.\n\nSecond block $b$.\n\nThird block $c$.";
    const out = splitTranscriptionByPage(text, 30, 3);
    expect(out.map((c) => c.page)).toEqual([30]);
    expect(out[0].text).toBe("Intro $a$.\n\nSecond block $b$.\n\nThird block $c$.");
  });

  it("skips empty/whitespace-only blocks", () => {
    const text =
      "==== PAGE 1 ====\n   \n\n==== PAGE 2 ====\nReal content $y=2$.";
    const out = splitTranscriptionByPage(text, 1, 2);
    expect(out).toEqual([{ page: 2, ordinal: 1, text: "Real content $y=2$." }]);
  });

  it("returns nothing for an all-blank transcription", () => {
    expect(splitTranscriptionByPage("   \n\n  ", 1, 1)).toEqual([]);
  });
});
