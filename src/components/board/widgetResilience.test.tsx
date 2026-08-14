import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { WidgetSurface } from "./WidgetSurface";
import { ErrorBoundary } from "../ErrorBoundary";
import { WIDGET_KINDS, type WidgetIntent, type WidgetState } from "../../lib/widgets/types";

/**
 * A widget must never be able to take down the application.
 *
 * Placement validates every intent, but a board restored from a saved session,
 * a payload truncated mid-write, or a widget authored by an older build reaches
 * the renderer unchecked. Ten of the seventeen bodies used to throw on a
 * missing structural field, and with no error boundary in the tree a single
 * throw unmounted the whole app — a white screen mid-session with the lesson
 * gone. Both halves of that failure are asserted here.
 */

const render = (intent: unknown) =>
  renderToStaticMarkup(
    <WidgetSurface intent={intent as WidgetIntent} chalk="#e8e8ea" accent="#7dd3fc" readOnly />
  );

describe("widget rendering is total", () => {
  it("renders every widget kind given nothing but its discriminant", () => {
    for (const kind of WIDGET_KINDS) {
      expect(() => render({ kind }), `${kind} threw on a bare intent`).not.toThrow();
    }
  });

  it("survives payloads that are structurally present but empty", () => {
    const degenerate: unknown[] = [
      { kind: "roadmap", heading: "H", steps: [] },
      { kind: "animation", frames: [] },
      { kind: "comparison", columns: [], rows: [] },
      { kind: "hint", steps: [] },
      { kind: "annotation", marks: [] },
      { kind: "reveal", items: [] },
      { kind: "example", problem: "p", steps: [] },
      { kind: "mistake_check", lines: [] },
      { kind: "mastery_card", concept: "C", evidence: {} },
      { kind: "slider", label: "L", parameter: "h", min: NaN, max: 3, value: 1 },
      { kind: "comparison", columns: [{ id: "a", label: "A" }], rows: [{ id: "r", cells: [] }] },
    ];
    for (const intent of degenerate) {
      expect(() => render(intent), `${JSON.stringify(intent).slice(0, 60)} threw`).not.toThrow();
    }
  });

  it("tells the learner the widget is incomplete rather than rendering empty chrome", () => {
    // Silence is worse than an explanation: a blank card looks like the tutor
    // drew nothing, and the learner has no idea to ask for it again.
    const html = render({ kind: "animation", frames: [] });
    expect(html).toMatch(/no frames/);
    expect(html).toMatch(/place it again/i);
  });

  it("ignores an unknown widget kind from a newer build instead of throwing", () => {
    expect(() => render({ kind: "widget_from_the_future", title: "X" })).not.toThrow();
  });
});

describe("interacting with a widget can never throw", () => {
  // The reported crash was a CLICK, not a first paint: selecting an option or
  // pressing play sets state, and the RE-RENDER is what threw. Error boundaries
  // do not catch event handlers either, so both halves are covered — here for
  // the re-render, and by the try/catch around `emit` and `saveWidgetState` for
  // the handler itself.
  const STATES: WidgetState[] = [
    { selectedOptionId: "o1", submitted: true, correct: false },
    { selectedOptionId: "no-such-option", submitted: true },
    { animationProgress: 0 },
    { animationProgress: 0.5 },
    { animationProgress: 1 },
    { hintLevelOpened: 3 },
    { revealedIds: ["not-an-item"] },
    { sliderValue: 1e9 },
    { sliderValue: -1e9 },
    { responseText: "typed an answer", submitted: true },
  ];

  it("survives every interaction state on every widget kind", () => {
    for (const kind of WIDGET_KINDS) {
      for (const state of STATES) {
        expect(
          () =>
            renderToStaticMarkup(
              <WidgetSurface intent={{ kind } as WidgetIntent} state={state} chalk="#e8e8ea" accent="#7dd3fc" />
            ),
          `${kind} threw for state ${JSON.stringify(state)}`
        ).not.toThrow();
      }
    }
  });

  it("survives intents whose lists contain unusable entries", () => {
    // A truncated write or an older build can leave nulls inside an otherwise
    // present list. Bodies index into these and read fields off each entry.
    const ragged: unknown[] = [
      { kind: "roadmap", heading: "h", steps: [null] },
      { kind: "hint", steps: [null] },
      { kind: "reveal", items: [null] },
      { kind: "example", problem: "p", steps: [null] },
      { kind: "mistake_check", lines: [null] },
      { kind: "annotation", marks: [null] },
      { kind: "comparison", columns: [null, null] },
      { kind: "animation", frames: [null] },
      { kind: "animation", frames: [{ id: "f", caption: "c" }, undefined] },
      { kind: "question", format: "multiple_choice", prompt: "p", options: [null] },
      { kind: "slider", label: "L", parameter: "h", min: 0, max: 1, value: 0, readouts: [null] },
    ];
    for (const intent of ragged) {
      for (const state of STATES) {
        expect(
          () =>
            renderToStaticMarkup(
              <WidgetSurface intent={intent as WidgetIntent} state={state} chalk="#e8e8ea" accent="#7dd3fc" />
            ),
          `${JSON.stringify(intent).slice(0, 70)} threw`
        ).not.toThrow();
      }
    }
  });

  it("survives an animation whose motion path cannot be computed", () => {
    // This is the projectile-prediction widget from the report. AnimationBody
    // destructures motion.tDomain and evaluates two expressions; every one of
    // these shapes used to throw on the first render after a click.
    const frames = [{ id: "f", caption: "c" }];
    const broken: unknown[] = [
      { kind: "animation", frames, motion: {} },
      { kind: "animation", frames, motion: null },
      { kind: "animation", frames, motion: { tDomain: null, xExpression: "t", yExpression: "t" } },
      { kind: "animation", frames, motion: { tDomain: [1], xExpression: "t", yExpression: "t" } },
      { kind: "animation", frames, motion: { tDomain: [NaN, NaN], xExpression: "t", yExpression: "t" } },
      { kind: "animation", frames, motion: { tDomain: [0, 1], xExpression: "@@@", yExpression: "###" } },
      { kind: "animation", frames, motion: { tDomain: [0, 1] } },
    ];
    for (const intent of broken) {
      for (const state of STATES) {
        expect(
          () =>
            renderToStaticMarkup(
              <WidgetSurface intent={intent as WidgetIntent} state={state} chalk="#e8e8ea" accent="#7dd3fc" />
            ),
          `${JSON.stringify(intent).slice(0, 80)} threw`
        ).not.toThrow();
      }
    }
  });

  it("keeps a widget usable when only some list entries are unusable", () => {
    // Dropping the bad entry beats rejecting the widget: nine good steps out of
    // ten are still worth teaching with.
    const html = renderToStaticMarkup(
      <WidgetSurface
        intent={{ kind: "roadmap", heading: "Derivatives", steps: [null, { id: "s2", label: "The difference quotient" }] } as unknown as WidgetIntent}
        chalk="#e8e8ea"
        accent="#7dd3fc"
        readOnly
      />
    );
    expect(html).toContain("The difference quotient");
    expect(html).not.toMatch(/nothing to show/);
  });

  it("pads a comparison row that is shorter than its column count", () => {
    const html = renderToStaticMarkup(
      <WidgetSurface
        intent={{
          kind: "comparison",
          columns: [{ id: "a", title: "Secant" }, { id: "b", title: "Tangent" }],
          rows: [{ id: "r", label: "Touches", cells: ["two points"] }],
        } as unknown as WidgetIntent}
        chalk="#e8e8ea"
        accent="#7dd3fc"
        readOnly
      />
    );
    expect(html).toContain("two points");
    expect(html).toContain("Tangent");
  });
});

describe("error boundary containment", () => {
  // Containment itself needs a DOM to exercise (renderToStaticMarkup does not
  // run boundaries at all), so these assert the boundary's contract directly:
  // it enters the error state, and its fallback is actionable.
  it("renders a fallback that names the failure and offers a way forward", () => {
    const boundary = new ErrorBoundary({ label: "Concept Card widget", children: null });
    boundary.state = { error: new Error("boom") };
    const html = renderToStaticMarkup(<>{boundary.render()}</>);
    expect(html).toContain("Concept Card widget could not be displayed");
    expect(html).toMatch(/rest of your session is unaffected/i);
    expect(html).toMatch(/Try again/);
  });

  it("derives error state from a thrown error", () => {
    expect(ErrorBoundary.getDerivedStateFromError(new Error("x")).error).toBeInstanceOf(Error);
  });
});

describe("response affordance on exploration widgets", () => {
  /**
   * Slider, Animation, Hint and Annotation are watch-only by default. When the
   * agent authors a `respond` block they gain somewhere for the learner to
   * answer — which is what converts exploration into evidence the mastery loop
   * can assess.
   */
  const respond = {
    prompt: "What happens to the slope as h shrinks?",
    placeholder: "In your own words…",
    submitLabel: "Send",
  };

  const explorers: Record<string, unknown> = {
    slider: { kind: "slider", label: "Spacing h", parameter: "h", min: 0, max: 1, value: 0.5 },
    animation: { kind: "animation", frames: [{ id: "f1", caption: "The secant pivots" }] },
    hint: { kind: "hint", steps: [{ level: 1, label: "Nudge", body: "Look at the denominator." }] },
    annotation: { kind: "annotation", marks: [{ id: "m1", target: "h", note: "This does the work." }] },
  };

  for (const [kind, intent] of Object.entries(explorers)) {
    it(`renders no input on a ${kind} the agent did not attach one to`, () => {
      // A widget placed purely to illustrate must not grow a stray text box.
      const html = renderToStaticMarkup(
        <WidgetSurface intent={intent as WidgetIntent} chalk="#e8e8ea" accent="#7dd3fc" />
      );
      expect(html).not.toContain("<textarea");
      expect(html).not.toContain("Your turn");
    });

    it(`renders the agent's own prompt and labels on a ${kind}`, () => {
      const html = renderToStaticMarkup(
        <WidgetSurface intent={{ ...(intent as object), respond } as WidgetIntent} chalk="#e8e8ea" accent="#7dd3fc" />
      );
      expect(html).toContain("<textarea");
      // Fully agent-configured: the prompt, placeholder and button text are the
      // agent's, never a hardcoded default.
      expect(html).toContain("What happens to the slope as h shrinks?");
      expect(html).toContain("In your own words…");
      expect(html).toContain("Send");
    });
  }

  it("locks the input after submitting so an answer cannot be silently rewritten", () => {
    const html = renderToStaticMarkup(
      <WidgetSurface
        intent={{ ...(explorers.slider as object), respond } as WidgetIntent}
        state={{ responseText: "It flattens out", submitted: true }}
        chalk="#e8e8ea"
        accent="#7dd3fc"
      />
    );
    expect(html).toContain("It flattens out");
    expect(html).toMatch(/disabled/);
    expect(html).toMatch(/tutor will respond/);
  });

  it("uses the agent's acknowledgement when it wrote one", () => {
    const html = renderToStaticMarkup(
      <WidgetSurface
        intent={{ ...(explorers.hint as object), respond: { ...respond, acknowledgement: "Noted — checking that now." } } as WidgetIntent}
        state={{ submitted: true, responseText: "x" }}
        chalk="#e8e8ea"
        accent="#7dd3fc"
      />
    );
    expect(html).toContain("Noted — checking that now.");
  });

  it("keeps the widget's own content alongside the new input", () => {
    // The affordance is additive: it must not displace what the widget teaches.
    const html = renderToStaticMarkup(
      <WidgetSurface
        intent={{ ...(explorers.annotation as object), respond } as WidgetIntent}
        chalk="#e8e8ea"
        accent="#7dd3fc"
      />
    );
    expect(html).toContain("This does the work.");
    expect(html).toContain("<textarea");
  });

  it("hides the input in a read-only snapshot", () => {
    const html = renderToStaticMarkup(
      <WidgetSurface
        intent={{ ...(explorers.slider as object), respond } as WidgetIntent}
        chalk="#e8e8ea"
        accent="#7dd3fc"
        readOnly
      />
    );
    // Still visible for context, but not answerable from a Past Note.
    expect(html).toContain("What happens to the slope as h shrinks?");
    expect(html).toMatch(/disabled/);
  });
});
