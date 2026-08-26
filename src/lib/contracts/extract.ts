import type { OnboardingAnswers } from "../../data/tutor";
import type { TurnContract } from "./types";
import { TURN_CONTRACT_SCHEMA_VERSION } from "./types";
import { validateCommitmentList } from "./validate";
import type { ValidationResult, ResolvedRoleEndpoint } from "../agentRuntime";
import { callStructuredAgent } from "../agentRuntime";

/**
 * Outcome of a commitment-extraction pass.
 *
 * `empty` is a first-class result, not a failure: a learner who stated no
 * learner-owned preferences must reach an intentional "no commitments" review
 * state rather than an invented one. Only `proposed` carries a contract, and it
 * is a proposal awaiting learner approval — never an activated revision.
 */
export type ExtractionOutcome =
  | { kind: "proposed"; contract: TurnContract; extractionWarnings?: string[] }
  | { kind: "empty" }
  | { kind: "failed"; errors: string[] };

let _counter = 0;
function newId(prefix: string): string {
  _counter += 1;
  return `${prefix}_${Date.now().toString(36)}_${_counter.toString(36)}`;
}
function nowIso(): string {
  return new Date().toISOString();
}

export async function extractContractFromOnboarding(
  learnerId: string,
  answers: OnboardingAnswers,
  sessionId?: string,
  endpoint?: ResolvedRoleEndpoint,
): Promise<ExtractionOutcome> {
  const extractionPrompt = buildExtractionPrompt(answers);
  try {
    const { value: rawPayload } = await callStructuredAgent<Record<string, unknown>>(
      {
        role: "generation",
        system: EXTRACTION_SYSTEM_PROMPT,
        user: extractionPrompt,
        promptVersion: "tc_onboarding_extract_v1",
        schemaVersion: `tc_v${TURN_CONTRACT_SCHEMA_VERSION}`,
        ...(endpoint ? { endpoint } : {}),
        validate: (payload: unknown): ValidationResult<Record<string, unknown>> => {
          if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
            return { ok: false, errors: ["LLM payload must be an object"] };
          }
          const obj = payload as Record<string, unknown>;
          // An empty array is a legitimate extraction result, so it must not
          // burn repair attempts trying to manufacture commitments.
          if (!Array.isArray(obj.commitments)) {
            return { ok: false, errors: ["LLM payload must contain a commitments array"] };
          }
          return { ok: true, value: obj };
        },
      },
    );

    const proposedRaw = Array.isArray(rawPayload.commitments) ? rawPayload.commitments : [];
    if (proposedRaw.length === 0) return { kind: "empty" };

    // The model proposes commitments element-by-element; deterministic code
    // disposes of malformed ones and keeps the valid survivors (the model
    // proposes, deterministic code disposes). A single bad commitment — a
    // half-filled pace with neither sessionsPerWeek nor minutesPerSession, an
    // unknown kind, an empty concept — is dropped rather than failing the
    // whole proposal. Survivors with no errors are a clean proposal;
    // survivors with errors are surfaced so the review sheet can show them;
    // no survivors with errors is a real model overstep (failed), not "no
    // preferences".
    const { commitments: proposed, errors: commitmentErrors } =
      validateCommitmentList(proposedRaw as unknown[]);

    if (proposed.length === 0) {
      // No valid commitments survived. If the model produced nothing
      // parseable (empty input also returns here, but it short-circuits
      // above), treat it as a model overstep rather than silently falling
      // back to "no preferences".
      return {
        kind: "failed",
        errors: commitmentErrors.length > 0
          ? commitmentErrors
          : ["LLM extraction produced no valid commitments"],
      };
    }

    // Identity, revision, and provenance are assigned deterministically here.
    // The model proposes commitments only; it never names its own revision.
    const contract: TurnContract = {
      commitments: proposed,
      contractId: newId("tc"),
      revision: 1,
      learnerId,
      schemaVersion: TURN_CONTRACT_SCHEMA_VERSION,
      createdAt: nowIso(),
      active: true,
      source: "onboarding",
      ...(sessionId ? { sessionId } : {}),
    };

    // The full-contract validator enforces top-level invariants (revision ≥ 1,
    // schema version, active/revoked state). The per-commitment shape was
    // already checked leniently above; re-running it strictly here is a
    // belt-and-braces guard against a future field the lenient pass misses.
    // If it ever disagrees after a clean lenient pass, that is a bug, so we
    // surface it as a failed extraction rather than activating a contract
    // the strict validator would reject downstream.
    if (commitmentErrors.length === 0) {
      return { kind: "proposed", contract };
    }

    // Lenient pass produced survivors but also errors. Drop the bad
    // commitments, keep the good, and surface the errors so the learner sees
    // what was discarded in the review sheet's failed-state footer.
    return { kind: "proposed", contract, extractionWarnings: commitmentErrors };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { kind: "failed", errors: [`LLM extraction failed: ${msg}`] };
  }
}

function buildExtractionPrompt(answers: OnboardingAnswers): string {
  return `Extract ONLY learner preferences from these onboarding answers. Concept: ${answers.concept}
Answers: ${answers.answers.map((a) => `Q: ${a.question} A: ${a.answer}`).join(" | ")}

Self-reported familiarity: ${answers.selfReportedFamiliarity ?? "not stated"}

OUTPUT FORMAT: Return JSON: { commitments: [ ... ] }
Each commitment MUST include ALL required fields for its kind:
- scope_include: MUST have "concept" (what the learner wants included)
- scope_exclude: MUST have "concept" (what the learner wants excluded)
- representation: MUST have "prefer" field
- pace: MUST have "sessionsPerWeek" and/or "minutesPerSession"
- notation: MUST have "rule"
- example_domain: MUST have "domain"
- goal: MUST have "statement"

CRITICAL: Only output a commitment kind if you have a REAL value for ALL its required fields. If the learner did not express a preference, simply OMIT that commitment type entirely. NEVER output a scope_include with an empty concept field — it will be rejected.

Return an empty commitments array if the learner stated no preferences; never invent one.

IMPORTANT: Only include learner preferences. DO NOT include engine-owned decisions about support levels, hint depth, mastery, evidence sufficiency, stage exits, or advancement.`;
}

const EXTRACTION_SYSTEM_PROMPT = `You extract learner commitments from onboarding answers. Your output is a LEARNER PROPOSAL, not an engine decision.

RULES:
1. Only capture what the learner has explicitly expressed a preference for.
2. NEVER invent commitments; if they stated no preferences, return an empty commitments array.
3. Each commitment kind REQUIRES all its fields:
   - scope_include: concept (string) REQUIRED
   - scope_exclude: concept (string) REQUIRED
   - representation: prefer (string) REQUIRED, avoid (string) optional
   - pace: sessionsPerWeek (number) and/or minutesPerSession (number) REQUIRED
   - notation: rule (string) REQUIRED
   - example_domain: domain (string) REQUIRED
   - goal: statement (string) REQUIRED, deadline (string) optional
4. NEVER output a scope_include with an empty or missing concept — it will be rejected.
5. If you do not have a real value for a required field, simply omit that commitment type.

BAD examples (will be rejected):
- { kind: "scope_include" }  ← missing concept
- { kind: "pace" }  ← missing sessionsPerWeek and minutesPerSession
- { kind: "goal" }  ← missing statement

GOOD examples:
- { kind: "scope_include", concept: "derivatives" }
- { kind: "scope_exclude", concept: "geometry diagrams" }
- { kind: "pace", sessionsPerWeek: 3, minutesPerSession: 45 }`;
