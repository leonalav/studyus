/**
 * Minimal OpenAI-compatible chat completion client + a Studyus agent loop.
 *
 * The agent uses the temporary endpoint configured inside the chalkboard
 * settings. It emits plain text (sent to the chat box) and tool calls
 * (which the host converts into chalkboard blocks).
 */

export type ChatMessage = { role: "system" | "user" | "assistant" | "tool"; content: string; tool_call_id?: string; name?: string };

export interface AgentTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  call: (args: Record<string, unknown>) => Promise<string> | string;
}

export interface AgentEndpoint {
  baseUrl: string;
  model: string;
  apiKey: string;
  enabled: boolean;
}

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface AgentResult {
  text: string;
  toolCalls: ToolCall[];
}

/* ── Default tools the agent can call (they all write to the chalkboard) ── */

export function defaultTools(): AgentTool[] {
  return [
    {
      name: "write_text",
      description: "Write a paragraph of explanatory text on the chalkboard.",
      parameters: {
        type: "object",
        properties: { text: { type: "string", description: "The text to write." } },
        required: ["text"],
      },
      call: () => "",
    },
    {
      name: "write_title",
      description: "Write the section title on the chalkboard.",
      parameters: {
        type: "object",
        properties: { text: { type: "string" } },
        required: ["text"],
      },
      call: () => "",
    },
    {
      name: "write_bullets",
      description: "Write a bulleted list of key points.",
      parameters: {
        type: "object",
        properties: { items: { type: "array", items: { type: "string" } } },
        required: ["items"],
      },
      call: () => "",
    },
    {
      name: "write_latex",
      description: "Render a LaTeX equation on the chalkboard. Provide the full LaTeX source and a short caption.",
      parameters: {
        type: "object",
        properties: { tex: { type: "string" }, caption: { type: "string" } },
        required: ["tex"],
      },
      call: () => "",
    },
    {
      name: "plot_2d",
      description: "Draw a 2D function plot. Provide an identifier for the function (sqrt, parabola, sine, decay, logistic, complexity) and the x-range as [xmin, xmax].",
      parameters: {
        type: "object",
        properties: {
          fn: { type: "string", enum: ["sqrt", "parabola", "sine", "decay", "logistic", "complexity"] },
          domainX: { type: "array", items: { type: "number" }, minItems: 2, maxItems: 2 },
          caption: { type: "string" },
          curves: { type: "array", items: { type: "string" } },
        },
        required: ["fn", "domainX"],
      },
      call: () => "",
    },
    {
      name: "plot_3d",
      description: "Render a 3D wireframe surface. Choose saddle, well, or ripple.",
      parameters: {
        type: "object",
        properties: { surface: { type: "string", enum: ["saddle", "well", "ripple"] }, caption: { type: "string" } },
        required: ["surface"],
      },
      call: () => "",
    },
    {
      name: "draw_diagram",
      description: "Draw one of the chalkboard diagrams.",
      parameters: {
        type: "object",
        properties: { variant: { type: "string", enum: ["orbit", "atom", "cell", "stack", "beaker"] }, caption: { type: "string" } },
        required: ["variant"],
      },
      call: () => "",
    },
    {
      name: "write_callout",
      description: "Drop a callout box on the chalkboard — used for short, important asides.",
      parameters: {
        type: "object",
        properties: { text: { type: "string" } },
        required: ["text"],
      },
      call: () => "",
    },
  ];
}

/* ── Transport ── */

export class AgentError extends Error {}

export async function runAgent({
  endpoint,
  system,
  user,
  tools,
  onDelta,
  signal,
}: {
  endpoint: AgentEndpoint;
  system: string;
  user: string;
  tools: AgentTool[];
  onDelta?: (text: string) => void;
  signal?: AbortSignal;
}): Promise<AgentResult> {
  if (!endpoint.enabled) throw new AgentError("Endpoint is disabled");
  if (!endpoint.baseUrl.trim()) throw new AgentError("Base URL is empty");
  if (!endpoint.model.trim()) throw new AgentError("Model is empty");

  const url = resolveChatUrl(endpoint.baseUrl);

  const makeBody = (withTools: boolean) => ({
    model: endpoint.model.trim(),
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    ...(withTools
      ? {
          tools: tools.map((t) => ({
            type: "function",
            function: { name: t.name, description: t.description, parameters: t.parameters },
          })),
          tool_choice: "auto",
        }
      : {}),
    stream: false,
  });

  const doFetch = async (withTools: boolean) => {
    try {
      return await fetch(url, {
        method: "POST",
        mode: "cors",
        headers: {
          "Content-Type": "application/json",
          ...(endpoint.apiKey.trim() ? { Authorization: `Bearer ${endpoint.apiKey.trim()}` } : {}),
        },
        body: JSON.stringify(makeBody(withTools)),
        signal,
      });
    } catch (err: any) {
      if (err?.name === "AbortError") throw err;
      // fetch() only throws for network-level failures — nearly always CORS.
      throw new AgentError(
        `Could not reach ${url}. This is normally a CORS restriction: the endpoint must send ` +
          `Access-Control-Allow-Origin for browser requests. Check the URL, or use a provider/proxy that allows browser calls.`
      );
    }
  };

  let res = await doFetch(true);

  // Some OpenAI-compatible servers reject the `tools` field. Retry once without it.
  if (!res.ok && (res.status === 400 || res.status === 404 || res.status === 422)) {
    const firstError = await res.text().catch(() => "");
    if (/tool|function/i.test(firstError) || res.status === 404) {
      res = await doFetch(false);
    } else {
      throw new AgentError(`Endpoint returned ${res.status}: ${firstError.slice(0, 240)}`);
    }
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const hint =
      res.status === 401
        ? " — check your API key"
        : res.status === 404
        ? " — check the base URL path"
        : res.status === 429
        ? " — rate limited"
        : "";
    throw new AgentError(`Endpoint returned ${res.status}${hint}: ${text.slice(0, 240)}`);
  }

  const data = await res.json().catch(() => null);
  if (!data) throw new AgentError("Endpoint returned a non-JSON response");
  const message = data.choices?.[0]?.message;
  if (!message) throw new AgentError("Endpoint returned an empty response");

  const text = (message.content as string) ?? "";
  if (onDelta) onDelta(text);

  const calls: ToolCall[] = (message.tool_calls ?? []).map((c: any) => ({
    id: c.id,
    name: c.function.name,
    args: safeJson(c.function.arguments),
  }));

  return { text, toolCalls: calls };
}

/** Accepts `https://host`, `https://host/v1`, or a full `/chat/completions` URL. */
export function resolveChatUrl(baseUrl: string) {
  let u = baseUrl.trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(u)) u = `https://${u}`;
  if (/\/chat\/completions$/i.test(u)) return u;
  if (/\/v\d+$/i.test(u)) return `${u}/chat/completions`;
  return `${u}/v1/chat/completions`;
}

function safeJson(raw: unknown): Record<string, unknown> {
  if (typeof raw === "object" && raw) return raw as Record<string, unknown>;
  if (typeof raw !== "string") return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}
