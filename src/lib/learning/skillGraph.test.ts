import { describe, it, expect } from "vitest";
import { curriculumSkillId, inferSkillNodes, linkObjectiveToCurriculumNode } from "./skillGraph";
import { getSkillNodes, upsertSkillNode } from "./store";
import { buildSkillGraph, prerequisiteChain } from "./types";

/**
 * A curriculum sequence says what order a book presents things in. A skill
 * graph says what depends on what. They are different claims, and conflating
 * them is why "the learner is stuck on section 4" so often actually means "the
 * learner never had section 2's skill".
 *
 * Inferring the second from the first is a prior, not a fact, and the danger is
 * over-claiming: an inferred edge that is wrong sends a learner into repair on
 * material that has nothing to do with their difficulty, which is worse than no
 * graph because it wastes their time while looking purposeful. These tests pin
 * the restraint as hard as the inference.
 */

function node(
  id: string,
  ordinal: number,
  parentNodeId: string | null = null,
  nodeKind = "section",
  title = `Section ${id}`,
  sectionNumber: string | null = null
) {
  return { id, ordinal, parentNodeId, nodeKind, title, sectionNumber };
}

describe("Inferring prerequisites from an outline", () => {
  it("makes each section depend on the one the book taught immediately before", () => {
    const nodes = inferSkillNodes([node("a", 1), node("b", 2), node("c", 3)]);
    // A competent textbook does not use an idea before introducing it, which is
    // what makes presentation order usable evidence at all.
    expect(nodes[1].prerequisites).toEqual([curriculumSkillId("a")]);
    expect(nodes[2].prerequisites).toEqual([curriculumSkillId("b")]);
  });

  it("leaves the very first section with nothing underneath it", () => {
    const nodes = inferSkillNodes([node("a", 1), node("b", 2)]);
    expect(nodes[0].prerequisites).toEqual([]);
  });

  it("makes a subsection depend on its parent section as well as its predecessor", () => {
    const nodes = inferSkillNodes([
      node("ch1", 1, null, "chapter"),
      node("s1", 2, "ch1"),
      node("s2", 3, "ch1"),
    ]);
    const s2 = nodes.find((n) => n.skillId === curriculumSkillId("s2"))!;
    // The parent is the general idea this one specialises; the sibling is what
    // came before it in the same context. Both are real dependencies.
    expect(s2.prerequisites).toContain(curriculumSkillId("s1"));
    expect(s2.prerequisites).toContain(curriculumSkillId("ch1"));
  });

  it("never crosses a chapter boundary between siblings", () => {
    const nodes = inferSkillNodes([
      node("ch1", 1, null, "chapter"),
      node("ch1s1", 2, "ch1"),
      node("ch2", 3, null, "chapter"),
      node("ch2s1", 4, "ch2"),
    ]);
    const first = nodes.find((n) => n.skillId === curriculumSkillId("ch2s1"))!;
    // Two chapters that merely sit next to each other are not in a dependency
    // relation, and asserting they are would misroute every learner in
    // chapter 2 into chapter 1.
    expect(first.prerequisites).not.toContain(curriculumSkillId("ch1s1"));
    expect(first.prerequisites).toContain(curriculumSkillId("ch2"));
  });

  it("declares only the nearest predecessor, not every earlier sibling", () => {
    const nodes = inferSkillNodes([node("a", 1), node("b", 2), node("c", 3), node("d", 4)]);
    const d = nodes.find((n) => n.skillId === curriculumSkillId("d"))!;
    // A graph where the last section depends on all the others routes no better
    // than no graph at all.
    expect(d.prerequisites).toEqual([curriculumSkillId("c")]);
  });

  it("excludes front and back matter entirely", () => {
    const nodes = inferSkillNodes([
      node("cover", 1, null, "front_matter", "Contents"),
      node("ch1", 2, null, "chapter"),
      node("index", 3, null, "back_matter", "Index"),
    ]);
    // A table of contents is not something a learner can be weak at, and
    // admitting it would put a phantom prerequisite in front of real material.
    expect(nodes).toHaveLength(1);
    expect(nodes[0].skillId).toBe(curriculumSkillId("ch1"));
    expect(nodes[0].prerequisites).toEqual([]);
  });

  it("does not make a real section depend on discarded front matter", () => {
    const nodes = inferSkillNodes([
      node("cover", 1, null, "front_matter", "Contents"),
      node("ch1", 2, null, "chapter"),
    ]);
    expect(nodes[0].prerequisites).not.toContain(curriculumSkillId("cover"));
  });

  it("keeps distinct sections distinct even when they share a title", () => {
    const nodes = inferSkillNodes([
      node("r1", 1, null, "review", "Review Problems"),
      node("r2", 2, null, "review", "Review Problems"),
    ]);
    // Keying on title would pool evidence from unrelated chapters into one
    // state that describes nobody.
    expect(nodes[0].skillId).not.toBe(nodes[1].skillId);
  });

  it("labels a skill with its section number when the book has one", () => {
    const nodes = inferSkillNodes([node("a", 1, null, "section", "Limits", "1.2")]);
    expect(nodes[0].label).toBe("1.2 Limits");
    expect(nodes[0].curriculumNode).toBe("a");
  });

  it("orders siblings by ordinal, not by array position", () => {
    const nodes = inferSkillNodes([node("b", 2), node("a", 1)]);
    const b = nodes.find((n) => n.skillId === curriculumSkillId("b"))!;
    expect(b.prerequisites).toEqual([curriculumSkillId("a")]);
  });

  it("produces a graph that can be walked downward", () => {
    const nodes = inferSkillNodes([node("a", 1), node("b", 2), node("c", 3)]);
    const chain = prerequisiteChain(buildSkillGraph(nodes), curriculumSkillId("c"), 8);
    // Walking the chain is what turns "failing here" into "check underneath".
    expect(chain).toEqual([curriculumSkillId("b"), curriculumSkillId("a")]);
  });
});

describe("Linking an objective to its curriculum node", () => {
  it("puts the curriculum node underneath the objective skill", async () => {
    await linkObjectiveToCurriculumNode({
      skillId: "chain rule differentiation",
      label: "Chain rule differentiation",
      curriculumNodeId: "link-test-node-1",
    });

    const stored = (await getSkillNodes()).find((n) => n.skillId === "chain_rule_differentiation");
    // Without this the objective-named skill and the node-named skill are
    // disconnected islands and the prerequisite chain stops dead.
    expect(stored?.prerequisites).toContain(curriculumSkillId("link-test-node-1"));
    expect(stored?.curriculumNode).toBe("link-test-node-1");
  });

  it("preserves prerequisites somebody already declared", async () => {
    await upsertSkillNode({
      skillId: "link_test_preserve",
      label: "Preserve me",
      prerequisites: ["hand_authored_prereq"],
    });
    await linkObjectiveToCurriculumNode({
      skillId: "link_test_preserve",
      label: "Preserve me",
      curriculumNodeId: "link-test-node-2",
    });

    const stored = (await getSkillNodes()).find((n) => n.skillId === "link_test_preserve");
    // A previously declared edge is a claim someone made. Discarding it on the
    // next ingest would make the graph depend on ingest order.
    expect(stored?.prerequisites).toContain("hand_authored_prereq");
    expect(stored?.prerequisites).toContain(curriculumSkillId("link-test-node-2"));
  });

  it("is idempotent across repeated generations", async () => {
    for (let i = 0; i < 3; i += 1) {
      await linkObjectiveToCurriculumNode({
        skillId: "link_test_idempotent",
        label: "Idempotent",
        curriculumNodeId: "link-test-node-3",
      });
    }
    const stored = (await getSkillNodes()).find((n) => n.skillId === "link_test_idempotent");
    expect(stored?.prerequisites).toHaveLength(1);
  });

  it("refuses to make a skill its own prerequisite", async () => {
    const nodeId = "link-test-node-4";
    await linkObjectiveToCurriculumNode({
      skillId: curriculumSkillId(nodeId),
      label: "Self",
      curriculumNodeId: nodeId,
    });
    const stored = (await getSkillNodes()).find((n) => n.skillId === curriculumSkillId(nodeId));
    // A self-edge would make the prerequisite walk describe a learner as
    // blocked on the very thing they are trying to learn.
    expect(stored?.prerequisites ?? []).not.toContain(curriculumSkillId(nodeId));
  });
});
