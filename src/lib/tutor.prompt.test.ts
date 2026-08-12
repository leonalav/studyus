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
  curriculumScope: [{
    nodeId: "section-1.2",
    section: "1.2 Circle geometry",
    startPage: 12,
    endPage: 18,
    evidencePages: [12, 14, 18],
  }],
  cards: [{ handle: "E1", section: "1.2 Circle geometry · selected pp.12–18 · evidence p.12" }],
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

  it("documents conservative, logged thread spawning", () => {
    expect(prompt).toMatch(/spawn_thread/);
    expect(prompt).toMatch(/substantial, separable investigation/i);
    expect(prompt).toMatch(/never spawn a thread for a routine answer/i);
    expect(prompt).toMatch(/at most one per turn/i);
    expect(prompt).toMatch(/creates a logged child board in Threads/i);
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
    expect(noEvidencePrompt).toMatch(/selected sections are bound by the scope above, but no extracted excerpt cards/i);
    expect(noEvidencePrompt).not.toMatch(/no curriculum sections are bound/i);
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

  it("requires accessible intuition followed by rigorous detail", () => {
    expect(prompt).toMatch(/simple plain-language intuition first/i);
    expect(prompt).toMatch(/precise terminology, assumptions, rigorous reasoning/i);
    expect(prompt).toMatch(/define jargon/i);
    expect(prompt).toMatch(/connect formal details back to the intuitive idea/i);
  });

  it("uses board tools only after a pedagogical-necessity decision", () => {
    expect(prompt).toMatch(/First decide whether changing the board is pedagogically necessary for this exact turn/i);
    expect(prompt).toMatch(/greetings, thanks, acknowledgements, social chat, navigation questions/i);
    expect(prompt).toMatch(/MUST return board_ops exactly \[\]/i);
    expect(prompt).toMatch(/equations, function graphs, data charts, or domain-faithful diagrams\/scientific figures/i);
    expect(prompt).toMatch(/never add decorative, redundant, irrelevant, or semantically misleading visuals/i);
    expect(prompt).toMatch(/obey the enabled tool permissions/i);
  });

  it("carries the ordered curriculum scope, exact pages, and evidence coverage", () => {
    expect(prompt).toMatch(/SELECTED CURRICULUM SCOPE — this sequence and these page ranges are binding/i);
    expect(prompt).toContain("1. 1.2 Circle geometry — pages 12–18; transcribed evidence supplied from pages 12, 14, 18");
    expect(prompt).toContain("selected pp.12–18 · evidence p.12");
    expect(prompt).toMatch(/Treat the selected scope as the core syllabus/i);
  });

  it("requires concrete curriculum-led teaching and honest handling of missing evidence", () => {
    expect(prompt).toMatch(/state its learner-facing objective/i);
    expect(prompt).toMatch(/prerequisites/i);
    expect(prompt).toMatch(/worked example/i);
    expect(prompt).toMatch(/targeted remediation/i);
    expect(prompt).toMatch(/mastery criterion/i);
    expect(prompt).toMatch(/Do not pretend missing pages or facts were present/i);
    expect(prompt).toMatch(/OPTIONAL ENRICHMENT/i);
  });

  it("enumerates the 8 geometry object kinds so the LLM names real ones", () => {
    for (const kind of ["point", "line", "segment", "circle", "polygon", "angle", "label", "text"]) {
      expect(prompt).toContain(kind);
    }
  });
});
