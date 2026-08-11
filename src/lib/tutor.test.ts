import { describe, it, expect, beforeEach } from "vitest";
import { getDb } from "../db/database";
import { simpleHash } from "./curriculum";
import {
  validateTutorPayload,
  recoverTutorPayload,
  buildTutorEvidenceCards,
  ensureChalkboardSession,
  getSessionThreads,
  recordSessionThread,
  setSessionHintLevel,
  getSessionHintLevel,
  MAX_HINT_LEVEL,
  MAX_BOARD_OPS_PER_TURN,
  MAX_THREAD_INITIAL_BLOCKS,
  type BoardOp,
} from "./tutor";

const EVIDENCE = new Set(["E1", "E2", "E3"]);

function validTurn(overrides: Record<string, unknown> = {}) {
  return {
    speech: "What happens to the velocity when the radius changes?",
    board_ops: [{ op: "write_text", text: "Try changing one variable at a time." }],
    evidence_refs: ["E1"],
    ...overrides,
  };
}

describe("Tutor turn schema validation", () => {
  it("accepts a well-formed Socratic turn", () => {
    const res = validateTutorPayload(validTurn(), EVIDENCE);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.speech).toContain("velocity");
      expect(res.value.boardOps).toHaveLength(1);
      expect(res.value.boardOps[0].op).toBe("write_text");
      expect(res.value.evidenceRefs).toEqual(["E1"]);
    }
  });

  it("accepts every supported board operation", () => {
    const turns: BoardOp[] = [
      { op: "write_title", text: "Orbits" },
      { op: "write_bullets", items: ["a", "b"] },
      { op: "write_latex", tex: "F = mv^2/r", caption: "centripetal" },
      {
        op: "visualize",
        intent: {
          type: "geometry",
          objects: [
            { kind: "point", id: "O", label: "O", at: [0, 0] },
            { kind: "point", id: "A", label: "A", at: [3, 0], draggable: true },
            { kind: "point", id: "B", label: "B", at: [0, 3], draggable: true },
            { kind: "circle", id: "c1", center: "O", through: "A" },
          ],
          actions: ["show_measure"],
        },
      },
      {
        op: "visualize",
        intent: {
          type: "function",
          domainX: [0, 10],
          expressions: [{ id: "f1", expression: "sqrt(x)", label: "v vs r" }],
          actions: ["show_tangent"],
        },
      },
      {
        op: "visualize",
        intent: { type: "equation", latex: "F = \\frac{mv^2}{r}", caption: "centripetal" },
      },
      {
        op: "replace_block",
        targetAnchor: "agent-aaa111",
        block: { kind: "title", text: "Revised orbits" },
      },
      {
        op: "insert_after",
        targetMatchText: "Revised orbits",
        targetKind: "title",
        block: { kind: "text", text: "Inserted after the title." },
      },
      { op: "delete_block", targetIndex: 1 },
      {
        op: "update_visualization",
        targetAnchor: "agent-vis-1",
        statePatch: { pointPositions: { A: [2, 1] } },
      },
      {
        op: "revise_text",
        targetMatchText: "Remember the units",
        targetKind: "callout",
        find: "units",
        replace: "dimensions",
      },
      { op: "write_callout", text: "Remember the units" },
    ];
    const res = validateTutorPayload(validTurn({ board_ops: turns }), EVIDENCE);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.boardOps).toHaveLength(turns.length);
  });

  it("accepts and normalizes a bounded agent thread operation", () => {
    const res = validateTutorPayload(validTurn({
      board_ops: [{
        op: "spawn_thread",
        title: "Alternative derivation",
        reason: "This derivation is useful but would interrupt the current explanation.",
        initial_blocks: [
          { kind: "title", text: "Alternative derivation" },
          { kind: "latex", tex: "F = ma" },
        ],
      }],
    }), EVIDENCE);

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.boardOps).toEqual([{
        op: "spawn_thread",
        title: "Alternative derivation",
        reason: "This derivation is useful but would interrupt the current explanation.",
        initialBlocks: [
          { kind: "title", text: "Alternative derivation" },
          { kind: "latex", tex: "F = ma", caption: undefined },
        ],
      }]);
    }
  });

  it("rejects oversized, malformed, or repeated thread operations", () => {
    const tooManyBlocks = Array.from(
      { length: MAX_THREAD_INITIAL_BLOCKS + 1 },
      (_, index) => ({ kind: "text", text: `Block ${index}` })
    );
    const oversized = validateTutorPayload(validTurn({
      board_ops: [{ op: "spawn_thread", title: "Extra", reason: "Separate investigation", initial_blocks: tooManyBlocks }],
    }), EVIDENCE);
    expect(oversized.ok).toBe(false);
    if (!oversized.ok) expect(oversized.errors.join(" ")).toMatch(/at most 6 blocks/);

    const malformed = validateTutorPayload(validTurn({
      board_ops: [{ op: "spawn_thread", title: "Extra", reason: "Separate investigation", initial_blocks: [{ kind: "html", text: "unsafe" }] }],
    }), EVIDENCE);
    expect(malformed.ok).toBe(false);

    const repeated = validateTutorPayload(validTurn({
      board_ops: [
        { op: "spawn_thread", title: "One", reason: "First investigation", initial_blocks: [] },
        { op: "spawn_thread", title: "Two", reason: "Second investigation", initial_blocks: [] },
      ],
    }), EVIDENCE);
    expect(repeated.ok).toBe(false);
    if (!repeated.ok) expect(repeated.errors.join(" ")).toMatch(/at most one spawn_thread/);
  });

  it("rejects an unknown board operation rather than rendering it", () => {
    const res = validateTutorPayload(validTurn({ board_ops: [{ op: "explode_board", text: "x" }] }), EVIDENCE);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors.join(" ")).toMatch(/board_ops\[0\]\.op must be one of/);
  });

  it("rejects evidence handles that were never supplied", () => {
    const res = validateTutorPayload(validTurn({ evidence_refs: ["E1", "E99"] }), EVIDENCE);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors.join(" ")).toMatch(/E99/);
  });

  it("rejects more board operations than the per-turn bound", () => {
    const ops = Array.from({ length: MAX_BOARD_OPS_PER_TURN + 1 }, () => ({ op: "write_text", text: "x" }));
    const res = validateTutorPayload(validTurn({ board_ops: ops }), EVIDENCE);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors.join(" ")).toMatch(/maximum allowed per turn/);
  });

  it("rejects a requested hint level above the maximum", () => {
    const res = validateTutorPayload(validTurn({ requested_level: MAX_HINT_LEVEL + 1 }), EVIDENCE);
    expect(res.ok).toBe(false);
  });

  it("rejects a turn with no speech", () => {
    const res = validateTutorPayload(validTurn({ speech: "   " }), EVIDENCE);
    expect(res.ok).toBe(false);
  });

  it("validates the optional diagnosis object", () => {
    const res = validateTutorPayload(
      validTurn({
        diagnosis: {
          misconceptions: ["confuses acceleration with velocity"],
          weak_criteria: ["c2"],
          hint_dependence: "high",
          calibration: "over",
        },
      }),
      EVIDENCE
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.diagnosis?.hintDependence).toBe("high");
      expect(res.value.diagnosis?.misconceptions).toHaveLength(1);
    }
  });
});

describe("Tutor turn deterministic recovery", () => {
  it("preserves speech and only independently valid operations and evidence", () => {
    const recovered = recoverTutorPayload({
      speech: "Let's compare the two forces on the board.",
      board_ops: [
        { op: "write_text", text: "Weight points downward." },
        { op: "explode_board", text: "unsafe" },
        { op: "visualize", intent: { type: "chart", chartType: "bar", series: "not-an-array" } },
      ],
      evidence_refs: ["E1", "invented", "E1"],
      diagnosis: { hint_dependence: "sometimes" },
      requested_level: 99,
    }, "", EVIDENCE);

    expect(recovered.speech).toContain("compare the two forces");
    expect(recovered.boardOps).toEqual([{ op: "write_text", text: "Weight points downward." }]);
    expect(recovered.evidenceRefs).toEqual(["E1"]);
    expect(recovered.diagnosis).toBeUndefined();
    expect(recovered.requestedLevel).toBeUndefined();
  });

  it("accepts common camelCase and tool-call wrappers but still validates them", () => {
    const recovered = recoverTutorPayload({
      speech: "I added the key relationship.",
      boardOps: [
        { name: "write_latex", args: { tex: "F = ma" } },
        { name: "unknown_tool", args: { text: "not rendered" } },
      ],
      evidenceRefs: ["E2"],
      requestedLevel: "2",
    }, "", EVIDENCE);

    expect(recovered.boardOps).toEqual([{ op: "write_latex", tex: "F = ma", caption: undefined }]);
    expect(recovered.evidenceRefs).toEqual(["E2"]);
    expect(recovered.requestedLevel).toBe(2);
  });

  it("recovers at most one independently valid spawned thread", () => {
    const recovered = recoverTutorPayload({
      speech: "I separated the optional derivation for later.",
      board_ops: [
        {
          op: "spawn_thread",
          title: "Optional derivation",
          reason: "It is substantial and separable.",
          initial_blocks: [{ kind: "text", text: "Start from conservation of energy." }],
        },
        {
          op: "spawn_thread",
          title: "Duplicate branch",
          reason: "This must not create a second thread in the same turn.",
          initial_blocks: [],
        },
      ],
      evidence_refs: [],
    }, "", new Set());

    expect(recovered.boardOps).toHaveLength(1);
    expect(recovered.boardOps[0]).toMatchObject({ op: "spawn_thread", title: "Optional derivation" });
  });

  it("extracts completed speech from JSON truncated during a later board operation", () => {
    const raw = `{"speech":"Keep the explanation, even if the diagram was truncated.","board_ops":[{"op":"visualize","intent":{"type":"geometry","objects":[`;
    const recovered = recoverTutorPayload(undefined, raw, new Set(), "Draw the diagram");

    expect(recovered.speech).toBe("Keep the explanation, even if the diagram was truncated.");
    expect(recovered.boardOps).toEqual([]);
    expect(recovered.evidenceRefs).toEqual([]);
  });

  it("uses plain provider prose and never returns the technical schema error", () => {
    const recovered = recoverTutorPayload(undefined, "Start by isolating x on the left-hand side.", new Set(), "Help me solve this");
    expect(recovered.speech).toBe("Start by isolating x on the left-hand side.");
    expect(recovered.speech).not.toMatch(/tutor_turn_v2|after 3 attempts|schema/i);
  });

  it("returns a learner-safe continuation even when no prose can be extracted", () => {
    const recovered = recoverTutorPayload(undefined, "{\"board_ops\":[", new Set(), "Help with vectors");
    expect(recovered.speech).toContain("Please resend");
    expect(recovered.speech).not.toMatch(/tutor_turn_v2|after 3 attempts|schema/i);
  });
});

describe("Tutor evidence cards", () => {
  const SOURCE_ID = "tutor-ev-test-src";
  const NODE_ID = "tutor-ev-test-node-1";
  const NODE_ID_2 = "tutor-ev-test-node-2";

  beforeEach(async () => {
    const db = await getDb();
    db.run(`DELETE FROM curriculum_chunks WHERE node_id LIKE 'tutor-ev-test-%';`);
    db.run(`DELETE FROM curriculum_nodes WHERE id LIKE 'tutor-ev-test-%';`);
    db.run(`DELETE FROM curriculum_sources WHERE id = ?;`, [SOURCE_ID]);
    db.run(
      `INSERT OR REPLACE INTO curriculum_sources (id, name, hash, page_count, has_outline, extraction_status, created_at)
       VALUES (?, ?, '', 10, 1, 'authored', '2026-01-01');`,
      [SOURCE_ID, "Tutor Evidence Test"]
    );
    db.run(
      `INSERT OR REPLACE INTO curriculum_nodes
        (id, source_id, parent_node_id, ordinal, depth, title, section_number, start_page, end_page, node_kind, extraction_status, content_hash)
       VALUES
        (?, ?, NULL, 1, 1, 'Derivatives', '2.1', 5, 9, 'section', 'transcribed', ''),
        (?, ?, NULL, 2, 1, 'Limits', '2.2', 10, 14, 'section', 'transcribed', '');`,
      [NODE_ID, SOURCE_ID, NODE_ID_2, SOURCE_ID]
    );
  });

  it("returns no cards when no nodes are bound", async () => {
    expect(await buildTutorEvidenceCards([])).toEqual([]);
  });

  it("returns no cards for bound nodes that have no transcribed chunks", async () => {
    expect(await buildTutorEvidenceCards([NODE_ID])).toEqual([]);
  });

  it("builds one card per chunk with a handle, a section label, and an excerpt", async () => {
    const db = await getDb();
    const texts = [
      "The derivative is $f'(x)=2x$.",
      "Limits describe the local behaviour of a function near a point.",
    ];
    db.run(
      `INSERT OR REPLACE INTO curriculum_chunks (id, node_id, page, chunk_ordinal, text_content, excerpt_hash, chunk_kind)
       VALUES
        ('tutor-ev-chunk-1', ?, 5, 1, ?, ?, 'prose'),
        ('tutor-ev-chunk-2', ?, 7, 1, ?, ?, 'prose');`,
      [NODE_ID, texts[0], simpleHash(texts[0]), NODE_ID_2, texts[1], simpleHash(texts[1])]
    );

    const cards = await buildTutorEvidenceCards([NODE_ID, NODE_ID_2]);
    expect(cards).toHaveLength(2);
    expect(cards.map((c) => c.handle)).toEqual(["E1", "E2"]);
    // Page 5 chunk (node 2.1) sorts before page 7 (node 2.2).
    expect(cards[0].section).toContain("2.1");
    expect(cards[0].section).toContain("Derivatives");
    expect(cards[1].section).toContain("2.2");
    expect(cards[1].section).toContain("Limits");
    expect(cards[0].excerpt).toContain("f'(x)=2x");
    expect(cards[1].excerpt).toContain("Limits describe");
  });
});

describe("Tutor session thread persistence", () => {
  const SESSION_ID = "session-thread-ledger-test";

  beforeEach(async () => {
    const db = await getDb();
    db.run("DELETE FROM chalkboard_sessions WHERE id = ?;", [SESSION_ID]);
    await ensureChalkboardSession({ id: SESSION_ID, title: "Forces", domain: "physics" });
  });

  it("records creator provenance and returns the session thread ledger", async () => {
    const created = await recordSessionThread({
      id: "thread-ledger-test-1",
      sessionId: SESSION_ID,
      boardId: "board-thread-test-1",
      parentBoardId: "board-main-test-1",
      title: "Free-body diagram variants",
      reason: "Compare a second substantial setup without crowding the main board.",
      createdBy: "agent",
      createdAt: "2026-08-11T10:00:00.000Z",
    });

    expect(created.createdBy).toBe("agent");
    expect(await getSessionThreads(SESSION_ID)).toEqual([created]);
  });
});

describe("Tutor session hint level persistence", () => {
  beforeEach(async () => {
    await getDb();
  });

  it("clamps stored hint levels to the allowed range", async () => {
    await ensureChalkboardSession({ id: "session-tutor-test", title: "Orbits", domain: "physics" });
    expect(await getSessionHintLevel("session-tutor-test")).toBe(0);

    await setSessionHintLevel("session-tutor-test", 2);
    expect(await getSessionHintLevel("session-tutor-test")).toBe(2);

    await setSessionHintLevel("session-tutor-test", 99);
    expect(await getSessionHintLevel("session-tutor-test")).toBe(MAX_HINT_LEVEL);
  });
});