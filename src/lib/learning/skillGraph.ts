/**
 * Deriving a skill graph from curriculum structure.
 *
 * The plan calls for a skill graph ALONGSIDE the curriculum sequence, and the
 * word alongside is doing the work. A curriculum sequence says what order a
 * book presents things in. A skill graph says what depends on what. They are
 * different claims, and conflating them is why "the learner is stuck on
 * section 4" so often actually means "the learner never had section 2's skill".
 *
 * A textbook's order is nevertheless the best prerequisite evidence available
 * without an author sitting down to declare dependencies by hand, for one
 * specific reason: a competent textbook does not use an idea before it
 * introduces it. That makes "earlier in the same chapter" a decent prior for
 * "prerequisite of", and "the parent section" a decent prior for "the general
 * idea this specialises".
 *
 * Two limits keep this honest, because the inference is a prior and not a fact:
 *
 *  1. **Only same-parent siblings and the immediate parent.** Nothing crosses a
 *     chapter boundary. Two unrelated chapters that happen to be adjacent are
 *     not in a dependency relation, and asserting they are would send learners
 *     into repair on material that has nothing to do with their difficulty.
 *  2. **Only the nearest predecessor.** Declaring every earlier sibling a
 *     prerequisite would make the last section of a chapter depend on all the
 *     others, and a graph where everything depends on everything routes no
 *     better than no graph at all.
 *
 * The policy engine is already defensive about the result: `findWeakPrerequisites`
 * only reports a prerequisite as weak when it has actual evidence AND that
 * evidence is poor, so an inferred edge to a skill nobody has practised is
 * inert rather than harmful.
 */

import { getDb } from "../../db/database";
import { upsertSkillNode, normalizeSkillId, getSkillNodes } from "./store";
import type { SkillNode } from "./types";

/** A curriculum node reduced to what a dependency inference actually needs. */
interface OutlineRow {
  id: string;
  parentNodeId: string | null;
  ordinal: number;
  title: string;
  sectionNumber: string | null;
  nodeKind: string;
  drillFamilies?: string[];
}

/**
 * Node kinds that carry no teachable skill.
 *
 * A cover page, table of contents, or index is not something a learner can be
 * weak at, and admitting them would put phantom prerequisites in front of real
 * material.
 */
const NON_TEACHING_KINDS = new Set(["front_matter", "back_matter"]);

/**
 * The skill id a curriculum node maps to.
 *
 * Deliberately the node id rather than the title. Titles are not unique — two
 * chapters can both contain "Review Problems" — and collapsing distinct
 * sections into one skill would pool evidence from unrelated material into a
 * single state that describes nobody.
 */
export function curriculumSkillId(nodeId: string): string {
  return normalizeSkillId(`node.${nodeId}`);
}

/**
 * Infer prerequisite edges from an outline.
 *
 * Exported separately from persistence so the inference can be tested without
 * a database, and so a caller can inspect what would be written before writing.
 */
export function inferSkillNodes(rows: OutlineRow[]): SkillNode[] {
  const teaching = rows.filter((row) => !NON_TEACHING_KINDS.has(row.nodeKind));

  // Siblings grouped by parent, in presentation order. Top-level nodes share
  // the synthetic key "" so chapters can depend on the preceding chapter.
  const byParent = new Map<string, OutlineRow[]>();
  for (const row of teaching) {
    const key = row.parentNodeId ?? "";
    const list = byParent.get(key);
    if (list) list.push(row);
    else byParent.set(key, [row]);
  }
  for (const list of byParent.values()) {
    list.sort((a, b) => a.ordinal - b.ordinal);
  }

  const teachingIds = new Set(teaching.map((row) => row.id));

  return teaching.map((row) => {
    const siblings = byParent.get(row.parentNodeId ?? "") ?? [];
    const index = siblings.findIndex((sibling) => sibling.id === row.id);
    const previous = index > 0 ? siblings[index - 1] : undefined;

    const prerequisites: string[] = [];
    // The immediately preceding sibling: the thing the book taught last, in the
    // same context, before teaching this.
    if (previous) prerequisites.push(curriculumSkillId(previous.id));
    // The parent section: the general idea this one specialises. Skipped when
    // the parent is front/back matter, which teaches nothing.
    if (row.parentNodeId && teachingIds.has(row.parentNodeId)) {
      prerequisites.push(curriculumSkillId(row.parentNodeId));
    }

    return {
      skillId: curriculumSkillId(row.id),
      label: row.sectionNumber ? `${row.sectionNumber} ${row.title}` : row.title,
      prerequisites: [...new Set(prerequisites)],
      curriculumNode: row.id,
      drillFamilies: row.drillFamilies,
    } satisfies SkillNode;
  });
}

/**
 * Populate the skill graph for one curriculum source.
 *
 * Idempotent: `upsertSkillNode` replaces by skill id, so re-ingesting a source
 * or re-running this after an outline edit converges rather than duplicating.
 *
 * Returns the number of skills written so a caller can report it, and swallows
 * nothing — a caller that wants this to be best-effort should say so at the
 * call site rather than have the failure hidden here.
 */
export async function seedSkillGraphFromCurriculum(sourceId: string): Promise<number> {
  const db = await getDb();
  const res = db.exec(
    `SELECT id, parent_node_id, ordinal, title, section_number, node_kind
     FROM curriculum_nodes WHERE source_id = ? ORDER BY ordinal ASC;`,
    [sourceId]
  );

  const rows: OutlineRow[] = (res[0]?.values ?? []).map((row) => ({
    id: String(row[0]),
    parentNodeId: row[1] === null || row[1] === undefined ? null : String(row[1]),
    ordinal: Number(row[2] ?? 0),
    title: String(row[3] ?? "Untitled section"),
    sectionNumber: row[4] === null || row[4] === undefined ? null : String(row[4]),
    nodeKind: String(row[5] ?? "section"),
  }));

  const nodes = inferSkillNodes(rows);
  for (const node of nodes) {
    await upsertSkillNode(node);
  }
  return nodes.length;
}

/**
 * Link a skill named by a learning objective to the curriculum node it is
 * taught under.
 *
 * Assessment items and tutor sessions name skills by objective, not by node id,
 * so without this the objective-named skill and the node-named skill are two
 * disconnected islands and the prerequisite chain stops dead at the first
 * objective. This attaches the objective skill beneath its node, which is what
 * lets a failure on "chain rule differentiation" reach the sections that came
 * before it.
 *
 * Existing prerequisites are preserved rather than overwritten: a hand-authored
 * or previously inferred edge is a claim someone made, and silently discarding
 * it on the next ingest would make the graph depend on ingest order.
 */
export async function linkObjectiveToCurriculumNode(params: {
  skillId: string;
  label: string;
  curriculumNodeId: string;
}): Promise<void> {
  const skillId = normalizeSkillId(params.skillId);
  const nodeSkillId = curriculumSkillId(params.curriculumNodeId);
  if (skillId === nodeSkillId) return;

  const existing = (await getSkillNodes()).find((node) => node.skillId === skillId);
  const prerequisites = [...new Set([...(existing?.prerequisites ?? []), nodeSkillId])];

  await upsertSkillNode({
    skillId,
    label: existing?.label ?? params.label,
    prerequisites,
    curriculumNode: params.curriculumNodeId,
    description: existing?.description,
    drillFamilies: existing?.drillFamilies,
  });
}

/**
 * Build the skill graph for curricula and assessments that already exist.
 *
 * Seeding runs at ingest time, which is the right moment for anything arriving
 * from now on — and useless for everything already in the database. A learner
 * who imported their textbook last month would have had an empty graph
 * forever: no prerequisite edges, so `prerequisite_repair` could never fire and
 * every failure fell back to a generic diagnostic probe. The pedagogy would
 * silently be one route short, and nothing would look broken.
 *
 * Idempotent by construction: node seeding upserts by skill id, and objective
 * linking unions its edge into whatever is already there. Running it twice
 * changes nothing, so it is safe to call on every startup.
 *
 * Failures are contained per source and per objective. A backfill is
 * best-effort maintenance, and one malformed row must not stop the rest of the
 * graph from being built, nor take the caller down with it.
 */
export async function backfillSkillGraph(): Promise<{
  sources: number;
  nodes: number;
  objectives: number;
}> {
  const db = await getDb();
  let sources = 0;
  let nodes = 0;
  let objectives = 0;

  const sourceRows = db.exec(`SELECT DISTINCT source_id FROM curriculum_nodes;`);
  for (const row of sourceRows[0]?.values ?? []) {
    const sourceId = String(row[0]);
    try {
      nodes += await seedSkillGraphFromCurriculum(sourceId);
      sources += 1;
    } catch (error) {
      console.warn(`[skill-graph] could not backfill curriculum source ${sourceId}`, error);
    }
  }

  // Objectives are linked from the items that name them. DISTINCT keeps the
  // work proportional to the number of real objectives rather than the number
  // of questions, which is often an order of magnitude larger.
  const objectiveRows = db.exec(
    `SELECT DISTINCT learning_objective, curriculum_node
       FROM assessment_items
      WHERE learning_objective <> '' AND curriculum_node <> '';`
  );
  for (const row of objectiveRows[0]?.values ?? []) {
    const objective = String(row[0] ?? "").trim();
    const node = String(row[1] ?? "").trim();
    if (!objective || !node) continue;
    try {
      await linkObjectiveToCurriculumNode({
        skillId: objective,
        label: objective,
        curriculumNodeId: node,
      });
      objectives += 1;
    } catch (error) {
      console.warn(`[skill-graph] could not link objective "${objective}"`, error);
    }
  }

  return { sources, nodes, objectives };
}

/**
 * Run the backfill at most once per process.
 *
 * Called from the policy path, which is the first place the graph is actually
 * consumed, so the repair happens before anything can be decided on a missing
 * edge. A module-level promise makes concurrent turns share one pass instead of
 * racing, and the resolved promise makes every later call a no-op.
 *
 * It never rejects: an unusable graph should degrade the pedagogy to what it
 * was before the graph existed, not fail a learner's turn.
 */
let backfillOnce: Promise<void> | null = null;

export function ensureSkillGraphBackfilled(): Promise<void> {
  if (!backfillOnce) {
    backfillOnce = backfillSkillGraph()
      .then(() => undefined)
      .catch((error) => {
        console.warn("[skill-graph] backfill failed; continuing without it", error);
      });
  }
  return backfillOnce;
}

/** Test seam: forget that the backfill ran. */
export function resetSkillGraphBackfillForTests(): void {
  backfillOnce = null;
}
