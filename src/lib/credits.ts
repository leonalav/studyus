/**
 * Credits.
 *
 * Every learner starts with a fixed allowance. A request made through an
 * app-provided model spends credits at that tier's rate; a request through the
 * learner's own custom endpoint spends none, because they are paying their
 * vendor directly and charging them twice would be dishonest.
 *
 * The balance is DERIVED, not stored. `agent_calls` already records the
 * `model_id` of every call the app has ever made, so spend is a fold over that
 * table. Two things fall out of that choice:
 *
 *  - No migration, and the counter is correct retroactively for calls made
 *    before credits existed.
 *  - The ledger cannot drift from reality. A stored balance and a call log can
 *    disagree after a crash mid-write; a derived one cannot.
 */

import { STUDYUS_MODELS } from "./studyusModels";

/** Starting allowance for every learner. */
export const STARTING_CREDITS = 1000;

export interface CreditUsage {
  /** Total requests logged, successful or not. */
  requests: number;
  /** Requests that returned a usable result. */
  successful: number;
  /** Credits consumed. */
  spent: number;
  /** Credits left of the starting allowance, floored at zero. */
  remaining: number;
  /** Tokens the provider reported, when it reported any. */
  tokens: number;
  /** Request count per agent role. */
  byRole: Record<string, number>;
}

export const EMPTY_CREDIT_USAGE: CreditUsage = {
  requests: 0,
  successful: 0,
  spent: 0,
  remaining: STARTING_CREDITS,
  tokens: 0,
  byRole: {},
};

/**
 * Credit cost of one request to `modelId`.
 *
 * Unknown ids cost nothing. That is deliberate: an unrecognised model is either
 * the learner's own endpoint or a tier we have retired, and silently inventing
 * a charge for something we cannot price is worse than under-counting.
 */
export function creditsForModel(modelId: string | null | undefined): number {
  if (!modelId) return 0;
  const id = modelId.trim();
  const spec = STUDYUS_MODELS.find((model) => model.model === id || model.id === id);
  return spec?.credits ?? 0;
}

/** Round to the cent, so 0.25 + 0.5 never renders as 0.7500000000000001. */
function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Format a credit amount for display: trims noise but keeps real fractions. */
export function formatCreditAmount(value: number): string {
  const safe = Number.isFinite(value) ? value : 0;
  return Number.isInteger(safe) ? safe.toLocaleString() : round(safe).toLocaleString();
}

export interface AgentCallRow {
  role: string;
  outcome: string;
  modelId: string | null;
  /** Raw `token_counts_json`. */
  tokensJson: string | null;
}

/** Fold the call log into a usage summary. Pure, so it is directly testable. */
export function summarizeCredits(rows: AgentCallRow[]): CreditUsage {
  const usage: CreditUsage = { ...EMPTY_CREDIT_USAGE, byRole: {} };

  for (const row of rows) {
    const role = row.role?.trim() || "unknown";
    usage.requests += 1;
    usage.byRole[role] = (usage.byRole[role] ?? 0) + 1;
    if (row.outcome === "success") usage.successful += 1;
    usage.spent += creditsForModel(row.modelId);

    try {
      const parsed = JSON.parse(row.tokensJson || "{}") as { total?: unknown };
      if (typeof parsed.total === "number" && Number.isFinite(parsed.total)) {
        usage.tokens += parsed.total;
      }
    } catch {
      // A malformed token blob costs us a number, not the whole summary.
    }
  }

  usage.spent = round(usage.spent);
  usage.remaining = round(Math.max(0, STARTING_CREDITS - usage.spent));
  return usage;
}

/** Read the call log and summarise it. */
export async function loadCreditUsage(): Promise<CreditUsage> {
  const { getDb } = await import("../db/database");
  const db = await getDb();
  const result = db.exec("SELECT role, outcome, model_id, token_counts_json FROM agent_calls;");
  const rows: AgentCallRow[] = (result[0]?.values ?? []).map((row) => ({
    role: String(row[0] ?? ""),
    outcome: String(row[1] ?? ""),
    modelId: row[2] === null || row[2] === undefined ? null : String(row[2]),
    tokensJson: row[3] === null || row[3] === undefined ? null : String(row[3]),
  }));
  return summarizeCredits(rows);
}
