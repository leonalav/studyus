/**
 * The session state machine (§8) — the ENTIRE contract between core and
 * frontend. Frontends contain zero pedagogy: they render `View`s and send
 * `Input`s.
 *
 * Mandatory ordering invariants enforced here (each has a test):
 *  1. View::Revealed can only be produced by Input::Commit.
 *  2. Commit persists the Attempt BEFORE constructing the reveal; if
 *     persistence throws, no reveal is produced.
 *  3. RequestScaffold never reveals; it softens the scaffold, re-issues the
 *     prompt, and records the request (mastery-relevant, §13.4).
 *  4. Beat ordering is strict: no Explain before a Predict attempt, no Write
 *     before a passed Modify.
 *  5. View::ColdOpen only when the store holds zero attempts.
 */

import type {
  Attempt,
  Beat,
  CapabilityMap,
  Effect,
  Exercise,
  ExercisePrompt,
  ExerciseReveal,
  Input,
  Judgement,
  Misconception,
  Response,
  SkillId,
  SkillMapNode,
  Tier3Content,
  Transition,
  View,
} from "./types";
import { BEAT_ORDER, CoreError, paramHashOf, uid } from "./types";
import type { Pack } from "./template";
import { paramSpaceSize } from "./template";
import { buildPrompt } from "./prompt";
import { bktUpdate, initBktState } from "./bkt";
import type { BktState } from "./bkt";
import { applyFading, fadeDown, initialScaffold } from "./fading";
import { isMastered, skillGateState, REVIEW_INTERVAL_DAYS } from "./mastery";
import { selectNext, type Candidate } from "./select";
import { gradeExplain, gradeModify, gradePredict, gradeWrite } from "./grading";
import type { CustomDetectorRegistry, ModifyJudgement, WriteJudgement } from "./grading";
import type { Rng } from "./rng";
import { seededRng } from "./rng";
import type { PersistedState, Store } from "./store";
import { EVENT_FIRST_QUESTION, EVENT_RETURNED_24H } from "./store";
import { buildExercise, generateExercise } from "./generate";
import type { VoiceFile } from "../pack/voice-en";
import { fillLine, pickLine } from "../pack/voice-en";

export interface SessionDeps {
  pack: Pack;
  store: Store;
  rng?: Rng;
  now?: () => number;
  voice: VoiceFile;
  customDetectors: CustomDetectorRegistry;
  /** seed for reproducible generation */
  seed?: number;
  /** deterministic id source — lets tests pin attempt ids (reproducible voice selection) */
  ids?: () => string;
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const TIER3_REVISIT = 7 * DAY;
/** a Partial score at or above this counts as a pass for BKT and fading */
const PARTIAL_PASS_THRESHOLD = 0.6;

interface GradeResult {
  judgement: Judgement;
  modify?: ModifyJudgement;
  write?: WriteJudgement;
  multistructural?: boolean;
}

type ViewKind = "cold-open" | "prompting" | "revealed" | "reading" | "map" | "done";

export class Session {
  private state: PersistedState;
  private pending: Exercise | null = null;
  private lastCommitted: Exercise | null = null;
  private reveal: ExerciseReveal | null = null;
  private reading: Tier3Content | null = null;
  private viewKind: ViewKind = "done";
  private mapReturn: "prompting" | "select" = "select";
  private scaffoldRequested = false;
  private explainRetries = 0;
  private rng: Rng;

  private constructor(private deps: SessionDeps) {
    this.state = deps.store.load();
    this.rng = deps.rng ?? seededRng(deps.seed ?? 20260806);
  }

  static open(deps: SessionDeps): Session {
    const session = new Session(deps);
    const now = session.now();
    let dirty = false;
    if (!session.state.firstUseAt) {
      session.state.firstUseAt = now;
      dirty = true;
    } else {
      // §16.2 metric 2: reopened between 20 and 48 hours after first use
      const elapsed = now - session.state.firstUseAt;
      const recorded = session.state.events.some((e) => e.name === EVENT_RETURNED_24H);
      if (!recorded && elapsed >= 20 * HOUR && elapsed <= 48 * HOUR) {
        session.state.events.push({ name: EVENT_RETURNED_24H, at: now });
        dirty = true;
      }
    }
    if (dirty) session.persist();

    if (session.state.attempts.length === 0) session.beginColdOpen();
    else session.advance();
    return session;
  }

  /** What the frontend should display right now. */
  view(): View {
    switch (this.viewKind) {
      case "cold-open":
        return { kind: "cold-open", prompt: this.promptOf(this.pending!) };
      case "prompting":
        return {
          kind: "prompting",
          prompt: this.promptOf(this.pending!),
          beat: this.pending!.beat,
          tier: this.pending!.tier,
          skill: this.skillSummary(this.pending!.skill),
        };
      case "revealed":
        return { kind: "revealed", reveal: this.reveal!, next: "continue" };
      case "reading":
        return {
          kind: "reading",
          tier3: this.reading!,
          disclaimer: this.deps.voice.tier3Disclaimer[0],
        };
      case "map":
        return {
          kind: "map",
          capability: this.capabilityMap(),
          resume: this.mapReturn === "prompting" && this.pending ? this.promptOf(this.pending) : undefined,
          beat: this.mapReturn === "prompting" ? this.pending?.beat : undefined,
        };
      case "done":
        return {
          kind: "done",
          summary: { reason: this.deps.voice.nothingDue, masteredTitles: this.masteredTitles() },
        };
    }
  }

  /** Advance the machine. The ONLY mutation entry point. */
  input(input: Input): Transition {
    const effects: Effect[] = [];
    switch (input.type) {
      case "commit": {
        if ((this.viewKind !== "prompting" && this.viewKind !== "cold-open") || !this.pending) {
          throw new CoreError("nothing to commit");
        }
        const reveal = this.commit(input.response, input.elapsedMs, effects);
        this.reveal = reveal;
        this.viewKind = "revealed";
        return { view: this.view(), effects };
      }
      case "continue": {
        if (this.viewKind === "revealed") this.afterReveal();
        else if (this.viewKind === "reading") {
          this.state.tier3ReadAt[this.reading!.id] = this.now();
          this.persist();
          this.advance();
        } else if (this.viewKind === "done") this.advance();
        else throw new CoreError("continue is not available here");
        return { view: this.view(), effects };
      }
      case "request-scaffold": {
        // invariant 3: never reveals — softens the scaffold, re-issues the
        // prompt, records the request (mastery-relevant, §13.4).
        if ((this.viewKind !== "prompting" && this.viewKind !== "cold-open") || !this.pending) {
          throw new CoreError("nothing to soften");
        }
        const softer = this.softerScaffold(this.pending);
        if (softer !== this.pending.scaffold) {
          const exercise = { ...this.pending, scaffold: softer };
          // a softened write beat may no longer show the signature hint
          this.pending = rebuildForScaffold(this.deps.pack, exercise);
          this.scaffoldRequested = true;
        }
        return { view: this.view(), effects };
      }
      case "skip": {
        if (this.viewKind !== "prompting" && this.viewKind !== "cold-open") {
          throw new CoreError("nothing to skip");
        }
        const excluded = this.pending ? `${this.pending.skill}|${this.pending.beat}` : undefined;
        this.pending = null;
        this.scaffoldRequested = false;
        this.explainRetries = 0;
        this.advance(excluded);
        return { view: this.view(), effects };
      }
      case "open-map": {
        this.mapReturn = this.viewKind === "prompting" || this.viewKind === "cold-open" ? "prompting" : "select";
        this.viewKind = "map";
        return { view: this.view(), effects };
      }
      case "close-map": {
        if (this.mapReturn === "prompting" && this.pending) {
          this.viewKind = this.state.attempts.length === 0 ? "cold-open" : "prompting";
        } else {
          this.advance();
        }
        return { view: this.view(), effects };
      }
      case "quit": {
        this.viewKind = "done";
        return {
          view: {
            kind: "done",
            summary: { reason: "Session closed — every committed attempt is already saved locally.", masteredTitles: this.masteredTitles() },
          },
          effects,
        };
      }
    }
  }

  /* ── cold open (§15.2): no menu, no dashboard, one program, one question ── */

  private beginColdOpen() {
    const template =
      this.deps.pack.templates.find((t) => t.id === "py.loops.for-range.accumulate.v1") ?? this.deps.pack.templates[0];
    const binding = template.id === "py.loops.for-range.accumulate.v1" ? { n: 4, start: 0, label: "total" } : undefined;
    const exercise = binding
      ? buildExercise(this.deps.pack, template, "predict", binding, paramHashOf(binding), "none")
      : null;
    if (!exercise) throw new CoreError("cold open exercise unavailable", "pack-invalid");
    this.pending = exercise;
    this.viewKind = "cold-open";
  }

  /* ── commit: persist FIRST, reveal SECOND (invariant 2) ── */

  private commit(response: Response, elapsedMs: number, effects: Effect[]): ExerciseReveal {
    const exercise = this.pending!;
    const skill = this.deps.pack.skills.find((s) => s.id === exercise.skill)!;
    const misconceptions = this.deps.pack.misconceptions.filter((m) => skill.misconceptions.includes(m.id));

    const result = this.grade(exercise, response, misconceptions);
    const judgement = result.judgement;
    const attemptId = this.deps.ids?.() ?? uid("att");
    const passed = outcomePasses(judgement);
    const isFirstEver = this.state.attempts.length === 0;
    const pairJustCompleted = exercise.beat === "explain" && !this.state.pairAnnounced;

    const attempt: Attempt = {
      id: attemptId,
      exercise: exercise.id,
      skill: exercise.skill,
      beat: exercise.beat,
      submittedAt: this.now(),
      response,
      judgement,
      elapsedMs,
      scaffold: exercise.scaffold,
      scaffoldRequested: this.scaffoldRequested,
    };

    // ── persistence happens BEFORE any reveal is constructed (invariant 2) ──
    this.applyMasteryUpdates(exercise, attempt, passed, effects);
    this.state.attempts.push({ ...attempt, correct: passed });
    if (isFirstEver) {
      this.state.events.push({ name: EVENT_FIRST_QUESTION, at: this.now() });
      effects.push({ type: "emit-event", name: EVENT_FIRST_QUESTION, at: this.now() });
    }
    if (pairJustCompleted) this.state.pairAnnounced = true;
    effects.push({ type: "persist-attempt", attempt });
    try {
      this.persist(); // transactional — a throw here means NO reveal (§8)
    } catch (error) {
      throw new CoreError(`attempt could not be saved: ${(error as Error).message}`, "store-failure");
    }

    const matched = misconceptions.find((m) => m.id === judgement.matchedMisconception);
    const reveal = this.buildReveal(exercise, attempt, result, matched, pairJustCompleted);

    this.lastCommitted = exercise;
    // §12.2: a multistructural explanation prompts one retry — it is not failed
    const multistructuralRetry = exercise.beat === "explain" && result.multistructural === true && this.explainRetries === 0;
    if (multistructuralRetry) {
      this.explainRetries += 1;
      this.pending = exercise; // same exercise, tried again in one sentence
      reveal.judgement = { ...judgement, outcome: { kind: "ungraded" } };
      reveal.tutorLine = pickLine(this.deps.voice.multistructuralPrompt, attemptId);
    } else {
      this.pending = null;
      this.scaffoldRequested = false;
      this.explainRetries = 0;
    }
    return reveal;
  }

  private grade(exercise: Exercise, response: Response, misconceptions: Misconception[]): GradeResult {
    switch (exercise.payload.beat) {
      case "predict":
        return { judgement: gradePredict(exercise, response, misconceptions, this.deps.customDetectors) };
      case "explain": {
        const result = gradeExplain(exercise, response, exercise.payload.rubric, exercise.payload.program.split("\n").length);
        return { judgement: result.judgement, multistructural: result.multistructural };
      }
      case "modify": {
        const result = gradeModify(exercise, response);
        return { judgement: result.judgement, modify: result };
      }
      case "write": {
        const result = gradeWrite(exercise, response);
        return { judgement: result.judgement, write: result };
      }
    }
  }

  private applyMasteryUpdates(exercise: Exercise, attempt: Attempt, passed: boolean, effects: Effect[]) {
    const now = this.now();
    const skill = this.deps.pack.skills.find((s) => s.id === attempt.skill)!;

    // BKT per (skill, beat) — §13.1; scaffold-requested attempts count at 0.5 (§13.4)
    const skillStates = (this.state.bkt[attempt.skill] ??= {});
    const previous: BktState = skillStates[attempt.beat] ?? initBktState(now);
    const weight = attempt.scaffoldRequested ? 0.5 : 1;
    skillStates[attempt.beat] = bktUpdate(previous, passed, now, undefined, weight);
    effects.push({ type: "update-skill-state", skill: attempt.skill, beat: attempt.beat });

    // adaptive fading — §13.4
    const masteredAlready = Boolean(this.state.masteredAt[attempt.skill]);
    const fading = applyFading(
      attempt.beat,
      {
        level: this.state.scaffolds[attempt.skill]?.[attempt.beat] ?? initialScaffold(attempt.beat),
        consecutiveFails: this.state.fails[attempt.skill]?.[attempt.beat] ?? 0,
      },
      passed,
      attempt.scaffoldRequested,
      masteredAlready,
    );
    (this.state.scaffolds[attempt.skill] ??= {})[attempt.beat] = fading.level;
    (this.state.fails[attempt.skill] ??= {})[attempt.beat] = fading.consecutiveFails;

    // Law 7 gate — a Write pass at ScaffoldLevel 'none'
    if (attempt.beat === "write" && passed && attempt.scaffold === "none") {
      this.state.writePassedAtNone[attempt.skill] = true;
    }

    // mastery (§13.2): only via scaffold-free Write
    if (
      !masteredAlready &&
      isMastered({ skill, bkt: skillStates, writePassedAtNone: Boolean(this.state.writePassedAtNone[attempt.skill]) })
    ) {
      this.state.masteredAt[attempt.skill] = now;
      this.state.reviews[attempt.skill] = { intervalIdx: 1, dueAt: now + REVIEW_INTERVAL_DAYS[0] * DAY };
      effects.push({ type: "log", message: `capability gained: ${skill.title}` });
    }

    // spaced retrieval (§13.3): advance the ladder on a good review, reset on a miss
    if (masteredAlready && this.state.reviews[attempt.skill]) {
      const review = this.state.reviews[attempt.skill];
      const idx = Math.min(review.intervalIdx, REVIEW_INTERVAL_DAYS.length - 1);
      this.state.reviews[attempt.skill] = passed
        ? { intervalIdx: idx + 1, dueAt: now + REVIEW_INTERVAL_DAYS[idx] * DAY }
        : { intervalIdx: 1, dueAt: now + REVIEW_INTERVAL_DAYS[0] * DAY };
    }

    // never-repeat bookkeeping (§10.3), recorded with the persisted attempt
    (this.state.seen[exercise.template] ??= []).push(exercise.paramHash);
    this.state.lastSeen[attempt.skill] = now;
  }

  /* ── reveal construction — tutor voice, honest confidence ── */

  private buildReveal(
    exercise: Exercise,
    attempt: Attempt,
    result: GradeResult,
    matched: Misconception | undefined,
    pairJustCompleted: boolean,
  ): ExerciseReveal {
    const voice = this.deps.voice;
    const seed = attempt.id;
    const passed = outcomePasses(result.judgement);
    const reveal: ExerciseReveal = {
      exerciseId: exercise.id,
      skillId: exercise.skill,
      beat: exercise.beat,
      tier: exercise.tier,
      judgement: result.judgement,
      actual: "",
      tutorLine: "",
    };
    if (matched) {
      reveal.matchedMisconception = matched.id;
      reveal.misconceptionLabel = matched.name;
      reveal.misconceptionHelp = matched.help;
      reveal.deeperLine = matched.help;
    }

    switch (exercise.payload.beat) {
      case "predict": {
        const expected = exercise.payload.expected;
        const actual = expected.kind === "stdout" ? expected.text : expected.kind === "choice" ? expected.value : expected.name;
        reveal.actual = actual;
        reveal.trace = exercise.payload.trace;
        const learnerText = attempt.response.kind === "text" ? truncate(attempt.response.text) : "";
        reveal.tutorLine = passed
          ? pickLine(voice.confirmation.predict, seed)
          : fillLine(
              pickLine(
                matched && voice.contradiction.predict.misconception[matched.id]?.length
                  ? voice.contradiction.predict.misconception[matched.id]
                  : voice.contradiction.predict.default,
                seed,
              ),
              { learner: learnerText, actual },
            );
        break;
      }
      case "explain": {
        reveal.exemplar = exercise.payload.rubric.exemplar;
        reveal.confidenceNote = pickLine(voice.heuristicDisclaimer, seed);
        reveal.tutorLine = passed
          ? pickLine(voice.confirmation.explain, seed)
          : pickLine(voice.contradiction.explain.default, seed);
        break;
      }
      case "modify": {
        const expected = exercise.payload.expected;
        const actual = expected.kind === "stdout" ? expected.text : "";
        reveal.actual = actual;
        reveal.targetOutput = actual;
        reveal.failingHoleIndices = result.modify?.failingHoleIndices ?? [];
        reveal.tutorLine = passed
          ? pickLine(voice.confirmation.modify, seed)
          : fillLine(pickLine(voice.contradiction.modify.default, seed), { actual });
        break;
      }
      case "write": {
        const write = result.write;
        reveal.actual = write ? `${write.checksPassed} of ${write.checksTotal} checks satisfied` : "";
        reveal.checksPassed = write?.checksPassed;
        reveal.checksTotal = write?.checksTotal;
        reveal.firstFailure = write?.firstFailure;
        reveal.confidenceNote = pickLine(voice.heuristicDisclaimer, seed);
        reveal.surfaceNote = pickLine(voice.surfaceNote, seed);
        reveal.tutorLine = passed ? pickLine(voice.confirmation.write, seed) : pickLine(voice.contradiction.write.default, seed);
        break;
      }
    }

    // §15.2 — only after the first full Predict→Explain pair, one line
    if (pairJustCompleted) {
      reveal.deeperLine = reveal.deeperLine ? `${reveal.deeperLine} ${voice.afterFirstPair}` : voice.afterFirstPair;
    }
    return reveal;
  }

  /* ── advancement / selection ── */

  private afterReveal() {
    const reveal = this.reveal!;
    // §12.2 retry: a multistructural explanation is re-issued, not failed
    if (reveal.judgement.outcome.kind === "ungraded" && this.pending) {
      this.viewKind = "prompting";
      return;
    }
    const exercise = this.lastCommitted;
    // Appendix B: right after a skill's first Predict commit, ask Explain
    if (exercise && exercise.beat === "predict") {
      const explainAttempts = this.state.attempts.filter((a) => a.skill === exercise.skill && a.beat === "explain").length;
      if (explainAttempts === 0) {
        this.startExercise(exercise.skill, "explain", exercise.params, exercise.paramHash);
        return;
      }
    }
    this.advance();
  }

  private startExercise(skillId: SkillId, beat: Beat, params?: Exercise["params"], reuseHash?: number) {
    const template = this.deps.pack.templates.find((t) => t.skill === skillId);
    if (!template) {
      this.advance();
      return;
    }
    const scaffold = this.state.scaffolds[skillId]?.[beat] ?? initialScaffold(beat);
    let exercise: Exercise | null = null;
    if (params && reuseHash !== undefined) {
      exercise = buildExercise(this.deps.pack, template, beat, params, reuseHash, scaffold);
    }
    if (!exercise) {
      const result = generateExercise(this.deps.pack, skillId, beat, this.rng, this.seenTable(), scaffold);
      exercise = result?.exercise ?? null;
    }
    if (!exercise) {
      // §10.3: never re-serve — try the rest of the pool
      this.advance(`${skillId}|${beat}`);
      return;
    }
    this.pending = exercise;
    this.viewKind = this.state.attempts.length === 0 ? "cold-open" : "prompting";
  }

  /** §13.3 selection — or a Tier 3 reading (Law 8), or Done */
  private advance(excludeKey?: string) {
    // Law 8: once the first pair is done, introduce an unread reading once —
    // ungated, never blocking, explicitly marked as having no gate.
    if (!this.readingIntroduced && this.state.pairAnnounced) {
      const unread = this.deps.pack.tier3.find((item) => this.state.tier3ReadAt[item.id] === undefined);
      if (unread) {
        this.readingIntroduced = true;
        this.reading = unread;
        this.viewKind = "reading";
        return;
      }
    }
    const candidate = this.chooseCandidate(excludeKey);
    if (candidate) {
      this.startExercise(candidate.skill.id, candidate.beat);
      return;
    }
    const reading = this.dueReading();
    if (reading) {
      this.reading = reading;
      this.viewKind = "reading";
      return;
    }
    this.viewKind = "done";
  }

  private readingIntroduced = false;

  private chooseCandidate(excludeKey?: string): Candidate | null {
    const now = this.now();
    const candidates: Candidate[] = [];
    for (const skill of this.deps.pack.skills) {
      if (skill.tier !== 1) continue;
      const gate = skillGateState(
        skill,
        this.deps.pack.skills,
        (id) => Boolean(this.state.masteredAt[id]),
        (id) => this.state.attempts.some((a) => a.skill === id),
      );
      const beats = this.candidateBeats(skill.id, skill.beats, gate);
      for (const beat of beats) {
        if (excludeKey === `${skill.id}|${beat}`) continue;
        candidates.push({
          skill,
          beat,
          gate,
          bkt: this.state.bkt[skill.id]?.[beat],
          hasUnseenBinding: this.hasUnseenBinding(skill.id, beat),
          beatUnlocked: this.beatUnlocked(skill.id, beat),
          now,
          reviewDueAt: gate === "mastered" ? this.state.reviews[skill.id]?.dueAt : undefined,
        });
      }
    }
    return selectNext({
      candidates,
      prereqsMastered: (id) => {
        const skill = this.deps.pack.skills.find((s) => s.id === id)!;
        return skill.prerequisites.every((p) => Boolean(this.state.masteredAt[p]));
      },
    });
  }

  /**
   * Frontier rule: per skill, the beats offered are the lowest-ordered
   * unlocked beat that still needs work (no attempts, or p_L < 0.85).
   * Without this, a strong early beat out-competes every later beat on band
   * distance and the PRIMM ordering stalls. Mastered skills surface only
   * their Write beat, and only through spaced retrieval (§13.3).
   */
  private candidateBeats(skillId: SkillId, beats: Beat[], gate: "locked" | "open" | "in-progress" | "mastered"): Beat[] {
    if (gate === "mastered") return ["write"];
    const ordered = [...beats].sort((a, b) => BEAT_ORDER.indexOf(a) - BEAT_ORDER.indexOf(b));
    for (const beat of ordered) {
      if (!this.beatUnlocked(skillId, beat)) continue;
      const state = this.state.bkt[skillId]?.[beat];
      if (!state || state.p < 0.85) return [beat];
    }
    return [];
  }

  /** §8 invariant 4 — strict beat ordering */
  private beatUnlocked(skillId: SkillId, beat: Beat): boolean {
    const attempts = this.state.attempts.filter((a) => a.skill === skillId);
    switch (beat) {
      case "predict":
        return true;
      case "explain":
        return attempts.some((a) => a.beat === "predict");
      case "modify":
        return attempts.some((a) => a.beat === "explain");
      case "write":
        return attempts.some((a) => a.beat === "modify" && a.correct);
    }
  }

  private hasUnseenBinding(skillId: SkillId, beat: Beat): boolean {
    const template = this.deps.pack.templates.find((t) => t.skill === skillId);
    if (!template) return false;
    // predict consumes the parameter space; later beats reuse bindings
    if (beat !== "predict") return true;
    return (this.state.seen[template.id]?.length ?? 0) < paramSpaceSize(template);
  }

  /** Law 8: Tier 3 is delivered without a gate, revisited weekly */
  private dueReading(): Tier3Content | null {
    const now = this.now();
    const due = this.deps.pack.tier3.filter((item) => {
      const readAt = this.state.tier3ReadAt[item.id];
      return readAt === undefined || now - readAt >= TIER3_REVISIT;
    });
    return due[0] ?? null;
  }

  /* ── capability map — the ONLY ascending display (Law 4) ── */

  private capabilityMap(): CapabilityMap {
    const nodes: SkillMapNode[] = this.deps.pack.skills.map((skill) => ({
      id: skill.id,
      title: skill.title,
      concepts: skill.concepts,
      prerequisites: skill.prerequisites,
      state: skillGateState(
        skill,
        this.deps.pack.skills,
        (id) => Boolean(this.state.masteredAt[id]),
        (id) => this.state.attempts.some((a) => a.skill === id),
      ),
      tier: skill.tier,
    }));
    return {
      nodes,
      readings: this.deps.pack.tier3.map((item) => ({ id: item.id, title: item.title, readAt: this.state.tier3ReadAt[item.id] })),
      signals: {
        firstQuestionAnswered: this.state.events.some((e) => e.name === EVENT_FIRST_QUESTION),
        returnedWithin24h: this.state.events.some((e) => e.name === EVENT_RETURNED_24H),
      },
      runtimeStatus: [
        "Execution here is precomputed — outcomes are recorded inside the pack (§9.1). No interpreter, no download.",
        "Modify is checked against recorded runs. Write is checked structurally plus one dry-run you evaluate yourself — the caveat is always shown (§9.4).",
      ],
    };
  }

  private masteredTitles(): string[] {
    return this.deps.pack.skills.filter((s) => this.state.masteredAt[s.id]).map((s) => s.title);
  }

  /* ── prompt construction — the safe side of the reveal barrier (§7.5) ── */

  private promptOf(exercise: Exercise): ExercisePrompt {
    const hasPriorPredictAttempt = this.state.attempts.some(
      (a) => a.skill === exercise.skill && a.beat === "predict",
    );
    return buildPrompt(this.deps.pack, exercise, hasPriorPredictAttempt);
  }

  private softerScaffold(exercise: Exercise): Exercise["scaffold"] {
    const mastered = Boolean(this.state.masteredAt[exercise.skill]);
    const softer = fadeDown(exercise.beat, exercise.scaffold);
    // expertise reversal guard (§13.4): no worked examples for mastered skills
    if (mastered && softer === "worked-example") return exercise.scaffold;
    return softer;
  }

  /* ── small internals ── */

  private skillSummary(skillId: SkillId) {
    const skill = this.deps.pack.skills.find((s) => s.id === skillId)!;
    return { id: skill.id, title: skill.title, concepts: skill.concepts };
  }

  private seenTable() {
    const seen = this.state.seen;
    return {
      isSeen: (templateId: string, hash: number) => (seen[templateId] ?? []).includes(hash),
      markSeen: (templateId: string, hash: number) => {
        (seen[templateId] ??= []).push(hash);
      },
      seenCount: (templateId: string) => (seen[templateId] ?? []).length,
    };
  }

  private persist() {
    this.deps.store.save(this.state);
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }
}

/** rebuild the payload pieces that depend on the scaffold level */
function rebuildForScaffold(pack: Pack, exercise: Exercise): Exercise {
  if (exercise.payload.beat === "write") {
    return {
      ...exercise,
      payload: {
        ...exercise.payload,
        signatureHint: exercise.scaffold === "none" ? undefined : exercise.payload.signatureHint,
      },
    };
  }
  void pack;
  return exercise;
}

function outcomePasses(judgement: Judgement): boolean {
  switch (judgement.outcome.kind) {
    case "correct":
      return true;
    case "partial":
      return judgement.outcome.score >= PARTIAL_PASS_THRESHOLD;
    default:
      return false;
  }
}

function truncate(text: string, max = 60): string {
  const clean = text.trim().replace(/\s+/g, " ");
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}
