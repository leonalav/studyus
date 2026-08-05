export type SubjectId = "physics" | "math" | "cs" | "history";

export interface Subject {
  id: SubjectId;
  label: string;
  topic: string;
  icon: "orbit" | "sigma" | "binary" | "landmark";
}

export const SUBJECTS: Subject[] = [
  { id: "physics", label: "Physics", topic: "Orbital Mechanics", icon: "orbit" },
  { id: "math", label: "Math", topic: "Derivatives & Rates", icon: "sigma" },
  { id: "cs", label: "Comp Sci", topic: "Big-O Notation", icon: "binary" },
  { id: "history", label: "History", topic: "Cold War Essays", icon: "landmark" },
];

export interface TutorScript {
  text: string;
  notes: string[];
}

export type Intent = "greet" | "explain" | "practice" | "quiz";

export const SCRIPTS: Record<SubjectId, Record<Intent, TutorScript>> = {
  physics: {
    greet: {
      text: "Hey — tonight we're on orbital mechanics. The whole subject rests on one idea: an orbit is just falling, but with enough sideways speed that you keep missing the ground. Tell me where to start, or pick a prompt below.",
      notes: ["An orbit = continuous free-fall with tangential velocity", "You fall toward the body but keep missing it"],
    },
    explain: {
      text: "Picture a cannon on a tall mountain. Fire a ball and it arcs down. Fire it faster and it lands farther. At about 7.8 km/s near Earth, the ball falls at exactly the rate the surface curves away — that's low Earth orbit. Gravity never switches off; it acts as the centripetal force bending straight-line motion into an ellipse. That's why astronauts float: they're not beyond gravity, they're in free-fall alongside their spacecraft.",
      notes: [
        "Orbital speed near Earth ≈ 7.8 km/s",
        "Gravity provides the centripetal force",
        "Weightlessness = shared free-fall, not zero gravity",
      ],
    },
    practice: {
      text: "Practice problem: a satellite orbits Earth at radius r = 7.0 × 10⁶ m. Using v = √(GM/r), with GM = 3.99 × 10¹⁴ m³/s², find its orbital speed. Hint: divide first, then take the square root — you should land between 7 and 8 km/s. Work it out and send me your answer; I'll check each step.",
      notes: ["v = √(GM/r)", "GM(Earth) = 3.99 × 10¹⁴ m³/s²", "Expected answer ≈ 7.5 km/s"],
    },
    quiz: {
      text: "Quick check: if a satellite's orbital radius is quadrupled, its orbital speed… (a) doubles, (b) halves, (c) quarters, (d) stays the same? Think about how v scales with r in v = √(GM/r). Reply with a letter.",
      notes: ["v ∝ 1/√r", "Quadrupling r → speed halves (b)"],
    },
  },
  math: {
    greet: {
      text: "Welcome back — derivatives tonight. A derivative is just a precise answer to 'how fast is this changing right now?' We'll build from average slope to instantaneous slope. Where do you want to dive in?",
      notes: ["Derivative = instantaneous rate of change", "It's the slope of the tangent line"],
    },
    explain: {
      text: "Take f(x) = x². Between x = 3 and x = 3.1, the average slope is (9.61 − 9)/0.1 = 6.1. Shrink the gap to 3.001 and you get 6.001. As the gap → 0, the slope → 6 — that limit is f′(3). The power rule packages this: d/dx xⁿ = n·xⁿ⁻¹, so f′(x) = 2x everywhere. The derivative isn't a number, it's a machine that hands you a slope at any x.",
      notes: ["f′(a) = limit of average slopes as Δx → 0", "Power rule: d/dx xⁿ = n·xⁿ⁻¹", "For x², slope at x = 3 is 6"],
    },
    practice: {
      text: "Your turn: find the derivative of f(x) = 3x⁴ − 5x² + 7, then evaluate it at x = 1. Apply the power rule term by term — constants vanish. Send your f′(x) and f′(1) and I'll verify.",
      notes: ["f′(x) = 12x³ − 10x", "f′(1) = 2", "Derivative of a constant is 0"],
    },
    quiz: {
      text: "Pop quiz: the derivative of f(x) = x² at x = 5 is… (a) 5, (b) 10, (c) 25, (d) 2? Remember f′(x) = 2x. Reply with a letter.",
      notes: ["f′(x) = 2x", "f′(5) = 10 → answer (b)"],
    },
  },
  cs: {
    greet: {
      text: "Big-O tonight — the vocabulary for how algorithms scale. Forget exact seconds; Big-O counts how work grows as input grows. Pick a prompt or ask me anything about a specific algorithm.",
      notes: ["Big-O describes growth of work vs. input size", "It ignores constants and machine speed"],
    },
    explain: {
      text: "Imagine searching a list. Scanning every item one by one is O(n) — double the list, double the work. But binary search on a sorted list halves the search space each step: 1,000,000 items take about 20 steps. That's O(log n) — growth so slow it's nearly flat. The trap is nested loops: comparing every pair is O(n²), which is why 10× the data feels 100× slower. Big-O lets you predict that before you write a line.",
      notes: ["Linear scan: O(n)", "Binary search: O(log n)", "Nested loops over the same data: O(n²)"],
    },
    practice: {
      text: "Exercise: what's the Big-O of this loop structure?\n\nfor i in range(n):\n    for j in range(n):\n        check(i, j)\n\nThen change the inner loop to range(i) — does the complexity class change? Send your reasoning.",
      notes: ["Full nested loops → O(n²)", "range(i) still sums to n(n−1)/2 → still O(n²)", "Constants and halves don't change the class"],
    },
    quiz: {
      text: "Check yourself: binary search on a sorted array of 1,024 elements needs at most how many comparisons? (a) 10, (b) 32, (c) 512, (d) 1,024. Hint: 2¹⁰ = 1024. Reply with a letter.",
      notes: ["log₂(1024) = 10", "Answer (a): at most 10 comparisons"],
    },
  },
  history: {
    greet: {
      text: "Cold War essay workshop tonight. The difference between a B essay and an A essay is almost always the thesis — a claim someone could disagree with. Let's sharpen yours. Where should we start?",
      notes: ["Strong thesis = arguable claim, not a fact", "Every paragraph must serve the thesis"],
    },
    explain: {
      text: "A weak thesis reports: 'The Cold War was a conflict between the USA and USSR.' Nobody disagrees — so there's no essay. A strong thesis argues: 'The Cold War was sustained less by ideology than by mutual domestic interest in a permanent enemy.' Now you have tension. Each paragraph becomes evidence for or against: the arms industry, proxy wars, détente collapsing whenever either side looked weak. Structure follows: claim → evidence → counter-evidence → refined claim.",
      notes: [
        "Report-fact thesis = no argument",
        "Arguable thesis creates essay structure",
        "Use the pattern: claim → evidence → counter → refine",
      ],
    },
    practice: {
      text: "Try it: rewrite this flat statement into an arguable thesis — 'The Berlin Wall was built in 1961.' Give it a because-clause that a historian could challenge. Send me your version and we'll stress-test it together.",
      notes: ["Add a because-clause with a debatable cause", "Aim for a claim, not a date"],
    },
    quiz: {
      text: "Which is the stronger thesis? (a) 'Containment shaped US foreign policy from 1947 to 1991.' (b) 'Containment succeeded militarily but failed morally, exporting repression to the Global South.' Reply with a letter — and say why in one line.",
      notes: ["(b) is stronger: it argues and can be contested", "A good thesis invites disagreement"],
    },
  },
};

export function fallbackScript(question: string, subject: Subject): TutorScript {
  const q = question.trim().replace(/\s+/g, " ");
  const short = q.length > 90 ? q.slice(0, 90) + "…" : q;
  return {
    text: `Good question. On "${short}" — let's break it into pieces. First, what do we already know from ${subject.topic.toLowerCase()}? Anchor the new idea to that, then ask what would change if one assumption flipped. Walk me through your first step on it, even a rough one, and I'll correct course as we go.`,
    notes: [`Anchored "${short}" to ${subject.topic}`, "Strategy: vary one assumption at a time"],
  };
}

export interface RecentSession {
  subject: SubjectId;
  title: string;
  detail: string;
  when: string;
  minutes: number;
}

export const RECENT_SESSIONS: RecentSession[] = [
  { subject: "physics", title: "Kepler's laws, derived", detail: "12 notes · 3 practice problems", when: "Yesterday", minutes: 34 },
  { subject: "math", title: "Chain rule without tears", detail: "8 notes · quiz 4/5", when: "2 days ago", minutes: 21 },
  { subject: "cs", title: "Recursion & the call stack", detail: "10 notes · trace walkthrough", when: "4 days ago", minutes: 47 },
  { subject: "history", title: "Thesis clinic: détente", detail: "6 notes · 2 rewrites", when: "Last week", minutes: 18 },
];

export function detectIntent(text: string): Intent {
  const t = text.toLowerCase();
  if (/\b(quiz|test me|check me)\b/.test(t)) return "quiz";
  if (/\b(practice|problem|exercise|drill)\b/.test(t)) return "practice";
  return "explain";
}

export function shape(text: string, depth: "auto" | "simple" | "detailed"): string {
  if (depth === "simple") {
    const sentences = text.match(/[^.!?]+[.!?]+/g) ?? [text];
    return sentences.slice(0, 2).join(" ").trim();
  }
  if (depth === "detailed") {
    return text + "\n\nIf you want to go deeper: try re-deriving this from first principles, then change one variable and predict what breaks before you check.";
  }
  return text;
}
