import { describe, it, expect } from "vitest";
import { buildTutorUserPrompt } from "./tutor";
import type { Domain } from "../data/boards";

/**
 * Regression guard for the original incident: the tutor was asked to "draw a
 * circle with center O and two points A & B" and emitted a planet/ellipse
 * diagram. Root cause was two-fold — (1) the per-turn prompt told the LLM the
 * wrong intent-discriminant field name and wrong geometry-object field names,
 * so the validator rejected every well-intentioned geometry intent; and (2)
 * the only fallbacks were preset enum shapes. This test pins the prompt to the
 * CORRECT protocol so the LLM's emitted intents survive validation and reach a
 * real JSXGraph renderer.
 */
const baseParams = {
  domain: "math" as Domain,
  sessionTitle: "Circle geometry",
  assistancePolicy: "guided",
  hintLevel: 0,
  awaitingFirstAttempt: false,
  learnerSummary: "",
  cards: [{ handle: "E1", section: "§1.2" }],
  history: [],
  learnerMessage: "draw a circle with center O and two points A and B",
  attachmentsNote: "",
};

describe("buildTutorUserPrompt — visualization protocol (regression: circle-vs-planet)", () => {
  const prompt = buildTutorUserPrompt(baseParams);

  it("advertises the `visualize` op as the single drawing tool", () => {
    expect(prompt).toMatch(/visualize/);
    expect(prompt).not.toMatch(/plot_2d|plot_3d|draw_diagram/);
  });

  it("documents notebook-style edit operations with anchors and diff-style revision", () => {
    expect(prompt).toMatch(/targetAnchor/);
    expect(prompt).toMatch(/targetMatchText/);
    expect(prompt).toMatch(/revise_text/);
    expect(prompt).toMatch(/stable anchor/i);
  });

  it("tells the tutor to draw on explicit visualization requests instead of asking questions", () => {
    expect(prompt).toMatch(/comply first with a best-effort board rendering/i);
    expect(prompt).toMatch(/confirm what you drew instead of asking a question/i);
  });

  it("requires all structural fields and constrains evidence handles", () => {
    expect(prompt).toMatch(/Always include speech, board_ops, and evidence_refs/);
    expect(prompt).toMatch(/Every evidence_refs entry MUST be one of: E1/);

    const noEvidencePrompt = buildTutorUserPrompt({ ...baseParams, cards: [] });
    expect(noEvidencePrompt).toMatch(/evidence_refs MUST be exactly \[\]/);
  });

  it("states the intent discriminant is `type`, not `kind`", () => {
    expect(prompt).toMatch(/discriminated union on "type"/);
    // The stale wording must be gone.
    expect(prompt).not.toMatch(/discriminated union on "kind"/);
  });

  it("shows a geometry example using the correct intent/object field names", () => {
    // Intent-level byte must say "type":"geometry", never "kind":"geometry".
    expect(prompt).toMatch(/"type":\s*"geometry"/);
    expect(prompt).not.toMatch(/"kind":\s*"geometry"/);

    // Geometry objects discriminate on "kind" and use `at` (not `coords`),
    // `through` (not `radiusPoint`).
    expect(prompt).toMatch(/"kind":\s*"point"/);
    expect(prompt).toMatch(/"at":\s*\[0,\s*0\]/);
    expect(prompt).toMatch(/"through":\s*"A"/);
    expect(prompt).not.toMatch(/"coords"/);
    expect(prompt).not.toMatch(/"radiusPoint"/);
  });

  it("shows function and equation examples keyed on `type`", () => {
    expect(prompt).toMatch(/"type":\s*"function"/);
    expect(prompt).toMatch(/"type":\s*"equation"/);
    expect(prompt).not.toMatch(/"kind":\s*"function"/);
    expect(prompt).not.toMatch(/"kind":\s*"equation"/);
  });

  it("ennumerates the 8 geometry object kinds so the LLM names real ones", () => {
    for (const kind of ["point", "line", "segment", "circle", "polygon", "angle", "label", "text"]) {
      expect(prompt).toContain(kind);
    }
  });
});
