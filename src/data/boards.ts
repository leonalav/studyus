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

const TITLES: Record<Domain, string> = {
  physics: "Physics session",
  math: "Math session",
  chemistry: "Chemistry session",
  biology: "Biology session",
  programming: "Programming session",
};

export function buildBoard(domain: Domain, prompt: string): BoardDoc {
  return {
    id: uid("board"),
    domain,
    subtitle: trimPrompt(prompt),
    title: TITLES[domain],
    blocks: [],
  };
}

function _legacyBoard(domain: Domain, prompt: string): BoardDoc {
  const base = { id: uid("board"), domain, subtitle: trimPrompt(prompt) };

  switch (domain) {
    case "physics":
      return {
        ...base,
        title: "Orbital Mechanics",
        blocks: [
          { id: uid("b"), kind: "title", text: "Orbits = falling, sideways" },
          {
            id: uid("b"),
            kind: "text",
            text: "A satellite is in free-fall. It keeps missing the ground because it also moves sideways fast enough.",
          },
        ],
      };

    case "math":
      return {
        ...base,
        title: "Derivatives & Rates",
        blocks: [
          { id: uid("b"), kind: "title", text: "The slope machine" },
          {
            id: uid("b"),
            kind: "text",
            text: "A derivative answers: how fast is this changing right now? Shrink the gap until the secant becomes a tangent.",
          },
          {
            id: uid("b"),
            kind: "row",
            children: [
              {
                id: uid("b"),
                kind: "latex",
                tex: "f'(a)=\\lim_{h\\to 0}\\frac{f(a+h)-f(a)}{h}",
                caption: "The limit definition",
              },
              {
                id: uid("b"),
                kind: "graph2d",
                fn: "parabola",
                domainX: [-3, 3],
                caption: "f(x)=x² and its tangent at x=1",
              },
            ],
          },
          {
            id: uid("b"),
            kind: "row",
            children: [
              { id: uid("b"), kind: "latex", tex: "\\frac{d}{dx}x^n = n\\,x^{n-1}", caption: "Power rule" },
              {
                id: uid("b"),
                kind: "graph2d",
                fn: "sine",
                domainX: [-6.5, 6.5],
                caption: "sin x (blue) vs cos x (its derivative)",
                curves: ["sin", "cos"],
              },
            ],
          },
          {
            id: uid("b"),
            kind: "bullets",
            items: ["Slope of x² at x=3 is 6", "Constants differentiate to 0", "f′ is itself a function"],
          },
          { id: uid("b"), kind: "callout", text: "3x⁴ − 5x² + 7  →  f′ = 12x³ − 10x" },
          { id: uid("b"), kind: "graph3d", surface: "saddle", caption: "z = x² − y² (partial slopes)" },
        ],
      };

    case "chemistry":
      return {
        ...base,
        title: "Reaction Kinetics",
        blocks: [
          { id: uid("b"), kind: "title", text: "How fast does it react?" },
          {
            id: uid("b"),
            kind: "text",
            text: "Rate depends on concentration, temperature and the activation barrier molecules must climb.",
          },
          {
            id: uid("b"),
            kind: "row",
            children: [
              { id: uid("b"), kind: "latex", tex: "\\text{rate} = k[A]^m[B]^n", caption: "Rate law" },
              { id: uid("b"), kind: "diagram", variant: "beaker", caption: "A + B → AB" },
            ],
          },
          {
            id: uid("b"),
            kind: "row",
            children: [
              { id: uid("b"), kind: "latex", tex: "k = A e^{-E_a/RT}", caption: "Arrhenius equation" },
              { id: uid("b"), kind: "graph2d", fn: "decay", domainX: [0, 8], caption: "[A] decays exponentially" },
            ],
          },
          {
            id: uid("b"),
            kind: "bullets",
            items: ["Order comes from experiment, not the equation", "+10 °C roughly doubles rate", "Catalyst lowers Eₐ, not ΔH"],
          },
          {
            id: uid("b"),
            kind: "row",
            children: [
              { id: uid("b"), kind: "diagram", variant: "atom", caption: "Collision geometry matters" },
              { id: uid("b"), kind: "graph3d", surface: "ripple", caption: "Energy landscape" },
            ],
          },
        ],
      };

    case "biology":
      return {
        ...base,
        title: "Cell & Molecular",
        blocks: [
          { id: uid("b"), kind: "title", text: "The cell as a factory" },
          {
            id: uid("b"),
            kind: "text",
            text: "Information flows DNA → RNA → protein. Each organelle is a specialised workshop feeding that pipeline.",
          },
          { id: uid("b"), kind: "callout", text: "DNA → transcription → mRNA → translation → protein" },
          {
            id: uid("b"),
            kind: "row",
            children: [
              {
                id: uid("b"),
                kind: "bullets",
                items: ["Nucleus stores the blueprint", "Ribosomes assemble proteins", "Mitochondria make ATP", "Membrane controls traffic"],
              },
              { id: uid("b"), kind: "diagram", variant: "cell", caption: "Eukaryotic cell" },
            ],
          },
          {
            id: uid("b"),
            kind: "latex",
            tex: "C_6H_{12}O_6 + 6O_2 \\rightarrow 6CO_2 + 6H_2O + \\text{ATP}",
            caption: "Cellular respiration",
          },
          {
            id: uid("b"),
            kind: "row",
            children: [
              { id: uid("b"), kind: "graph2d", fn: "logistic", domainX: [0, 10], caption: "Population growth (logistic)" },
              { id: uid("b"), kind: "graph3d", surface: "ripple", caption: "Diffusion gradient" },
            ],
          },
        ],
      };

    case "programming":
      return {
        ...base,
        title: "Algorithms & Complexity",
        blocks: [
          { id: uid("b"), kind: "title", text: "How work grows with n" },
          {
            id: uid("b"),
            kind: "text",
            text: "Big-O ignores constants and hardware. It only asks: when the input doubles, what happens to the work?",
          },
          {
            id: uid("b"),
            kind: "row",
            children: [
              {
                id: uid("b"),
                kind: "latex",
                tex: "O(1) < O(\\log n) < O(n) < O(n\\log n) < O(n^2)",
                caption: "The ladder",
              },
              {
                id: uid("b"),
                kind: "graph2d",
                fn: "complexity",
                domainX: [1, 10],
                caption: "n² vs n log n vs n vs log n",
              },
            ],
          },
          {
            id: uid("b"),
            kind: "row",
            children: [
              {
                id: uid("b"),
                kind: "bullets",
                items: ["Linear scan → O(n)", "Binary search → O(log n)", "Nested loops → O(n²)", "log₂(1024) = 10 comparisons"],
              },
              { id: uid("b"), kind: "diagram", variant: "stack", caption: "Call stack during recursion" },
            ],
          },
          { id: uid("b"), kind: "callout", text: "10× the data on an O(n²) loop = 100× the time." },
          {
            id: uid("b"),
            kind: "latex",
            tex: "T(n) = 2T(n/2) + O(n) \\Rightarrow O(n\\log n)",
            caption: "Merge sort recurrence",
          },
          { id: uid("b"), kind: "graph3d", surface: "saddle", caption: "Time vs input vs branching" },
        ],
      };
  }
}
export { _legacyBoard as _legacyBoardExported };

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
    {
      id: uid("b"),
      kind: "bullets",
      items: [
        "Step 1 — restate the idea in your own words",
        "Step 2 — find the one variable that drives it",
        "Step 3 — change that variable and predict the result",
      ],
    },
  ];

  if (domain === "math" || domain === "physics") {
    blocks.push({
      id: uid("b"),
      kind: "row",
      children: [
        { id: uid("b"), kind: "latex", tex: "\\Delta y = f'(x)\\,\\Delta x", caption: "Local linear approximation" },
        { id: uid("b"), kind: "graph2d", fn: "parabola", domainX: [-3, 3], caption: "Zoom in and any curve looks straight" },
      ],
    });
  } else if (domain === "programming") {
    blocks.push({
      id: uid("b"),
      kind: "row",
      children: [
        { id: uid("b"), kind: "diagram", variant: "stack", caption: "Trace it frame by frame" },
        {
          id: uid("b"),
          kind: "latex",
          tex: "\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2} \\Rightarrow O(n^2)",
          caption: "Why partial loops still square",
        },
      ],
    });
  } else if (domain === "chemistry") {
    blocks.push({
      id: uid("b"),
      kind: "row",
      children: [
        { id: uid("b"), kind: "diagram", variant: "beaker", caption: "Follow the molecules" },
        { id: uid("b"), kind: "graph2d", fn: "decay", domainX: [0, 8], caption: "Concentration over time" },
      ],
    });
  } else {
    blocks.push({
      id: uid("b"),
      kind: "row",
      children: [
        { id: uid("b"), kind: "diagram", variant: "cell", caption: "Where it happens" },
        { id: uid("b"), kind: "graph2d", fn: "logistic", domainX: [0, 10], caption: "Growth under a ceiling" },
      ],
    });
  }

  blocks.push({ id: uid("b"), kind: "callout", text: "Highlight anything here to branch again." });

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
