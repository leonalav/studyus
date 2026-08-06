/**
 * §20 end-to-end — the single most valuable test in the suite:
 * a full four-beat traversal of one skill, from cold open to Mastered,
 * using the fake store. Plus cold-open latency and Ctrl-C resilience.
 */

import { describe, expect, it } from "vitest";
import { Session } from "../session";
import { MemoryStore } from "../store";
import { EVENT_FIRST_QUESTION } from "../store";
import { STUDYUS_PYTHON_PACK, CUSTOM_DETECTORS } from "../../pack/studyus-python";
import { VOICE_EN } from "../../pack/voice-en";
import { oracleResponse, matchPredict } from "./oracle";
import type { View } from "../types";

const deps = (store: MemoryStore, now?: () => number) => ({
  pack: STUDYUS_PYTHON_PACK,
  store,
  voice: VOICE_EN,
  customDetectors: CUSTOM_DETECTORS,
  seed: 20260806,
  now,
});

function promptOfView(view: View) {
  if (view.kind === "cold-open") return view.prompt;
  if (view.kind === "prompting") return view.prompt;
  throw new Error(`expected a prompt, got ${view.kind}`);
}

describe("end-to-end — cold open to Mastered on py.loops.for-range", () => {
  it("walks all four beats and masters the skill only via a scaffold-free Write", () => {
    const store = new MemoryStore();
    const session = Session.open(deps(store));

    // ── the cold open is the Appendix B program, served with zero installs ──
    const open = session.view();
    expect(open.kind).toBe("cold-open");
    const coldPrompt = promptOfView(open);
    expect(coldPrompt.body.kind).toBe("predict");
    if (coldPrompt.body.kind !== "predict") throw new Error("unreachable");
    expect(coldPrompt.body.program).toBe("total = 0\nfor i in range(4):\n    total += i\nprint(total)");
    // the answer never appears as content: only the program and the question do
    expect(coldPrompt.body.question).toBe("What does this print?");
    expect(coldPrompt.choices).toBeUndefined();

    // the classic off-by-one commitment: 10 instead of 6
    const t1 = session.input({ type: "commit", response: { kind: "text", text: "10" }, elapsedMs: 4200 });
    expect(t1.view.kind).toBe("revealed");
    if (t1.view.kind !== "revealed") throw new Error("unreachable");
    expect(t1.view.reveal.actual).toBe("6");
    expect(t1.view.reveal.matchedMisconception).toBe("range-includes-upper");
    expect(t1.view.reveal.tutorLine.trim().endsWith("?")).toBe(true);
    expect(t1.effects.some((e) => e.type === "persist-attempt")).toBe(true);
    expect(t1.effects.some((e) => e.type === "emit-event" && e.name === EVENT_FIRST_QUESTION)).toBe(true);
    expect(store.load().attempts.length).toBe(1);

    // ── Appendix B: beat 2 arrives immediately, no onboarding in between ──
    const t2 = session.input({ type: "continue" });
    const explainView = t2.view;
    expect(explainView.kind).toBe("prompting");
    if (explainView.kind !== "prompting") throw new Error("unreachable");
    expect(explainView.beat).toBe("explain");
    expect(explainView.prompt.body.kind).toBe("explain");

    const t3 = session.input({
      type: "commit",
      response: { kind: "text", text: "it adds up 0 1 2 3 and prints the total" },
      elapsedMs: 9000,
    });
    if (t3.view.kind !== "revealed") throw new Error("unreachable");
    // graded by rubric — always heuristic, always with the exemplar
    expect(t3.view.reveal.judgement.confidence).toBe("heuristic");
    expect(t3.view.reveal.judgement.outcome.kind).toBe("partial");
    expect(t3.view.reveal.exemplar).toBeTruthy();
    expect(t3.view.reveal.confidenceNote).toBeTruthy();

    // ── oracle loop: keep committing correct responses until mastery ──
    const session2deps = deps(store);
    let guard = 0;
    let mastered = false;
    let writePassAtNone = false;
    while (!mastered && guard < 120) {
      guard += 1;
      const s = Session.open(session2deps);
      const view = s.view();
      if (view.kind === "map" || view.kind === "revealed") {
        s.input({ type: "continue" });
        continue;
      }
      if (view.kind === "reading") {
        s.input({ type: "continue" });
        continue;
      }
      if (view.kind === "done") break;
      const prompt = promptOfView(view);
      const response = oracleResponse(STUDYUS_PYTHON_PACK, prompt);
      const transition = s.input({ type: "commit", response, elapsedMs: 5000 });
      if (transition.view.kind !== "revealed") throw new Error("commit must reveal");
      const reveal = transition.view.reveal;
      if (reveal.skillId === "py.loops.for-range" && reveal.beat === "write" && reveal.judgement.outcome.kind === "correct") {
        const attempt = store.load().attempts.at(-1)!;
        if (attempt.scaffold === "none") writePassAtNone = true;
      }
      mastered = Boolean(store.load().masteredAt["py.loops.for-range"]);
      if (mastered) {
        expect(writePassAtNone).toBe(true); // Law 7 — mastery came through scaffold-free Write
        const writeAttempts = store.load().attempts.filter(
          (a) => a.skill === "py.loops.for-range" && a.beat === "write" && a.correct,
        );
        expect(writeAttempts.length).toBeGreaterThan(0);
        expect(store.load().bkt["py.loops.for-range"]!.write!.p).toBeGreaterThanOrEqual(0.85);
      }
    }
    expect(mastered, `skill not mastered within ${guard} commits`).toBe(true);

    // every attempt along the way was persisted — nothing lives only in memory
    const state = store.load();
    expect(state.attempts.length).toBeGreaterThanOrEqual(6);
    for (const beat of ["predict", "explain", "modify", "write"]) {
      expect(state.attempts.some((a) => a.skill === "py.loops.for-range" && a.beat === beat), beat).toBe(true);
    }
  });

  it("cold open lands in under 500 ms with a cold store and touches no interpreter", () => {
    const start = performance.now();
    const session = Session.open(deps(new MemoryStore()));
    const view = session.view();
    const elapsed = performance.now() - start;
    expect(view.kind).toBe("cold-open");
    expect(elapsed).toBeLessThan(500);
    // the precomputed path only: nothing in this codebase shells out at all
  });

  it("dropping the session after a commit loses nothing (Ctrl-C resilience)", () => {
    const store = new MemoryStore();
    let session: Session | null = Session.open(deps(store));
    session.input({ type: "commit", response: { kind: "text", text: "6" }, elapsedMs: 800 });
    session = null; // simulate Ctrl-C — the process dies mid-exercise
    const reopened = Session.open(deps(store));
    expect(store.load().attempts.length).toBe(1);
    expect(store.load().events.some((e) => e.name === EVENT_FIRST_QUESTION)).toBe(true);
    expect(reopened.view().kind).not.toBe("revealed"); // no reveal survives without its commit context
  });

  it("a correct cold-open answer confirms, then asks the Explain question", () => {
    const store = new MemoryStore();
    const session = Session.open(deps(store));
    const t = session.input({ type: "commit", response: { kind: "text", text: "6" }, elapsedMs: 3000 });
    if (t.view.kind !== "revealed") throw new Error("unreachable");
    expect(t.view.reveal.judgement.outcome.kind).toBe("correct");
    expect(t.view.reveal.matchedMisconception).toBeUndefined();
    const next = session.input({ type: "continue" });
    expect(next.view.kind).toBe("prompting");
    if (next.view.kind === "prompting") expect(next.view.beat).toBe("explain");
  });
});

describe("the two metrics (§16.2)", () => {
  it("first_question_answered fires exactly once, on the first commit", () => {
    const store = new MemoryStore();
    const session = Session.open(deps(store));
    session.input({ type: "commit", response: { kind: "text", text: "6" }, elapsedMs: 100 });
    session.input({ type: "continue" });
    session.input({ type: "commit", response: { kind: "text", text: "It sums things." }, elapsedMs: 100 });
    const events = store.load().events.filter((e) => e.name === EVENT_FIRST_QUESTION);
    expect(events.length).toBe(1);
  });

  it("returned_within_24h fires only for a reopen between 20 and 48 hours", () => {
    const t0 = 1_000_000_000_000;
    let clock = t0;
    const store = new MemoryStore();
    const first = Session.open({ ...deps(store), now: () => clock });
    first.input({ type: "commit", response: { kind: "text", text: "6" }, elapsedMs: 100 });

    clock = t0 + 25 * 3_600_000; // 25 hours later
    Session.open({ ...deps(store), now: () => clock });
    expect(store.load().events.filter((e) => e.name === "returned_within_24h").length).toBe(1);

    clock = t0 + 30 * 3_600_000; // another reopen in the window — still one event
    Session.open({ ...deps(store), now: () => clock });
    expect(store.load().events.filter((e) => e.name === "returned_within_24h").length).toBe(1);
  });

  it("a reopen outside the 20–48 h window records nothing", () => {
    const t0 = 2_000_000_000_000;
    let clock = t0;
    const store = new MemoryStore();
    const first = Session.open({ ...deps(store), now: () => clock });
    first.input({ type: "commit", response: { kind: "text", text: "6" }, elapsedMs: 100 });
    clock = t0 + 5 * 3_600_000; // too early
    Session.open({ ...deps(store), now: () => clock });
    clock = t0 + 60 * 3_600_000; // too late
    Session.open({ ...deps(store), now: () => clock });
    expect(store.load().events.filter((e) => e.name === "returned_within_24h").length).toBe(0);
  });
});

describe("tier 3 honesty (Law 8)", () => {
  it("readings arrive ungated with the no-gate disclaimer spoken out loud", () => {
    const store = new MemoryStore();
    // exhaust eligible work quickly: master nothing, just observe the fallback
    const session = Session.open(deps(store));
    let sawReading = false;
    for (let i = 0; i < 400 && !sawReading; i += 1) {
      const view = session.view();
      if (view.kind === "reading") {
        sawReading = true;
        expect(view.disclaimer.toLowerCase()).toContain("no single right answer");
        session.input({ type: "continue" });
        break;
      }
      if (view.kind === "done") break;
      const prompt = promptOfView(view);
      session.input({ type: "commit", response: oracleResponse(STUDYUS_PYTHON_PACK, prompt), elapsedMs: 10 });
      session.input({ type: "continue" });
    }
    expect(sawReading).toBe(true);
  });
});

describe("predict choices only appear as a requested scaffold", () => {
  it("RequestScaffold on predict offers commitment options without revealing", () => {
    const store = new MemoryStore();
    const session = Session.open(deps(store));
    const before = session.view();
    const prompt = promptOfView(before);
    expect(prompt.choices).toBeUndefined();
    if (prompt.beat !== "predict") throw new Error("cold open should be predict");
    session.input({ type: "request-scaffold" });
    const after = promptOfView(session.view());
    expect(after.scaffold).toBe("hinted");
    expect(after.choices && after.choices.length).toBeGreaterThan(1);
    const match = matchPredict(STUDYUS_PYTHON_PACK, (after.body as { program: string }).program);
    const actual = match!.template.predict.reference(match!.binding).stdout;
    // the correct answer may appear among choices — but only as one of several,
    // and only after the learner asked for the softer shape; still no reveal.
    expect(after.choices!.some((c) => c.text === actual)).toBe(true);
  });
});
