export type Domain = "math" | "physics" | "chemistry" | "biology" | "programming";

export const DOMAIN_META: Record<Domain, { label: string; accent: string; module: string }> = {
  math: { label: "Mathematics", accent: "#7dd3fc", module: "Calculus & Analysis" },
  physics: { label: "Physics", accent: "#a5b4fc", module: "Classical Mechanics" },
  chemistry: { label: "Chemistry", accent: "#fca5a5", module: "Reaction Kinetics" },
  biology: { label: "Biology", accent: "#86efac", module: "Cell & Molecular" },
  programming: { label: "Programming", accent: "#fcd34d", module: "Algorithms & Complexity" },
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
  | { id: string; kind: "graph2d"; fn: string; domainX: [number, number]; caption?: string; curves?: string[] }
  | { id: string; kind: "graph3d"; surface: string; caption?: string }
  | { id: string; kind: "diagram"; variant: "orbit" | "atom" | "cell" | "stack" | "beaker"; caption?: string }
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

export function prepSteps(domain: Domain): string[] {
  const meta = DOMAIN_META[domain];
  return [
    "Parsing your prompt…",
    `Subject detected — ${meta.label}`,
    `Loading module · ${meta.module}`,
    "Calibrating infinite chalkboard…",
    "Loading chalk, LaTeX & plotting engine…",
    "Teleporting you to the board…",
  ];
}

export function buildBoard(domain: Domain, prompt: string): BoardDoc {
  const cleanTitle = prompt.trim() || DOMAIN_META[domain].label;
  return {
    id: uid("board"),
    domain,
    subtitle: trimPrompt(prompt),
    title: cleanTitle,
    blocks: [],
  };
}

export function buildSubBoard(selection: string, question: string, parent: BoardDoc): BoardDoc {
  const s = selection.length > 46 ? selection.slice(0, 46) + "…" : selection;
  const domain = parent.domain;
  const blocks: Block[] = [
    { id: uid("b"), kind: "title", text: s },
    {
      id: uid("b"),
      kind: "text",
      text: question
        ? `You asked: "${trimPrompt(question)}". Let's unpack it from the part you highlighted.`
        : "Let's unpack the part you highlighted, one layer at a time.",
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
        case "graph2d":
          lines.push(`**[Graph 2D]** ${b.caption ?? b.fn}`, "");
          break;
        case "graph3d":
          lines.push(`**[Graph 3D]** ${b.caption ?? b.surface}`, "");
          break;
        case "diagram":
          lines.push(`**[Diagram: ${b.variant}]** ${b.caption ?? ""}`, "");
          break;
        case "row":
          walk(b.children);
          break;
      }
    }
  };

  walk(board.blocks);
  return lines.join("\n");
}
