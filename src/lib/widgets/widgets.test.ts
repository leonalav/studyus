import { describe, it, expect } from "vitest";
import { validateWidgetIntent, sanitizeWidgetState, gradeAnswerableWidget } from "./validate";
import { WIDGET_KINDS, WIDGET_LABEL, WIDGET_BOARD_NUMBER } from "./types";
import { formatWidgetCatalog, formatMasteryDirective } from "./prompt";

/**
 * The widget protocol is the tutor's teaching vocabulary, so these tests guard
 * two different classes of failure:
 *
 *  1. Structural — a malformed intent must be rejected at the boundary rather
 *     than reaching the renderer as a half-drawn card.
 *  2. Pedagogical — an intent that is structurally fine but teaches nothing
 *     (a distractor with no misconception attached, an example step with no
 *     reason, a mistake check that corrects without diagnosing) must also be
 *     rejected. That second class is the whole point of the widget system.
 */

describe("widget protocol — coverage", () => {
  it("defines exactly the 17 widgets, with Graph/Geometry/Equation left to visualize", () => {
    expect(WIDGET_KINDS).toHaveLength(17);
    // 3 (Graph), 4 (Point/Geometry) and 5 (Equation) stay visualization intents.
    const numbers = WIDGET_KINDS.map((kind) => WIDGET_BOARD_NUMBER[kind]);
    expect(numbers).not.toContain(3);
    expect(numbers).not.toContain(4);
    expect(numbers).not.toContain(5);
    expect(new Set(numbers).size).toBe(17);
  });

  it("gives every widget a label and a catalog entry the agent can act on", () => {
    const catalog = formatWidgetCatalog();
    for (const kind of WIDGET_KINDS) {
      expect(WIDGET_LABEL[kind]).toBeTruthy();
      expect(catalog).toContain(`[${kind}]`);
      expect(catalog).toContain(`"kind":"${kind}"`);
    }
  });

  it("redirects graph/geometry/equation requests to the visualize op", () => {
    const result = validateWidgetIntent({ kind: "graph", title: "y = x^2" });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toMatch(/visualize/i);
  });
});

describe("widget validation — structural", () => {
  it("rejects non-objects and unknown kinds", () => {
    expect(validateWidgetIntent(null).valid).toBe(false);
    expect(validateWidgetIntent("roadmap").valid).toBe(false);
    expect(validateWidgetIntent({ kind: "nonsense" }).valid).toBe(false);
  });

  it("accepts a fully specified concept card", () => {
    expect(validateWidgetIntent({
      kind: "concept_card",
      term: "Derivative",
      pronunciation: "/dɪˈrɪvətɪv/",
      definition: "The instantaneous rate of change of a function.",
      definitionLatex: "f'(x) = \\lim_{h \\to 0} \\frac{f(x+h)-f(x)}{h}",
      facets: ["slope of the tangent", "rate of change", "limit of a secant"],
    }).valid).toBe(true);
  });

  it("requires a slider's value to sit inside its own range", () => {
    const base = { kind: "slider", label: "Angle", parameter: "theta", min: 0, max: 90 };
    expect(validateWidgetIntent({ ...base, value: 45 }).valid).toBe(true);
    expect(validateWidgetIntent({ ...base, value: 120 }).valid).toBe(false);
    expect(validateWidgetIntent({ ...base, min: 90, max: 0, value: 45 }).valid).toBe(false);
  });

  it("requires comparison rows to line up with the columns", () => {
    const columns = [
      { id: "a", title: "Average rate" },
      { id: "b", title: "Instantaneous rate" },
    ];
    expect(validateWidgetIntent({
      kind: "comparison",
      columns,
      rows: [{ id: "r1", label: "Interval", cells: ["finite", "vanishing"] }],
    }).valid).toBe(true);

    expect(validateWidgetIntent({
      kind: "comparison",
      columns,
      rows: [{ id: "r1", label: "Interval", cells: ["finite"] }],
    }).valid).toBe(false);
  });
});

describe("widget validation — pedagogical invariants", () => {
  it("requires exactly one correct multiple-choice option", () => {
    const build = (correct: boolean[]) => ({
      kind: "question",
      prompt: "What does h → 0 represent?",
      format: "multiple_choice",
      options: correct.map((isCorrect, index) => ({
        id: `o${index}`,
        label: `Option ${index}`,
        correct: isCorrect,
        misconception: isCorrect ? undefined : "treats the limit as substitution",
      })),
    });

    expect(validateWidgetIntent(build([true, false])).valid).toBe(true);
    expect(validateWidgetIntent(build([false, false])).valid).toBe(false);
    expect(validateWidgetIntent(build([true, true])).valid).toBe(false);
  });

  it("requires hint levels to form a gapless prefix starting at 1", () => {
    const build = (levels: number[]) => ({
      kind: "hint",
      steps: levels.map((level) => ({ level, label: `Level ${level}`, body: "…" })),
    });

    expect(validateWidgetIntent(build([1])).valid).toBe(true);
    expect(validateWidgetIntent(build([1, 2, 3])).valid).toBe(true);
    // Jumping straight to a strong hint skips the nudge the learner needed.
    expect(validateWidgetIntent(build([2, 3])).valid).toBe(false);
    expect(validateWidgetIntent(build([1, 3])).valid).toBe(false);
  });

  it("requires every example step to carry its reason", () => {
    expect(validateWidgetIntent({
      kind: "example",
      problem: "Differentiate x^2",
      steps: [{ id: "s1", expression: "(x+h)^2 - x^2", why: "Set up the difference quotient." }],
    }).valid).toBe(true);

    expect(validateWidgetIntent({
      kind: "example",
      steps: [{ id: "s1", expression: "2x" }],
    }).valid).toBe(false);
  });

  it("requires a mistake check to diagnose, not just mark, every error", () => {
    expect(validateWidgetIntent({
      kind: "mistake_check",
      lines: [
        { id: "l1", content: "(x+h)^2 = x^2 + h^2", status: "error", diagnosis: "The cross term 2xh was dropped." },
      ],
      misconception: "treats squaring as distributing over addition",
      repairQuestion: "Expand (x+h)(x+h) term by term — what appears in the middle?",
    }).valid).toBe(true);

    // Marked wrong with no explanation of what is wrong.
    expect(validateWidgetIntent({
      kind: "mistake_check",
      lines: [{ id: "l1", content: "(x+h)^2 = x^2 + h^2", status: "error" }],
    }).valid).toBe(false);

    // A mistake check with nothing wrong in it is not a mistake check.
    expect(validateWidgetIntent({
      kind: "mistake_check",
      lines: [{ id: "l1", content: "x^2", status: "ok" }],
    }).valid).toBe(false);
  });

  it("allows at most one current roadmap step", () => {
    const build = (states: string[]) => ({
      kind: "roadmap",
      steps: states.map((state, index) => ({ id: `s${index}`, label: `Step ${index}`, state })),
    });
    expect(validateWidgetIntent(build(["done", "current", "upcoming"])).valid).toBe(true);
    expect(validateWidgetIntent(build(["current", "current"])).valid).toBe(false);
  });

  it("requires all five evidence dimensions on a mastery card", () => {
    const evidence = { recall: 90, understanding: 88, procedure: 92, transfer: 70, independence: 86 };
    expect(validateWidgetIntent({ kind: "mastery_card", concept: "Derivatives", evidence }).valid).toBe(true);

    const { transfer: _omitted, ...partial } = evidence;
    expect(validateWidgetIntent({ kind: "mastery_card", concept: "Derivatives", evidence: partial }).valid).toBe(false);
  });
});

describe("learner state", () => {
  it("drops unknown and malformed fields instead of trusting them", () => {
    const state = sanitizeWidgetState({
      selectedOptionId: "o1",
      responseText: "the slope of the tangent",
      hintLevelOpened: 99,
      animationProgress: 4,
      sliderValue: "not a number",
      injected: { evil: true },
    });
    expect(state).toMatchObject({ selectedOptionId: "o1", hintLevelOpened: 3, animationProgress: 1 });
    expect(state).not.toHaveProperty("sliderValue");
    expect(state).not.toHaveProperty("injected");
  });

  it("returns undefined for junk", () => {
    expect(sanitizeWidgetState(null)).toBeUndefined();
    expect(sanitizeWidgetState({})).toBeUndefined();
  });
});

describe("deterministic grading", () => {
  it("grades multiple choice against the agent's own key", () => {
    const intent = {
      format: "multiple_choice" as const,
      options: [{ id: "a", label: "A", correct: true }, { id: "b", label: "B" }],
    };
    expect(gradeAnswerableWidget(intent, { selectedOptionId: "a" })).toBe(true);
    expect(gradeAnswerableWidget(intent, { selectedOptionId: "b" })).toBe(false);
    expect(gradeAnswerableWidget(intent, {})).toBeUndefined();
  });

  it("grades short answers case- and punctuation-insensitively", () => {
    const intent = { format: "short_answer" as const, acceptedAnswers: ["the slope of the tangent"] };
    expect(gradeAnswerableWidget(intent, { responseText: "  The Slope of the Tangent. " })).toBe(true);
    expect(gradeAnswerableWidget(intent, { responseText: "the area under the curve" })).toBe(false);
  });

  it("grades numeric answers within tolerance and tolerates a trailing unit", () => {
    const intent = { format: "numeric" as const, numericAnswer: { value: 9.8, tolerance: 0.1 } };
    expect(gradeAnswerableWidget(intent, { responseText: "9.81 m/s^2" })).toBe(true);
    expect(gradeAnswerableWidget(intent, { responseText: "10.5" })).toBe(false);
    expect(gradeAnswerableWidget(intent, { responseText: "about right" })).toBeUndefined();
  });
});

describe("mastery directive", () => {
  const directive = formatMasteryDirective();

  it("states the core rule and the six stages in order", () => {
    expect(directive).toContain("The agent carries the structure. The student carries the thinking.");
    // Match the numbered stage headers so "MASTER" is not found inside the
    // word "MASTERY" earlier in the directive.
    const order = ["1. ENCOUNTER", "2. UNDERSTAND", "3. CONSTRUCT", "4. APPLY", "5. TRANSFER", "6. MASTER"];
    let cursor = -1;
    for (const stage of order) {
      const index = directive.indexOf(stage);
      expect(index).toBeGreaterThan(cursor);
      cursor = index;
    }
  });

  it("forbids click-through advancement and demands evidence", () => {
    expect(directive).toMatch(/Advancement is NOT click-through/i);
    expect(directive).toMatch(/never move to the next stage because the learner said "ok", "next", "got it"/i);
    expect(directive).toMatch(/stage_advance/);
    expect(directive).toMatch(/ready:true|"ready": true/i);
  });

  it("forbids score-based mastery and completion celebration", () => {
    expect(directive).toMatch(/NEVER declare mastery from a raw score/i);
    expect(directive).toMatch(/You got 90%/);
    expect(directive).toMatch(/You completed Section X/);
    expect(directive).toMatch(/weakest link/i);
    for (const dimension of ["Recall", "Understanding", "Procedure", "Transfer", "Independence"]) {
      expect(directive).toContain(dimension);
    }
  });

  it("obliges the tutor to respond to a widget the learner answered", () => {
    expect(directive).toMatch(/that IS their turn\. Respond to it/i);
    expect(directive).toMatch(/never leave an answered widget without a response/i);
    expect(directive).toMatch(/A wrong answer is a diagnosis opportunity, not a correction opportunity/i);
    expect(directive).toMatch(/A right answer is evidence to test, not a reason to celebrate/i);
  });

  it("requires the work to shift to the learner and errors to be diagnosed", () => {
    expect(directive).toMatch(/Diagnose, never correct/i);
    expect(directive).toMatch(/scratchpad/);
    expect(directive).toMatch(/Teach notation explicitly/i);
    expect(directive).toMatch(/Mastery is impermanent/i);
  });
});
