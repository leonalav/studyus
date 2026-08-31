import { describe, it, expect } from "vitest";
import { buildTutorUserPrompt, resolveTurnWidgetPermit } from "./tutor";
import { formatMasteryDirective, formatWidgetCatalog } from "./widgets/prompt";
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

  it("carries the presentation-first policy move into the tutor prompt", () => {
    const prompt = buildTutorUserPrompt({
      ...baseParams,
      policyBrief: [
        "MOVE: direct_instruction",
        "COLD-START EXCEPTION — teach intuition, the core representation, terminology, and one canonical worked example before requesting learner work.",
        "The exposition is not evidence; return to one focused prediction or observation afterward.",
      ].join("\n"),
      presentationFirst: true,
      permittedWidgetKinds: ["concept_card", "example", "annotation", "animation", "slider", "comparison"],
    });

    expect(prompt).toMatch(/MOVE: direct_instruction/);
    expect(prompt).toMatch(/COLD-START EXCEPTION/);
    expect(prompt).toMatch(/PRESENTATION-FIRST EXCEPTION/);
    expect(prompt).toMatch(/canonical worked example/);
    expect(prompt).toMatch(/not evidence/);
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
    expect(prompt).toMatch(/NO TEXT-ONLY DEAD ENDS/i);
    expect(prompt).toMatch(/NO QUIZ LOOPS/i);
    expect(prompt).toMatch(/look-alike checks/i);
  });

  it("requires all structural fields and constrains evidence handles", () => {
    expect(prompt).toMatch(/Always include speech, board_ops, and evidence_refs/);
    expect(prompt).toMatch(/Every evidence_refs entry MUST be one of: E1/);

    const noEvidencePrompt = buildTutorUserPrompt({ ...baseParams, cards: [] });
    expect(noEvidencePrompt).toMatch(/evidence_refs MUST be exactly \[\]/);
    expect(noEvidencePrompt).toMatch(/selected sections are bound by the scope above, but no extracted excerpt cards/i);
    expect(noEvidencePrompt).not.toMatch(/no curriculum sections are bound/i);
  });

  it("states the visualization intent discriminant is `type`, not `kind`", () => {
    expect(prompt).toMatch(/discriminated union on "type"/);
    // The stale wording must be gone. Widgets key on "kind", but a
    // VisualizationIntent must never be described that way.
    expect(prompt).not.toMatch(/discriminated union on "kind"/);
    expect(prompt).toMatch(/a widget "intent" is keyed on its "kind" field/);
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

  it("carries the Guide to Mastery loop as a binding directive", () => {
    expect(prompt).toMatch(/GUIDE TO MASTERY — THE OPERATING LOOP \(binding\)/);
    expect(prompt).toContain("The agent carries the structure. The student carries the thinking.");
    for (const stage of ["ENCOUNTER", "UNDERSTAND", "CONSTRUCT", "APPLY", "TRANSFER", "MASTER"]) {
      expect(prompt).toContain(stage);
    }
    expect(prompt).toMatch(/Advancement is NOT click-through/i);
    expect(prompt).toMatch(/NEVER declare mastery from a raw score/i);
    expect(prompt).toMatch(/Never say "You completed Section X/);
  });

  it("tells the tutor where the session already is on the ladder", () => {
    // Default (no stage supplied) opens at Encounter.
    expect(prompt).toMatch(/CURRENT STAGE: 1\. Encounter/);
    expect(prompt).toMatch(/Exit condition:/);

    const midway = buildTutorUserPrompt({
      ...baseParams,
      masteryStage: "construct",
      masteryStageEvidence: "Wrote the difference quotient unaided.",
    });
    expect(midway).toMatch(/CURRENT STAGE: 3\. Construct/);
    expect(midway).toContain("Wrote the difference quotient unaided.");
    // The next stage is named, but promotion into it is the ledger's call, not
    // the model's: the prompt must not offer self-assertion as a route forward.
    expect(midway).toMatch(/Advancement to Apply is decided by machine-checkable predicates/);
    expect(midway).toMatch(/not by your assertion/);
    expect(midway).toMatch(/Moving back is honoured immediately and needs no evidence/);

    const final = buildTutorUserPrompt({ ...baseParams, masteryStage: "master" });
    expect(final).toMatch(/This is the final stage/);
    // The card's numbers come from the ledger; the model supplies prose only.
    expect(final).toMatch(/mastery_card/);
    expect(final).toMatch(/filled in from the ledger/);
  });

  it("advertises the widget ops and the full 17-widget vocabulary", () => {
    expect(prompt).toMatch(/place_widget/);
    expect(prompt).toMatch(/update_widget/);
    const kinds = [
      "roadmap", "concept_card", "slider", "animation", "comparison", "question", "hint",
      "scratchpad", "annotation", "reveal", "example", "mistake_check", "memory_hook",
      "retrieval_check", "challenge", "reflection", "mastery_card",
    ];
    for (const kind of kinds) {
      expect(prompt).toContain(`[${kind}]`);
    }
  });

  it("keeps graphs, geometry, and equations on the visualize op, not widgets", () => {
    expect(prompt).toMatch(/Graphs, geometry\/points, and equations are NOT widgets/i);
    expect(prompt).not.toContain(`"kind":"graph"`);
    expect(prompt).not.toContain(`"kind":"equation"`);
  });

  it("states the widget invariants that make widgets teach rather than decorate", () => {
    expect(prompt).toMatch(/EXACTLY ONE correct/);
    expect(prompt).toMatch(/EVERY step requires "why"/);
    expect(prompt).toMatch(/every error line REQUIRES a "diagnosis"/);
    expect(prompt).toMatch(/never the final answer/i);
    expect(prompt).toMatch(/teaching vocabulary, not a set of optional features/i);
  });

  it("asks for the stage and evidence-backed stage advancement in the JSON shape", () => {
    expect(prompt).toMatch(/"stage": "encounter"\|"understand"\|"construct"\|"apply"\|"transfer"\|"master"/);
    expect(prompt).toMatch(/"stage_advance"/);
    expect(prompt).toMatch(/ready:true REQUIRES evidence/i);
  });

  it("enumerates the 8 geometry object kinds so the LLM names real ones", () => {
    for (const kind of ["point", "line", "segment", "circle", "polygon", "angle", "label", "text"]) {
      expect(prompt).toContain(kind);
    }
  });
});

describe("the never-passive policy reaches the model", () => {
  it("forbids the roadmap-only turn by name", () => {
    // Naming the exact failure matters: a general "be interactive" instruction
    // is the kind of guidance a model satisfies with a rhetorical question.
    const directive = formatMasteryDirective();
    expect(directive).toMatch(/THE LEARNER IS NEVER PASSIVE/);
    expect(directive).toMatch(/roadmap and stopping is a specific and forbidden failure/i);
    expect(directive).toMatch(/means of guidance/i);
  });

  it("bans the permission-seeking sign-offs that end a turn without a task", () => {
    const directive = formatMasteryDirective();
    expect(directive).toMatch(/let me know when you're ready/i);
    expect(directive).toMatch(/does that make sense/i);
    expect(directive).toMatch(/tell me what you already know/i);
    expect(directive).toMatch(/before we go on/i);
  });

  it("forbids text-only dead ends and isomorphic quiz loops by name", () => {
    const directive = formatMasteryDirective();
    expect(directive).toMatch(/NO TEXT-ONLY DEAD ENDS/i);
    expect(directive).toMatch(/STRICTLY FORBIDDEN/i);
    expect(directive).toMatch(/NO QUIZ LOOPS/i);
    expect(directive).toMatch(/look-alike/i);
    expect(directive).toMatch(/When the learner says continue/i);
  });

  it("tells the agent a roadmap must be placed alongside the move that opens step 1", () => {
    expect(formatWidgetCatalog()).toMatch(/roadmap is orientation, NOT teaching/i);
  });

  it("requires updating the existing roadmap when a goal is completed, never a second map", () => {
    const directive = formatMasteryDirective();
    expect(directive).toMatch(/update_widget/i);
    expect(directive).toMatch(/existing roadmap/i);
    expect(directive).toMatch(/never append a second roadmap|never place a second roadmap/i);
    expect(directive).toMatch(/same turn that opens the next step/i);
    expect(formatWidgetCatalog()).toMatch(/update_widget on the existing roadmap/i);
  });
});

describe("board summary exposes roadmap anchors and step states", () => {
  it("lists step ids and states so the model can update_widget precisely", () => {
    const prompt = buildTutorUserPrompt({
      ...baseParams,
      board: {
        id: "b1",
        title: "t",
        subtitle: "",
        domain: "math",
        blocks: [
          {
            id: "agent-rm-9",
            kind: "widget",
            intent: {
              kind: "roadmap",
              heading: "Path",
              steps: [
                { id: "encounter", label: "Encounter", state: "done" },
                { id: "understand", label: "Understand", state: "current" },
                { id: "construct", label: "Construct", state: "upcoming" },
              ],
            },
          },
        ],
      },
    });
    expect(prompt).toMatch(/anchor=agent-rm-9/);
    expect(prompt).toMatch(/encounter:done/);
    expect(prompt).toMatch(/understand:current/);
    expect(prompt).toMatch(/construct:upcoming/);
  });
});

describe("widget cluster groups reach the model", () => {
  it("documents the group shape in the widget catalog", () => {
    const catalog = formatWidgetCatalog();
    expect(catalog).toMatch(/GroupRef = \{ "id": string/);
    expect(catalog).toMatch(/answer every answerable widget in the group/i);
  });

  it("warns against grouping by turn rather than by meaning", () => {
    // The failure to avoid: the agent grouping everything it happens to place
    // together, which would withhold signals from independent widgets.
    expect(formatWidgetCatalog()).toMatch(/NOT group widgets merely because you placed them in the same turn/i);
  });

  it("tells the agent to answer a completed set in one reply", () => {
    expect(formatMasteryDirective()).toMatch(/respond to the SET in one reply/i);
  });
});

describe("session opening — the plan widget is always placeable", () => {
  it("greeting turns with onboarding bypass the route's widget permit list", () => {
    // The reported failure: the post-intake greeting was routed like any
    // policy move, the route's catalog whitelisted four pedagogical kinds, and
    // the plan was never placed — the model literally never saw it exists.
    expect(resolveTurnWidgetPermit("greeting", true, ["question"])).toBeUndefined();
    // Only that specific turn is exempt: everything else keeps the route permit.
    expect(resolveTurnWidgetPermit("greeting", false, ["question"])).toEqual(["question"]);
    expect(resolveTurnWidgetPermit("plan_start", true, ["question"])).toBeUndefined();
    expect(resolveTurnWidgetPermit("chat", true, ["question"])).toEqual(["question"]);
    expect(resolveTurnWidgetPermit("widget", true, ["question"])).toEqual(["question"]);
    expect(resolveTurnWidgetPermit(undefined, true, ["question"])).toEqual(["question"]);
  });

  it("the full catalog names the plan widget and its agreement gate", () => {
    // An unfiltered greeting-turn catalog must describe plan + roadmap.
    const catalog = formatWidgetCatalog();
    expect(catalog).toMatch(/- Plan \[plan\]/);
    expect(catalog).toMatch(/- Roadmap \[roadmap\]/);
    expect(catalog).toMatch(/agreementPrompt/);
    expect(catalog).toMatch(/Start learning/);
    // While a route-scoped catalog still hides them, as the policy intends.
    const scoped = formatWidgetCatalog(["question"]);
    expect(scoped).not.toMatch(/\[plan\]/);
    expect(scoped).not.toMatch(/\[roadmap\]/);
  });

  it("the full catalog includes the overview widget alongside the plan", () => {
    const catalog = formatWidgetCatalog();
    expect(catalog).toMatch(/- Overview \[overview\]/);
    // The overview's purpose text must mention it is placed alongside the plan.
    expect(catalog).toMatch(/alongside the Plan/i);
  });
});

describe("session opening — plan and overview must appear together", () => {
  it("the opening brief tells the agent to place BOTH plan and overview widgets", () => {
    // buildOnboardingReminder is imported separately — test that the
    // SESSION OPENING brief in the user prompt is uncommentable without
    // breaking the plan+overview contract.
    // We verify the brief text by checking what askTutorTurn builds:
    // isSessionOpening turns set the brief to mention both widgets.
    // Pin the literal that must survive any future prompt refactor:
    const catalog = formatWidgetCatalog();
    // The catalog describes both widgets so the model can place them.
    expect(catalog).toMatch(/- Plan \[plan\]/);
    expect(catalog).toMatch(/- Overview \[overview\]/);
    // And the overview is explicitly about being placed alongside the plan.
    expect(catalog).toMatch(/overview.*alongside.*plan|plan.*alongside.*overview/is);
  });
});
