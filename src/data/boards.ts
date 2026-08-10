import type { VisualizationIntent, VisualizationState } from "../lib/visualization/types";

export type Domain = "math" | "physics" | "chemistry" | "biology" | "programming";

export const DOMAIN_META: Record<Domain, { label: string; accent: string; module: string }> = {
  math: { label: "Mathematics", accent: "#7dd3fc", module: "" },
  physics: { label: "Physics", accent: "#a5b4fc", module: "" },
  chemistry: { label: "Chemistry", accent: "#fca5a5", module: "" },
  biology: { label: "Biology", accent: "#86efac", module: "" },
  programming: { label: "Programming", accent: "#fcd34d", module: "" },
};

export function detectDomain(text: string): Domain {
  const t = text.toLowerCase();
  if (/\b(cell|dna|rna|enzyme|protein|mitosis|genetic|organism|photosynth|evolution|neuron)\b/.test(t)) return "biology";
  if (/\b(mole|atom|bond|acid|base|ph|reaction|molecul|titrat|oxid|electron shell|periodic)\b/.test(t)) return "chemistry";
  if (/\b(code|algorithm|big-?o|function|loop|recursion|array|complexity|python|javascript|sort|data structure)\b/.test(t))
    return "programming";
  if (/\b(orbit|force|velocity|gravity|momentum|energy|newton|kinemat|wave|quantum|thermodynam|circuit)\b/.test(t))
    return "physics";
  if (/\b(derivative|integral|limit|matrix|vector|equation|theorem|proof|algebra|geometry|probability|calculus)\b/.test(t))
    return "math";
  return "physics";
}

export type Block =
  | { id: string; kind: "title"; text: string }
  | { id: string; kind: "text"; text: string }
  | { id: string; kind: "bullets"; items: string[] }
  | { id: string; kind: "latex"; tex: string; caption?: string }
  | { id: string; kind: "visualization"; intent: VisualizationIntent; state?: VisualizationState }
  | { id: string; kind: "callout"; text: string }
  | { id: string; kind: "row"; children: Block[] };

export interface BoardDoc {
  id: string;
  title: string;
  subtitle: string;
  domain: Domain;
  blocks: Block[];
  parentId?: string;
}

let boardSeq = 0;
const uid = (p: string) => `${p}-${++boardSeq}`;

/**
 * Build an empty board for a study session.
 *
 * `title` must NEVER be the learner's raw prompt — the Chalkboard renders the
 * title as the board's opening line when there are no blocks yet, and echoing
 * the user's own question back onto the chalkboard reads as the tutor parroting
 * them. Prefer the chosen curriculum concept; fall back to the subject label.
 * The prompt is still available to the tutor via `learnerMessage`; it just
 * doesn't get painted on the board.
 */
export function buildBoard(domain: Domain, prompt: string, concept?: string): BoardDoc {
  const title = concept?.trim() || DOMAIN_META[domain].label;
  return {
    id: uid("board"),
    domain,
    subtitle: trimPrompt(prompt),
    title,
    blocks: [],
  };
}

export function buildSubBoard(selection: string, question: string, parent: BoardDoc): BoardDoc {
  const s = selection.length > 46 ? selection.slice(0, 46) + "…" : selection;
  const domain = parent.domain;
  // Do NOT echo the learner's question back onto the board — open the branch on
  // the highlighted concept itself and let the tutor's reply fill it in.
  const blocks: Block[] = [
    { id: uid("b"), kind: "title", text: s },
    {
      id: uid("b"),
      kind: "text",
      text: "Let's unpack the part you highlighted, one layer at a time.",
    },
  ];

  return {
    id: uid("board"),
    title: s,
    subtitle: question ? trimPrompt(question) : `Branched from ${parent.title}`,
    domain,
    blocks,
    parentId: parent.id,
  };
}

function trimPrompt(p: string) {
  const clean = p.trim().replace(/\s+/g, " ");
  return clean.length > 68 ? clean.slice(0, 68) + "…" : clean || "Study session";
}

function visualizationLabel(intent: VisualizationIntent): string {
  switch (intent.type) {
    case "geometry":
      return intent.title ?? "Geometry";
    case "function":
      return intent.title ?? "Function Graph";
    case "chart":
      return intent.title ?? "Chart";
    case "equation":
      return "Equation";
    case "diagram":
      return intent.variant;
    case "circuit":
      return intent.title ?? "Circuit";
    case "chemistry":
      return intent.title ?? "Chemistry";
    case "graph_theory":
      return intent.title ?? "Graph";
    default:
      return "Visualization";
  }
}

function visualizationCaption(intent: VisualizationIntent): string {
  switch (intent.type) {
    case "equation":
      return intent.caption ?? intent.latex;
    case "diagram":
      return intent.caption ?? "";
    case "chemistry":
      return intent.molecule ?? intent.reaction ?? "";
    default:
      return "";
  }
}

/**
 * Placeholder prep steps for the SessionCard animated "loading" sequence.
 * These are being replaced with a real curriculum transcription pipeline that
 * shows "Preparing curriculum..." with a progress bar. For now, returns empty
 * so the prep completes instantly and no fake text appears.
 */
export function prepSteps(_domain: Domain): string[] {
  return [];
}

export function boardToMarkdown(board: BoardDoc): string {
  const lines: string[] = [`# ${board.title}`, "", `_${DOMAIN_META[board.domain].label} · ${board.subtitle}_`, ""];

  const walk = (blocks: Block[]) => {
    for (const b of blocks) {
      switch (b.kind) {
        case "title":
          lines.push(`## ${b.text}`, "");
          break;
        case "text":
          lines.push(b.text, "");
          break;
        case "bullets":
          lines.push(...b.items.map((i) => `- ${i}`), "");
          break;
        case "latex":
          lines.push("$$", b.tex, "$$", b.caption ? `_${b.caption}_` : "", "");
          break;
        case "callout":
          lines.push(`> ${b.text}`, "");
          break;
        case "visualization": {
          const caption = visualizationCaption(b.intent);
          lines.push(caption ? `**[${visualizationLabel(b.intent)}]** ${caption}` : `**[${visualizationLabel(b.intent)}]**`, "");
          break;
        }
        case "row":
          walk(b.children);
          break;
      }
    }
  };

  walk(board.blocks);
  return lines.join("\n");
}
