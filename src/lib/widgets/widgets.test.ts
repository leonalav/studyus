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
  it("defines exactly the 18 widgets, with Graph/Geometry/Equation left to visualize", () => {
    expect(WIDGET_KINDS).toHaveLength(18);
    // 3 (Graph), 4 (Point/Geometry) and 5 (Equation) stay visualization intents.
    const numbers = WIDGET_KINDS.map((kind) => WIDGET_BOARD_NUMBER[kind]);
    expect(numbers).not.toContain(3);
    expect(numbers).not.toContain(4);
    expect(numbers).not.toContain(5);
    expect(new Set(numbers).size).toBe(18);
    // #21 is the plan — the session-opening agreement gate.
    expect(WIDGET_BOARD_NUMBER.plan).toBe(21);
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

  it("accepts a mastery card with no evidence, because the ledger supplies it", () => {
    // Mastery scores are computed from recorded evidence and written onto the
    // card by the harness. The agent is not required — or trusted — to author
    // them, so a card without an evidence block is legal rather than malformed.
    expect(validateWidgetIntent({ kind: "mastery_card", concept: "Derivatives" }).valid).toBe(true);
    expect(
      validateWidgetIntent({ kind: "mastery_card", concept: "Derivatives", skillId: "derivatives" }).valid
    ).toBe(true);

    const partial = { recall: 90, understanding: 88 };
    expect(validateWidgetIntent({ kind: "mastery_card", concept: "Derivatives", evidence: partial }).valid).toBe(true);
  });

  it("still rejects out-of-range mastery scores when a card carries them", () => {
    const evidence = { recall: 90, understanding: 88, procedure: 92, transfer: 70, independence: 86 };
    expect(validateWidgetIntent({ kind: "mastery_card", concept: "Derivatives", evidence }).valid).toBe(true);

    expect(
      validateWidgetIntent({
        kind: "mastery_card",
        concept: "Derivatives",
        evidence: { ...evidence, transfer: 140 },
      }).valid
    ).toBe(false);
    expect(
      validateWidgetIntent({
        kind: "mastery_card",
        concept: "Derivatives",
        evidence: { ...evidence, recall: "high" },
      }).valid
    ).toBe(false);
  });

  it("rejects a weakest link that is not one of the five dimensions", () => {
    expect(
      validateWidgetIntent({ kind: "mastery_card", concept: "Derivatives", weakestLink: "transfer" }).valid
    ).toBe(true);
    expect(
      validateWidgetIntent({ kind: "mastery_card", concept: "Derivatives", weakestLink: "effort" }).valid
    ).toBe(false);
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

  it("requires the existing roadmap to advance with a demonstrated goal", () => {
    expect(directive).toMatch(/existing roadmap/i);
    expect(directive).toMatch(/update_widget/i);
    expect(directive).toMatch(/never append a second roadmap|never place a second roadmap/i);
    expect(directive).toMatch(/same turn that opens the next step/i);
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

/**
 * The Animation widget carries the heaviest instructional contract of the
 * seventeen, because it is the one most likely to degrade into video. A learner
 * who watches an animation and moves on has seen a thing happen and can tell you
 * nothing about why. The upgraded contract — prediction-lock, controlled
 * observation, checkpoints, reconciliation, reconstruction — is what makes the
 * difference, and every clause of it is enforced here rather than requested in
 * a prompt, because a model under sampling pressure will drop the awkward parts
 * first.
 */
describe("animation validation — the contract that stops it becoming video", () => {
  const frames = [{ id: "f1", caption: "Secant rotates toward tangent" }];

  function animation(extra: Record<string, unknown> = {}) {
    return validateWidgetIntent({ kind: "animation", frames, ...extra });
  }

  /** The rejection reason, or "" when the intent was accepted. Keeps the
   *  assertions readable without hand-narrowing the result union each time. */
  function reasonFor(extra: Record<string, unknown>): string {
    const result = animation(extra);
    return result.valid ? "" : result.reason;
  }

  it("accepts a plain illustrative animation with no prompts attached", () => {
    // Not every animation must be an assessment. A tutor may legitimately show
    // something; the contract only binds once it starts making claims.
    expect(animation().valid).toBe(true);
  });

  it("rejects a prediction the learner has no way to commit", () => {
    // The surface locks playback until the prediction is submitted. Asking for
    // one without an input to record it leaves the learner staring at a disabled
    // play button with nowhere to type.
    const reason = reasonFor({ predictPrompt: "What will the slope approach?" });
    expect(reason).toMatch(/respond spec/i);
  });

  it("accepts a prediction paired with the means to commit it", () => {
    expect(
      animation({
        predictPrompt: "What will the slope approach?",
        respond: { prompt: "Commit your prediction" },
      }).valid
    ).toBe(true);
  });

  it("rejects reconciliation with nothing to reconcile against", () => {
    // Reconciliation is what makes a WRONG prediction valuable: the learner has
    // to say what they expected, what happened, and what accounts for the gap.
    // Without a recorded prediction it collapses into "describe what you saw".
    const reason = reasonFor({ reconcilePrompt: "How did that differ from your prediction?" });
    expect(reason).toMatch(/nothing to reconcile/i);
  });

  it("requires checkpoints to be in strictly increasing playhead order", () => {
    // The surface halts in sequence. An out-of-order checkpoint is either
    // skipped outright or rewinds the learner mid-thought.
    const reason = reasonFor({
      checkpoints: [
        { id: "c1", at: 0.8, prompt: "What now?" },
        { id: "c2", at: 0.3, prompt: "And now?" },
      ],
    });
    expect(reason).toMatch(/increasing playhead order/i);
  });

  it("rejects two checkpoints at the same instant", () => {
    expect(
      reasonFor({
        checkpoints: [
          { id: "c1", at: 0.5, prompt: "What now?" },
          { id: "c2", at: 0.5, prompt: "And now?" },
        ],
      })
    ).toMatch(/increasing playhead order/i);
  });

  it("keeps checkpoint positions inside the playhead range", () => {
    expect(animation({ checkpoints: [{ id: "c1", at: 1.4, prompt: "?" }] }).valid).toBe(false);
    expect(animation({ checkpoints: [{ id: "c1", at: -0.1, prompt: "?" }] }).valid).toBe(false);
  });

  it("requires every checkpoint to actually ask something", () => {
    expect(reasonFor({ checkpoints: [{ id: "c1", at: 0.5 }] })).toMatch(/needs a prompt/i);
  });

  it("rejects a multiple-choice checkpoint with no correct answer marked", () => {
    // Silently accepting every answer is worse than not asking: the learner is
    // told they were right regardless of what they thought.
    const reason = reasonFor({
      checkpoints: [
        {
          id: "c1",
          at: 0.5,
          prompt: "Which way does it bend?",
          options: [
            { id: "a", label: "Up" },
            { id: "b", label: "Down" },
          ],
        },
      ],
    });
    expect(reason).toMatch(/correct option/i);
  });

  it("accepts a graded checkpoint with a key", () => {
    expect(
      animation({
        checkpoints: [
          {
            id: "c1",
            at: 0.5,
            prompt: "Which way does it bend?",
            options: [
              { id: "a", label: "Up", correct: true },
              { id: "b", label: "Down" },
            ],
            rationale: "This is the moment the curvature reverses.",
          },
        ],
      }).valid
    ).toBe(true);
  });

  it("caps checkpoints before the animation turns into a quiz", () => {
    const many = Array.from({ length: 7 }, (_, i) => ({
      id: `c${i}`,
      at: (i + 1) / 10,
      prompt: "?",
    }));
    expect(animation({ checkpoints: many }).valid).toBe(false);
  });

  it("rejects duplicate checkpoint ids, which would collide in stored answers", () => {
    expect(
      reasonFor({
        checkpoints: [
          { id: "same", at: 0.3, prompt: "First" },
          { id: "same", at: 0.6, prompt: "Second" },
        ],
      })
    ).toMatch(/id/i);
  });

  it("accepts only declared playback affordances", () => {
    expect(animation({ controls: { scrub: true, step: true } }).valid).toBe(true);
    expect(animation({ controls: { scrub: "yes" } }).valid).toBe(false);
    expect(animation({ controls: "all" }).valid).toBe(false);
  });

  it("requires a linked representation to say what it tracks", () => {
    // Without that, a "linked" view is just a second picture sitting next to the
    // first, and the learner is left to guess that the two are the same fact.
    const reason = reasonFor({
      linkedRepresentations: [{ id: "r1", representation: "table", label: "Values" }],
    });
    expect(reason).toMatch(/what it tracks/i);
  });

  it("keeps linked representations semantic rather than naming a component", () => {
    expect(
      animation({
        linkedRepresentations: [
          { id: "r1", representation: "table", label: "Values", tracks: "The secant slope at each t" },
        ],
      }).valid
    ).toBe(true);
    // A renderer name must never cross this boundary: the router is the sole
    // renderer authority.
    expect(
      animation({
        linkedRepresentations: [
          { id: "r1", representation: "EChartsLine", label: "Values", tracks: "slope" },
        ],
      }).valid
    ).toBe(false);
  });

  it("accepts the full prediction-to-reconstruction contract", () => {
    expect(
      animation({
        predictPrompt: "What will the secant slope approach?",
        respond: { prompt: "Commit your prediction" },
        checkpoints: [
          { id: "c1", at: 0.45, prompt: "What is happening to the gap?" },
          { id: "c2", at: 0.9, prompt: "What does the secant look like now?" },
        ],
        controls: { scrub: true, step: true, replay: true },
        linkedRepresentations: [
          { id: "r1", representation: "equation", label: "Difference quotient", tracks: "h as it shrinks" },
        ],
        reconcilePrompt: "How did that compare with what you predicted?",
        reconstructPrompt: "Explain, without looking, why the secant becomes the tangent.",
      }).valid
    ).toBe(true);
  });
});

/**
 * The scene stage is the one place the animation stops being a single moving
 * point and becomes a figure the agent *composes*. The contract under test is
 * the same one the rest of the protocol obeys: primitives, not presets — a
 * "Riemann sum" is rects + curve + arrow + labels, never a name — and each
 * primitive's numeric fields are fixed numbers or bounded expressions, so the
 * validator can still assert something concrete about a scene it has never
 * been shown before.
 */
describe("animation scene — a figure composed, not a preset", () => {
  const frames = [{ id: "f1", caption: "Slices refine toward the area" }];

  const riemannScene = (): {
    xDomain: number[];
    yDomain: number[];
    xLabel: string;
    yLabel: string;
    elements: Record<string, unknown>[];
  } => ({
    xDomain: [0, 1],
    yDomain: [-0.3, 1.2],
    xLabel: "x",
    yLabel: "f(x)",
    elements: [
      { kind: "curve", id: "f", xExpression: "u", yExpression: "u^2", uDomain: [0, 1], accent: "cyan" },
      {
        kind: "rects", id: "r", count: "round(2 + 10*t)", x0: 0, x1: 1,
        yExpression: "x^2", heightRule: "left", fill: "amber", stroke: "ember",
      },
      { kind: "arrow", id: "dx", from: { x: 0.4, y: -0.16 }, to: { x: 0.6, y: -0.16 }, label: "Δx" },
      { kind: "label", id: "n", at: { x: 0.95, y: 1.05 }, text: "n = {round(2 + 10*t)}", anchor: "end" },
      { kind: "label", id: "a", at: { x: 0, y: -0.06 }, text: "a" },
      { kind: "label", id: "b", at: { x: 1, y: -0.06 }, text: "b" },
    ],
  });

  const withScene = (extra: Record<string, unknown>) =>
    validateWidgetIntent({ kind: "animation", frames, scene: riemannScene(), ...extra });

  it("accepts the full Riemann composition — primitives, no preset name anywhere", () => {
    expect(withScene({}).valid).toBe(true);
  });

  it("rejects a scene that carries both scene and motion", () => {
    // A scene subsumes motion's point-and-guide; carrying both invites the
    // agent to express one fact two ways and the renderer to choose between them.
    const result = validateWidgetIntent({
      kind: "animation",
      frames,
      motion: { xExpression: "t", yExpression: "t^2", tDomain: [0, 1] },
      scene: riemannScene(),
    });
    expect(result.valid).toBe(false);
    expect(result).toMatchObject({ reason: expect.stringMatching(/both motion and scene/i) });
  });

  it("rejects a scene with no elements — a frame alone is not a figure", () => {
    const result = withScene({ scene: { xDomain: [0, 1], yDomain: [0, 1], elements: [] } });
    expect(result.valid).toBe(false);
    expect(result).toMatchObject({ reason: expect.stringMatching(/elements/i) });
  });

  it("rejects an inverted frame", () => {
    const result = withScene({ scene: { xDomain: [1, 0], yDomain: [0, 1], elements: [{ kind: "label", id: "l", at: { x: 0, y: 0 }, text: "a" }] } });
    expect(result.valid).toBe(false);
    expect(result).toMatchObject({ reason: expect.stringMatching(/xDomain/i) });
  });

  it("rejects duplicate element ids, which would collide as React keys", () => {
    const scene = riemannScene();
    scene.elements[1] = { ...scene.elements[1], id: "f" };
    const result = withScene({ scene });
    expect(result.valid).toBe(false);
    expect(result).toMatchObject({ reason: expect.stringMatching(/id/i) });
  });

  it("rejects an unknown element kind and unknown accent", () => {
    const scene = riemannScene();
    scene.elements.push({ kind: "sparkle", id: "s" } as never);
    expect(withScene({ scene }).valid).toBe(false);

    const badAccent = riemannScene();
    badAccent.elements[0] = { ...badAccent.elements[0], accent: "magenta" };
    expect(withScene({ scene: badAccent }).valid).toBe(false);
  });

  it("rejects rects without a function to approximate", () => {
    const scene = riemannScene();
    delete (scene.elements[1] as Record<string, unknown>).yExpression;
    const result = withScene({ scene });
    expect(result.valid).toBe(false);
    expect(result).toMatchObject({ reason: expect.stringMatching(/yExpression/i) });
  });

  it("rejects a rect count that is neither a number nor an expression", () => {
    const scene = riemannScene();
    (scene.elements[1] as Record<string, unknown>).count = { value: 4 };
    expect(withScene({ scene }).valid).toBe(false);
  });

  it("rejects a rect height rule that is not left/right/midpoint", () => {
    const scene = riemannScene();
    (scene.elements[1] as Record<string, unknown>).heightRule = "diagonal";
    const result = withScene({ scene });
    expect(result.valid).toBe(false);
    expect(result).toMatchObject({ reason: expect.stringMatching(/heightRule/i) });
  });

  it("accepts expressions bound to the playhead, which is what makes N animate", () => {
    // The count expression is the whole trick: a fixed number would give a
    // still histogram, an expression in t gives the refinement the learner
    // watches.
    expect(withScene({}).valid).toBe(true);
    const scene = riemannScene();
    (scene.elements[1] as Record<string, unknown>).count = 8;
    expect(withScene({ scene }).valid).toBe(true);
  });
});

describe("animation learner state — semantic answers, not playback traces", () => {
  it("keeps checkpoint answers keyed by checkpoint", () => {
    const state = sanitizeWidgetState({
      checkpointResponses: {
        c1: { response: "The gap shrinks", correct: true },
        c2: { response: "It becomes the tangent" },
      },
    });
    expect(state?.checkpointResponses).toEqual({
      c1: { response: "The gap shrinks", correct: true },
      c2: { response: "It becomes the tangent" },
    });
  });

  it("drops malformed checkpoint answers rather than storing junk", () => {
    const state = sanitizeWidgetState({
      checkpointResponses: {
        c1: { response: "Good answer" },
        "": { response: "no key at all" },
        c3: { notAResponse: true },
        c4: "just a string",
      },
    });
    // Only entries that are a keyed object with a string response survive. A
    // half-shaped answer stored anyway would later be read as a real one.
    expect(Object.keys(state?.checkpointResponses ?? {})).toEqual(["c1"]);
  });

  it("records the prediction lock, reconciliation, and reconstruction", () => {
    const state = sanitizeWidgetState({
      predictionLocked: true,
      reconcileText: "I expected it to level off, but it kept steepening.",
      reconstructText: "As h shrinks the secant's two points merge.",
    });
    expect(state?.predictionLocked).toBe(true);
    expect(state?.reconcileText).toMatch(/kept steepening/);
    expect(state?.reconstructText).toMatch(/two points merge/);
  });

  it("clamps the playhead but keeps no trace of how the learner got there", () => {
    const state = sanitizeWidgetState({
      animationProgress: 0.6,
      scrubHistory: [0.1, 0.2, 0.9],
      dwellMs: 4200,
    });
    // Interaction telemetry is context, never evidence. The moment scrubbing is
    // recorded as if it meant something, the system starts concluding that the
    // learner who fidgeted understands more than the one who thought first.
    expect(state?.animationProgress).toBe(0.6);
    expect(state).not.toHaveProperty("scrubHistory");
    expect(state).not.toHaveProperty("dwellMs");
  });

  it("records self-rated confidence, which only ever arrives by asking", () => {
    const state = sanitizeWidgetState({ confidence: 140 });
    expect(state?.confidence).toBe(100);
  });
});
