/**
 * §20 snapshot tests — the web analog of the plan's `insta` requirement.
 * Tutor output is snapshotted so any voice change is visible in review.
 *
 * Determinism: fixed clock, fixed rng seed, and pinned attempt ids (voice
 * lines are chosen by hashing the attempt id, §14.1).
 */

import { describe, expect, it } from "vitest";
import { Session, type SessionDeps } from "../session";
import { MemoryStore } from "../store";
import { STUDYUS_PYTHON_PACK, CUSTOM_DETECTORS } from "../../pack/studyus-python";
import { VOICE_EN } from "../../pack/voice-en";
import type { ExerciseReveal, Response } from "../types";

const CLOCK = 1_750_000_000_000;

function deps(store: MemoryStore): SessionDeps {
  let n = 0;
  return {
    pack: STUDYUS_PYTHON_PACK,
    store,
    voice: VOICE_EN,
    customDetectors: CUSTOM_DETECTORS,
    seed: 20260806,
    now: () => CLOCK,
    ids: () => `att-fixed-${++n}`,
  };
}

/** the voice-facing surface of a reveal — ids excluded, lines preserved */
function voiceSurface(reveal: ExerciseReveal) {
  return {
    beat: reveal.beat,
    outcome: reveal.judgement.outcome,
    confidence: reveal.judgement.confidence,
    tutorLine: reveal.tutorLine,
    actual: reveal.actual,
    misconception: reveal.misconceptionLabel ?? null,
    misconceptionHelp: reveal.misconceptionHelp ?? null,
    confidenceNote: reveal.confidenceNote ?? null,
    surfaceNote: reveal.surfaceNote ?? null,
    deeperLine: reveal.deeperLine ?? null,
  };
}

function commit(session: Session, response: Response): ExerciseReveal {
  const t = session.input({ type: "commit", response, elapsedMs: 1000 });
  if (t.view.kind !== "revealed") throw new Error(`expected reveal, got ${t.view.kind}`);
  return t.view.reveal;
}

describe("tutor voice snapshots (§20 — voice changes must be visible in review)", () => {
  it("contradiction with the off-by-one misconception detected", () => {
    const store = new MemoryStore();
    const session = Session.open(deps(store));
    const reveal = commit(session, { kind: "text", text: "10" });
    expect(reveal.matchedMisconception).toBe("range-includes-upper");
    expect(reveal.tutorLine.trim().endsWith("?")).toBe(true);
    expect(voiceSurface(reveal)).toMatchSnapshot();
  });

  it("contradiction with no known misconception matched", () => {
    const store = new MemoryStore();
    const session = Session.open(deps(store));
    const reveal = commit(session, { kind: "text", text: "42" });
    expect(reveal.matchedMisconception).toBeUndefined();
    expect(reveal.tutorLine.trim().endsWith("?")).toBe(true);
    expect(voiceSurface(reveal)).toMatchSnapshot();
  });

  it("confirmation on a correct cold-open commitment", () => {
    const store = new MemoryStore();
    const session = Session.open(deps(store));
    const reveal = commit(session, { kind: "text", text: "6" });
    expect(reveal.judgement.outcome.kind).toBe("correct");
    expect(voiceSurface(reveal)).toMatchSnapshot();
  });

  it("explain verdict — heuristic caveat and exemplar, always", () => {
    const store = new MemoryStore();
    const session = Session.open(deps(store));
    commit(session, { kind: "text", text: "6" });
    session.input({ type: "continue" });
    const reveal = commit(session, { kind: "text", text: "it adds up 0 1 2 3 and prints the total" });
    expect(reveal.judgement.confidence).toBe("heuristic");
    expect(voiceSurface(reveal)).toMatchSnapshot();
  });

  it("multistructural explanation — prompted, not failed", () => {
    const store = new MemoryStore();
    const session = Session.open(deps(store));
    commit(session, { kind: "text", text: "6" });
    session.input({ type: "continue" });
    const reveal = commit(session, {
      kind: "text",
      text: "first it sets total to zero, then it starts the loop, then next it adds i, and after that it prints the value line by line",
    });
    expect(reveal.judgement.outcome.kind).toBe("ungraded");
    expect(voiceSurface(reveal)).toMatchSnapshot();
  });
});
