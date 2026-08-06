/**
 * studyus-core domain model (§7).
 *
 * Pure pedagogy. This module (and everything under src/core and src/pack)
 * must not import React, DOM APIs, or anything UI-related — Law 9.
 * The dependency check in scripts/check-deps.sh enforces this.
 */

/* ── 7.1 Identifiers ── */

export type SkillId = string; // stable, human-readable: "py.loops.for-range"
export type TemplateId = string; // "py.loops.for-range.accumulate.v1"
export type ExerciseId = string; // uuid-ish per generated instance
export type AttemptId = string;
export type PackId = string;
export type MisconceptionId = string;

/* ── 7.2 Tier and Beat ── */

/** §4 — every piece of content lives in exactly one tier. */
export type Tier = 1 | 2 | 3;

/** §3.1 — four distinct cognitive operations, strictly ordered. */
export type Beat = "predict" | "explain" | "modify" | "write";

export const BEAT_ORDER: Beat[] = ["predict", "explain", "modify", "write"];

export function beatRank(beat: Beat): number {
  return BEAT_ORDER.indexOf(beat);
}

export const BEAT_LABEL: Record<Beat, string> = {
  predict: "Predict",
  explain: "Explain",
  modify: "Modify",
  write: "Write from blank",
};

/** §13.4 — adaptive fading levels, softest to hardest. `none` is where beat 4 must end up. */
export type ScaffoldLevel = "worked-example" | "completion" | "hinted" | "none";

export const SCAFFOLD_ORDER: ScaffoldLevel[] = ["worked-example", "completion", "hinted", "none"];

export function scaffoldRank(level: ScaffoldLevel): number {
  return SCAFFOLD_ORDER.indexOf(level);
}

/* ── 7.3 Skill ── */

export interface Skill {
  id: SkillId;
  title: string;
  tier: Tier;
  prerequisites: SkillId[];
  concepts: string[];
  misconceptions: MisconceptionId[];
  pack: PackId;
  /** Which beats this skill supports. Tier 3 supports none. */
  beats: Beat[];
}

/* ── Parameterization ── */

export type ParamSpec =
  | { kind: "int"; min: number; max: number }
  | { kind: "choice"; of: string[] };

export type ParamBinding = Record<string, number | string>;

/* ── 7.4 Exercise ──
 *
 * An Exercise is a *generated instance*, never authored by hand, never reused.
 * It is the internal, privileged representation: it carries the expected
 * outcome. It is deliberately NOT serializable to any frontend — frontends
 * only ever receive ExercisePrompt (before commit) or ExerciseReveal (after).
 */

export type PredictQuestion =
  | { kind: "stdout" } // depth rung 1
  | { kind: "raises-which" } // depth rung 2 (data model support, no content yet)
  | { kind: "which-is-faster"; a: string; b: string } // depth rung 3
  | { kind: "shape" } // depth rung 4, Tier 2
  | { kind: "behaviour-direction"; options: string[] }; // Tier 2

export type ExpectedOutcome =
  | { kind: "stdout"; text: string }
  | { kind: "exception"; name: string }
  | { kind: "choice"; value: string };

export interface TraceStep {
  line: number;
  vars: Record<string, string>;
  stdout: string[];
  note?: string;
}

export interface Hole {
  id: string;
  /** normalised accepted fills — the complete authored set */
  accept: string[];
}

export interface RubricGroup {
  /** satisfied when any stem matches */
  oneOf: string[];
}

export interface Rubric {
  groups: RubricGroup[];
  mustNotInclude: string[];
  exemplar: string;
}

/** §12.4 hidden test — recorded as (stdin, expected stdout). */
export interface HiddenTest {
  stdin: string;
  stdout: string;
}

/** Structural check standing in for hidden-test execution on surfaces without an interpreter. */
export interface WriteCheck {
  id: string;
  label: string;
  test: (source: string) => boolean;
}

export type ExercisePayload =
  | {
      beat: "predict";
      program: string;
      question: PredictQuestion;
      /** NEVER shown to a frontend before an Attempt exists. */
      expected: ExpectedOutcome;
      trace: TraceStep[];
    }
  | {
      beat: "explain";
      program: string;
      rubric: Rubric;
    }
  | {
      beat: "modify";
      programWithHoles: string;
      holes: Hole[];
      targetBehaviour: string;
      /** recorded output of the correctly completed program */
      expected: ExpectedOutcome;
    }
  | {
      beat: "write";
      specification: string;
      /** only surfaced at ScaffoldLevel 'hinted'; never at 'none' */
      signatureHint?: string;
      hiddenTests: HiddenTest[];
      checks: WriteCheck[];
      referenceSolution: string;
    };

export interface Exercise {
  id: ExerciseId;
  skill: SkillId;
  template: TemplateId;
  beat: Beat;
  tier: Tier;
  params: ParamBinding;
  paramHash: number;
  payload: ExercisePayload;
  scaffold: ScaffoldLevel;
}

/* ── 7.5 The reveal barrier — Law 1 enforced with types ── */

/**
 * What a frontend is allowed to see BEFORE the learner commits.
 * Contains no expected outcome, no rubric, no exemplar, no hidden test,
 * no accepted fills, no reference solution — nothing checkable.
 */
export interface ExercisePrompt {
  exerciseId: ExerciseId;
  skillId: SkillId;
  skillTitle: string;
  beat: Beat;
  tier: Tier;
  scaffold: ScaffoldLevel;
  body:
    | { kind: "predict"; program: string; question: string }
    | { kind: "explain"; program: string; instruction: string }
    | { kind: "modify"; programWithHoles: string; holeCount: number; targetBehaviour: string }
    | {
        kind: "write";
        specification: string;
        signatureHint?: string;
        /** the single test input the learner must dry-run against their own code */
        dryRunInput: string;
      };
  /** multiple-choice commitments, offered only as a requested scaffold on predict */
  choices?: { id: string; text: string }[];
  /** remediation aid, offered only as a requested scaffold and only after a first attempt (Law 3) */
  workedSibling?: { program: string; note: string };
}

/** What a frontend may see only AFTER an Attempt has been recorded. */
export interface ExerciseReveal {
  exerciseId: ExerciseId;
  skillId: SkillId;
  beat: Beat;
  tier: Tier;
  judgement: Judgement;
  /** what the machine says — the recorded outcome */
  actual: string;
  /** the tutor line at the moment of contradiction or confirmation (Law 6) */
  tutorLine: string;
  /** deeper follow-up available via "go one level deeper" */
  deeperLine?: string;
  matchedMisconception?: MisconceptionId;
  misconceptionLabel?: string;
  misconceptionHelp?: string;
  /** explain beat only, always shown after commit (§12.2) */
  exemplar?: string;
  /** modify beat only — expected output of the target, never the correct fills (§12.3) */
  targetOutput?: string;
  failingHoleIndices?: number[];
  /** write beat only — the first failing check or dry-run case (§12.4) */
  checksPassed?: number;
  checksTotal?: number;
  firstFailure?: { label: string; expected?: string; got?: string };
  /** predict beat only — execution trace, revealed after commit */
  trace?: TraceStep[];
  /** surfaced whenever grading confidence is not Exact (§7.6) */
  confidenceNote?: string;
  /** honest limits of this surface */
  surfaceNote?: string;
}

/* ── 7.6 Attempt ── */

export type Timestamp = number;

export type Response =
  | { kind: "text"; text: string } // Predict, Explain
  | { kind: "holes"; fills: string[]; dryRun?: string } // Modify (and Write dry-run)
  | { kind: "source"; source: string; dryRun: string }; // Write

export type Outcome =
  | { kind: "correct" }
  | { kind: "incorrect" }
  | { kind: "partial"; score: number }
  | { kind: "ungraded" };

/** Law 8: be honest about how sure the grader is. */
export type GradeConfidence = "exact" | "heuristic" | "none";

export interface Judgement {
  outcome: Outcome;
  matchedMisconception?: MisconceptionId;
  detail: string;
  confidence: GradeConfidence;
}

export interface Attempt {
  id: AttemptId;
  exercise: ExerciseId;
  skill: SkillId;
  beat: Beat;
  submittedAt: Timestamp;
  response: Response;
  judgement: Judgement;
  elapsedMs: number;
  scaffold: ScaffoldLevel;
  /** true when the learner asked for a scaffold on this exercise (§13.4) */
  scaffoldRequested: boolean;
}

/* ── 7.7 Misconception ── */

export type Detector =
  | { kind: "exact-response"; value: string }
  | { kind: "regex"; pattern: string }
  | { kind: "off-by-one"; relativeToExpected: number }
  | { kind: "custom"; name: string };

export interface Misconception {
  id: MisconceptionId;
  name: string;
  detector: Detector;
  remediation: string;
  help: string;
}

/* ── Tier 3 (Law 8) ── */

export interface Tier3Content {
  id: string;
  title: string;
  concepts: string[];
  body: string[];
  /** the tutor says out loud that there is no gate */
  disclaimer: string;
}

/* ── Session views and inputs (§8) ── */

export interface SkillSummary {
  id: SkillId;
  title: string;
  concepts: string[];
}

export interface SkillMapNode {
  id: SkillId;
  title: string;
  concepts: string[];
  prerequisites: SkillId[];
  state: "locked" | "open" | "in-progress" | "mastered";
  tier: Tier;
}

export interface CapabilityMap {
  nodes: SkillMapNode[];
  readings: { id: string; title: string; readAt?: Timestamp }[];
  /** the two local signals (§16.2) — counts, never gamified */
  signals: { firstQuestionAnswered: boolean; returnedWithin24h: boolean };
  /** honest runtime status (§9.4 — never silently degrade) */
  runtimeStatus: string[];
}

export interface SessionSummary {
  reason: string;
  masteredTitles: string[];
}

export type View =
  | { kind: "cold-open"; prompt: ExercisePrompt }
  | { kind: "prompting"; prompt: ExercisePrompt; beat: Beat; tier: Tier; skill: SkillSummary }
  | { kind: "revealed"; reveal: ExerciseReveal; next: NextAction }
  | { kind: "reading"; tier3: Tier3Content; disclaimer: string }
  | { kind: "map"; capability: CapabilityMap; resume?: ExercisePrompt; beat?: Beat }
  | { kind: "done"; summary: SessionSummary };

export type NextAction = "continue" | "explain-next" | "map";

export type Input =
  | { type: "commit"; response: Response; elapsedMs: number }
  | { type: "continue" }
  | { type: "request-scaffold" }
  | { type: "skip" }
  | { type: "open-map" }
  | { type: "close-map" }
  | { type: "quit" };

export type Effect =
  | { type: "persist-attempt"; attempt: Attempt }
  | { type: "update-skill-state"; skill: SkillId; beat: Beat }
  | { type: "emit-event"; name: string; at: Timestamp }
  | { type: "log"; message: string };

export interface Transition {
  view: View;
  effects: Effect[];
}

export class CoreError extends Error {
  constructor(
    message: string,
    readonly code:
      | "store-failure"
      | "no-candidates"
      | "invalid-input"
      | "pack-invalid"
      | "exhausted" = "invalid-input",
  ) {
    super(message);
    this.name = "CoreError";
  }
}

/* ── small shared helpers ── */

/** deterministic non-cryptographic string hash (djb2) — voice selection, ids */
export function hashString(input: string): number {
  let h = 5381;
  for (let i = 0; i < input.length; i += 1) {
    h = ((h << 5) + h + input.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

/** FNV-1a over canonical JSON — the never-repeat bookkeeping key */
export function paramHashOf(binding: ParamBinding): number {
  const canonical = JSON.stringify(
    Object.keys(binding)
      .sort()
      .map((k) => [k, binding[k]]),
  );
  let h = 0x811c9dc5;
  for (let i = 0; i < canonical.length; i += 1) {
    h ^= canonical.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function uid(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
}
