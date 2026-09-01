import { describe, it, expect } from "vitest";
import { releaseWidgetDedupeOnFailure, type TurnKind } from "./StudyRoom";

/**
 * The widget dedupe invariant: a widget that wakes the tutor once must be
 * wake-able AGAIN if the first wake failed, or the learner is stranded
 * staring at an answered widget that can never produce another turn.
 *
 * The plan_start seam makes this load-bearing: a failed first attempt at the
 * route-bearing turn would leave the plan widget claimed but never answered,
 * and every subsequent re-click would silently fail because the dedupe Set
 * still holds the block id.
 */

describe("releaseWidgetDedupeOnFailure — widget turn dedupe cleanup", () => {
  it("releases the key for a widget turn that did not complete", () => {
    const claimed = new Set<string>(["agent-block-1"]);
    const released = releaseWidgetDedupeOnFailure(claimed, "widget", "agent-block-1");
    expect(released).toBe(true);
    expect(claimed.has("agent-block-1")).toBe(false);
  });

  it("releases the key for a plan_start turn that did not complete", () => {
    // The plan_start turn is the route-bearing turn after the greeting: a
    // failed one would strand the learner with an agreed plan that never
    // produced a route-bearing response.
    const claimed = new Set<string>(["agent-plan-1"]);
    const released = releaseWidgetDedupeOnFailure(claimed, "plan_start", "agent-plan-1");
    expect(released).toBe(true);
    expect(claimed.has("agent-plan-1")).toBe(false);
  });

  it("releases a cluster key by the same id the cluster claimed", () => {
    // Cluster signals are claimed under `group:<id>` so a single wake fires
    // for the whole group; the failure path must release THAT key, not the
    // individual block id, or the rest of the cluster would be stranded.
    const claimed = new Set<string>(["group:42"]);
    const released = releaseWidgetDedupeOnFailure(claimed, "widget", "group:42");
    expect(released).toBe(true);
    expect(claimed.has("group:42")).toBe(false);
  });

  it("never touches a different block's key — failure cleanup is surgical", () => {
    // Releasing one widget's key must not leak into another widget's claim,
    // or a transient failure on widget A would let widget B fire twice.
    const claimed = new Set<string>(["agent-block-A", "agent-block-B"]);
    const released = releaseWidgetDedupeOnFailure(claimed, "widget", "agent-block-A");
    expect(released).toBe(true);
    expect(claimed.has("agent-block-A")).toBe(false);
    expect(claimed.has("agent-block-B")).toBe(true);
  });

  it("refuses to release for a non-widget-derived turn (chat or greeting)", () => {
    // Chat and greeting turns are not gated by the dedupe Set: a chat message
    // can always be sent, and a greeting that errored re-arms via greetedRef.
    const claimed = new Set<string>(["some-key"]);
    expect(releaseWidgetDedupeOnFailure(claimed, "chat", "some-key")).toBe(false);
    expect(releaseWidgetDedupeOnFailure(claimed, "greeting", "some-key")).toBe(false);
    expect(claimed.has("some-key")).toBe(true);
  });

  it("is a no-op when the signalKey was never claimed (defensive)", () => {
    // A second failure path that arrived without a claim — e.g. a stale UI
    // event — must not throw or release a key held by a different widget.
    const claimed = new Set<string>(["agent-other"]);
    const released = releaseWidgetDedupeOnFailure(claimed, "widget", "agent-missing");
    expect(released).toBe(false);
    expect(claimed.has("agent-other")).toBe(true);
  });

  it("ignores an undefined signalKey rather than clearing the whole set", () => {
    const claimed = new Set<string>(["agent-block-1", "agent-block-2"]);
    const released = releaseWidgetDedupeOnFailure(claimed, "widget", undefined);
    expect(released).toBe(false);
    expect(claimed.size).toBe(2);
  });
});

describe("releaseWidgetDedupeOnFailure — turn-kind matrix", () => {
  const kinds: TurnKind[] = ["chat", "greeting", "widget", "plan_start"];
  for (const kind of kinds) {
    it(`treats turnKind="${kind}" deterministically`, () => {
      const claimed = new Set<string>(["only-key"]);
      const released = releaseWidgetDedupeOnFailure(claimed, kind, "only-key");
      // Only widget and plan_start should release. A test per kind makes the
      // matrix explicit: a future type addition cannot silently start
      // releasing keys it should not.
      expect(released).toBe(kind === "widget" || kind === "plan_start");
      expect(claimed.has("only-key")).toBe(kind !== "widget" && kind !== "plan_start");
    });
  }
});
