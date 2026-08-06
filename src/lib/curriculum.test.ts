import { describe, it, expect, beforeEach } from "vitest";
import { getDb } from "../db/database";
import { parseAndIngestPdfOutline, getCurriculumTree, getEvidenceForSelectedNodes } from "./curriculum";

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
    expect(tree.length).toBe(5);
    expect(tree[0].title).toBe("Chapter 1 Functions and Graphs");
    expect(tree[1].sectionNumber).toBe("1.1");
    expect(tree[1].startPage).toBe(5);
    expect(tree[1].endPage).toBe(24); // Derived from next sibling at page 25
  });

  it("extracts evidence chunks for multi-selected disjoint nodes", async () => {
    const evidence = await getEvidenceForSelectedNodes(["node-cur-openstax-calc-2", "node-cur-openstax-calc-5"]);
    expect(evidence.nodes.length).toBe(2);
    expect(evidence.chunks.length).toBeGreaterThan(0);
  });
});
