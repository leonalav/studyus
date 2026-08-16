import { describe, it, expect, beforeEach } from "vitest";
import { getDb } from "../../db/database";
import {
  backfillSkillGraph,
  curriculumSkillId,
  ensureSkillGraphBackfilled,
  resetSkillGraphBackfillForTests,
} from "./skillGraph";
import { getSkillNodes, normalizeSkillId } from "./store";
import type { SkillNode } from "./types";

/**
 * The skill graph is only built when curriculum is ingested and when questions
 * are generated. Any profile whose content predates the graph therefore reaches
 * the policy engine with no edges at all — and a policy that cannot see a
 * prerequisite silently stops routing to prerequisite repair. The failure is
 * invisible: the tutor keeps answering, it just never notices that the learner
 * is missing the thing underneath.
 *
 * These tests pin the repair pass that closes that gap, and pin equally hard
 * that it is safe to run on every session start: idempotent, and never able to
 * fail a learner's turn.
 */

let seq = 0;

/** The graph is global; these tests assert about their own corner of it. */
async function findNode(skillId: string): Promise<SkillNode | undefined> {
  return (await getSkillNodes()).find((node) => node.skillId === skillId);
}

async function seedCurriculum(): Promise<{ sourceId: string; nodeIds: string[] }> {
  const db = await getDb();
  seq += 1;
  const sourceId = `src_${seq}`;
  db.run(
    `INSERT INTO curriculum_sources (id, name, hash, page_count, has_outline, extraction_status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?);`,
    [sourceId, "Mechanics", sourceId, 10, 1, "ready", new Date().toISOString()]
  );
  const nodeIds = [`${sourceId}_n1`, `${sourceId}_n2`];
  nodeIds.forEach((id, index) => {
    db.run(
      `INSERT INTO curriculum_nodes
         (id, source_id, parent_node_id, ordinal, depth, title, section_number,
          start_page, end_page, node_kind, extraction_status, content_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      [id, sourceId, null, index + 1, 0, `Section ${index + 1}`, `${index + 1}`, 1, 2, "section", "ready", id]
    );
  });
  return { sourceId, nodeIds };
}

async function seedAssessmentItem(objective: string, curriculumNode: string): Promise<void> {
  const db = await getDb();
  seq += 1;
  const formId = `form_${seq}`;
  const now = new Date().toISOString();
  db.run(
    `INSERT INTO assessment_forms
       (id, title, subject, format, config_json, mode, curriculum_scope,
        generation_version, validation_status, feedback_policy, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
    [formId, "Paper 1", "Physics", "paper", "{}", "practice", "[]", "v1", "valid", "immediate", now, now]
  );
  db.run(
    `INSERT INTO assessment_items
       (id, form_id, stable_ordinal, stem, item_type, maximum_marks, bloom_target,
        learning_objective, curriculum_node, answer_spec_json, figure_spec_json,
        provenance, generation_version)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
    [
      `item_${seq}`,
      formId,
      1,
      "Find the acceleration.",
      "numeric",
      3,
      "apply",
      objective,
      curriculumNode,
      "{}",
      null,
      "authored",
      "v1",
    ]
  );
}

describe("backfillSkillGraph", () => {
  beforeEach(async () => {
    await getDb();
    resetSkillGraphBackfillForTests();
  });

  it("gives a pre-existing curriculum the prerequisite edges it never had", async () => {
    const { nodeIds } = await seedCurriculum();
    // The content exists; the graph does not. This is exactly the state of any
    // profile that ingested material before the graph was introduced.
    expect(await findNode(curriculumSkillId(nodeIds[1]))).toBeUndefined();

    await backfillSkillGraph();

    const second = await findNode(curriculumSkillId(nodeIds[1]));
    expect(second).toBeDefined();
    // The book taught section 1 before section 2, which is the evidence the
    // inference rests on.
    expect(second!.prerequisites).toContain(curriculumSkillId(nodeIds[0]));
  });

  it("attaches learning objectives to the curriculum node that teaches them", async () => {
    const { nodeIds } = await seedCurriculum();
    await seedAssessmentItem("Newton's second law", nodeIds[1]);

    await backfillSkillGraph();

    const objective = await findNode(normalizeSkillId("Newton's second law"));
    expect(objective).toBeDefined();
    // Without this edge, failing an objective-tagged question tells the policy
    // engine nothing about which section to send the learner back to.
    expect(objective!.prerequisites).toContain(curriculumSkillId(nodeIds[1]));
  });

  it("ignores items that name no objective or no node", async () => {
    const { nodeIds } = await seedCurriculum();
    await seedAssessmentItem("", nodeIds[0]);
    await seedAssessmentItem("Orphan objective", "");

    await backfillSkillGraph();

    // A half-specified row is not evidence of a dependency. Inventing an edge
    // from it would route a learner into repair on unrelated material.
    expect(await findNode(normalizeSkillId("Orphan objective"))).toBeUndefined();
    // The node named by the objective-less item is still built from the
    // curriculum itself; it simply gains no objective edge.
    expect(await findNode(curriculumSkillId(nodeIds[0]))).toBeDefined();
  });

  it("can be run repeatedly without duplicating or mutating what it already built", async () => {
    const { nodeIds } = await seedCurriculum();
    await seedAssessmentItem("Conservation of momentum", nodeIds[1]);

    await backfillSkillGraph();
    const first = [
      await findNode(curriculumSkillId(nodeIds[1])),
      await findNode(normalizeSkillId("Conservation of momentum")),
    ];
    const countAfterFirst = (await getSkillNodes()).length;

    await backfillSkillGraph();
    const second = [
      await findNode(curriculumSkillId(nodeIds[1])),
      await findNode(normalizeSkillId("Conservation of momentum")),
    ];

    // Idempotence is what makes it safe to attach to every session start.
    expect(second).toEqual(first);
    expect((await getSkillNodes()).length).toBe(countAfterFirst);
  });
});

describe("ensureSkillGraphBackfilled", () => {
  beforeEach(async () => {
    await getDb();
    resetSkillGraphBackfillForTests();
  });

  it("runs the repair once and shares it across concurrent callers", async () => {
    const { nodeIds } = await seedCurriculum();

    // Several turns can start at once; they must not each walk the curriculum.
    await Promise.all([
      ensureSkillGraphBackfilled(),
      ensureSkillGraphBackfilled(),
      ensureSkillGraphBackfilled(),
    ]);

    expect(await findNode(curriculumSkillId(nodeIds[1]))).toBeDefined();

    // A later call is a no-op rather than a second pass over the whole graph.
    const seededAfter = await seedCurriculum();
    await ensureSkillGraphBackfilled();
    expect(await findNode(curriculumSkillId(seededAfter.nodeIds[1]))).toBeUndefined();
  });

  it("never rejects, because a broken graph must not cost the learner a turn", async () => {
    const db = await getDb();
    // Simulate the graph store being unusable underneath the repair pass.
    db.run("DROP TABLE IF EXISTS skill_nodes;");

    // Degrading to pre-graph pedagogy is acceptable; throwing inside a learner's
    // tutor turn is not.
    await expect(ensureSkillGraphBackfilled()).resolves.toBeUndefined();

    // Restore the table so the shared in-memory database stays usable.
    db.run(`
      CREATE TABLE IF NOT EXISTS skill_nodes (
        skill_id TEXT PRIMARY KEY,
        label TEXT NOT NULL,
        prerequisites TEXT NOT NULL DEFAULT '[]',
        curriculum_node TEXT,
        description TEXT
      );
    `);
  });
});
