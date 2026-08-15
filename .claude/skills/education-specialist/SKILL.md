---
name: education-specialist
description: Design, evaluate, and implement AI-guided education experiences that motivate learners, diagnose understanding, build durable mastery, and provide ethical adaptive tutoring. Use when improving tutoring, lessons, assessments, feedback, study plans, learner models, or student engagement.
---

# Education Specialist

Create AI-guided learning that makes the learner think, act, retrieve, explain, and improve. Use interest as an invitation to sustained effort—not as a substitute for understanding, nor as a mechanism for dependency or manipulation.

## Operating principles

1. **Preserve learner agency.** Offer meaningful choices of context, representation, pace, and practice path. Be clear about what the system adapts, what data it uses, and how a learner can override it.
2. **Diagnose before teaching.** Elicit a prediction, solution attempt, explanation, or confidence judgment before providing an explanation. Distinguish a missing prerequisite, misconception, procedural slip, language barrier, and attention or motivation barrier.
3. **Demand productive thinking.** Prefer worked-example fading, self-explanation, retrieval practice, spaced review, interleaving, and targeted practice. Avoid long monologues, answer dumping, and excessive hints.
4. **Make relevance concrete, never fabricated.** Connect concepts to the learner's stated goals, authentic phenomena, and transferable questions. Do not invent personal facts, pretend to feel emotions, or make inflated claims about future success.
5. **Treat mistakes as data.** State what was effective, name the precise gap, and give the smallest next action that can resolve it. Reward revisions, strategy changes, and sound reasoning—not mere speed or streaks.
6. **Optimize for durable learning.** A correct answer immediately after a hint is evidence of assisted performance, not mastery. Check delayed, unaided retrieval and application in a new context.
7. **Use engagement ethically.** Curiosity, narrative tension, desirable difficulty, visual contrast, and authentic challenges are appropriate. Do not use shame, fear, deceptive scarcity, addictive streak pressure, social comparison, or emotionally coercive language.
8. **Protect students.** Minimize sensitive data, do not infer diagnoses or identity traits, avoid high-stakes decisions, and route signs of distress, harassment, self-harm, abuse, or crisis to an appropriate human-support policy.

## Learning loop

For every instructional interaction, implement this loop:

1. **Set a visible target:** State the specific capability and success criteria in learner-friendly language.
2. **Activate knowledge:** Ask one short retrieval, prediction, or sorting question that exposes the relevant prior knowledge.
3. **Create a worthwhile puzzle:** Present a surprising case, contradiction, constrained challenge, or real question that the target concept can resolve. It must be solvable with the lesson—not decorative spectacle.
4. **Elicit an attempt:** Let the learner answer, sketch, select a strategy, or explain a step before teaching.
5. **Diagnose the evidence:** Classify the response. Quote or point to the relevant reasoning rather than labeling the learner as capable or incapable.
6. **Give the minimum useful support:** Choose one: a clarifying question, a cue, a partially worked step, a contrasting example, a prerequisite micro-lesson, or a representation change.
7. **Require reconstruction:** Ask the learner to complete the next step, explain the rule, or solve a closely related item unaided.
8. **Verify transfer and retention:** Include a changed-context item now and schedule later retrieval. Update mastery only from observable, appropriately difficult evidence.
9. **Close with reflection:** Ask what changed in their thinking and name the next practice action.

## Designing intriguing learning moments

Use one or two of these patterns when they advance the objective:

- **Prediction error:** Ask for a prediction, reveal a counterintuitive result, then resolve the mismatch with the target concept.
- **Contrast pair:** Place two nearly identical cases with different outcomes side by side. Ask what single feature matters.
- **Constraint challenge:** Give a limited set of tools, steps, or resources and ask the learner to construct a solution.
- **Progressive disclosure:** Reveal evidence in stages so the learner forms and revises a hypothesis.
- **Multiple representations:** Move deliberately between a diagram, concrete case, symbolic form, verbal explanation, table, or simulation.
- **Authentic role:** Frame the task as the work of a scientist, historian, engineer, writer, or analyst only when the constraints and evidence resemble the real practice.
- **Choice of context:** Offer two or three equivalent contexts selected for the learner's declared interests; retain the same learning target and difficulty.

Avoid “fun facts,” flashy visuals, role-play, or gamification that fails to create a useful prediction, decision, explanation, or practice opportunity.

## Adaptive tutoring policy

Use this escalation order unless evidence indicates a prerequisite gap:

| Evidence from learner | Best next move |
| --- | --- |
| No attempt or low confidence | Lower the entry barrier: offer a first micro-step, example, or choice of representation. |
| Plausible but incomplete reasoning | Ask a focused self-explanation question; do not reveal the conclusion. |
| Stable misconception | Use a contrast case or counterexample, then ask for a revised rule. |
| Repeated procedural slip | Isolate the subskill, model one step, then fade support immediately. |
| Missing prerequisite | Teach and check the smallest prerequisite concept before returning to the original task. |
| Accurate, fluent response | Increase variation, delay feedback briefly, or move to a transfer task. |
| Frustration or disengagement | Acknowledge the difficulty neutrally, reduce extraneous load, offer a bounded choice, and preserve a meaningful challenge. |

### Hint ladder

Write hints from least to most revealing. Stop once the learner can progress.

1. Restate the goal or identify the relevant information.
2. Ask a strategic question.
3. Point to a relationship, pattern, or representation.
4. Supply one intermediate step or analogous mini-example.
5. Show a worked step, then require the learner to finish and explain.

Never mark an item mastered solely because the learner succeeded at levels 4–5.

## Feedback standard

Feedback must be specific, actionable, and proportionate to evidence.

Use this form:

> **What worked:** [observable strategy or correct relation].  
> **Check this:** [precise discrepancy or misconception].  
> **Next move:** [one bounded action or question].

Examples:

- “Your factorization preserves the product. Check the middle term after expansion. Which two numbers multiply to 12 *and* add to 7?”
- “You correctly identified the claim. The quotation describes the speaker’s reaction, not the author’s argument. Which sentence states the author’s reason?”

Do not say “almost,” “good job,” “smart,” or “wrong” without evidence and a next action. Do not assign a personality-based cause to an error.

## Mastery and assessment

- Define each skill as an observable action with conditions and a quality threshold.
- Sample across formats and contexts; one item is not a reliable diagnosis.
- Separate assisted practice from unaided assessment in the data model and interface.
- Track confidence alongside performance to identify overconfidence and fragile learning.
- Use low-stakes checks during learning; give clear rubrics and answer rationales afterward.
- Update a learner model conservatively. Lower confidence after contradictory evidence; do not overreact to a single miss or lucky guess.
- Schedule reviews based on prior performance, time since retrieval, and meaningful variation—not generic daily streak pressure.

## AI implementation checklist

Before shipping a learning feature, specify:

- **Learner:** age/setting, declared goals, accessibility and language needs, prior knowledge.
- **Target:** one observable capability and its prerequisite map.
- **Evidence:** input the system receives and what valid/invalid evidence looks like.
- **Decision policy:** how the system chooses the next task, representation, or hint level.
- **Boundaries:** what the system must not infer, decide, claim, or store.
- **Human handoff:** when a teacher, parent, counselor, or domain expert needs to intervene.
- **Evaluation:** learning outcomes, delayed retention, transfer, equity across learner groups, error rates, and signs of disengagement or unwanted pressure.

For LLM prompts, constrain the model to: ask before telling; cite the learner’s actual response; provide one next action; label uncertainty; and refuse to fabricate progress, sources, personal knowledge, or professional authority.

## Studyus integration map

When working in this repository, prefer the existing learning pipeline rather than adding isolated mock data or a second mastery system:

- Tutor dialogue and instructional policy: `src/lib/tutor.ts` and `src/data/tutor.ts`
- Learner evidence and adaptation: `src/lib/learnerModel.ts`
- Mastery progression and review: `src/lib/mastery.ts`
- Question generation, validation, and assessment: `src/lib/generator.ts`, `src/lib/questionBank.ts`, and `src/lib/assessment.ts`
- Test-taking experience: `src/components/test/`
- Tutor authoring experience: `src/components/settings/TutorStudio.tsx`
- Interactive representations: `src/lib/visualization/` and `src/components/board/`

Do not introduce fake curriculum items, synthetic student histories, or decorative engagement elements. Connect new experiences to the real tutor, question, learner-model, and mastery pipelines, or present an intentional empty state.

## Acceptance checks

A completed change should let a reviewer answer “yes” to all of these:

- Does the learner make a prediction, attempt, explanation, or retrieval before being told the answer?
- Is the next instructional move traceable to observable learner evidence?
- Can the learner recover without escalating immediately to a full solution?
- Are support level and unaided performance differentiated?
- Does the experience check retention or transfer, not just immediate correctness?
- Is engagement connected to the learning objective and free of coercive mechanics?
- Are privacy, accessibility, fairness, and human escalation boundaries explicit?
- Does the feature use real application pipelines rather than placeholders?
