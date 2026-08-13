import { describe, it, expect } from "vitest";
import { pruneSnapshotsForStorage } from "./StudyRoom";
import type { BoardSnapshot, ChatMsg } from "./BoardPanels";
import type { BoardDoc } from "../../data/boards";

/**
 * Board snapshots attached to chat messages are what let a revert roll the
 * chalkboard back with the conversation. Two properties matter:
 *
 *  1. They must not grow the saved session without bound — a snapshot is a full
 *     clone of every board, and localStorage is ~5MB.
 *  2. Dropping an old snapshot must degrade gracefully: the message stays
 *     revertable, it just reverts the transcript alone.
 */

const board = (id: string, text: string): BoardDoc => ({
  id,
  title: "Polar coordinates",
  subtitle: "",
  domain: "math",
  blocks: [{ id: `${id}-b1`, kind: "text", text }],
});

const snapshot = (text: string): BoardSnapshot => ({
  boards: [board("b1", text)],
  activeId: "b1",
});

function transcript(count: number): ChatMsg[] {
  return Array.from({ length: count }, (_, index) => ({
    id: index + 1,
    role: (index % 2 === 0 ? "user" : "tutor") as ChatMsg["role"],
    text: `message ${index + 1}`,
    ...(index % 2 === 0 ? { boardSnapshot: snapshot(`state ${index + 1}`) } : {}),
  }));
}

describe("persisting board snapshots", () => {
  it("keeps every snapshot in a short session", () => {
    const pruned = pruneSnapshotsForStorage(transcript(6));
    expect(pruned.filter((message) => message.boardSnapshot).length).toBe(3);
  });

  it("caps snapshots on a long session so localStorage cannot blow up", () => {
    // 100 messages → 50 user turns → 50 full board clones without a cap.
    const pruned = pruneSnapshotsForStorage(transcript(100));
    expect(pruned.filter((message) => message.boardSnapshot).length).toBe(12);
  });

  it("keeps the MOST RECENT snapshots, which are the ones worth reverting to", () => {
    const pruned = pruneSnapshotsForStorage(transcript(100));
    const withSnapshots = pruned.filter((message) => message.boardSnapshot).map((message) => message.id);
    // Ids 1,3,5… are the user turns; the last 12 of them are 77,79,…,99.
    expect(withSnapshots).toEqual([77, 79, 81, 83, 85, 87, 89, 91, 93, 95, 97, 99]);
  });

  it("never drops a message, only its snapshot", () => {
    const messages = transcript(100);
    const pruned = pruneSnapshotsForStorage(messages);
    expect(pruned).toHaveLength(messages.length);
    expect(pruned.map((message) => message.id)).toEqual(messages.map((message) => message.id));
    expect(pruned.map((message) => message.text)).toEqual(messages.map((message) => message.text));
  });

  it("strips transient image data, which is never persisted", () => {
    const pruned = pruneSnapshotsForStorage([
      { id: 1, role: "user", text: "look at this", imageData: "data:image/png;base64,AAAA" },
    ]);
    expect(pruned[0]).not.toHaveProperty("imageData");
  });

  it("leaves a snapshot-free transcript untouched", () => {
    const messages: ChatMsg[] = [
      { id: 1, role: "user", text: "hello" },
      { id: 2, role: "tutor", text: "hi" },
    ];
    expect(pruneSnapshotsForStorage(messages)).toEqual(messages);
  });
});

describe("snapshot isolation", () => {
  it("is immune to later board mutation once captured", () => {
    // The real capture deep-clones. This pins WHY: a shallow copy would let a
    // later board op rewrite history, so reverting would restore the present.
    const live = [board("b1", "original")];
    const captured: BoardSnapshot = { boards: structuredClone(live), activeId: "b1" };

    const block = live[0].blocks[0];
    if (block.kind === "text") block.text = "mutated by a later board op";

    const restored = captured.boards[0].blocks[0];
    expect(restored.kind === "text" && restored.text).toBe("original");
  });
});
