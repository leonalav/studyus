/**
 * Grading (§12) — pure functions, no I/O.
 *
 * GradeConfidence is load-bearing honesty (Law 8): 'exact' means recorded
 * ground truth decided it; 'heuristic' means keyword/structural matching
 * decided it and the learner must be told; 'none' means no gate (Tier 3).
 */

import type {
  Detector,
  ExpectedOutcome,
  Exercise,
  Judgement,
  Misconception,
  Outcome,
  ParamBinding,
  Response,
  Rubric,
} from "./types";

/* ── 12.1 Predict — exact, with normalization ── */

/**
 * Normalize: trim leading/trailing whitespace on the whole string and per
 * line, collapse runs of internal spaces, normalize line endings.
 * Do NOT normalize case or punctuation — those are semantic in output.
 */
export function normalizeOutput(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .trim();
}

/** parse the final numeric token of a prediction, for numeric detectors */
function lastNumber(text: string): number | null {
  const matches = normalizeOutput(text).match(/-?\d+(?:\.\d+)?/g);
  if (!matches || matches.length === 0) return null;
  const value = Number(matches[matches.length - 1]);
  return Number.isFinite(value) ? value : null;
}

export function runDetector(
  detector: Detector,
  responseText: string,
  expected: ExpectedOutcome,
  params: ParamBinding = {},
  custom: CustomDetectorRegistry = {},
): boolean {
  switch (detector.kind) {
    case "exact-response":
      return normalizeOutput(responseText) === normalizeOutput(detector.value);
    case "regex":
      try {
        return new RegExp(detector.pattern).test(normalizeOutput(responseText));
      } catch {
        return false;
      }
    case "off-by-one": {
      if (expected.kind !== "stdout") return false;
      const exp = lastNumber(expected.text);
      const got = lastNumber(responseText);
      return exp !== null && got !== null && got - exp === detector.relativeToExpected;
    }
    case "custom": {
      const fn = custom[detector.name];
      return fn ? fn(responseText, expected, params) : false;
    }
  }
}

/** named detector functions registered by the pack (§7.7) */
export type CustomDetectorRegistry = Record<
  string,
  (responseText: string, expected: ExpectedOutcome, params: ParamBinding) => boolean
>;

/** Run every detector for the skill's misconceptions in order; first match wins (§7.7). */
export function detectMisconception(
  misconceptions: Misconception[],
  responseText: string,
  expected: ExpectedOutcome,
  params: ParamBinding = {},
  custom: CustomDetectorRegistry = {},
): Misconception | undefined {
  return misconceptions.find((m) => runDetector(m.detector, responseText, expected, params, custom));
}

export function gradePredict(
  exercise: Exercise,
  response: Response,
  misconceptions: Misconception[],
  customDetectors: CustomDetectorRegistry,
): Judgement {
  if (exercise.payload.beat !== "predict") {
    return { outcome: { kind: "ungraded" }, detail: "not a predict exercise", confidence: "none" };
  }
  const expected = exercise.payload.expected;
  const text = response.kind === "text" ? response.text : "";
  let correct = false;
  if (expected.kind === "stdout") {
    correct = normalizeOutput(text) === normalizeOutput(expected.text);
  } else if (expected.kind === "choice") {
    correct = normalizeOutput(text) === normalizeOutput(expected.value);
  } else {
    correct = normalizeOutput(text) === normalizeOutput(expected.name);
  }
  if (correct) {
    return { outcome: { kind: "correct" }, detail: "normalized exact match", confidence: "exact" };
  }
  const matched = detectMisconception(misconceptions, text, expected, exercise.params, customDetectors);
  return {
    outcome: { kind: "incorrect" },
    matchedMisconception: matched?.id,
    detail: matched ? `misconception matched: ${matched.id}` : "no known misconception matched",
    confidence: "exact",
  };
}

/* ── 12.2 Explain — rubric, and be honest about it ── */

/** crude deterministic stemmer: lowercase, strip common suffixes */
function stem(word: string): string {
  const w = word.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (w.length <= 3) return w;
  for (const suffix of ["ing", "ed", "es", "s"]) {
    if (w.endsWith(suffix) && w.length - suffix.length >= 3) return w.slice(0, w.length - suffix.length);
  }
  return w;
}

function tokensOf(text: string): string[] {
  return text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

/** stem-aware containment: every stem of the phrase must appear in order-ish */
function phraseMatches(hayTokens: string[], phrase: string): boolean {
  const phraseStems = tokensOf(phrase).map(stem);
  if (phraseStems.length === 0) return false;
  const hayStems = hayTokens.map(stem);
  // single token: stem match anywhere
  if (phraseStems.length === 1) return hayStems.includes(phraseStems[0]);
  // phrase: look for the stems consecutively (allow one filler token between)
  for (let i = 0; i < hayStems.length; i += 1) {
    let hi = i;
    let matched = 0;
    for (const ps of phraseStems) {
      if (hayStems[hi] === ps) {
        matched += 1;
        hi += 1;
      } else if (hayStems[hi + 1] === ps) {
        matched += 1;
        hi += 2;
      } else {
        break;
      }
    }
    if (matched === phraseStems.length) return true;
  }
  return false;
}

export interface ExplainJudgement {
  judgement: Judgement;
  /** relational-vs-multistructural heuristic (§12.2) */
  multistructural: boolean;
  groupsSatisfied: number;
  groupsTotal: number;
}

const SEQUENCE_MARKERS = ["first", "then", "next", "after that", "line by line", "step by step"];

export function gradeExplain(
  _exercise: Exercise,
  response: Response,
  renderedRubric: Rubric,
  programLineCount: number,
): ExplainJudgement {
  const text = response.kind === "text" ? response.text : "";
  const hayTokens = tokensOf(text);

  let satisfied = 0;
  for (const group of renderedRubric.groups) {
    if (group.oneOf.some((phrase) => phraseMatches(hayTokens, phrase))) satisfied += 1;
  }
  let penalty = 0;
  for (const banned of renderedRubric.mustNotInclude) {
    if (phraseMatches(hayTokens, banned)) penalty += 1;
  }
  const groupsTotal = renderedRubric.groups.length;
  const raw = groupsTotal > 0 ? satisfied / groupsTotal : 0;
  const score = Math.max(0, raw - penalty * 0.3);

  // multistructural heuristic: narrates lines instead of stating purpose
  const lower = text.toLowerCase();
  const markerHits = SEQUENCE_MARKERS.filter((m) => lower.includes(m)).length;
  const multistructural = markerHits >= 2 || (markerHits >= 1 && tokensOf(text).length >= programLineCount * 6);

  let outcome: Outcome;
  if (penalty > 0 && score <= 0) outcome = { kind: "incorrect" };
  else if (score >= 0.8) outcome = { kind: "partial", score: 0.8 };
  else if (score >= 0.4) outcome = { kind: "partial", score: Math.round(score * 100) / 100 };
  else outcome = { kind: "incorrect" };

  return {
    judgement: {
      outcome,
      detail: `${satisfied}/${groupsTotal} rubric groups satisfied${penalty ? `, ${penalty} penalty` : ""}`,
      confidence: "heuristic", // always — §12.2
    },
    multistructural,
    groupsSatisfied: satisfied,
    groupsTotal,
  };
}

/* ── 12.3 Modify — compare fills against the authored accepted set ── */

export interface ModifyJudgement {
  judgement: Judgement;
  failingHoleIndices: number[];
}

export function gradeModify(exercise: Exercise, response: Response): ModifyJudgement {
  if (exercise.payload.beat !== "modify") {
    return {
      judgement: { outcome: { kind: "ungraded" }, detail: "not a modify exercise", confidence: "none" },
      failingHoleIndices: [],
    };
  }
  const fills = response.kind === "holes" ? response.fills : [];
  const failing: number[] = [];
  exercise.payload.holes.forEach((hole, i) => {
    const fill = normalizeOutput(fills[i] ?? "");
    const ok = hole.accept.some((a) => normalizeOutput(a) === fill);
    if (!ok) failing.push(i);
  });
  // learner input is untrusted — static policy applies to fills too (§17)
  const policyViolation = fills.map(staticPolicyCheck).find((v) => v !== null);
  if (policyViolation) {
    return {
      judgement: {
        outcome: { kind: "incorrect" },
        detail: `blocked by static policy: ${policyViolation}`,
        confidence: "exact",
      },
      failingHoleIndices: failing,
    };
  }
  const judgement: Judgement =
    failing.length === 0
      ? { outcome: { kind: "correct" }, detail: "all holes match the recorded run", confidence: "exact" }
      : {
          outcome: { kind: "incorrect" },
          detail: `${failing.length} of ${exercise.payload.holes.length} holes do not reach the target`,
          confidence: "exact",
        };
  return { judgement, failingHoleIndices: failing };
}

/* ── 12.4 Write — structural checks + dry-run, honest about execution ── */

export interface WriteJudgement {
  judgement: Judgement;
  checksPassed: number;
  checksTotal: number;
  firstFailure?: { label: string; expected?: string; got?: string };
}

/**
 * On surfaces with an interpreter this beat runs hidden tests. On this
 * browser surface there is no interpreter (and §19 forbids bundling one),
 * so grading combines deterministic structural checks with one recorded
 * dry-run case the learner evaluates against their own code. Confidence is
 * therefore ALWAYS 'heuristic' and the surface says so out loud (§9.4).
 */
export function gradeWrite(exercise: Exercise, response: Response): WriteJudgement {
  if (exercise.payload.beat !== "write") {
    return {
      judgement: { outcome: { kind: "ungraded" }, detail: "not a write exercise", confidence: "none" },
      checksPassed: 0,
      checksTotal: 0,
    };
  }
  const source = response.kind === "source" ? response.source : "";
  const dryRun = response.kind === "source" ? normalizeOutput(response.dryRun) : "";

  // learner input is untrusted — refuse to grade policy-violating source (§12.4)
  const violation = staticPolicyCheck(source);
  if (violation) {
    return {
      judgement: {
        outcome: { kind: "incorrect" },
        detail: `not graded — static policy blocked: ${violation}`,
        confidence: "exact",
      },
      checksPassed: 0,
      checksTotal: exercise.payload.checks.length + 1,
      firstFailure: { label: `blocked: ${violation}` },
    };
  }

  const checks = exercise.payload.checks;
  let passed = 0;
  let firstFailure: WriteJudgement["firstFailure"];
  for (const check of checks) {
    if (check.test(source)) passed += 1;
    else if (!firstFailure) firstFailure = { label: check.label };
  }
  const dryRunTest = exercise.payload.hiddenTests[0];
  const dryRunOk = dryRunTest !== undefined && dryRun === normalizeOutput(dryRunTest.stdout);
  if (dryRunOk) passed += 1;
  else if (!firstFailure && dryRunTest) {
    firstFailure = {
      label: "dry-run: what your program prints for the shown input",
      expected: dryRunTest.stdout,
      got: dryRun || "(nothing)",
    };
  }

  const total = checks.length + 1;
  const allPass = passed === total;
  const judgement: Judgement = allPass
    ? {
        outcome: { kind: "correct" },
        detail: `${passed}/${total} structural checks pass — code was not executed on this surface`,
        confidence: "heuristic",
      }
    : {
        outcome: { kind: "incorrect" },
        detail: `${passed}/${total} structural checks pass`,
        confidence: "heuristic",
      };
  return { judgement, checksPassed: passed, checksTotal: total, firstFailure };
}

/* ── §11.3 / §17 — static policy gate, applied to ALL code before anything runs ── */

const DENY_PATTERNS: { pattern: RegExp; label: string }[] = [
  { pattern: /\bimport\s+os\b|\bfrom\s+os\b|\bos\./, label: "os access" },
  { pattern: /\bimport\s+sys\b|\bfrom\s+sys\b|\bsys\.exit\b/, label: "sys access" },
  { pattern: /\bsubprocess\b/, label: "subprocess" },
  { pattern: /\bsocket\b/, label: "socket" },
  { pattern: /\bopen\s*\(/, label: "file open" },
  { pattern: /\beval\s*\(/, label: "eval" },
  { pattern: /\bexec\s*\(/, label: "exec" },
  { pattern: /__import__/, label: "dynamic import" },
  { pattern: /\bwhile\s+True\b/, label: "unbounded loop" },
  { pattern: /\bimport\s+(?!math\b|random\b|json\b|string\b)/, label: "import outside allowlist" },
  { pattern: /\bfrom\s+(?!math\b|random\b|json\b|string\b)\w+\s+import\b/, label: "import outside allowlist" },
];

/** returns the violation label, or null when the source passes the gate */
export function staticPolicyCheck(source: string): string | null {
  for (const { pattern, label } of DENY_PATTERNS) {
    if (pattern.test(source)) return label;
  }
  return null;
}
