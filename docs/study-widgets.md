# Study widgets and the Guide to Mastery

The chalkboard's 17 study widgets are the tutor agent's **teaching vocabulary**,
not a toolbox of features. Each one is a specific pedagogical move, and the
agent is expected to place the widget that *is* the move it is making.

The core rule the whole system serves:

> The agent carries the structure. The student carries the thinking.
> Mastery means the student can eventually carry both.

---

## Architecture

Widgets follow exactly the pattern already established for visualizations
(`docs/visualization-stack-plan.md`): the agent emits a semantic JSON intent, a
validator gates it, and a renderer owns every pixel. The agent never emits
markup, never names a preset, and never controls layout.

| Layer | File | Responsibility |
| --- | --- | --- |
| Protocol | `src/lib/widgets/types.ts` | The 17-widget discriminated intent union + learner `WidgetState` |
| Validation | `src/lib/widgets/validate.ts` | Fail-closed structural **and pedagogical** validation, state sanitizing, deterministic grading |
| Prompt contract | `src/lib/widgets/prompt.ts` | Field spec + teaching rule per widget; the mastery directive |
| Mastery loop | `src/lib/mastery.ts` | Six-stage ladder, the Mastery Gate, spaced retrieval / forgetting |
| Rendering | `src/components/board/WidgetSurface.tsx` | All 17 renderers, chalkboard glass material |
| Board | `src/data/boards.ts`, `Chalkboard.tsx`, `StudyRoom.tsx` | `widget` block kind, rendering, state persistence, markdown export |
| Agent | `src/lib/tutor.ts`, `src/lib/llm.ts` | `place_widget` / `update_widget` ops, stage reporting, prompt |

### Not widgets

Graph (#3), Point/Geometry (#4) and Equation (#5) from the original 20-widget
board spec are already first-class **visualization intents** (`function`,
`geometry`, `equation`) and keep going through the `visualize` op. The widget
validator rejects them by name and redirects the agent, so the two systems can
never drift into duplicating each other.

---

## The 17 widgets

| # | Kind | The move it makes |
| --- | --- | --- |
| 1 | `roadmap` | Show where the lesson goes; mark the current step |
| 2 | `concept_card` | The durable definition, given *after* the encounter |
| 6 | `slider` | Move one parameter and watch what changes |
| 7 | `animation` | Show a process over time, after a prediction |
| 8 | `comparison` | Separate two ideas the learner is confusing |
| 9 | `question` | A check for understanding, on the board, with diagnostic distractors |
| 10 | `hint` | Progressive disclosure the learner opens themselves |
| 11 | `scratchpad` | Hand the work to the learner |
| 12 | `annotation` | Point at a fragment and say what to notice — how notation is taught |
| 13 | `reveal` | Hide the answer behind the learner's own decision to look |
| 14 | `example` | The worked demonstration, with a reason on every step |
| 15 | `mistake_check` | Diagnose an error instead of correcting it |
| 16 | `memory_hook` | The explicit "memorize this" moment |
| 17 | `retrieval_check` | Resurface earlier material from memory — how forgetting is detected |
| 18 | `challenge` | Independent work with the scaffolding removed |
| 19 | `reflection` | The learner teaches the idea back |
| 20 | `mastery_card` | Close with evidence, never with a completion badge |

Every learner-visible string is agent-supplied. There is no hardcoded lesson
content in any widget.

---

## Pedagogical validation

`validateWidgetIntent` rejects intents that are structurally fine but teach
nothing. These are hard errors, reported back through the schema-repair loop:

- A multiple-choice question must have **exactly one** correct option.
- Hint levels must form a **gapless prefix** of 1..3 — no jumping straight to a
  strong hint.
- Every `error` line in a mistake check needs a **`diagnosis`**, and a mistake
  check needs at least one error line.
- Every example step needs its **`why`**. A step without a reason is a magic
  trick, and the learner copies the trick rather than the reasoning.
- A mastery card requires **all five** evidence dimensions.
- At most one roadmap step may be `current`.

Widget bodies also withhold content until the learner has acted: a question's
explanation and a mistake check's correction stay hidden until submission, and
reveal items stay blurred and unselectable.

---

## The six-stage ladder

| Stage | Question | Agent | Learner | Vocabulary |
| --- | --- | --- | --- | --- |
| 1 Encounter | What is this? | Introduce and visualize | Observe and predict | roadmap, concept_card, question, animation + function/geometry |
| 2 Understand | Why does it work? | Explain, question, connect | Explain in own words | comparison, annotation, slider, reveal, reflection + equation |
| 3 Construct | Let's build the ability | Work beside, then stop helping | Solve with guidance | scratchpad, example, hint, mistake_check, question |
| 4 Apply | Can you actually use it? | Give problems and diagnose | Solve and adapt | challenge, hint, mistake_check + function/equation |
| 5 Transfer | Somewhere new? | Vary context and difficulty | Reason from principles | challenge, comparison, question, reflection + function/geometry |
| 6 Master | — | Verify and consolidate | Demonstrate independently | retrieval_check, reflection, memory_hook, mastery_card |

### Advancement is not click-through

The stage lives in the database (`chalkboard_sessions.mastery_stage`, migration
v5) along with the evidence that justified it. Movement is resolved
deterministically by `resolveNextMasteryStage`, not asserted by the model:

- Forward movement requires `stage_advance: { ready: true, evidence: "…" }`.
  `ready: true` with no evidence is a **schema validation error**.
- Forward movement advances **exactly one stage**. A model reporting `master`
  from `encounter` still lands on `understand`.
- Backward movement is honoured immediately and needs no evidence. Recognizing
  that a learner has regressed must never be harder than promoting them.

---

## The Mastery Gate

Mastery is a verdict computed from five kinds of evidence, never a claim the
model can make and never a percentage:

`recall · understanding · procedure · transfer · independence`

`assessMastery` is a **conjunction**, not an average. A learner scoring
100/100/100/40/100 averages 88% and is *not* mastered — transfer is the weakest
link and is named as such. The mastery card renders the computed verdict, so a
model writing "MASTERED" into its speech has asserted nothing.

Three things are forbidden by prompt and enforced by structure:

1. Declaring mastery from a raw score ("you got 90%, so you've mastered it").
2. Celebrating completion ("You completed Section X 🎉").
3. Advancing a stage because the learner clicked next.

### Mastery decays

`mastered → forgetting detected → retrieval → targeted repair → mastered again`

Retrieval spacing runs `1, 3, 7, 16, 35, 70` days. A failed retrieval on a
mastered concept drops the learner back to **Understand** for targeted repair —
not back to the beginning, because they have not lost the encounter. A learner's
state is therefore never "finished/unfinished" but "currently mastered, with
evidence of how robust that mastery is".

---

## Agent surface

Two board operations, gated on the `studyWidgets` tool permission
(`update_widget` additionally requires `boardEditing`):

```jsonc
{ "op": "place_widget", "intent": { "kind": "…", … } }
{ "op": "update_widget", "targetAnchor": "…", "intent": { "kind": "…", … } }
```

`update_widget` **preserves learner state** — rewording a question must not
silently erase the answer the learner gave.

Widgets are also legal `BoardBlockSpec` kinds, so they can be placed through
`replace_block`, `insert_after`, and `spawn_thread`.

Each turn the agent additionally reports:

```jsonc
"stage": "encounter" | "understand" | "construct" | "apply" | "transfer" | "master",
"stage_advance": { "ready": boolean, "evidence": "what the learner did" }
```

Learner interaction (answers, slider positions, opened hint levels, revealed
items) is sanitized, persisted onto the owning block, and summarized back into
the next turn's board digest, so the agent teaches against what the learner
actually did rather than re-asking questions they already answered.

Prompt/schema versions: `tutor_v7` / `tutor_turn_v4`.

---

## Tests

| File | Covers |
| --- | --- |
| `src/lib/widgets/widgets.test.ts` | Protocol coverage, structural + pedagogical validation, state sanitizing, grading, the mastery directive |
| `src/lib/mastery.test.ts` | Ladder navigation, the conjunction gate, weakest-link reporting, retrieval/repair |
| `src/components/board/WidgetSurface.test.tsx` | Render smoke tests for all 17 widgets, plus content-withholding behaviour |
| `src/data/boards.widgets.test.ts` | Markdown export keeps teaching content and learner answers |
| `src/lib/tutor.test.ts` | Widget board ops, tool gating, stage persistence and anti-skip logic |
| `src/lib/tutor.prompt.test.ts` | Prompt carries the directive, ladder, widget catalog and invariants |
