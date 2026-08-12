import { afterEach, describe, expect, it, vi } from "vitest";
import type { SqlValue } from "sql.js";
import { getDb } from "../db/database";
import { callStructuredAgent, type ResolvedRoleEndpoint } from "./agentRuntime";
import { defaultCapabilities } from "./llm";
import { getAttemptForTaking, getAttemptResult } from "./assessment";
import {
  BLOOM_STEM_COMMANDS,
  DIFFICULTY_PROFILES,
  buildGenerationUserPrompt,
  createAssessmentBlueprint,
  generateAssessment,
  normalizeGenerationRequest,
  persistGeneratedForm,
  validateGeneratedItems,
  type EvidenceCard,
  type GeneratedItem,
  type GenerationRequest,
  type ItemBlueprint,
  type RigorLevel,
} from "./generator";

const cards: EvidenceCard[] = [
  {
    ref: "E1",
    nodeId: "node-a",
    nodeTitle: "Motion",
    sectionNumber: "1.1",
    page: 4,
    excerptHash: "hash-a",
    text: "Velocity is the rate of change of displacement.",
  },
  {
    ref: "E2",
    nodeId: "node-b",
    nodeTitle: "Forces",
    sectionNumber: "1.2",
    page: 9,
    excerptHash: "hash-b",
    text: "The net force equals mass multiplied by acceleration.",
  },
];

function request(overrides: Partial<GenerationRequest> = {}): GenerationRequest {
  return {
    subject: "physics",
    format: "mixed",
    count: 6,
    rigor: "challenging",
    nodeIds: ["node-a", "node-b"],
    sourceName: "Physics.pdf",
    ...overrides,
  };
}

function modelItem(slot: ItemBlueprint): Record<string, unknown> {
  const base = {
    item_type: slot.itemType,
    stem: `Question ${slot.ordinal}: ${BLOOM_STEM_COMMANDS[slot.bloomTarget][0]} the assigned curriculum evidence.`,
    maximum_marks: slot.maximumMarks,
    bloom_target: slot.bloomTarget,
    learning_objective: `Demonstrate ${slot.bloomTarget} reasoning.`,
    curriculum_node: slot.curriculumNode,
    evidence_refs: [slot.requiredEvidenceRef],
  };

  if (slot.itemType === "mcq") {
    return {
      ...base,
      options: Array.from({ length: slot.mcqOptionCount ?? 3 }, (_, index) => ({
        id: String.fromCharCode(97 + index),
        text: `Option ${index + 1}`,
        correct: index === 0,
        misconception: index === 0 ? null : `Misconception ${index}`,
      })),
    };
  }

  if (slot.itemType === "numeric") {
    return {
      ...base,
      accepted: [{ value: "12.5", absolute_tolerance: "0.01", relative_tolerance: "0" }],
      unit: "m/s",
    };
  }

  const criterionCount = slot.proofCriterionCount ?? 2;
  const baseMark = Math.floor(slot.maximumMarks / criterionCount);
  return {
    ...base,
    criteria: Array.from({ length: criterionCount }, (_, index) => ({
      id: `c${index + 1}`,
      description: `Observable reasoning criterion ${index + 1}`,
      max_mark:
        index === criterionCount - 1
          ? slot.maximumMarks - baseMark * (criterionCount - 1)
          : baseMark,
    })),
    reference_solution: "A complete evaluator-only worked solution grounded in the excerpt.",
    response_requirement: "Show and justify each major reasoning step.",
  };
}

function validateBlueprint(blueprint: ItemBlueprint[]) {
  const scopedCards = cards.filter((card) => blueprint.some((slot) => slot.requiredEvidenceRef === card.ref));
  return validateGeneratedItems(
    { items: blueprint.map(modelItem) },
    {
      blueprint,
      evidenceByRef: new Map(scopedCards.map((card) => [card.ref, card])),
    }
  );
}

const persistedIds: { formId: string; attemptId: string }[] = [];
const persistedSourceIds: string[] = [];
let previousGenerationBinding: SqlValue[] | null | undefined;

afterEach(async () => {
  vi.unstubAllGlobals();
  const db = await getDb();
  for (const { formId, attemptId } of persistedIds.splice(0)) {
    db.run("DELETE FROM item_evidence WHERE item_id IN (SELECT id FROM assessment_items WHERE form_id = ?);", [formId]);
    db.run("DELETE FROM attempt_responses WHERE attempt_id = ?;", [attemptId]);
    db.run("DELETE FROM assessment_attempts WHERE id = ?;", [attemptId]);
    db.run("DELETE FROM assessment_items WHERE form_id = ?;", [formId]);
    db.run("DELETE FROM assessment_forms WHERE id = ?;", [formId]);
  }
  for (const sourceId of persistedSourceIds.splice(0)) {
    db.run("DELETE FROM curriculum_chunks WHERE node_id IN (SELECT id FROM curriculum_nodes WHERE source_id = ?);", [sourceId]);
    db.run("DELETE FROM curriculum_nodes WHERE source_id = ?;", [sourceId]);
    db.run("DELETE FROM curriculum_sources WHERE id = ?;", [sourceId]);
  }
  if (previousGenerationBinding !== undefined) {
    db.run("DELETE FROM model_bindings WHERE role = 'generation';");
    if (previousGenerationBinding) {
      db.run(
        `INSERT INTO model_bindings
           (role, provider, base_url, model_id, capabilities_json, overrides_json, fallback_model)
         VALUES (?, ?, ?, ?, ?, ?, ?);`,
        previousGenerationBinding
      );
    }
    previousGenerationBinding = undefined;
  }
  db.run("DELETE FROM agent_calls WHERE model_id = 'generation-e2e-model';");
});

describe("generation request contract", () => {
  it("honors the public format limits instead of silently clamping to 30", () => {
    expect(normalizeGenerationRequest(request({ format: "mcq", count: 50 })).count).toBe(50);
    expect(() => normalizeGenerationRequest(request({ format: "mcq", count: 51 }))).toThrow(/between 1 and 50/i);
    expect(() => normalizeGenerationRequest(request({ format: "proof", count: 16 }))).toThrow(/between 1 and 15/i);
    expect(() => normalizeGenerationRequest(request({ format: "mixed", count: 1 }))).toThrow(/between 2 and 32/i);
    expect(() => normalizeGenerationRequest(request({ count: 3.5 }))).toThrow(/whole number/i);
  });

  it("deduplicates curriculum selections but rejects an empty scope", () => {
    expect(normalizeGenerationRequest(request({ nodeIds: ["node-a", "node-a", " node-b "] })).nodeIds)
      .toEqual(["node-a", "node-b"]);
    expect(() => normalizeGenerationRequest(request({ nodeIds: [] }))).toThrow(/select at least one/i);
  });
});

describe("difficulty and format blueprints", () => {
  it("makes MCQ, proof, and mixed formats exact and deterministic", () => {
    expect(createAssessmentBlueprint(request({ format: "mcq", count: 4 }), cards).map((slot) => slot.itemType))
      .toEqual(["mcq", "mcq", "mcq", "mcq"]);
    expect(createAssessmentBlueprint(request({ format: "proof", count: 3 }), cards).map((slot) => slot.itemType))
      .toEqual(["proof", "proof", "proof"]);
    expect(createAssessmentBlueprint(request({ format: "mixed", count: 6 }), cards).map((slot) => slot.itemType))
      .toEqual(["mcq", "proof", "numeric", "mcq", "proof", "numeric"]);
  });

  it("assigns materially different Bloom bands, marks, structures, and assistance policies", () => {
    const expectedPolicies = ["full_hints", "limited_hints", "no_hints"];
    const rigors: RigorLevel[] = ["casual", "challenging", "rigorous"];

    const plans = rigors.map((rigor) => createAssessmentBlueprint(request({ rigor }), cards));
    plans.forEach((plan, index) => {
      const profile = DIFFICULTY_PROFILES[rigors[index]];
      expect(plan.every((slot) => profile.allowedBloomTargets.includes(slot.bloomTarget))).toBe(true);
      expect(plan.find((slot) => slot.itemType === "mcq")?.maximumMarks).toBe(profile.maximumMarks.mcq);
      expect(plan.find((slot) => slot.itemType === "mcq")?.mcqOptionCount).toBe(profile.mcqOptionCount);
      expect(plan.find((slot) => slot.itemType === "proof")?.proofCriterionCount).toBe(profile.proofCriterionCount);
      expect(profile.assistancePolicy).toBe(expectedPolicies[index]);
    });

    expect(plans[0].map((slot) => slot.maximumMarks)).not.toEqual(plans[2].map((slot) => slot.maximumMarks));
    expect(new Set(plans[0].map((slot) => slot.bloomTarget))).not.toEqual(new Set(plans[2].map((slot) => slot.bloomTarget)));
  });

  it("balances item assignments across selected curriculum nodes and evidence", () => {
    const plan = createAssessmentBlueprint(request({ count: 4 }), cards);
    expect(plan.map((slot) => slot.curriculumNode)).toEqual(["node-a", "node-b", "node-a", "node-b"]);
    expect(plan.map((slot) => slot.requiredEvidenceRef)).toEqual(["E1", "E2", "E1", "E2"]);
  });
});

describe("generated item semantic validation", () => {
  it("accepts a batch that matches every blueprint and grounding rule", () => {
    const blueprint = createAssessmentBlueprint(request(), cards);
    const result = validateBlueprint(blueprint);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.map((item) => item.ordinal)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("accepts a validated semantic figure but rejects malformed, answer-revealing, or unreferenced visuals", () => {
    const blueprint = createAssessmentBlueprint(request({ format: "mcq", count: 1, nodeIds: ["node-a"] }), [cards[0]]);
    const base = modelItem(blueprint[0]);
    const figure = {
      type: "chart",
      chartType: "histogram",
      xLabel: "Speed (m/s)",
      series: [{ kind: "histogram", id: "speed", name: "Trials", values: [2, 3, 3, 5], bins: 3 }],
    };
    const opts = { blueprint, evidenceByRef: new Map([[cards[0].ref, cards[0]]]) };

    const valid = validateGeneratedItems({
      items: [{ ...base, stem: `${base.stem} Analyze the shown histogram.`, figure }],
    }, opts);
    expect(valid.ok).toBe(true);
    if (valid.ok) expect(valid.value[0].figure).toMatchObject({ type: "chart", chartType: "histogram" });

    const unreferenced = validateGeneratedItems({ items: [{ ...base, figure }] }, opts);
    expect(unreferenced.ok).toBe(false);
    if (!unreferenced.ok) expect(unreferenced.errors.join(" ")).toMatch(/stem must explicitly/i);

    const revealing = validateGeneratedItems({
      items: [{ ...base, stem: `${base.stem} Analyze the shown equation.`, figure: { type: "equation", latex: "v=3", caption: "Correct answer is 3" } }],
    }, opts);
    expect(revealing.ok).toBe(false);
  });

  it.each([
    ["item type", "item_type", "numeric"],
    ["Bloom target", "bloom_target", "remember"],
    ["mark weight", "maximum_marks", 99],
    ["curriculum assignment", "curriculum_node", "node-b"],
  ])("rejects a model response that violates its assigned %s", (_label, field, value) => {
    const blueprint = createAssessmentBlueprint(request({ format: "mcq", count: 2 }), cards);
    const items = blueprint.map(modelItem);
    items[0] = { ...items[0], [field]: value };
    const result = validateGeneratedItems(
      { items },
      { blueprint, evidenceByRef: new Map(cards.map((card) => [card.ref, card])) }
    );
    expect(result.ok).toBe(false);
  });

  it("rejects a Bloom label when the learner-facing stem does not require that cognitive operation", () => {
    const blueprint = createAssessmentBlueprint(
      request({ rigor: "rigorous", format: "mcq", count: 1, nodeIds: ["node-a"] }),
      [cards[0]]
    );
    const item = {
      ...modelItem(blueprint[0]),
      stem: "What fact appears in the assigned curriculum evidence?",
    };
    const result = validateGeneratedItems(
      { items: [item] },
      { blueprint, evidenceByRef: new Map([[cards[0].ref, cards[0]]]) }
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(" ")).toMatch(/must explicitly require analyze thinking/i);
  });

  it("rejects wrong evidence-node provenance, missing assigned citations, and cross-batch duplicate stems", () => {
    const blueprint = createAssessmentBlueprint(request({ format: "mcq", count: 2 }), cards);
    const items = blueprint.map(modelItem);
    items[0] = { ...items[0], evidence_refs: ["E2"] };
    let result = validateGeneratedItems(
      { items },
      { blueprint, evidenceByRef: new Map(cards.map((card) => [card.ref, card])) }
    );
    expect(result.ok).toBe(false);

    const validItems = blueprint.map(modelItem);
    const duplicateKey = String(validItems[0].stem).toLowerCase().replace(/\s+/g, " ");
    result = validateGeneratedItems(
      { items: validItems },
      {
        blueprint,
        evidenceByRef: new Map(cards.map((card) => [card.ref, card])),
        existingStemKeys: new Set([duplicateKey]),
      }
    );
    expect(result.ok).toBe(false);
  });

  it("revalidates figures at the persistence boundary", async () => {
    const req = request({ format: "mcq", count: 1, nodeIds: ["node-a"] });
    const blueprint = createAssessmentBlueprint(req, [cards[0]]);
    const validated = validateGeneratedItems(
      { items: [modelItem(blueprint[0])] },
      { blueprint, evidenceByRef: new Map([[cards[0].ref, cards[0]]]) }
    );
    expect(validated.ok).toBe(true);
    if (!validated.ok) return;

    const unsafe = {
      ...validated.value[0],
      stem: `${validated.value[0].stem} Use the shown diagram.`,
      figure: { type: "diagram", variant: "unsupported" },
    } as unknown as GeneratedItem;
    const db = await getDb();
    expect(() => persistGeneratedForm({ db, req, items: [unsafe], cards: [cards[0]], title: "Unsafe" }))
      .toThrow(/invalid figure/i);
  });

  it("feeds semantic contract errors back to the model and accepts a conforming repair", async () => {
    const req = request({ rigor: "casual", format: "mcq", count: 1, nodeIds: ["node-a"] });
    const blueprint = createAssessmentBlueprint(req, [cards[0]]);
    const validItem = modelItem(blueprint[0]);
    const invalidItem = { ...validItem, bloom_target: "evaluate" };
    const responses = [invalidItem, validItem];
    let secondRequest: any;
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const callIndex = fetchMock.mock.calls.length - 1;
      if (callIndex === 1) secondRequest = JSON.parse(String(init?.body));
      return new Response(
        JSON.stringify({ choices: [{ message: { content: JSON.stringify({ items: [responses[callIndex]] }) } }] }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    const endpoint: ResolvedRoleEndpoint = {
      role: "generation",
      provider: "custom",
      baseUrl: "https://model.example/v1",
      modelId: "generation-test-model",
      apiKey: "",
      capabilities: defaultCapabilities(),
    };

    const result = await callStructuredAgent({
      role: "generation",
      endpoint,
      system: "Return JSON.",
      user: buildGenerationUserPrompt(req, [cards[0]], blueprint),
      promptVersion: "generation-contract-test",
      schemaVersion: "assessment-items-test",
      maxRepairAttempts: 1,
      validate: (payload) =>
        validateGeneratedItems(payload, {
          blueprint,
          evidenceByRef: new Map([[cards[0].ref, cards[0]]]),
        }),
    });

    expect(result.repaired).toBe(true);
    expect(result.attempts).toBe(2);
    expect(result.value[0].bloomTarget).toBe(blueprint[0].bloomTarget);
    const repairInstruction = secondRequest.messages.at(-1).content as string;
    expect(repairInstruction).toContain("bloom_target must be");
    expect(repairInstruction).not.toContain("Include speech");
  });

  it("puts exact difficulty slots and hard rules in the repairable model prompt", () => {
    const req = request({ rigor: "rigorous", format: "proof", count: 2 });
    const blueprint = createAssessmentBlueprint(req, cards);
    const prompt = buildGenerationUserPrompt(req, cards, blueprint);
    expect(prompt).toContain("DIFFICULTY CONTRACT: Rigorous");
    expect(prompt).toContain("item_type=proof");
    expect(prompt).toContain("bloom_target=create");
    expect(prompt).toContain("rubric_criteria=4");
    expect(prompt).toContain("Match every blueprint field exactly");
  });
});

describe("generation orchestration", () => {
  it("creates an exact, evidence-grounded, loadable attempt through the public generator", async () => {
    const db = await getDb();
    const sourceId = "source-generation-e2e";
    const nodeId = "node-generation-e2e";
    const now = new Date().toISOString();
    persistedSourceIds.push(sourceId);

    db.run(
      `INSERT INTO curriculum_sources
         (id, name, hash, page_count, has_outline, extraction_status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?);`,
      [sourceId, "Generation contract.pdf", "generation-e2e-hash", 1, 1, "authored", now]
    );
    db.run(
      `INSERT INTO curriculum_nodes
         (id, source_id, parent_node_id, ordinal, depth, title, section_number,
          start_page, end_page, node_kind, extraction_status, content_hash)
       VALUES (?, ?, NULL, 1, 0, ?, ?, 1, 1, 'chapter', 'extracted', ?);`,
      [nodeId, sourceId, "Conservation laws", "1", "generation-node-hash"]
    );
    db.run(
      `INSERT INTO curriculum_chunks
         (id, node_id, page, chunk_ordinal, text_content, excerpt_hash, chunk_kind)
       VALUES (?, ?, 1, 1, ?, ?, 'prose');`,
      [
        "chunk-generation-e2e",
        nodeId,
        "In an isolated system, total momentum is conserved before and after an interaction.",
        "generation-chunk-hash",
      ]
    );

    const binding = db.exec(
      `SELECT role, provider, base_url, model_id, capabilities_json, overrides_json, fallback_model
       FROM model_bindings WHERE role = 'generation';`
    );
    previousGenerationBinding = binding[0]?.values?.[0]
      ? [...binding[0].values[0]]
      : null;
    db.run(
      `INSERT OR REPLACE INTO model_bindings
         (role, provider, base_url, model_id, capabilities_json, overrides_json, fallback_model)
       VALUES ('generation', 'custom', 'https://generation.example/v1', ?, ?, '{}', NULL);`,
      ["generation-e2e-model", JSON.stringify(defaultCapabilities())]
    );

    const generationRequest = request({
      subject: "physics",
      format: "mixed",
      count: 7,
      rigor: "rigorous",
      nodeIds: [nodeId],
      sourceName: "Generation contract.pdf",
    });
    const generationCards: EvidenceCard[] = [
      {
        ref: "E1",
        nodeId,
        nodeTitle: "Conservation laws",
        sectionNumber: "1",
        page: 1,
        excerptHash: "generation-chunk-hash",
        text: "In an isolated system, total momentum is conserved before and after an interaction.",
      },
    ];
    const blueprint = createAssessmentBlueprint(generationRequest, generationCards);
    const progress: Array<[number, string]> = [];
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => {
      const callIndex = fetchMock.mock.calls.length - 1;
      const batch = blueprint.slice(callIndex * 6, callIndex * 6 + 6);
      const items = batch.map(modelItem);
      if (batch[0]?.ordinal === 1) {
        items[0] = {
          ...items[0],
          stem: `${items[0].stem} Analyze the shown momentum histogram.`,
          figure: {
            type: "chart",
            title: "Momentum observations",
            chartType: "histogram",
            xLabel: "Momentum (kg m/s)",
            series: [{ kind: "histogram", id: "p", name: "observations", values: [1, 2, 2, 3, 4], bins: 4 }],
          },
        };
      }
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify({ items }) } }],
          usage: { prompt_tokens: 100, completion_tokens: 200, total_tokens: 300 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await generateAssessment({
      ...generationRequest,
      onProgress: (percentage, stage) => progress.push([percentage, stage]),
    });
    persistedIds.push({ formId: result.formId, attemptId: result.attemptId });

    expect(result).toMatchObject({
      itemCount: 7,
      modelId: "generation-e2e-model",
      repaired: false,
      evidenceCitations: 7,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(progress.at(-1)).toEqual([100, "Ready"]);

    const loaded = await getAttemptForTaking(result.attemptId);
    expect(loaded).toMatchObject({
      attemptId: result.attemptId,
      formId: result.formId,
      status: "created",
      assistancePolicy: "no_hints",
    });
    expect(loaded?.questions).toHaveLength(7);
    expect(loaded?.questions.map((question) => question.itemType)).toEqual([
      "mcq",
      "proof",
      "numeric",
      "mcq",
      "proof",
      "numeric",
      "mcq",
    ]);
    expect(loaded?.questions.every((question) => ["analyze", "evaluate", "create"].includes(question.bloomTarget)))
      .toBe(true);
    expect(loaded?.questions[0].figure).toMatchObject({ type: "chart", chartType: "histogram" });
    const resultDto = await getAttemptResult(result.attemptId);
    expect(resultDto.questions[0].figure).toMatchObject({ type: "chart", chartType: "histogram" });

    const storedFigure = db.exec(
      "SELECT figure_spec_json FROM assessment_items WHERE form_id = ? AND stable_ordinal = 1;",
      [result.formId]
    );
    expect(JSON.parse(String(storedFigure[0].values[0][0]))).toMatchObject({
      type: "chart",
      chartType: "histogram",
    });

    const firstRequest = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(firstRequest.messages[0].content).toContain("ASSESSMENT VISUALIZATION TOOL");
    expect(firstRequest.messages[0].content).toContain("histogram");
  });
});

describe("difficulty persistence", () => {
  it.each([
    ["casual", "full_hints", "immediate_criterion"],
    ["challenging", "limited_hints", "on_submission"],
    ["rigorous", "no_hints", "after_completion"],
  ] as const)("persists %s assistance and feedback policy", async (rigor, assistance, feedback) => {
    const req = request({ rigor, format: "mcq", count: 1 });
    const blueprint = createAssessmentBlueprint(req, cards);
    const validated = validateBlueprint(blueprint);
    expect(validated.ok).toBe(true);
    if (!validated.ok) return;

    const db = await getDb();
    const persisted = persistGeneratedForm({
      db,
      req,
      items: validated.value as GeneratedItem[],
      cards,
      title: `${rigor} contract test`,
    });
    persistedIds.push(persisted);

    const attempt = db.exec("SELECT assistance_policy FROM assessment_attempts WHERE id = ?;", [persisted.attemptId]);
    const form = db.exec("SELECT feedback_policy, config_json FROM assessment_forms WHERE id = ?;", [persisted.formId]);
    expect(attempt[0].values[0][0]).toBe(assistance);
    expect(form[0].values[0][0]).toBe(feedback);
    expect(JSON.parse(String(form[0].values[0][1]))).toMatchObject({
      rigor,
      assistancePolicy: assistance,
    });
  });
});
