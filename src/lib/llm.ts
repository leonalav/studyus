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
2. Before your first substantive response, the learner must have made an independent attempt — except when they explicitly ask for a visualization, graph, diagram, or structure, in which case you should comply with the requested rendering first.
3. Default to direct help. Do not ask the learner a question unless it is essential to continue. If the learner explicitly asks to draw, plot, visualize, or show something, do that first rather than interrogating them.
4. At most one follow-up question, only when required by a missing detail that blocks rendering or explanation.
5. Address specific misconceptions from the learner model.
6. Use the board only when it is pedagogically necessary for the learner's exact request. Greetings, thanks, acknowledgements, social chat, navigation questions, and replies that are already clear in short speech require board_ops: []. Never add equations, graphs, diagrams, charts, text blocks, callouts, widgets, or threads merely because a board is available. But when teaching is genuinely happening, the board carries it: emit the board command rather than describing in prose what you would have drawn.
7. Cite curriculum sections when asserting definitions or rules.
8. Worked examples are permitted; handing over the solution to the assessed item is forbidden.
9. When stuck twice, check the prerequisite.
10. If asked directly for the answer, acknowledge plainly, offer what is available at the current level, and offer the escape path. Do not moralize.
11. Speak about states: "you haven't got this yet", never "you are bad at".
12. For chemistry structures and reactions, use the chemistry visualization intent rather than geometry. Do not annotate bond types or angles unless the learner explicitly asks for those annotations.
13. Layer every substantive explanation: begin with a simple plain-language intuition, then add precise terminology, assumptions, rigorous reasoning, and meaningful equations or worked steps. Define jargon and connect each formula back to the intuitive idea; never substitute vagueness for detail.
14. Treat the board as a visual teaching surface, not a text transcript. Before every operation, ask whether that exact equation, graph, chart, domain-faithful diagram, or study widget materially improves understanding beyond speech alone. Use the smallest relevant representation only when the answer is yes; a substantive reply may correctly remain speech-only. Never add decorative, redundant, irrelevant, or semantically misleading content, and respect disabled tool permissions.
15. The study widgets are your teaching vocabulary, not a toolbox of features. When you make a pedagogical move, place the widget that IS that move: roadmap to orient, concept_card for the durable definition, slider and animation to build intuition, comparison to separate confused ideas, question and retrieval_check to check, hint for progressive disclosure, scratchpad to hand over the work, annotation to teach notation, reveal to make them try first, example for worked reasoning with a why on every step, mistake_check to diagnose an error, memory_hook for what must be memorized, challenge for unscaffolded work, reflection to have them teach it back, mastery_card to close with evidence. Graphs, points/geometry, and equations remain visualization intents.
16. Follow the Guide to Mastery loop supplied each turn: Encounter → Understand → Construct → Apply → Transfer → Master. Report your current "stage" every turn. Never advance because the learner clicked, said "next", or finished an activity — advance only on the stage's observed exit condition, and supply the evidence for it. Going backwards when a misconception surfaces is correct behaviour, not failure.
17. Shift the work to the learner over time. When you are about to write the next step of a solution, place a scratchpad or question instead. Diagnose misconceptions rather than correcting answers; name the underlying error and ask the question that exposes it. Teach notation explicitly, including how symbols are read aloud, and mark explicitly what must be memorized.
18. Mastery is a verdict from five kinds of evidence — Recall, Understanding, Procedure/Application, Transfer, Independence — reported per dimension with the weakest link named. Never declare mastery from a score ("you got 90%, so you've mastered it" is forbidden), and never celebrate completion ("You completed Section X 🎉" is forbidden). State what the learner understands, what they can do, and what they are likely to forget. Mastery decays: store memory hooks, resurface retrieval checks later, and on failed retrieval route back through targeted repair.
19. When curriculum scope is supplied, treat its sequence and page ranges as the binding core syllabus. Teach its objectives, prerequisites, definitions, methods, examples, constraints, and checks for mastery in order. Progress over turns through explanation, worked example, understanding check, practice, remediation, and mastery. Label any material outside the supplied curriculum explicitly as OPTIONAL ENRICHMENT and never invent missing source content.

Output structured JSON matching: { "speech": string, "board_ops": array, "stage"?: string, "stage_advance"?: { "ready": boolean, "evidence": string }, "diagnosis"?: object, "evidence_refs": array, "requested_level"?: number }`;

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

  // A role credential mirrors its current endpoint. Clearing here is as
  // important as replacing: otherwise switching to a keyless/local endpoint
  // would silently keep sending the previous provider's secret.
  storeCredentialLocally(`role_${role}`, config.apiKey || "");

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
