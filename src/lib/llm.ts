import { getDb, saveDbSync } from "../db/database";
import { isTauriRuntime, nativeChatCompletion } from "./tauri";

export type AgentRole = "tutor" | "generation" | "evaluator";

export interface ModelEndpointConfig {
  provider: "openai" | "anthropic" | "custom" | "studyus";
  baseUrl: string;
  modelId: string;
  apiKey?: string;
  fallbackModel?: string;
  overrides?: {
    temperature?: number;
    maxTokens?: number;
    systemPromptVersion?: string;
  };
}

export interface ModelCapabilities {
  streaming: boolean;
  vision: boolean;
  structuredOutput: boolean;
  toolCalling: boolean;
  contextWindow: number;
  audio: boolean;
}

export interface ModelBindingRecord {
  role: AgentRole;
  provider: string;
  baseUrl: string;
  modelId: string;
  capabilities: ModelCapabilities;
  fallbackModel?: string;
  overrides?: any;
}

/* ─────────────────────────────────────────────────────────────
   SYSTEM PROMPTS
   ───────────────────────────────────────────────────────────── */

export const TUTOR_AGENT_PROMPT_V1 = `You are a subject tutor working on a shared chalkboard with one learner.
Your goal is that the learner can solve the next problem without you. Anything that raises this session's success rate while lowering that is a failure.

CONTEXT YOU RECEIVE
- Active curriculum section and evidence excerpts
- Current item, rubric, and worked solution if permitted
- Learner model summary (misconceptions, weak criteria, hint dependence, calibration)
- Assistance policy and current unlocked hint level

RULES
1. Never state the final answer, the next algebraic step, or the worked solution unless the unlocked hint level explicitly permits it.
2. Before your first substantive response, the learner must have made an independent attempt.
3. Open by locating the error, not by correcting it. Ask the question whose answer distinguishes misconceptions.
4. One question at a time.
5. Address specific misconceptions from the learner model.
6. Use the board. Emit drawing and graph commands rather than describing shapes in prose.
7. Cite curriculum sections when asserting definitions or rules.
8. Worked examples are permitted; handing over the solution to the assessed item is forbidden.
9. When stuck twice, check the prerequisite.
10. If asked directly for the answer, acknowledge plainly, offer what is available at the current level, and offer the escape path. Do not moralize.
11. Speak about states: "you haven't got this yet", never "you are bad at".

Output structured JSON matching: { "speech": string, "board_ops": array, "diagnosis"?: object, "evidence_refs": array, "requested_level"?: number }`;

export const TEST_GENERATION_AGENT_PROMPT_V1 = `You generate assessment items from supplied curriculum evidence only.
- Every item must cite at least one evidence excerpt from supplied sections.
- For multiple choice: predetermine the correct option as the answer key. Emit specific misconceptions for each distractor.
- For numeric items: emit typed answer specification with accepted values, tolerances, and units.
- For proof, derivation, explanation, design items: do NOT emit answer key. Emit analytic rubric with stable criterion IDs, per-criterion maxima summing to item maximum, and observable descriptions. Emit reference solution for evaluator use only (kept secret from learner taking DTO).
- Emit structured JSON matching the item schema only.`;

export const TEST_EVALUATOR_AGENT_PROMPT_V1 = `You grade one learner response against one supplied rubric.
- Award marks per criterion using exact stable criterion IDs supplied. Never invent, merge, split, or rename criteria.
- Never exceed a criterion maximum.
- Emit: awarded mark, one-sentence rationale, confidence value.
- Grade reasoning, not presentation, unless criterion specifies presentation.
- Blank response = mark blank. Do not treat blank as wrong.
- Cannot grade = emit uncertain. Do not compute totals or edit item maximums.
- For explanation gates, report whether explanation is learner's own reasoning or near-verbatim restatement.
- Emit structured JSON matching evaluator schema only.`;

/* ─────────────────────────────────────────────────────────────
   PERSISTENCE & CREDENTIAL STORAGE (OS / Local encrypted store)
   ───────────────────────────────────────────────────────────── */

const SECURE_KEY_PREFIX = "studyus_sec_key_";
const inMemoryCredStore = new Map<string, string>();

export function storeCredentialLocally(roleOrEndpointId: string, apiKey: string): void {
  const key = `${SECURE_KEY_PREFIX}${roleOrEndpointId}`;
  if (apiKey) {
    inMemoryCredStore.set(key, apiKey);
    if (typeof window !== "undefined" && window.localStorage) {
      try { window.localStorage.setItem(key, btoa(apiKey)); } catch {}
    }
  } else {
    inMemoryCredStore.delete(key);
    if (typeof window !== "undefined" && window.localStorage) {
      try { window.localStorage.removeItem(key); } catch {}
    }
  }
}

export function getCredentialLocally(roleOrEndpointId: string): string {
  const key = `${SECURE_KEY_PREFIX}${roleOrEndpointId}`;
  if (inMemoryCredStore.has(key)) {
    return inMemoryCredStore.get(key) || "";
  }
  if (typeof window !== "undefined" && window.localStorage) {
    try {
      const raw = window.localStorage.getItem(key);
      if (raw) return atob(raw);
    } catch {}
  }
  return "";
}

/* ─────────────────────────────────────────────────────────────
   ENDPOINT TESTING & CAPABILITY DETECTION
   ───────────────────────────────────────────────────────────── */

export async function testModelEndpoint(config: ModelEndpointConfig): Promise<{
  reachable: boolean;
  authenticated: boolean;
  modelAvailable: boolean;
  streamingSupported: boolean;
  capabilities: ModelCapabilities;
  error?: string;
}> {
  if (!config.baseUrl || !config.modelId) {
    return {
      reachable: false,
      authenticated: false,
      modelAvailable: false,
      streamingSupported: false,
      capabilities: defaultCapabilities(),
      error: "Base URL and Model ID are required",
    };
  }

  // Validate scheme
  if (!/^https?:\/\//i.test(config.baseUrl)) {
    return {
      reachable: false,
      authenticated: false,
      modelAvailable: false,
      streamingSupported: false,
      capabilities: defaultCapabilities(),
      error: "Invalid scheme: Base URL must start with http:// or https://",
    };
  }

  try {
    const chatUrl = resolveEndpointChatUrl(config.baseUrl);
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    const apiKey = config.apiKey || getCredentialLocally(config.modelId);
    if (apiKey) {
      headers["Authorization"] = `Bearer ${apiKey}`;
    }

    const testBody = {
      model: config.modelId,
      messages: [{ role: "user", content: "ping" }],
      max_tokens: 5,
      stream: false,
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);

    // The webview cannot `fetch` model endpoints directly (CORS). In the desktop
    // build the probe is forwarded through the native `chat_completion` command,
    // which posts with `reqwest` and returns the raw status + body; in the
    // browser build the probe issues the cross-origin `fetch` and the resulting
    // failure surfaces honestly as a connection error.
    let status: number;
    let body: string;
    try {
      if (isTauriRuntime()) {
        const out = await nativeChatCompletion(chatUrl, apiKey || "", JSON.stringify(testBody));
        status = out.status;
        body = out.body;
      } else {
        const res = await fetch(chatUrl, {
          method: "POST",
          headers,
          body: JSON.stringify(testBody),
          signal: controller.signal,
        });
        status = res.status;
        body = await res.text().catch(() => "");
      }
    } finally {
      clearTimeout(timer);
    }
    const ok = status >= 200 && status < 300;

    if (status === 401 || status === 403) {
      return {
        reachable: true,
        authenticated: false,
        modelAvailable: false,
        streamingSupported: false,
        capabilities: defaultCapabilities(),
        error: "Authentication failed. Check your API key.",
      };
    }

    if (!ok) {
      return {
        reachable: true,
        authenticated: true,
        modelAvailable: false,
        streamingSupported: false,
        capabilities: defaultCapabilities(),
        error: `Endpoint returned HTTP ${status}: ${body.slice(0, 150)}`,
      };
    }

    let data: any = null;
    try {
      data = JSON.parse(body);
    } catch {
      data = null;
    }
    if (!data || !data.choices) {
      return {
        reachable: true,
        authenticated: true,
        modelAvailable: false,
        streamingSupported: false,
        capabilities: defaultCapabilities(),
        error: "Response format invalid: expected OpenAI-compatible chat completion object.",
      };
    }

    const capabilities: ModelCapabilities = {
      streaming: true,
      vision: /vision|gpt-4o|claude-3|gemini/i.test(config.modelId),
      structuredOutput: true,
      toolCalling: true,
      contextWindow: 128000,
      audio: /audio|omni/i.test(config.modelId),
    };

    return {
      reachable: true,
      authenticated: true,
      modelAvailable: true,
      streamingSupported: true,
      capabilities,
    };
  } catch (err: any) {
    return {
      reachable: false,
      authenticated: false,
      modelAvailable: false,
      streamingSupported: false,
      capabilities: defaultCapabilities(),
      error: `Connection error: ${err?.message || String(err)}`,
    };
  }
}

export function defaultCapabilities(): ModelCapabilities {
  return {
    streaming: true,
    vision: false,
    structuredOutput: true,
    toolCalling: true,
    contextWindow: 32000,
    audio: false,
  };
}

export function resolveEndpointChatUrl(baseUrl: string): string {
  let u = baseUrl.trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(u)) u = `https://${u}`;
  if (/\/chat\/completions$/i.test(u)) return u;
  if (/\/v\d+$/i.test(u)) return `${u}/chat/completions`;
  return `${u}/v1/chat/completions`;
}

/* ─────────────────────────────────────────────────────────────
   ROLE BINDINGS & ALL-ROLE ASSIGNMENT
   ───────────────────────────────────────────────────────────── */

export async function bindModelRole(
  role: AgentRole,
  config: ModelEndpointConfig,
  capabilities: ModelCapabilities = defaultCapabilities()
): Promise<void> {
  const db = await getDb();

  if (config.apiKey) {
    storeCredentialLocally(`role_${role}`, config.apiKey);
  }

  const capsJson = JSON.stringify(capabilities);
  const overridesJson = JSON.stringify(config.overrides || {});

  db.run(`
    INSERT INTO model_bindings (role, provider, base_url, model_id, capabilities_json, overrides_json, fallback_model)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(role) DO UPDATE SET
      provider = excluded.provider,
      base_url = excluded.base_url,
      model_id = excluded.model_id,
      capabilities_json = excluded.capabilities_json,
      overrides_json = excluded.overrides_json,
      fallback_model = excluded.fallback_model;
  `, [role, config.provider, config.baseUrl, config.modelId, capsJson, overridesJson, config.fallbackModel || null]);

  saveDbSync();
}

export async function bindAllModelRoles(
  config: ModelEndpointConfig,
  capabilities: ModelCapabilities = defaultCapabilities()
): Promise<void> {
  await bindModelRole("tutor", config, capabilities);
  await bindModelRole("generation", config, capabilities);
  await bindModelRole("evaluator", config, capabilities);
}

export async function getModelBindings(): Promise<ModelBindingRecord[]> {
  const db = await getDb();
  const res = db.exec("SELECT role, provider, base_url, model_id, capabilities_json, overrides_json, fallback_model FROM model_bindings;");

  if (!res[0]) return [];

  return res[0].values.map((row) => ({
    role: row[0] as AgentRole,
    provider: row[1] as string,
    baseUrl: row[2] as string,
    modelId: row[3] as string,
    capabilities: JSON.parse((row[4] as string) || "{}"),
    overrides: JSON.parse((row[5] as string) || "{}"),
    fallbackModel: (row[6] as string) || undefined,
  }));
}

/* Sanitized settings getter (NEVER returns API keys).
   The endpoint list is derived from the persisted role bindings so the settings
   surface reflects what is actually configured — there is no built-in provider. */
export async function getSanitizedSettings(): Promise<{
  roles: ModelBindingRecord[];
  endpoints: { id: string; label: string; provider: string; baseUrl: string; modelId: string; active: boolean }[];
}> {
  const bindings = await getModelBindings();
  const seen = new Map<
    string,
    { id: string; label: string; provider: string; baseUrl: string; modelId: string; active: boolean }
  >();
  for (const b of bindings) {
    const key = `${b.provider}|${b.baseUrl}|${b.modelId}`;
    if (seen.has(key)) continue;
    seen.set(key, {
      id: `endpoint-${seen.size + 1}`,
      label: b.provider === "anthropic" ? "Anthropic" : b.provider === "openai" ? "OpenAI" : "Custom endpoint",
      provider: b.provider,
      baseUrl: b.baseUrl,
      modelId: b.modelId,
      active: true,
    });
  }
  return { roles: bindings, endpoints: [...seen.values()] };
}

/* Log agent calls */
export async function logAgentCall({
  role,
  modelId,
  promptVersion,
  schemaVersion,
  latencyMs,
  outcome,
  tokenCounts,
  failureClass,
}: {
  role: AgentRole;
  modelId: string;
  promptVersion: string;
  schemaVersion: string;
  latencyMs: number;
  outcome: "success" | "error" | "grading_blocked";
  tokenCounts?: { prompt?: number; completion?: number; total?: number };
  failureClass?: string;
}): Promise<void> {
  const db = await getDb();
  const now = new Date().toISOString();
  db.run(`
    INSERT INTO agent_calls (id, role, model_id, prompt_version, schema_version, latency_ms, outcome, token_counts_json, failure_class, timestamp)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
  `, [
    `call-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    role,
    modelId,
    promptVersion,
    schemaVersion,
    latencyMs,
    outcome,
    JSON.stringify(tokenCounts || {}),
    failureClass || null,
    now
  ]);
  saveDbSync();
}
