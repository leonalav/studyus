import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AssessmentFigure, ASSESSMENT_FIGURE_CONTAINER_CLASS } from "./AssessmentFigure";
import { formatAttemptDuration, QuestionPrompt, SubmitExamButton, SubmittedView } from "./TestRunner";

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

  it("formats the persisted completion duration without a running clock", () => {
    expect(formatAttemptDuration(125)).toBe("02:05");
    expect(formatAttemptDuration(3725)).toBe("01:02:05");
    expect(formatAttemptDuration(null)).toBe("—");
  });

  it("greys and disables the submit button while showing its loading wheel", () => {
    const idle = renderToStaticMarkup(<SubmitExamButton submitting={false} onSubmit={() => undefined} />);
    const submitting = renderToStaticMarkup(<SubmitExamButton submitting onSubmit={() => undefined} />);

    expect(idle).toContain("Submit exam");
    expect(idle).not.toContain("disabled");
    expect(submitting).toContain("Submitting...");
    expect(submitting).toContain("disabled");
    expect(submitting).toContain('aria-busy="true"');
    expect(submitting).toContain("animate-spin");
    expect(submitting).toContain("bg-white/[0.12]");
  });

  it("keeps the completed receipt scrollable with a persistent exit and human grading state", () => {
    const html = renderToStaticMarkup(
      <SubmittedView
        result={{
          attemptId: "attempt-1",
          formId: "form-1",
          status: "grading_blocked",
          aggregateScore: 1,
          totalPossibleMarks: 3,
          gradingStatus: "grading_blocked",
          startedAt: "2026-08-16T12:00:00.000Z",
          completedAt: "2026-08-16T12:02:05.000Z",
          durationSeconds: 125,
          questions: [
            {
              itemId: "item-1",
              stem: "First checked answer",
              maximumMarks: 1,
              awardedMarks: 1,
              committedResponse: "A",
              gradingStatus: "graded",
              criteria: [],
            },
            {
              itemId: "item-2",
              stem: "Second answer held for review",
              maximumMarks: 2,
              awardedMarks: 0,
              committedResponse: "My derivation",
              gradingStatus: "grading_blocked",
              criteria: [],
            },
          ],
        }}
        onRetake={() => undefined}
        onExit={() => undefined}
      />
    );

    expect(html).toContain("h-screen w-full overflow-y-auto");
    expect(html).toContain("Back to Available tests");
    expect(html).toContain("02:05");
    expect(html).toContain("First checked answer");
    expect(html).toContain("Second answer held for review");
    expect(html).toContain("Needs review");
    expect(html).not.toContain("Grading_blocked");
  });
});
