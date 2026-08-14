import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { WidgetSurface } from "./WidgetSurface";
import { ErrorBoundary } from "../ErrorBoundary";
import { WIDGET_KINDS, type WidgetIntent } from "../../lib/widgets/types";

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
