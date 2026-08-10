/**
 * Shared agent runtime for the three Studyus agent roles.
 *
 * Every model call in the app goes through this module so that role binding,
 * credential resolution, timeouts, structured-output validation, bounded repair
 * attempts and call tracing are enforced in exactly one place.
 *
 * Design constraints:
 *  - Every loop is bounded. There is no unbounded retry or repair path.
 *  - Every model call is recorded in `agent_calls`, including failures.
 *  - A schema failure is never silently coerced into a default value; callers
 *    receive a typed error and decide how to degrade.
 */

import { getDb } from "../db/database";
import {
  type AgentRole,
  type ModelCapabilities,
  defaultCapabilities,
  getCredentialLocally,
  logAgentCall,
  resolveEndpointChatUrl,
} from "./llm";
import { isTauriRuntime, nativeChatCompletion } from "./tauri";

export type FailureClass =
  | "no_binding"
  | "transport"
  | "auth"
  | "rate_limit"
  | "http_error"
  | "empty_response"
  | "malformed_json"
  | "schema_invalid"
  | "timeout"
  | "aborted";

export class AgentRuntimeError extends Error {
  readonly failureClass: FailureClass;
  readonly detail?: string;

  constructor(message: string, failureClass: FailureClass, detail?: string) {
    super(message);
    this.name = "AgentRuntimeError";
    this.failureClass = failureClass;
    this.detail = detail;
  }
}

/* ─────────────────────────────────────────────────────────────
   ROLE BINDING RESOLUTION
   ───────────────────────────────────────────────────────────── */

export interface ResolvedRoleEndpoint {
  role: AgentRole;
  provider: string;
  baseUrl: string;
  modelId: string;
  apiKey: string;
  fallbackModel?: string;
  capabilities: ModelCapabilities;
  temperature?: number;
  maxTokens?: number;
}

export const ROLE_LABEL: Record<AgentRole, string> = {
  tutor: "Socratic Tutor",
  generation: "Test Generation",
  evaluator: "Test Evaluator",
};

/**
 * Reads the persisted binding for a role. Throws `no_binding` rather than
 * inventing a default endpoint — the UI must tell the user to bind a model.
 */
export async function resolveRoleEndpoint(role: AgentRole): Promise<ResolvedRoleEndpoint> {
  const db = await getDb();
  const res = db.exec(
    `SELECT provider, base_url, model_id, capabilities_json, overrides_json, fallback_model
     FROM model_bindings WHERE role = ?;`,
    [role]
  );

  const row = res[0]?.values?.[0];
  if (!row) {
    throw new AgentRuntimeError(
      `No model is bound to the ${ROLE_LABEL[role]} role. Open Settings → Model configuration and assign an endpoint.`,
      "no_binding"
    );
  }

  const baseUrl = String(row[1] ?? "").trim();
  const modelId = String(row[2] ?? "").trim();

  if (!baseUrl || !modelId) {
    throw new AgentRuntimeError(
      `The ${ROLE_LABEL[role]} role is bound to an incomplete endpoint (base URL or model identifier is empty).`,
      "no_binding"
    );
  }

  let capabilities = defaultCapabilities();
  try {
    const parsed = JSON.parse(String(row[3] ?? "{}"));
    if (parsed && typeof parsed === "object" && typeof parsed.streaming === "boolean") {
      capabilities = parsed as ModelCapabilities;
    }
  } catch {
    /* keep defaults */
  }

  let overrides: { temperature?: number; maxTokens?: number } = {};
  try {
    const parsed = JSON.parse(String(row[4] ?? "{}"));
    if (parsed && typeof parsed === "object") overrides = parsed;
  } catch {
    /* keep empty */
  }

  return {
    role,
    provider: String(row[0] ?? "custom"),
    baseUrl,
    modelId,
    apiKey: getCredentialLocally(`role_${role}`) || getCredentialLocally(modelId),
    fallbackModel: (row[5] as string) || undefined,
    capabilities,
    temperature: typeof overrides.temperature === "number" ? overrides.temperature : undefined,
    maxTokens: typeof overrides.maxTokens === "number" ? overrides.maxTokens : undefined,
  };
}

export async function getBoundRoles(): Promise<Record<AgentRole, boolean>> {
  const db = await getDb();
  const res = db.exec("SELECT role, base_url, model_id FROM model_bindings;");
  const bound: Record<AgentRole, boolean> = { tutor: false, generation: false, evaluator: false };
  for (const row of res[0]?.values ?? []) {
    const role = row[0] as AgentRole;
    if (role in bound && String(row[1] ?? "").trim() && String(row[2] ?? "").trim()) {
      bound[role] = true;
    }
  }
  return bound;
}

/** Count of fully-bound agent roles — surfaced to the learner during onboarding
 *  as "Currently you have {number} agents" so they know how many they can @. */
export async function countBoundAgents(): Promise<number> {
  const roles = await getBoundRoles();
  return (roles.tutor ? 1 : 0) + (roles.generation ? 1 : 0) + (roles.evaluator ? 1 : 0);
}

/* ─────────────────────────────────────────────────────────────
   TRANSPORT
   ───────────────────────────────────────────────────────────── */

export interface RuntimeMessage {
  role: "system" | "user" | "assistant";
  content: string | ContentPart[];
}

/**
 * OpenAI-compatible multimodal content parts. A text part carries prose; an
 * image_url part carries a `data:image/...;base64,...` URL (e.g. a rasterized
 * PDF page handed to a vision model for LaTeX transcription). Anthropic-style
 * `image` blocks are normalized at the wire boundary, not here.
 */
export type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string; detail?: "auto" | "low" | "high" } };

export interface TokenUsage {
  prompt?: number;
  completion?: number;
  total?: number;
}

interface CompletionOutcome {
  content: string;
  usage: TokenUsage;
}

export const DEFAULT_TIMEOUT_MS = 60_000;

function httpError(status: number, text: string, endpoint: ResolvedRoleEndpoint): AgentRuntimeError {
  const body = text.slice(0, 240);
  if (status === 401 || status === 403) {
    return new AgentRuntimeError(
      `${ROLE_LABEL[endpoint.role]} endpoint rejected the API key (HTTP ${status}).`,
      "auth",
      body
    );
  }
  if (status === 429) {
    return new AgentRuntimeError(`${ROLE_LABEL[endpoint.role]} endpoint is rate limited (HTTP 429).`, "rate_limit", body);
  }
  return new AgentRuntimeError(
    `${ROLE_LABEL[endpoint.role]} endpoint returned HTTP ${status}${status === 404 ? " — check the base URL path" : ""}.`,
    "http_error",
    body
  );
}

/**
 * One OpenAI-compatible chat completion. Falls back once from JSON mode when
 * the server rejects `response_format`, and never retries beyond that.
 */
export async function chatCompletion({
  endpoint,
  messages,
  jsonMode,
  temperature,
  maxTokens,
  timeoutMs,
  signal,
}: {
  endpoint: ResolvedRoleEndpoint;
  messages: RuntimeMessage[];
  jsonMode: boolean;
  temperature: number;
  maxTokens?: number;
  timeoutMs: number;
  signal?: AbortSignal;
}): Promise<CompletionOutcome> {
  const url = resolveEndpointChatUrl(endpoint.baseUrl);

  const controller = new AbortController();
  let timedOut = false;
  const onOuterAbort = () => controller.abort();

  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener("abort", onOuterAbort, { once: true });
  }
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  const body = (withJsonMode: boolean) => ({
    model: endpoint.modelId,
    messages,
    temperature,
    ...(maxTokens ? { max_tokens: maxTokens } : {}),
    ...(withJsonMode ? { response_format: { type: "json_object" } } : {}),
    stream: false,
  });

  // A normalized view of the response — the browser `fetch` and the native
  // Tauri `chat_completion` command produce different shapes, but the
  // downstream handling (status dispatch + JSON parse + content extraction)
  // is identical, so both collapse into this `{ status, text }` pair.
  type RawResponse = { status: number; text: string };

  const postBrowser = async (withJsonMode: boolean): Promise<RawResponse> => {
    const res = await fetch(url, {
      method: "POST",
      mode: "cors",
      headers: {
        "Content-Type": "application/json",
        ...(endpoint.apiKey ? { Authorization: `Bearer ${endpoint.apiKey}` } : {}),
      },
      body: JSON.stringify(body(withJsonMode)),
      signal: controller.signal,
    });
    const text = await res.text().catch(() => "");
    return { status: res.status, text };
  };

  // Native transport — the webview cannot reach model endpoints (CORS), so in
  // the desktop build we forward the assembled body to the Rust command, which
  // posts with `reqwest` (no same-origin enforcement) and hands back the raw
  // HTTP status + body. API key leaves the page only over this one IPC call.
  const postNative = async (withJsonMode: boolean): Promise<RawResponse> => {
    const out = await nativeChatCompletion(
      url,
      endpoint.apiKey || "",
      JSON.stringify(body(withJsonMode))
    );
    return { status: out.status, text: out.body };
  };

  const post = async (withJsonMode: boolean): Promise<RawResponse> => {
    try {
      return isTauriRuntime() ? await postNative(withJsonMode) : await postBrowser(withJsonMode);
    } catch (err: any) {
      if (err?.name === "AbortError") {
        throw timedOut
          ? new AgentRuntimeError(
              `${ROLE_LABEL[endpoint.role]} agent timed out after ${Math.round(timeoutMs / 1000)}s.`,
              "timeout"
            )
          : new AgentRuntimeError("Request cancelled.", "aborted");
      }
      throw new AgentRuntimeError(
        `Could not reach ${url}. ` +
          (isTauriRuntime()
            ? `The native transport failed to reach the endpoint — check the base URL or your network.`
            : `Browser requests need the endpoint to send Access-Control-Allow-Origin; check the base URL or use a provider that permits browser calls.`),
        "transport",
        String(typeof err === "string" ? err : err?.message ?? err)
      );
    }
  };

  try {
    let res = await post(jsonMode);

    // Servers that do not implement response_format reject the whole request.
    if (jsonMode && (res.status === 400 || res.status === 404 || res.status === 422)) {
      if (/response_format|json_object|unsupported|unrecognized|not supported/i.test(res.text)) {
        res = await post(false);
      } else {
        throw httpError(res.status, res.text, endpoint);
      }
    }

    if (res.status < 200 || res.status >= 300) {
      throw httpError(res.status, res.text, endpoint);
    }

    let data: any;
    try {
      data = JSON.parse(res.text);
    } catch {
      throw new AgentRuntimeError(
        `${ROLE_LABEL[endpoint.role]} endpoint returned a non-JSON response.`,
        "empty_response"
      );
    }

    const message = data.choices?.[0]?.message;
    const content = typeof message?.content === "string" ? message.content : "";
    if (!content.trim()) {
      throw new AgentRuntimeError(
        `${ROLE_LABEL[endpoint.role]} endpoint returned an empty message.`,
        "empty_response",
        res.text.slice(0, 240)
      );
    }

    return {
      content,
      usage: {
        prompt: data.usage?.prompt_tokens,
        completion: data.usage?.completion_tokens,
        total: data.usage?.total_tokens,
      },
    };
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener("abort", onOuterAbort);
  }
}

/* ─────────────────────────────────────────────────────────────
   JSON EXTRACTION
   ───────────────────────────────────────────────────────────── */

/**
 * Pulls the first complete JSON object or array out of a model response,
 * tolerating code fences and surrounding prose. String contents and escapes are
 * respected so that braces inside strings do not end the scan early.
 */
export function extractJsonPayload(raw: string): unknown {
  const text = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");

  const start = text.search(/[[{]/);
  if (start === -1) {
    throw new AgentRuntimeError("Agent response contained no JSON.", "malformed_json", text.slice(0, 240));
  }

  const opener = text[start];
  const closer = opener === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];

    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }

    if (ch === '"') inString = true;
    else if (ch === opener) depth++;
    else if (ch === closer) {
      depth--;
      if (depth === 0) {
        const slice = text.slice(start, i + 1);
        try {
          return JSON.parse(slice);
        } catch (err) {
          throw new AgentRuntimeError(
            "Agent response was not parseable JSON.",
            "malformed_json",
            `${String((err as Error).message)} :: ${slice.slice(0, 240)}`
          );
        }
      }
    }
  }

  throw new AgentRuntimeError("Agent response contained unterminated JSON.", "malformed_json", text.slice(0, 240));
}

/* ─────────────────────────────────────────────────────────────
   VALIDATION CONTRACT
   ───────────────────────────────────────────────────────────── */

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; errors: string[] };

export function invalid(...errors: string[]): { ok: false; errors: string[] } {
  return { ok: false, errors };
}

export interface StructuredCallResult<T> {
  value: T;
  modelId: string;
  latencyMs: number;
  usage: TokenUsage;
  attempts: number;
  repaired: boolean;
}

/**
 * Calls a role's bound model and returns validated structured output.
 *
 * The repair loop is bounded by `maxRepairAttempts`; the model sees the exact
 * validation errors from the previous attempt. If the final attempt still fails
 * validation, a `schema_invalid` error is thrown carrying those errors — the
 * caller must decide how to degrade, because guessing here would silently
 * fabricate assessment data.
 */
export async function callStructuredAgent<T>({
  role,
  system,
  user,
  promptVersion,
  schemaVersion,
  validate,
  maxRepairAttempts = 2,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  temperature = 0.2,
  signal,
  endpoint: providedEndpoint,
}: {
  role: AgentRole;
  system: string;
  user: string;
  promptVersion: string;
  schemaVersion: string;
  validate: (payload: unknown) => ValidationResult<T>;
  maxRepairAttempts?: number;
  timeoutMs?: number;
  temperature?: number;
  signal?: AbortSignal;
  endpoint?: ResolvedRoleEndpoint;
}): Promise<StructuredCallResult<T>> {
  const endpoint = providedEndpoint ?? (await resolveRoleEndpoint(role));
  const messages: RuntimeMessage[] = [
    { role: "system", content: system },
    { role: "user", content: user },
  ];

  const totalAttempts = Math.max(1, maxRepairAttempts + 1);
  let lastErrors: string[] = [];

  for (let attempt = 1; attempt <= totalAttempts; attempt++) {
    const started = Date.now();
    let raw = "";
    let usage: TokenUsage = {};

    try {
      const completion = await chatCompletion({
        endpoint,
        messages,
        jsonMode: true,
        temperature,
        maxTokens: endpoint.maxTokens,
        timeoutMs,
        signal,
      });
      raw = completion.content;
      usage = completion.usage;
    } catch (err) {
      const failure = err instanceof AgentRuntimeError ? err.failureClass : "transport";
      await logAgentCall({
        role,
        modelId: endpoint.modelId,
        promptVersion,
        schemaVersion,
        latencyMs: Date.now() - started,
        outcome: "error",
        failureClass: failure,
      }).catch(() => {});
      throw err;
    }

    const latencyMs = Date.now() - started;

    let result: ValidationResult<T>;
    try {
      result = validate(extractJsonPayload(raw));
    } catch (err) {
      result = invalid(err instanceof AgentRuntimeError ? err.message : String(err));
    }

    if (result.ok) {
      await logAgentCall({
        role,
        modelId: endpoint.modelId,
        promptVersion,
        schemaVersion,
        latencyMs,
        outcome: "success",
        tokenCounts: usage,
        failureClass: attempt > 1 ? `recovered_after_${attempt - 1}_repair` : undefined,
      }).catch(() => {});

      return {
        value: result.value,
        modelId: endpoint.modelId,
        latencyMs,
        usage,
        attempts: attempt,
        repaired: attempt > 1,
      };
    }

    lastErrors = result.errors;
    await logAgentCall({
      role,
      modelId: endpoint.modelId,
      promptVersion,
      schemaVersion,
      latencyMs,
      outcome: "error",
      tokenCounts: usage,
      failureClass: "schema_invalid",
    }).catch(() => {});

    if (attempt < totalAttempts) {
      messages.push({ role: "assistant", content: raw.slice(0, 4000) });
      messages.push({
        role: "user",
        content:
          `Your previous response failed schema validation:\n` +
          lastErrors.map((e) => `- ${e}`).join("\n") +
          `\n\nReturn a corrected JSON object only. No prose, no code fences.`,
      });
    }
  }

  throw new AgentRuntimeError(
    `${ROLE_LABEL[role]} agent could not produce output matching ${schemaVersion} after ${totalAttempts} attempts.`,
    "schema_invalid",
    lastErrors.join("; ")
  );
}

/* ─────────────────────────────────────────────────────────────
   SHARED FIELD VALIDATORS
   ───────────────────────────────────────────────────────────── */

export function asRecord(value: unknown, path: string, errors: string[]): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    errors.push(`${path} must be an object`);
    return null;
  }
  return value as Record<string, unknown>;
}

export function asArray(value: unknown, path: string, errors: string[]): unknown[] | null {
  if (!Array.isArray(value)) {
    errors.push(`${path} must be an array`);
    return null;
  }
  return value;
}

export function asNonEmptyString(value: unknown, path: string, errors: string[]): string | null {
  if (typeof value !== "string" || !value.trim()) {
    errors.push(`${path} must be a non-empty string`);
    return null;
  }
  return value.trim();
}

export function asFiniteNumber(value: unknown, path: string, errors: string[]): number | null {
  const n = typeof value === "string" ? Number(value) : value;
  if (typeof n !== "number" || !isFinite(n)) {
    errors.push(`${path} must be a finite number`);
    return null;
  }
  return n;
}

export function asEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  path: string,
  errors: string[]
): T | null {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    errors.push(`${path} must be one of: ${allowed.join(", ")}`);
    return null;
  }
  return value as T;
}

export function asStringArray(value: unknown, path: string, errors: string[]): string[] | null {
  const arr = asArray(value, path, errors);
  if (!arr) return null;
  const out: string[] = [];
  arr.forEach((entry, i) => {
    if (typeof entry !== "string" || !entry.trim()) errors.push(`${path}[${i}] must be a non-empty string`);
    else out.push(entry.trim());
  });
  return out;
}
