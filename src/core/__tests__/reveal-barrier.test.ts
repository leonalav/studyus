/**
 * Law 1 enforcement — the test everything else depends on (§7.5, §20).
 */

import { describe, expect, it } from "vitest";
import type { Exercise, ExercisePrompt, Input } from "../types";
import { buildPrompt } from "../prompt";
import { buildExercise, drawBinding, generateExercise } from "../generate";
import type { SeenTable } from "../generate";
import { seededRng } from "../rng";
import { Session } from "../session";
import { MemoryStore, type Store, type PersistedState } from "../store";
import { STUDYUS_PYTHON_PACK } from "../../pack/studyus-python";
import { CUSTOM_DETECTORS } from "../../pack/studyus-python";
import { VOICE_EN } from "../../pack/voice-en";

function memorySeen(): SeenTable & { hashes: Map<string, Set<number>> } {
  const hashes = new Map<string, Set<number>>();
  return {
    hashes,
    isSeen: (t, h) => hashes.get(t)?.has(h) ?? false,
    markSeen: (t, h) => {
      if (!hashes.has(t)) hashes.set(t, new Set());
      hashes.get(t)!.add(h);
    },
    seenCount: (t) => hashes.get(t)?.size ?? 0,
  };
}

/** collect everything the learner must never see before committing */
function forbiddenStrings(exercise: Exercise): string[] {
  const out: string[] = [];
  const payload = exercise.payload;
  if (payload.beat === "predict") {
    if (payload.expected.kind === "stdout") out.push(payload.expected.text);
  } else if (payload.beat === "explain") {
    out.push(payload.rubric.exemplar);
  } else if (payload.beat === "modify") {
    if (payload.expected.kind === "stdout") out.push(payload.expected.text);
    out.push(...payload.holes.flatMap((h) => h.accept));
  } else {
    out.push(...payload.hiddenTests.map((t) => t.stdout));
    out.push(payload.referenceSolution);
  }
  return out.filter((s) => typeof s === "string" && s.length > 0);
}

/** the strings the prompt legitimately shows — secrets may overlap their literals */
function visibleStrings(prompt: ExercisePrompt, exercise: Exercise): string[] {
  const out = [prompt.skillTitle];
  const body = prompt.body;
  if (body.kind === "predict") out.push(body.program, body.question);
  if (body.kind === "explain") out.push(body.program, body.instruction);
  if (body.kind === "modify") out.push(body.programWithHoles, body.targetBehaviour);
  if (body.kind === "write") out.push(body.specification, body.dryRunInput, body.signatureHint ?? "");
  void exercise;
  return out;
}

/** recursively collect every string value in a serializable structure,
 * skipping opaque identifiers (they are references, not displayable content) */
function valuesOnly(value: unknown, skipKeys: string[] = ["exerciseId", "skillId"]): string {
  const out: string[] = [];
  const walk = (v: unknown) => {
    if (typeof v === "string") out.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") {
      for (const [key, nested] of Object.entries(v)) {
        if (!skipKeys.includes(key)) walk(nested);
      }
    }
  };
  walk(value);
  return out.join("\n");
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** a short answer leaked as a standalone token anywhere in the audited text */
function containsToken(haystack: string, token: string): boolean {
  return new RegExp(`(?<![0-9a-zA-Z])${escapeRegExp(token)}(?![0-9a-zA-Z])`).test(haystack);
}

/** consecutive word pairs of a prose secret */
function wordBigrams(text: string): string[] {
  const words = text.split(/\s+/);
  const grams: string[] = [];
  for (let i = 0; i + 1 < words.length; i += 1) grams.push(`${words[i]} ${words[i + 1]}`.toLowerCase());
  return grams;
}

describe("Law 1 — no reveal before commitment", () => {
  it("no serialized ExercisePrompt contains the expected output, across 1000 generated exercises", () => {
    const rng = seededRng(424242);
    const seen = memorySeen();
    let checked = 0;
    const beats = ["predict", "explain", "modify", "write"] as const;
    let beatIdx = 0;
    while (checked < 1000) {
      const skill = STUDYUS_PYTHON_PACK.skills[checked % STUDYUS_PYTHON_PACK.skills.length];
      const beat = beats[beatIdx % beats.length];
      beatIdx += 1;
      const result = generateExercise(STUDYUS_PYTHON_PACK, skill.id, beat, rng, seen, "none");
      if (!result) continue;
      const exercise = result.exercise;
      seen.markSeen(exercise.template, exercise.paramHash);

      for (const hadPrior of [false, true]) {
        const prompt = buildPrompt(STUDYUS_PYTHON_PACK, exercise, hadPrior);
        // audit the VALUES only (JSON keys are noise), minus what the prompt
        // legitimately shows; anything left must be secret-free
        let serialized = valuesOnly(prompt);
        for (const visible of visibleStrings(prompt, exercise)) {
          if (visible) serialized = serialized.split(visible).join("");
        }
        for (const secret of forbiddenStrings(exercise)) {
          if (secret.length <= 6) {
            // short numeric answers: must not appear as a standalone token
            expect(containsToken(serialized, secret), `leaked answer "${secret}" in ${exercise.beat}/${exercise.skill}`).toBe(false);
            const choiceTexts = prompt.choices?.map((c) => c.text) ?? [];
            if (secret.length < 3) expect(choiceTexts).not.toContain(secret);
          } else {
            // prose secrets (exemplars, solutions): no full copy, no two-word fragment
            expect(serialized, `leaked secret in ${exercise.beat}/${exercise.skill}`).not.toContain(secret);
            for (const gram of wordBigrams(secret)) {
              expect(serialized.toLowerCase(), `leaked fragment "${gram}" in ${exercise.beat}/${exercise.skill}`).not.toContain(gram);
            }
          }
        }
      }
      checked += 1;
    }
    expect(checked).toBe(1000);
  });

  it("Exercise prompts never carry rubric, accepted fills, hidden-test outputs, or reference solutions (type + runtime audit)", () => {
    // runtime audit of every beat with a fixed binding
    const template = STUDYUS_PYTHON_PACK.templates[0];
    const binding = drawBinding(template, seededRng(7));
    for (const beat of ["predict", "explain", "modify", "write"] as const) {
      const exercise = buildExercise(STUDYUS_PYTHON_PACK, template, beat, binding, 123, "none");
      expect(exercise).toBeTruthy();
      const prompt = buildPrompt(STUDYUS_PYTHON_PACK, exercise!, true);
      const serialized = JSON.stringify(prompt);
      expect(serialized).not.toContain("referenceSolution");
      expect(serialized).not.toContain("rubric");
      expect(serialized).not.toContain("accept");
      expect(serialized).not.toContain("hiddenTests");
      expect(serialized).not.toContain("expected");
    }
  });
});

function freshSession(store?: Store): Session {
  return Session.open({
    pack: STUDYUS_PYTHON_PACK,
    store: store ?? new MemoryStore(),
    voice: VOICE_EN,
    customDetectors: CUSTOM_DETECTORS,
    seed: 99,
  });
}

describe("§8 invariants — the state machine", () => {
  it("View::Revealed is unreachable without Input::Commit — every other input from Prompting", () => {
    const session = freshSession();
    expect(session.view().kind).toBe("cold-open");
    const nonCommitInputs: Input[] = [
      { type: "continue" },
      { type: "request-scaffold" },
      { type: "skip" },
      { type: "open-map" },
      { type: "close-map" },
      { type: "quit" },
    ];
    for (const input of nonCommitInputs) {
      const s = freshSession();
      try {
        const transition = s.input(input);
        expect(transition.view.kind).not.toBe("revealed");
      } catch {
        // inputs that are invalid from cold-open must throw, never reveal
      }
      expect(s.view().kind).not.toBe("revealed");
    }
  });

  it("Input::Commit persists the attempt BEFORE constructing the reveal; persistence failure ⇒ no reveal", () => {
    class FailingStore implements Store {
      private state: PersistedState = new MemoryStore().load();
      fail = false;
      load() {
        return this.state;
      }
      save(state: PersistedState) {
        if (this.fail) throw new Error("disk full");
        this.state = state;
      }
    }
    const store = new FailingStore();
    const session = Session.open({
      pack: STUDYUS_PYTHON_PACK,
      store,
      voice: VOICE_EN,
      customDetectors: CUSTOM_DETECTORS,
    });
    store.fail = true;
    expect(() =>
      session.input({ type: "commit", response: { kind: "text", text: "6" }, elapsedMs: 100 }),
    ).toThrow(/could not be saved/);
    // no reveal produced — the machine is still prompting
    expect(session.view().kind).toBe("cold-open");
  });

  it("View::ColdOpen is produced only when the store contains zero attempts", () => {
    expect(freshSession().view().kind).toBe("cold-open");
    // after one commit, a fresh session on the same store never cold-opens
    const store = new MemoryStore();
    const s1 = freshSession(store);
    s1.input({ type: "commit", response: { kind: "text", text: "6" }, elapsedMs: 50 });
    const s2 = freshSession(store);
    expect(s2.view().kind).not.toBe("cold-open");
  });

  it("RequestScaffold never reveals — it softens the scaffold and re-issues the prompt", () => {
    // crafted store: one predict attempt on py.vars.assignment, low p_L, so the
    // selector serves that skill's predict beat at scaffold 'none'.
    const store = new MemoryStore();
    const state = store.load();
    state.firstUseAt = 1;
    state.attempts.push({
      id: "att-seed",
      exercise: "ex-seed",
      skill: "py.vars.assignment",
      beat: "predict",
      submittedAt: 1,
      response: { kind: "text", text: "1" },
      judgement: { outcome: { kind: "incorrect" }, detail: "seed", confidence: "exact" },
      elapsedMs: 1,
      scaffold: "none",
      scaffoldRequested: false,
      correct: false,
    });
    state.bkt["py.vars.assignment"] = { predict: { p: 0.2, attempts: 1, correct: 0, lastAt: 1 } };
    store.save(state);

    const session = freshSession(store);
    const view = session.view();
    expect(view.kind).toBe("prompting");
    if (view.kind !== "prompting") throw new Error("unreachable");
    expect(view.prompt.scaffold).toBe("none");
    expect(view.prompt.choices).toBeUndefined();

    const transition = session.input({ type: "request-scaffold" });
    expect(transition.view.kind).toBe("prompting"); // never 'revealed'
    if (transition.view.kind !== "prompting") throw new Error("unreachable");
    expect(transition.view.prompt.scaffold).toBe("hinted");
    expect(transition.view.prompt.choices?.length).toBeGreaterThan(1);
    // no attempt was recorded by the request itself
    expect(store.load().attempts.length).toBe(1);
  });

  it("beat ordering is strict — no Write before a passed Modify, no Explain before a Predict attempt", () => {
    const store = new MemoryStore();
    const session = freshSession(store);
    // run the machine for a while; audit the store after each transition
    for (let i = 0; i < 30; i += 1) {
      const view = session.view();
      if (view.kind === "prompting" || view.kind === "cold-open") {
        const prompt = view.prompt;
        const state = store.load();
        const skillAttempts = state.attempts.filter((a) => a.skill === prompt.skillId);
        if (prompt.beat === "explain") {
          expect(skillAttempts.some((a) => a.beat === "predict")).toBe(true);
        }
        if (prompt.beat === "modify") {
          expect(skillAttempts.some((a) => a.beat === "explain")).toBe(true);
        }
        if (prompt.beat === "write") {
          expect(skillAttempts.some((a) => a.beat === "modify" && a.correct)).toBe(true);
        }
        session.input({
          type: "commit",
          response:
            prompt.body.kind === "predict" || prompt.body.kind === "explain"
              ? { kind: "text", text: "placeholder" }
              : prompt.body.kind === "modify"
              ? { kind: "holes", fills: ["x"] }
              : { kind: "source", source: "print(1)", dryRun: "1" },
          elapsedMs: 10,
        });
        session.input({ type: "continue" });
      } else if (view.kind === "reading") {
        session.input({ type: "continue" });
      } else if (view.kind === "done") {
        break;
      } else {
        session.input({ type: "continue" });
      }
    }
  });
});
