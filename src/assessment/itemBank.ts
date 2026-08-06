/**
 * Assessment Item Bank
 *
 * Each item carries:
 *   - Predetermined correct answer (MCQ key, numeric spec, or rubric)
 *   - Bloom's taxonomy level
 *   - Difficulty band
 *   - Curriculum node provenance
 *
 * MCQ correct answers are determined at authoring time.
 * Proof items carry analytic rubrics with stable criterion IDs.
 */

import type { AssessmentItem, BloomLevel, Difficulty, SubjectKey, Rubric, McqOption } from "./types";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function resolveHintTags(
  hintOrTags?: string | string[],
  maybeTags?: string[],
): { hint?: string; tags?: string[] } {
  if (Array.isArray(hintOrTags)) {
    return { tags: hintOrTags };
  }
  return { hint: hintOrTags, tags: maybeTags };
}

function mcq(
  id: string,
  subject: SubjectKey,
  nodeId: string,
  section: string,
  subsection: string,
  bloom: BloomLevel,
  difficulty: Difficulty,
  stem: string,
  options: McqOption[],
  answerKey: string,
  marks: number,
  hintOrTags?: string | string[],
  maybeTags?: string[],
): AssessmentItem {
  const { hint, tags } = resolveHintTags(hintOrTags, maybeTags);
  return {
    id, subject, nodeId, section, subsection,
    bloomLevel: bloom, difficulty, type: "mcq", marks,
    stem, mcqOptions: options, mcqAnswerKey: answerKey, hint, tags,
  };
}

function proof(
  id: string,
  subject: SubjectKey,
  nodeId: string,
  section: string,
  subsection: string,
  bloom: BloomLevel,
  difficulty: Difficulty,
  stem: string,
  rubric: Rubric,
  marks: number,
  hintOrTags?: string | string[],
  maybeTags?: string[],
): AssessmentItem {
  const { hint, tags } = resolveHintTags(hintOrTags, maybeTags);
  return {
    id, subject, nodeId, section, subsection,
    bloomLevel: bloom, difficulty, type: "proof", marks,
    stem, rubric, hint, tags,
  };
}

function shortAnswer(
  id: string,
  subject: SubjectKey,
  nodeId: string,
  section: string,
  subsection: string,
  bloom: BloomLevel,
  difficulty: Difficulty,
  stem: string,
  rubric: Rubric,
  marks: number,
  hintOrTags?: string | string[],
  maybeTags?: string[],
): AssessmentItem {
  const { hint, tags } = resolveHintTags(hintOrTags, maybeTags);
  return {
    id, subject, nodeId, section, subsection,
    bloomLevel: bloom, difficulty, type: "short_answer", marks,
    stem, rubric, hint, tags,
  };
}

// ─── Rubric builder ──────────────────────────────────────────────────────────

function rubric(
  criteria: { id: string; label: string; description: string; maxMarks: number; keyElements: string[]; commonErrors?: string[] }[],
): Rubric {
  const totalMarks = criteria.reduce((s, c) => s + c.maxMarks, 0);
  return { version: 1, criteria, totalMarks };
}

// ═══════════════════════════════════════════════════════════════════════════════
// MATH
// ═══════════════════════════════════════════════════════════════════════════════

const MATH_ITEMS: AssessmentItem[] = [
  // ── Limits & Continuity ────────────────────────────────────────────────────
  mcq("math-lim-01", "math", "s1a", "Limits & Continuity", "Intuitive limits",
    "understand", "introductory",
    "What does lim(x→2) (x² − 4)/(x − 2) equal?",
    [
      { id: "a", text: "0" },
      { id: "b", text: "4" },
      { id: "c", text: "Does not exist" },
      { id: "d", text: "2" },
    ],
    "b", 3,
    "Factor the numerator first.",
    ["factoring", "indeterminate-form"]),

  mcq("math-lim-02", "math", "s1b", "Limits & Continuity", "One-sided limits",
    "apply", "foundational",
    "For f(x) = |x|/x, what is lim(x→0⁺) f(x)?",
    [
      { id: "a", text: "−1" },
      { id: "b", text: "0" },
      { id: "c", text: "1" },
      { id: "d", text: "Does not exist" },
    ],
    "c", 3,
    "Consider what |x| equals when x > 0.",
    ["piecewise", "one-sided"]),

  mcq("math-lim-03", "math", "s1c", "Limits & Continuity", "Squeeze theorem",
    "analyze", "proficient",
    "If −x² ≤ f(x) ≤ x² for all x, what is lim(x→0) f(x)?",
    [
      { id: "a", text: "−1" },
      { id: "b", text: "0" },
      { id: "c", text: "1" },
      { id: "d", text: "Cannot be determined" },
    ],
    "b", 4,
    "Both bounds approach 0.",
    ["squeeze-theorem", "bounding"]),

  // ── Differentiation ────────────────────────────────────────────────────────
  mcq("math-diff-01", "math", "s2a", "Differentiation", "Definition of the derivative",
    "remember", "introductory",
    "The limit definition of f′(a) is:",
    [
      { id: "a", text: "lim(h→0) [f(a+h) − f(a)] / h" },
      { id: "b", text: "lim(h→0) [f(a+h) + f(a)] / h" },
      { id: "c", text: "lim(h→∞) [f(a+h) − f(a)] / h" },
      { id: "d", text: "lim(h→0) f(a+h) / h" },
    ],
    "a", 2,
    "This is the foundational definition.",
    ["definition", "limit"]),

  mcq("math-diff-02", "math", "s2b", "Differentiation", "Power, product, quotient rules",
    "apply", "foundational",
    "d/dx (x³ · sin x) equals:",
    [
      { id: "a", text: "3x² · cos x" },
      { id: "b", text: "3x² · sin x + x³ · cos x" },
      { id: "c", text: "x³ · cos x − 3x² · sin x" },
      { id: "d", text: "3x² · sin x − x³ · cos x" },
    ],
    "b", 4,
    "Use the product rule: (uv)′ = u′v + uv′.",
    ["product-rule"]),

  mcq("math-diff-03", "math", "s2c", "Differentiation", "Chain rule",
    "apply", "foundational",
    "d/dx sin(3x²) equals:",
    [
      { id: "a", text: "6x · cos(3x²)" },
      { id: "b", text: "cos(3x²)" },
      { id: "c", text: "3 · cos(3x²) · 2x" },
      { id: "d", text: "−sin(3x²) · 6x" },
    ],
    "a", 4,
    "Outer derivative × inner derivative. Note: options (a) and (c) are equivalent — choose the simplified form.",
    ["chain-rule"]),

  mcq("math-diff-04", "math", "s2d", "Differentiation", "Implicit differentiation",
    "analyze", "proficient",
    "Given x² + y² = 25, dy/dx equals:",
    [
      { id: "a", text: "−x/y" },
      { id: "b", text: "x/y" },
      { id: "c", text: "−2x/y" },
      { id: "d", text: "2x/y" },
    ],
    "a", 4,
    "Differentiate both sides with respect to x, treating y as a function of x.",
    ["implicit-diff"]),

  // ── Integration ────────────────────────────────────────────────────────────
  mcq("math-int-01", "math", "s3a", "Integration", "Riemann sums",
    "understand", "foundational",
    "A left Riemann sum with n equal subintervals on [a,b] evaluates f at:",
    [
      { id: "a", text: "The right endpoint of each subinterval" },
      { id: "b", text: "The midpoint of each subinterval" },
      { id: "c", text: "The left endpoint of each subinterval" },
      { id: "d", text: "Any point in each subinterval" },
    ],
    "c", 2,
    ["riemann", "definition"]),

  mcq("math-int-02", "math", "s3b", "Integration", "Fundamental theorem",
    "apply", "foundational",
    "If F(x) = ∫₀ˣ sin(t²) dt, then F′(x) equals:",
    [
      { id: "a", text: "cos(x²)" },
      { id: "b", text: "sin(x²)" },
      { id: "c", text: "2x · sin(x²)" },
      { id: "d", text: "sin(x²) · 2x" },
    ],
    "b", 4,
    "By FTC Part 1: d/dx ∫ₐˣ f(t)dt = f(x).",
    ["FTC", "derivative-of-integral"]),

  mcq("math-int-03", "math", "s3c", "Integration", "u-substitution",
    "apply", "foundational",
    "∫ 2x·e^(x²) dx equals:",
    [
      { id: "a", text: "e^(x²) + C" },
      { id: "b", text: "2e^(x²) + C" },
      { id: "c", text: "x·e^(x²) + C" },
      { id: "d", text: "x²·e^(x²) + C" },
    ],
    "a", 4,
    "Let u = x², then du = 2x dx.",
    ["u-sub", "exponential"]),

  // ── Series & Sequences ─────────────────────────────────────────────────────
  mcq("math-ser-01", "math", "s4a", "Series & Sequences", "Convergence tests",
    "evaluate", "advanced",
    "Which test is most appropriate for Σ 1/n²?",
    [
      { id: "a", text: "Ratio test" },
      { id: "b", text: "p-series test (p > 1 converges)" },
      { id: "c", text: "Alternating series test" },
      { id: "d", text: "Divergence test" },
    ],
    "b", 3,
    "Recognize the form Σ 1/nᵖ.",
    ["p-series", "convergence"]),

  mcq("math-ser-02", "math", "s4b", "Series & Sequences", "Taylor & Maclaurin",
    "analyze", "advanced",
    "The Maclaurin series for eˣ is:",
    [
      { id: "a", text: "Σ xⁿ/n! for n=0 to ∞" },
      { id: "b", text: "Σ xⁿ/n for n=1 to ∞" },
      { id: "c", text: "Σ (−1)ⁿ xⁿ/n! for n=0 to ∞" },
      { id: "d", text: "Σ x²ⁿ/(2n)! for n=0 to ∞" },
    ],
    "a", 3,
    ["taylor", "exponential-series"]),

  // ── Proof items (with rubrics) ─────────────────────────────────────────────
  proof("math-prf-01", "math", "s2a", "Differentiation", "Definition of the derivative",
    "create", "advanced",
    "Using the limit definition, prove that d/dx(x²) = 2x.",
    rubric([
      {
        id: "c1-setup", label: "Limit setup", maxMarks: 2,
        description: "Correctly write the limit definition for f(x) = x²",
        keyElements: ["lim(h→0)", "f(x+h) − f(x)", "replace f with (x+h)² and x²"],
        commonErrors: ["Forgetting to expand (x+h)²", "Using the wrong definition"],
      },
      {
        id: "c2-expansion", label: "Algebraic expansion", maxMarks: 2,
        description: "Correctly expand (x+h)² − x²",
        keyElements: ["(x+h)² = x² + 2xh + h²", "numerator = 2xh + h²", "divide by h"],
        commonErrors: ["Incorrect expansion", "Forgetting the h² term"],
      },
      {
        id: "c3-limit", label: "Evaluating the limit", maxMarks: 2,
        description: "Take the limit as h→0 of the simplified expression",
        keyElements: ["After dividing by h: 2x + h", "As h→0, result is 2x"],
        commonErrors: ["Dropping the h before dividing", "Arithmetic errors in the limit"],
      },
      {
        id: "c4-conclusion", label: "Conclusion", maxMarks: 1,
        description: "State the conclusion clearly",
        keyElements: ["d/dx(x²) = 2x", "or f′(x) = 2x"],
      },
    ]),
    7,
    "Start with the definition: f′(x) = lim(h→0) [f(x+h) − f(x)] / h."),

  proof("math-prf-02", "math", "s4a", "Series & Sequences", "Convergence tests",
    "create", "expert",
    "Prove the ratio test: if lim|aₙ₊₁/aₙ| = L < 1, then Σaₙ converges absolutely.",
    rubric([
      {
        id: "c1-choose-r", label: "Choose r between L and 1", maxMarks: 2,
        description: "Select r such that L < r < 1",
        keyElements: ["Pick r with L < r < 1", "Existence by density of reals or averaging"],
        commonErrors: ["Setting r = L", "Not explaining why r exists"],
      },
      {
        id: "c2-bound", label: "Establish the geometric bound", maxMarks: 3,
        description: "Show |aₙ₊₁| ≤ r|aₙ| for large n",
        keyElements: ["For n ≥ N, |aₙ₊₁/aₙ| < r", "So |aₙ| ≤ |aₙ|·r^(n-N)"],
        commonErrors: ["Skipping the 'for large n' step", "Not connecting ratio to bound"],
      },
      {
        id: "c3-compare", label: "Comparison with geometric series", maxMarks: 3,
        description: "Apply comparison test with geometric series Σ rⁿ",
        keyElements: ["Σrⁿ converges since r < 1", "By direct comparison, Σ|aₙ| converges"],
        commonErrors: ["Not invoking the geometric series explicitly", "Confusing absolute vs conditional convergence"],
      },
      {
        id: "c4-rigor", label: "Logical structure", maxMarks: 2,
        description: "Proof is logically complete and well-organized",
        keyElements: ["All steps justified", "No gaps in the argument"],
        commonErrors: ["Circular reasoning", "Unjustified claims"],
      },
    ]),
    10,
    "Choose r with L < r < 1, then bound terms by a geometric series."),

  proof("math-prf-03", "math", "s3b", "Integration", "Fundamental theorem",
    "create", "advanced",
    "State and prove the Fundamental Theorem of Calculus, Part 1.",
    rubric([
      {
        id: "c1-statement", label: "Precise statement", maxMarks: 2,
        description: "State FTC Part 1 correctly",
        keyElements: ["F(x) = ∫ₐˣ f(t)dt", "f continuous on [a,b]", "F′(x) = f(x)"],
        commonErrors: ["Missing continuity hypothesis", "Confusing Part 1 with Part 2"],
      },
      {
        id: "c2-difference-quotient", label: "Difference quotient", maxMarks: 3,
        description: "Set up and simplify [F(x+h) − F(x)]/h",
        keyElements: ["F(x+h) − F(x) = ∫ₓ^(x+h) f(t)dt", "Apply integral properties"],
        commonErrors: ["Not splitting the integral correctly"],
      },
      {
        id: "c3-mvt", label: "Mean Value Theorem for integrals or bounding", maxMarks: 3,
        description: "Use continuity of f to evaluate the limit",
        keyElements: ["f continuous means f(t) ≈ f(x) on [x, x+h]", "or use MVT for integrals: f(c)·h"],
        commonErrors: ["Not using continuity", "Skipping the squeeze argument"],
      },
      {
        id: "c4-limit", label: "Conclusion", maxMarks: 2,
        description: "Take the limit as h→0",
        keyElements: ["lim(h→0) [F(x+h)−F(x)]/h = f(x)", "F′(x) = f(x)"],
      },
    ]),
    10,
    "Define F(x) = ∫ₐˣ f(t)dt. Compute F′(x) using the limit definition."),

  shortAnswer("math-sa-01", "math", "s2b", "Differentiation", "Power, product, quotient rules",
    "apply", "foundational",
    "Find the equation of the tangent line to y = x³ − 2x at x = 1.",
    rubric([
      {
        id: "c1-point", label: "Find the point", maxMarks: 1,
        description: "Calculate y(1)",
        keyElements: ["y(1) = 1 − 2 = −1", "Point is (1, −1)"],
      },
      {
        id: "c2-derivative", label: "Compute the derivative", maxMarks: 2,
        description: "Find dy/dx correctly",
        keyElements: ["dy/dx = 3x² − 2"],
      },
      {
        id: "c3-slope", label: "Evaluate the slope", maxMarks: 1,
        description: "Calculate slope at x=1",
        keyElements: ["m = 3(1)² − 2 = 1"],
      },
      {
        id: "c4-equation", label: "Write the equation", maxMarks: 1,
        description: "Write tangent line in point-slope or slope-intercept form",
        keyElements: ["y − (−1) = 1(x − 1)", "or y = x − 2"],
      },
    ]),
    5,
    "You need a point and a slope."),
];

// ═══════════════════════════════════════════════════════════════════════════════
// PHYSICS
// ═══════════════════════════════════════════════════════════════════════════════

const PHYSICS_ITEMS: AssessmentItem[] = [
  mcq("phys-kin-01", "physics", "p1a", "Mechanics", "Kinematics",
    "apply", "foundational",
    "A ball is thrown upward at 20 m/s. At its peak, its velocity is:",
    [
      { id: "a", text: "20 m/s upward" },
      { id: "b", text: "9.8 m/s" },
      { id: "c", text: "0 m/s" },
      { id: "d", text: "−20 m/s" },
    ],
    "c", 3,
    "At the peak, the ball momentarily stops before falling back down.",
    ["kinematics", "projectile"]),

  mcq("phys-kin-02", "physics", "p1b", "Mechanics", "Newton's laws",
    "understand", "foundational",
    "Newton's third law states that action-reaction force pairs:",
    [
      { id: "a", text: "Act on the same object and cancel" },
      { id: "b", text: "Act on different objects and never cancel" },
      { id: "c", text: "Only apply to gravitational forces" },
      { id: "d", text: "Are always equal to the net force" },
    ],
    "b", 3,
    ["newton-third", "force-pairs"]),

  mcq("phys-kin-03", "physics", "p1c", "Mechanics", "Momentum & impulse",
    "analyze", "proficient",
    "A 2 kg ball moving at 5 m/s hits a wall and bounces back at 3 m/s. The impulse on the ball is:",
    [
      { id: "a", text: "4 N·s" },
      { id: "b", text: "10 N·s" },
      { id: "c", text: "16 N·s" },
      { id: "d", text: "−16 N·s" },
    ],
    "d", 4,
    "Impulse = Δp = m(v_f − v_i). Remember the sign change for bouncing.",
    ["impulse", "momentum-change"]),

  mcq("phys-grav-01", "physics", "p2a", "Gravitation & Orbits", "Newtonian gravitation",
    "apply", "foundational",
    "If orbital radius quadruples, orbital speed:",
    [
      { id: "a", text: "Quadruples" },
      { id: "b", text: "Doubles" },
      { id: "c", text: "Halves" },
      { id: "d", text: "Stays the same" },
    ],
    "c", 4,
    "v = √(GM/r), so v ∝ 1/√r.",
    ["orbital-speed", "inverse-root"]),

  mcq("phys-grav-02", "physics", "p2b", "Gravitation & Orbits", "Orbital mechanics",
    "understand", "proficient",
    "A satellite in circular orbit is in free-fall because:",
    [
      { id: "a", text: "Gravity is zero at orbital altitude" },
      { id: "b", text: "It falls toward Earth but keeps missing due to tangential velocity" },
      { id: "c", text: "Centrifugal force cancels gravity" },
      { id: "d", text: "The normal force provides lift" },
    ],
    "b", 3,
    ["free-fall", "circular-orbit"]),

  mcq("phys-grav-03", "physics", "p2c", "Gravitation & Orbits", "Kepler's laws",
    "analyze", "advanced",
    "Kepler's second law (equal areas in equal times) is a consequence of:",
    [
      { id: "a", text: "Energy conservation" },
      { id: "b", text: "Angular momentum conservation" },
      { id: "c", text: "Newton's first law" },
      { id: "d", text: "The inverse-square nature of gravity" },
    ],
    "b", 4,
    ["kepler-second", "angular-momentum"]),

  mcq("phys-thermo-01", "physics", "p3a", "Thermodynamics", "Ideal gases",
    "remember", "introductory",
    "The ideal gas law is:",
    [
      { id: "a", text: "PV = nRT" },
      { id: "b", text: "PV = mc²" },
      { id: "c", text: "P = F/A" },
      { id: "d", text: "PV = Nk/T" },
    ],
    "a", 2,
    ["ideal-gas", "equation-of-state"]),

  mcq("phys-wave-01", "physics", "p4a", "Waves & Optics", "Simple harmonic motion",
    "apply", "proficient",
    "The period of a simple pendulum scales with length as:",
    [
      { id: "a", text: "Linear (T ∝ L)" },
      { id: "b", text: "Square root (T ∝ √L)" },
      { id: "c", text: "Quadratic (T ∝ L²)" },
      { id: "d", text: "Inverse (T ∝ 1/L)" },
    ],
    "b", 4,
    "T = 2π√(L/g).",
    ["pendulum", "SHM"]),

  // ── Proof items ────────────────────────────────────────────────────────────
  proof("phys-prf-01", "physics", "p2c", "Gravitation & Orbits", "Kepler's laws",
    "create", "expert",
    "Derive Kepler's third law (T² ∝ r³) from Newtonian gravitation for a circular orbit.",
    rubric([
      {
        id: "c1-setup", label: "Force equation setup", maxMarks: 2,
        description: "Set gravitational force equal to centripetal force",
        keyElements: ["F_g = GMm/r²", "F_c = mv²/r or m(4π²r/T²)"],
        commonErrors: ["Using F = ma without specifying centripetal form"],
      },
      {
        id: "c2-cancel", label: "Cancel mass and solve", maxMarks: 3,
        description: "Cancel m, solve for the period",
        keyElements: ["GM/r² = v²/r", "Substitute v = 2πr/T", "Isolate T²"],
        commonErrors: ["Not canceling the satellite mass", "Algebra errors in isolating T"],
      },
      {
        id: "c3-result", label: "State the result", maxMarks: 2,
        description: "Arrive at T² = (4π²/GM)·r³",
        keyElements: ["T² = 4π²r³/(GM)", "or T² ∝ r³"],
        commonErrors: ["Missing the 4π² factor", "Getting the proportionality wrong"],
      },
      {
        id: "c4-interp", label: "Physical interpretation", maxMarks: 1,
        description: "Note that the constant depends only on the central mass",
        keyElements: ["4π²/GM is the same for all satellites of the same body"],
      },
    ]),
    8,
    "Start from F_gravity = F_centripetal. Use v = 2πr/T for circular motion."),

  proof("phys-prf-02", "physics", "p1b", "Mechanics", "Newton's laws",
    "create", "advanced",
    "Prove that in the absence of external forces, the total momentum of a two-body system is conserved.",
    rubric([
      {
        id: "c1-newton3", label: "Invoke Newton's third law", maxMarks: 2,
        description: "State that F₁₂ = −F₂₁",
        keyElements: ["Force on 1 by 2 equals negative of force on 2 by 1"],
      },
      {
        id: "c2-newton2", label: "Apply Newton's second law", maxMarks: 2,
        description: "Relate forces to momentum changes via F = dp/dt",
        keyElements: ["dp₁/dt = F₁₂", "dp₂/dt = F₂₁"],
      },
      {
        id: "c3-sum", label: "Sum the rates of change", maxMarks: 2,
        description: "Show d(p₁+p₂)/dt = 0",
        keyElements: ["dp₁/dt + dp₂/dt = F₁₂ + F₂₁ = 0"],
      },
      {
        id: "c4-conclude", label: "Conclude conservation", maxMarks: 1,
        description: "Total momentum is constant",
        keyElements: ["p_total = constant"],
      },
    ]),
    7,
    "Use Newton's 2nd law (F = dp/dt) together with Newton's 3rd law."),
];

// ═══════════════════════════════════════════════════════════════════════════════
// CHEMISTRY
// ═══════════════════════════════════════════════════════════════════════════════

const CHEMISTRY_ITEMS: AssessmentItem[] = [
  mcq("chem-atom-01", "chemistry", "c1a", "Atomic Structure", "Electron configuration",
    "remember", "introductory",
    "The electron configuration of carbon (Z=6) is:",
    [
      { id: "a", text: "1s² 2s² 2p²" },
      { id: "b", text: "1s² 2s² 2p⁶" },
      { id: "c", text: "1s² 2p⁴" },
      { id: "d", text: "1s² 2s¹ 2p³" },
    ],
    "a", 3,
    "Fill orbitals in order: 1s, 2s, 2p.",
    ["electron-config", "aufbau"]),

  mcq("chem-atom-02", "chemistry", "c1b", "Atomic Structure", "Periodic trends",
    "understand", "foundational",
    "Ionization energy generally ___ across a period (left to right):",
    [
      { id: "a", text: "Decreases" },
      { id: "b", text: "Increases" },
      { id: "c", text: "Stays constant" },
      { id: "d", text: "Oscillates" },
    ],
    "b", 3,
    ["ionization-energy", "periodic-trend"]),

  mcq("chem-kin-01", "chemistry", "c2a", "Reaction Kinetics", "Rate laws",
    "apply", "foundational",
    "Doubling [A] quadruples the rate. The order in A is:",
    [
      { id: "a", text: "First order" },
      { id: "b", text: "Second order" },
      { id: "c", text: "Zero order" },
      { id: "d", text: "Third order" },
    ],
    "b", 4,
    "rate ∝ [A]ⁿ, so 2ⁿ = 4, n = 2.",
    ["rate-law", "reaction-order"]),

  mcq("chem-kin-02", "chemistry", "c2b", "Reaction Kinetics", "Arrhenius equation",
    "analyze", "proficient",
    "The Arrhenius equation k = Ae^(−Ea/RT) shows that increasing temperature:",
    [
      { id: "a", text: "Decreases the rate constant" },
      { id: "b", text: "Increases the rate constant" },
      { id: "c", text: "Has no effect on the rate constant" },
      { id: "d", text: "Makes the rate constant equal to A" },
    ],
    "b", 3,
    ["arrhenius", "temperature-dependence"]),

  mcq("chem-eq-01", "chemistry", "c3a", "Equilibrium", "Le Chatelier's principle",
    "apply", "proficient",
    "For N₂(g) + 3H₂(g) ⇌ 2NH₃(g), increasing pressure shifts equilibrium:",
    [
      { id: "a", text: "Toward reactants (left)" },
      { id: "b", text: "Toward products (right)" },
      { id: "c", text: "No shift" },
      { id: "d", text: "Cannot be determined" },
    ],
    "b", 4,
    "4 mol gas → 2 mol gas. System shifts to the side with fewer moles.",
    ["le-chatelier", "pressure"]),

  mcq("chem-eq-02", "chemistry", "c3b", "Equilibrium", "Acids & bases",
    "understand", "foundational",
    "A solution with pH = 3 has [H⁺] equal to:",
    [
      { id: "a", text: "3 M" },
      { id: "b", text: "10⁻³ M" },
      { id: "c", text: "10³ M" },
      { id: "d", text: "−3 M" },
    ],
    "b", 2,
    "pH = −log[H⁺], so [H⁺] = 10^(−pH).",
    ["pH", "acids"]),

  proof("chem-prf-01", "chemistry", "c3a", "Equilibrium", "Le Chatelier's principle",
    "evaluate", "advanced",
    "Explain, using the reaction quotient Q, why increasing pressure shifts N₂ + 3H₂ ⇌ 2NH₃ toward products.",
    rubric([
      {
        id: "c1-q-expression", label: "Write Q", maxMarks: 2,
        description: "Express Q in terms of partial pressures or concentrations",
        keyElements: ["Q = P(NH₃)² / [P(N₂)·P(H₂)³]"],
      },
      {
        id: "c2-effect", label: "Effect of pressure on Q", maxMarks: 3,
        description: "Show that halving volume changes Q relative to K",
        keyElements: ["Halving volume doubles each partial pressure", "Numerator ×4, denominator ×16", "Q < K after compression"],
        commonErrors: ["Not tracking each species", "Getting the powers wrong"],
      },
      {
        id: "c3-shift", label: "Direction of shift", maxMarks: 2,
        description: "Since Q < K, reaction proceeds forward",
        keyElements: ["Q < K means system shifts right", "Toward products to re-establish equilibrium"],
      },
      {
        id: "c4-connect", label: "Connect to moles of gas", maxMarks: 1,
        description: "Note that 4 mol → 2 mol is consistent",
        keyElements: ["Fewer gas moles on product side"],
      },
    ]),
    8,
    "Write Q, then show what happens when you compress the system."),
];

// ═══════════════════════════════════════════════════════════════════════════════
// BIOLOGY
// ═══════════════════════════════════════════════════════════════════════════════

const BIOLOGY_ITEMS: AssessmentItem[] = [
  mcq("bio-cell-01", "biology", "b1a", "Cell Structure", "Organelles",
    "remember", "introductory",
    "Which organelle is responsible for ATP production via oxidative phosphorylation?",
    [
      { id: "a", text: "Ribosome" },
      { id: "b", text: "Golgi apparatus" },
      { id: "c", text: "Mitochondrion" },
      { id: "d", text: "Endoplasmic reticulum" },
    ],
    "c", 2,
    ["organelles", "mitochondria"]),

  mcq("bio-cell-02", "biology", "b1b", "Cell Structure", "Membrane transport",
    "understand", "foundational",
    "Active transport differs from passive transport because it:",
    [
      { id: "a", text: "Moves molecules down their concentration gradient" },
      { id: "b", text: "Requires energy (ATP)" },
      { id: "c", text: "Only moves water" },
      { id: "d", text: "Does not use proteins" },
    ],
    "b", 3,
    ["active-transport", "membrane"]),

  mcq("bio-gen-01", "biology", "b2a", "Molecular Genetics", "DNA replication",
    "apply", "foundational",
    "DNA polymerase synthesizes new DNA in which direction?",
    [
      { id: "a", text: "3′ → 5′" },
      { id: "b", text: "5′ → 3′" },
      { id: "c", text: "Both directions equally" },
      { id: "d", text: "It depends on the template strand" },
    ],
    "b", 3,
    ["DNA-replication", "polymerase"]),

  mcq("bio-gen-02", "biology", "b2b", "Molecular Genetics", "Transcription & translation",
    "analyze", "proficient",
    "A point mutation changes AAA to AAG in the coding strand. This is most likely:",
    [
      { id: "a", text: "A nonsense mutation" },
      { id: "b", text: "A silent mutation" },
      { id: "c", text: "A frameshift mutation" },
      { id: "d", text: "A missense mutation" },
    ],
    "b", 4,
    "Both AAA and AAG code for lysine — the amino acid doesn't change.",
    ["mutation", "genetic-code"]),

  mcq("bio-met-01", "biology", "b3a", "Metabolism", "Cellular respiration",
    "remember", "introductory",
    "Net ATP yield from glycolysis is:",
    [
      { id: "a", text: "2 ATP" },
      { id: "b", text: "4 ATP" },
      { id: "c", text: "8 ATP" },
      { id: "d", text: "36 ATP" },
    ],
    "a", 2,
    "4 produced minus 2 consumed in investment phase.",
    ["glycolysis", "ATP"]),

  mcq("bio-met-02", "biology", "b3b", "Metabolism", "Photosynthesis",
    "understand", "foundational",
    "The light-dependent reactions of photosynthesis occur in the:",
    [
      { id: "a", text: "Stroma" },
      { id: "b", text: "Thylakoid membrane" },
      { id: "c", text: "Cytoplasm" },
      { id: "d", text: "Cell wall" },
    ],
    "b", 3,
    ["photosynthesis", "light-reactions"]),

  proof("bio-prf-01", "biology", "b2b", "Molecular Genetics", "Transcription & translation",
    "create", "advanced",
    "Describe how a single-base substitution in a coding sequence can result in a silent mutation, and explain why the genetic code's structure makes this possible.",
    rubric([
      {
        id: "c1-mechanism", label: "Describe the mechanism", maxMarks: 2,
        description: "Explain how a base change can leave the amino acid unchanged",
        keyElements: ["Codon changes but codes for same amino acid", "Example: both AAA and AAG code for lysine"],
      },
      {
        id: "c2-redundancy", label: "Explain redundancy/degeneracy", maxMarks: 3,
        description: "Connect to the structure of the genetic code",
        keyElements: ["64 codons, 20 amino acids", "Multiple codons per amino acid", "Wobble position (3rd base) is most variable"],
        commonErrors: ["Saying 'redundant' means useless", "Not mentioning wobble position"],
      },
      {
        id: "c3-example", label: "Provide a concrete example", maxMarks: 2,
        description: "Show a specific mutation that is silent",
        keyElements: ["Specific codons before and after", "Same amino acid"],
      },
      {
        id: "c4-significance", label: "Evolutionary significance", maxMarks: 1,
        description: "Note why this matters",
        keyElements: ["Buffers against harmful mutations", "Selective advantage of code structure"],
      },
    ]),
    8,
    "Think about why 64 codons for 20 amino acids creates opportunities for silent changes."),
];

// ═══════════════════════════════════════════════════════════════════════════════
// PROGRAMMING
// ═══════════════════════════════════════════════════════════════════════════════

const PROGRAMMING_ITEMS: AssessmentItem[] = [
  mcq("prog-comp-01", "programming", "a1a", "Complexity Analysis", "Big-O notation",
    "apply", "foundational",
    "Binary search on a sorted array of 1,024 elements takes at most:",
    [
      { id: "a", text: "8 comparisons" },
      { id: "b", text: "10 comparisons" },
      { id: "c", text: "32 comparisons" },
      { id: "d", text: "1,024 comparisons" },
    ],
    "b", 3,
    "log₂(1024) = 10.",
    ["binary-search", "logarithmic"]),

  mcq("prog-comp-02", "programming", "a1b", "Complexity Analysis", "Amortized analysis",
    "analyze", "advanced",
    "The amortized time complexity of appending to a dynamic array (ArrayList) is:",
    [
      { id: "a", text: "O(1)" },
      { id: "b", text: "O(log n)" },
      { id: "c", text: "O(n)" },
      { id: "d", text: "O(n²)" },
    ],
    "a", 4,
    "Most appends are O(1); occasional resize is O(n) but amortizes.",
    ["amortized", "dynamic-array"]),

  mcq("prog-ds-01", "programming", "a2a", "Data Structures", "Arrays & hashing",
    "understand", "foundational",
    "The average-case time complexity of hash table lookup is:",
    [
      { id: "a", text: "O(1)" },
      { id: "b", text: "O(log n)" },
      { id: "c", text: "O(n)" },
      { id: "d", text: "O(n log n)" },
    ],
    "a", 3,
    ["hash-table", "average-case"]),

  mcq("prog-ds-02", "programming", "a2b", "Data Structures", "Trees & heaps",
    "apply", "proficient",
    "In a max-heap, the root always contains:",
    [
      { id: "a", text: "The median value" },
      { id: "b", text: "The minimum value" },
      { id: "c", text: "The maximum value" },
      { id: "d", text: "A random value" },
    ],
    "c", 2,
    ["heap", "priority-queue"]),

  mcq("prog-sort-01", "programming", "a3a", "Sorting & Searching", "Merge & quick sort",
    "evaluate", "advanced",
    "Which sorting algorithm has a guaranteed O(n log n) worst case?",
    [
      { id: "a", text: "Quick sort" },
      { id: "b", text: "Merge sort" },
      { id: "c", text: "Bubble sort" },
      { id: "d", text: "Insertion sort" },
    ],
    "b", 3,
    "Quick sort degrades to O(n²) in worst case.",
    ["merge-sort", "worst-case"]),

  mcq("prog-sort-02", "programming", "a3b", "Sorting & Searching", "Binary search",
    "apply", "foundational",
    "Binary search requires the input to be:",
    [
      { id: "a", text: "A linked list" },
      { id: "b", text: "Sorted" },
      { id: "c", text: "Of even length" },
      { id: "d", text: "Stored in a hash table" },
    ],
    "b", 2,
    ["binary-search", "precondition"]),

  proof("prog-prf-01", "programming", "a3a", "Sorting & Searching", "Merge & quick sort",
    "create", "expert",
    "Show that merge sort runs in Θ(n log n) time in all cases.",
    rubric([
      {
        id: "c1-recurrence", label: "Write the recurrence", maxMarks: 2,
        description: "Express T(n) in terms of subproblems",
        keyElements: ["T(n) = 2T(n/2) + O(n)", "or T(n) = 2T(n/2) + cn"],
      },
      {
        id: "c2-tree", label: "Recursion tree or master theorem", maxMarks: 3,
        description: "Solve the recurrence",
        keyElements: ["log n levels", "Each level does O(n) work", "Total = O(n log n)"],
        commonErrors: ["Not counting levels correctly", "Forgetting to sum across levels"],
      },
      {
        id: "c3-both-bounds", label: "Show both O and Ω", maxMarks: 3,
        description: "Prove Θ, not just O",
        keyElements: ["O(n log n): upper bound via merge cost", "Ω(n log n): lower bound via comparison model or same tree argument"],
        commonErrors: ["Proving only O(n log n) without Ω"],
      },
      {
        id: "c4-conclusion", label: "Conclude Θ(n log n)", maxMarks: 1,
        description: "State the final result clearly",
        keyElements: ["T(n) = Θ(n log n)"],
      },
    ]),
    9,
    "Write T(n) = 2T(n/2) + O(n) and solve it with a recursion tree or master theorem."),

  proof("prog-prf-02", "programming", "a2c", "Data Structures", "Graphs",
    "create", "advanced",
    "Prove that BFS visits every vertex reachable from the source in a connected graph.",
    rubric([
      {
        id: "c1-setup", label: "Define BFS behavior", maxMarks: 2,
        description: "Describe the queue-based exploration",
        keyElements: ["Queue-based", "Visits neighbors before going deeper"],
      },
      {
        id: "c2-invariant", label: "Key invariant or contradiction argument", maxMarks: 3,
        description: "Show that if a vertex is reachable, it must be visited",
        keyElements: ["Shortest-path property: BFS finds shortest path in unweighted graphs", "or: contradiction — if unvisited vertex exists, its parent on shortest path must also be unvisited, leading to contradiction"],
        commonErrors: ["Not making the argument rigorous"],
      },
      {
        id: "c3-completeness", label: "Completeness of argument", maxMarks: 2,
        description: "All reachable vertices are accounted for",
        keyElements: ["Induction on path length or BFS level"],
      },
      {
        id: "c4-conclude", label: "Conclusion", maxMarks: 1,
        description: "State the result",
        keyElements: ["BFS visits all reachable vertices"],
      },
    ]),
    8,
    "Use the shortest-path property of BFS or a proof by contradiction."),
];

// ═══════════════════════════════════════════════════════════════════════════════
// MASTER BANK
// ═══════════════════════════════════════════════════════════════════════════════

export const ITEM_BANK: AssessmentItem[] = [
  ...MATH_ITEMS,
  ...PHYSICS_ITEMS,
  ...CHEMISTRY_ITEMS,
  ...BIOLOGY_ITEMS,
  ...PROGRAMMING_ITEMS,
];

/** Lookup an item by id */
export function getItem(id: string): AssessmentItem | undefined {
  return ITEM_BANK.find((i) => i.id === id);
}

/** Get all items for a subject */
export function getItemsForSubject(subject: SubjectKey): AssessmentItem[] {
  return ITEM_BANK.filter((i) => i.subject === subject);
}

/** Get items for specific curriculum nodes */
export function getItemsForNodes(nodeIds: string[]): AssessmentItem[] {
  const set = new Set(nodeIds);
  return ITEM_BANK.filter((i) => set.has(i.nodeId));
}

/** Get items by Bloom level */
export function getItemsByBloom(subject: SubjectKey, level: BloomLevel): AssessmentItem[] {
  return ITEM_BANK.filter((i) => i.subject === subject && i.bloomLevel === level);
}

/** Count of items per subject */
export function bankSizeBySubject(): Record<SubjectKey, number> {
  const counts: Record<string, number> = {};
  for (const item of ITEM_BANK) {
    counts[item.subject] = (counts[item.subject] ?? 0) + 1;
  }
  return counts as Record<SubjectKey, number>;
}

/** Total bank size */
export function totalBankSize(): number {
  return ITEM_BANK.length;
}
