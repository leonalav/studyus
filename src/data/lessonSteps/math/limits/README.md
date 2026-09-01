# math:limits corpus

This directory is the first hand-authored `LessonStep` corpus for the math
limits topic. It is the Phase 2 deliverable for `graph-engineered_tutor`
Decisions 1 and 5: schema-bearing JSON files, indexed, that the embedding
backend (a separate follow-on task) will turn into a vector index, and the
retriever (another follow-on task) will cosine-match against at lesson time.

The corpus covers one topic — limits in single-variable real analysis — at a
breadth the rest of the math curriculum can mirror. Eight steps is small on
purpose: this is a schema validation, not a coverage milestone.

## Schema

Each `*.json` file is a single `LessonStep`. The fields:

- `id` (`math.limits.<slug>`) — the stable identifier the retriever keys on.
- `route` (`LearningRoute`) — which policy move the step services. One of
  eleven values from `learning/types.ts` (`LEARNING_ROUTES`). Example:
  `"prediction"`.
- `stage` (`MasteryStage`) — the ladder position. One of the six values from
  `mastery.ts` (`MASTERY_STAGES`). Example: `"encounter"`.
- `mode` (`ActivityMode`) — the pedagogical posture, distinct from `route`.
  Example: `"explore"`.
- `contextVariant` (`ContextVariant`) — how far the task is from the one the
  skill was taught on. Example: `"changed_numbers"`.
- `targetSkill` — the skill this step is evidence about. Currently a single
  placeholder (`"math.limits.base"`); will move to the skill-graph ids once
  `skillGraph.ts` exports them.
- `supportCeiling` (`SupportLevel`, 0–3) — the hard cap on help for this step.
  Example: `0` (unaided).
- `permittedWidgetKinds` — the subset of the 19 widget kinds (`widgets/types.ts`
  `WIDGET_KINDS`) the LLM may place. Example: `["question", "concept_card"]`.
- `requiredVisualizationKind` (optional) — one of the 11 `VisualizationIntent`
  values when the step demands a picture. Omitted when no visualization is
  load-bearing.
- `requiredEvidence` — the evidence types (`EvidenceType`) the step must
  produce. Example: `["prediction", "observation"]`.
- `proseSlots` — one entry per widget that needs the tutor's voice. Each slot
  has a `blockId`, a `hint` (what to say), and a `tone` (`"concise"`,
  `"worked"`, or `"inquisitive"`).
- `maxBoardOps` — hard cap on board ops the LLM may emit.
- `corpusRef` — duplicate of `id` at this version; reserved for cross-corpus
  references once more topics ship.

`index.json` is a flat list of the eight files, sorted by stage ordinal then
route, with subject, topic, version, and a placeholder embedding model name
(`all-MiniLM-L6-v2` — wired up in the embeddings task).

## Why these eight files

The eight files are chosen to exercise every dimension of the schema, not to
cover the topic:

- **Route diversity:** all of `prediction`, `direct_instruction`,
  `contrast_case`, `faded_example`, `guided_retry`, `transfer_check`, and
  `diagnostic_probe` appear. The four routes not covered
  (`prerequisite_repair`, `independent_practice`, `due_retrieval`,
  `drill_loop`) are not authored here because they are produced by the policy
  engine in response to ledger state, not by corpus lookup.
- **Stage diversity:** `encounter`, `understand`, `construct`, and `apply`
  appear. `transfer` and `master` are unreachable from cold-start in a single
  corpus pass; they will appear in later topics where the learner has
  accumulated evidence to climb into.
- **Widget diversity:** 11 distinct widget kinds appear across the eight files
  — `question`, `concept_card`, `animation`, `comparison`, `example`,
  `scratchpad`, `hint`, `mistake_check`, `reflection`, `challenge`,
  `retrieval_check`.
- **Visualization diversity:** two of the eleven visualization kinds are used
  — `function` (the most common) and `geometry` (only for the ε-δ picture).

## This is v0

The schema may evolve. Three fields in particular are placeholders whose
final shape is not yet pinned: `targetSkill` (currently a single string,
eventually a `targetSkillIds[]` mirroring `NextLearningMove`), `corpusRef`
(reserved for cross-corpus references), and `rubricRef`/`corpusRefs[]` from
the original Decision 5 spec (not yet used). Additions to the schema will be
called out in version bumps on `index.json`.

## Follow-on work

- More topics: derivatives, integrals, sequences under `math/`. Same schema.
- Wider subject coverage: physics (kinematics, dynamics, energy), biology
  (cell, DNA, pathways), chemistry, programming.
- Embed-on-write pipeline: the embeddings task wires `all-MiniLM-L6-v2` to
  the corpus, with Tauri-Rust / transformers.js backends chosen at runtime.
- The retriever: brute-force cosine over the in-memory matrix at
  `src/lib/lessonSteps/retrieve.ts`, wired into `buildPolicyBrief` as
  `corpusRef`.
- Schema refinement: convert `targetSkill` to `targetSkillIds[]`, decide on
  `rubricRef` shape once assessment integration is scoped.