export type SubjectKey = "math" | "biology" | "chemistry" | "physics" | "programming";

export const SUBJECT_LIST: { id: SubjectKey; label: string; accent: string }[] = [
  { id: "math", label: "Math", accent: "#7dd3fc" },
  { id: "biology", label: "Biology", accent: "#86efac" },
  { id: "chemistry", label: "Chemistry", accent: "#fca5a5" },
  { id: "physics", label: "Physics", accent: "#a5b4fc" },
  { id: "programming", label: "Programming", accent: "#fcd34d" },
];

export interface Subsection {
  id: string;
  label: string;
}
export interface Section {
  id: string;
  label: string;
  subsections: Subsection[];
}
export interface CurriculumDoc {
  id: string;
  name: string;
  subject: SubjectKey;
  pages: number;
  sections: Section[];
}

export const CURRICULA: CurriculumDoc[] = [
  {
    id: "cur-calc",
    name: "AP Calculus BC — Course Guide.pdf",
    subject: "math",
    pages: 172,
    sections: [
      {
        id: "s1",
        label: "Limits & Continuity",
        subsections: [
          { id: "s1a", label: "Intuitive limits" },
          { id: "s1b", label: "One-sided limits" },
          { id: "s1c", label: "Squeeze theorem" },
        ],
      },
      {
        id: "s2",
        label: "Differentiation",
        subsections: [
          { id: "s2a", label: "Definition of the derivative" },
          { id: "s2b", label: "Power, product, quotient rules" },
          { id: "s2c", label: "Chain rule" },
          { id: "s2d", label: "Implicit differentiation" },
        ],
      },
      {
        id: "s3",
        label: "Integration",
        subsections: [
          { id: "s3a", label: "Riemann sums" },
          { id: "s3b", label: "Fundamental theorem" },
          { id: "s3c", label: "u-substitution" },
        ],
      },
      {
        id: "s4",
        label: "Series & Sequences",
        subsections: [
          { id: "s4a", label: "Convergence tests" },
          { id: "s4b", label: "Taylor & Maclaurin" },
        ],
      },
    ],
  },
  {
    id: "cur-phys",
    name: "IB Physics HL — Syllabus 2025.pdf",
    subject: "physics",
    pages: 88,
    sections: [
      {
        id: "p1",
        label: "Mechanics",
        subsections: [
          { id: "p1a", label: "Kinematics" },
          { id: "p1b", label: "Newton's laws" },
          { id: "p1c", label: "Momentum & impulse" },
        ],
      },
      {
        id: "p2",
        label: "Gravitation & Orbits",
        subsections: [
          { id: "p2a", label: "Newtonian gravitation" },
          { id: "p2b", label: "Orbital mechanics" },
          { id: "p2c", label: "Kepler's laws" },
        ],
      },
      {
        id: "p3",
        label: "Thermodynamics",
        subsections: [
          { id: "p3a", label: "Ideal gases" },
          { id: "p3b", label: "Entropy & the 2nd law" },
        ],
      },
      {
        id: "p4",
        label: "Waves & Optics",
        subsections: [
          { id: "p4a", label: "Simple harmonic motion" },
          { id: "p4b", label: "Interference & diffraction" },
        ],
      },
    ],
  },
  {
    id: "cur-algo",
    name: "Intro to Algorithms — Ch. 1–4.pdf",
    subject: "programming",
    pages: 61,
    sections: [
      {
        id: "a1",
        label: "Complexity Analysis",
        subsections: [
          { id: "a1a", label: "Big-O notation" },
          { id: "a1b", label: "Amortized analysis" },
        ],
      },
      {
        id: "a2",
        label: "Data Structures",
        subsections: [
          { id: "a2a", label: "Arrays & hashing" },
          { id: "a2b", label: "Trees & heaps" },
          { id: "a2c", label: "Graphs" },
        ],
      },
      {
        id: "a3",
        label: "Sorting & Searching",
        subsections: [
          { id: "a3a", label: "Merge & quick sort" },
          { id: "a3b", label: "Binary search" },
        ],
      },
    ],
  },
  {
    id: "cur-chem",
    name: "General Chemistry — Unit Pack.pdf",
    subject: "chemistry",
    pages: 140,
    sections: [
      {
        id: "c1",
        label: "Atomic Structure",
        subsections: [
          { id: "c1a", label: "Electron configuration" },
          { id: "c1b", label: "Periodic trends" },
        ],
      },
      {
        id: "c2",
        label: "Reaction Kinetics",
        subsections: [
          { id: "c2a", label: "Rate laws" },
          { id: "c2b", label: "Arrhenius equation" },
          { id: "c2c", label: "Catalysis" },
        ],
      },
      {
        id: "c3",
        label: "Equilibrium",
        subsections: [
          { id: "c3a", label: "Le Chatelier's principle" },
          { id: "c3b", label: "Acids & bases" },
        ],
      },
    ],
  },
  {
    id: "cur-bio",
    name: "Cell Biology — Reader.pdf",
    subject: "biology",
    pages: 96,
    sections: [
      {
        id: "b1",
        label: "Cell Structure",
        subsections: [
          { id: "b1a", label: "Organelles" },
          { id: "b1b", label: "Membrane transport" },
        ],
      },
      {
        id: "b2",
        label: "Molecular Genetics",
        subsections: [
          { id: "b2a", label: "DNA replication" },
          { id: "b2b", label: "Transcription & translation" },
        ],
      },
      {
        id: "b3",
        label: "Metabolism",
        subsections: [
          { id: "b3a", label: "Cellular respiration" },
          { id: "b3b", label: "Photosynthesis" },
        ],
      },
    ],
  },
];

export type ExamMode = "module" | "final" | "custom";
export type Rigor = "casual" | "challenging" | "rigorous";
export type QuestionFormat = "mcq" | "proof" | "mixed";

export const MAX_MCQ = 50;
export const MAX_PROOF = 15;

export function maxQuestions(format: QuestionFormat) {
  if (format === "mcq") return MAX_MCQ;
  if (format === "proof") return MAX_PROOF;
  return Math.round((MAX_MCQ + MAX_PROOF) / 2); // mixed
}

/* ── Question bank ── */

export interface BankQuestion {
  id: string;
  subject: SubjectKey;
  topic: string;
  format: "mcq" | "proof";
  difficulty: "easy" | "medium" | "hard";
  prompt: string;
}

export const QUESTION_BANK: BankQuestion[] = [
  { id: "q1", subject: "physics", topic: "Orbital mechanics", format: "mcq", difficulty: "medium", prompt: "If orbital radius quadruples, orbital speed…" },
  { id: "q2", subject: "physics", topic: "Kepler's laws", format: "proof", difficulty: "hard", prompt: "Derive Kepler's third law from Newtonian gravitation." },
  { id: "q3", subject: "math", topic: "Chain rule", format: "mcq", difficulty: "easy", prompt: "d/dx sin(3x²) equals…" },
  { id: "q4", subject: "math", topic: "Series", format: "proof", difficulty: "hard", prompt: "Prove the ratio test for absolute convergence." },
  { id: "q5", subject: "programming", topic: "Big-O", format: "mcq", difficulty: "easy", prompt: "Binary search on 1,024 items takes at most…" },
  { id: "q6", subject: "programming", topic: "Recursion", format: "proof", difficulty: "medium", prompt: "Show that merge sort runs in O(n log n)." },
  { id: "q7", subject: "chemistry", topic: "Rate laws", format: "mcq", difficulty: "medium", prompt: "Doubling [A] quadruples the rate. The order in A is…" },
  { id: "q8", subject: "chemistry", topic: "Equilibrium", format: "proof", difficulty: "medium", prompt: "Explain Le Chatelier's response to a pressure increase." },
  { id: "q9", subject: "biology", topic: "Respiration", format: "mcq", difficulty: "easy", prompt: "Net ATP yield from glycolysis is…" },
  { id: "q10", subject: "biology", topic: "Genetics", format: "proof", difficulty: "medium", prompt: "Describe how a point mutation can be silent." },
  { id: "q11", subject: "math", topic: "Integration", format: "mcq", difficulty: "medium", prompt: "∫ 2x·e^(x²) dx equals…" },
  { id: "q12", subject: "physics", topic: "SHM", format: "mcq", difficulty: "hard", prompt: "Period of a pendulum scales with length as…" },
];

/* ── Available (assigned) tests ── */

export interface AvailableTest {
  id: string;
  title: string;
  subject: SubjectKey;
  questions: number;
  format: QuestionFormat;
  rigor: Rigor;
  due: string;
  status: "new" | "in-progress" | "completed";
  score?: number;
}

export const AVAILABLE_TESTS: AvailableTest[] = [
  { id: "t1", title: "Gravitation & Orbits — Module Test", subject: "physics", questions: 20, format: "mixed", rigor: "challenging", due: "Due in 2 days", status: "new" },
  { id: "t2", title: "Differentiation — Module Test", subject: "math", questions: 25, format: "mcq", rigor: "casual", due: "Due in 5 days", status: "in-progress" },
  { id: "t3", title: "Complexity Analysis — Proof Set", subject: "programming", questions: 8, format: "proof", rigor: "rigorous", due: "Due next week", status: "new" },
  { id: "t4", title: "Reaction Kinetics — Final Exam", subject: "chemistry", questions: 40, format: "mixed", rigor: "rigorous", due: "Completed Mar 28", status: "completed", score: 86 },
  { id: "t5", title: "Cell Structure — Quick Check", subject: "biology", questions: 15, format: "mcq", rigor: "casual", due: "Completed Mar 22", status: "completed", score: 94 },
];

/* ── Saved chalkboard note history (for Private notes) ── */

export interface NoteHistory {
  title: string;
  subject: string;
  when: string;
  duration: string;
  boards: number;
  lines: string[];
}

export const NOTE_HISTORY: Record<string, NoteHistory> = {
  "AP Physics study guide": {
    title: "AP Physics study guide",
    subject: "Physics · Orbital Mechanics",
    when: "Yesterday, 9:14 PM",
    duration: "34 min",
    boards: 3,
    lines: [
      "Orbits = falling, sideways",
      "A satellite is in free-fall; it keeps missing the ground because it also moves sideways fast enough.",
      "F_g = GMm/r² = mv²/r  →  gravity supplies the centripetal force",
      "v_orb = √(GM/r)",
      "GM(Earth) = 3.99 × 10¹⁴ m³/s²",
      "LEO speed ≈ 7.8 km/s",
      "Weightlessness = shared free-fall, not zero gravity",
      "Quadruple r → speed halves.",
    ],
  },
  "Calculus exam schedule": {
    title: "Calculus exam schedule",
    subject: "Math · Derivatives & Rates",
    when: "2 days ago, 4:40 PM",
    duration: "21 min",
    boards: 2,
    lines: [
      "The slope machine",
      "A derivative answers: how fast is this changing right now?",
      "f′(a) = lim(h→0) [f(a+h) − f(a)] / h",
      "Power rule: d/dx xⁿ = n·xⁿ⁻¹",
      "Slope of x² at x = 3 is 6",
      "3x⁴ − 5x² + 7  →  f′ = 12x³ − 10x",
    ],
  },
  "Big-O cheat sheet": {
    title: "Big-O cheat sheet",
    subject: "Programming · Algorithms",
    when: "4 days ago, 8:02 PM",
    duration: "47 min",
    boards: 4,
    lines: [
      "How work grows with n",
      "O(1) < O(log n) < O(n) < O(n log n) < O(n²)",
      "Linear scan → O(n)",
      "Binary search → O(log n), log₂(1024) = 10 comparisons",
      "Nested loops → O(n²)",
      "10× the data on an O(n²) loop = 100× the time.",
      "T(n) = 2T(n/2) + O(n) ⇒ O(n log n)",
    ],
  },
};

export function historyFor(title: string): NoteHistory {
  return (
    NOTE_HISTORY[title] ?? {
      title,
      subject: "Studyus session",
      when: "Recently",
      duration: "—",
      boards: 1,
      lines: [
        title,
        "This note was captured from a chalkboard session.",
        "Continue the session to keep writing where you left off.",
      ],
    }
  );
}
