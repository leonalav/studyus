import { describe, it, expect } from "vitest";
import {
  clusterAllowsSignal,
  clusterProgressText,
  collectClusters,
  groupIdOf,
  summarizeCluster,
  type ClusterMember,
} from "./cluster";
import { buildClusterSignalDisplayText, buildClusterSignalMessage } from "./signal";
import { validateWidgetIntent } from "./validate";
import type { WidgetIntent } from "./types";

/* ── fixtures ── */

function question(id: string, groupId?: string, extra: Record<string, unknown> = {}): WidgetIntent {
  return {
    kind: "question",
    format: "multiple_choice",
    prompt: `Question ${id}?`,
    options: [
      { id: "a", label: "Right", correct: true },
      { id: "b", label: "Wrong", misconception: "Confuses rate with amount" },
    ],
    ...(groupId ? { group: { id: groupId, ...extra } } : {}),
  } as WidgetIntent;
}

function conceptCard(groupId?: string): WidgetIntent {
  return {
    kind: "concept_card",
    term: "Riemann sum",
    definition: "A sum of rectangle areas approximating an integral.",
    ...(groupId ? { group: { id: groupId } } : {}),
  } as WidgetIntent;
}

const answeredRight = { submitted: true, selectedOptionId: "a", correct: true };
const answeredWrong = { submitted: true, selectedOptionId: "b", correct: false };

describe("cluster membership", () => {
  it("treats a widget with no group as standalone", () => {
    expect(groupIdOf(question("1"))).toBeUndefined();
  });

  it("ignores a blank group id rather than creating an anonymous cluster", () => {
    const intent = { ...question("1"), group: { id: "   " } } as WidgetIntent;
    expect(groupIdOf(intent)).toBeUndefined();
  });

  it("counts only answerable widgets toward completion", () => {
    // A concept card inside the set is context, not work. Counting it would
    // deadlock the cluster: nothing can ever answer a concept card.
    const members: ClusterMember[] = [
      { blockId: "b1", intent: conceptCard("g1") },
      { blockId: "b2", intent: question("1", "g1"), state: answeredRight },
      { blockId: "b3", intent: question("2", "g1"), state: answeredRight },
    ];
    const cluster = summarizeCluster(members, "g1")!;
    expect(cluster.answerable).toHaveLength(2);
    expect(cluster.complete).toBe(true);
  });

  it("never reports a presentational-only cluster as complete", () => {
    const members: ClusterMember[] = [{ blockId: "b1", intent: conceptCard("g1") }];
    expect(summarizeCluster(members, "g1")!.complete).toBe(false);
  });

  it("counts an exploration widget only when it carries a respond prompt", () => {
    const bare = { kind: "slider", label: "n", parameter: "n", min: 1, max: 9, value: 2, group: { id: "g1" } } as WidgetIntent;
    const asked = { ...bare, respond: { prompt: "What did you notice?" } } as WidgetIntent;

    expect(summarizeCluster([{ blockId: "b1", intent: bare }], "g1")!.answerable).toHaveLength(0);
    expect(summarizeCluster([{ blockId: "b1", intent: asked }], "g1")!.answerable).toHaveLength(1);
  });
});

describe("the cluster gate", () => {
  const three = (states: (Record<string, unknown> | undefined)[]): ClusterMember[] =>
    states.map((state, index) => ({
      blockId: `b${index + 1}`,
      intent: question(String(index + 1), "g1"),
      state,
    }));

  it("withholds the signal until every question is answered", () => {
    const partial = three([answeredRight, answeredWrong, undefined]);
    expect(clusterAllowsSignal(partial, "b2").allowed).toBe(false);
  });

  it("releases it on the answer that completes the set", () => {
    const complete = three([answeredRight, answeredWrong, answeredRight]);
    expect(clusterAllowsSignal(complete, "b3").allowed).toBe(true);
  });

  it("lets a standalone widget signal immediately, exactly as before", () => {
    const members: ClusterMember[] = [{ blockId: "solo", intent: question("1"), state: answeredRight }];
    const result = clusterAllowsSignal(members, "solo");
    expect(result.allowed).toBe(true);
    expect(result.cluster).toBeNull();
  });

  it("holds the signal when the agent declared more widgets than rendered", () => {
    // The agent said three; only two made it onto the board. Completing both
    // must not report the set as finished.
    const members: ClusterMember[] = [
      { blockId: "b1", intent: question("1", "g1", { size: 3 }), state: answeredRight },
      { blockId: "b2", intent: question("2", "g1", { size: 3 }), state: answeredRight },
    ];
    const cluster = summarizeCluster(members, "g1")!;
    expect(cluster.required).toBe(3);
    expect(cluster.complete).toBe(false);
    expect(clusterAllowsSignal(members, "b2").allowed).toBe(false);
  });

  it("uses the real count when it exceeds the declared size", () => {
    const members: ClusterMember[] = [
      { blockId: "b1", intent: question("1", "g1", { size: 1 }), state: answeredRight },
      { blockId: "b2", intent: question("2", "g1", { size: 1 }) },
    ];
    expect(summarizeCluster(members, "g1")!.required).toBe(2);
  });

  it("keeps two clusters on one board independent", () => {
    const members: ClusterMember[] = [
      { blockId: "a1", intent: question("1", "gA"), state: answeredRight },
      { blockId: "b1", intent: question("2", "gB"), state: answeredRight },
      { blockId: "b2", intent: question("3", "gB") },
    ];
    expect(clusterAllowsSignal(members, "a1").allowed).toBe(true);
    expect(clusterAllowsSignal(members, "b1").allowed).toBe(false);
    expect(collectClusters(members).map((c) => c.groupId)).toEqual(["gA", "gB"]);
  });

  it("reports an unknown block as not allowed rather than throwing", () => {
    expect(clusterAllowsSignal([], "missing").allowed).toBe(false);
  });
});

describe("cluster progress shown to the learner", () => {
  it("explains why answering has not produced a reply yet", () => {
    const members: ClusterMember[] = [
      { blockId: "b1", intent: question("1", "g1"), state: answeredRight },
      { blockId: "b2", intent: question("2", "g1") },
      { blockId: "b3", intent: question("3", "g1") },
    ];
    const text = clusterProgressText(summarizeCluster(members, "g1")!);
    expect(text).toContain("1 of 3");
    expect(text).toMatch(/2 more/);
  });

  it("says nothing for a cluster of one", () => {
    const members: ClusterMember[] = [{ blockId: "b1", intent: question("1", "g1") }];
    expect(clusterProgressText(summarizeCluster(members, "g1")!)).toBe("");
  });
});

describe("the tutor turn a completed cluster produces", () => {
  const members = [
    { intent: question("1", "g1"), state: answeredRight },
    { intent: question("2", "g1"), state: answeredWrong },
    { intent: question("3", "g1"), state: answeredRight },
  ];

  it("carries every answer in one message", () => {
    const message = buildClusterSignalMessage(members, "understand", "Check yourself");
    expect(message).toContain("(1/3)");
    expect(message).toContain("(2/3)");
    expect(message).toContain("(3/3)");
    expect(message).toContain("Check yourself");
  });

  it("names the contrast between right and wrong as the diagnosis", () => {
    const message = buildClusterSignalMessage(members, "understand");
    expect(message).toMatch(/2 of 3 graded answers are right/);
    expect(message).toMatch(/what the wrong ones share/i);
  });

  it("tells the agent to look upstream when everything is wrong", () => {
    const allWrong = members.map((m) => ({ ...m, state: answeredWrong }));
    expect(buildClusterSignalMessage(allWrong, "understand")).toMatch(/single misconception that explains ALL/);
  });

  it("refuses to treat a clean sweep as proof on its own", () => {
    const allRight = members.map((m) => ({ ...m, state: answeredRight }));
    const message = buildClusterSignalMessage(allRight, "understand");
    expect(message).toMatch(/sound rather than lucky/);
    expect(message).toMatch(/not proof of it/);
  });

  it("demands one reply for the whole set", () => {
    expect(buildClusterSignalMessage(members, "apply")).toMatch(/in ONE reply/);
  });

  it("never leaks correctness into the learner-facing transcript line", () => {
    const shown = buildClusterSignalDisplayText(members, "Check yourself");
    expect(shown).toContain("Check yourself");
    expect(shown).not.toMatch(/correct|wrong|right/i);
  });
});

describe("group validation", () => {
  const withGroup = (group: unknown) => validateWidgetIntent({ ...question("1"), group });

  it("accepts a well-formed group on any widget", () => {
    expect(withGroup({ id: "set-1", label: "Check yourself", size: 3 }).valid).toBe(true);
  });

  it("accepts a widget with no group at all", () => {
    expect(validateWidgetIntent(question("1")).valid).toBe(true);
  });

  it("rejects a group with no id", () => {
    expect(withGroup({ label: "Nameless" }).valid).toBe(false);
  });

  it("rejects a size that would silence the tutor for the session", () => {
    expect(withGroup({ id: "set-1", size: 500 }).valid).toBe(false);
    expect(withGroup({ id: "set-1", size: 0 }).valid).toBe(false);
    expect(withGroup({ id: "set-1", size: 2.5 }).valid).toBe(false);
  });

  it("rejects a non-object group", () => {
    expect(withGroup("set-1").valid).toBe(false);
  });
});
