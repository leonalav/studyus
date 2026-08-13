import { describe, it, expect } from "vitest";
import { boardToMarkdown, type BoardDoc } from "./boards";
import type { WidgetIntent, WidgetState } from "../lib/widgets/types";

/**
 * Widgets must survive export.
 *
 * The board is the learner's notebook, and the markdown export is what they
 * keep. A widget that exports as a bare "[Question]" placeholder has thrown
 * away the teaching content and the learner's own answer, which is exactly the
 * mockup behaviour this system replaced.
 */

const board = (intent: WidgetIntent, state?: WidgetState): BoardDoc => ({
  id: "b1",
  title: "Derivatives",
  subtitle: "",
  domain: "math",
  blocks: [{ id: "w1", kind: "widget", intent, state }],
});

describe("boardToMarkdown — widgets", () => {
  it("exports a roadmap with its progress and current step", () => {
    const md = boardToMarkdown(board({
      kind: "roadmap",
      heading: "8.1 Derivatives",
      steps: [
        { id: "s1", label: "What a derivative measures", state: "done" },
        { id: "s2", label: "The difference quotient", state: "current" },
        { id: "s3", label: "Differentiating by rule", state: "upcoming" },
      ],
    }));
    expect(md).toContain("8.1 Derivatives");
    expect(md).toContain("- [x] What a derivative measures");
    expect(md).toContain("← current");
    expect(md).toContain("Differentiating by rule");
  });

  it("exports a concept card's definition and facets", () => {
    const md = boardToMarkdown(board({
      kind: "concept_card",
      term: "Derivative",
      definition: "The instantaneous rate of change at a point.",
      definitionLatex: "f'(x)",
      facets: ["Slope of the tangent"],
    }));
    expect(md).toContain("**Derivative** — The instantaneous rate of change at a point.");
    expect(md).toContain("f'(x)");
    expect(md).toContain("- Slope of the tangent");
  });

  it("exports a comparison as a real table", () => {
    const md = boardToMarkdown(board({
      kind: "comparison",
      columns: [{ id: "a", title: "Average" }, { id: "b", title: "Instantaneous" }],
      rows: [{ id: "r1", label: "Geometry", cells: ["Secant", "Tangent"] }],
      takeaway: "One is a limit of the other.",
    }));
    expect(md).toContain("| | Average | Instantaneous |");
    expect(md).toContain("| Geometry | Secant | Tangent |");
    expect(md).toContain("One is a limit of the other.");
  });

  it("exports a worked example with the reason for every step", () => {
    const md = boardToMarkdown(board({
      kind: "example",
      problem: "Differentiate x^2",
      steps: [
        { id: "s1", expression: "(x+h)^2 - x^2 over h", why: "Set up the difference quotient." },
        { id: "s2", expression: "2x + h", why: "Expand, cancel, divide by h." },
      ],
    }));
    expect(md).toContain("Set up the difference quotient.");
    expect(md).toContain("Expand, cancel, divide by h.");
  });

  it("carries the learner's own answer into the export", () => {
    const md = boardToMarkdown(board(
      {
        kind: "question",
        prompt: "What does f'(x) measure?",
        format: "short_answer",
        acceptedAnswers: ["the slope of the tangent"],
      },
      { responseText: "how fast the output changes at one instant", submitted: true }
    ));
    expect(md).toContain("What does f'(x) measure?");
    expect(md).toContain("how fast the output changes at one instant");
  });

  it("exports a slider at the value the learner left it on", () => {
    const md = boardToMarkdown(board(
      { kind: "slider", label: "Spacing h", parameter: "h", min: 0, max: 2, value: 1 },
      { sliderValue: 0.25 }
    ));
    expect(md).toContain("0.25");
  });

  it("never exports a widget as a bare placeholder", () => {
    const intents: WidgetIntent[] = [
      { kind: "memory_hook", hook: "Derivative = slope of the tangent." },
      { kind: "challenge", prompt: "Find the growth rate at t = 2." },
      { kind: "reflection", prompt: "Explain why we need the limit." },
      {
        kind: "mastery_card",
        concept: "Derivatives",
        evidence: { recall: 90, understanding: 88, procedure: 92, transfer: 70, independence: 86 },
        watch: ["Transfer is still shaky"],
      },
    ];

    for (const intent of intents) {
      const md = boardToMarkdown(board(intent)).trim();
      // More than just the bracketed label line.
      expect(md.split("\n").filter((line) => line.trim()).length).toBeGreaterThan(1);
    }

    expect(boardToMarkdown(board({ kind: "memory_hook", hook: "Derivative = slope of the tangent." })))
      .toContain("Derivative = slope of the tangent.");
    expect(boardToMarkdown(board({
      kind: "mastery_card",
      concept: "Derivatives",
      evidence: { recall: 90, understanding: 88, procedure: 92, transfer: 70, independence: 86 },
      watch: ["Transfer is still shaky"],
    }))).toContain("Transfer is still shaky");
  });
});
