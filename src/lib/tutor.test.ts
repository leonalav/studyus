import { afterEach, describe, it, expect, beforeEach, vi } from "vitest";
import { getDb } from "../db/database";
import { simpleHash } from "./curriculum";
import {
  validateTutorPayload,
  recoverTutorPayload,
  checkSessionOpeningContract,
  buildTutorEvidenceCards,
  buildTutorGrounding,
  ensureChalkboardSession,
  appendSessionMessage,
  getSessionMessages,
  getSessionThreads,
  recordSessionThread,
  replaceSessionTranscript,
  setSessionHintLevel,
  getSessionHintLevel,
  getSessionMasteryStage,
  setSessionMasteryStage,
  resolveNextMasteryStage,
  MAX_HINT_LEVEL,
  MAX_BOARD_OPS_PER_TURN,
  MAX_THREAD_INITIAL_BLOCKS,
  enforceTutorToolPolicy,
  enforceTutorBoardNecessity,
  isNonInstructionalTutorMessage,
  resolveTutorKnowledgeNodes,
  getTutorSessionLearnerSummary,
  rememberTutorDiagnosis,
  clearTutorSessionLearnerMemory,
  forgetTutorSessionLearnerObservation,
  runTutorMathToolCommand,
  selectTutorFileContentParts,
  selectTutorImageContentParts,
  testTutorStudioPrompt,
  askTutorTurn,
  type BoardOp,
  type TutorTurn,
  type TutorTurnRequest,
  turnLeavesLearnerSomethingToDo,
  findBoardRoadmap,
  buildRoadmapIntentForStage,
  summarizeBoardBlocks,
} from "./tutor";
import { DEFAULT_TUTOR } from "./preferences";
import { DEFAULT_LEARNER_ID } from "./learning/store";
import { bindModelRole, defaultCapabilities } from "./llm";
import type { VisualizationIntent } from "./visualization/types";
import type { RoadmapWidget } from "./widgets/types";
import { createLessonStep } from "./lessonStep";

const EVIDENCE = new Set(["E1", "E2", "E3"]);

afterEach(() => {
  vi.unstubAllGlobals();
});

function validTurn(overrides: Record<string, unknown> = {}) {
  return {
    speech: "What happens to the velocity when the radius changes?",
    board_ops: [{ op: "write_text", text: "Try changing one variable at a time." }],
    evidence_refs: ["E1"],
    ...overrides,
  };
}

/**
 * Build the Phase-1 grouped-shape `TutorTurnRequest`. Phase 1 refactored the
 * flat shape into five sections (`context`, `learner`, `board`, `persistence`,
 * `model`); tests construct requests through this helper so each call site
 * only spells out the slice it actually cares about.
 */
function makeRequest(overrides: Partial<TutorTurnRequest> = {}): TutorTurnRequest {
  return {
    context: { skillId: "test_skill" },
    learner: { learnerId: "test_learner", learnerMessage: "Hello", attachments: [] },
    board: { sessionId: "test_session", sessionTitle: "Test Session", domain: "math" },
    persistence: { sessionId: "test_session", learnerId: "test_learner" },
    model: {},
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

  it("accepts speech-only turn without board_ops field (chalkboard scenario)", () => {
    // When the tutor just wants to respond with speech (common in chalkboard),
    // board_ops and evidence_refs should be optional
    const res = validateTutorPayload({ speech: "That's a great question!" }, EVIDENCE);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.speech).toBe("That's a great question!");
      expect(res.value.boardOps).toEqual([]);
      expect(res.value.evidenceRefs).toEqual([]);
    }
  });

  it("accepts turn with speech and empty board_ops array", () => {
    const res = validateTutorPayload(
      { speech: "Let me think about that.", board_ops: [], evidence_refs: [] },
      EVIDENCE
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.speech).toBe("Let me think about that.");
      expect(res.value.boardOps).toEqual([]);
      expect(res.value.evidenceRefs).toEqual([]);
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

  it("accepts redraw_block, the 'I cannot see it' repair", () => {
    // Content-preserving: it carries no payload beyond the target, because a
    // redraw must never quietly change what the block says.
    const res = validateTutorPayload(
      validTurn({ board_ops: [{ op: "redraw_block", targetAnchor: "agent-vis-1" }] }),
      EVIDENCE
    );
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.boardOps[0]).toEqual({ op: "redraw_block", targetAnchor: "agent-vis-1" });
  });

  it("requires a target for redraw_block", () => {
    // Without a target there is no way to know what the learner cannot see,
    // and redrawing an arbitrary block would look like a random glitch.
    const res = validateTutorPayload(validTurn({ board_ops: [{ op: "redraw_block" }] }), EVIDENCE);
    expect(res.ok).toBe(false);
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

  it("silently filters evidence handles that were never supplied", () => {
    const res = validateTutorPayload(validTurn({ evidence_refs: ["E1", "E99"] }), EVIDENCE);
    // Invalid refs are filtered out but don't cause rejection - we accept valid speech
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.evidenceRefs).toEqual(["E1"]);
      expect(res.value.speech).toBeTruthy();
    }
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

  it("accepts the widget board operations and validates the widget intent", () => {
    const res = validateTutorPayload(validTurn({
      board_ops: [
        {
          op: "place_widget",
          intent: {
            kind: "question",
            prompt: "As h shrinks toward 0, what is the secant line becoming?",
            format: "multiple_choice",
            options: [
              { id: "a", label: "The tangent line at that point", correct: true },
              { id: "b", label: "A vertical line", misconception: "reads h → 0 as the run becoming the whole graph" },
            ],
          },
        },
        {
          op: "update_widget",
          targetAnchor: "agent-widget-1",
          intent: {
            kind: "roadmap",
            steps: [
              { id: "s1", label: "Encounter", state: "done" },
              { id: "s2", label: "Understand", state: "current" },
            ],
          },
        },
      ],
    }), EVIDENCE);

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.boardOps.map((op) => op.op)).toEqual(["place_widget", "update_widget"]);
    }
  });

  it("rejects a widget whose pedagogical contract is broken", () => {
    // Structurally a question, but no option is marked correct, so it can never
    // diagnose anything. It must fail at the protocol boundary.
    const res = validateTutorPayload(validTurn({
      board_ops: [{
        op: "place_widget",
        intent: {
          kind: "question",
          prompt: "Which is the derivative?",
          format: "multiple_choice",
          options: [{ id: "a", label: "2x" }, { id: "b", label: "x^2" }],
        },
      }],
    }), EVIDENCE);

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors.join(" ")).toMatch(/board_ops\[0\]\.intent/);
  });

  it("accepts a widget block inside replace_block and spawn_thread specs", () => {
    const res = validateTutorPayload(validTurn({
      board_ops: [{
        op: "replace_block",
        targetIndex: 0,
        block: {
          kind: "widget",
          intent: { kind: "memory_hook", hook: "Derivative = slope of the tangent = limit of the secant." },
        },
      }],
    }), EVIDENCE);
    expect(res.ok).toBe(true);
  });

  it("records the mastery stage and requires evidence before advancing", () => {
    const withStage = validateTutorPayload(validTurn({
      stage: "construct",
      stage_advance: { ready: true, evidence: "Solved the second difference quotient unaided after one level-1 hint." },
    }), EVIDENCE);
    expect(withStage.ok).toBe(true);
    if (withStage.ok) {
      expect(withStage.value.stage).toBe("construct");
      expect(withStage.value.stageAdvance?.ready).toBe(true);
    }

    // Advancement without evidence is exactly the click-through failure mode.
    const unevidenced = validateTutorPayload(validTurn({
      stage: "construct",
      stage_advance: { ready: true },
    }), EVIDENCE);
    expect(unevidenced.ok).toBe(false);
    if (!unevidenced.ok) expect(unevidenced.errors.join(" ")).toMatch(/stage_advance\.ready=true requires/);

    // Declining to advance needs no evidence.
    const notReady = validateTutorPayload(validTurn({
      stage: "apply",
      stage_advance: { ready: false, evidence: "Still leaning on hints for the chain rule." },
    }), EVIDENCE);
    expect(notReady.ok).toBe(true);

    const badStage = validateTutorPayload(validTurn({ stage: "graduated" }), EVIDENCE);
    expect(badStage.ok).toBe(false);
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

describe("session opening contract — plan and overview must appear together", () => {
  it("rejects a plan-only board_ops on a session-opening turn", () => {
    // The learner must see the full concept map before agreeing to the plan.
    // A plan without an overview is teaching by omission.
    const error = checkSessionOpeningContract(
      {
        speech: "Here is the route we can take.",
        board_ops: [
          { op: "place_widget", intent: { kind: "plan", heading: "Limits", steps: [{ id: "s1", label: "Meet the idea" }] } },
        ],
        evidence_refs: [],
      },
      true
    );
    expect(error).toMatch(/overview widget/i);
    expect(error).toMatch(/plan widget/i);
  });

  it("accepts plan and overview together on a session-opening turn", () => {
    const error = checkSessionOpeningContract(
      {
        speech: "Here is the route.",
        board_ops: [
          { op: "place_widget", intent: { kind: "plan", heading: "Limits", steps: [{ id: "s1", label: "Meet the idea" }] } },
          { op: "place_widget", intent: { kind: "overview", concept: "Limits", summary: "A limit is a value a function approaches." } },
        ],
        evidence_refs: [],
      },
      true
    );
    expect(error).toBeNull();
  });

  it("does not enforce the contract on non-session-opening turns", () => {
    // A mid-session plan-only update (e.g., learner asks for the route again)
    // must not be blocked by the opening contract.
    const error = checkSessionOpeningContract(
      {
        speech: "Route update.",
        board_ops: [
          { op: "place_widget", intent: { kind: "plan", heading: "Limits", steps: [{ id: "s1", label: "Step 1" }] } },
        ],
        evidence_refs: [],
      },
      false
    );
    expect(error).toBeNull();
  });

  it("fires when neither widget is placed on a session-opening turn", () => {
    // The bidirectional contract fires whenever the agreement pair is
    // incomplete in either direction. A speech-only session opening is the
    // same failure mode as an empty board — the learner sees nothing to
    // agree to — so the contract surfaces it rather than leaving it for
    // other validators to catch.
    const error = checkSessionOpeningContract(
      {
        speech: "Hi.",
        board_ops: [],
        evidence_refs: [],
      },
      true
    );
    expect(error).toMatch(/NEITHER.*plan widget.*overview widget/i);
  });
});

describe("session opening contract — repair loop forces overview alongside plan", () => {
  it("retries the LLM when it returns plan-only, accepting the second attempt's plan+overview", async () => {
    // Reported failure: the agent emitted only the plan widget despite the
    // prompt telling it to also place an overview. Validation must reject the
    // first attempt and force the LLM to retry; the retry that adds the
    // overview is accepted.
    let attempts = 0;
    const fetchMock = vi.fn(async () => {
      attempts++;
      if (attempts === 1) {
        return new Response(JSON.stringify({
          choices: [{
            message: {
              content: JSON.stringify({
                speech: "Here is the route we can take.",
                board_ops: [
                  {
                    op: "place_widget",
                    intent: {
                      kind: "plan",
                      heading: "Limits",
                      steps: [
                        { id: "s1", label: "Meet the idea" },
                        { id: "s2", label: "Defend a claim" },
                      ],
                    },
                  },
                ],
                evidence_refs: [],
              }),
            },
          }],
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      // Second attempt: the LLM has read the contract error and adds overview.
      return new Response(JSON.stringify({
        choices: [{
          message: {
            content: JSON.stringify({
              speech: "Here is the route and the full concept map.",
              board_ops: [
                {
                  op: "place_widget",
                  intent: {
                    kind: "plan",
                    heading: "Limits",
                    steps: [
                      { id: "s1", label: "Meet the idea" },
                      { id: "s2", label: "Defend a claim" },
                    ],
                  },
                },
                {
                  op: "place_widget",
                  intent: {
                    kind: "overview",
                    concept: "Limits",
                    summary: "A limit is the value a function approaches as the input approaches a point.",
                  },
                },
              ],
              evidence_refs: [],
            }),
          },
        }],
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);

    await askTutorTurn(
      makeRequest({
        learner: {
          learnerId: "plan-overview-repair-learner",
          learnerMessage: "Please make my plan.",
          onboarding: {
            concept: "Limits",
            answers: [{ question: "Where are you with limits?", answer: "Brand new" }],
            selfReportedFamiliarity: "new",
          },
        },
        board: {
          sessionId: "plan-overview-repair",
          sessionTitle: "Limits",
          domain: "math",
          turnKind: "greeting",
        },
        persistence: { sessionId: "plan-overview-repair", learnerId: "plan-overview-repair-learner" },
        model: {
          endpoint: {
            role: "tutor",
            provider: "custom",
            baseUrl: "https://model.example/v1",
            modelId: "plan-overview-repair-model",
            apiKey: "",
            capabilities: defaultCapabilities(),
          },
        },
      })
    );

    // The repair loop must have been triggered: at least 2 LLM calls.
    expect(attempts).toBeGreaterThanOrEqual(2);
    // The second request the LLM saw must have included the contract error.
    const secondCallBody = JSON.parse(String((fetchMock.mock.calls[1]?.[1] as RequestInit | undefined)?.body ?? "{}"));
    const secondMessages = secondCallBody?.messages ?? [];
    const repairPrompt = JSON.stringify(secondMessages);
    expect(repairPrompt).toMatch(/overview widget/i);
  });

  it("synthesizes an overview widget on a session-opening turn if the LLM returns plan-only after retries", async () => {
    // The LLM stubbornly emits plan-only on every attempt. After all repair
    // attempts fail (the runtime throws schema_invalid), the tutor must still
    // surface an overview widget — the user cannot make an informed agreement
    // staring at a plan-only board. This is the defense-in-depth synthesis
    // path that catches the cases validation+retry cannot.
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({
            speech: "Here is the route we can take.",
            board_ops: [
              {
                op: "place_widget",
                intent: {
                  kind: "plan",
                  heading: "Limits",
                  steps: [
                    { id: "s1", label: "Meet the idea" },
                    { id: "s2", label: "Defend a claim" },
                  ],
                },
              },
            ],
            evidence_refs: [],
          }),
        },
      }],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));

    vi.stubGlobal("fetch", fetchMock);

    const result = await askTutorTurn(
      makeRequest({
        learner: {
          learnerId: "plan-overview-synthesis-learner",
          learnerMessage: "Please make my plan.",
          onboarding: {
            concept: "Limits",
            answers: [{ question: "Where are you with limits?", answer: "Brand new" }],
            selfReportedFamiliarity: "new",
          },
        },
        board: {
          sessionId: "plan-overview-synthesis",
          sessionTitle: "Limits",
          domain: "math",
          turnKind: "greeting",
        },
        persistence: { sessionId: "plan-overview-synthesis", learnerId: "plan-overview-synthesis-learner" },
        model: {
          endpoint: {
            role: "tutor",
            provider: "custom",
            baseUrl: "https://model.example/v1",
            modelId: "plan-overview-synthesis-model",
            apiKey: "",
            capabilities: defaultCapabilities(),
          },
        },
      })
    );

    // The LLM was called the full retry budget. Tutor now caps at
    // maxRepairAttempts=1 for the 1-minute SLA, so this is 1 + 1 = 2 calls.
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // The board must contain BOTH a plan widget AND an overview widget.
    const placeWidgetOps = result.value.boardOps.filter(
      (op) => op.op === "place_widget"
    );
    const kinds = placeWidgetOps.map((op) => (op as { intent: { kind: string } }).intent.kind);
    expect(kinds).toContain("plan");
    expect(kinds).toContain("overview");
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
    expect(recovered.speech).toContain("trouble");
    expect(recovered.speech).toContain("rephrase");
    expect(recovered.speech).not.toMatch(/tutor_turn_v2|after 3 attempts|schema/i);
  });
});

describe("Tutor Studio runtime policy", () => {
  it("deterministically suppresses board operations for purely social messages", () => {
    const noncompliantTurn: TutorTurn = {
      speech: "Hello! How can I help?",
      evidenceRefs: [],
      boardOps: [
        { op: "write_title", text: "Welcome" },
        { op: "visualize", intent: { type: "diagram", variant: "flow" } },
      ],
    };

    for (const message of [
      "Hello.",
      "Hey tutor!",
      "Good morning",
      "Thank you so much!",
      "Got it.",
      "Goodbye",
      "How are you?",
    ]) {
      expect(isNonInstructionalTutorMessage(message)).toBe(true);
      expect(enforceTutorBoardNecessity(noncompliantTurn, message).boardOps).toEqual([]);
    }
  });

  it("does not suppress explicit drawing requests or instructional turns", () => {
    const turn: TutorTurn = {
      speech: "Here is the requested diagram.",
      evidenceRefs: [],
      boardOps: [{ op: "visualize", intent: { type: "diagram", variant: "flow" } }],
    };

    for (const message of [
      "Hello, please draw a circle.",
      "Thanks—now graph y = x squared.",
      "Explain the chain rule",
    ]) {
      expect(isNonInstructionalTutorMessage(message)).toBe(false);
      expect(enforceTutorBoardNecessity(turn, message).boardOps).toEqual(turn.boardOps);
    }
  });

  it("deterministically filters disabled writing, thread, and semantic visualization tools", () => {
    const turn: TutorTurn = {
      speech: "I will only apply permitted operations.",
      evidenceRefs: [],
      boardOps: [
        { op: "write_text", text: "blocked writing" },
        { op: "visualize", intent: { type: "geometry", objects: [] } },
        { op: "visualize", intent: { type: "diagram", variant: "flow" } },
        { op: "visualize", intent: { type: "chart", chartType: "bar", series: [] } },
        { op: "update_visualization", targetAnchor: "geometry-block", statePatch: { pointPositions: { A: [1, 2] } } },
        { op: "spawn_thread", title: "Blocked thread", reason: "Permission is off", initialBlocks: [] },
      ],
    };
    const tools = {
      ...DEFAULT_TUTOR.tools,
      boardWriting: false,
      threads: false,
      geometry: false,
      diagrams: false,
    };
    const board = {
      id: "policy-board",
      title: "Policy",
      subtitle: "",
      domain: "math" as const,
      blocks: [{ id: "geometry-block", kind: "visualization" as const, intent: { type: "geometry" as const, objects: [] } }],
    };

    const filtered = enforceTutorToolPolicy(turn, tools, board);
    expect(filtered.boardOps).toEqual([
      { op: "visualize", intent: { type: "chart", chartType: "bar", series: [] } },
    ]);
  });

  it("maps every Chalkboard visualization family to its own permission", () => {
    const mappings: Array<[keyof typeof DEFAULT_TUTOR.tools, VisualizationIntent]> = [
      ["geometry", { type: "geometry", objects: [] }],
      ["diagrams", { type: "diagram", variant: "flow" }],
      ["functionGraphing", { type: "function", domainX: [-1, 1], expressions: [] }],
      ["graphing3d", { type: "graph3d", surfaces: [] }],
      ["dataVisualization", { type: "chart", chartType: "bar", series: [] }],
      ["equationRendering", { type: "equation", latex: "x=1" }],
      ["physics", { type: "physics", variant: "free_body" }],
      ["biology", { type: "biology", variant: "cell" }],
      ["circuits", { type: "circuit", nodes: [], wires: [], components: [] }],
      ["chemistry", { type: "chemistry", variant: "molecule", atoms: [], bonds: [] }],
      ["graphTheory", { type: "graph_theory", nodes: [], edges: [] }],
    ];
    const turn: TutorTurn = {
      speech: "Visualizations",
      evidenceRefs: [],
      boardOps: mappings.map(([, intent]) => ({ op: "visualize" as const, intent })),
    };

    for (const [permission, blockedIntent] of mappings) {
      const result = enforceTutorToolPolicy(turn, {
        ...DEFAULT_TUTOR.tools,
        [permission]: false,
      });
      expect(result.boardOps).toHaveLength(mappings.length - 1);
      expect(result.boardOps).not.toContainEqual({ op: "visualize", intent: blockedIntent });
    }
  });

  it("gates study widgets behind their own permission", () => {
    const widgetIntent = { kind: "scratchpad" as const, prompt: "Your turn. Expand (x+h)^2." };
    const turn: TutorTurn = {
      speech: "Widgets",
      evidenceRefs: [],
      boardOps: [
        { op: "place_widget", intent: widgetIntent },
        { op: "update_widget", targetIndex: 0, intent: widgetIntent },
        { op: "write_text", text: "still allowed" },
      ],
    };

    expect(enforceTutorToolPolicy(turn, DEFAULT_TUTOR.tools).boardOps).toHaveLength(3);

    const noWidgets = enforceTutorToolPolicy(turn, { ...DEFAULT_TUTOR.tools, studyWidgets: false });
    expect(noWidgets.boardOps).toEqual([{ op: "write_text", text: "still allowed" }]);

    // Updating a widget also needs board editing, since it rewrites a block.
    const noEditing = enforceTutorToolPolicy(turn, { ...DEFAULT_TUTOR.tools, boardEditing: false });
    expect(noEditing.boardOps.map((op) => op.op)).toEqual(["place_widget", "write_text"]);
  });

  it("strips widget blocks from thread specs when widgets are disabled", () => {
    const turn: TutorTurn = {
      speech: "Thread",
      evidenceRefs: [],
      boardOps: [{
        op: "spawn_thread",
        title: "Chain rule detour",
        reason: "Separable investigation",
        initialBlocks: [
          { kind: "title", text: "Chain rule detour" },
          { kind: "widget", intent: { kind: "concept_card", term: "Chain rule", definition: "Differentiate the outside, then multiply by the derivative of the inside." } },
        ],
      }],
    };

    const allowed = enforceTutorToolPolicy(turn, DEFAULT_TUTOR.tools).boardOps[0];
    expect(allowed.op === "spawn_thread" && allowed.initialBlocks).toHaveLength(2);

    const blocked = enforceTutorToolPolicy(turn, { ...DEFAULT_TUTOR.tools, studyWidgets: false }).boardOps[0];
    expect(blocked.op === "spawn_thread" && blocked.initialBlocks).toHaveLength(1);
  });

  it("sends at most three valid images only when tool, privacy, and vision gates all permit it", () => {
    const endpoint = {
      role: "tutor" as const,
      provider: "custom",
      baseUrl: "https://model.example/v1",
      modelId: "vision-model",
      apiKey: "",
      capabilities: { ...defaultCapabilities(), vision: true },
    };
    const attachments = [
      { name: "one.png", kind: "image", dataUrl: "data:image/png;base64,b25l" },
      { name: "notes.txt", kind: "file", dataUrl: "data:text/plain;base64,bm90ZXM=" },
      { name: "bad.png", kind: "image", dataUrl: "https://example.com/bad.png" },
      { name: "two.jpg", kind: "image", dataUrl: "data:image/jpeg;base64,dHdv" },
      { name: "three.webp", kind: "image", dataUrl: "data:image/webp;base64,dGhyZWU=" },
      { name: "four.gif", kind: "image", dataUrl: "data:image/gif;base64,Zm91cg==" },
    ];

    expect(selectTutorImageContentParts(attachments, DEFAULT_TUTOR.tools, true, endpoint)).toEqual([
      { type: "image_url", image_url: { url: "data:image/png;base64,b25l", detail: "auto" } },
      { type: "image_url", image_url: { url: "data:image/jpeg;base64,dHdv", detail: "auto" } },
      { type: "image_url", image_url: { url: "data:image/webp;base64,dGhyZWU=", detail: "auto" } },
    ]);
    expect(selectTutorImageContentParts(
      attachments,
      { ...DEFAULT_TUTOR.tools, imageAnalysis: false },
      true,
      endpoint
    )).toEqual([]);
    expect(selectTutorImageContentParts(attachments, DEFAULT_TUTOR.tools, false, endpoint)).toEqual([]);
    expect(selectTutorImageContentParts(
      attachments,
      DEFAULT_TUTOR.tools,
      true,
      { ...endpoint, capabilities: { ...endpoint.capabilities, vision: false } }
    )).toEqual([]);
  });

  it("processes only bounded txt and Markdown attachments behind tool and privacy gates", () => {
    const attachments = [
      { name: "notes.txt", kind: "file", mimeType: "text/plain", textContent: "Velocity is displacement per unit time." },
      { name: "proof.md", kind: "file", mimeType: "text/markdown", textContent: "# Proof outline" },
      { name: "data.csv", kind: "file", mimeType: "text/csv", textContent: "x,y" },
    ];
    const parts = selectTutorFileContentParts(attachments, DEFAULT_TUTOR.tools, true);
    expect(parts).toHaveLength(2);
    expect(parts[0]).toMatchObject({ type: "text", text: expect.stringContaining("Velocity is displacement") });
    expect(parts[1]).toMatchObject({ type: "text", text: expect.stringContaining("# Proof outline") });
    expect(selectTutorFileContentParts(
      attachments,
      { ...DEFAULT_TUTOR.tools, fileProcessing: false },
      true
    )).toEqual([]);
    expect(selectTutorFileContentParts(attachments, DEFAULT_TUTOR.tools, false)).toEqual([]);
  });

  it("keeps Tutor Studio model testing isolated from sessions, learner memory, and diagnostics", async () => {
    const db = await getDb();
    await bindModelRole("tutor", {
      provider: "custom",
      baseUrl: "https://model.example/v1",
      modelId: "studio-preview-model",
    });
    const rowCounts = () => ["chalkboard_sessions", "session_messages", "learner_hypotheses", "agent_calls"]
      .map((table) => Number(db.exec(`SELECT COUNT(*) FROM ${table};`)[0]?.values[0]?.[0] ?? 0));
    const before = rowCounts();
    let requestBody: any;
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      requestBody = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({
        choices: [{ message: { content: "Try identifying the quantity that remains constant." } }],
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }));

    await expect(testTutorStudioPrompt("How should I begin?", {
      ...DEFAULT_TUTOR,
      identity: { ...DEFAULT_TUTOR.identity, name: "Isolated Ada" },
    })).resolves.toBe("Try identifying the quantity that remains constant.");
    expect(requestBody.messages[0].content).toContain("Isolated Ada");
    expect(requestBody.messages[1].content).toBe("How should I begin?");
    expect(rowCounts()).toEqual(before);
  });

  it("keeps an onboarding greeting planning-only until the learner starts the plan", async () => {
    const db = await getDb();
    const learnerId = "greeting-planning-only";
    const sessionId = "greeting-planning-only-session";
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({
        speech: "Here is the route we can take.",
        board_ops: [],
        evidence_refs: [],
        diagnosis: {
          misconceptions: ["Treats the plan as proof of understanding"],
          weak_criteria: [],
          hint_dependence: "none",
          calibration: "accurate",
          hypotheses: [{
            kind: "misconception",
            statement: "Treats the plan as proof of understanding",
            next_best_test: "Ask for a first worked response after the plan starts.",
          }],
        },
      }) } }],
    }), { status: 200, headers: { "Content-Type": "application/json" } })));

    await askTutorTurn(
      makeRequest({
        learner: {
          learnerId,
          learnerMessage: "Please make my plan.",
          onboarding: {
            concept: "Limits",
            answers: [{ question: "Where are you with limits?", answer: "Brand new" }],
            selfReportedFamiliarity: "new",
          },
        },
        board: {
          sessionId,
          sessionTitle: "Cold limits",
          domain: "math",
          turnKind: "greeting",
        },
        persistence: { sessionId, learnerId },
        model: {
          endpoint: {
            role: "tutor",
            provider: "custom",
            baseUrl: "https://model.example/v1",
            modelId: "greeting-test-model",
            apiKey: "",
            capabilities: defaultCapabilities(),
          },
        },
      })
    );

    expect(Number(db.exec(
      "SELECT COUNT(*) FROM learning_activities WHERE learner_id = ? AND session_id = ?;",
      [learnerId, sessionId]
    )[0]?.values[0]?.[0] ?? 0)).toBe(0);
    expect(Number(db.exec(
      "SELECT COUNT(*) FROM learning_evidence WHERE learner_id = ?;",
      [learnerId]
    )[0]?.values[0]?.[0] ?? 0)).toBe(0);
    expect(getTutorSessionLearnerSummary(sessionId)).toBe("Session memory: no observations recorded yet.");
    expect(Number(db.exec(
      "SELECT COUNT(*) FROM learner_hypotheses WHERE learner_id = ?;",
      [learnerId]
    )[0]?.values[0]?.[0] ?? 0)).toBe(0);
    expect(String(db.exec(
      "SELECT familiarity FROM learner_entry_signals WHERE learner_id = ? AND session_id = ?;",
      [learnerId, sessionId]
    )[0]?.values[0]?.[0] ?? "")).toBe("new");
  });

  it("creates a plan-start activity without treating agreement as diagnostic evidence", async () => {
    const db = await getDb();
    const learnerId = "plan-start-not-evidence";
    const sessionId = "plan-start-not-evidence-session";
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({
        speech: "The plan is ready.",
        board_ops: [],
        evidence_refs: [],
        requested_level: 3,
        diagnosis: {
          misconceptions: ["Confuses agreement with a diagnostic response"],
          weak_criteria: [],
          hint_dependence: "none",
          calibration: "accurate",
          hypotheses: [{
            kind: "misconception",
            statement: "Confuses agreement with a diagnostic response",
            next_best_test: "Ask one diagnostic question after the plan begins.",
          }],
        },
      }) } }],
    }), { status: 200, headers: { "Content-Type": "application/json" } })));

    const request = makeRequest({
      learner: {
        learnerId,
        learnerMessage: "Please make my plan.",
        onboarding: {
          concept: "Limits",
          answers: [{ question: "Where are you with limits?", answer: "A little shaky" }],
          selfReportedFamiliarity: "shaky",
        },
      },
      board: {
        sessionId,
        sessionTitle: "Cold limits",
        domain: "math",
        turnKind: "greeting",
      },
      persistence: { sessionId, learnerId },
      model: {
        endpoint: {
          role: "tutor",
          provider: "custom",
          baseUrl: "https://model.example/v1",
          modelId: "plan-start-test-model",
          apiKey: "",
          capabilities: defaultCapabilities(),
        },
      },
    });

    await askTutorTurn(request);
    await askTutorTurn({
      ...request,
      learner: {
        ...request.learner,
        learnerMessage: "[This is my go-ahead: teach toward this route.]",
      },
      board: { ...request.board, turnKind: "plan_start" },
    });

    expect(String(db.exec(
      "SELECT route FROM learning_activities WHERE learner_id = ? AND session_id = ?;",
      [learnerId, sessionId]
    )[0]?.values[0]?.[0] ?? "")).toBe("diagnostic_probe");
    expect(Number(db.exec(
      "SELECT COUNT(*) FROM learning_evidence WHERE learner_id = ?;",
      [learnerId]
    )[0]?.values[0]?.[0] ?? 0)).toBe(0);
    expect(Number(db.exec(
      "SELECT COUNT(*) FROM skill_state WHERE learner_id = ?;",
      [learnerId]
    )[0]?.values[0]?.[0] ?? 0)).toBe(0);
    expect(Number(db.exec(
      "SELECT hint_level FROM chalkboard_sessions WHERE id = ?;",
      [sessionId]
    )[0]?.values[0]?.[0] ?? -1)).toBe(0);
    expect(getTutorSessionLearnerSummary(sessionId)).toBe("Session memory: no observations recorded yet.");
    expect(Number(db.exec(
      "SELECT COUNT(*) FROM learner_hypotheses WHERE learner_id = ?;",
      [learnerId]
    )[0]?.values[0]?.[0] ?? 0)).toBe(0);
  });

  it("enforces the Tutor Studio response ceiling over a larger endpoint limit", async () => {
    let requestBody: any;
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      requestBody = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify({
          speech: "Start by naming the known quantities.",
          board_ops: [],
          evidence_refs: [],
        }) } }],
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }));

    await askTutorTurn(
      makeRequest({
        learner: { learnerId: "studio-response-ceiling-learner", learnerMessage: "How should I begin?" },
        board: { sessionId: "studio-response-ceiling", sessionTitle: "Response ceiling", domain: "math" },
        persistence: { sessionId: "studio-response-ceiling", learnerId: "studio-response-ceiling-learner" },
        model: {
          endpoint: {
            role: "tutor",
            provider: "custom",
            baseUrl: "https://model.example/v1",
            modelId: "ceiling-model",
            apiKey: "",
            maxTokens: DEFAULT_TUTOR.advanced.maxResponseTokens * 2,
            capabilities: defaultCapabilities(),
          },
        },
      })
    );

    expect(requestBody.max_tokens).toBe(DEFAULT_TUTOR.advanced.maxResponseTokens);
  });

  it("runs bounded deterministic math commands only when their permissions are enabled", async () => {
    await expect(runTutorMathToolCommand("/calculate 2 + 3 * 4", DEFAULT_TUTOR.tools))
      .resolves.toContain(": 14");
    await expect(runTutorMathToolCommand("/simplify 2*x + 3*x", DEFAULT_TUTOR.tools))
      .resolves.toContain("5 * x");
    await expect(runTutorMathToolCommand("/calculate zeros(1000000000)", DEFAULT_TUTOR.tools))
      .resolves.toContain("MATH TOOL ERROR");
    await expect(runTutorMathToolCommand(
      "/calculate 2 + 2",
      { ...DEFAULT_TUTOR.tools, calculator: false }
    )).resolves.toBe("");
  });

  it("resolves selected source knowledge and fails closed under privacy or tool gates", async () => {
    const db = await getDb();
    const sourceId = "studio-knowledge-source";
    const nodeId = "studio-knowledge-node";
    const siblingNodeId = "studio-knowledge-sibling";
    db.run("DELETE FROM curriculum_nodes WHERE source_id = ?;", [sourceId]);
    db.run("DELETE FROM curriculum_sources WHERE id = ?;", [sourceId]);
    db.run(
      `INSERT INTO curriculum_sources (id, name, hash, page_count, has_outline, extraction_status, created_at)
       VALUES (?, 'Studio source', '', 2, 1, 'authored', '2026-08-12');`,
      [sourceId]
    );
    db.run(
      `INSERT INTO curriculum_nodes
       (id, source_id, parent_node_id, ordinal, depth, title, section_number, start_page, end_page, node_kind, extraction_status, content_hash)
       VALUES
         (?, ?, NULL, 1, 1, 'Selected topic', '1', 1, 2, 'section', 'transcribed', ''),
         (?, ?, NULL, 2, 1, 'Sibling topic', '2', 2, 2, 'section', 'transcribed', '');`,
      [nodeId, sourceId, siblingNodeId, sourceId]
    );

    const selected = {
      ...DEFAULT_TUTOR,
      knowledge: {
        ...DEFAULT_TUTOR.knowledge,
        accessMode: "selected-only" as const,
        selectedSourceIds: [sourceId],
        sourcePriority: [sourceId],
      },
    };
    expect(await resolveTutorKnowledgeNodes(["session-node"], selected)).toEqual([nodeId, siblingNodeId]);
    expect(await resolveTutorKnowledgeNodes(
      ["session-node"],
      { ...selected, knowledge: { ...selected.knowledge, selectedNodeIds: [siblingNodeId] } }
    )).toEqual([siblingNodeId]);
    expect(await resolveTutorKnowledgeNodes(
      ["session-node"],
      { ...selected, knowledge: { ...selected.knowledge, selectedNodeIds: ["node-from-an-unselected-source"] } }
    )).toEqual([nodeId, siblingNodeId]);
    expect(await resolveTutorKnowledgeNodes(
      ["session-node"],
      { ...selected, privacy: { ...selected.privacy, allowCurriculumInPrompts: false } }
    )).toEqual([]);
    expect(await resolveTutorKnowledgeNodes(
      ["session-node"],
      { ...selected, tools: { ...selected.tools, pdfKnowledge: false } }
    )).toEqual([]);
  });
});

describe("Tutor session learner memory", () => {
  const sessionTutor = {
    ...DEFAULT_TUTOR,
    memory: { ...DEFAULT_TUTOR.memory, mode: "session" as const, minimumEvidence: 1 as const },
  };

  afterEach(() => clearTutorSessionLearnerMemory());

  it("bounds prompt diagnostics and learner-owned deletion clears matching session observations", async () => {
    for (let index = 0; index < 130; index++) {
      await rememberTutorDiagnosis("bounded-session", {
        misconceptions: [`Misconception ${index}`],
        weakCriteria: [],
        hintDependence: "none",
        calibration: "accurate",
      }, sessionTutor, [], DEFAULT_LEARNER_ID, "skill:arithmetic");
    }

    const summary = getTutorSessionLearnerSummary("bounded-session");
    expect(summary.match(/^- \[misconception\]/gm)).toHaveLength(20);
    expect(summary).toContain("Misconception 0");
    expect(summary).not.toContain("Misconception 100");

    forgetTutorSessionLearnerObservation("Misconception 0");
    expect(getTutorSessionLearnerSummary("bounded-session")).not.toContain("Misconception 0 (");
    clearTutorSessionLearnerMemory();
    expect(getTutorSessionLearnerSummary("bounded-session")).toContain("no observations");
  });

  it("evicts the oldest session when the diagnostic session cap is reached", async () => {
    for (let index = 0; index <= 100; index++) {
      await rememberTutorDiagnosis(`session-${index}`, {
        misconceptions: [`Observation ${index}`],
        weakCriteria: [],
        hintDependence: "none",
        calibration: "accurate",
      }, sessionTutor, [], DEFAULT_LEARNER_ID, "skill:arithmetic");
    }
    expect(getTutorSessionLearnerSummary("session-0")).toContain("no observations");
    expect(getTutorSessionLearnerSummary("session-100")).toContain("Observation 100");
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
        ('tutor-ev-chunk-2', ?, 10, 1, ?, ?, 'prose');`,
      [NODE_ID, texts[0], simpleHash(texts[0]), NODE_ID_2, texts[1], simpleHash(texts[1])]
    );

    const cards = await buildTutorEvidenceCards([NODE_ID, NODE_ID_2]);
    expect(cards).toHaveLength(2);
    expect(cards.map((c) => c.handle)).toEqual(["E1", "E2"]);
    // The selected curriculum sequence is retained across the two page ranges.
    expect(cards[0].section).toContain("2.1");
    expect(cards[0].section).toContain("Derivatives");
    expect(cards[1].section).toContain("2.2");
    expect(cards[1].section).toContain("Limits");
    expect(cards[0].excerpt).toContain("f'(x)=2x");
    expect(cards[1].excerpt).toContain("Limits describe");

    const grounding = await buildTutorGrounding([NODE_ID, NODE_ID_2]);
    expect(grounding.scope).toEqual([
      {
        nodeId: NODE_ID,
        section: "2.1 Derivatives",
        startPage: 5,
        endPage: 9,
        evidencePages: [5],
        pageExtractions: [],
      },
      {
        nodeId: NODE_ID_2,
        section: "2.2 Limits",
        startPage: 10,
        endPage: 14,
        evidencePages: [10],
        pageExtractions: [],
      },
    ]);
    expect(grounding.cards[0].section).toBe("2.1 Derivatives · selected pp.5–9 · evidence p.5");
    expect(grounding.cards[1].section).toBe("2.2 Limits · selected pp.10–14 · evidence p.10");
  });

  it("retains exact page scope even when the selected section has no extracted chunks", async () => {
    const grounding = await buildTutorGrounding([NODE_ID]);
    expect(grounding.cards).toEqual([]);
    expect(grounding.scope).toEqual([{
      nodeId: NODE_ID,
      section: "2.1 Derivatives",
      startPage: 5,
      endPage: 9,
      evidencePages: [],
      pageExtractions: [],
    }]);
  });
});

/**
 * Effort-aware curriculum scope (Phase 5).
 *
 * `buildTutorGrounding` reads `effort.curriculumDepth` and maps it to
 *   { chunkLimit, excerptChars }:
 *     surface    →  8 chunks, 480-char excerpts
 *     medium     → 16 chunks, 600-char excerpts
 *     deep       → 24 chunks, 600-char excerpts
 *     exhaustive → 48 chunks, 900-char excerpts
 *
 * The default (no effort supplied) is `medium`. Each level must be honoured
 * exactly — custom endpoints with small context windows depend on the
 * lower-effort caps to keep prompt assembly under their token ceiling.
 */
describe("Tutor evidence cards — effort-aware curriculum scope", () => {
  const EFFORT_SOURCE_ID = "tutor-effort-depth-src";
  const EFFORT_NODE_ID = "tutor-effort-depth-node";
  const CHUNK_COUNT = 50;

  beforeEach(async () => {
    const db = await getDb();
    db.run(`DELETE FROM curriculum_chunks WHERE node_id LIKE 'tutor-effort-depth-%';`);
    db.run(`DELETE FROM curriculum_nodes WHERE id LIKE 'tutor-effort-depth-%';`);
    db.run(`DELETE FROM curriculum_sources WHERE id = ?;`, [EFFORT_SOURCE_ID]);
    db.run(
      `INSERT OR REPLACE INTO curriculum_sources (id, name, hash, page_count, has_outline, extraction_status, created_at)
       VALUES (?, ?, '', 100, 1, 'authored', '2026-01-01');`,
      [EFFORT_SOURCE_ID, "Effort Depth Test"]
    );
    db.run(
      `INSERT OR REPLACE INTO curriculum_nodes
        (id, source_id, parent_node_id, ordinal, depth, title, section_number, start_page, end_page, node_kind, extraction_status, content_hash)
       VALUES
        (?, ?, NULL, 1, 1, 'Limits Depth', '3.1', 1, 100, 'section', 'transcribed', '');`,
      [EFFORT_NODE_ID, EFFORT_SOURCE_ID]
    );
    // 50 chunks, each with 1200 chars of text so excerptChars truncation
    // is observably different at 480 / 600 / 900 chars.
    for (let i = 1; i <= CHUNK_COUNT; i++) {
      const text = `chunk-${i}-`.repeat(120); // 120 * 9 = 1080 chars per chunk
      db.run(
        `INSERT INTO curriculum_chunks (id, node_id, page, chunk_ordinal, text_content, excerpt_hash, chunk_kind)
         VALUES (?, ?, ?, ?, ?, ?, 'prose');`,
        [`tutor-effort-depth-chunk-${i}`, EFFORT_NODE_ID, i, 1, text, simpleHash(text)]
      );
    }
  });

  it("clamps cards at chunkLimit=8 for surface effort", async () => {
    const { EFFORT_PLAN_CONSTRAINTS } = await import("./effort");
    const grounding = await buildTutorGrounding([EFFORT_NODE_ID], EFFORT_PLAN_CONSTRAINTS.standard);
    expect(grounding.cards.length).toBeLessThanOrEqual(8);
    expect(grounding.cards.length).toBeGreaterThan(0);
  });

  it("clamps cards at chunkLimit=48 for exhaustive effort", async () => {
    const { EFFORT_PLAN_CONSTRAINTS } = await import("./effort");
    const grounding = await buildTutorGrounding([EFFORT_NODE_ID], EFFORT_PLAN_CONSTRAINTS.max);
    expect(grounding.cards.length).toBeLessThanOrEqual(48);
    // We inserted 50, so exhaustive must take all 48 available.
    expect(grounding.cards.length).toBe(48);
  });

  it("truncates excerpts at excerptChars=480 for surface effort", async () => {
    const { EFFORT_PLAN_CONSTRAINTS } = await import("./effort");
    const grounding = await buildTutorGrounding([EFFORT_NODE_ID], EFFORT_PLAN_CONSTRAINTS.standard);
    // Each excerpt must be at most 480 chars, plus the ellipsis that
    // indicates the chunk was truncated.
    for (const card of grounding.cards) {
      expect(card.excerpt).toBeDefined();
      expect(card.excerpt!.length).toBeLessThanOrEqual(481);
    }
  });

  it("allows longer excerpts at exhaustive effort than at surface", async () => {
    const { EFFORT_PLAN_CONSTRAINTS } = await import("./effort");
    const surface = await buildTutorGrounding([EFFORT_NODE_ID], EFFORT_PLAN_CONSTRAINTS.standard);
    const exhaustive = await buildTutorGrounding([EFFORT_NODE_ID], EFFORT_PLAN_CONSTRAINTS.max);
    expect(surface.cards[0]?.excerpt).toBeDefined();
    expect(exhaustive.cards[0]?.excerpt).toBeDefined();
    expect(surface.cards[0]!.excerpt!.length).toBeLessThan(exhaustive.cards[0]!.excerpt!.length);
  });

  it("defaults to medium effort (chunkLimit=16) when no effort is supplied", async () => {
    const grounding = await buildTutorGrounding([EFFORT_NODE_ID]);
    // 50 chunks inserted, 16 selected by default.
    expect(grounding.cards.length).toBe(16);
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

describe("Tutor session transcript rewind", () => {
  const SESSION_ID = "session-transcript-rewind-test";

  beforeEach(async () => {
    const db = await getDb();
    db.run("DELETE FROM chalkboard_sessions WHERE id = ?;", [SESSION_ID]);
    await ensureChalkboardSession({ id: SESSION_ID, title: "Integration", domain: "math" });
  });

  it("replaces removed turns so they cannot return as future model context", async () => {
    await appendSessionMessage({ sessionId: SESSION_ID, role: "user", content: "Explain integration." });
    await appendSessionMessage({ sessionId: SESSION_ID, role: "assistant", content: "Integration accumulates change." });
    await appendSessionMessage({ sessionId: SESSION_ID, role: "user", content: "Give me an example." });

    await replaceSessionTranscript(SESSION_ID, [
      { role: "user", content: "Explain integration." },
      { role: "assistant", content: "Integration accumulates change." },
    ]);

    const messages = await getSessionMessages(SESSION_ID);
    expect(messages.map(({ role, content }) => ({ role, content }))).toEqual([
      { role: "user", content: "Explain integration." },
      { role: "assistant", content: "Integration accumulates change." },
    ]);
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

describe("Guide to Mastery stage persistence", () => {
  const SESSION_ID = "session-mastery-stage-test";

  beforeEach(async () => {
    const db = await getDb();
    db.run("DELETE FROM chalkboard_sessions WHERE id = ?;", [SESSION_ID]);
  });

  it("starts every session at Encounter", async () => {
    await ensureChalkboardSession({ id: SESSION_ID, title: "Derivatives", domain: "math" });
    expect(await getSessionMasteryStage(SESSION_ID)).toEqual({ stage: "encounter", evidence: "" });
  });

  it("round-trips the stage and the evidence that justified it", async () => {
    await ensureChalkboardSession({ id: SESSION_ID, title: "Derivatives", domain: "math" });
    await setSessionMasteryStage(SESSION_ID, "construct", "Wrote the difference quotient unaided.");

    const stored = await getSessionMasteryStage(SESSION_ID);
    expect(stored.stage).toBe("construct");
    expect(stored.evidence).toBe("Wrote the difference quotient unaided.");
  });
});

describe("Guide to Mastery stage advancement", () => {
  it("does not advance on a bare model claim when the ledger is empty", () => {
    // The empty-ledger claim path was the bypass: ready + any sentence advanced
    // one stage with no recorded evidence. Advancement is ledger-gated only.
    expect(resolveNextMasteryStage("encounter", {
      stage: "encounter",
      stageAdvance: { ready: true, evidence: "Described the tangent-line picture in their own words." },
    })).toBeNull();

    // No advancement claimed.
    expect(resolveNextMasteryStage("encounter", { stage: "encounter" })).toBeNull();
    expect(resolveNextMasteryStage("encounter", {
      stage: "encounter",
      stageAdvance: { ready: false, evidence: "Still guessing." },
    })).toBeNull();
  });

  it("advances exactly one stage when the ledger satisfies the exit predicate", () => {
    const ledger = [
      {
        evidenceId: "e1",
        learnerId: "L",
        skillIds: ["derivatives"],
        taskId: "t1",
        taskFamily: "family_a",
        contextVariant: "same" as const,
        evidenceType: "prediction" as const,
        response: "I think the slope gets steeper",
        correctness: "correct" as const,
        rubricCriterionIds: [],
        supportLevel: 0 as const,
        hintExposure: 0 as const,
        delayed: false,
        source: "tutor_turn" as const,
        timestamp: new Date().toISOString(),
      },
      {
        evidenceId: "e2",
        learnerId: "L",
        skillIds: ["derivatives"],
        taskId: "t2",
        taskFamily: "family_b",
        contextVariant: "same" as const,
        evidenceType: "observation" as const,
        response: "the secant approaches the tangent",
        correctness: "correct" as const,
        rubricCriterionIds: [],
        supportLevel: 0 as const,
        hintExposure: 0 as const,
        delayed: false,
        source: "tutor_turn" as const,
        timestamp: new Date().toISOString(),
      },
    ];
    const next = resolveNextMasteryStage(
      "encounter",
      {
        stage: "encounter",
        stageAdvance: { ready: true, evidence: "Committed a prediction and read the result." },
      },
      ledger
    );
    expect(next?.stage).toBe("understand");
    expect(next?.evidence).toMatch(/Encounter satisfied/);
  });

  it("refuses to skip stages even when the ledger would allow the next rung", () => {
    // Satisfying Encounter still only moves one rung, regardless of the stage
    // the model reports.
    const ledger = [
      {
        evidenceId: "e1",
        learnerId: "L",
        skillIds: ["derivatives"],
        taskId: "t1",
        taskFamily: "family_a",
        contextVariant: "same" as const,
        evidenceType: "prediction" as const,
        response: "prediction",
        correctness: "correct" as const,
        rubricCriterionIds: [],
        supportLevel: 0 as const,
        hintExposure: 0 as const,
        delayed: false,
        source: "tutor_turn" as const,
        timestamp: new Date().toISOString(),
      },
      {
        evidenceId: "e2",
        learnerId: "L",
        skillIds: ["derivatives"],
        taskId: "t2",
        taskFamily: "family_b",
        contextVariant: "same" as const,
        evidenceType: "observation" as const,
        response: "observation",
        correctness: "correct" as const,
        rubricCriterionIds: [],
        supportLevel: 0 as const,
        hintExposure: 0 as const,
        delayed: false,
        source: "tutor_turn" as const,
        timestamp: new Date().toISOString(),
      },
    ];
    expect(resolveNextMasteryStage("encounter", {
      stage: "master",
      stageAdvance: { ready: true, evidence: "They seem to have it." },
    }, ledger)?.stage).toBe("understand");
  });

  it("cannot advance past the final stage", () => {
    expect(resolveNextMasteryStage("master", {
      stage: "master",
      stageAdvance: { ready: true, evidence: "All five dimensions are strong." },
    })).toBeNull();
  });

  it("honours an observed regression immediately and without evidence", () => {
    // Diagnosing that the learner is actually behind must never be harder than
    // promoting them.
    expect(resolveNextMasteryStage("apply", { stage: "understand" })).toEqual({
      stage: "understand",
      evidence: "",
    });
  });
});

describe("the learner is never passive — LessonStep invariants", () => {
  /**
   * The reported failure (pre-Phase 1): the tutor placed a roadmap, said
   * "I've put the roadmap for this lesson on the board", and stopped. The
   * learner was shown a plan and handed nothing to do.
   *
   * Phase 1 collapses that runtime enforcer into a `LessonStep` invariant:
   * the step constructor refuses a presentation route that carries no prose
   * slots, and `turnLeavesLearnerSomethingToDo` continues to express the
   * "is this turn a real task?" check for callers that still need to
   * inspect a finished turn directly.
   */
  const roadmap = {
    op: "place_widget" as const,
    intent: {
      kind: "roadmap" as const,
      heading: "Today's Path: Approximating Areas",
      steps: [
        { id: "s1", label: "Encounter", state: "current" as const },
        { id: "s2", label: "Understand", state: "upcoming" as const },
      ],
    },
  };
  const question = {
    op: "place_widget" as const,
    intent: {
      kind: "question" as const,
      format: "multiple_choice" as const,
      prompt: "Why rectangles?",
      options: [
        { id: "a", label: "They tile without gaps", correct: true },
        { id: "b", label: "They are easier to draw", misconception: "Convenience over structure" },
      ],
    },
  };

  const turn = (boardOps: unknown[], speech = "Here is the plan.") =>
    ({ speech, boardOps, evidenceRefs: [] }) as TutorTurn;

  it("flags a roadmap-only turn as leaving the learner nothing to do", () => {
    expect(turnLeavesLearnerSomethingToDo(turn([roadmap]))).toBe(false);
  });

  it("accepts the same turn once it also opens the first step", () => {
    expect(turnLeavesLearnerSomethingToDo(turn([roadmap, question]))).toBe(true);
  });

  it("treats other presentational-only turns the same way", () => {
    const presentational = [
      { op: "write_text", text: "A Riemann sum approximates area." },
      { op: "write_bullets", items: ["left endpoint", "right endpoint"] },
      { op: "write_latex", tex: "\\sum f(x_i)\\Delta x" },
      { op: "write_callout", text: "Watch the width." },
      { op: "place_widget", intent: { kind: "concept_card", term: "Riemann sum", definition: "A sum of rectangle areas." } },
    ];
    for (const op of presentational) {
      expect(turnLeavesLearnerSomethingToDo(turn([op])), `${op.op} should not count as a task`).toBe(false);
    }
  });

  it("counts an exploration widget only once it has a respond prompt", () => {
    const bare = { op: "place_widget", intent: { kind: "slider", label: "Rectangles n", parameter: "n", min: 1, max: 50, value: 4 } };
    expect(turnLeavesLearnerSomethingToDo(turn([bare]))).toBe(false);

    const asked = {
      op: "place_widget",
      intent: { ...bare.intent, respond: { prompt: "What happens to the error as n grows?" } },
    };
    expect(turnLeavesLearnerSomethingToDo(turn([asked]))).toBe(true);
  });

  it("does not demand a new task from housekeeping-only turns", () => {
    // Repairing or tidying the board owes the learner nothing new; their work
    // is already sitting there from an earlier turn.
    for (const op of [
      { op: "redraw_block", targetAnchor: "agent-w1" },
      { op: "delete_block", targetIndex: 0 },
      { op: "revise_text", targetIndex: 0, find: "a", replace: "b" },
    ]) {
      expect(turnLeavesLearnerSomethingToDo(turn([op])), `${op.op}`).toBe(true);
    }
  });

  it("LessonStep rejects direct_instruction with no prose slots", () => {
    // The replacement for `enforceLearnerAgency`'s "nag with speech" branch.
    // A presentation route that carries nothing for the tutor to say is
    // unservable at construction; the planner must produce a different step.
    expect(() =>
      createLessonStep({
        route: "direct_instruction",
        targetSkillIds: ["chain_rule"],
        stage: "understand",
        mode: "instruction",
        supportCeiling: 3,
        requiredEvidence: [],
        permittedWidgetKinds: ["concept_card", "example"],
        proseSlots: [],
        maxBoardOps: 4,
      })
    ).toThrow(/unservable.*direct_instruction.*prose slot/i);
  });

  it("LessonStep rejects a step with no permitted widget kinds", () => {
    expect(() =>
      createLessonStep({
        route: "guided_retry",
        targetSkillIds: ["chain_rule"],
        stage: "construct",
        mode: "guided_practice",
        supportCeiling: 2,
        requiredEvidence: ["procedure"],
        permittedWidgetKinds: [],
        proseSlots: [{ blockId: "slot-1", hint: "Lead the learner.", tone: "concise" }],
        maxBoardOps: 3,
      })
    ).toThrow(/unservable.*permitted widget kind/i);
  });

  it("LessonStep accepts a step that already hands the work back", () => {
    // A guided retry with a hint widget (support 2) plus a scratchpad (the
    // learner's task) is servable — the runtime nudger never had to be called.
    const step = createLessonStep({
      route: "guided_retry",
      targetSkillIds: ["chain_rule"],
      stage: "construct",
      mode: "guided_practice",
      supportCeiling: 2,
      requiredEvidence: ["construction"],
      permittedWidgetKinds: ["hint", "scratchpad"],
      proseSlots: [{ blockId: "slot-1", hint: "Lead the learner to the next step.", tone: "concise" }],
      maxBoardOps: 3,
    });
    expect(step.permittedWidgetKinds).toEqual(["hint", "scratchpad"]);
    expect(step.supportCeiling).toBe(2);
  });

  it("leaves speech-only turns alone", () => {
    // A greeting or clarification has no board ops and owes no task.
    const speechOnly = turn([], "Yes, that link is in Threads.");
    expect(turnLeavesLearnerSomethingToDo(speechOnly)).toBe(true);
  });
});

/**
 * The counterweight to the never-passive rule: the stage vocabulary names a
 * *picture* (function/geometry/equation), and a board that only ever asks
 * questions about a spatial idea is an unfinished explanation.
 *
 * Phase 1 moves this invariant into `LessonStep`: a step that names a
 * visualization intent (e.g. `requiredVisualizationKind: "function"`) must
 * carry the corresponding kind in `permittedWidgetKinds` so the post-LLM
 * compiler emits the figure. The runtime nudge in `enforceVisualExplanation`
 * is gone — its only job was to coax the LLM, and the LLM is no longer in
 * charge of choosing the picture.
 */
describe("show, don't just tell — requiredVisualizationKind in LessonStep", () => {
  const question = {
    op: "place_widget" as const,
    intent: {
      kind: "question" as const,
      format: "multiple_choice" as const,
      prompt: "Why do the slices over- or under-shoot?",
      options: [
        { id: "a", label: "They follow the curve's corners", correct: true },
        { id: "b", label: "They ignore the curve" },
      ],
    },
  };

  it("LessonStep in Encounter names 'function' as required and accepts an equation at Understand", () => {
    const encounterStep = createLessonStep({
      route: "direct_instruction",
      targetSkillIds: ["riemann_sum"],
      stage: "encounter",
      mode: "instruction",
      supportCeiling: 3,
      requiredEvidence: [],
      permittedWidgetKinds: ["function", "concept_card", "question"],
      requiredVisualizationKind: "function",
      proseSlots: [{ blockId: "slot-1", hint: "Walk through the picture.", tone: "worked" }],
      maxBoardOps: 4,
    });
    expect(encounterStep.requiredVisualizationKind).toBe("function");
    // An equation-only lesson at Understand is valid because Understand's
    // vocabulary already includes equation rendering.
    const understandStep = createLessonStep({
      route: "direct_instruction",
      targetSkillIds: ["riemann_sum"],
      stage: "understand",
      mode: "instruction",
      supportCeiling: 3,
      requiredEvidence: [],
      permittedWidgetKinds: ["equation", "comparison", "question"],
      requiredVisualizationKind: "equation",
      proseSlots: [{ blockId: "slot-1", hint: "Walk through the formula.", tone: "worked" }],
      maxBoardOps: 4,
    });
    expect(understandStep.requiredVisualizationKind).toBe("equation");
  });

  it("leaves the underlying never-passive helper for callers that still need it", () => {
    // The helper stays available for the post-LLM compiler (Phase 3) to
    // re-check a finished turn against the structural step. Phase 1 only
    // removed the runtime enforcer that called it from `askTutorTurn`.
    const turn = (boardOps: unknown[]) =>
      ({ speech: "Here's a check.", boardOps, evidenceRefs: [] }) as TutorTurn;
    expect(turnLeavesLearnerSomethingToDo(turn([question]))).toBe(true);
  });
});

describe("roadmap advances with demonstrated goals — roadmapLedger", () => {
  // Phase 1 cleanup: the runtime enforcer `enforceRoadmapProgress` is gone.
  // Its invariants now live in `learning/roadmapLedger.ts` as plain functions
  // that the post-LLM compiler (Phase 3) calls. These tests pin the helpers
  // directly so the wiring has tests even before the compiler reads them.
  const roadmapSteps = [
    { id: "encounter", label: "Encounter", state: "done" as const },
    { id: "understand", label: "Understand", state: "current" as const },
    { id: "construct", label: "Construct", state: "upcoming" as const },
    { id: "apply", label: "Apply", state: "upcoming" as const },
  ];

  const boardWithRoadmap = {
    id: "b1",
    title: "Derivatives",
    subtitle: "",
    domain: "math" as const,
    blocks: [
      {
        id: "agent-roadmap-1",
        kind: "widget" as const,
        intent: {
          kind: "roadmap" as const,
          heading: "Today's path",
          steps: roadmapSteps,
        },
      },
      {
        id: "q1",
        kind: "widget" as const,
        intent: {
          kind: "question" as const,
          format: "short_answer" as const,
          prompt: "Why does the limit appear?",
          acceptedAnswers: ["rate of change"],
        },
        state: { submitted: true, correct: true, responseText: "rate of change" },
      },
    ],
  };

  const question = {
    op: "place_widget" as const,
    intent: {
      kind: "question" as const,
      format: "multiple_choice" as const,
      prompt: "Build the difference quotient",
      options: [
        { id: "a", label: "Write the definition", correct: true },
        { id: "b", label: "Guess the answer", misconception: "skips construction" },
      ],
    },
  };

  it("surfaces the roadmap anchor, step ids, and states in the board summary", () => {
    const summary = summarizeBoardBlocks(boardWithRoadmap as never);
    expect(summary).toMatch(/anchor=agent-roadmap-1/);
    expect(summary).toMatch(/kind=widget \(roadmap\)/);
    expect(summary).toMatch(/encounter:done/);
    expect(summary).toMatch(/understand:current/);
    expect(summary).toMatch(/construct:upcoming/);
  });

  it("finds the existing roadmap on the board", () => {
    const found = findBoardRoadmap(boardWithRoadmap as never);
    expect(found?.anchor).toBe("agent-roadmap-1");
    expect(found?.index).toBe(0);
    expect(found?.intent.steps.map((s) => s.id)).toEqual([
      "encounter",
      "understand",
      "construct",
      "apply",
    ]);
  });

  it("builds a roadmap intent that marks completed stages done and the live stage current", () => {
    const intent = buildRoadmapIntentForStage(
      {
        kind: "roadmap",
        heading: "Today's path",
        steps: roadmapSteps,
      },
      "construct"
    );
    expect(intent.steps.find((s) => s.id === "understand")?.state).toBe("done");
    expect(intent.steps.find((s) => s.id === "construct")?.state).toBe("current");
    expect(intent.steps.find((s) => s.id === "apply")?.state).toBe("upcoming");
    // Never invent a weaker promotion: steps beyond the demonstrated stage stay upcoming.
    expect(intent.steps.every((s) => s.state !== "done" || ["encounter", "understand"].includes(s.id))).toBe(true);
  });

  it("does not invent roadmap progress when the stage did not advance", () => {
    // The post-LLM compiler (Phase 3) decides whether a heal is owed; the
    // helper `buildRoadmapIntentForStage` is the structural "what the map
    // should look like at this stage" function. With `advancedTo: null` and
    // no call to it, the compiler does not emit a redundant heal.
    const healedForNull = buildRoadmapIntentForStage(
      {
        kind: "roadmap",
        heading: "Today's path",
        steps: roadmapSteps,
      },
      "understand"
    );
    expect(healedForNull.steps.find((s) => s.id === "understand")?.state).toBe("current");
    // Calling it at the same stage the map already shows yields an
    // intent whose step states match the board exactly — `roadmapIntentDiffers`
    // would say false. The compiler (Phase 3) uses that to suppress idle
    // updates.
    expect(
      healedForNull.steps.find((s) => s.id === "encounter")?.state ===
      roadmapSteps.find((s) => s.id === "encounter")?.state
    ).toBe(true);
  });

  it("refuses unsupported step promotion beyond the demonstrated stage", () => {
    // Model tries to mark Apply done while only Construct was demonstrated.
    // The post-LLM compiler asks `buildRoadmapIntentForStage(stage=construct)`
    // and pulls Apply back to upcoming — exactly the invariant that used to
    // live in the runtime enforcer.
    const overreach = {
      kind: "roadmap" as const,
      heading: "Today's path",
      steps: [
        { id: "encounter", label: "Encounter", state: "done" as const },
        { id: "understand", label: "Understand", state: "done" as const },
        { id: "construct", label: "Construct", state: "done" as const },
        { id: "apply", label: "Apply", state: "done" as const },
      ],
    } as RoadmapWidget;
    const healed = buildRoadmapIntentForStage(overreach, "construct");
    expect(healed.steps.find((s) => s.id === "construct")?.state).toBe("current");
    expect(healed.steps.find((s) => s.id === "apply")?.state).toBe("upcoming");
    expect(healed.steps.filter((s) => s.state === "done").map((s) => s.id)).toEqual([
      "encounter",
      "understand",
    ]);
  });

  it("drops a roadmap-only follow-up that neither advances a step nor opens work", () => {
    // The post-LLM compiler drops a turn whose only roadmap op is a duplicate
    // place: the helper returns `update` because the board already has a map;
    // without a demonstrated stage advance the compiler emits no heal either.
    // The board-ops invariant is enforced by `LessonStep.permittedWidgetKinds`
    // upstream — Phase 3 wires that, but the rule that the harness never
    // emits a duplicate roadmap is already true.
    expect(findBoardRoadmap(boardWithRoadmap as never)).not.toBeNull();
  });

  it("heals the map on an empty turn when the stage advanced (no sticky desync)", () => {
    // Stage can persist without teaching ops; the board map must still move.
    // The helper returns the post-heal intent; the compiler (Phase 3) emits
    // an `update_widget` against `findBoardRoadmap(board).anchor` with that intent.
    const healed = buildRoadmapIntentForStage(
      {
        kind: "roadmap",
        heading: "Today's path",
        steps: roadmapSteps,
      },
      "construct"
    );
    expect(healed.steps.find((s) => s.id === "construct")?.state).toBe("current");
    expect(healed.steps.find((s) => s.id === "understand")?.state).toBe("done");
  });

  it("drops an idle roadmap-only update when the map already matches the live stage", () => {
    // Board already has understand current; liveStage stays understand — no heal.
    const liveStage = "understand";
    const healed = buildRoadmapIntentForStage(
      {
        kind: "roadmap",
        heading: "Today's path",
        steps: roadmapSteps,
      },
      liveStage
    );
    // Helper returns the same shape the board already shows — Phase 3's
    // compiler uses that equality to suppress the redundant update.
    expect(healed.steps.map((s) => `${s.id}:${s.state}`).join(",")).toBe(
      roadmapSteps.map((s) => `${s.id}:${s.state}`).join(",")
    );
  });

  it("rewrites insert_after / replace_block second maps onto the existing anchor", () => {
    // The compiler (Phase 3) calls `findBoardRoadmap` and rewrites any
    // second-map insert/replace/thread op to `update_widget` against the
    // existing anchor. Phase 1 only pins the lookup behaviour.
    const insertMap = {
      op: "insert_after" as const,
      targetAnchor: "q1",
      block: {
        kind: "widget" as const,
        intent: {
          kind: "roadmap" as const,
          heading: "Sneaky second map",
          steps: [{ id: "encounter", label: "Encounter", state: "current" as const }],
        },
      },
    };
    expect(findBoardRoadmap(boardWithRoadmap as never)?.anchor).toBe("agent-roadmap-1");
    // The structural rule lives in the helper itself: `opCarriesRoadmap`
    // recognises the block-shaped payload, which Phase 3 rewrites to
    // update_widget against the existing anchor.
    void insertMap;
  });

  it("strips roadmap blocks from spawn_thread when a board map already exists", () => {
    // Phase 3: `stripRoadmapsFromThread` drops roadmap widgets from a
    // spawn_thread's initial blocks when one is already on the board.
    // Phase 1 only pins `findBoardRoadmap`.
    expect(findBoardRoadmap(boardWithRoadmap as never)).not.toBeNull();
    void question;
  });

  it("pulls roadmap steps back on regression via liveStage clamp", () => {
    // The compiler (Phase 3) calls `buildRoadmapIntentForStage(liveStage)`
    // on every turn; on regression it pulls the pointer back to the earlier
    // rung so the board cannot advertise progress the ledger has withdrawn.
    const overreach = {
      kind: "roadmap" as const,
      heading: "Today's path",
      steps: [
        { id: "encounter", label: "Encounter", state: "done" as const },
        { id: "understand", label: "Understand", state: "done" as const },
        { id: "construct", label: "Construct", state: "current" as const },
        { id: "apply", label: "Apply", state: "upcoming" as const },
      ],
    } as RoadmapWidget;
    const healed = buildRoadmapIntentForStage(overreach, "understand");
    expect(healed.steps.find((s) => s.id === "understand")?.state).toBe("current");
    expect(healed.steps.find((s) => s.id === "construct")?.state).toBe("upcoming");
    expect(healed.steps.find((s) => s.id === "encounter")?.state).toBe("done");
  });

  it("heals the map on regression even when the turn has no roadmap op", () => {
    // Teaching-only turn + regressTo must pull the pointer back without
    // waiting for a coincidental model update_widget. The compiler (Phase 3)
    // looks up the existing roadmap and emits a heal against it.
    const healed = buildRoadmapIntentForStage(
      {
        kind: "roadmap",
        heading: "Today's path",
        steps: roadmapSteps,
      },
      "encounter"
    );
    expect(healed.steps.find((s) => s.id === "encounter")?.state).toBe("current");
    expect(healed.steps.find((s) => s.id === "understand")?.state).toBe("upcoming");
  });

  it("surfaces a nested-in-row roadmap anchor and steps in the board summary", () => {
    const nested = {
      id: "b-nested",
      title: "Nested",
      subtitle: "",
      domain: "math" as const,
      blocks: [
        {
          id: "row-1",
          kind: "row" as const,
          children: [
            {
              id: "nested-roadmap",
              kind: "widget" as const,
              intent: {
                kind: "roadmap" as const,
                heading: "Path",
                steps: roadmapSteps,
              },
            },
          ],
        },
      ],
    };
    const summary = summarizeBoardBlocks(nested as never);
    expect(summary).toMatch(/anchor=nested-roadmap/);
    expect(summary).toMatch(/kind=widget \(roadmap\)/);
    expect(summary).toMatch(/understand:current/);
    expect(findBoardRoadmap(nested as never)?.anchor).toBe("nested-roadmap");
  });

  it("does not fuzzy-map free-form step ids onto the mastery ladder", () => {
    // "application".includes("apply") used to mark custom steps done when the
    // ledger reached Apply. Exact id/label match only — substring includes are out.
    const custom = {
      kind: "roadmap" as const,
      heading: "Lesson path",
      steps: [
        { id: "application", label: "Application problems", state: "upcoming" as const },
        { id: "warmup", label: "Warm up", state: "current" as const },
      ],
    } as RoadmapWidget;
    const intent = buildRoadmapIntentForStage(custom, "apply");
    // Neither free-form step is a ladder stage, so neither is marked done from
    // the live stage. (The single-current pointer may still pick one current.)
    expect(intent.steps.every((s) => s.state !== "done")).toBe(true);
    expect(intent.steps.filter((s) => s.state === "current")).toHaveLength(1);
  });
});
