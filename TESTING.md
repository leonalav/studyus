# Studyus Testing & Assessment Framework

This document describes the implemented three-mode difficulty testing and teaching framework in Studyus, covering Phase 1 Integrity Foundation and Areas A through H.

---

## 1. Product Principle & Three Assessment Modes

Studyus implements a criterion-referenced formative assessment pipeline:
Curriculum evidence → validated assessment form → persistent learner attempt → deterministic/domain grader → bounded rubric grader → Socratic remediation → transfer check → mastery evidence and analytics.

### Assessment Modes
1. `FORMATIVE`: Learning-oriented practice, progressive hints, criterion feedback, Socratic remediation, transfer checks.
2. `CLOSED_BOOK_MOCK`: Timed independent assessment, persistent deadline enforced in backend, immutable and idempotent submission & grading.
3. `CALIBRATION`: Reserved for a later phase. Does not expose uncalibrated IRT ability estimates.

---

## 2. SQLite Database Ownership & Entities

All core entities are persisted in SQLite (`src/db/database.ts`):
- `assessment_forms`
- `assessment_items`
- `item_evidence`
- `assessment_attempts`
- `attempt_responses`
- `criterion_scores`
- `score_overrides`
- `assessment_events`
- `remediation_links`
- `item_statistics`
- `curriculum_sources`
- `curriculum_nodes`
- `curriculum_chunks`
- `curriculum_assets`
- `chalkboard_sessions`
- `session_messages`
- `board_objects`
- `graph_specs`
- `learner_model_entries`
- `intervention_outcomes`
- `model_bindings`
- `agent_calls`
- `migration_ledger`

Migration Ledger & PRAGMA user_version ensure legacy history preservation and deterministic deduplication.

---

## 3. State Machines & Business Logic

- **Attempt State Machine**: `created` → `active` -> `submission_review` -> `grading` -> `completed` (Exceptional: `expired`, `grading_blocked`, `abandoned`).
- **Response State Machine**: `unseen` -> `presented` -> `draft` -> `committed` -> `evaluating` -> `graded`.
- **Submission**: Idempotent and guarded in a single database transaction.
- **Grader Failures**: Move attempt to `grading_blocked` (never award zero).
- **Overrides**: Applied via `applyOverride()`, recomputes attempt totals transactionally.

---

## 4. Graders & Numeric Equivalence

- **Typed Numeric Answer Specification**: Parses signed integers, decimals, trailing zeros, fractions (`1/2` == `2/4`), negative numbers, absolute & relative tolerances, units. `10` never grades as `1`. `0` never normalizes to empty.
- **Rubric Grader**: Parses criteria list, verifies max bounds, marks non-finite awards as `grading_blocked`.

---

## 5. Three Agent Roles & Model Configuration

1. **Role 1 (Tutor Agent)**: Socratic chalkboard teaching with 11 rules.
2. **Role 2 (Generation Agent)**: Grounded item generation; MCQ predetermines key + distractor misconceptions.
3. **Role 3 (Evaluator Agent)**: Bounded rubric grading & explanation gate evaluation.
- Endpoint connection testing & capability detection.
- Single-action control to bind active model to all 3 roles.
- Credentials stored in OS / secure store (never in frontend assets or `get_settings`).

---

## 6. Curriculum PDF Ingestion & Bookmark Tree

- Parses outline into hierarchical `curriculum_nodes` with page ranges.
- Sidebar renders interactive bookmark tree with search filter, expand/collapse, multi-select, active section styling.

---

## 7. Graphing & Right-Click Context Menu

- 2D Graphing: Cartesian axes with numeric tick labels below x-axis and beside y-axis. Discontinuities separated without spurious lines.
- 3D Graphing: Wireframe surfaces with labeled numeric ticks on x, y, and z axes.
- Context Menu: Dark chalkboard theme context menu on right click across chalkboard, objects, graphs, curriculum nodes, chat text, and assessment items.

---

## 8. Running Tests

Run the full test suite using Vitest:
```bash
npx vitest run
```
Or build the production bundle:
```bash
npm run build
```
