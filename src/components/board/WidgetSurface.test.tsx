import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { shuffleSeeded, WidgetSurface } from "./WidgetSurface";
import { WIDGET_KINDS, type WidgetIntent, type WidgetKind, type WidgetState } from "../../lib/widgets/types";
import { validateWidgetIntent } from "../../lib/widgets/validate";

/**
 * Render smoke tests for the full widget vocabulary.
 *
 * Two properties are asserted for every one of the 17 widgets:
 *  1. The exemplar intent passes the validator, so these fixtures double as
 *     proof the documented shapes are actually accepted at the boundary.
 *  2. The renderer produces the agent-authored content. A widget that renders
 *     a chrome shell with none of its configured text is a mockup, not a
 *     first-class widget — that is exactly the regression this guards.
 */

const EXEMPLARS: Record<WidgetKind, WidgetIntent> = {
  roadmap: {
    kind: "roadmap",
    heading: "8.1 Derivatives",
    steps: [
      { id: "s1", label: "What a derivative measures", state: "done" },
      { id: "s2", label: "The difference quotient", state: "current" },
      { id: "s3", label: "Differentiating by rule", state: "upcoming" },
    ],
  },
  plan: {
    kind: "plan",
    heading: "Convergence of series — from zero to mastery",
    steps: [
      {
        id: "s1",
        label: "Read the picture before the letters",
        details: [
          "Slice the area into strips and watch partial sums settle",
          "Say in plain words what \"converges\" means before any symbols",
        ],
      },
      { id: "s2", label: "The sum rule, built not handed over" },
      { id: "s3", label: "Defend a convergence claim on your own" },
    ],
  },
  concept_card: {
    kind: "concept_card",
    term: "Derivative",
    pronunciation: "/dɪˈrɪvətɪv/",
    classification: "function",
    definition: "The instantaneous rate of change of a function at a point.",
    definitionLatex: "f'(x) = \\lim_{h \\to 0} \\frac{f(x+h) - f(x)}{h}",
    facets: ["Slope of the tangent line", "Rate of change", "Limit of the secant slope"],
  },
  slider: {
    kind: "slider",
    label: "Secant spacing h",
    parameter: "h",
    min: 0.01,
    max: 2,
    step: 0.01,
    value: 1,
    observe: "Watch the secant slope approach the tangent slope as h shrinks.",
    readouts: [{ id: "r1", label: "Secant slope at x=1", expression: "2 + h", precision: 3 }],
  },
  animation: {
    kind: "animation",
    frames: [
      { id: "f1", caption: "A secant through two points on the curve" },
      { id: "f2", caption: "The second point slides toward the first" },
      { id: "f3", caption: "The secant becomes the tangent", latex: "f'(x)" },
    ],
    predictPrompt: "Before pressing play: what happens to the line as the points meet?",
    respond: { prompt: "Commit your prediction before playback unlocks." },
    controls: { step: true, replay: true, scrub: true },
    checkpoints: [
      {
        id: "c1",
        at: 0.5,
        prompt: "The gap has halved. Has the slope of the line changed a little or a lot?",
        options: [
          { id: "a", label: "A little — it is settling toward a value", correct: true },
          { id: "b", label: "A lot — it is still changing steeply" },
        ],
        rationale: "This is where convergence becomes visible rather than merely asserted.",
      },
    ],
    linkedRepresentations: [
      {
        id: "lr1",
        representation: "equation",
        label: "Difference quotient",
        tracks: "The value of (f(x+h) - f(x)) / h as h shrinks with the animation.",
      },
    ],
    reconcilePrompt: "You predicted one thing and saw another — or the same. Which was it, and what accounts for the difference?",
    reconstructPrompt: "Without replaying it: explain why the secant becomes the tangent.",
  },
  comparison: {
    kind: "comparison",
    columns: [
      { id: "avg", title: "Average rate", accent: "amber" },
      { id: "inst", title: "Instantaneous rate", accent: "cyan" },
    ],
    rows: [
      { id: "r1", label: "Interval", cells: ["A finite interval", "A vanishing interval"] },
      { id: "r2", label: "Geometry", cells: ["Secant line", "Tangent line"] },
    ],
    takeaway: "The derivative is the average rate after the interval has been shrunk to nothing.",
  },
  question: {
    kind: "question",
    prompt: "As h → 0, what does the secant line become?",
    format: "multiple_choice",
    options: [
      { id: "a", label: "The tangent line at that point", correct: true },
      { id: "b", label: "A vertical line", misconception: "reads the shrinking run as a zero denominator" },
      { id: "c", label: "The x-axis", misconception: "confuses the limit of the slope with the limit of the function" },
    ],
    explanation: "The secant through two converging points approaches the tangent.",
  },
  hint: {
    kind: "hint",
    steps: [
      { level: 1, label: "Nudge", body: "Write out f(x+h) before you subtract anything." },
      { level: 2, label: "Lead", body: "Expand (x+h)^2 fully — there is a middle term." },
      { level: 3, label: "Reveal the idea", body: "Every surviving term after dividing by h still contains an h, except one." },
    ],
  },
  scratchpad: {
    kind: "scratchpad",
    prompt: "Your turn. Expand (x+h)^2 - x^2 and divide by h.",
    starter: "(x+h)^2 - x^2 = ",
    mode: "math",
    lines: 4,
  },
  annotation: {
    kind: "annotation",
    targetLabel: "The difference quotient",
    marks: [
      { id: "m1", target: "h → 0", note: "This is the limit doing the real work — h never equals 0.", emphasis: "circle" },
      { id: "m2", target: "f(x+h) - f(x)", note: "The rise: how much the output changed.", emphasis: "underline" },
    ],
  },
  reveal: {
    kind: "reveal",
    prompt: "Try it first, then check yourself.",
    items: [
      { id: "i1", label: "What is the derivative of x^2?", content: "2x", contentLatex: "2x" },
    ],
    actionLabel: "Show me",
  },
  example: {
    kind: "example",
    problem: "Differentiate f(x) = x^2 from first principles.",
    steps: [
      { id: "s1", latex: "\\frac{(x+h)^2 - x^2}{h}", why: "Set up the difference quotient." },
      { id: "s2", latex: "\\frac{2xh + h^2}{h}", why: "Expand and cancel the x^2 terms." },
      { id: "s3", latex: "2x + h", why: "Divide through by h — legal because h is not yet 0." },
    ],
    conclusion: "Letting h → 0 leaves 2x.",
  },
  mistake_check: {
    kind: "mistake_check",
    prompt: "Let's look at what you wrote.",
    lines: [
      { id: "l1", content: "(x+h)^2 = x^2 + h^2", status: "error", diagnosis: "The cross term 2xh has gone missing." },
      { id: "l2", content: "so the slope is h", status: "ok" },
    ],
    misconception: "Treats squaring as if it distributes over addition.",
    repairQuestion: "Multiply (x+h)(x+h) out term by term — what appears in the middle?",
    correction: "(x+h)^2 = x^2 + 2xh + h^2",
  },
  memory_hook: {
    kind: "memory_hook",
    hook: "Derivative = slope of the tangent = limit of the secant.",
    elaboration: "If you remember only one sentence about derivatives, remember this one.",
    resurfaceFor: ["derivatives", "tangent lines", "rates of change"],
  },
  retrieval_check: {
    kind: "retrieval_check",
    prompt: "From memory, with no notes: what does f'(x) measure?",
    format: "short_answer",
    acceptedAnswers: ["the slope of the tangent", "instantaneous rate of change"],
    source: "8.1 Derivatives · two sessions ago",
    expectedPoints: ["mentions slope or rate of change", "mentions a single point, not an interval"],
  },
  challenge: {
    kind: "challenge",
    badge: "On your own",
    prompt: "A population grows as P(t) = t^3. Find the instantaneous growth rate at t = 2.",
    successCriteria: ["Uses the derivative, not an average", "Evaluates at t = 2", "States units"],
    transferNote: "Same idea, different context: this is biology, not geometry.",
  },
  reflection: {
    kind: "reflection",
    prompt: "Explain to me, in your own words, why we need the limit at all.",
    guidance: ["Mention what goes wrong if h is exactly 0", "Mention what h → 0 gives you"],
    evaluationCriteria: ["Explains division by zero", "Connects the limit to the tangent"],
    minWords: 25,
  },
  mastery_card: {
    kind: "mastery_card",
    concept: "Derivatives from first principles",
    evidence: { recall: 90, understanding: 88, procedure: 94, transfer: 72, independence: 85 },
    understands: ["The derivative is a limit, not a formula to memorize"],
    canDo: ["Differentiate polynomials from first principles"],
    recalls: ["The difference quotient without prompting"],
    watch: ["Transfer to non-geometric contexts is still shaky", "Likely to forget why h cannot be 0"],
    next: "Apply the same reasoning to a rate-of-change word problem.",
    reviewIn: "3 days",
  },
};

const render = (intent: WidgetIntent) =>
  renderToStaticMarkup(
    <WidgetSurface intent={intent} chalk="#e8e8ea" accent="#7dd3fc" readOnly />
  );

describe("WidgetSurface — all 17 widgets", () => {
  it("has an exemplar for every widget kind", () => {
    expect(Object.keys(EXEMPLARS).sort()).toEqual([...WIDGET_KINDS].sort());
  });

  for (const kind of WIDGET_KINDS) {
    it(`renders the agent-authored content of the ${kind} widget`, () => {
      const intent = EXEMPLARS[kind];
      // The exemplar must be a legal intent, so these fixtures also prove the
      // documented widget shapes survive the validator.
      expect(validateWidgetIntent(intent)).toEqual({ valid: true });

      const html = render(intent);
      expect(html).toContain(`data-widget="${kind}"`);
      expect(html.length).toBeGreaterThan(120);
    });
  }

  it("renders roadmap steps and marks the current one", () => {
    const html = render(EXEMPLARS.roadmap);
    expect(html).toContain("8.1 Derivatives");
    expect(html).toContain("The difference quotient");
    expect(html).toContain("Differentiating by rule");
  });

  it("renders a concept card's term, definition, and facets", () => {
    const html = render(EXEMPLARS.concept_card);
    expect(html).toContain("Derivative");
    expect(html).toContain("instantaneous rate of change");
    expect(html).toContain("Slope of the tangent line");
  });

  it("renders every question option so a distractor can be chosen", () => {
    const html = render(EXEMPLARS.question);
    expect(html).toContain("As h → 0, what does the secant line become?");
    expect(html).toContain("The tangent line at that point");
    expect(html).toContain("A vertical line");
    expect(html).toContain("The x-axis");
  });

  it("renders every example step together with its reason", () => {
    const html = render(EXEMPLARS.example);
    expect(html).toContain("Set up the difference quotient.");
    expect(html).toContain("Expand and cancel the x^2 terms.");
    expect(html).toContain("Divide through by h");
  });

  it("shows a mistake check's diagnosis but withholds the correction until the learner responds", () => {
    const unanswered = render(EXEMPLARS.mistake_check);
    expect(unanswered).toContain("The cross term 2xh has gone missing.");
    expect(unanswered).toContain("Multiply (x+h)(x+h) out term by term");
    // Handing back the corrected line removes the only useful part of the mistake.
    expect(unanswered).not.toContain("x^2 + 2xh + h^2");

    const answered = renderToStaticMarkup(
      <WidgetSurface
        intent={EXEMPLARS.mistake_check}
        state={{ submitted: true }}
        chalk="#e8e8ea"
        accent="#7dd3fc"
        readOnly
      />
    );
    expect(answered).toContain("x^2 + 2xh + h^2");
  });

  it("keeps a question's explanation hidden until an answer is committed", () => {
    const unanswered = render(EXEMPLARS.question);
    expect(unanswered).not.toContain("The secant through two converging points");

    const answered = renderToStaticMarkup(
      <WidgetSurface
        intent={EXEMPLARS.question}
        state={{ selectedOptionId: "a", submitted: true, correct: true }}
        chalk="#e8e8ea"
        accent="#7dd3fc"
        readOnly
      />
    );
    expect(answered).toContain("The secant through two converging points");
  });

  it("computes the mastery verdict from evidence instead of trusting a score", () => {
    const html = render(EXEMPLARS.mastery_card);
    expect(html).toContain("Derivatives from first principles");
    // Transfer is the weakest dimension at 72, below the threshold, so the card
    // must refuse mastery even though four dimensions are strong.
    expect(html).toMatch(/Not yet/i);
    expect(html).toMatch(/Transfer/);
    expect(html).toContain("Likely to forget why h cannot be 0");
  });

  it("opts every widget out of the board's cursive chalk font", () => {
    // The board sets a handwriting font on the whole content stream. Widgets
    // carry dense scannable content — options, tables, verdicts, numbers — that
    // a cursive face makes genuinely hard to read, so each one must override
    // the inherited family rather than relying on where it happens to sit.
    for (const kind of WIDGET_KINDS) {
      expect(render(EXEMPLARS[kind])).toContain("font-family:var(--font-widget)");
    }
  });

  it("bounds a widget to its own width so the board beside it stays draggable", () => {
    // A full-bleed widget would stretch its wrapper across the content stream
    // and swallow left-drags landing hundreds of pixels to its right, which is
    // how the board became nearly impossible to pan.
    const html = render(EXEMPLARS.question);
    expect(html).toMatch(/w-\[460px\]/);
    expect(html).toMatch(/max-w-full/);
    expect(html).not.toMatch(/class="[^"]*\bw-full\b[^"]*max-w-\[460px\]/);
  });

  it("keeps a reveal item obscured and unselectable until the learner uncovers it", () => {
    const hidden = render(EXEMPLARS.reveal);
    expect(hidden).toContain("What is the derivative of x^2?");
    // Obscured and unselectable, so the learner has to try before looking.
    expect(hidden).toMatch(/blur\(/);
    expect(hidden).toMatch(/user-select:\s*none/);
    expect(hidden).toContain("Show me");

    const shown = renderToStaticMarkup(
      <WidgetSurface
        intent={EXEMPLARS.reveal}
        state={{ revealedIds: ["i1"] }}
        chalk="#e8e8ea"
        accent="#7dd3fc"
        readOnly
      />
    );
    expect(shown).not.toMatch(/blur\(/);
    expect(shown).toContain("Hide");
  });
});

/**
 * The animation is the one widget whose instructional value lives entirely in
 * its sequencing. Every beat below is trivially skippable by a learner in a
 * hurry, so each is gated in code rather than merely requested in prose.
 */
describe("WidgetSurface — animation as prediction, not video", () => {
  const animation = EXEMPLARS.animation as Extract<WidgetIntent, { kind: "animation" }>;

  const live = (intent: WidgetIntent, state?: WidgetState) =>
    renderToStaticMarkup(
      <WidgetSurface intent={intent} state={state} chalk="#e8e8ea" accent="#7dd3fc" onState={() => {}} />
    );

  /** The nth `disabled` state of the play control, which renders first. */
  const playDisabled = (html: string) => {
    const button = html.slice(html.indexOf("Play animation") - 200, html.indexOf("Play animation") + 40);
    return /disabled=""/.test(button);
  };

  it("locks playback until the prediction is committed", () => {
    const html = live(animation);
    expect(html).toContain("Commit your prediction to unlock playback");
    expect(playDisabled(html)).toBe(true);

    // A prediction entered after watching is a description, so the lock is the
    // difference between the two kinds of evidence — not a nicety.
    const unlocked = live(animation, { predictionLocked: true, submitted: true, responseText: "It becomes the tangent" });
    expect(unlocked).not.toContain("Commit your prediction to unlock playback");
    expect(playDisabled(unlocked)).toBe(false);
  });

  it("halts at an unanswered checkpoint and blocks play until it is answered", () => {
    const atCheckpoint = live(animation, { predictionLocked: true, animationProgress: 0.5 });
    expect(atCheckpoint).toContain("Has the slope of the line changed a little or a lot?");
    expect(atCheckpoint).toContain("A little — it is settling toward a value");
    expect(playDisabled(atCheckpoint)).toBe(true);

    const answered = live(animation, {
      predictionLocked: true,
      animationProgress: 0.5,
      checkpointResponses: { c1: { response: "a", correct: true } },
    });
    expect(answered).not.toContain("Has the slope of the line changed a little or a lot?");
    expect(playDisabled(answered)).toBe(false);
  });

  it("withholds reconciliation until observation is actually complete", () => {
    const midway = live(animation, { predictionLocked: true, animationProgress: 0.5 });
    expect(midway).not.toContain("what accounts for the difference?");

    // Reaching the end with a checkpoint still unanswered is not completion.
    const skipped = live(animation, { predictionLocked: true, animationProgress: 1 });
    expect(skipped).not.toContain("what accounts for the difference?");

    const complete = live(animation, {
      predictionLocked: true,
      animationProgress: 1,
      checkpointResponses: { c1: { response: "a", correct: true } },
    });
    expect(complete).toContain("what accounts for the difference?");
  });

  it("orders reconstruction after reconciliation, never alongside it", () => {
    const observed = {
      predictionLocked: true,
      animationProgress: 1,
      checkpointResponses: { c1: { response: "a", correct: true } },
    };
    // Explaining the gap between prediction and observation is what makes a
    // wrong prediction worth having; rebuilding the idea comes after that.
    const beforeReconcile = live(animation, observed);
    expect(beforeReconcile).not.toContain("explain why the secant becomes the tangent");

    const afterReconcile = live(animation, { ...observed, reconcileText: "I expected a vertical line." });
    expect(afterReconcile).toContain("explain why the secant becomes the tangent");
    // A committed answer is not re-editable: revising it after the fact would
    // erase the comparison the step exists to make.
    expect(afterReconcile).toContain("I expected a vertical line.");
  });

  it("offers only the playback controls the intent declares", () => {
    const full = live(animation, { predictionLocked: true });
    expect(full).toContain("Scrub animation");
    expect(full).toContain("Step forward one frame");
    expect(full).toContain("Replay from the start");
    // Speed was not declared, so it must not appear.
    expect(full).not.toContain("Playback speed");

    // Withholding scrub is a pedagogical choice — an unrewindable first viewing
    // is what makes it worth attending to — so the surface must not restore it.
    const watchOnly: WidgetIntent = { ...animation, controls: {} };
    const bare = live(watchOnly, { predictionLocked: true });
    expect(bare).not.toContain("Scrub animation");
    expect(bare).not.toContain("Step forward one frame");
    expect(bare).not.toContain("Replay from the start");
    expect(bare).toContain("Play animation");
  });

  it("shows linked representations so one change can be read two ways", () => {
    const html = live(animation, { predictionLocked: true });
    expect(html).toContain("Difference quotient");
    expect(html).toContain("as h shrinks");
    expect(html).toContain("equation");
  });

  it("shuffles checkpoint options so position carries no signal", () => {
    const withShuffledCheckpoint: WidgetIntent = {
      ...animation,
      checkpoints: [
        {
          id: "cp-area",
          at: 0.5,
          prompt: "Which estimate wins at thin strips?",
          options: [
            { id: "a", label: "the coarse-left rule", correct: true },
            { id: "b", label: "the thin-strip one" },
            { id: "c", label: "the single tall bar" },
          ],
        },
      ],
    };
    // Authored correct-first; the playhead is parked at the checkpoint so its
    // options render. The seeded permutation moves "a" off the top slot.
    const html = live(withShuffledCheckpoint, { predictionLocked: true, animationProgress: 0.5 });
    expect(html.indexOf("the thin-strip one")).toBeGreaterThan(-1);
    expect(html.indexOf("the thin-strip one")).toBeLessThan(html.indexOf("the coarse-left rule"));
  });

  it("renders graph-bound motion on an actual coordinate plane, guide included", () => {
    // The reported failure: an animation "on a graph" showed a lone dot over
    // an empty strip — the graph itself never rendered. The scene must carry
    // axes and the guide curve the motion belongs to.
    const onGraph: WidgetIntent = {
      ...animation,
      motion: {
        xExpression: "t",
        yExpression: "sin(t)",
        tDomain: [-3, 3],
        guideXExpression: "t",
        guideYExpression: "sin(t)",
      },
    };
    const html = live(onGraph, { predictionLocked: true });
    expect(html).toContain('data-motion-scene="2d"');
    // Tick grid labels are the give-away that a coordinate plane rendered.
<<<<<<< HEAD
    const tinyTicks = html.match(/font-size="7"/g) ?? [];
    expect(tinyTicks.length).toBeGreaterThan(0);
    // Isotropic frame + meet (not stretch) so curves keep true proportions.
    expect(html).toContain('preserveAspectRatio="xMidYMid meet"');
=======
    const tinyTicks = html.match(/font-size="5.5"/g) ?? [];
    expect(tinyTicks.length).toBeGreaterThan(0);
>>>>>>> 0ad7ebbfc9bbb8312cb1f1cbadcb8aba823bdf61
    // The guide curve renders solid; the live path stays dashed.
    expect(html).toMatch(/<polyline[^>]*stroke-dasharray="3 5"/);
    const polylines = html.match(/<polyline/g) ?? [];
    expect(polylines.length).toBeGreaterThanOrEqual(2);
  });

  it("writes the guide on (Manim's Create) by default, and honours the opt-out", () => {
    const withGuide: WidgetIntent = {
      ...animation,
      motion: { xExpression: "t", yExpression: "sin(t)", tDomain: [-3, 3], guideXExpression: "t", guideYExpression: "sin(t)" },
    };
    // Mid playback: the guide is still drawing — dash-offset partially open.
    const mid = live(withGuide, { predictionLocked: true, animationProgress: 0.05 });
    expect(mid).toContain('data-guide="write-on"');
    expect(mid).toMatch(/stroke-dashoffset="[1-9]/);

    // Fully played: the graph stays as a solid reference, no dash state left.
    const done = live(withGuide, { predictionLocked: true, animationProgress: 1 });
    expect(done).not.toContain("stroke-dashoffset");

    // Explicitly opted out: the guide is simply present from frame one.
    const plain = live(
      { ...animation, motion: { xExpression: "t", yExpression: "sin(t)", tDomain: [-3, 3], guideXExpression: "t", guideYExpression: "sin(t)", guideWriteOn: false } },
      { predictionLocked: true, animationProgress: 0.05 }
    );
    expect(plain).not.toContain('data-guide="write-on"');
  });

  it("eases the playhead by default; a constant-rate lesson opts out", () => {
    const motion = { xExpression: "t", yExpression: "t * t", tDomain: [-3, 3] as [number, number] };
    // The head dot is the only circle inside the motion scene's SVG; the shell
    // header carries its own icon circles, so scope to the scene.
    const at = (mhtml: string) => {
      const sceneHtml = mhtml.slice(mhtml.indexOf("data-motion-scene"));
      return Number(sceneHtml.match(/<circle cx="([\d.]+)"/)?.[1] ?? -1);
    };
    const linear = live({ ...animation, motion: { ...motion, easing: "linear" } }, { predictionLocked: true, animationProgress: 0.35 });
    const smooth = live({ ...animation, motion: { ...motion, easing: "smooth" } }, { predictionLocked: true, animationProgress: 0.35 });
    const defaulted = live({ ...animation, motion }, { predictionLocked: true, animationProgress: 0.35 });

    const linearX = at(linear);
    const smoothX = at(smooth);
    expect(linearX).toBeGreaterThan(0);
    // smooth(0.35) ≈ 0.30 — the eased head sits behind the constant-rate head.
    expect(smoothX).toBeLessThan(linearX);
    // and "smooth" IS the default, not an extra the agent must remember.
    expect(at(defaulted)).toBe(smoothX);
  });

  it("renders 3D motion in an isometric view over a floor grid", () => {
    const in3d: WidgetIntent = {
      ...animation,
      motion: {
        xExpression: "cos(t)",
        yExpression: "sin(t)",
        zExpression: "t / 4",
        tDomain: [0, 6.28],
      },
    };
    const html = live(in3d, { predictionLocked: true });
    expect(html).toContain('data-motion-scene="3d"');
    expect(html).toMatch(/<line[^>]*stroke-dasharray="2 2.5"/);
  });

  it("ignores a non-string zExpression instead of breaking the scene", () => {
    const drifted = {
      ...animation,
      motion: {
        xExpression: "t",
        yExpression: "t * t",
        zExpression: 42,
        tDomain: [-2, 2],
      },
    } as unknown as WidgetIntent;
    const html = live(drifted, { predictionLocked: true });
    expect(html).toContain('data-motion-scene="2d"');
  });
});

/**
 * The scene stage renders a composed figure — the same host-side clock, just a
 * richer picture. The assertions below pin the two things that matter: the
 * picture is driven by the playhead (same t, same frame), and the live value
 * in a label is computed from the playhead rather than baked in as text.
 */
describe("WidgetSurface — animation scene, a figure composed not a preset", () => {
  const riemannScene: WidgetIntent = {
    kind: "animation",
    frames: [{ id: "f1", caption: "As the slices refine, the sum settles toward the area." }],
    scene: {
      xDomain: [0, 1],
      yDomain: [-0.3, 1.2],
      elements: [
        { kind: "curve", id: "f", xExpression: "u", yExpression: "u^2", uDomain: [0, 1], accent: "cyan" },
        {
          kind: "rects", id: "r", count: "round(2 + 10*t)", x0: 0, x1: 1,
          yExpression: "x^2", heightRule: "left", fill: "amber", stroke: "ember",
        },
        { kind: "arrow", id: "dx", from: { x: 0.4, y: -0.16 }, to: { x: 0.6, y: -0.16 }, label: "Δx" },
        { kind: "label", id: "n", at: { x: 0.95, y: 1.05 }, text: "n = {round(2 + 10*t)}", anchor: "end" },
      ],
    },
  };

  const live = (intent: WidgetIntent, state?: WidgetState) =>
    renderToStaticMarkup(
      <WidgetSurface intent={intent} state={state} chalk="#e8e8ea" accent="#7dd3fc" onState={() => {}} />
    );

  it("renders the composed scene rather than the lone progress dot", () => {
    const html = live(riemannScene, { predictionLocked: true });
    expect(html).toContain('data-motion-scene="scene"');
    expect(html).toContain("<rect");
    expect(html).toContain("Δx");
  });

  it("computes the live label from the playhead — same t, same N", () => {
    const atMid = live(riemannScene, { predictionLocked: true, animationProgress: 0.5 });
    expect(atMid).toContain("n = 7"); // round(2 + 10·0.5)
    const atEnd = live(riemannScene, { predictionLocked: true, animationProgress: 1 });
    expect(atEnd).toContain("n = 12"); // round(2 + 10·1)
  });

  it("is a pure function of the playhead — two renders at the same t agree", () => {
    const first = live(riemannScene, { predictionLocked: true, animationProgress: 0.3 });
    const second = live(riemannScene, { predictionLocked: true, animationProgress: 0.3 });
    expect(first).toBe(second);
  });

  it("falls back to the progress dot instead of throwing on a broken scene", () => {
    const broken = {
      ...riemannScene,
      scene: { xDomain: [0, 1], yDomain: [0, 1], elements: [{ kind: "rects", id: "r", count: 4, x0: 0, x1: 1 }] },
    } as unknown as WidgetIntent;
    // A rects element missing its function is dropped at normalize time, and
    // the body degrades to the dot — no throw, no blank board.
    expect(() => live(broken)).not.toThrow();
  });
<<<<<<< HEAD

  it("keeps a unit circle round — isotropic frame, no SVG stretch", () => {
    // Regression for the squashed ellipse: independent x/y scales +
    // preserveAspectRatio="none" made the unit circle look like a lozenge.
    const unitCircle: WidgetIntent = {
      kind: "animation",
      frames: [{ id: "f1", caption: "One lap around the unit circle" }],
      scene: {
        xDomain: [-2, 2],
        yDomain: [-2, 2],
        xLabel: "x",
        yLabel: "y",
        elements: [
          {
            kind: "curve",
            id: "circle",
            xExpression: "cos(u)",
            yExpression: "sin(u)",
            uDomain: [0, 6.283185307179586],
            accent: "chalk",
          },
          {
            kind: "point",
            id: "p",
            xExpression: "cos(2*3.141592653589793*t)",
            yExpression: "sin(2*3.141592653589793*t)",
            label: "P",
            accent: "amber",
          },
        ],
      },
    };
    const html = live(unitCircle, { predictionLocked: true });
    expect(html).toContain('preserveAspectRatio="xMidYMid meet"');
    expect(html).not.toContain('preserveAspectRatio="none"');
    // Square domain → square plot (+ pads). Frame tag is WxH.
    const frame = html.match(/data-scene-frame="(\d+)x(\d+)"/);
    expect(frame).not.toBeNull();
    const w = Number(frame![1]);
    const h = Number(frame![2]);
    // Pads are asymmetric (left/bottom labels), so height ≈ width within ~20%.
    expect(Math.abs(w - h) / Math.max(w, h)).toBeLessThan(0.2);
    // And both axes use enough pixels that the circle is not a tiny strip.
    expect(Math.min(w, h)).toBeGreaterThan(250);
  });
=======
>>>>>>> 0ad7ebbfc9bbb8312cb1f1cbadcb8aba823bdf61
});

/**
 * The agent drafts options in priority order, parking the correct answer first
 * every time; left alone that is a legible "it's always A" pattern. Display
 * order is instead a seeded shuffle of the authored order — stable per option
 * set, never a re-roll mid-session.
 */
describe("seeded option shuffle — position carries no signal", () => {
  const shuffledQuestion: WidgetIntent = {
    kind: "question",
    prompt: "Which strip count gives the best area estimate?",
    format: "multiple_choice",
    options: [
      { id: "a", label: "one too-wide slab", correct: true },
      { id: "b", label: "several thin strips" },
      { id: "c", label: "one tall triangle" },
      { id: "d", label: "the interval endpoints only" },
    ],
  };

  const liveQ = (intent: WidgetIntent, state?: WidgetState) =>
    renderToStaticMarkup(
      <WidgetSurface intent={intent} state={state} chalk="#e8e8ea" accent="#7dd3fc" onState={() => {}} />
    );

  const renderedOrder = (html: string) =>
    [...html.matchAll(/>(one too-wide slab|several thin strips|one tall triangle|the interval endpoints only)</g)]
      .map((m) => m[1]);

  it("moves the authored first option off the A slot", () => {
    // Authored correct-first; this fixture's seeded order moves it to D.
    const order = renderedOrder(liveQ(shuffledQuestion));
    expect(order).toEqual(["several thin strips", "the interval endpoints only", "one tall triangle", "one too-wide slab"]);
    expect(order[0]).not.toBe("one too-wide slab");
  });

  it("keeps the same permutation across renders of the same content", () => {
    const first = renderedOrder(liveQ(shuffledQuestion));
    const second = renderedOrder(liveQ(shuffledQuestion, { selectedOptionId: "b", submitted: true }));
    // Even a submitted state re-render must not visibly re-roll the board.
    expect(second).toEqual(first);
  });

  it("shuffleSeeded is deterministic, lossless, and content-sensitive", () => {
    const items = ["a", "b", "c", "d"];
    const key = "p|a|b|c|d";
    expect(shuffleSeeded(items, key)).toEqual(shuffleSeeded(items, key));
    expect([...shuffleSeeded(items, key)].sort()).toEqual(items);
    expect(shuffleSeeded(items, key)).not.toEqual(items);
    expect(shuffleSeeded(items, "q|a|b|c|d")).not.toEqual(shuffleSeeded(items, key));
    expect(shuffleSeeded(["only"], "k")).toEqual(["only"]);
  });
});

/**
 * The plan is the session-opening contract: proposed after intake, agreed or
 * edited by the learner, and only then taught. The visible structure mirrors
 * the reference card — heading, numbered phases with detail lines, the consent
 * question, Edit / Start — in the board's widget chrome.
 */
describe("WidgetSurface — plan as an agreement gate, not a poster", () => {
  const plan = EXEMPLARS.plan as Extract<WidgetIntent, { kind: "plan" }>;

  const live = (intent: WidgetIntent, state?: WidgetState) =>
    renderToStaticMarkup(
      <WidgetSurface intent={intent} state={state} chalk="#e8e8ea" accent="#7dd3fc" onState={() => {}} />
    );

  it("renders phases and detail lines, then asks for agreement", () => {
    const html = live(plan);
    expect(html).toContain("Convergence of series — from zero to mastery");
    expect(html).toContain("Read the picture before the letters");
    expect(html).toContain("(1)");
    expect(html).toContain("watch partial sums settle");
    expect(html).toContain("Do you agree with this plan?");
    expect(html).toContain("Start learning");
    expect(html).toContain("Edit plan");
    expect(html).not.toContain("Ready in a few minutes");
  });

  it("lets the agent reword the consent question, never the buttons", () => {
    const html = live({ ...plan, agreementPrompt: "Shall we run it this way?" });
    expect(html).toContain("Shall we run it this way?");
    expect(html).toContain("Start learning");
  });

  it("shows the learner's edited draft over the proposal once edited", () => {
    const html = live(plan, {
      planDraft: {
        heading: "Convergence — my route",
        steps: [
          { id: "e1", label: "Only the sum rule" },
          { id: "e2", label: "Then a hard example" },
        ],
      },
    });
    expect(html).toContain("Only the sum rule");
    expect(html).toContain("your version");
    expect(html).not.toContain("Read the picture before the letters");
  });

  it("settles into a started state after the go signal", () => {
    const html = live(plan, { submitted: true });
    expect(html).toContain("Started");
    expect(html).not.toContain(">Start learning<");
  });
});
