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

## Responding to learner signals

A widget the learner answers is a **pedagogical signal**, not a form
submission. `src/lib/widgets/signal.ts` turns a committed answer into a tutor
turn, routed through the same `askTutorTurn` path as a typed message so the
full contract (stage, board ops, evidence) applies unchanged.

**Which interactions wake the tutor.** Committing an answer does:
`question`, `retrieval_check`, `mistake_check`, `challenge`, `reflection`,
`scratchpad`. Exploration does not — dragging a slider, playing an animation,
opening a hint level, or revealing an item is the learner thinking, and
interrupting that is worse than useless.

**What the tutor is told.** Not "the learner clicked B", but the pedagogical
content of the act:

- A **wrong** answer carries the misconception that distractor detects, plus an
  explicit instruction to diagnose it and place a repairing widget rather than
  restate the right answer.
- A **right** answer carries the reminder that one right answer is not a stage
  exit condition, and that the reasoning must be confirmed sound rather than
  lucky.
- A **failed retrieval check** is flagged as evidence of forgetting and routes
  to targeted repair.
- **Scratchpad work** must be diagnosed line by line, never completed for the
  learner.
- A **reflection** is named as the primary evidence of understanding — a fluent
  procedure with an incoherent explanation is not understanding.

Every signal also carries the current stage and its exit condition, so
`stage_advance` stays evidence-bound.

The learner sees only what they *did* ("Answered the question: …") — never the
directive their tutor received, and never the verdict, which is the tutor's to
deliver as diagnosis.

One turn per commit, claimed synchronously so a double click cannot fire twice;
a signal whose turn fails is released for retry.

---

## Widget cluster groups

The agent often places several widgets that are really ONE piece of work: three
questions probing the same idea, or a scratchpad feeding the challenge below it.
Signalling the tutor after the first is answered is wrong twice over — it
interrupts a learner who is mid-task, and it hands the agent a fragment of the
evidence it needs.

Widgets sharing a `group.id` are one unit:

```ts
group?: { id: string; label?: string; size?: number }
```

The learner must answer every **answerable** widget in the group; only then is
the tutor signalled, once, with all the answers in a single turn.

**Membership is agent-declared, not inferred from the turn.** Two questions
placed together are not necessarily one task — the agent may want a quick check
answered now and a deeper one left for later, and only it knows which. Inferring
from the turn boundary would silently withhold the signal from a widget meant to
stand alone.

**Only answerable widgets gate the cluster.** A concept card between two
questions is context, not work. Counting it would deadlock the group, because
nothing can ever answer a concept card. `size` guards the opposite failure: if
the agent declares three and only two render, completing both must not report
the set as finished.

**The learner can see the gate.** Each card carries a `Set n/N` badge before
anything is answered and a progress footer after — otherwise an answered
question that produces no reply reads as a broken app.

**The combined turn is the point.** Three answers judged together tell a story
none tells alone: two right and one wrong is a locatable gap, whereas three
separate turns get diagnosed three times and re-taught three times. The message
states the contrast explicitly — all wrong routes the agent upstream to the one
misconception behind them; all right is evidence to test for luck, not proof.

---

## The learner is never passive

The reported failure: the tutor placed a Roadmap, said *"I've put the roadmap
for this lesson on the board"*, and stopped. The learner was shown a plan and
handed nothing to do. That is a slide, not a lesson.

Enforced at two layers, because a prompt is guidance and this is policy.

**Prompt.** A binding `THE LEARNER IS NEVER PASSIVE` section states that the
agent is not only a teacher but *the means of guidance*, names the roadmap-only
turn as a specific forbidden failure, and bans the permission-seeking sign-offs
(`"let me know when you're ready"`, `"does that make sense?"`) that end a turn
without a task. The Roadmap's own teaching rule now says it is orientation, not
teaching, and must be placed alongside the widget that opens step 1.

**Runtime.** `enforceLearnerAgency` runs in the turn pipeline after the tool and
necessity filters. A turn whose board ops add only presentational content —
roadmap, concept card, text, bullets, latex, callout, diagram — has its speech
extended with a question that hands the work back.

Three deliberate limits on that backstop:

- **It never fabricates a board op.** Synthesizing a question would put words in
  the tutor's mouth and could contradict the lesson being taught. The agent
  chooses the pedagogical move; the backstop only guarantees the learner is
  asked *something*.
- **Housekeeping turns are exempt.** `redraw_block`, `delete_block`,
  `revise_text` and friends owe no new task — the learner's work is already on
  the board from an earlier turn.
- **Speech-only turns are exempt.** A greeting or a clarification has no board
  ops and no obligation.

What counts as "something to do" is `isActionableWidget`: any of the seven
answerable widgets, or an exploration widget the agent gave a `respond` prompt
to. This is the payoff of the previous round — `respond` is what promotes a
slider from a thing to watch into a thing to answer.

---

## Response affordances on exploration widgets

Seven widgets give the learner somewhere to answer: **Question**, **Retrieval
Check**, **Challenge** (built in from the start), and now **Slider**,
**Animation**, **Hint** and **Annotation**.

Those four teach by exploration, and exploration alone is not evidence — a
learner who understood the sweep and one who dragged the handle and moved on
look identical to the tutor. An optional agent-authored `respond` block turns
the exploration into a claim the learner commits to:

```ts
respond?: {
  prompt: string;            // "What happens to the slope as h shrinks?"
  placeholder?: string;
  submitLabel?: string;
  acknowledgement?: string;
}
```

**It is optional on purpose.** A tutor may legitimately place a slider purely to
illustrate; without `respond` the widget stays watch-only and silent, exactly as
before. Only when the agent attaches one does interacting become a turn the
tutor owes an answer to — `shouldSignalTutor` gates on `intent.respond !==
undefined` *and* a fresh commit, so moving a control still never wakes the
tutor.

Each widget's signal names the evidence its answer actually provides, so the
tutor cannot treat it as small talk:

| Widget | What the tutor is told to assess |
| --- | --- |
| Slider | Whether the learner described the **relationship** or just read off a number |
| Animation | A prediction committed **before** watching is a mental model; agreeing afterwards is not |
| Hint | The level opened is the **independence** measure; level 3 demands an unscaffolded retry |
| Annotation | Whether the answer engages with the **marked fragment** or the surrounding idea |

The remaining ten (Roadmap, Concept Card, Comparison, Scratchpad, Reveal,
Example, Mistake Check, Memory Hook, Reflection, Mastery Card) are unchanged —
they either present rather than ask, or already carry their own input.

---

## Failure containment

A white screen mid-session is the worst outcome this app can produce: the
learner loses the board, the transcript, and any sense of what went wrong. Two
independent defects combined to allow it, and both are now closed.

**1. Nothing caught render errors.** The app had no error boundary at all, so
any throw anywhere unmounted the entire React tree. Boundaries now sit at three
levels, each containing failure at the smallest honest unit:

| Level | Catches | Learner sees |
| --- | --- | --- |
| Per block (`Chalkboard`) | One widget or visualization | An inline card naming the block; every other block survives |
| Board shell (`StudyRoom`) | Pan/zoom, annotation canvas | "This board could not be drawn" + Redraw; chat and toolbar stay usable |
| Root (`main.tsx`) | Anything else | Explanation, the error message, and a Reload button |

Boundaries take a `resetKey` (the board or block id) so navigating away from a
broken board clears the error instead of stranding the learner on a dead card.

**2. Ten of seventeen widgets threw on malformed input.** Placement validates
every intent, but three paths reach the renderer unchecked: a board restored
from a saved session, a payload truncated mid-write, and a widget authored by an
older build. `renderBody` now screens each intent through `incompleteReason`
before dispatching — one auditable list of the structural fields each body
dereferences, rather than optional chaining scattered across seventeen
components. An incomplete widget renders an explanation ("This widget arrived
with no frames…") instead of blank chrome, because silence reads as *the tutor
drew nothing* and the learner never thinks to ask for it again.

**3. Interaction was the real crash path.** The reported failure was a *click*,
not a first paint. Two things had to be fixed that render-time hardening does
not reach:

- **The re-render after a click.** Setting `selectedOptionId` or
  `animationProgress` re-renders the body, and a list containing a `null` entry
  threw on the first property access. The presence check was not enough:
  `normalizeIntent` now also drops unusable entries, pads short comparison rows
  against their column count, and discards an animation `motion` whose
  `tDomain` or expressions cannot produce a path (falling back to the progress
  dot, which still teaches). Partial data is repaired rather than rejected —
  nine good steps out of ten are still worth teaching with.
- **The handler itself.** React error boundaries **do not catch throws from
  event handlers**; they escape to `window.onerror` with the board already
  half-updated. Both interaction choke points — `emit` in `WidgetSurface` and
  `saveWidgetState` in `StudyRoom` — are wrapped, so a failed interaction costs
  one click, never the session. The async tutor-signal path releases its
  dedupe claim on failure, otherwise a single error would permanently prevent
  that widget from ever waking the tutor again.

`widgetResilience.test.tsx` renders all 17 kinds from a bare `{ kind }`, plus
structurally-empty, ragged-list, broken-motion and unknown-kind payloads, each
crossed with ten post-interaction states, and asserts none throw.

---

## LaTeX must never leak its source

A Concept Card rendered the literal text `raw LaTeX\begin{cases} x = f(t) …`
onto the board. The LaTeX was valid; the renderer was broken.

**Root cause.** KaTeX *writes into* the `macros` option while expanding a
multi-line environment — it defines `\cr` there. `KATEX_OPTIONS.macros` pointed
at an `Object.freeze`d map, so KaTeX threw `Cannot add property \cr, object is
not extensible` and the render ladder fell through to its rung-3 raw-source
fallback. This broke **every** `cases`, `aligned`, `matrix`, `pmatrix`,
`bmatrix` and `array` in the entire app, not just widgets. `freshMacros()` now
hands each call its own mutable copy; note that `{ ...KATEX_OPTIONS }` is a
shallow spread and does *not* copy the nested map, so all three call sites pass
`macros: freshMacros()` explicitly.

**Defence in depth.** The rung-3 fallback still exists — silently dropping an
equation is worse than showing its source — but it no longer reads as leaked
plumbing. It is labelled *unrendered maths* rather than *raw LaTeX* and styled
as a quiet dashed inline note (`.latex-raw`) instead of an unstyled code block.

## Redrawing a block the learner cannot see

`redraw_block { targetAnchor | targetIndex | targetMatchText }` forces a block
to re-render with its content untouched. The board keys its block list by id, so
assigning a fresh id unmounts the old subtree and mounts a new one — clearing a
tripped error boundary, a failed lazy-loaded adapter, or a widget wedged in a
bad internal state. None of those are repaired by editing content, which is why
this is separate from `update_widget`.

- **Learner state survives.** A redraw keeps `state`, so reporting a display bug
  never costs the learner their answer.
- **Anchors keep resolving.** The tutor still holds the id from placement time,
  so `resolveBoardTargetIndex` matches through the `~r…` suffix. Without that,
  one redraw would silently orphan every later update to that block.
- **The suffix never accumulates**, and its counter is monotonic so two redraws
  in the same millisecond still differ — an identical id would leave React's key
  unchanged and skip the remount entirely.
- **Not gated behind `boardEditing`.** It changes no content, and gating it
  would strand a learner with a blank widget in exactly the configuration the op
  exists to rescue.

The prompt instructs the tutor to use it only when the learner reports they
cannot see something, and to re-place the content in a different form rather
than redrawing twice.

---

## Typography and hit area

**Widgets do not use the chalk font.** The board applies a cursive handwriting
face to its whole content stream, which suits prose the tutor "writes" but hurts
what widgets actually carry: options, comparison tables, mastery verdicts,
numbers, learner input. `WidgetShell` sets `font-family: var(--font-widget)`
(Space Grotesk) so every widget reads as an instrument rather than handwriting.
The one exception is the dyslexia-friendly font preference, which overrides
`--font-widget` too — that accessibility choice outranks the default typeface.

**Widgets are bounded to their own width.** A widget used to render `w-full
max-w-[460px]`, so its wrapper stretched across the full 920px content stream
while only 460px was visible. Left-clicking the empty region beside it hit
`[data-block]`, which suppresses panning to allow text selection — the board
became nearly impossible to drag from anywhere right of a widget. Two changes:

- The shell is `w-[460px] max-w-full`, and bounded block kinds
  (`SHRINK_WRAP_BLOCKS`) get a `w-fit` wrapper. Visualizations and rows keep
  full-width wrappers because their layout depends on it.
- `onDown` pans when a left-click lands on a block *wrapper* rather than any
  rendered child — clicking empty margin has nothing to select. `.board-block`
  shows `grab` with `text` only over content, so the cursor predicts the action.

---

## Reverting a message reverts the board

Every user message carries a `boardSnapshot` — the board exactly as it stood
*before* that message was sent. Reverting to a message restores it, so undoing a
question also undoes everything the tutor drew in response.

- Snapshots are **deep-cloned** at capture and again at restore. Blocks are
  mutated in place by later board ops and widget answers, so a shallow copy
  would let the present rewrite history.
- Captured at all three revert points: a typed message, a widget answer, and an
  "Ask about this" branch. The branch snapshot is taken *before* the sub-board
  is added, so reverting removes the thread rather than stranding it.
- On revert, `signalledWidgets` is cleared: restored widgets may legitimately be
  answered again.
- If the durable transcript rewind fails, the board is put back too — chat and
  board must never describe different lessons.

**Storage bound.** A snapshot clones every board, so keeping one per message
would grow the saved session quadratically against a ~5MB localStorage budget.
`pruneSnapshotsForStorage` persists only the 12 most recent. Older messages stay
revertable and simply revert the transcript alone — the same graceful path taken
by sessions saved before snapshots existed.

**Learner control.** Board settings (top bar → Settings) has a *Board reverts
too* toggle, persisted globally as `appearance.boardRevertsWithMessage`. Default
**on**, since a transcript and a board disagreeing about what has been taught is
the more confusing state; learners who treat the board as an accumulating
notebook can turn it off and keep everything drawn.

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
| `src/lib/widgets/signal.test.ts` | Which interactions wake the tutor, and the pedagogical obligation each one creates |
| `src/components/board/boardRevert.test.ts` | Snapshot storage bound, recency, and isolation from later mutation |
| `src/components/board/widgetResilience.test.tsx` | No widget payload can throw; the error boundary fallback is actionable |
