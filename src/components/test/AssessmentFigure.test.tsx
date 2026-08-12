import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AssessmentFigure, ASSESSMENT_FIGURE_CONTAINER_CLASS } from "./AssessmentFigure";
import { QuestionPrompt } from "./TestRunner";

vi.mock("../board/VisualizationSurface", () => ({
  VisualizationSurface: ({ intent, readOnly }: { intent: { type: string }; readOnly?: boolean }) => (
    <canvas data-rendered-intent={intent.type} data-read-only={readOnly ? "true" : "false"} />
  ),
}));

const equationFigure = {
  type: "equation" as const,
  latex: "F = ma",
  caption: "Newton's second law",
  variables: [
    { symbol: "F", label: "force", unit: "N" },
    { symbol: "m", label: "mass", unit: "kg" },
    { symbol: "a", label: "acceleration", unit: "m/s^2" },
  ],
};

describe("AssessmentFigure", () => {
  it("routes a valid semantic intent through the shared renderer inside bounded, read-only markup", () => {
    const html = renderToStaticMarkup(<AssessmentFigure intent={equationFigure} />);

    expect(html).toContain('data-assessment-figure="equation"');
    expect(html).toContain('data-rendered-intent="equation"');
    expect(html).toContain("Newton&#x27;s second law — assessment visualization");
    expect(html).toContain("overflow-x-auto");
    expect(html).toContain('data-read-only="true"');
    expect(html).not.toContain("pointer-events-none");
    expect(html).toContain("[&amp;_canvas]:max-w-full");
    expect(ASSESSMENT_FIGURE_CONTAINER_CLASS).toContain("max-w-full");
    expect(ASSESSMENT_FIGURE_CONTAINER_CLASS).toContain("overflow-hidden");
    expect(ASSESSMENT_FIGURE_CONTAINER_CLASS).toContain("[contain:layout_paint]");
  });

  it("fails closed instead of mounting the renderer for an invalid runtime specification", () => {
    const html = renderToStaticMarkup(
      <AssessmentFigure intent={{ type: "diagram", arbitraryHtml: "<script />" } as never} />
    );

    expect(html).toContain("Visualization unavailable");
    expect(html).not.toContain("data-rendered-intent");
  });

  it("mounts the stored figure directly beneath the question stem", () => {
    const html = renderToStaticMarkup(
      <QuestionPrompt stem="Use the shown equation to determine the force." figure={equationFigure} />
    );

    expect(html).toContain("Use the shown equation to determine the force.");
    expect(html).toContain('data-assessment-figure="equation"');
    expect(html.indexOf("determine the force")).toBeLessThan(html.indexOf("data-assessment-figure"));
  });
});
