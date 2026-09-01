/**
 * Parallel greeting-turn agents (Phase 4).
 *
 * Invariant — on a session-opening turn, the tutor harness MUST issue two
 * model calls in parallel:
 *   1. The plan agent — schema `plan_widget_v1`, validated by `validatePlanOnlyPayload`,
 *      system fragment ends with the plan-agent brief.
 *   2. The overview agent — schema `overview_widget_v1`, validated by
 *      `validateOverviewOnlyPayload`, system fragment ends with the
 *      overview-agent brief.
 *
 * The two responses are merged into a single `TutorTurn` carrying both
 * widgets in plan-then-overview order, with `attempts` summed so telemetry
 * still reflects the total model-call count.
 *
 * When ONE agent fails mid-call, the harness synthesizes the missing widget
 * so the learner never sees a half agreement pair (no plan XOR overview).
 */
import { afterEach, describe, it, expect, vi, beforeEach } from "vitest";

import { getDb } from "../db/database";
import { askTutorTurn, type TutorTurnRequest } from "./tutor";
import { defaultCapabilities } from "./llm";

afterEach(() => {
  vi.unstubAllGlobals();
});

function greetingRequest(sessionId: string, learnerId: string): TutorTurnRequest {
  return {
    context: { skillId: "limits" },
    learner: {
      learnerId,
      learnerMessage: "Open the lesson with a brief welcome.",
      onboarding: {
        concept: "Limits",
        answers: [{ question: "Where are you with limits?", answer: "Brand new" }],
      },
    },
    board: {
      sessionId,
      sessionTitle: "Limits",
      domain: "math",
      turnKind: "greeting",
    },
    persistence: { sessionId, learnerId },
    model: {
      endpoint: {
        role: "tutor",
        provider: "custom",
        baseUrl: "https://model.example/v1",
        modelId: "parallel-greeting-model",
        apiKey: "",
        capabilities: defaultCapabilities(),
      },
    },
  };
}

function planOnlyJson(): string {
  return JSON.stringify({
    speech: "Here is the plan.",
    board_ops: [
      {
        op: "place_widget",
        intent: { kind: "plan", heading: "Limits", steps: [{ id: "s1", label: "Meet the idea" }] },
      },
    ],
    evidence_refs: [],
  });
}

function overviewOnlyJson(): string {
  return JSON.stringify({
    speech: "",
    board_ops: [
      {
        op: "place_widget",
        intent: { kind: "overview", concept: "Limits", summary: "Concept map for limits." },
      },
    ],
    evidence_refs: [],
  });
}

describe("parallel greeting — schema split between plan and overview agents", () => {
  beforeEach(async () => {
    await getDb();
  });

  it("issues two parallel model calls on a session-opening turn, one per widget schema", async () => {
    // The harness has to issue two parallel calls. We don't ship a `schema`
    // field in the request body (the schema is implicit in the system prompt
    // and the validator), so the only observable discriminator is WHICH
    // widget the response contains. Each call gets its own response.
    const callCount = { value: 0 };
    const fetchMock = vi.fn(async () => {
      // Even calls return the plan; odd calls return the overview.
      const which = callCount.value++ % 2;
      const content = which === 0 ? planOnlyJson() : overviewOnlyJson();
      return new Response(
        JSON.stringify({ choices: [{ message: { content } }] }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await askTutorTurn(greetingRequest("parallel-schema", "parallel-schema"));

    // Two parallel agents, not one.
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // Both widgets must be present in the merged turn, in plan-then-overview
    // order so the learner sees the agreement pair in reading order.
    const placeWidgetOps = result.value.boardOps.filter((op) => op.op === "place_widget");
    expect(placeWidgetOps.length).toBeGreaterThanOrEqual(2);
    const kinds = placeWidgetOps.map(
      (op) => (op as { intent: { kind: string } }).intent.kind
    );
    expect(kinds[0]).toBe("plan");
    expect(kinds[1]).toBe("overview");
  });

  it("splits the response budget between plan and overview using the effort token split", async () => {
    const maxTokensSeen: number[] = [];
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      try {
        const parsed = JSON.parse(String(init?.body ?? "{}")) as {
          max_tokens?: number;
        };
        if (typeof parsed.max_tokens === "number") maxTokensSeen.push(parsed.max_tokens);
      } catch {
        // ignore
      }
      const seen = maxTokensSeen.length;
      const content = seen % 2 === 0 ? planOnlyJson() : overviewOnlyJson();
      return new Response(
        JSON.stringify({ choices: [{ message: { content } }] }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    await askTutorTurn({
      ...greetingRequest("parallel-budget", "parallel-budget"),
      context: { effortParameter: "max", skillId: "limits" },
    });

    expect(maxTokensSeen).toHaveLength(2);
    // At max effort the plan agent gets 0.7 of the budget and the overview
    // gets 0.3, so the plan agent's max_tokens is more than twice the
    // overview's. Whichever call lands first, the two values must differ
    // and the larger must be more than 2x the smaller.
    const [a, b] = maxTokensSeen;
    expect(a).not.toBe(b);
    expect(Math.max(a, b)).toBeGreaterThan(Math.min(a, b) * 2);
  });

  it("merges the two responses into a single TutorTurn carrying both widgets in plan-then-overview order", async () => {
    let callIndex = 0;
    const fetchMock = vi.fn(async () => {
      const content = callIndex++ % 2 === 0 ? planOnlyJson() : overviewOnlyJson();
      return new Response(
        JSON.stringify({ choices: [{ message: { content } }] }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await askTutorTurn(greetingRequest("parallel-merge", "parallel-merge"));

    const placeWidgetOps = result.value.boardOps.filter((op) => op.op === "place_widget");
    expect(placeWidgetOps.length).toBeGreaterThanOrEqual(2);
    const kinds = placeWidgetOps.map(
      (op) => (op as { intent: { kind: string } }).intent.kind
    );
    // The first two place_widgets must be the agreement pair, in order.
    expect(kinds[0]).toBe("plan");
    expect(kinds[1]).toBe("overview");
  });
});

describe("parallel greeting — synthesis on partial failure", () => {
  beforeEach(async () => {
    await getDb();
  });

  it("synthesizes a missing overview when the plan agent alone succeeds", async () => {
    let callIndex = 0;
    const fetchMock = vi.fn(async () => {
      // Always respond with plan-only; the overview call would have produced
      // the overview, but we never let it succeed.
      const content = callIndex++ === 0 ? planOnlyJson() : JSON.stringify({
        // Invalid overview: wrong widget kind. validateOverviewOnlyPayload
        // rejects this so the agent returns no overview widget to merge.
        speech: "",
        board_ops: [
          {
            op: "place_widget",
            intent: { kind: "plan", heading: "Wrong", steps: [{ id: "x", label: "Wrong" }] },
          },
        ],
        evidence_refs: [],
      });
      return new Response(
        JSON.stringify({ choices: [{ message: { content } }] }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await askTutorTurn(greetingRequest("parallel-synth-overview", "parallel-synth-overview"));

    const kinds = result.value.boardOps
      .filter((op) => op.op === "place_widget")
      .map((op) => (op as { intent: { kind: string } }).intent.kind);
    // The harness must still produce both plan and overview widgets for the
    // learner to see the full agreement pair, even when one agent failed.
    expect(kinds).toContain("plan");
    expect(kinds).toContain("overview");
  });

  it("does NOT take the single-agent (non-parallel) path on a session-opening turn", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          choices: [{
            message: {
              content: JSON.stringify({
                speech: "Welcome.",
                board_ops: [],
                evidence_refs: [],
              }),
            },
          }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    await askTutorTurn(greetingRequest("parallel-counts", "parallel-counts"));

    // Two parallel agents, not one. A regression to the single-agent greeting
    // would show one fetch; the parallel path always shows two.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
