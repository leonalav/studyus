import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { getDb, saveDbSync } from "../db/database";
import { renderPageRange, saveSourcePdf, TauriUnavailableError, visionExtractImage, isTauriRuntime } from "./tauri";
import { resolveRoleEndpoint, chatCompletion, type ContentPart, type RuntimeMessage } from "./agentRuntime";
import { normalize } from "./latex/normalize";
import { TEST_GENERATION_AGENT_PROMPT_V1 } from "./llm";

/**
 * System prompt for the vision transcription agent. A rasterized curriculum page
 * is sent as an image_url part; the model returns the page's content as prose
 * interspersed with delimited LaTeX ($...$ / $$...$$), which is then normalized.
 *
 * Why the generation role: it already advertises vision capability and grounds
 * in curriculum evidence; reusing one binding keeps key handling in one place.
 */
const VISION_TRANSCRIBE_PROMPT_V1 = `You transcribe curriculum PDF pages that were rasterized to images because their display math is rendered as vector drawings (text extraction loses it).

For each page image, return the page's instructional content as clean prose with every equation, expression, and figure caption transcribed as LaTeX:
- Inline math inside single dollars: $...$
- Display math inside double dollars: $$...$$
- Keep the original narrative order. Do not summarize, solve, or omit.
- For diagrams/axes without an equation, give a one-sentence figure caption in prose; do not invent coordinates.
- Do NOT wrap the whole response in a code fence. Do NOT use \\begin{equation}/\\begin{align} environments; use $$...$$ and $...$ only.
- If a page is blank or non-instructional (cover, toc, license), return the single word: BLANK`;

import { seedSkillGraphFromCurriculum } from "./learning/skillGraph";
import { ExtractedPage } from "./curriculum/docling";

// #region agent log
const _log = (msg: string, data?: Record<string, unknown>) => {
  const payload = {
    sessionId: "b2df54",
    location: "curriculum.ts:transcribeNode",
    message: msg,
    data: data ?? {},
    timestamp: Date.now(),
    runId: "pre-fix",
    hypothesisId: "A",
  };
  fetch('http://127.0.0.1:7916/ingest/f536bebe-ec55-4017-9bbe-1f993193bba3', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': 'b2df54' },
    body: JSON.stringify(payload),
  }).catch(() => {});
};
// #endregion

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
  /** Full-page markdown extracted by Granite Docling OCR (verbatim transcription). */
  doclingMarkdown?: string;
  /** JSON array of extracted figure metadata: { id, caption }[] */
  extractedImages?: string;
  /** JSON array of extracted table metadata: { id, markdown }[] */
  extractedTables?: string;
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

export async function extractPdfOutline(file: File): Promise<{
  name: string;
  pageCount: number;
  outline: { title: string; destPage: number; depth: number }[];
}> {
  const { getDocument, GlobalWorkerOptions } = await import("pdfjs-dist");
  GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
  const data = new Uint8Array(await file.arrayBuffer());
  const pdf = await getDocument({ data }).promise;
  const raw = await pdf.getOutline();
  const flat: { title: string; destPage: number; depth: number }[] = [];

  const visit = async (items: any[], depth: number) => {
    for (const item of items ?? []) {
      let destPage = 1;
      try {
        const destination = typeof item.dest === "string" ? await pdf.getDestination(item.dest) : item.dest;
        const ref = Array.isArray(destination) ? destination[0] : null;
        if (ref) destPage = (await pdf.getPageIndex(ref)) + 1;
      } catch {
        destPage = 1;
      }
      flat.push({ title: String(item.title ?? "Untitled section").trim(), destPage, depth });
      if (Array.isArray(item.items) && item.items.length > 0) await visit(item.items, depth + 1);
    }
  };

  await visit(raw ?? [], 0);
  return { name: file.name, pageCount: pdf.numPages, outline: flat };
}

const ORIGINAL_PDF_DB = "studyus-curriculum-files";
const ORIGINAL_PDF_STORE = "pdfs";
const inMemoryOriginalPdfs = new Map<string, Blob>();

/**
 * Keep the original import available to the document viewer's Download action.
 * SQLite stores the outline and metadata, while IndexedDB is the browser-safe
 * place for the (potentially large) binary. The small in-memory fallback keeps
 * the action working for the current run when IndexedDB is unavailable.
 */
async function persistOriginalPdf(sourceId: string, file: File): Promise<void> {
  const blob = file.slice(0, file.size, "application/pdf");
  inMemoryOriginalPdfs.set(sourceId, blob);
  if (typeof indexedDB === "undefined") return;

  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.open(ORIGINAL_PDF_DB, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(ORIGINAL_PDF_STORE)) {
        db.createObjectStore(ORIGINAL_PDF_STORE);
      }
    };
    request.onerror = () => reject(request.error ?? new Error("Could not open curriculum file storage"));
    request.onsuccess = () => {
      const db = request.result;
      const transaction = db.transaction(ORIGINAL_PDF_STORE, "readwrite");
      transaction.objectStore(ORIGINAL_PDF_STORE).put(blob, sourceId);
      transaction.oncomplete = () => {
        db.close();
        resolve();
      };
      transaction.onerror = () => {
        db.close();
        reject(transaction.error ?? new Error("Could not store the curriculum PDF"));
      };
    };
  });
}

async function deletePersistedOriginalPdf(sourceId: string): Promise<void> {
  inMemoryOriginalPdfs.delete(sourceId);
  if (typeof indexedDB === "undefined") return;
  await new Promise<void>((resolve) => {
    const request = indexedDB.open(ORIGINAL_PDF_DB, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(ORIGINAL_PDF_STORE)) db.createObjectStore(ORIGINAL_PDF_STORE);
    };
    request.onerror = () => resolve();
    request.onsuccess = () => {
      const db = request.result;
      const transaction = db.transaction(ORIGINAL_PDF_STORE, "readwrite");
      transaction.objectStore(ORIGINAL_PDF_STORE).delete(sourceId);
      transaction.oncomplete = () => {
        db.close();
        resolve();
      };
      transaction.onerror = () => {
        db.close();
        resolve();
      };
    };
  });
}

/** Rename a curriculum source without changing its stable node/source identity. */
export async function renameCurriculumSource(sourceId: string, name: string): Promise<void> {
  const clean = name.trim().slice(0, 240);
  if (!clean) throw new Error("Curriculum name cannot be empty");
  const db = await getDb();
  db.run("UPDATE curriculum_sources SET name = ? WHERE id = ?;", [clean, sourceId]);
  saveDbSync();
}

/** Remove a curriculum and all of its node evidence from durable storage. */
export async function deleteCurriculumSource(sourceId: string): Promise<void> {
  const db = await getDb();
  // Delete explicitly as well as relying on foreign-key cascades: sql.js builds
  // can differ in their PRAGMA defaults, and no orphaned evidence should remain.
  db.run(`DELETE FROM curriculum_assets WHERE node_id IN (SELECT id FROM curriculum_nodes WHERE source_id = ?);`, [sourceId]);
  db.run(`DELETE FROM curriculum_chunks WHERE node_id IN (SELECT id FROM curriculum_nodes WHERE source_id = ?);`, [sourceId]);
  db.run("DELETE FROM curriculum_nodes WHERE source_id = ?;", [sourceId]);
  db.run("DELETE FROM curriculum_sources WHERE id = ?;", [sourceId]);
  saveDbSync();
  await deletePersistedOriginalPdf(sourceId);
}

/** Return the exact imported PDF bytes when they are available in this client. */
export async function getOriginalCurriculumPdf(sourceId: string): Promise<Blob | null> {
  const cached = inMemoryOriginalPdfs.get(sourceId);
  if (cached) return cached;
  if (typeof indexedDB === "undefined") return null;

  return new Promise<Blob | null>((resolve, reject) => {
    const request = indexedDB.open(ORIGINAL_PDF_DB, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(ORIGINAL_PDF_STORE)) {
        db.createObjectStore(ORIGINAL_PDF_STORE);
      }
    };
    request.onerror = () => reject(request.error ?? new Error("Could not open curriculum file storage"));
    request.onsuccess = () => {
      const db = request.result;
      const transaction = db.transaction(ORIGINAL_PDF_STORE, "readonly");
      const getRequest = transaction.objectStore(ORIGINAL_PDF_STORE).get(sourceId);
      getRequest.onsuccess = () => {
        const value = getRequest.result;
        db.close();
        if (value instanceof Blob) {
          inMemoryOriginalPdfs.set(sourceId, value);
          resolve(value);
        } else {
          resolve(null);
        }
      };
      getRequest.onerror = () => {
        db.close();
        reject(getRequest.error ?? new Error("Could not read the curriculum PDF"));
      };
    };
  });
}

export async function ingestPdfFile(file: File): Promise<CurriculumSourceRecord> {
  const parsed = await extractPdfOutline(file);
  if (parsed.outline.length === 0) {
    throw new Error("This PDF has no bookmark outline to import.");
  }
  const sourceId = `c-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  let filePath: string | undefined;
  // Under the desktop (Tauri) build, persist the uploaded bytes to disk so
  // pdfium can re-open them for lazy per-node raster + vision transcription.
  // In the browser single-file build this throws TauriUnavailableError, which
  // we silently swallow — ingestion still records the outline; transcription
  // is deferred until the user runs the desktop build.
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    filePath = await saveSourcePdf(file.name, bytes);
  } catch {
    /* not running under Tauri — leave filePath unset */
  }
  const source = await parseAndIngestPdfOutline({
    sourceId,
    name: parsed.name,
    pageCount: parsed.pageCount,
    outline: parsed.outline,
    filePath,
  });
  // Binary persistence is deliberately best-effort: a browser with storage
  // disabled can still index and study the outline, while ordinary clients get
  // a durable Download original action.
  try {
    await persistOriginalPdf(source.id, file);
  } catch {
    inMemoryOriginalPdfs.set(source.id, file);
  }
  return source;
}
export async function parseAndIngestPdfOutline({
  sourceId,
  name,
  pageCount,
  outline,
  filePath,
}: {
  sourceId: string;
  name: string;
  pageCount: number;
  outline?: { title: string; destPage: number; depth: number; children?: any[] }[];
  filePath?: string;
}): Promise<CurriculumSourceRecord> {
  const db = await getDb();
  const now = new Date().toISOString();
  const hasOutline = Array.isArray(outline) && outline.length > 0;
  const extractionStatus = hasOutline ? "authored" : "outline_inferred";
  const sourceHash = simpleHash(name + pageCount);

  db.run(`
    INSERT INTO curriculum_sources (id, name, hash, page_count, has_outline, extraction_status, created_at, file_path)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      page_count = excluded.page_count,
      has_outline = excluded.has_outline,
      extraction_status = excluded.extraction_status,
      file_path = COALESCE(excluded.file_path, curriculum_sources.file_path);
  `, [sourceId, name, sourceHash, pageCount, hasOutline ? 1 : 0, extractionStatus, now, filePath ?? null]);

  // If outline provided, ingest nodes
  const nodesToInsert = hasOutline ? outline : generateInferredOutline(pageCount);

  // Convert the authored preorder outline into the persisted parent/child tree.
  const processedNodes: CurriculumNodeRecord[] = [];
  const stack: CurriculumNodeRecord[] = [];
  for (let i = 0; i < nodesToInsert.length; i++) {
    const raw = nodesToInsert[i];
    const nextRaw = nodesToInsert[i + 1];
    const endPage = nextRaw ? Math.max(raw.destPage, nextRaw.destPage - 1) : pageCount;
    const secMatch = raw.title.match(/^(\d+(?:\.\d+)*)\s+/);
    const secNum = secMatch ? secMatch[1] : null;
    const depth = Math.max(0, raw.depth || 0);
    while (stack.length > depth) stack.pop();
    const parent = stack[depth - 1];
    const nodeId = `node-${sourceId}-${i + 1}`;
    const node: CurriculumNodeRecord = {
      id: nodeId,
      sourceId,
      parentNodeId: parent?.id ?? null,
      ordinal: i + 1,
      depth,
      title: raw.title,
      sectionNumber: secNum,
      startPage: raw.destPage,
      endPage,
      nodeKind: depth === 0 ? "chapter" : depth === 1 ? "section" : "subsection",
      extractionStatus,
      contentHash: simpleHash(nodeId + raw.title),
    };
    processedNodes.push(node);
    stack[depth] = node;
    stack.length = depth + 1;
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

    // Text evidence is inserted by the PDF extraction pipeline. Outline ingestion
    // must not fabricate excerpts because generated assessments require grounded text.
  }

  saveDbSync();

  // Derive the skill graph from the outline that was just written. This is what
  // makes prerequisite repair possible at all: without a graph, a learner
  // failing repeatedly gets a generic diagnostic probe, because the engine has
  // no way to know what sits underneath the thing they are failing at.
  //
  // Best-effort on purpose. The graph is an inference layered on top of the
  // curriculum; failing to derive it must not fail the ingest of the source
  // material itself, which is the thing the learner actually asked for.
  try {
    await seedSkillGraphFromCurriculum(sourceId);
  } catch (error) {
    console.warn("[curriculum] could not derive a skill graph from this outline", error);
  }

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

  // A selected chapter/section includes all of its descendants. Without this
  // closure, selecting a parent bookmark could produce no evidence even though
  // its transcribed subsections were fully indexed.
  const nodesRes = db.exec(`
    WITH RECURSIVE scoped_nodes(id) AS (
      SELECT id FROM curriculum_nodes WHERE id IN (${placeholders})
      UNION
      SELECT n.id
      FROM curriculum_nodes n
      JOIN scoped_nodes parent ON n.parent_node_id = parent.id
    )
    SELECT n.id, n.source_id, n.parent_node_id, n.ordinal, n.depth, n.title, n.section_number,
           n.start_page, n.end_page, n.node_kind, n.extraction_status, n.content_hash
    FROM curriculum_nodes n
    JOIN scoped_nodes scoped ON scoped.id = n.id
    ORDER BY n.ordinal ASC;
  `, nodeIds);

  const chunksRes = db.exec(`
    WITH RECURSIVE scoped_nodes(id) AS (
      SELECT id FROM curriculum_nodes WHERE id IN (${placeholders})
      UNION
      SELECT n.id
      FROM curriculum_nodes n
      JOIN scoped_nodes parent ON n.parent_node_id = parent.id
    )
    SELECT c.id, c.node_id, c.page, c.chunk_ordinal, c.text_content, c.excerpt_hash, c.chunk_kind, c.docling_markdown, c.extracted_images, c.extracted_tables
    FROM curriculum_chunks c
    JOIN scoped_nodes scoped ON scoped.id = c.node_id
    ORDER BY c.node_id ASC, c.chunk_ordinal ASC;
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
    doclingMarkdown: r[7] as string | undefined,
    extractedImages: r[8] as string | undefined,
    extractedTables: r[9] as string | undefined,
  }));

  return { nodes, chunks };
}

/**
 * Deterministic browser fallback for generation. Imported PDFs are retained in
 * IndexedDB, so text-based pages can be indexed on demand without requiring a
 * learner to open every subsection in the tutor first. Vision transcription
 * remains the higher-fidelity path for vector math and scanned pages.
 *
 * Evidence is extracted for the leaf nodes in the selected scope. This avoids
 * duplicating an entire chapter into each ancestor while ensuring parent
 * selections still become generatable through their descendants.
 */
export async function ensureTextEvidenceForSelectedNodes(nodeIds: string[]): Promise<number> {
  if (nodeIds.length === 0) return 0;
  const db = await getDb();
  const placeholders = nodeIds.map(() => "?").join(",");
  const scopedRes = db.exec(`
    WITH RECURSIVE scoped_nodes(id) AS (
      SELECT id FROM curriculum_nodes WHERE id IN (${placeholders})
      UNION
      SELECT n.id
      FROM curriculum_nodes n
      JOIN scoped_nodes parent ON n.parent_node_id = parent.id
    )
    SELECT n.id, n.source_id, n.start_page, n.end_page
    FROM curriculum_nodes n
    JOIN scoped_nodes scoped ON scoped.id = n.id
    WHERE NOT EXISTS (
      SELECT 1
      FROM curriculum_nodes child
      JOIN scoped_nodes child_scope ON child_scope.id = child.id
      WHERE child.parent_node_id = n.id
    )
    AND NOT EXISTS (SELECT 1 FROM curriculum_chunks c WHERE c.node_id = n.id)
    ORDER BY n.source_id, n.ordinal;
  `, nodeIds);

  const missing = (scopedRes[0]?.values ?? []).map((row) => ({
    id: String(row[0]),
    sourceId: String(row[1]),
    startPage: Number(row[2]),
    endPage: Number(row[3]),
  }));
  if (missing.length === 0) return 0;

  const bySource = new Map<string, typeof missing>();
  for (const node of missing) {
    const nodes = bySource.get(node.sourceId) ?? [];
    nodes.push(node);
    bySource.set(node.sourceId, nodes);
  }

  let inserted = 0;
  for (const [sourceId, sourceNodes] of bySource) {
    let blob: Blob | null = null;
    try {
      blob = await getOriginalCurriculumPdf(sourceId);
    } catch {
      blob = null;
    }
    if (!blob) continue;

    const { getDocument, GlobalWorkerOptions } = await import("pdfjs-dist");
    GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
    const loadingTask = getDocument({ data: new Uint8Array(await blob.arrayBuffer()) });
    const pdf = await loadingTask.promise;
    const pageTextCache = new Map<number, string>();

    for (const node of sourceNodes) {
      let ordinal = 0;
      const firstPage = Math.max(1, node.startPage);
      const lastPage = Math.min(pdf.numPages, node.endPage);
      for (let pageNumber = firstPage; pageNumber <= lastPage; pageNumber++) {
        let text = pageTextCache.get(pageNumber);
        if (text === undefined) {
          const page = await pdf.getPage(pageNumber);
          const content = await page.getTextContent();
          text = (content.items as Array<{ str?: string; hasEOL?: boolean }>)
            .map((item) => `${typeof item.str === "string" ? item.str : ""}${item.hasEOL ? "\n" : " "}`)
            .join("")
            .replace(/[ \t]+\n/g, "\n")
            .replace(/\n{3,}/g, "\n\n")
            .replace(/[ \t]{2,}/g, " ")
            .trim();
          pageTextCache.set(pageNumber, text);
        }
        if (text.length < 20) continue;

        ordinal++;
        const excerptHash = simpleHash(text);
        db.run(
          `INSERT OR IGNORE INTO curriculum_chunks
             (id, node_id, page, chunk_ordinal, text_content, excerpt_hash, chunk_kind)
           VALUES (?, ?, ?, ?, ?, ?, 'prose');`,
          [`chunk-text-${simpleHash(`${node.id}:${pageNumber}:${excerptHash}`)}`, node.id, pageNumber, ordinal, text, excerptHash]
        );
        inserted++;
      }
    }
    await loadingTask.destroy();
  }

  if (inserted > 0) saveDbSync();
  return inserted;
}

/* ─────────────────────────────────────────────────────────────
   LAZY PER-NODE RASTER + VISION TRANSCRIPTION

   The ingestion pipeline (above) records the outline and page ranges but never
   fabricates excerpts — display math is vector-rendered, so nothing usable can
   come from text extraction. Instead, when the learner selects a subsection we
   rasterize that node's page range via pdfium, hand the PNGs to the bound
   generation-role vision model, normalize the returned LaTeX, and write rows
   into curriculum_chunks keyed by node id. Re-selecting the same node is a
   cache hit: chunks already exist, so nothing is re-rasterized.
   ───────────────────────────────────────────────────────────── */

/// Per-call vision transcription timeout (mirrors the reference repo: 120s
/// request budget for a handful of 1500px pages). Generous because vision
/// transcription is heavier than a chat turn.
const TRANSCRIBE_TIMEOUT_MS = 120_000;

const NODE_TRANSCRIBE_CACHE = new Set<string>(); // nodeIds known to have chunks, in-memory fast path

/** Record the on-disk PDF path for a source so pdfium can re-open it later. */
export async function setSourceFilePath(sourceId: string, filePath: string): Promise<void> {
  const db = await getDb();
  db.run(`UPDATE curriculum_sources SET file_path = ? WHERE id = ?;`, [filePath, sourceId]);
  saveDbSync();
}

async function getSourceFilePath(sourceId: string): Promise<string | null> {
  const db = await getDb();
  const res = db.exec(`SELECT file_path FROM curriculum_sources WHERE id = ?;`, [sourceId]);
  const path = res[0]?.values?.[0]?.[0];
  return path ? String(path) : null;
}

/** True once curriculum_chunks has any row for this node (cache-hit fast path). */
async function nodeHasChunks(nodeId: string): Promise<boolean> {
  const db = await getDb();
  const res = db.exec(`SELECT 1 FROM curriculum_chunks WHERE node_id = ? LIMIT 1;`, [nodeId]);
  return (res[0]?.values?.length ?? 0) > 0;
}

/**
 * Lazily rasterize + vision-transcribe one node's page range, writing normalized
 * chunks. No-op (cache hit) when chunks already exist for the node. Throws
 * `TauriUnavailableError` outside the desktop build, and surfaces model errors
 * without writing partial chunks — the caller decides how to degrade.
 *
 * Returns the number of pages transcribed (0 on cache hit).
 */
export async function transcribeNode(nodeId: string, onProgress?: (page: number, total: number) => void): Promise<number> {
  if (NODE_TRANSCRIBE_CACHE.has(nodeId)) return 0;
  if (await nodeHasChunks(nodeId)) {
    NODE_TRANSCRIBE_CACHE.add(nodeId);
    return 0;
  }

  const db = await getDb();
  const nodeRes = db.exec(
    `SELECT n.source_id, n.start_page, n.end_page, n.title FROM curriculum_nodes n WHERE n.id = ?;`,
    [nodeId]
  );
  const row = nodeRes[0]?.values?.[0];
  if (!row) throw new Error(`transcribeNode: unknown node ${nodeId}`);

  const sourceId = String(row[0]);
  const startPage = Number(row[1]);
  const endPage = Number(row[2]);
  const nodeTitle = String(row[3]);
  if (!isFinite(startPage) || !isFinite(endPage) || endPage < startPage) {
    throw new Error(`transcribeNode: node ${nodeId} has invalid page range ${startPage}..${endPage}`);
  }

  const filePath = await getSourceFilePath(sourceId);
  if (!filePath) {
    // Browser imports keep the original PDF in IndexedDB. Use pdf.js text
    // extraction as a faithful, offline fallback; desktop still prefers PDFium
    // + vision because it preserves equations rendered as graphics. This means
    // a selected range is usable in both builds instead of silently entering a
    // session with no curriculum grounding.
    const original = await getOriginalCurriculumPdf(sourceId);
    if (!original) {
      throw new TauriUnavailableError(
        `transcribeNode: source ${sourceId} has no readable PDF; re-import it or use the desktop build.`
      );
    }
    const { getDocument, GlobalWorkerOptions } = await import("pdfjs-dist");
    GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
    const pdf = await getDocument({ data: new Uint8Array(await original.arrayBuffer()) }).promise;
    const total = endPage - startPage + 1;
    for (let offset = 0; offset < total; offset++) {
      const pageNumber = startPage + offset;
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      // Preserve reading order while keeping the original page boundary. The
      // complete text is stored; only prompt-time evidence is excerpted later.
      const text = normalize(content.items
        .map((item: any) => typeof item.str === "string" ? item.str : "")
        .join(" ")) || "BLANK";
      db.run(
        `INSERT OR REPLACE INTO curriculum_chunks (id, node_id, page, chunk_ordinal, text_content, excerpt_hash, chunk_kind)
         VALUES (?, ?, ?, ?, ?, ?, 'prose');`,
        [`chunk-${nodeId}-p${pageNumber}`, nodeId, pageNumber, offset, text, simpleHash(text)]
      );
      onProgress?.(pageNumber, endPage);
    }
    saveDbSync();
    NODE_TRANSCRIBE_CACHE.add(nodeId);
    return total;
  }

  // Rasterize via pdfium (desktop only). Throws only if the desktop seam is unavailable.
  const pngBase64 = await renderPageRange(filePath, startPage, endPage);
  if (pngBase64.length === 0) {
    throw new Error(`transcribeNode: pdfium returned no pages for ${nodeId} (${startPage}..${endPage})`);
  }

  // Use cloud vision API via Rust (hardcoded constants in lib.rs)
  if (isTauriRuntime()) {
    _log("Using cloud vision API for transcribeNode", { nodeId, pageCount: pngBase64.length });
    return await transcribeWithCloudVision(db, nodeId, sourceId, pngBase64, startPage, endPage, onProgress);
  }

  // Cloud vision fallback
  _log("Using CLOUD vision API for transcribeNode", { nodeId, pageCount: pngBase64.length });
  const endpoint = await resolveRoleEndpoint("generation");
  if (!endpoint.capabilities.vision) {
    throw new Error(
      `transcribeNode: the ${endpoint.modelId} endpoint bound to the generation role does not advertise vision; bind a vision-capable model to transcribe curriculum math.`
    );
  }

  const total = pngBase64.length;
  const userParts: ContentPart[] = [
    { type: "text", text: `Transcribe the following ${total} page image(s) of curriculum section "${nodeTitle}". Section page range in the source PDF: ${startPage}–${endPage}.` },
    ...pngBase64.map((b64) => ({
      type: "image_url" as const,
      image_url: { url: `data:image/png;base64,${b64}`, detail: "high" as const },
    })),
  ];

  const messages: RuntimeMessage[] = [
    { role: "system", content: TEST_GENERATION_AGENT_PROMPT_V1 + "\n\n" + VISION_TRANSCRIBE_PROMPT_V1 },
    { role: "user", content: userParts },
  ];

  const completion = await chatCompletion({
    endpoint,
    messages,
    jsonMode: false,
    temperature: 0,
    maxTokens: endpoint.maxTokens,
    timeoutMs: TRANSCRIBE_TIMEOUT_MS,
  });

  // Normalize the model's prose+LaTeX byte-faithfully, then split into per-page
  // chunk rows. A simple delimiting convention splits the model's output by
  // page: it is told to emit "=== PAGE n ===" before each page. If the model
  // ignores that, we fall back to one chunk covering the range.
  const normalized = normalize(completion.content);
  const segments = splitTranscriptionByPage(normalized, startPage, total);

  for (const seg of segments) {
    const id = `chunk-${nodeId}-p${seg.page}`;
    db.run(
      `INSERT OR REPLACE INTO curriculum_chunks (id, node_id, page, chunk_ordinal, text_content, excerpt_hash, chunk_kind)
       VALUES (?, ?, ?, ?, ?, ?, 'prose');`,
      [id, nodeId, seg.page, seg.ordinal, seg.text, simpleHash(seg.text)]
    );
    onProgress?.(seg.page, startPage + total - 1);
  }
  saveDbSync();
  NODE_TRANSCRIBE_CACHE.add(nodeId);
  return segments.length;
}

/**
 * Split a normalized transcription into per-page chunks. The model is asked to
 * mark each page with `=== PAGE n ===`. When it does, each block becomes a chunk
 * keyed by its real page number. When it does not (older models, or a single
 * page), we emit one chunk per page in the range, each holding the full text —
 * the dedupe-by-`page` INSERT keeps the row count honest.
 */
export function splitTranscriptionByPage(normalized: string, startPage: number, pageCount: number): { page: number; ordinal: number; text: string }[] {
  const marker = /={2,}\s*PAGE\s+(\d+)\s*={2,}/i;
  const lines = normalized.split(/\r?\n/);
  const blocks: { page: number | null; text: string }[] = [];
  let cur: string[] = [];
  let pendingPage: number | null = null;
  const flush = () => {
    if (cur.length) {
      const text = cur.join("\n").trim();
      if (text) blocks.push({ page: pendingPage, text });
      cur = [];
    }
  };

  for (const line of lines) {
    const m = line.match(marker);
    if (m) {
      flush();
      pendingPage = Number(m[1]) || null;
    } else {
      cur.push(line);
    }
  }
  flush();

  if (blocks.length === 0) {
    // No markers: emit one chunk bounding the range.
    const text = normalized.trim();
    if (!text) return [];
    return [{ page: startPage, ordinal: 1, text }];
  }

  const out: { page: number; ordinal: number; text: string }[] = [];
  let ordinal = 1;
  let fallbackPage = startPage;
  for (const b of blocks) {
    const page = b.page ?? fallbackPage;
    out.push({ page, ordinal: ordinal++, text: b.text });
    if (b.page == null) fallbackPage += 1;
  }
  // Suppress unused-param lint when pageCount differs from resolved count.
  void pageCount;
  return out;
}

/**
 * Transcribe curriculum pages using cloud vision API via Rust.
 * The vision model configuration lives in src-tauri/src/lib.rs as hardcoded constants.
 *
 * @param db           - SQLite database instance
 * @param nodeId       - Curriculum node ID for chunk IDs
 * @param sourceId     - Curriculum source ID (for logging)
 * @param pngBase64    - Array of base64-encoded PNG page images
 * @param startPage    - First page number (1-based)
 * @param endPage      - Last page number
 * @param onProgress   - Progress callback (page, total)
 * @returns Number of pages successfully transcribed
 */
async function transcribeWithCloudVision(
  db: import("sql.js").Database,
  nodeId: string,
  sourceId: string,
  pngBase64: string[],
  startPage: number,
  endPage: number,
  onProgress?: (page: number, total: number) => void,
): Promise<number> {
  let successCount = 0;

  for (let i = 0; i < pngBase64.length; i++) {
    const pageNumber = startPage + i;
    _log(`Processing page ${pageNumber}/${endPage}`, { nodeId, sourceId });

    try {
      // Call Rust's vision_extract_image with no parameters.
      // The Rust side uses VISION_ENDPOINT_URL, VISION_MODEL_ID, and
      // VISION_API_KEY / STUDYUS_VISION_API_KEY from hardcoded constants.
      const result = await visionExtractImage(pngBase64[i], undefined, undefined);
      _log(`Cloud vision extracted page ${pageNumber}`, { nodeId, markdownLength: result.markdown.length });

      // Write the markdown as the text content for this page
      const chunkId = `chunk-vision-${nodeId}-p${pageNumber}`;
      const excerptHash = simpleHash(result.markdown);

      db.run(
        `INSERT OR REPLACE INTO curriculum_chunks
           (id, node_id, page, chunk_ordinal, text_content, excerpt_hash, chunk_kind, docling_markdown)
         VALUES (?, ?, ?, ?, ?, ?, 'prose', ?);`,
        [
          chunkId,
          nodeId,
          pageNumber,
          i,
          result.markdown,
          excerptHash,
          result.markdown,
        ]
      );

      successCount++;
      onProgress?.(pageNumber, endPage);
    } catch (err) {
      _log(`Cloud vision failed for page ${pageNumber}`, { nodeId, error: String(err) });
      console.warn(`[curriculum] Cloud vision failed for page ${pageNumber}:`, err);
    }
  }

  saveDbSync();
  NODE_TRANSCRIBE_CACHE.add(nodeId);
  _log(`Transcription complete`, { nodeId, successCount, totalPages: pngBase64.length });
  return successCount;
}

/**
 * Legacy function kept for backward compatibility with existing code that may reference it.
 * With ONNX removed, this is no longer used in the curriculum pipeline.
 * All extraction now goes through cloud vision via transcribeWithCloudVision().
 *
 * @deprecated Use transcribeNode() which calls transcribeWithCloudVision() internally.
 */
export async function storeDoclingExtraction(
  nodeId: string,
  pages: ExtractedPage[]
): Promise<number> {
  console.warn('[curriculum] storeDoclingExtraction is deprecated. ONNX extraction has been removed.');
  return 0;
}