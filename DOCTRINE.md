# DOCTRINE

**Studyus is the study environment where nothing is revealed until you commit,
and the only reward is watching your own capability grow.**

## Prime Mechanism — Commit Before Reveal

    Commit → Contradict → Explain → Revise

Instruction arrives *after* struggle, never before.

## The Law of Two Loops

The pull loop is curiosity, and it operates in seconds.
The push loop is capability, and it operates in weeks.
Neither loop is ever made of rewards.

## The Laws

1. No reveal before commitment.
2. The explanation is the graded artifact, not the answer.
3. Struggle precedes instruction. Always.
4. Motivation comes from the unresolved gap and the growing capability map.
   Never from rewards. Anticipation dopamine only, never reward dopamine.
5. Difficulty is calibrated by the mastery model — and calibrated toward
   *small* gaps (the inverted-U of curiosity), not maximal difficulty.
6. The contradiction moment is framed as interesting, never as failure.
7. Every skill terminates in unassisted code writing. Prediction and
   explanation are the road; writing from blank is the destination.
8. **The Law of Three Tiers.** Beat 1 requires a checkable outcome. Where
   there is no checkable outcome, there is no gate — and the tutor says so
   out loud.
9. **One core, many frontends.** All pedagogy lives in a single library.
   Every surface is a thin binding over it and contains no pedagogy.
10. **Generation is local-only.** Learner-supplied source material is parsed,
    transformed, and stored on the learner's own machine. It never leaves it.

## How the laws bind the code

| Law | Concrete engineering consequence |
|---|---|
| 1 | No API path can return an expected output, a solution, or a hint before an `Attempt` has been persisted for that exercise. Enforce this with types, not discipline — see §8. |
| 2 | The Explain beat is mandatory and its result is what advances mastery most. A learner who guesses the right output but cannot explain it does not advance. |
| 3 | Never show a worked example before the first prediction attempt on a skill. Worked examples are *remediation*, not introduction. |
| 4 | No points, no XP, no streaks, no badges, no leagues, no leaderboards, no confetti, no "you're on fire". If you find yourself adding a counter that goes up for its own sake, delete it. The only ascending display permitted is the capability map, which shows skills, not scores. |
| 5 | The selector picks the exercise whose predicted success probability is closest to a target band (default `0.55–0.75`), not the hardest available. |
| 6 | Every message shown when a prediction is wrong must come from the tutor voice file (§14) and must never contain the words "wrong", "incorrect", "failed", "oops", or "sorry". |
| 7 | A skill cannot be marked mastered unless the learner has passed beat 4 (write from blank) at least once with zero scaffolding. |
| 8 | Tier 3 content is delivered without a gate, and the tutor states this explicitly to the learner. |
| 9 | `studyus-core` must not depend on any CLI, TUI, terminal, HTTP, or GUI crate. Enforce this with a CI check that greps the dependency tree. |
| 10 | No network call may carry learner-supplied document text. Ingestion is offline. See §18. |

## Recorded deferrals (per §19)

- The second frontend (a graphical surface) is **deliberately deferred**. In this
  repository the pedagogy lives in `src/core/` (pure TypeScript, no UI imports)
  and the only surface is the React frontend in `src/components/code/`, which is
  a thin binding over the session API. A future GUI must be written against the
  identical session API with zero changes to the core.
