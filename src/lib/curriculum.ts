import { getDb, saveDbSync } from "../db/database";

export interface CurriculumNodeRecord {
  id: string;
  sourceId: string;
  parentNodeId: string | null;
  ordinal: number;
  depth: number;
  title: string;
  sectionNumber: string | null;
  startPage: number;
  endPage: number;
  nodeKind: "front_matter" | "chapter" | "section" | "subsection" | "review" | "back_matter";
  extractionStatus: "authored" | "outline_inferred";
  contentHash: string;
  children?: CurriculumNodeRecord[];
}

export interface CurriculumSourceRecord {
  id: string;
  name: string;
  hash: string;
  pageCount: number;
  hasOutline: boolean;
  extractionStatus: "authored" | "outline_inferred";
  createdAt: string;
}

export interface CurriculumChunkRecord {
  id: string;
  nodeId: string;
  page: number;
  chunkOrdinal: number;
  textContent: string;
  excerptHash: string;
  chunkKind: "definition" | "theorem" | "worked_example" | "prose" | "figure_caption";
}

/* Hash helper */
export function simpleHash(text: string): string {
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  return "h" + Math.abs(hash).toString(16);
}

export async function parseAndIngestPdfOutline({
  sourceId,
  name,
  pageCount,
  outline,
}: {
  sourceId: string;
  name: string;
  pageCount: number;
  outline?: { title: string; destPage: number; depth: number; children?: any[] }[];
}): Promise<CurriculumSourceRecord> {
  const db = await getDb();
  const now = new Date().toISOString();
  const hasOutline = Array.isArray(outline) && outline.length > 0;
  const extractionStatus = hasOutline ? "authored" : "outline_inferred";
  const sourceHash = simpleHash(name + pageCount);

  db.run(`
    INSERT INTO curriculum_sources (id, name, hash, page_count, has_outline, extraction_status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      page_count = excluded.page_count,
      has_outline = excluded.has_outline,
      extraction_status = excluded.extraction_status;
  `, [sourceId, name, sourceHash, pageCount, hasOutline ? 1 : 0, extractionStatus, now]);

  // If outline provided, ingest nodes
  const nodesToInsert = hasOutline ? outline : generateInferredOutline(pageCount);

  // Process and compute end pages
  const processedNodes: CurriculumNodeRecord[] = [];
  for (let i = 0; i < nodesToInsert.length; i++) {
    const raw = nodesToInsert[i];
    const nextRaw = nodesToInsert[i + 1];
    const endPage = nextRaw ? Math.max(raw.destPage, nextRaw.destPage - 1) : pageCount;
    const secMatch = raw.title.match(/^(\d+(?:\.\d+)*)\s+/);
    const secNum = secMatch ? secMatch[1] : null;

    const nodeId = `node-${sourceId}-${i + 1}`;
    processedNodes.push({
      id: nodeId,
      sourceId,
      parentNodeId: null,
      ordinal: i + 1,
      depth: raw.depth || 0,
      title: raw.title,
      sectionNumber: secNum,
      startPage: raw.destPage,
      endPage,
      nodeKind: raw.depth === 0 ? "chapter" : "section",
      extractionStatus,
      contentHash: simpleHash(nodeId + raw.title),
    });
  }

  for (const n of processedNodes) {
    db.run(`
      INSERT INTO curriculum_nodes (id, source_id, parent_node_id, ordinal, depth, title, section_number, start_page, end_page, node_kind, extraction_status, content_hash)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        start_page = excluded.start_page,
        end_page = excluded.end_page;
    `, [n.id, n.sourceId, n.parentNodeId, n.ordinal, n.depth, n.title, n.sectionNumber, n.startPage, n.endPage, n.nodeKind, n.extractionStatus, n.contentHash]);

    // Insert mock chunk evidence per node
    const chunkId = `chunk-${n.id}-1`;
    const textContent = `Curriculum content for ${n.title} (Pages ${n.startPage}–${n.endPage}). Core definitions, formulas, and worked examples for this section.`;
    db.run(`
      INSERT INTO curriculum_chunks (id, node_id, page, chunk_ordinal, text_content, excerpt_hash, chunk_kind)
      VALUES (?, ?, ?, 1, ?, ?, 'prose')
      ON CONFLICT(id) DO UPDATE SET text_content = excluded.text_content;
    `, [chunkId, n.id, n.startPage, textContent, simpleHash(textContent)]);
  }

  saveDbSync();

  return {
    id: sourceId,
    name,
    hash: sourceHash,
    pageCount,
    hasOutline,
    extractionStatus,
    createdAt: now,
  };
}

function generateInferredOutline(pageCount: number) {
  const chapters = Math.max(1, Math.ceil(pageCount / 30));
  const result: { title: string; destPage: number; depth: number }[] = [];
  for (let c = 1; c <= chapters; c++) {
    const startP = (c - 1) * 30 + 1;
    result.push({ title: `Chapter ${c} (Inferred Structure)`, destPage: startP, depth: 0 });
    result.push({ title: `${c}.1 Concept Review`, destPage: startP + 2, depth: 1 });
    if (startP + 15 <= pageCount) {
      result.push({ title: `${c}.2 Advanced Applications`, destPage: startP + 15, depth: 1 });
    }
  }
  return result;
}

export async function getCurriculumTree(sourceId: string): Promise<CurriculumNodeRecord[]> {
  const db = await getDb();
  const res = db.exec(`
    SELECT id, source_id, parent_node_id, ordinal, depth, title, section_number, start_page, end_page, node_kind, extraction_status, content_hash
    FROM curriculum_nodes
    WHERE source_id = ?
    ORDER BY ordinal ASC;
  `, [sourceId]);

  if (!res[0]) return [];

  const nodes: CurriculumNodeRecord[] = res[0].values.map((row) => ({
    id: row[0] as string,
    sourceId: row[1] as string,
    parentNodeId: row[2] as string | null,
    ordinal: row[3] as number,
    depth: row[4] as number,
    title: row[5] as string,
    sectionNumber: row[6] as string | null,
    startPage: row[7] as number,
    endPage: row[8] as number,
    nodeKind: row[9] as any,
    extractionStatus: row[10] as any,
    contentHash: row[11] as string,
  }));

  return buildTreeHierarchy(nodes);
}

function buildTreeHierarchy(nodes: CurriculumNodeRecord[]): CurriculumNodeRecord[] {
  const map = new Map<string, CurriculumNodeRecord>();
  const root: CurriculumNodeRecord[] = [];

  nodes.forEach((n) => {
    map.set(n.id, { ...n, children: [] });
  });

  nodes.forEach((n) => {
    const item = map.get(n.id)!;
    if (n.parentNodeId && map.has(n.parentNodeId)) {
      map.get(n.parentNodeId)!.children!.push(item);
    } else {
      root.push(item);
    }
  });

  return root;
}

/* Get evidence context for selected nodes (disjoint multi-select supported!) */
export async function getEvidenceForSelectedNodes(nodeIds: string[]): Promise<{
  nodes: CurriculumNodeRecord[];
  chunks: CurriculumChunkRecord[];
}> {
  if (nodeIds.length === 0) return { nodes: [], chunks: [] };

  const db = await getDb();
  const placeholders = nodeIds.map(() => "?").join(",");

  const nodesRes = db.exec(`
    SELECT id, source_id, parent_node_id, ordinal, depth, title, section_number, start_page, end_page, node_kind, extraction_status, content_hash
    FROM curriculum_nodes
    WHERE id IN (${placeholders});
  `, nodeIds);

  const chunksRes = db.exec(`
    SELECT id, node_id, page, chunk_ordinal, text_content, excerpt_hash, chunk_kind
    FROM curriculum_chunks
    WHERE node_id IN (${placeholders});
  `, nodeIds);

  const nodes = (nodesRes[0]?.values ?? []).map((r) => ({
    id: r[0] as string,
    sourceId: r[1] as string,
    parentNodeId: r[2] as string | null,
    ordinal: r[3] as number,
    depth: r[4] as number,
    title: r[5] as string,
    sectionNumber: r[6] as string | null,
    startPage: r[7] as number,
    endPage: r[8] as number,
    nodeKind: r[9] as any,
    extractionStatus: r[10] as any,
    contentHash: r[11] as string,
  }));

  const chunks = (chunksRes[0]?.values ?? []).map((r) => ({
    id: r[0] as string,
    nodeId: r[1] as string,
    page: r[2] as number,
    chunkOrdinal: r[3] as number,
    textContent: r[4] as string,
    excerptHash: r[5] as string,
    chunkKind: r[6] as any,
  }));

  return { nodes, chunks };
}
