/**
 * The plan-start seam: contract for what the greeting does and does NOT do
 * when it lands.
 *
 * Invariant — the greeting is PLANNING-ONLY:
 *   - It must NOT call buildPolicyBrief (no teaching instructions to follow).
 *   - It must NOT write a `learning_activities` contract row.
 *   - It may persist an entry signal (non-evidence intake) but nothing else.
 *
 * Invariant — the plan_start turn (first submitted plan widget):
 *   - It IS routed by the policy engine and receives a real move.
 *   - It DOES write a `learning_activities` contract row, so the turn that
 *     selects the entry route is bound to a recorded activity the learner
 *     later work can be filed against.
 *   - It is exempt from the route-scoped widget permit (it gets the full
 *     catalog like a greeting).
 */
import { afterEach, describe, it, expect, vi, beforeEach } from "vitest";

import { getDb } from "../db/database";
import { askTutorTurn, checkSessionOpeningContract, type TutorTurnRequest } from "./tutor";
import { defaultCapabilities } from "./llm";
import { getLatestSessionActivity, upsertEntrySignal } from "./learning/store";
import { resolveTurnWidgetPermit } from "./tutor";

afterEach(() => {
  vi.unstubAllGlobals();
});

function planStartPayload(): unknown {
  return {
    speech: "Welcome. Here is the plan and overview.",
    board_ops: [
      {
        op: "place_widget",
        intent: {
          kind: "plan",
          heading: "Limits",
          steps: [{ id: "s1", label: "Meet the idea" }],
        },
      },
      {
        op: "place_widget",
        intent: {
          kind: "overview",
          concept: "Limits",
          summary: "Concept map for limits.",
        },
      },
    ],
    evidence_refs: [],
  };
}

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
        modelId: "greeting-model",
        apiKey: "",
        capabilities: defaultCapabilities(),
      },
    },
  };
}

describe("plan-start seam — greeting is planning-only", () => {
  beforeEach(async () => {
    await getDb();
  });

  it("greeting does NOT write a learning_activities contract row", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(planStartPayload()) } }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const sessionId = "greeting-no-contract";
    await askTutorTurn(greetingRequest(sessionId, "greeting-no-contract"));

    // The greeting is a product beat, not a policy route. Writing a contract
    // would file a phantom activity against the same skill the plan_start turn
    // is about to address, polluting the very contract the policy relies on.
    const contract = await getLatestSessionActivity(sessionId);
    expect(contract).toBeUndefined();
  });

  it("greeting persists the validated onboarding entry signal as a side effect", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(planStartPayload()) } }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    // Pre-seed an entry signal so we can check it survives the greeting without
    // being mutated or deleted (greeting must be idempotent on the signal).
    const sessionId = "greeting-keeps-signal";
    await upsertEntrySignal({
      learnerId: "greeting-keeps-signal",
      sessionId,
      skillId: "limits",
      familiarity: "shaky",
    });

    await askTutorTurn(greetingRequest(sessionId, "greeting-keeps-signal"));

    // The greeting must not erase or overwrite the entry signal — the
    // deterministic router in buildPolicyBrief reads it on the next turn.
    const { getEntrySignal } = await import("./learning/store");
    expect(await getEntrySignal(sessionId, "limits", "greeting-keeps-signal")).toBe("shaky");
  });
});

describe("plan-start seam — plan_start turn writes a contract", () => {
  beforeEach(async () => {
    await getDb();
  });

  it("plan_start turn DOES write a learning_activities contract row", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({
        choices: [{
          message: {
            content: JSON.stringify({
              speech: "Let's start with the first step of the plan.",
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
      }), { status: 200, headers: { "Content-Type": "application/json" } })
    );
    vi.stubGlobal("fetch", fetchMock);

    const sessionId = "plan-start-with-contract";
    const learnerId = "plan-start-with-contract";

    await askTutorTurn({
      ...greetingRequest(sessionId, learnerId),
      board: { ...greetingRequest(sessionId, learnerId).board, turnKind: "plan_start" },
      learner: {
        ...greetingRequest(sessionId, learnerId).learner,
        // onboarding is NOT carried from greetingRequest — plan_start has no onboarding
        // intake and must build the full policy brief so recordMoveActivity fires.
        // Carrying onboarding would set isSessionOpening=true and skip the brief.
        learnerMessage: "I agree with the plan and I am ready.",
        onboarding: undefined,
      },
    });

    // The plan_start turn is the route-bearing turn: it routes, picks a move,
    // and writes the contract under which its work is filed. A later widget
    // submission resolves to THIS contract via the activity binding, not
    // whichever contract was newest when the learner got round to answering.
    const contract = await getLatestSessionActivity(sessionId);
    expect(contract).toBeDefined();
    // The contract carries the session id through its activity id; the row's
    // session_id column is written by recordActivityContract and the row is
    // retrievable by session_id, which proves the binding. LearningActivityContract
    // itself does not carry a sessionId field — that lives on the persisted row.
    expect(contract?.activityId).toContain(sessionId);
    // The move route is part of the recorded contract; that is what makes it
    // a contract rather than a generic session marker.
    expect(contract?.route).toBeTruthy();
  });
});

describe("plan-start seam — turn-widget permit covers the plan_start turn", () => {
  it("greeting and plan_start turns get the full widget catalog", () => {
    // The reported failure: a route-scoped catalog never contains the plan or
    // overview widgets, so the model literally never sees them exist. Both
    // turns must be exempt so they can place the agreement pair / the move.
    expect(resolveTurnWidgetPermit("greeting", true, ["question"])).toBeUndefined();
    expect(resolveTurnWidgetPermit("plan_start", true, ["question"])).toBeUndefined();
    // A plan_start turn WITHOUT onboarding is degenerate (the session was
    // restored mid-flow). The policy permit then applies so the move widget
    // kinds survive catalog filtering.
    expect(resolveTurnWidgetPermit("plan_start", false, ["question"])).toEqual(["question"]);
  });

  it("plan_start and greeting have distinct downstream behaviour despite the shared catalog exemption", () => {
    // Both exempt the model from the route permit, but the greeting does not
    // write a contract and does not call buildPolicyBrief, while the plan_start
    // does. The permit helper is the ONLY shared piece of behaviour.
    // The deeper behavioural test above proves the contract write happens for
    // plan_start and not for greeting; this test pins the permit exemption as
    // the explicit handshake.
    expect(resolveTurnWidgetPermit("plan_start", true, undefined)).toBeUndefined();
    expect(resolveTurnWidgetPermit("greeting", true, undefined)).toBeUndefined();
  });
});

/**
 * Regression tests for the bidirectional session-opening contract.
 *
 * The original bug: `checkSessionOpeningContract` enforced only one
 * direction of the agreement pair (Plan ∧ Overview), so a payload that
 * contained ONLY an overview widget would silently pass validation and
 * never trigger the post-flight synthesis. The learner would see a
 * concept map with no commitment device.
 *
 * These tests pin both directions of the contract and the symmetric
 * synthesis. The diagnostic tests in `tutor.diagnostic.test.ts` provide
 * the higher-level "happy path" coverage; these tests pin the contract
 * at the unit boundary.
 */
describe("plan-start seam — session opening contract is bidirectional", () => {
  it("rejects a plan-only board on a session-opening turn", () => {
    const error = checkSessionOpeningContract(
      {
        speech: "Here is the route.",
        board_ops: [
          {
            op: "place_widget",
            intent: {
              kind: "plan",
              heading: "Limits",
              steps: [{ id: "s1", label: "Meet the idea" }],
            },
          },
        ],
        evidence_refs: [],
      },
      true
    );
    expect(error).toMatch(/overview widget/i);
    expect(error).toMatch(/plan widget/i);
  });

  it("rejects an overview-only board on a session-opening turn", () => {
    // The symmetric regression: the original contract allowed this through.
    // The repaired contract must surface a clean error so the LLM retries.
    const error = checkSessionOpeningContract(
      {
        speech: "Here is the full concept map.",
        board_ops: [
          {
            op: "place_widget",
            intent: {
              kind: "overview",
              concept: "Limits",
              summary: "The full concept map for limits.",
            },
          },
        ],
        evidence_refs: [],
      },
      true
    );
    expect(error).toMatch(/plan widget/i);
    expect(error).toMatch(/overview widget/i);
  });

  it("rejects a board with NEITHER widget on a session-opening turn", () => {
    const error = checkSessionOpeningContract(
      {
        speech: "Hi.",
        board_ops: [],
        evidence_refs: [],
      },
      true
    );
    expect(error).toMatch(/NEITHER/i);
  });

  it("accepts plan AND overview together on a session-opening turn", () => {
    const error = checkSessionOpeningContract(
      {
        speech: "Here is the route and the full concept map.",
        board_ops: [
          {
            op: "place_widget",
            intent: {
              kind: "plan",
              heading: "Limits",
              steps: [{ id: "s1", label: "Meet the idea" }],
            },
          },
          {
            op: "place_widget",
            intent: {
              kind: "overview",
              concept: "Limits",
              summary: "The full concept map.",
            },
          },
        ],
        evidence_refs: [],
      },
      true
    );
    expect(error).toBeNull();
  });

  it("does not enforce the contract on non-session-opening turns", () => {
    const error = checkSessionOpeningContract(
      {
        speech: "Mid-session update.",
        board_ops: [
          {
            op: "place_widget",
            intent: {
              kind: "overview",
              concept: "Limits",
              summary: "Mid-session reminder.",
            },
          },
        ],
        evidence_refs: [],
      },
      false
    );
    expect(error).toBeNull();
  });
});

/**
 * Behavioural regression: the symmetric synthesis path. When the LLM emits
 * overview-only on a session-opening turn, the post-flight fallback must
 * add the missing plan widget so the learner sees the full agreement pair.
 *
 * This is the in-process companion to the unit-level contract tests above.
 */
describe("plan-start seam — symmetric synthesis adds missing plan widget", () => {
  beforeEach(async () => {
    await getDb();
  });

  it("synthesizes a plan widget when the LLM emits overview-only on a session-opening turn", async () => {
    // The LLM stubbornly emits overview-only on every attempt. The
    // pre-flight contract rejects each attempt; the recover callback must
    // refuse to sanitize (returning null so the retry continues); after
    // the retry budget is exhausted the catch block must synthesize the
    // missing plan widget so the learner sees a full agreement pair.
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  speech: "Here is the full concept map.",
                  board_ops: [
                    {
                      op: "place_widget",
                      intent: {
                        kind: "overview",
                        concept: "Limits",
                        summary:
                          "A limit is the value a function approaches as the input approaches a point.",
                      },
                    },
                  ],
                  evidence_refs: [],
                }),
              },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const sessionId = "overview-only-synthesis";
    const learnerId = "overview-only-synthesis";

    const result = await askTutorTurn({
      ...greetingRequest(sessionId, learnerId),
    });

    // The board must contain BOTH plan and overview widgets.
    const placeWidgetOps = result.value.boardOps.filter(
      (op) => op.op === "place_widget"
    );
    const kinds = placeWidgetOps.map(
      (op) => (op as { intent: { kind: string } }).intent.kind
    );
    expect(kinds).toContain("plan");
    expect(kinds).toContain("overview");
  });
});

/**
 * Effort Parameter + binding plan behavioural tests.
 *
 * These cover the wiring that connects the SessionCard Effort selector to
 * the tutor harness (Phase 1 + Phase 2) and the binding-plan persistence
 * on `plan_start` (Phase 6). They use the same fetch-mocking pattern as
 * the other plan-start tests.
 */
describe("effort parameter — system prompt surfaces the resolved level", () => {
  beforeEach(async () => {
    await getDb();
  });

  it("an explicit 'max' choice reaches the system prompt as EFFORT LEVEL: MAX", async () => {
    let capturedSystem = "";
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      try {
        const parsed = JSON.parse(String(init?.body ?? "{}")) as { messages?: Array<{ role: string; content: string }> };
        const sys = parsed.messages?.find((m) => m.role === "system");
        if (sys && typeof sys.content === "string") capturedSystem = sys.content;
      } catch {}
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify({
            speech: "Welcome.",
            board_ops: [],
            evidence_refs: [],
          }) } }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    await askTutorTurn({
      ...greetingRequest("effort-max-system", "effort-max-system"),
      context: { effortParameter: "max" },
    });

    expect(capturedSystem).toMatch(/EFFORT LEVEL: MAX/);
    expect(capturedSystem).toMatch(/8.+12/);
  });

  it("auto resolves to 'high' when no onboarding is provided", async () => {
    let capturedSystem = "";
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      try {
        const parsed = JSON.parse(String(init?.body ?? "{}")) as { messages?: Array<{ role: string; content: string }> };
        const sys = parsed.messages?.find((m) => m.role === "system");
        if (sys && typeof sys.content === "string") capturedSystem = sys.content;
      } catch {}
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify({
            speech: "Welcome.",
            board_ops: [],
            evidence_refs: [],
          }) } }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    await askTutorTurn({
      context: { effortParameter: "auto" },
      learner: {
        learnerId: "effort-auto-no-onboarding",
        learnerMessage: "Hi.",
      },
      board: {
        sessionId: "effort-auto-no-onboarding",
        sessionTitle: "Limits",
        domain: "math",
        turnKind: "chat",
      },
      persistence: { sessionId: "effort-auto-no-onboarding", learnerId: "effort-auto-no-onboarding" },
      model: {
        endpoint: {
          role: "tutor",
          provider: "custom",
          baseUrl: "https://model.example/v1",
          modelId: "auto-model",
          apiKey: "",
          capabilities: defaultCapabilities(),
        },
      },
    });

    // 'high' is the no-signal default and produces 4–6 phases.
    expect(capturedSystem).toMatch(/EFFORT LEVEL: HIGH/);
    expect(capturedSystem).toMatch(/4.+6/);
  });
});

describe("binding plan — persists learner-edited plan as a contract on plan_start", () => {
  beforeEach(async () => {
    await getDb();
  });

  it("writes a contract row whose statement contains the edited step labels", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify({
          speech: "OK.",
          board_ops: [],
          evidence_refs: [],
        }) } }],
      }), { status: 200, headers: { "Content-Type": "application/json" } })
    );
    vi.stubGlobal("fetch", fetchMock);

    const sessionId = "binding-plan-persist";
    const learnerId = "binding-plan-persist";
    const bindingPlan = {
      heading: "Limits",
      steps: [
        { id: "s1", label: "Meet the idea" },
        { id: "s2", label: "Compute a first limit" },
      ],
    };

    await askTutorTurn({
      context: { effortParameter: "standard" },
      learner: {
        learnerId,
        learnerMessage: "I edited the plan and agree.",
        bindingPlan,
        onboarding: undefined,
      },
      board: {
        sessionId,
        sessionTitle: "Limits",
        domain: "math",
        turnKind: "plan_start",
      },
      persistence: { sessionId, learnerId },
      model: {
        endpoint: {
          role: "tutor",
          provider: "custom",
          baseUrl: "https://model.example/v1",
          modelId: "binding-plan",
          apiKey: "",
          capabilities: defaultCapabilities(),
        },
      },
    });

    const { listActiveContracts } = await import("./contracts/store");
    const contracts = await listActiveContracts(learnerId);
    const binding = contracts.find((c) => c.sessionId === sessionId);
    expect(binding).toBeDefined();
    const goal = binding?.commitments.find((c) => c.kind === "goal");
    expect(goal).toBeDefined();
    if (goal?.kind === "goal") {
      expect(goal.statement).toContain("Meet the idea");
      expect(goal.statement).toContain("Compute a first limit");
      expect(goal.statement).toContain("Limits");
    }
  });

  it("does NOT write a contract when bindingPlan is absent (verbatim agreement)", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify({
          speech: "OK.",
          board_ops: [],
          evidence_refs: [],
        }) } }],
      }), { status: 200, headers: { "Content-Type": "application/json" } })
    );
    vi.stubGlobal("fetch", fetchMock);

    const sessionId = "no-binding-plan";
    const learnerId = "no-binding-plan";

    await askTutorTurn({
      context: { effortParameter: "standard" },
      learner: {
        learnerId,
        learnerMessage: "I agree with the plan.",
        // No bindingPlan — the learner agreed verbatim. The harness should
        // not synthesize a binding contract in this case.
        onboarding: undefined,
      },
      board: {
        sessionId,
        sessionTitle: "Limits",
        domain: "math",
        turnKind: "plan_start",
      },
      persistence: { sessionId, learnerId },
      model: {
        endpoint: {
          role: "tutor",
          provider: "custom",
          baseUrl: "https://model.example/v1",
          modelId: "no-binding-plan",
          apiKey: "",
          capabilities: defaultCapabilities(),
        },
      },
    });

    const { listActiveContracts } = await import("./contracts/store");
    const contracts = await listActiveContracts(learnerId);
    const binding = contracts.find((c) => c.sessionId === sessionId);
    expect(binding).toBeUndefined();
  });
});
