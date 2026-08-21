import { describe, expect, it } from "vitest";
import type { BoardDoc } from "../data/boards";
import { hydrateStudyBoards, hydrateStudySession, type StoredStudySession } from "./studySessionStore";

describe("study session hydration keeps widgets durable", () => {
  it("preserves widget blocks and sanitizes learner state on reopen", () => {
    const boards = hydrateStudyBoards([
      {
        id: "board-1",
        title: "Unit circle",
        subtitle: "",
        domain: "math",
        blocks: [
          {
            id: "w1",
            kind: "widget",
            intent: {
              kind: "animation",
              frames: [{ id: "f1", caption: "One lap around the unit circle" }],
              scene: {
                xDomain: [-2, 2],
                yDomain: [-2, 2],
                elements: [
                  { kind: "curve", id: "c", xExpression: "cos(u)", yExpression: "sin(u)", uDomain: [0, 6.28] },
                ],
              },
            },
            state: {
              animationProgress: Number.NaN,
              predictionLocked: true,
              responseText: "a".repeat(10_000),
              checkpointResponses: {
                cp1: { response: "1", correct: true },
                "": { response: "empty-key-dropped" },
              },
            },
          },
        ],
      } as BoardDoc,
    ]);

    expect(boards).toHaveLength(1);
    const widget = boards[0].blocks[0];
    expect(widget.kind).toBe("widget");
    if (widget.kind !== "widget") return;
    expect(widget.intent.kind).toBe("animation");
    expect(widget.state?.predictionLocked).toBe(true);
    // Non-finite progress is dropped rather than rehydrated as a crash seed.
    expect(widget.state?.animationProgress).toBeUndefined();
    expect(widget.state?.responseText?.length).toBeLessThanOrEqual(4000);
    expect(widget.state?.checkpointResponses?.cp1?.response).toBe("1");
    expect(widget.state?.checkpointResponses?.[""]).toBeUndefined();
  });

  it("keeps the session active board when boards are present", () => {
    const session = hydrateStudySession({
      id: "s1",
      title: "Note",
      domain: "math",
      boards: [
        { id: "a", title: "A", subtitle: "", domain: "math", blocks: [] },
        { id: "b", title: "B", subtitle: "", domain: "math", blocks: [] },
      ],
      activeId: "b",
      messages: [],
      viewMap: {},
      strokeMap: {},
      updatedAt: new Date().toISOString(),
    } as StoredStudySession);
    expect(session.activeId).toBe("b");
    expect(session.boards.map((board) => board.id)).toEqual(["a", "b"]);
  });

  it("does not drop a widget block when intent validation fails", () => {
    const boards = hydrateStudyBoards([
      {
        id: "board-1",
        title: "Note",
        subtitle: "",
        domain: "math",
        blocks: [
          {
            id: "w-old",
            kind: "widget",
            // Unknown kind from a future build — still kept so the learner's
            // place on the board is not silently erased.
            intent: { kind: "widget_from_the_future", title: "X" } as never,
            state: { submitted: true },
          },
        ],
      } as BoardDoc,
    ]);
    expect(boards[0].blocks).toHaveLength(1);
    expect(boards[0].blocks[0].kind).toBe("widget");
  });
});
