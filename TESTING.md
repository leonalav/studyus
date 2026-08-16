## Verdict

Your Guidance Flow is **far ahead of a typical “chatbot tutor”**: it has a real mastery ladder, progressive hinting, interactive learner work, curriculum grounding, structured outputs, a learner-model concept, and a mastery gate that refuses to average away weak transfer. The strongest design idea is already stated in your code:

> “The agent carries the structure. The student carries the thinking.”  
> — `src/lib/mastery.ts:4`

The next transformation is to make that principle **structurally true at every important decision**, not just a well-written instruction to the model.

Right now, Studyus is an excellent **prompt-directed tutoring environment**. To become a genuinely superior zero-to-mastery system—your “torchbearer”—it needs to become an **evidence-led instructional policy engine**:

1. collect observable learner evidence,
2. classify the learning state deterministically,
3. select the smallest appropriate pedagogical move,
4. require reconstruction,
5. credit only independently verified learning,
6. schedule and execute delayed retention checks,
7. improve its policy from outcome data.

The central risk is not that the tutor will be unkind or unhelpful. It is **false mastery through fluent model narration**: the tutor can currently produce a plausible diagnosis, stage-advance rationale, and mastery scores without all of those being tied to durable, independently graded learner evidence.

---

# What is already unusually strong

### 1. The system correctly treats learning as a progression, not a completion counter

The six-stage ladder—Encounter → Understand → Construct → Apply → Transfer → Master—is pedagogically coherent and well articulated in `src/lib/mastery.ts:31`. In particular:

- **Construct** explicitly shifts work from agent to learner (`src/lib/mastery.ts:86`).
- **Transfer** deliberately changes context, representation, assumptions, and structure (`src/lib/mastery.ts:110`).
- **Master** explicitly withdraws support rather than maximizing assistance (`src/lib/mastery.ts:122`).

That is the right antidote to an answer-giving assistant.

### 2. You have a meaningful definition of mastery

The five required dimensions—recall, understanding, procedure, transfer, and independence—are excellent. Requiring all dimensions to meet the threshold rather than allowing a high procedure score to mask weak transfer is exactly the right product philosophy:

- dimensions: `src/lib/mastery.ts:178`
- conjunctive mastery gate: `src/lib/mastery.ts:220`
- transfer and independence definitions: `src/lib/mastery.ts:186`

Most educational products stop at “answered several questions correctly.” Yours explicitly rejects that.

### 3. The tutor is instructed to ask learners to think, not watch

Your widget contract is unusually good. Examples:

- animation requires a prediction before passive viewing becomes useful (`src/lib/widgets/prompt.ts:71`)
- hints require a learner response after disclosure (`src/lib/widgets/prompt.ts:77`)
- worked examples require a “why” for every step (`src/lib/widgets/prompt.ts:85`)
- mistake checks require diagnosis and a repair question before correction (`src/lib/widgets/prompt.ts:87`)
- challenges intentionally remove scaffolding (`src/lib/widgets/prompt.ts:93`)

The runtime also converts committed widget responses into pedagogically meaningful tutor turns, rather than merely treating them as form submissions: `src/lib/widgets/signal.ts:100`.

### 4. You guard against click-through progression

Stage advancement is persisted and constrained to one sequential step. The model cannot jump from Encounter to Master in one turn:

- stage persistence: `src/lib/tutor.ts:1656`
- deterministic one-step forward rule: `src/lib/tutor.ts:1692`
- stage evidence required when `ready: true`: `src/lib/tutor.ts:1180`

That is an important structural guardrail.

### 5. Curriculum grounding and learner memory are thoughtfully handled

The tutor receives supplied curriculum excerpts and is forbidden from citing unseen material (`src/lib/tutor.ts:1097`). It is also instructed to treat the selected curriculum sequence as binding (`src/lib/tutor.ts:1785`).

The learner model has meaningful privacy controls, learner-visible entries, dispute functionality, deletion, and retention pruning:

- learner dispute: `src/lib/learnerModel.ts:175`
- learner-controlled deletion: `src/lib/learnerModel.ts:187`
- retention policy: `src/lib/learnerModel.ts:201`

That is aligned with a human-centered AI approach.

---

# The most important gaps

## P0 — Mastery scores are model-authored, not evidence-computed

The mastery card’s **verdict** is correctly computed by the app, but its five input scores are still supplied by the tutor model:

- agent schema asks the model to write all five evidence scores: `src/lib/widgets/prompt.ts:59`
- the UI computes a verdict from those scores: `src/components/board/WidgetSurface.tsx:1408`

So the system protects against the model saying “mastered” in prose, but does **not** protect against the model assigning itself:

```json
{
  "recall": 90,
  "understanding": 90,
  "procedure": 90,
  "transfer": 90,
  "independence": 90
}
```

Those values can be pedagogically sincere and still be unsupported.

### Transform it

Replace model-authored percentage evidence with an **evidence ledger**. Each dimension should be computed from tagged learner events, for example:

| Dimension     | Acceptable evidence                                            |
| ------------- | -------------------------------------------------------------- |
| Recall        | Delayed, no-notes retrieval item; independently evaluated      |
| Understanding | Explanation scored against a concept/rubric criterion          |
| Procedure     | Multiple standard items, with item-level support recorded      |
| Transfer      | At least one intentionally novel item, independently evaluated |
| Independence  | Demonstrated work with no hints/worked steps/leading prompts   |

The model may propose an interpretation—“this seems like a transfer success”—but the app should attach the actual evidence IDs and decide whether those events qualify.

**Mastery should mean:** *“The system has observed enough valid evidence,”* not *“The tutor has formed a confident impression.”*

---

## P0 — The system promises spaced retrieval but does not appear to execute it

`src/lib/mastery.ts:277` defines a sensible spacing sequence: `[1, 3, 7, 16, 35, 70]`.

But the audit found the scheduler helpers are only defined and tested; they are not wired to persistence, a due queue, session opening, or retrieval-item generation. The mastery card can display `reviewIn` (`src/components/board/WidgetSurface.tsx:1474`), but that appears to be model-provided text rather than a generated appointment.

### Transform it

Create a persistent `review_queue` / `retrieval_schedule` record:

```ts
{
  learnerId,
  skillId,
  evidenceIds,
  dueAt,
  intervalIndex,
  state: "due" | "completed" | "repair_needed",
  requiredMode: "unaided",
  retrievalType: "recall" | "application" | "transfer"
}
```

At session start:

1. surface one or two due reviews before new content;
2. prohibit notes, hints, and visible worked examples for the first attempt;
3. score the response;
4. either expand the interval or route the learner to **targeted repair**;
5. retain the original conceptual goal instead of resetting a whole unit.

This is essential. Without delayed execution, “mastery decays” is a correct philosophy but not yet a learning mechanism.

---

## P0 — Diagnosis is largely model self-report, not a stable learner-state model

The tutor can return a diagnosis containing misconceptions, weak criteria, hint dependence, and calibration. That diagnosis is then remembered:

- diagnosis schema: `src/lib/tutor.ts:1133`
- memory write path: `src/lib/tutor.ts:659`
- durable learner-model entries: `src/lib/learnerModel.ts:50`

The issue is that it stores statements such as a model’s description of a misconception, rather than a structured claim with:

- a **skill or prerequisite ID**,
- the learner’s actual response,
- the expected evidence/rubric criterion,
- evidence confidence,
- support level,
- date and context,
- contradictory evidence.

It can therefore turn a transient model impression into long-lived learner context after repeated model-generated observations.

### Transform it

Represent learner knowledge as **revisable, skill-linked hypotheses**, not descriptive sentences:

```ts
{
  skillId: "algebra.linear-equations.inverse-operations",
  hypothesis: "confuses subtracting a term with dividing a coefficient",
  status: "suspected" | "supported" | "resolved" | "disputed",
  evidence: [{
    attemptId,
    responseExcerpt,
    criterionId,
    supportLevel,
    evaluationConfidence,
    timestamp
  }],
  nextBestTest: "contrast-pair"
}
```

Make the tutor’s job to **propose** classifications; let a rule engine decide whether there is enough evidence to persist them.

Also distinguish:

- misconception,
- missing prerequisite,
- procedural slip,
- careless/format error,
- language-comprehension issue,
- low confidence/no attempt,
- overconfidence,
- disengagement or overload.

Those states require different interventions. A generic “weak area” does not.

---

## P0 — The tutor has conflicting instructional commands

Your most important policy conflict is in the base system prompt:

- “Before your first substantive response, the learner must have made an independent attempt” (`src/lib/llm.ts:52`)
- then, immediately after, “Default to direct help. Do not ask the learner a question unless it is essential” (`src/lib/llm.ts:53`)

Later instructions correctly require every instructional turn to leave the learner with a task (`src/lib/widgets/prompt.ts:162`). The later prompt is stronger pedagogically, but the model must reconcile inconsistent rules.

### Transform it

Replace broad prose rules with an explicit routing policy:

| Learner evidence               | Tutor action                                                                          |
| ------------------------------ | ------------------------------------------------------------------------------------- |
| No attempt / “I don’t know”    | Lower entry barrier: one micro-step, a worked micro-example, or representation choice |
| Plausible incomplete reasoning | Ask one focused self-explanation question                                             |
| Stable misconception           | Use a contrast pair or counterexample; require a revised rule                         |
| Repeated procedural slip       | Isolate the subskill, model one step, then immediately fade                           |
| Missing prerequisite           | Teach and check the smallest prerequisite, then return                                |
| Accurate unaided response      | Increase variation or give a transfer task                                            |
| Correct after strong help      | Mark **assisted performance**, not mastery                                            |
| Frustration / overload         | Reduce extraneous load, offer bounded choices, retain meaningful challenge            |

The policy engine should choose the route. The tutor should choose the wording, representation, and example.

---

## P1 — Hint escalation can be bypassed too easily

The model can request a higher hint level directly, and the session stores it:

- request validated as `0..3`: `src/lib/tutor.ts:1159`
- requested level persisted: `src/lib/tutor.ts:2231`

This is better than unrestricted answer disclosure, but the escalation decision is still model-controlled. There is no visible policy requiring a failed attempt, a meaningful wait period, an explanation of what was tried, or a recovery attempt before more help.

Research on intelligent tutoring systems consistently warns that premature or superficial hint use is associated with poorer learning outcomes. The relevant point is not “never give hints”; it is to preserve **productive help-seeking**.

### Transform it

Use a help-seeking ladder:

1. learner commits an attempt or names the exact blocker;
2. prompt asks them to identify relevant information;
3. strategic question;
4. relationship/pattern cue;
5. one intermediate step or analogous mini-example;
6. partial worked step;
7. bottom-out explanation only as a documented escape path;
8. always require an immediate reconstruction attempt afterward.

Log:

- attempt before hint,
- hint level,
- time spent,
- whether the learner read/opened it,
- quality of the retry,
- subsequent unaided performance.

Do not interpret a hint request as low ability. Treat it as a **support event** whose meaning depends on what happens next.

---

## P1 — Stage advancement checks only that the model supplied non-empty text

The validator requires an advancement rationale, which is good. But it does not verify that the rationale corresponds to:

- a learner response,
- a qualifying widget signal,
- the current stage’s exit criteria,
- an independently evaluated answer,
- an unaided attempt.

The rule is effectively: *the model may advance if it writes evidence text.* See `src/lib/tutor.ts:1694`.

### Transform it

Define per-stage **machine-checkable exit requirements**. For example:

- **Encounter:** learner commits one prediction and identifies the observable change/result.
- **Understand:** learner explains the mechanism in their own words and distinguishes a contrast pair.
- **Construct:** learner completes two critical steps, with support level ≤ 1.
- **Apply:** learner succeeds on multiple standard items independently.
- **Transfer:** learner succeeds on a novel representation/context and explains why the method applies.
- **Master:** learner passes delayed retrieval plus an unaided transfer item.

The model can nominate a stage change. The system should verify the evidence ledger before accepting it.

---

## P1 — “Every teaching turn needs a task” is directionally right but too rigid

The policy is a useful reaction against passive explanation. However, forcing a task on every instructional turn can produce unnecessary interruption, fragmented attention, and excessive widgets. The runtime fallback also adds a generic spoken prompt rather than an intentional instructional task when it detects passive board content (`src/lib/tutor.ts:494`).

### Transform it

Use **one meaningful cognitive commitment per instructional cycle**, not necessarily every message:

1. brief target and context,
2. prediction/retrieval/attempt,
3. minimum support,
4. reconstruction,
5. short evidence check.

A learner should never be passive for long, but they also should not be forced to answer a question after every sentence or visual. The quality of the task matters more than its frequency.

---

## P1 — The current sequence is linear where the knowledge model should be a graph

Curriculum order is treated as binding and the prompt asks the tutor to identify prerequisites (`src/lib/tutor.ts:1785`). That protects syllabus fidelity, but the prerequisite relationship itself appears to be prompt-inferred rather than represented as a durable graph.

### Transform it

Build a **skill graph** alongside the curriculum outline:

```text
Skill: solve linear equation
 ├─ preserve equality
 ├─ inverse operations
 ├─ integer arithmetic
 └─ translate verbal relation to equation
```

Each generated question, worked example, transfer task, and retrieval task should target one or more skill IDs. That allows the tutor to repair the smallest missing prerequisite instead of reteaching an entire chapter.

Keep the curriculum sequence as the instructional spine; use the skill graph as the adaptive detour map.

---

# A superior Guidance Flow

## 1. Orient and diagnose, rather than merely onboard

Your AI-authored onboarding is thoughtful and learner-centered (`src/components/SessionCard.tsx:278`). Keep goals, pace, preferred representation, accessibility needs, and confidence. But do not treat self-report as a diagnostic.

After onboarding, run a **short adaptive diagnostic**:

- one prerequisite retrieval,
- one prediction or misconception-sensitive hinge item,
- one representative application item,
- one confidence judgment: “How sure are you, 0–100?”

The objective is not a grade. It is to decide: begin, review a prerequisite, or offer a compressed route.

## 2. Teach in an evidence loop

For each micro-skill:

```text
Visible target
→ retrieval or prediction
→ learner attempt
→ diagnosis
→ minimum useful support
→ learner reconstruction
→ varied independent application
→ transfer / explanation
→ delayed retrieval scheduling
```

The tutor should never move from explanation directly to “Do you understand?” Instead, it should obtain observable evidence.

## 3. Separate learning modes clearly

A learner needs to know which evidence counts for what:

- **Explore:** manipulate, observe, hypothesize; low-stakes.
- **Guided practice:** hints are allowed; success is not mastery evidence.
- **Independent practice:** no modelled steps; builds procedure evidence.
- **Transfer check:** intentionally changed surface/context; builds transfer evidence.
- **Retention check:** delayed, no-notes retrieval; builds recall durability evidence.

This single distinction would improve both transparency and your data quality.

## 4. Make the tutor progressively disappear

A true torchbearer leaves the learner with methods they can use without it:

- model strategy selection aloud early;
- prompt the learner to choose a strategy in the middle;
- ask the learner to create a checklist, explanation, or example later;
- require independent work at the end;
- ask the learner to state when they would use the concept and when they would not.

The endpoint is not “the learner enjoys interacting with the tutor.” It is “the learner can regulate their own learning without it.”

## 5. Add deliberate metacognition

Require bounded reflections at meaningful points:

- **Plan:** “What is the goal? Which representation or strategy will you try?”
- **Monitor:** “What result would tell you this approach is wrong?”
- **Evaluate:** “What changed in your reasoning? What will you try first next time?”

Do not make these generic “How did that feel?” prompts. Tie them to the actual domain task and actual learner work.

---

# Suggested implementation order

## Phase 1 — Make claims auditable

1. Introduce skill IDs, prerequisite IDs, and evidence-event IDs.
2. Attach each widget response and graded test answer to a skill and support level.
3. Store the learner’s raw answer, rubric/expected criterion, evaluator confidence, and tutor intervention.
4. Make mastery cards render computed evidence summaries—not agent-created percentages.
5. Add an internal “why this next?” trace: evidence → learner state → policy route → next activity.

**Primary files:** `src/lib/tutor.ts`, `src/lib/learnerModel.ts`, `src/lib/mastery.ts`, `src/lib/widgets/signal.ts`, `src/lib/assessment.ts`.

## Phase 2 — Replace narrative adaptation with deterministic routing

1. Add the learning-state classifier and the routing table.
2. Tie hint escalation to attempts and post-hint reconstruction.
3. Define machine-checkable stage exits.
4. Integrate the existing assessment/evaluator path for all high-stakes mastery and transfer evidence.
5. Ensure “correct after hint” never elevates independence.

## Phase 3 — Build real retention

1. Persist due dates and retrieval history.
2. Generate varied review prompts from real curriculum evidence.
3. Show a review queue at session start.
4. Route failed retrieval to the smallest targeted repair.
5. Use the actual schedule, not a free-text `reviewIn` string.

## Phase 4 — Evaluate learning, not engagement

Run a baseline-versus-revised evaluation using:

- immediate independent performance,
- delayed retention at 1, 7, and 21+ days,
- transfer success on novel tasks,
- false-mastery rate,
- support fade rate,
- hint-to-reconstruction success,
- learner confidence calibration,
- misconception repair persistence,
- equity/accessibility outcomes,
- tutor-policy adherence,
- hallucination and unsupported-citation rate.

Do **not** judge the redesign primarily by conversation length, satisfaction, widget clicks, or immediate correct answers.

---

# Safety and learner dignity requirements

Your existing privacy controls are promising. Complete the policy with explicit boundaries:

- Never infer diagnoses, ability labels, identity traits, or motivation from sparse evidence.
- Explain what is stored, why it is used, and how learners can inspect, dispute, or delete it.
- Offer representation, pace, and practice-context choices without lowering the learning target by default.
- Label model uncertainty when curriculum evidence or evaluation confidence is weak.
- Detect and route self-harm, abuse, harassment, or acute distress to an appropriate human-support policy rather than attempting counseling.
- For minors or institutional use, add clear age-appropriate safeguards, data minimization, and human oversight.

---

# Research basis

The recommendations above are not an argument for “more AI.” They are an argument for making AI serve established instructional principles: active retrieval, worked-example fading, targeted feedback, metacognition, transfer, delayed retention, learner agency, and independently verified evidence.

1. [IES / What Works Clearinghouse — *Organizing Instruction and Study to Improve Student Learning*](https://ies.ed.gov/ncee/wwc/practiceguide/1)  
   Supports spacing, retrieval practice, worked-example/problem alternation, graphical plus verbal representations, and deep explanatory questions.

2. [Agarwal et al. — *Retrieval Practice Consistently Benefits Student Learning*](https://link.springer.com/article/10.1007/s10648-021-09595-9)  
   Systematic review of applied school/classroom research; supports retrieval practice across settings, while still requiring implementation and context sensitivity.

3. [EEF — *Feedback*](https://educationendowmentfoundation.org.uk/education-evidence/teaching-learning-toolkit/feedback)  
   Strongly supports feedback that is specific, actionable, task/subject/self-regulation focused, and followed by an opportunity to act on it.

4. [EEF — *Metacognition and Self-Regulated Learning*](https://educationendowmentfoundation.org.uk/education-evidence/guidance-reports/metacognition)  
   Supports embedding planning, monitoring, and evaluation in authentic curriculum tasks rather than teaching “thinking skills” in the abstract.

5. [Martineau, Karran, & Léger, 2025 — *Systematic Review of AI-Driven ITS in K–12*](https://pmc.ncbi.nlm.nih.gov/articles/PMC12078640/)  
   Finds generally positive but variable effects; reinforces that sound pedagogy, appropriate learner/context fit, and longer-term evaluation matter more than the “intelligence” label.

6. [Stamper, Xiao, & Hou, 2024 — *Enhancing LLM-Based Feedback*](https://arxiv.org/html/2405.04645)  
   A useful synthesis of ITS feedback research for LLM systems. Its key warning is directly relevant: many LLM-feedback designs lack learning-science grounding and meaningful learning evaluation.

7. [UNESCO — *Guidance for Generative AI in Education and Research*](https://www.unesco.org/en/articles/guidance-generative-ai-education-and-research)  
   Grounds the human-agency, privacy, equity, transparency, validation, and oversight recommendations.

8. [Sklavenitis et al., 2026 — *Revisiting the Hint Button*](https://dl.acm.org/doi/10.1145/3785022.3785040)  
   Recent replicated correlational evidence that premature hint requests and superficial hint reading are associated with lower learning gains. It supports better help-seeking design—not eliminating support.

9. [Pedagogical Applications of Generative AI in Higher Education: A Systematic Review](https://link.springer.com/article/10.1007/s11528-025-01100-1)  
   Highlights the central GenAI tension: efficiency and personalization can help, but overreliance can outsource the cognitive and metacognitive work education is meant to develop.

## Bottom line

Do **not** replace your Guide to Mastery. Its philosophy is strong.

Transform it from a **six-stage model instruction** into a **six-stage evidence protocol**:

> The model should decide *how to teach next*, but the system should decide *what has actually been learned*.

That shift—from tutor-authored claims to learner-authored evidence—is what would make Studyus less like an impressive AI study companion and more like a trustworthy guide that steadily teaches learners to carry the torch themselves.

An independent code audit reinforces the central conclusion: **Studyus has a sophisticated tutoring interface and strong pedagogical prompts, but its adaptive and mastery decisions are still mostly model-authored claims rather than per-skill, provenance-backed learning evidence.**

No code was changed.

### Most important verified additions

- **One session stage is not a per-skill model.** `chalkboard_sessions` stores one `mastery_stage` and evidence string, even though a session can cover multiple curriculum nodes. There is no target-level skill graph, prerequisite state, or per-objective progression. The ladder should be keyed to a specific learning target—not the whole conversation.

- **Assessment does not close the tutor loop.** The assessment system has real rubric generation and typed grading, but test results do not currently create learner-evidence records, update skill state, open a focused remediation episode, or schedule later transfer/retrieval checks. Tutor and assessment are presently parallel systems.

- **Hint restrictions are not enforced by the runtime.** The model can request hint levels 0–3 and the session persists the request. Structural widget validation does not verify that a given hint’s content matches the currently unlocked support level. Deep help can therefore contaminate what should count as independent evidence.

- **The learner model is free-text and incomplete.** Diagnoses are stored as model-written statements, without durable links to the learner’s response, targeted skill, rubric criterion, support level, correctness, confidence, timing, or later resolution. `recordInterventionOutcome` exists but is not wired into production learning flow.

- **Important historical evidence drops out of the decision context.** The tutor uses a short recent transcript window and a compact board summary. There is no canonical event ledger for attempts, retries, hint exposure, changed contexts, delay, or evaluator uncertainty.

- **Onboarding and opening behavior should be less rigid.** The onboarding flow requires exactly five questions despite language saying it should ask fewer when appropriate. More importantly, the first instructional episode should follow a deterministic diagnostic route, not depend on the tutor improvising whether to start with a prediction, prerequisite probe, or explanation.

### Refined product thesis

Build Studyus around this separation of responsibility:

> **The policy engine decides what evidence is missing and what learning move is warranted.  
> The LLM decides how to explain, question, represent, and encourage within that policy.**

That preserves the agent’s warmth and flexibility while making learning claims trustworthy.

### The data model to build first

For every meaningful learner action, persist a `LearningEvidence` event:

```ts
{
  evidenceId,
  learnerId,
  skillIds,
  taskId,
  taskFamily,
  contextVariant,
  response,
  correctness,
  rubricCriterionIds,
  supportLevel,
  hintExposure,
  responseTimeMs,
  selfRatedConfidence,
  evaluatorConfidence,
  delayed: boolean,
  source: "widget" | "assessment" | "tutor",
  timestamp
}
```

Then maintain a per-skill `SkillState`:

```ts
{
  skillId,
  learnerId,
  stage,
  evidenceIds,
  suspectedMisconceptions,
  prerequisiteStatus,
  recallStatus,
  understandingStatus,
  procedureStatus,
  transferStatus,
  independenceStatus,
  nextReviewAt,
  uncertainty
}
```

Only this state—not a tutor-generated percentage—should determine whether a learner is ready to advance or has mastered a skill.

### Priority order remains

1. **Evidence ledger + computed mastery**
2. **Per-skill stage state machine with machine-checkable exits**
3. **Code-enforced support fading**
4. **Assessment-to-remediation-to-transfer integration**
5. **Persisted spaced-review queue**
6. **Deterministic task-selection policy**
7. **Auditable evaluation using delayed retention and transfer**

### Additional research supporting this direction

- [Retrieval Practice Consistently Benefits Student Learning](https://link.springer.com/article/10.1007/s10648-021-09595-9) — systematic review finding benefits across classroom settings, formats, and delays.
- [Productive Failure Meta-analysis](https://journals.sagepub.com/doi/full/10.3102/00346543211019105) — problem solving before instruction can improve conceptual understanding and transfer, but must be calibrated to prior knowledge; it is not a universal opening strategy.
- [Worked Examples, Self-Explanation, and Transfer](https://eric.ed.gov/?id=EJ678596) — supports fading worked examples and requiring learners to explain steps.
- [K–12 Intelligent Tutoring Systems Systematic Review](https://doi.org/10.1038/s41539-025-00320-7) — finds promising but variable effects, with need for stronger longitudinal, diverse, learning-outcome evaluation.
- [Knowledge Tracing Review](https://link.springer.com/article/10.1007/s11257-023-09389-4) — cautions that predicting next-answer correctness is not equivalent to validly measuring mastery.

The system’s existing philosophy is sound. The transformational work is to turn its excellent **Guide to Mastery** from a prompt-driven narrative into an **auditable evidence protocol per skill**.
Its key conclusion is unchanged: the current flow is an unusually strong interactive, curriculum-grounded tutoring shell, but it should evolve into a per-skill evidence system where advancement, mastery, support fading, remediation, and spaced review are computed from recorded learner work—not model-authored scores or prose rationales.

---

# Widget, Visualization, and Agent Integration Blueprint

## Executive directive

Treat the 17 study widgets and the visualization system as **one learning ecosystem**, not two adjacent feature catalogs:

- A **widget** is an instructional move: orient, elicit, scaffold, diagnose, reconstruct, retrieve, or report evidence.
- A **visualization** is a domain-faithful representation: geometry, function, 3D surface, chart, equation, physics scene, biology pathway, circuit, chemistry structure, or graph-theory network.
- A **learning activity** joins one or more representations to one or more learner actions for a named target skill.
- A **learner action**, not a view, click, drag, or model narration, creates mastery evidence.

The board must answer a question such as: *“What is the learner trying to work out, what can they manipulate or explain, and what evidence will the system use to choose the next move?”* It must never become a gallery of attractive but disconnected cards.

This preserves the existing architecture:

- The LLM emits semantic widget and visualization intents—not HTML, canvas code, renderer names, or presets.
- `src/lib/visualization/router.ts` remains the only authority that maps a validated visualization intent to JSXGraph, KaTeX, ECharts, Three.js, Cytoscape, RDKit, or an honest unsupported result.
- `src/lib/widgets/validate.ts` and `src/lib/visualization/validate.ts` remain fail-closed structural boundaries.
- `board.html` remains the visual interaction prototype for the 17-widget board. The production React board is the behavioral source of truth; prototype behavior must be promoted deliberately, never copied as independent logic.

## Current assets to preserve and connect

The existing system already has the right building blocks:

| Layer | Existing capability | Integration rule |
| --- | --- | --- |
| Lesson flow | Six Guide-to-Mastery stages in `src/lib/mastery.ts` | Use stage as the current evidence goal for a **target skill**, never as decoration or a session-wide progress bar. |
| Widgets | 17 semantic widget intents in `src/lib/widgets/types.ts` | Every actionable widget declares what learner evidence it seeks. |
| Widget signals | Submission-based signals in `src/lib/widgets/signal.ts` | Convert each submitted action into a durable learning-evidence event before the LLM chooses a response. |
| Visualizations | Semantic intents plus router in `src/lib/visualization/` | Attach a visualization to an activity only when that representation changes what the learner can infer, test, construct, or explain. |
| Board state | Persistent widget and visualization state | Preserve manipulation state as interaction context, but do not treat it as evidence until the learner commits an observation, prediction, construction, or explanation. |
| Assessment | Source-grounded generation and rubric evaluation | Feed criterion-level outcomes into the same target-skill evidence ledger as board interactions. |
| Tutor | Structured turn with tool-policy filtering | Let the policy engine choose the permitted activity shape; let the tutor author precise wording, contexts, and representations. |

---

## 1. The shared activity contract

Introduce one renderer-agnostic **LearningActivityContract** that can be referenced by widgets, visualization blocks, generated assessment items, and review tasks. It is not a new renderer and does not replace either intent union.

```ts
interface LearningActivityContract {
  id: string;
  targetSkillIds: string[];
  prerequisiteSkillIds?: string[];
  stage: "encounter" | "understand" | "construct" | "apply" | "transfer" | "master";
  mode: "diagnostic" | "explore" | "guided_practice" | "independent_practice" | "transfer" | "retrieval" | "repair";
  taskFamily: string;
  contextVariant: "same" | "changed_numbers" | "changed_representation" | "changed_context" | "changed_constraints";
  supportCeiling: 0 | 1 | 2 | 3;
  expectedEvidence: Array<
    "prediction" | "observation" | "construction" | "selection" |
    "procedure" | "explanation" | "transfer" | "retrieval"
  >;
  successCriteria: string[];
  representationRoles?: Array<{
    blockId: string;
    role: "phenomenon" | "data" | "model" | "notation" | "contrast" | "feedback";
  }>;
}
```

### Non-negotiable rules

1. **One target, one reason.** Each activity names at least one target skill and one evidence type. A board block without a teaching purpose may remain a learner note, but is never used to advance learning state.
2. **Representations are coordinated, not duplicated.** A physics trajectory, a function graph, a table/chart, and an equation may describe the same idea only when the learner is asked to translate, compare, predict, or reconcile them.
3. **Interaction is not proof.** Opening a reveal, playing an animation, rotating a 3D graph, dragging a geometry point, hiding a chart series, or moving a slider is telemetry. It becomes instructional evidence only after a committed claim or construction.
4. **Support is explicit.** The policy writes the assistance ceiling before the tutor writes the activity. A Level 2–3 hint, worked step, revealed answer, or leading annotation produces assisted evidence and cannot count toward independence.
5. **Every support event requires reconstruction.** After a learner receives substantial support, create a nearby but not identical unaided retry. Do not quietly advance from an assisted correct answer.
6. **Use one activity cluster for one question.** Existing widget `group` support should become the board-level expression of an activity contract. A cluster may pair a visualization, an annotation, and a response widget, but it signals only after the intended answerable work is complete.
7. **The policy owns eligibility; the LLM owns expression.** The model can propose a representation or explanation but cannot mark target mastery, raise the help ceiling, or choose an invalid stage transition.

### Durable evidence event

When an activity is submitted, persist a target-linked event before requesting the next tutor turn:

```ts
interface LearningEvidenceEvent {
  id: string;
  activityId: string;
  learnerId: string;
  targetSkillIds: string[];
  source: "widget" | "visualization_response" | "assessment";
  evidenceType: "prediction" | "observation" | "construction" | "selection" | "procedure" | "explanation" | "transfer" | "retrieval";
  taskFamily: string;
  contextVariant: string;
  supportLevel: 0 | 1 | 2 | 3;
  supportExposures: string[];
  learnerResponse?: string;
  interactionState?: Record<string, unknown>;
  correctness?: boolean;
  rubricCriterionIds?: string[];
  evaluatorConfidence?: number;
  learnerConfidence?: number;
  latencyMs?: number;
  delayed: boolean;
  createdAt: string;
}
```

The raw response and relevant board state should be available to evaluation, but retention must remain bounded, learner-visible, disputable, and deletable. Do not collect continuous cursor paths, keystroke dynamics, or affect inferences merely because the board can observe them.

---

## 2. The harmonious board grammar

A strong board activity follows this grammar:

```text
Target + success criterion
→ a meaningful phenomenon / representation
→ prediction, retrieval, selection, construction, or explanation
→ evidence-aware feedback
→ minimum support only if required
→ reconstruction in the same or an adjacent representation
→ later changed-context transfer or delayed retrieval
```

### Required relationships between blocks

| Relationship | Meaning | Example |
| --- | --- | --- |
| `phenomenon → claim` | Learner predicts or observes a visual phenomenon. | Animation of a projectile → “At the peak, what are velocity and acceleration?” |
| `representation ↔ representation` | Learner maps the same relation across forms. | Motion scene ↔ position-time chart ↔ equation. |
| `worked step → faded step` | Support is deliberately removed. | Example completes steps 1–2; scratchpad requires step 3 and its reason. |
| `error → repair → retry` | Feedback produces a learner revision. | Mistake Check identifies sign error → short repair question → changed-number retry. |
| `current task → delayed review` | Durable recall is planned. | Memory Hook tags target skill → ReviewTask later produces an unaided Retrieval Check. |

### Board composition directives

- Prefer a **small connected constellation** of two to four blocks per activity over a board-wide scatter of unrelated widgets.
- Keep a visual representation next to the action it supports. If a learner must inspect a graph to answer a question, place or link the question with the graph; do not make them pan across the board to hunt for it.
- Use `update_widget` and `update_visualization` to evolve a current activity in place. Do not append duplicate cards to simulate progression.
- Preserve learner-created sketches, board strokes, point positions, graph camera, and chart viewport as context. Explicitly label when the learner’s construction is being assessed versus merely explored.
- The generic `diagram` intent is intentionally unsupported by the router. Do not revive free-form/preset diagrams. Choose the actual domain intent—geometry, function, physics, biology, circuit, chemistry, chart, equation, or graph theory—or return an honest unsupported state.

---

## 3. Widget directives: all 17 roles in the evidence-led flow

The following table defines what each widget is for, what it may contribute to the evidence ledger, and which visualization partnerships make it stronger. A widget is not required in every lesson; use it only when its move is warranted by the learner state.

| Widget | Primary learning move | Valid evidence only when | Strong visualization partnership | Do not use it for |
| --- | --- | --- | --- | --- |
| **Roadmap** | Orient to target, sequence, and next evidence milestone. | It does **not** produce mastery evidence. | Any representation; use the roadmap to label the current target, not all board content. | A click-through curriculum, streak, or completion meter. |
| **Concept Card** | Stabilize a definition after a prediction, contrast, or encounter. | Learner later recalls, classifies, or applies the definition. | Equation, labeled geometry, physics/circuit/chemistry structure, chart legend. | Opening with vocabulary dump or counting a read card as understanding. |
| **Slider** | Vary one parameter and inspect an invariant/relationship. | Learner commits an observation or prediction through `respond`. | Function graph, geometry construction, chart parameter sweep, physics scene. | Treating the final slider value or a drag as proof of understanding. |
| **Animation** | Make change, causality, or an otherwise invisible process inspectable over time. | Learner predicts before viewing, explains a checkpoint, or reconciles prediction with result. | Function/geometry/physics/biology/circuit/chemistry visualization snapshots. | Decorative playback, autoplay explanation, or passive “watch this” media. |
| **Comparison** | Separate near concepts or competing models through a contrast pair. | Learner identifies the discriminating feature or applies the distinction to a new case. | Side-by-side charts, equations, graphs, molecule/reaction states, biology pathways. | A two-column fact list with no decision or contrast question. |
| **Question** | Fast hinge check, retrieval prompt, or misconception-sensitive choice. | Answer is graded or evaluated against a criterion; one item remains weak evidence. | Annotated visual, function chart, diagram, or table. | Repeated recognition-only quizzes masquerading as mastery. |
| **Hint** | Learner-controlled minimum support. | Support use is logged; only a subsequent retry supplies learning evidence. | Annotation, isolated equation term, highlighted graph segment, visual cue. | Answer delivery, automatic escalation, or independence credit after deep help. |
| **Scratchpad** | Let the learner construct a step, derivation, diagram explanation, or plan. | Submitted work is evaluated line-by-line or criterion-by-criterion. | Editable equation, geometry/graph screenshot, chart/data table, science figure. | A blank note field with no target or evaluation route. |
| **Annotation** | Direct attention to exactly one relevant feature. | Learner commits why that feature matters; not when they merely view a mark. | Any existing visual block, especially graph features, vectors, geometry notation, chart regions, or reaction sites. | A generic arrow-plus-explanation that does the learner’s noticing. |
| **Reveal** | Delay a key fact, answer, or step until the learner has attempted or committed. | The pre-reveal attempt and post-reveal reconstruction are both recorded. | Worked equation, chart series, construction object, simulation state. | A “spoiler button” shown before a learner has an attainable attempt. |
| **Example** | Model a solution with a reason for each step, then fade. | No direct mastery evidence; use the next faded task for evidence. | Equation, graph, geometry construction, physics diagram, chemistry reaction pathway. | Completing the assessed problem or presenting an unbroken full solution to a novice. |
| **Mistake Check** | Turn an error into a diagnosed, repairable rule. | Learner names/corrects the underlying issue and succeeds on an isomorphic retry. | Annotated scratchpad/equation, graph, geometry construction, chart interpretation. | Showing the correction before the learner has had an opportunity to reason. |
| **Memory Hook** | Compress a durable cue after meaningful understanding. | Later unaided retrieval confirms value; hook creation itself is not recall evidence. | A compact equation, diagram feature, or visual mnemonic tied to a target skill. | A slogan replacing explanation or a gamified “collectible.” |
| **Retrieval Check** | Delayed no-notes recall, application, or discrimination. | It is due, unaided, evaluated, and linked to prior target evidence. | A deliberately changed representation of a previously learned idea. | An immediate restatement after exposure or a generic daily streak quiz. |
| **Challenge** | Independent application or transfer under clear success criteria. | Response is evaluated; `transferNote` must reflect a real changed context/representation/constraint. | Any domain visual supplied without explanatory overlays. | Hidden scaffolds, leading prompts, or a novelty story unrelated to the target. |
| **Reflection** | Elicit self-explanation, strategy monitoring, and revision of a mental model. | Rubric looks for mechanism/condition/strategy—not fluency or word count. | Learner refers to a visible model, chart, equation, or construction. | Generic feelings check-ins or personality judgments. |
| **Mastery Card** | Report the system-computed state, evidence IDs, weak link, and next review. | It never creates or self-scores evidence. | Compact links/previews of the evidence representations used. | A celebration badge, raw average, or model-authored percentage claim. |

### Stage-to-widget policy

| Stage | Main learner obligation | Preferred moves | Visual role |
| --- | --- | --- | --- |
| Encounter | Predict or notice a phenomenon. | Question, Animation, Slider with response, Reveal after attempt. | Phenomenon first; notation only when it resolves the puzzle. |
| Understand | Explain mechanism, condition, and boundary. | Comparison, Annotation with response, Reflection, concept card after evidence. | Deliberate translation among concrete, visual, symbolic, and verbal forms. |
| Construct | Complete a method with fading support. | Example → Scratchpad → Hint only when needed → Mistake Check. | Preserve the representation the method is about; highlight one relevant relation at a time. |
| Apply | Solve standard instances independently. | Question clusters, Scratchpad, Challenge without transfer note. | Change numbers and superficial appearance, not the governing representation by default. |
| Transfer | Select and use the idea in a genuinely changed situation. | Challenge with transfer note, Comparison, Reflection. | Change representation, context, constraints, or data source intentionally. |
| Master | Recall and use it after delay with support withdrawn. | Retrieval Check, reflection, computed Mastery Card. | Use sparse, changed-context cues; no solution overlays or leading annotations. |

---

## 4. Animation: transform it from playback into an experiment

The current animation widget already has the correct beginnings: frames, an optional parametric path, a prediction prompt, a response affordance, persistent playhead state, and reduced-motion handling (`src/lib/widgets/types.ts`, `src/components/board/WidgetSurface.tsx`). Its limitation is conceptual: it primarily renders a moving point plus captions. It cannot yet represent a learner-controlled **change model** with meaningful states, competing hypotheses, linked representations, and checkpoint evidence.

### Animation product principle

> An animation earns board space only when time, sequence, rate, causality, or state transition is the concept being learned. The learner must predict, inspect, explain, or control that change.

### Required animation lifecycle

1. **Target and question.** State the capability and the observable success criterion.
2. **Prediction lock.** Before playing or exposing the decisive transition, the learner predicts an outcome, a direction of change, a threshold, a next state, or a comparison. The prediction is stored separately from the post-view explanation.
3. **Controlled observation.** Learner may play, pause, replay, scrub, or use accessible step controls. Autoplay is off by default.
4. **Checkpoint.** At one or more meaningful moments, freeze or pause and ask a specific question tied to the mechanism.
5. **Explanation and reconciliation.** Show prediction and observation together. Ask what matched, what did not, and why.
6. **Reconstruction.** Require a changed-case prediction, a linked representation choice, a scratchpad explanation, or a new construction without replaying the answer.
7. **Evidence classification.** Record prediction, checkpoint response, explanation, support used, and reconstruction separately. Watching alone has no evidence value.

### Animation intent evolution

Extend the semantic animation intent carefully. Do not add renderer-specific fields, raw SVG, JavaScript expressions beyond the bounded expression model, or opaque “animation presets.” Add a small, domain-neutral scene protocol:

```ts
interface AnimationWidget extends WidgetBase {
  kind: "animation";
  activityId?: string;
  frames: AnimationFrame[];
  motion?: AnimationMotion;
  durationMs?: number;
  loop?: boolean;
  predictPrompt?: string;
  checkpoints?: Array<{
    id: string;
    at: number; // normalized 0..1
    prompt: string;
    evidenceType: "observation" | "explanation" | "selection";
    expectedPoints?: string[];
  }>;
  controls?: {
    replay?: boolean;
    scrub?: boolean;
    step?: boolean;
    rateOptions?: number[];
  };
  linkedRepresentations?: Array<{
    targetAnchor: string;
    role: "phenomenon" | "data" | "model" | "notation" | "contrast";
    sync: "none" | "highlight" | "progress" | "parameter";
  }>;
  respond?: WidgetRespondSpec;
}
```

### Animation state evolution

Keep compact learner-authored state. Record semantic milestones rather than every playback frame:

```ts
interface WidgetState {
  animationProgress?: number;
  animationPlayed?: boolean;
  animationCheckpointResponses?: Record<string, string>;
  animationPrediction?: string;
  animationReplays?: number;
  animationRate?: number;
  // Existing responseText/submitted remains the final committed explanation.
}
```

Do not log a continuous playback trace. It is noisy, privacy-invasive, and pedagogically weaker than prediction, checkpoint, and reconstruction evidence.

### Smart animation patterns

| Pattern | Best use | Learner action | Connected representation |
| --- | --- | --- | --- |
| **Prediction error** | Counterintuitive motion/state change. | Predict before play; explain mismatch at checkpoint. | Physics scene ↔ graph/equation. |
| **State transition** | Biological pathway, circuit switch, reaction, algorithm step. | Identify next state or condition triggering transition. | Biology/circuit/chemistry ↔ causal diagram/table. |
| **Parameter sweep** | Relationship changes as one variable changes. | Predict invariant and limiting behavior; alter parameter. | Slider ↔ function/geometry/chart ↔ animation. |
| **Construction reveal** | Geometry or symbolic method unfolds step by step. | Choose the next construction step before reveal. | Geometry/equation ↔ Scratchpad/Example. |
| **Competing models** | Same evidence, different predictions. | Pick model before playback and revise rule after. | Two functions/charts or two diagrams ↔ Comparison. |
| **Micro-simulation** | Rate, accumulation, feedback loops, forces, fields. | Pause at checkpoint; state cause and next effect. | Physics/biology/network ↔ chart of a measured quantity. |

### Animation guardrails

- A prediction prompt must be answerable from prior knowledge, visible conditions, or a bounded choice. Do not demand a guess from a learner with no foothold.
- If prior evidence shows a prerequisite gap, use a short self-explaining worked micro-example before the animation rather than treating incorrect prediction as failure.
- Captions must name the mechanism or condition at each frame; captions that merely narrate what is visible are insufficient.
- `prefers-reduced-motion` must provide step-through frames with the same prediction/checkpoint/reconstruction logic. Reduced motion is not a reduced lesson.
- Captions, keyboard controls, pause/replay, visible playhead position, and non-color-only distinctions are required.
- Visuals must not use simulated urgency, countdown pressure, noisy reward effects, or motion that competes with the learning signal.

---

## 5. Visualization integration directives

The existing visualization router is the integration boundary. The LLM names the subject-matter object; the router selects the faithful renderer. Do not expose adapter names such as JSXGraph or ECharts to the tutor prompt.

### Geometry and function graphs

**Use for:** invariance, coordinate relationships, transformations, derivative/integral intuition, construction, intersections, rate of change, and changed representations.

**Smart pairings:**

- Geometry + Slider: move a point; learner predicts what remains invariant, then explains the observed relationship.
- Geometry + Annotation: mark one side, angle, midpoint, or construction step; learner explains why it matters.
- Function + Animation: link time progress to a moving point and a current graph location; learner connects motion to slope/area/rate.
- Function + Question: use an unannotated graph for independent interpretation; do not leave roots/tangents/areas highlighted during an independence check.
- Equation + Scratchpad: show only the relevant expression; learner supplies the next transformation and its reason.

**Evidence rule:** dragged point positions and camera state are context. A stated invariant, a constructed object, or a submitted explanation supplies the evidence.

### 3D graphs

**Use for:** surfaces, vector fields, cross-sections, parameterized curves/surfaces, and spatial structure where rotation changes comprehension.

**Directive:** pair the 3D scene with one 2D slice, equation, chart, or short prediction. “Rotate until it makes sense” is not an instructional activity. Ask the learner to identify a cross-section, predict how a parameter changes the surface, or map a point from symbolic to spatial form.

**Accessibility:** provide a named view/state and a textual description of the spatial relation; mouse-only camera movement cannot be the sole learning route.

### Charts and data tools

**Use for:** evidence interpretation, trend/variation, distribution, uncertainty, comparing models, and decision making from data.

**Smart pairings:**

- Chart + Prediction: hide a final region/series until the learner forecasts trend/direction.
- Chart + Annotation: mark one outlier, crossing, threshold, or interval and ask for the claim it supports.
- Chart + Comparison: place near-identical charts with one meaningful scale/data difference; ask what changes the conclusion.
- Chart + Challenge: remove overlays, tooltips that disclose conclusions, and highlighted regions for independent data reasoning.
- Chart + Scratchpad: learner writes a claim, cites visual evidence, and states a limitation or alternative interpretation.

**Evidence rule:** viewport changes, legend toggles, and tooltip views are not evidence. A claim with cited data pattern and reasoning is.

### Physics, circuits, chemistry, biology, and graph theory

| Domain intent | Use the visual for | Strong learner action | Avoid |
| --- | --- | --- | --- |
| Physics | Forces, rays, vector relationships, motion, constraints. | Predict vector direction/magnitude, complete a free-body diagram rationale, connect scene to graph. | Decorative diagrams with labels that give the answer. |
| Circuit | Current paths, component roles, switch state, measurement relations. | Predict what changes when a switch opens/closes; justify using circuit relationships. | Treating diagram recognition as circuit reasoning. |
| Chemistry | Structure, reaction state, atom/bond relations, stoichiometric transformation. | Identify changed atoms/bonds, predict product/property, explain conservation/constraint. | Generic geometry for molecules or unsupported bond-angle commentary. |
| Biology | Cell structures, DNA, pathways, systems. | Predict next pathway effect, trace causal propagation, compare disrupted vs normal path. | Colorful pathway viewing with no causal question. |
| Graph theory | Paths, flow, dependencies, network structure. | Construct/identify a path, explain edge direction/weight consequence, test changed network constraint. | Unbounded network exploration without a target decision. |

### Equations

Equations should join an activity as a **notation representation**, never appear as a wall of formalism. Use the existing equation actions to highlight terms, reveal only the next permitted step, and ask the learner to complete a transformation. For unaided tasks, remove revealed steps and term highlights before scoring procedure or independence.

### Rendering failure directive

If an intent cannot be faithfully rendered, preserve the current honest unsupported response. Do not silently substitute generic SVG art, a nearest-looking visualization, or explanatory prose that claims a figure was drawn. Offer an alternate valid representation only when it can teach the same target without changing the evidence requirement.

---

## 6. Agent directives: planner, tutor, and verifier

### A. Deterministic activity planner

Run before each substantive tutor turn. Its inputs are target-skill state, prerequisite state, prior evidence, support history, due reviews, accessibility preferences, and curriculum evidence. It returns one bounded next move.

```ts
interface NextLearningMove {
  targetSkillId: string;
  stage: MasteryStage;
  route:
    | "diagnostic_probe"
    | "prediction"
    | "contrast_case"
    | "prerequisite_repair"
    | "faded_example"
    | "guided_retry"
    | "independent_practice"
    | "transfer_check"
    | "due_retrieval";
  supportCeiling: 0 | 1 | 2 | 3;
  requiredEvidence: string[];
  permittedWidgetKinds: WidgetKind[];
  recommendedRepresentationRoles: string[];
  rationaleEvidenceIds: string[];
}
```

**Planner rules**

1. If a review is due, choose a no-notes retrieval task before new instruction unless the learner explicitly defers it.
2. If the learner has no usable prerequisite evidence, select one short diagnostic probe or entry-level representation—not a full lesson.
3. If evidence indicates a stable misconception, choose a contrast or counterexample before another identical problem.
4. If the learner has a procedural slip, isolate the smallest step, show at most one modeled step, then require a faded retry.
5. If a learner succeeds only with support, choose an isomorphic but less-supported reconstruction; do not advance.
6. If the learner is accurate and fluent without support, select a changed-context transfer check or schedule a delayed retrieval—not more of the same.
7. If evaluator uncertainty is high, route to a clarifying activity or human review state; do not update mastery confidently.
8. Offer bounded learner choices of equivalent context or representation when they do not compromise the target or evidence standard.

### B. Tutor authoring directive

The tutor receives the selected move and creates its semantic board intents.

> Use the selected target, route, support ceiling, evidence requirements, and curriculum evidence as binding constraints. Build one connected activity cluster. Ask before telling unless the policy explicitly selects a worked micro-example or the learner requests a non-instructional visual rendering. Cite the learner’s actual submitted work in feedback. Give exactly the minimum support allowed. End an instructional cycle with an observable learner action, not a request for permission. Do not claim mastery, a misconception, an emotional state, or a learning gain without the evidence records supplied to you.

For each response, the tutor should return a compact proposal in addition to board operations:

```json
{
  "activity_id": "…",
  "target_skill_ids": ["…"],
  "evidence_expected": ["prediction", "explanation"],
  "support_used": 0,
  "representation_rationale": "A function graph makes the changing rate visible.",
  "board_ops": []
}
```

The runtime validates target IDs, permitted widgets, help ceilings, linked anchors, and evidence types. Reject or repair an invalid proposal rather than silently coercing it.

### C. Evidence verifier directive

After a learner submits an activity:

1. Write the raw evidence event.
2. Grade deterministically when possible; otherwise route the response through the existing rubric evaluator.
3. Record evaluator uncertainty and assistance exposure.
4. Update only the relevant skill state using defined rules.
5. Evaluate stage predicates from evidence events—not tutor prose.
6. Supply the tutor a short learner-facing feedback frame:

> **What worked:** [observable strategy or correct relation].  
> **Check this:** [precise gap or uncertainty].  
> **Next move:** [one bounded action].

Never let the verifier generate a final solution or a motivational judgment. Its job is state transition and traceability.

### D. Trace and graceful-degradation directives

- Persist: policy version, prompt version, activity ID, evidence IDs, selected route, support ceiling, representation choices, outcome, and later retention/transfer result.
- Cap planner/tutor/repair iterations for one learner submission. A failed evaluator or renderer must produce a clear recoverable state, not an infinite repair loop.
- If a visualization adapter fails, preserve the learner response opportunity through a valid alternate widget or an honest unavailable notice. Never invent visual evidence.
- Keep only active, target-relevant evidence in the prompt. The event store can retain bounded history, but the tutor context should receive a concise, revisable summary plus links/IDs for current target evidence.

---

## 7. Implementation plan

### Phase 0 — Establish contracts and baseline tests

1. Define `LearningActivityContract`, target-skill IDs, representation roles, and `LearningEvidenceEvent` in a shared learning-model module.
2. Add target and activity metadata to widget/visualization intents without exposing renderer details.
3. Write unit tests proving invalid target IDs, unsupported evidence types, and widget/visual links fail closed.
4. Capture baseline metrics: unaided accuracy, transfer rate, review completion, hint depth, false mastery, and accessibility failure rate.

**Likely files:** `src/lib/widgets/types.ts`, `src/lib/visualization/types.ts`, `src/lib/widgets/validate.ts`, `src/lib/visualization/validate.ts`, `src/lib/mastery.ts`, `src/db/database.ts`.

### Phase 1 — Build the shared evidence path

1. In `src/lib/widgets/signal.ts`, convert each meaningful submission into a target-linked evidence event instead of only a tutor text signal.
2. Add equivalent evidence capture for assessed responses in `src/lib/assessment.ts`.
3. Record support exposure from hints, reveals, worked steps, annotations, and permitted visual overlays.
4. Persist only semantic interaction milestones for sliders, animation, and visualizations.
5. Update `src/lib/learnerModel.ts` to summarize evidence-backed skill hypotheses rather than unbounded model-written labels.

**Definition of done:** a board answer, an assessment answer, and a delayed retrieval are visible as the same evidence type in one learner timeline.

### Phase 2 — Turn the ladder into target-level policy

1. Store stage, prerequisites, and stage-entry evidence per skill/learning target.
2. Implement stage predicates; replace prose-only progression in `resolveNextMasteryStage` with evidence checks.
3. Build `NextLearningMove` routing for diagnostic, repair, fading, application, transfer, and retrieval.
4. Enforce hints as support ceilings, with mandatory unaided reconstruction after substantive support.
5. Replace model-authored mastery percentages with a computed evidence report and evidence links.

**Definition of done:** the tutor cannot advance or mark mastery with only a persuasive string, a clicked widget, or a correct response after deep help.

### Phase 3 — Connect visualizations to activity evidence

1. Add activity/target metadata and anchor linking to visualizations and widgets.
2. Implement `representationRoles` and block-link UI affordances, such as a subtle “used in this task” connector/highlight, without making the board visually noisy.
3. Upgrade Animation with prediction-lock, step/scrub/replay controls, checkpoints, and linked-representation synchronization.
4. Integrate Geometry, Function, Chart, Equation, Physics, Biology, Circuit, Chemistry, Graph Theory, and Graph3D according to the directives above.
5. Add keyboard, caption, reduced-motion, and textual-equivalent paths as acceptance criteria for every new visual interaction.

**Definition of done:** every interactive visual used for learning has an explicit learner claim or construction path, and every claim links to a target skill/evidence event.

### Phase 4 — Retrieval and assessment closure

1. Persist `ReviewTask` records from earned evidence; use the existing spacing logic only through an actual queue.
2. On session opening, select one or two due no-notes reviews before new content, with learner deferral controls.
3. On retrieval failure, reopen the smallest target-specific repair activity, then require a later retry.
4. Connect assessment criterion results to target skill state, remediation route, and varied transfer task selection.
5. Add learner-visible “why this next?” explanations based on evidence, not opaque model reasoning.

### Phase 5 — Evaluation and policy hardening

1. Compare baseline and revised flow on delayed retention, transfer, false mastery, time-to-unaided success, calibration, hint-to-retry conversion, and learner agency.
2. Audit outcomes across subject, declared accessibility/language setting, prior evidence level, and representation route; avoid inferring sensitive traits.
3. Sample traces to check that the tutor cited actual learner evidence, used the selected policy route, and did not over-scaffold.
4. Add human-review/handoff states for high uncertainty, repeated unresolved difficulty, safety concerns, or high-stakes grading contexts.

---

## 8. File-level integration map

| Area | Primary files | Responsibility after integration |
| --- | --- | --- |
| Activity/evidence contract | New focused learning-policy/evidence module; `src/db/database.ts` | Target IDs, evidence events, review tasks, activity traces. |
| Widget semantics | `src/lib/widgets/types.ts`, `src/lib/widgets/validate.ts`, `src/lib/widgets/signal.ts` | Activity metadata, meaningful signals, support telemetry, fail-closed validation. |
| Widget rendering | `src/components/board/WidgetSurface.tsx` | Accessible controls, Animation checkpoints/scrubbing, learner response UI; never makes mastery decisions. |
| Visualization semantics | `src/lib/visualization/types.ts`, `src/lib/visualization/validate.ts`, `src/lib/visualization/router.ts` | Target-linked representation roles while retaining renderer-agnostic routing. |
| Visualization rendering | `src/components/board/VisualizationSurface.tsx` | Faithful domain rendering, semantic interaction milestones, accessibility fallbacks. |
| Board composition | `src/components/board/Chalkboard.tsx`, `src/components/board/StudyRoom.tsx` | Persist block state, preserve activity cluster links, apply validated updates in place. |
| Tutor protocol | `src/lib/tutor.ts`, `src/lib/llm.ts`, `src/lib/widgets/prompt.ts` | Receives policy-selected move; authors pedagogically precise, bounded semantic intents. |
| Learner model and mastery | `src/lib/learnerModel.ts`, `src/lib/mastery.ts` | Computes target state, stage eligibility, support-aware evidence, spaced review. |
| Assessment bridge | `src/lib/generator.ts`, `src/lib/questionBank.ts`, `src/lib/assessment.ts`, `src/lib/evaluator.ts` | Maps item criteria to target skills and emits shared evidence events. |
| Prototype parity | `board.html` | Documents and demonstrates the interaction grammar; does not become a second production lesson engine. |

---

## 9. Acceptance checks

A reviewer should be able to answer **yes** to every question below before this integration ships.

### Learning and evidence

- Does each instructional activity name a target skill, evidence type, support ceiling, and success criterion?
- Does the learner predict, attempt, construct, explain, retrieve, or make a defensible selection before receiving the decisive answer?
- Are visual interactions distinguished from evidence-bearing claims?
- Does every significant hint, reveal, worked step, or annotation lower the independence value of the immediate response?
- Does deeper support trigger an unaided reconstruction rather than an advance?
- Are stage transitions and mastery computed from enough target-linked evidence across task families, support levels, and changed contexts?
- Are delayed retrieval and transfer checks actually scheduled and executed?

### Widget and visual ecosystem

- Does each widget have a specific instructional reason rather than merely occupying board space?
- Does every visualization change what the learner can infer, test, construct, or explain?
- Are visualizations paired with a meaningful action only when evidence is needed, rather than mechanically adding a question after every visual?
- Does the Animation widget require prediction/checkpoint/reconciliation/reconstruction when used instructionally?
- Do geometry, graph, chart, equation, science, network, and 3D tools stay semantic and renderer-agnostic?
- Does an unsupported visual fail honestly rather than substituting a misleading placeholder?
- Are board edits in place, linked to the current activity, and free of duplicate card accumulation?

### Agency, access, and safety

- Can learners choose among equivalent context, pace, or representation routes without lowering the target standard?
- Can a keyboard-only or reduced-motion learner complete the same evidence-producing activity as a pointer/motion learner?
- Are captions, textual equivalents, and non-color-only cues present where visual change matters?
- Can learners inspect, dispute, correct, or delete retained learning observations?
- Does the tutor avoid inferring diagnoses, identity traits, emotional states, or capability labels from thin evidence?
- Are uncertainty, repeated unresolved struggle, safety issues, and high-stakes decisions routed to a clear human-support policy?

### Engineering and evaluation

- Is every agent proposal validated against the policy-selected target, allowed support level, available curriculum evidence, and renderer/widget contracts?
- Is the trace from `evidence → skill state → next move → representation → outcome` inspectable without exposing private chain-of-thought?
- Are agent/tool repair loops bounded and failures learner-safe?
- Are policy revisions evaluated on delayed retention, transfer, false mastery, calibration, and time-to-unaided success—not just engagement or immediate correctness?

## Final directive

Do not make Studyus more animated, more visual, or more agentic merely to appear more advanced. Make each additional widget control, animation frame, graph affordance, diagram, and agent action earn its place by helping a learner form, test, explain, revise, or retrieve a target idea.

> **The board is not where the tutor performs knowledge. It is where the learner leaves evidence that they can carry knowledge forward without the tutor.**
