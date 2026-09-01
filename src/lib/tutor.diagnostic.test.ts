/**
 * Diagnostic: trace what happens to a real-world greeting turn where the LLM
 * emits plan + overview. Captures every filter stage's effect on boardOps.
 */
import { describe, it, expect, vi } from "vitest";

import { askTutorTurn, type TutorTurnRequest } from "./tutor";
import { defaultCapabilities } from "./llm";

const baseRequest: TutorTurnRequest = {
  context: { skillId: "limits" },
  learner: {
    learnerId: "diagnostic-learner",
    learnerMessage: "Open the lesson with a brief welcome, then place the first teaching step or orientation on the chalkboard. Keep the chat response to a short greeting.",
    onboarding: {
      concept: "Limits",
      answers: [{ question: "Where are you with limits?", answer: "Brand new" }],
      selfReportedFamiliarity: "new",
    },
  },
  board: {
    sessionId: "diagnostic-session",
    sessionTitle: "Limits",
    domain: "math",
  },
  persistence: { sessionId: "diagnostic-session", learnerId: "diagnostic-learner" },
  model: {
    endpoint: {
      role: "tutor",
      provider: "custom",
      baseUrl: "https://model.example/v1",
      modelId: "diagnostic-model",
      apiKey: "",
      capabilities: defaultCapabilities(),
    },
  },
};

function widgetKinds(boardOps: readonly { op: string; intent?: { kind: string } }[]): string[] {
  return boardOps
    .filter((op) => op.op === "place_widget" && op.intent)
    .map((op) => op.intent!.kind);
}

describe("DIAGNOSTIC — session opening greeting trace", () => {
  it("plan + overview emitted by LLM survives all filters", async () => {
    // Mock the model returning plan + overview in attempt 1 (the happy path).
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({
            speech: "Hi! Here is your plan and the full concept map.",
            board_ops: [
              {
                op: "place_widget",
                intent: {
                  kind: "plan",
                  heading: "Limits",
                  steps: [
                    { id: "s1", label: "Meet the idea" },
                    { id: "s2", label: "Compute a first limit" },
                  ],
                },
              },
              {
                op: "place_widget",
                intent: {
                  kind: "overview",
                  concept: "Limits",
                  summary: "A limit is the value a function approaches. Vocabulary: limit, epsilon, delta.",
                  vocabulary: [{ term: "limit", meaning: "the value a function approaches" }],
                },
              },
            ],
            evidence_refs: [],
          }),
        },
      }],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));

    vi.stubGlobal("fetch", fetchMock);
    try {
      const result = await askTutorTurn({
        ...baseRequest,
        board: { ...baseRequest.board, turnKind: "greeting" },
      });
      const kinds = widgetKinds(result.value.boardOps);
      // eslint-disable-next-line no-console
      console.log("DIAG happy path kinds:", kinds);
      expect(kinds).toContain("plan");
      expect(kinds).toContain("overview");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("plan-only triggers post-flight synthesis → overview appears", async () => {
    // Real-world: LLM emits only plan on every attempt. After repair exhausts,
    // the post-flight synthesis must inject an overview.
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({
            speech: "Here is the route.",
            board_ops: [
              {
                op: "place_widget",
                intent: {
                  kind: "plan",
                  heading: "Limits",
                  steps: [
                    { id: "s1", label: "Meet the idea" },
                    { id: "s2", label: "Compute a first limit" },
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
    try {
      const result = await askTutorTurn({
        ...baseRequest,
        learner: { ...baseRequest.learner, learnerMessage: "I'm ready to start" },
        board: {
          sessionId: "diag-plan-only",
          sessionTitle: "Limits",
          domain: "math",
          turnKind: "greeting",
        },
        persistence: { sessionId: "diag-plan-only", learnerId: "diag-plan-only" },
      });
      const kinds = widgetKinds(result.value.boardOps);
      // eslint-disable-next-line no-console
      console.log("DIAG plan-only kinds:", kinds, "fetch calls:", fetchMock.mock.calls.length);
      expect(kinds).toContain("plan");
      expect(kinds).toContain("overview");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
