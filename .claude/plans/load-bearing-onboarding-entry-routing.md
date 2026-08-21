# Load-bearing onboarding entry routing

## Goal

Make the onboarding interview a typed, persisted policy input for a skill's first empty Encounter entry, while keeping it entirely outside the evidence ledger, mastery derivation, stage predicates, review scheduling, and reconstruction debt. Close the plan-agreement seam so the first teaching turn is explicitly identified and does not promise a phase that the deterministic router may reject.

## Design decisions

- Add `SelfReportedFamiliarity = "new" | "shaky" | "confident"` as a non-evidence intake type.
- Require each generated onboarding form to contain exactly one choice question with a validated label-to-canonical-familiarity mapping. The counsellor may phrase the question and visible labels for the concept, but cannot invent a fourth category or make arbitrary prose a policy signal.
- Derive the canonical value from the learner's selected option at form submission and add it to `OnboardingAnswers`. A skipped familiarity question yields no signal and retains the existing evidence/neighborhood fallback.
- Persist the signal in a new SQLite table keyed by learner, session, and normalized skill. It is deliberately separate from `skill_state` and `learning_evidence` so recomputing state from the ledger remains deterministic and auditable.
- The policy reads the persisted signal only at an empty `encounter` state with no target-skill evidence. It cannot alter a skill that has evidence, any later stage, mastery dimensions, review priority, or reconstruction debt.
- Entry precedence remains: due retrieval and owed reconstruction first; then existing failure/hypothesis routes; then, at normal Encounter progression only, prior direct instruction for this session forces the required hand-back prediction; otherwise `new` selects `direct_instruction`, `shaky` selects `diagnostic_probe`, and `confident` selects `prediction`. With no signal, preserve the existing cold-neighborhood detection (`direct_instruction` if cold, `prediction` if related evidence exists).
- The post-intake greeting remains planning-only: it must not consume the selected entry route, advertise presentation-first teaching, or record a learning-activity contract. The plan's first submission is the route-bearing turn.

## Implementation

1. **Typed onboarding contract and validation**
   - Update `src/data/tutor.ts` with the familiarity union, a question-level label mapping field, and `OnboardingAnswers.selfReportedFamiliarity`.
   - Add a deterministic helper that extracts the canonical value only from the validated mapped choice answer.
   - Update `validateCreateFormsPayload()` and the onboarding-generation prompt in `src/lib/tutor.ts` so exactly one choice question supplies all three canonical mappings and its mapped labels are exactly its options.
   - Update `src/components/SessionCard.tsx` to derive and carry the value when the learner submits the form. Keep the complete answers as prompt context; this new value is the policy-only field.

2. **Separate persistence boundary**
   - Add migration 8 in `src/db/database.ts` for a `learner_entry_signals` table with learner/session/skill key, a CHECK-constrained familiarity value, timestamp, and lookup index.
   - Add typed `upsert`/`get` helpers in `src/lib/learning/store.ts`, normalizing skill IDs at the boundary. Do not add a field or column to `SkillState`, and do not write an evidence row for intake.
   - In `askTutorTurn()` (`src/lib/tutor.ts`), persist a supplied onboarding signal before the policy brief is assembled. Later/restored turns retrieve the signal by session and skill rather than relying on the prompt reminder remaining present.

3. **Deterministic entry-route selection**
   - Extend `buildPolicyBrief()` in `src/lib/learning/session.ts` to load the persisted signal and resolve a typed `entryRoute` only for an empty Encounter state. Preserve `detectColdStart()` as the no-signal fallback and suppress any direct route after a same-session direct-instruction contract.
   - Extend `PlanInput`/`planForStage()` in `src/lib/learning/policy.ts` so the selected entry route is applied solely in the normal Encounter branch, after all higher-priority review, reconstruction, failure, and hypothesis checks.
   - Keep all existing direct-instruction rules intact: the route has no evidence requirements, exposition creates no mastery or reconstruction debt, and the following no-evidence turn returns to prediction.

4. **Plan-start seam**
   - Add `"plan_start"` to `TurnKind`, `TutorTurnRequest.turnKind`, and the turn-widget permit resolver. Give this one turn the same full widget-catalog exemption as an onboarding greeting; later widget submissions remain route-scoped.
   - In `StudyRoom.saveWidgetState()`, mark the first submitted plan widget as `plan_start`; preserve ordinary `widget` handling for every other widget and release the dedupe key if either widget-derived turn fails.
   - Make the onboarding greeting explicitly planning-only in `askTutorTurn()`: do not feed its computed move into teaching instructions and do not write an activity contract. The plan-start turn receives the actual policy brief, can select direct instruction, and writes the corresponding contract.
   - Revise the plan signal text in `src/lib/widgets/signal.ts` to say that the learner has authorized teaching toward the agreed plan and that the next move is policy-selected; remove the untrue promise to begin the plan's first phase immediately.

5. **Tests and verification**
   - Expand onboarding/data tests for mapped familiarity extraction, skips, and malformed/missing/duplicate mappings.
   - Add store/session/policy tests covering persistence, no evidence/mastery mutation, `new` → direct instruction, `shaky` → diagnostic probe, `confident` → prediction, prior direct instruction → prediction, and the unchanged no-signal cold/warm-neighborhood behavior.
   - Update tutor prompt tests for `plan_start` catalog behavior and planning-only greeting behavior; add StudyRoom/widget tests for plan-specific turn identity and failed-turn retry cleanup.
   - Update widget signal tests so plan agreement no longer promises a phase that the policy has not selected.
   - Run the focused onboarding, learning-policy/session, widget, and tutor prompt suites plus `git diff --check`. Do not rely on full TypeScript validation while the known unresolved merge conflicts in `WidgetSurface.tsx` and `WidgetSurface.test.tsx` remain outside this scope.
