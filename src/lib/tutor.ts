/**
 * Socratic tutor agent harness.
 *
 * The third of three agent harnesses (with `generator.ts` and `evaluator.ts`),
 * layered on the shared runtime in `agentRuntime.ts`. Every tutor model call in
 * the app goes through `askTutorTurn`, which enforces the constraints the
 * Socratic prompt promises:
 *
 *  - Structured output validated against `{speech, board_ops, diagnosis?,
 *    evidence_refs, requested_level?}`. Unknown board operations are rejected,
 *    not rendered; invented evidence handles are rejected, so the tutor can
 *    only cite curriculum sections it was actually given.
 *  - Hint-level gating: the current unlocked level is supplied in context and
 *    the model may request a higher one, clamped to `MAX_HINT_LEVEL`. The
 *    harness never fabricates a level.
 *  - The independent-attempt precondition (rule 2) is surfaced as a phase flag
 *    in context; the harness does not hand a worked solution into the prompt.
 *  - Every turn — learner message and tutor reply — is persisted to
 *    `session_messages` under a `chalkboard_sessions` parent row (the FK the
 *    schema enforces), so multi-turn history survives across UI sessions.
 *  - Board operations per turn are bounded by `MAX_BOARD_OPS_PER_TURN`; the
 *    repair loop in `agentRuntime` is itself bounded.
 *
 * This module performs no writes outside the session/message tables.
 */

import { getDb, saveDbSync } from "../db/database";
import {
  asArray,
  asEnum,
  asFiniteNumber,
  asNonEmptyString,
  asRecord,
  callStructuredAgent,
  invalid,
  resolveRoleEndpoint,
  type ResolvedRoleEndpoint,
  type StructuredCallResult,
  type ValidationResult,
} from "./agentRuntime";
import { TUTOR_AGENT_PROMPT_V1 } from "./llm";
import { getActiveTutorContextLearnerSummary } from "./learnerModel";
import { getEvidenceForSelectedNodes } from "./curriculum";
import { buildOnboardingReminder, type OnboardingAnswers, type OnboardingQuestion } from "../data/tutor";
import { DOMAIN_META, type Domain } from "../data/boards";
import type { VisualizationIntent } from "./visualization/types";
import { validateVisualizationIntent } from "./visualization/validate";

export const TUTOR_PROMPT_VERSION = "tutor_v2";
export const TUTOR_SCHEMA_VERSION = "tutor_turn_v2";
export const ONBOARDING_PROMPT_VERSION = "tutor_onboarding_v1";
export const ONBOARDING_SCHEMA_VERSION = "onboarding_questions_v1";
export const MAX_HINT_LEVEL = 3;
export const MAX_BOARD_OPS_PER_TURN = 12;
/** Bounds on the generated onboarding interview, so a model cannot return a
 *  one-question stub or a 40-question intake form. */
export const MIN_ONBOARDING_QUESTIONS = 3;
export const MAX_ONBOARDING_QUESTIONS = 6;

/* ─────────────────────────────────────────────────────────────
   TURN TYPES
   ───────────────────────────────────────────────────────────── */

export type BoardOp =
  | { op: "write_title"; text: string }
  | { op: "write_text"; text: string }
  | { op: "write_bullets"; items: string[] }
  | { op: "write_latex"; tex: string; caption?: string }
  | { op: "visualize"; intent: VisualizationIntent }
  | { op: "write_callout"; text: string };

export interface TutorDiagnosis {
  misconceptions: string[];
  weakCriteria: string[];
  hintDependence: "none" | "low" | "medium" | "high";
  calibration: "under" | "over" | "accurate";
}

export interface TutorTurn {
  speech: string;
  boardOps: BoardOp[];
  diagnosis?: TutorDiagnosis;
  evidenceRefs: string[];
  requestedLevel?: number;
}

export interface TutorEvidenceCard {
  handle: string;
  section: string;
  excerpt?: string;
}

/// Cap on how much of each chunk's text is inlined into the tutor prompt, so a
/// long section cannot blow the context budget. Chunks are still stored whole.
const EVIDENCE_EXCERPT_CHARS = 600;

/**
 * Build tutor evidence cards from the persisted curriculum chunks of the bound
 * nodes. This is the real grounding path the generator uses
 * (`getEvidenceForSelectedNodes`): each chunk becomes a card the model cites by
 * handle. Empty `boundNodes` or nodes with no transcribed chunks yield `[]` —
 * the tutor then runs with no curriculum sections rather than fabricated ones.
 *
 * Async because it reads from SQLite; callers must `await` it before assembling
 * the prompt.
 */
export async function buildTutorEvidenceCards(boundNodes: string[]): Promise<TutorEvidenceCard[]> {
  if (!boundNodes || boundNodes.length === 0) return [];
  const { nodes, chunks } = await getEvidenceForSelectedNodes(boundNodes);
  if (chunks.length === 0) return [];

  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const sectionLabel = (nodeId: string): string => {
    const n = nodeById.get(nodeId);
    if (!n) return "Curriculum excerpt";
    return n.sectionNumber ? `${n.sectionNumber} ${n.title}` : n.title;
  };

  const cards: TutorEvidenceCard[] = [];
  // Stable ordering: by chunk page then ordinal, so handle numbering is
  // deterministic across turns for the same bound nodes.
  const ordered = [...chunks].sort((a, b) => a.page - b.page || a.chunkOrdinal - b.chunkOrdinal);
  for (const ch of ordered) {
    const excerpt = ch.textContent.length > EVIDENCE_EXCERPT_CHARS
      ? ch.textContent.slice(0, EVIDENCE_EXCERPT_CHARS) + "…"
      : ch.textContent;
    cards.push({
      handle: `E${cards.length + 1}`,
      section: `${sectionLabel(ch.nodeId)} · p.${ch.page}`,
      excerpt,
    });
  }
  return cards;
}

/* ─────────────────────────────────────────────────────────────
   SCHEMA VALIDATION
   ───────────────────────────────────────────────────────────── */

const HINT_DEPENDENCE = ["none", "low", "medium", "high"] as const;
const CALIBRATION = ["under", "over", "accurate"] as const;

function validateBoardOp(value: unknown, path: string, errors: string[]): BoardOp | null {
  const rec = asRecord(value, path, errors);
  if (!rec) return null;

  const op = asEnum(rec.op, ["write_title", "write_text", "write_bullets", "write_latex", "visualize", "write_callout"], `${path}.op`, errors);
  if (!op) return null;

  const textOf = (key: string): string | null => asNonEmptyString(rec[key], `${path}.${key}`, errors);
  const captionOf = (key: string): string | undefined => {
    if (rec[key] === undefined || rec[key] === null) return undefined;
    return asNonEmptyString(rec[key], `${path}.${key}`, errors) ?? undefined;
  };

  switch (op) {
    case "write_title":
    case "write_text":
    case "write_callout": {
      const text = textOf("text");
      if (!text) return null;
      return { op, text } as BoardOp;
    }
    case "write_bullets": {
      const items = asArray(rec.items, `${path}.items`, errors);
      if (!items) return null;
      const out: string[] = [];
      items.forEach((entry, i) => {
        if (typeof entry !== "string" || !entry.trim()) errors.push(`${path}.items[${i}] must be a non-empty string`);
        else out.push(entry.trim());
      });
      if (out.length === 0) {
        errors.push(`${path}.items must contain at least one non-empty string`);
        return null;
      }
      return { op, items: out };
    }
    case "write_latex": {
      const tex = textOf("tex");
      if (!tex) return null;
      return { op, tex, caption: captionOf("caption") };
    }
    case "visualize": {
      const intent = rec.intent;
      if (!intent || typeof intent !== "object") {
        errors.push(`${path}.intent must be an object`);
        return null;
      }
      const result = validateVisualizationIntent(intent);
      if (!result.valid) {
        errors.push(`${path}.intent: ${result.reason}`);
        return null;
      }
      return { op, intent: intent as VisualizationIntent };
    }
  }
}

/**
 * Validates the tutor payload against the supplied evidence handles.
 *
 * Evidence references that name a handle that was not supplied are a hard
 * failure rather than a silent drop: a tutor citing a section it was never
 * shown has fabricated its authority, and the repair loop is the correct place
 * to fix that. Board ops that exceed the per-turn bound are rejected the same
 * way so the model learns the cap instead of the harness silently truncating.
 */
export function validateTutorPayload(
  payload: unknown,
  allowedEvidence: ReadonlySet<string>,
  maxBoardOps: number = MAX_BOARD_OPS_PER_TURN
): ValidationResult<TutorTurn> {
  const errors: string[] = [];
  const root = asRecord(payload, "response", errors);
  if (!root) return { ok: false, errors };

  const speech = asNonEmptyString(root.speech, "speech", errors);
  const rawOps = asArray(root.board_ops, "board_ops", errors);
  if (!speech || !rawOps) return { ok: false, errors };

  if (rawOps.length > maxBoardOps) {
    errors.push(`board_ops has ${rawOps.length} operations; the maximum allowed per turn is ${maxBoardOps}`);
  }

  const boardOps: BoardOp[] = [];
  rawOps.forEach((entry, i) => {
    const op = validateBoardOp(entry, `board_ops[${i}]`, errors);
    if (op) boardOps.push(op);
  });

  let diagnosis: TutorDiagnosis | undefined;
  if (root.diagnosis !== undefined && root.diagnosis !== null) {
    const diag = asRecord(root.diagnosis, "diagnosis", errors);
    if (diag) {
      const misconceptions = asStringList(diag.misconceptions, "diagnosis.misconceptions", errors);
      const weakCriteria = asStringList(diag.weak_criteria, "diagnosis.weak_criteria", errors);
      const hintDependence = asEnum(diag.hint_dependence, HINT_DEPENDENCE, "diagnosis.hint_dependence", errors);
      const calibration = asEnum(diag.calibration, CALIBRATION, "diagnosis.calibration", errors);
      if (misconceptions && weakCriteria && hintDependence && calibration) {
        diagnosis = { misconceptions, weakCriteria, hintDependence, calibration };
      }
    }
  }

  const evidenceRefs = asStringList(root.evidence_refs, "evidence_refs", errors);
  if (!evidenceRefs) return { ok: false, errors };

  for (const ref of evidenceRefs) {
    if (!allowedEvidence.has(ref)) {
      errors.push(
        `evidence_refs contains "${ref}", which is not one of the supplied handles: ${[...allowedEvidence].join(", ")}. ` +
          `Never cite a section that was not provided.`
      );
    }
  }

  let requestedLevel: number | undefined;
  if (root.requested_level !== undefined && root.requested_level !== null) {
    const level = asFiniteNumber(root.requested_level, "requested_level", errors);
    if (level !== null) {
      if (!Number.isInteger(level) || level < 0 || level > MAX_HINT_LEVEL) {
        errors.push(`requested_level must be an integer between 0 and ${MAX_HINT_LEVEL} (got ${level})`);
      } else {
        requestedLevel = level;
      }
    }
  }

  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      speech,
      boardOps,
      diagnosis,
      evidenceRefs,
      requestedLevel,
    },
  };
}

function asStringList(value: unknown, path: string, errors: string[]): string[] | null {
  const arr = asArray(value, path, errors);
  if (!arr) return null;
  const out: string[] = [];
  arr.forEach((entry, i) => {
    if (typeof entry !== "string" || !entry.trim()) errors.push(`${path}[${i}] must be a non-empty string`);
    else out.push(entry.trim());
  });
  return out;
}

/* ─────────────────────────────────────────────────────────────
   SESSION PERSISTENCE
   ───────────────────────────────────────────────────────────── */

export interface SessionMessage {
  id: string;
  sessionId: string;
  role: "user" | "assistant" | "system";
  content: string;
  attachmentsJson: string | null;
  modelId: string | null;
  promptVersion: string | null;
  tokensUsed: number | null;
  timestamp: string;
}

export async function ensureChalkboardSession(session: {
  id: string;
  title: string;
  domain: Domain;
  boundNodes?: string[];
  assistancePolicy?: string;
}): Promise<void> {
  const db = await getDb();
  const now = new Date().toISOString();
  db.run(`
    INSERT INTO chalkboard_sessions (id, title, domain, bound_nodes, assistance_policy, status, created_at, updated_at, hint_level)
    VALUES (?, ?, ?, ?, ?, 'active', ?, ?, 0)
    ON CONFLICT(id) DO UPDATE SET
      title = excluded.title,
      domain = excluded.domain,
      updated_at = excluded.updated_at;
  `, [
    session.id,
    session.title,
    session.domain,
    JSON.stringify(session.boundNodes ?? []),
    session.assistancePolicy ?? "progressive_hints",
    now,
    now,
  ]);
  saveDbSync();
}

export async function createChalkboardSession(title: string, domain: Domain, boundNodes?: string[]): Promise<string> {
  const id = `session-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  await ensureChalkboardSession({ id, title, domain, boundNodes });
  return id;
}

/**
 * Delete one chalkboard session and everything hanging off it. `session_messages`
 * (and the other session-scoped tables) declare `ON DELETE CASCADE` and the
 * connection runs with `PRAGMA foreign_keys = ON`, so removing the parent row
 * takes the transcript with it — no orphaned messages left behind.
 */
export async function deleteChalkboardSession(sessionId: string): Promise<void> {
  const db = await getDb();
  db.run("DELETE FROM chalkboard_sessions WHERE id = ?;", [sessionId]);
  saveDbSync();
}

export async function appendSessionMessage(params: {
  sessionId: string;
  role: "user" | "assistant" | "system";
  content: string;
  attachmentsJson?: string | null;
  modelId?: string | null;
  promptVersion?: string | null;
  tokensUsed?: number | null;
}): Promise<void> {
  const db = await getDb();
  const now = new Date().toISOString();
  db.run(`
    INSERT INTO session_messages (id, session_id, role, content, attachments_json, model_id, prompt_version, tokens_used, timestamp)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);
  `, [
    `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    params.sessionId,
    params.role,
    params.content,
    params.attachmentsJson ?? null,
    params.modelId ?? null,
    params.promptVersion ?? null,
    params.tokensUsed ?? null,
    now,
  ]);
  saveDbSync();
}

export async function getSessionMessages(sessionId: string, limit = 12): Promise<SessionMessage[]> {
  const db = await getDb();
  const res = db.exec(`
    SELECT id, session_id, role, content, attachments_json, model_id, prompt_version, tokens_used, timestamp
    FROM session_messages
    WHERE session_id = ?
    ORDER BY rowid ASC
    LIMIT ?;
  `, [sessionId, limit]);

  if (!res[0]) return [];
  return res[0].values.map((r) => ({
    id: r[0] as string,
    sessionId: r[1] as string,
    role: r[2] as SessionMessage["role"],
    content: r[3] as string,
    attachmentsJson: r[4] as string | null,
    modelId: r[5] as string | null,
    promptVersion: r[6] as string | null,
    tokensUsed: r[7] as number | null,
    timestamp: r[8] as string,
  }));
}

export async function getSessionHintLevel(sessionId: string): Promise<number> {
  const db = await getDb();
  const res = db.exec("SELECT hint_level FROM chalkboard_sessions WHERE id = ?;", [sessionId]);
  const v = res[0]?.values?.[0]?.[0];
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

export async function setSessionHintLevel(sessionId: string, level: number): Promise<void> {
  const db = await getDb();
  const clamped = Math.max(0, Math.min(MAX_HINT_LEVEL, Math.round(level)));
  db.run(
    "UPDATE chalkboard_sessions SET hint_level = ?, updated_at = ? WHERE id = ?;",
    [clamped, new Date().toISOString(), sessionId]
  );
  saveDbSync();
}

/* ─────────────────────────────────────────────────────────────
   PROMPT ASSEMBLY
   ───────────────────────────────────────────────────────────── */

export function buildTutorUserPrompt(params: {
  domain: Domain;
  sessionTitle: string;
  assistancePolicy: string;
  hintLevel: number;
  awaitingFirstAttempt: boolean;
  learnerSummary: string;
  cards: TutorEvidenceCard[];
  history: SessionMessage[];
  learnerMessage: string;
  attachmentsNote: string;
}): string {
  const parts: string[] = [];

  const meta = DOMAIN_META[params.domain];
  parts.push(
    `SESSION: ${meta.label} · ${params.sessionTitle}`,
    `MODULE: ${meta.module}`,
    `ASSISTANCE POLICY: ${params.assistancePolicy} · unlocked hint level ${params.hintLevel} of ${MAX_HINT_LEVEL}`
  );

  parts.push(
    params.awaitingFirstAttempt
      ? `PHASE: awaiting_first_attempt — the learner has not yet made an independent attempt. ` +
        `Open by locating what they have tried and ask the question whose answer distinguishes their misconception. ` +
        `Do not teach ahead of their attempt.`
      : `PHASE: in_flow — the learner is actively working with you. Continue from their latest message.`
  );

  parts.push(`LEARNER MODEL SUMMARY:\n${params.learnerSummary}`);

  if (params.cards.length > 0) {
    parts.push(
      `CURRICULUM SECTIONS AVAILABLE — cite these by handle in evidence_refs:\n` +
        params.cards
          .map((c) => `- [${c.handle}] ${c.section}${c.excerpt ? `\n    ${c.excerpt.replace(/\n/g, "\n    ")}` : ""}`)
          .join("\n")
    );
  } else {
    parts.push("CURRICULUM: no curriculum sections are bound to this session.");
  }

  if (params.history.length > 1) {
    parts.push(
      `CONVERSATION SO FAR (oldest first):\n` +
        params.history
          .slice(0, -1)
          .map((m) => `${m.role}: ${m.content}`)
          .join("\n")
    );
  }

  parts.push(`LEARNER MESSAGE:\n"""\n${params.learnerMessage}${params.attachmentsNote}\n"""`);

  parts.push(
    `Return JSON only, in this exact shape:\n` +
      `{\n` +
      `  "speech": "<your reply to the learner — one or two sentences, Socratic>",\n` +
      `  "board_ops": [ { "op": "write_title" | "write_text" | "write_bullets" | "write_latex" | "visualize" | "write_callout", ...fields }, ... ],\n` +
      `  "diagnosis": { "misconceptions": [string], "weak_criteria": [string], "hint_dependence": "none"|"low"|"medium"|"high", "calibration": "under"|"over"|"accurate" } /* optional */,\n` +
      `  "evidence_refs": [ "<one of the supplied E-handles>" ],\n` +
      `  "requested_level": <0..${MAX_HINT_LEVEL}> /* optional: request a higher unlocked hint level when the learner is stuck */\n` +
      `}\n\n` +
      `BOARD OP FIELDS:\n` +
      `- write_title / write_text / write_callout: { "op", "text": string }\n` +
      `- write_bullets: { "op", "items": string[] }\n` +
      `- write_latex: { "op", "tex": string, "caption"?: string }\n` +
      `- visualize: { "op", "intent": VisualizationIntent } — use this for ANY diagram, plot, or geometric figure. ` +
      `Describe what the figure IS, not how to draw it; the renderer handles rendering. ` +
      `Geometry figures are auto-fitted to the available board space: omit "viewport" unless a specific teaching window is essential, and never use it to crop the figure. ` +
      `Use compact, readable coordinates (normally within about -10..10) so the shape remains prominent. ` +
      `Keep graphs bundled through this same visualize operation by emitting a separate "type":"function" intent when a lesson needs a plotted relationship; do not replace the requested geometric shape with a graph. ` +
      `VisualizationIntent is a discriminated union on "type": "geometry" | "function" | "chart" | "equation" | "diagram" | "circuit" | "chemistry" | "graph_theory". ` +
      `Every geometry object in the "objects" array is itself discriminated on "kind". ` +
      `Example — a circle with center O and two points A, B:\n` +
      `{ "op": "visualize", "intent": { "type": "geometry", "title": "Circle centered at O through A, with B nearby", "objects": [\n` +
      `  { "kind": "point", "id": "O", "at": [0, 0], "label": "O" },\n` +
      `  { "kind": "point", "id": "A", "at": [3, 0], "label": "A" },\n` +
      `  { "kind": "point", "id": "B", "at": [-2, 2], "label": "B" },\n` +
      `  { "kind": "circle", "id": "c1", "center": "O", "through": "A" }\n` +
      `] } }\n` +
      `Example — a function plot:\n` +
      `{ "op": "visualize", "intent": { "type": "function", "title": "f(x) = x^2 - 2x + 1", "domainX": [-5, 5], ` +
      `"expressions": [ { "id": "f", "expression": "x^2 - 2*x + 1", "label": "f(x)" } ] } }\n` +
      `Example — a standalone equation:\n` +
      `{ "op": "visualize", "intent": { "type": "equation", "latex": "E = mc^2" } }\n` +
      `Geometry object kinds: point (at:[x,y], label?, draggable?), line (through:[id,id]), segment (from,to), circle (center, through?|radius?), polygon (vertices:[id,...>=3]), angle (from,at,to), label (text,anchor), text (text,at). ` +
      `Only use "diagram", "circuit", "chemistry", or "graph_theory" types when the figure is genuinely that domain — never force geometry into another type.\n` +
      `Emit at most ${MAX_BOARD_OPS_PER_TURN} board operations.`
  );

  return parts.join("\n\n");
}

/* ─────────────────────────────────────────────────────────────
   PUBLIC ENTRY POINT
   ───────────────────────────────────────────────────────────── */

export interface TutorTurnRequest {
  sessionId: string;
  sessionTitle: string;
  domain: Domain;
  boundNodes?: string[];
  assistancePolicy?: string;
  /** Pre-session onboarding answers. Composed into a consistent system reminder
   *  and appended to the tutor's system prompt for the whole session, so the
   *  agent tutors to the learner's declared mastery, weak areas, chosen agent,
   *  pace, and remarks. Omitted for restored sessions (already ran). */
  onboarding?: OnboardingAnswers;
  learnerMessage: string;
  attachments?: { name: string; kind: string }[];
  signal?: AbortSignal;
  endpoint?: ResolvedRoleEndpoint;
}

/**
 * One tutor turn. Throws `AgentRuntimeError` when the tutor role is unbound or
 * the model cannot produce valid output — the caller surfaces that to the
 * learner rather than substituting a canned reply.
 */
export async function askTutorTurn(req: TutorTurnRequest): Promise<StructuredCallResult<TutorTurn>> {
  await ensureChalkboardSession({
    id: req.sessionId,
    title: req.sessionTitle,
    domain: req.domain,
    boundNodes: req.boundNodes,
    assistancePolicy: req.assistancePolicy,
  });

  // The learner's message is a fact worth persisting before any model work, so
  // history stays durable even if the call fails.
  await appendSessionMessage({
    sessionId: req.sessionId,
    role: "user",
    content: req.learnerMessage,
    attachmentsJson: req.attachments?.length ? JSON.stringify(req.attachments) : null,
  });

  const [history, learnerSummary, hintLevel] = await Promise.all([
    getSessionMessages(req.sessionId, 12),
    getActiveTutorContextLearnerSummary(),
    getSessionHintLevel(req.sessionId),
  ]);

  // The message just persisted is the only learner message when the session is
  // fresh — that is the "independent attempt" the prompt's rule 2 requires.
  const awaitingFirstAttempt = history.filter((m) => m.role === "user").length <= 1;

  const cards = await buildTutorEvidenceCards(req.boundNodes ?? []);
  const allowedEvidence = new Set(cards.map((c) => c.handle));

  const endpoint = req.endpoint ?? (await resolveRoleEndpoint("tutor"));

  // Thread the learner's onboarding answers (mastery, weakest part, chosen
  // tutor @, pace, remarks) into every turn as a consistent system reminder
  // appended to the base Socratic prompt — the agent tutors to these across the
  // whole session rather than forgetting them after the opener.
  const systemPrompt = req.onboarding
    ? `${TUTOR_AGENT_PROMPT_V1}\n\n${buildOnboardingReminder(req.onboarding)}`
    : TUTOR_AGENT_PROMPT_V1;

  const result = await callStructuredAgent({
    role: "tutor",
    endpoint,
    system: systemPrompt,
    user: buildTutorUserPrompt({
      domain: req.domain,
      sessionTitle: req.sessionTitle,
      assistancePolicy: req.assistancePolicy ?? "progressive_hints",
      hintLevel,
      awaitingFirstAttempt,
      learnerSummary,
      cards,
      history,
      learnerMessage: req.learnerMessage,
      attachmentsNote: req.attachments?.length
        ? `\n\nAttached: ${req.attachments.map((a) => a.name).join(", ")}`
        : "",
    }),
    promptVersion: TUTOR_PROMPT_VERSION,
    schemaVersion: TUTOR_SCHEMA_VERSION,
    temperature: 0.4,
    signal: req.signal,
    validate: (payload) => validateTutorPayload(payload, allowedEvidence),
  });

  await appendSessionMessage({
    sessionId: req.sessionId,
    role: "assistant",
    content: result.value.speech,
    modelId: result.modelId,
    promptVersion: TUTOR_PROMPT_VERSION,
    tokensUsed: result.usage?.total ?? null,
  });

  if (typeof result.value.requestedLevel === "number" && result.value.requestedLevel !== hintLevel) {
    await setSessionHintLevel(req.sessionId, result.value.requestedLevel);
  }

  return result;
}

/* ─────────────────────────────────────────────────────────────
   ONBOARDING INTERVIEW (AI-GENERATED)
   ───────────────────────────────────────────────────────────── */

export interface GeneratedOnboarding {
  /** Short opener the agent writes before the questions. */
  intro: string;
  questions: OnboardingQuestion[];
}

function validateOnboardingPayload(payload: unknown): ValidationResult<GeneratedOnboarding> {
  const errors: string[] = [];
  const rec = asRecord(payload, "root", errors);
  if (!rec) return invalid(...errors);

  const intro = asNonEmptyString(rec.intro, "root.intro", errors);
  const rawQuestions = asArray(rec.questions, "root.questions", errors);
  if (!intro || !rawQuestions) return invalid(...errors);

  if (rawQuestions.length < MIN_ONBOARDING_QUESTIONS || rawQuestions.length > MAX_ONBOARDING_QUESTIONS) {
    errors.push(
      `root.questions must contain between ${MIN_ONBOARDING_QUESTIONS} and ${MAX_ONBOARDING_QUESTIONS} questions (got ${rawQuestions.length})`
    );
    return invalid(...errors);
  }

  const questions: OnboardingQuestion[] = [];
  rawQuestions.forEach((entry, i) => {
    const path = `root.questions[${i}]`;
    // Accept a bare string or {question}. Anything else is a schema error the
    // repair loop reports back to the model.
    if (typeof entry === "string") {
      const text = entry.trim();
      if (!text) errors.push(`${path} must be a non-empty question`);
      else questions.push({ id: `q${i + 1}`, question: text });
      return;
    }
    const obj = asRecord(entry, path, errors);
    if (!obj) return;
    const text = asNonEmptyString(obj.question, `${path}.question`, errors);
    if (text) questions.push({ id: `q${i + 1}`, question: text.trim() });
  });

  if (errors.length > 0) return invalid(...errors);
  return { ok: true, value: { intro, questions } };
}

/**
 * Ask the tutor agent to write this session's onboarding interview.
 *
 * The questions are generated per session against the concept the learner
 * picked and, when the curriculum node has been transcribed, the real evidence
 * excerpts for it — so the interview probes that specific material rather than
 * reading from a fixed script. Throws `AgentRuntimeError` when the tutor role is
 * unbound or the model cannot produce a valid interview; the caller surfaces
 * that instead of substituting canned questions.
 */
export async function generateOnboardingQuestions(req: {
  concept: string;
  boundNodes?: string[];
  agentCount: number;
  signal?: AbortSignal;
  endpoint?: ResolvedRoleEndpoint;
}): Promise<GeneratedOnboarding> {
  const cards = await buildTutorEvidenceCards(req.boundNodes ?? []);
  const endpoint = req.endpoint ?? (await resolveRoleEndpoint("tutor"));

  const evidenceBlock = cards.length
    ? `\n\nCurriculum evidence for this concept (use it to make the questions specific — refer to the actual sub-topics, methods and pitfalls it contains):\n` +
      cards
        .map((c) => `[${c.handle}] ${c.section}\n${c.excerpt ?? ""}`)
        .join("\n\n")
    : `\n\nNo transcribed curriculum evidence is available for this concept yet — write questions from the concept name alone and do not invent specific section contents.`;

  const system =
    `You are the Socratic tutor's intake interviewer. Before a study session begins you write a short set of onboarding questions ` +
    `that let the tutor calibrate to this learner on this specific concept.\n\n` +
    `Rules:\n` +
    `- Write between ${MIN_ONBOARDING_QUESTIONS} and ${MAX_ONBOARDING_QUESTIONS} questions, tailored to the concept and the evidence you are given.\n` +
    `- Probe what actually matters for teaching this material: current grasp, which sub-parts they expect to struggle with, prior background the concept depends on, pace/deadline pressure, and how they want to be taught.\n` +
    `- Ask about the learner, never quiz them on the content — this is calibration, not assessment.\n` +
    `- Each question must be answerable in one short line, since the learner replies with one line per question.\n` +
    `- Be specific to the concept. Do not emit generic filler that would fit any subject.\n` +
    `- Do not number the questions; numbering is added by the app.\n\n` +
    `Return JSON only: {"intro": string, "questions": [{"question": string}, ...]}. ` +
    `"intro" is one or two sentences welcoming the learner and saying why you are asking. No prose outside the JSON, no code fences.`;

  const user =
    `Concept for this session: ${req.concept}\n` +
    `Tutor agents currently bound and @-mentionable: ${req.agentCount}` +
    (req.agentCount > 0
      ? ` (you may ask which one they want, but the app already tells them the count — do not repeat the number).`
      : ` (no agents are bound yet — do not ask them to choose one).`) +
    evidenceBlock;

  const result = await callStructuredAgent({
    role: "tutor",
    endpoint,
    system,
    user,
    promptVersion: ONBOARDING_PROMPT_VERSION,
    schemaVersion: ONBOARDING_SCHEMA_VERSION,
    temperature: 0.6,
    signal: req.signal,
    validate: validateOnboardingPayload,
  });

  return result.value;
}