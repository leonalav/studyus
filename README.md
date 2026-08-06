# Studyus

Studyus is the study environment where **nothing is revealed until you commit, and the only
reward is watching your own capability grow.**

Read [DOCTRINE.md](./DOCTRINE.md) first — it is the settling authority for every design
argument in this repository. [BUILD_LOG.md](./BUILD_LOG.md) reports what was built, what was
not, and every deviation, with real test output.

## The Programming tutor

The Programming surface implements the doctrine's four-beat PRIMM loop, replacing the
former Parsons-problems mode:

1. **Predict** — a short, complete program; you commit what it prints before anything is revealed.
2. **Explain** — one sentence on the program's purpose; graded by a rubric, with the caveat always shown.
3. **Modify** — fill the holes so the program reaches a target behaviour; checked against recorded runs.
4. **Write from blank** — a specification and an empty file; structural checks plus one dry-run you evaluate yourself, because a browser cannot run Python (and none is bundled).

Rules that hold in the code, enforced by tests:

- **No reveal before commitment** — prompts are projected through a single safe function;
  a 1000-exercise test proves no serialized prompt carries the expected output.
- **Mastery requires writing** — a skill is mastered only after a passed Write at zero
  scaffolding; prediction accuracy can never substitute.
- **No rewards** — no points, streaks, badges, or confetti. The capability map (skills you
  can now do: locked / open / in progress / mastered) is the only ascending display.
- **Local-only** — all learner data lives in `localStorage`; there is no HTTP client in the
  workspace and no telemetry. Two metrics exist, both readable on the capability map.

## Commands

```bash
npm install
npm run dev               # local dev server
npm test                  # vitest — law-enforcement tests included
npm run typecheck         # strict TypeScript
npm run check:deps        # Law 9 + §18 dependency rules
npm run validate:content  # §11 validation chain, per-filter table
npm run build             # production single-file build
```

Open the app, pick a Programming curriculum (sidebar or session card), and the cold open
asks one question about one program. No menu, no onboarding — the gap is the lesson.

## Layout

| Path | Role |
|---|---|
| `src/core/` | all pedagogy: types, session state machine, grading, BKT, fading, selection, generation. No UI imports (CI-enforced). |
| `src/pack/` | the shipped content pack (7 Tier 1 skills, all four beats) and the tutor voice. |
| `src/store/` | browser persistence binding over the core `Store` trait. |
| `src/components/code/` | the frontend binding — renders `View`s, sends `Input`s, contains zero pedagogy. |
| `scripts/check-deps.sh` | Law 9 / §18 enforcement. |
