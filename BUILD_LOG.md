# BUILD_LOG — Studyus programming tutor

Appended continuously per §22. Honest reporting is worth more than completed milestones.

**Context of this build.** The plan arrived as a greenfield specification for a Rust
workspace + CLI named Lumina. It was applied, per the product owner's instruction, to this
existing repository — the Studyus web app — with every "Lumina" read as "Studyus". Where
the plan's crate layout cannot exist in a TypeScript app, the mapping is: `lumina-core` →
`src/core`, `lumina-content`/`lumina-tutor` → `src/pack`, `lumina-store` → `src/store`,
`lumina-cli` → `src/components/code` (the only surface). The architecture rule that
matters — *all pedagogy in one UI-free core, frontends are thin bindings over the session
API* — is preserved and CI-enforced.

---

## M0 — Skeleton and doctrine — COMPLETE

### What I built
- `DOCTRINE.md` at the repository root, written first, with "Studyus" substituted for
  "Lumina" per instruction, plus the §19-required record of the deferred second frontend.
- `BUILD_LOG.md` (this file).
- Vitest added as the test runner (`vitest.config.ts`, `npm test`).
- `scripts/check-deps.sh` + `.github/workflows/ci.yml` running typecheck, tests, the
  dependency checks, and a build.

### What I did NOT build, and why
- `rust-toolchain.toml` / Cargo workspace: this repository is a Vite + React + TypeScript
  app; the MSRV concept maps to the Node 22 / TS strict setup already here.
- No `fmt`/`clippy` equivalents are wired beyond `tsc --noEmit` (strict, noUnusedLocals).

### Decisions I made that this prompt did not specify
- The dependency-rule CI check greps `src/core` and `src/pack` for React/DOM imports and
  the whole workspace for HTTP clients — the web analog of grepping `cargo tree`.

### Where I deviated from the Doctrine or this prompt
- DOCTRINE.md carries one addition beyond the mandated text: the §19-required deferral
  note for the second frontend. The body of the doctrine is otherwise intact (renamed).

### Test results
```
── Law 9: pedagogy modules must be UI-free ──
OK: src/core and src/pack contain no UI or DOM imports
── §18: no HTTP client anywhere in the workspace ──
OK: package.json declares no HTTP client
OK: no HTTP calls in src/
```

### What I am uncertain about
- Nothing material.

---

## M1 — Domain model and the reveal barrier — COMPLETE

### What I built
- `src/core/types.ts` — all §7 types: IDs, `Tier`, `Beat` (ordered predict < explain <
  modify < write), `Skill`, `Exercise` (not projected to frontends), `ExercisePrompt` /
  `ExerciseReveal` split, `Attempt`, `Judgement`, `GradeConfidence`, `Misconception`,
  `View`/`Input`/`Transition`/`Effect`.
- `src/core/prompt.ts` — `buildPrompt`, the ONLY projection from `Exercise` to frontend-
  visible data; it selects safe fields deliberately.

### What I did NOT build, and why
- `trybuild` compile-fail harness: not applicable to TS. The type split plus the runtime
  audit below cover the intent; `Exercise` is never imported by any component.

### Test results — the law that everything else depends on
```
✓ Law 1 — no reveal before commitment
  ✓ no serialized ExercisePrompt contains the expected output, across 1000 generated exercises (23ms)
  ✓ Exercise prompts never carry rubric, accepted fills, hidden-test outputs, or reference solutions
✓ §8 invariants — the state machine
  ✓ View::Revealed is unreachable without Input::Commit — every other input from Prompting
  ✓ Input::Commit persists the attempt BEFORE constructing the reveal; persistence failure ⇒ no reveal
  ✓ View::ColdOpen is produced only when the store contains zero attempts
  ✓ RequestScaffold never reveals — it softens the scaffold and re-issues the prompt
  ✓ beat ordering is strict — no Write before a passed Modify, no Explain before a Predict attempt
```

### What I am uncertain about
- The leak audit checks short answers as bounded tokens and prose secrets as full strings
  plus two-word fragments; arbitrary-length substring checking produced false positives
  against legitimate program literals and JSON identifiers, so it was narrowed
  deliberately. A reviewer who wants the maximal reading can tighten `substringsOf` in
  `reveal-barrier.test.ts`.

---

## M2 — Content pack format, skills — COMPLETE

### What I built
- `src/core/template.ts` — `Template` + `Pack` containers, strict `{{name}}` rendering
  with unknown-placeholder errors, parameter-space computation, and full pack validation
  (unique IDs, prerequisite cycles named, referenced misconceptions/templates, parameter
  space ≥ 200) emitting ALL errors at once.
- `src/pack/studyus-python.ts` — the shipped pack: 7 Tier 1 skills forming one connected
  DAG (variables → conditionals/loops/functions → lists → strings/dicts), 7 parameterized
  templates with all four beats, 10 misconceptions with detectors, 2 Tier 3 readings.

### What I did NOT build, and why
- **No OpenStax text ships.** §18 requires verifying the license of each specific document
  before inclusion and recording what was checked. From this sandbox I could not retrieve
  and verify any OpenStax document, so including it would violate the letter of §18. Every
  program and text in the pack is original to Studyus (worked-example flows follow the
  plan's own Appendix B). License recorded in `pack.toml`-equivalent fields: original
  content, CC0. What I checked: nothing external; authored in-repo.

### Decisions I made that this prompt did not specify
- One template per skill for this arc; parameter spaces were sized ≥ 200 as required.

### Test results
```
✓ pack validation (§10.1)
  ✓ the shipped pack loads with zero errors
  ✓ prerequisite cycles are detected and named
✓ every shipped Tier 1 template has a parameter space ≥ 200
```
Parameter spaces (computed):
```
py.vars.assignment.rebind.v1: 243
py.cond.if-else.threshold.v1: 240
py.loops.for-range.accumulate.v1: 546
py.funcs.def-return.scale.v1: 704
py.lists.grow.append.v1: 729
py.strings.methods.new-string.v1: 240
py.dicts.count.update.v1: 1215
```

### Where I deviated from the Doctrine or this prompt
- Pack identity: the launch pack is `studyus-python-first-arc`, not `openstax-python`,
  for the licensing reason above. Law 10 and §18 are unaffected (still local-only).

### What I am uncertain about
- Whether the owner wants OpenStax content added once license verification is possible —
  the pack loader is ready for additional packs without core changes.

---

## M3 — Runtime layer — ADAPTED (no interpreter is possible in a browser)

### What I built
- The PrecomputedRuntime contract (§9.1) is the ONLY runtime in this build: every expected
  outcome is a recorded result produced by each template's deterministic reference model
  and shipped inside the pack. Zero install, zero download, zero interpreter — the cold
  open needs nothing, exactly as §15.2 demands.
- Honest runtime status lines on the capability map (§9.4 "never silently degrade"):
  the map states that execution is precomputed and that Write verdicts are structural.

### What I did NOT build, and why
- `LocalInterpreterRuntime`: a browser page cannot spawn a Python subprocess. Bundling or
  downloading an interpreter (Pyodide/WASM) is explicitly forbidden by §19. The plan's own
  voice line covers this: the tutor says what it cannot do, out loud.
- `WasmRuntime` stub: nothing to stub — the deferral is recorded in the map's status lines.

### Where I deviated from the Doctrine or this prompt
- §9.2/§9.3 are unimplementable in this surface; §9.1 is implemented faithfully. This is
  recorded here rather than quietly relaxed, per §22 rule 4. The security controls of §17
  that exist to constrain a live interpreter are mostly moot; the ones that still apply
  (static policy gate on ALL code including learner input, output caps via normalization,
  no secrets before commitment) are implemented and tested.

### What I am uncertain about
- Whether a future Electron/Tauri surface should re-introduce a real interpreter; the
  session API would not change if one appeared.

---

## M4 — Generation and validation — COMPLETE

### What I built
- `src/core/generate.ts` — seeded generation (mulberry32), parameter drawing, FNV-1a
  `param_hash`, never-repeat via the `seen` table (64 retries then exhaustive scan),
  graceful template-switch/exhaustion, and the §11 filter chain: render → parse-adapted →
  static policy → determinism (3× recorded runs compared) → non-triviality →
  head-computability → beat coherence.

### Validation statistics (real numbers, seed 3, 24 samples per template)
```
py.vars.assignment.rebind.v1:      accepted 22/24 | rejected → non-triviality:2
py.cond.if-else.threshold.v1:      accepted 24/24 | rejected → none
py.loops.for-range.accumulate.v1:  accepted 23/24 | rejected → non-triviality:1
py.funcs.def-return.scale.v1:      accepted 24/24 | rejected → none
py.lists.grow.append.v1:           accepted 24/24 | rejected → none
py.strings.methods.new-string.v1:  accepted 24/24 | rejected → none
py.dicts.count.update.v1:          accepted 24/24 | rejected → none
```
The three non-triviality rejections are the filter working as designed: bindings whose
recorded output is already a literal visible in the source (e.g. `range(2)` with start 1
prints `2`). The generator simply draws another binding; such instances are never served.

### Test results
```
✓ 500 generated exercises from one template carry zero duplicate param hashes
✓ on exhaustion the generator switches or reports need — never re-serves
✓ generation is byte-for-byte reproducible under a fixed seed
✓ filter: render rejects unresolved placeholders
✓ filter: static policy rejects imports outside the allowlist
✓ filter: static policy rejects sockets, open(), eval, and while True
✓ filter: determinism rejects a reference that varies between runs
✓ filter: non-triviality rejects empty output
✓ filter: head-computability rejects programs over 20 lines
✓ filter: beat coherence rejects a write beat whose reference solution flunks its own checks
```

### Decisions I made that this prompt did not specify
- `seen` is marked when the attempt is **persisted**, not at generation time, so a learner
  who leaves mid-exercise does not burn that binding. The §11 distinctness filter still
  applies at generation.
- The "parse" filter is adapted: with no interpreter, syntax is guaranteed by construction
  (programs are rendered from authored templates) and checked structurally.

### What I am uncertain about
- Nothing material; the chain's numbers are above.

---

## M5 — Grading and mastery — COMPLETE

### What I built
- `src/core/grading.ts` — predict grading with §12.1 normalization (whitespace collapsed;
  case NOT normalized), misconception detectors (exact/regex/off-by-one/custom registry),
  rubric Explain grader with stem-aware matching and the relational-vs-multistructural
  heuristic (always `GradeConfidence: heuristic`, disclaimer always surfaced), Modify
  grading against the authored accepted-fill set with static-policy refusal, Write grading
  via structural checks + one self-evaluated dry-run (always heuristic, always caveated).
- `src/core/bkt.ts` — BKT with the §13.1 parameters, weight-0.5 scaffold-requested
  attempts, P(correct) estimation.
- `src/core/fading.ts` — per-beat scaffold ladders; fade on unassisted pass, un-fade after
  two consecutive failures, immediate un-fade + suppression on request, expertise-reversal
  guard.
- `src/core/mastery.ts` — beat weights (0.15/0.30/0.20/0.35), `Write p_L ≥ 0.85 AND a
  scaffold-free Write pass` gate, spaced-retrieval intervals 1/3/7/21/60 days.
- `src/core/select.ts` — target band [0.55, 0.75], closest-to-midpoint selection with the
  §13.3 tiebreaks; locked skills excluded; mastered skills only via due review.

### Decisions I made that this prompt did not specify
- **Frontier rule** (`Session.candidateBeats`): per skill, only the lowest-ordered
  unlocked beat that still needs work is a candidate. Without it, a strong early beat
  out-competes every later beat on band distance and the PRIMM ordering stalls (verified
  empirically during development). The band still decides between skills.
- A `Partial` outcome counts as a pass for BKT/fading when its score ≥ 0.6.
- A multistructural explanation is recorded as `Ungraded` and re-issued once ("prompt
  them; do not fail them", §12.2).

### Test results
```
✓ BKT converges upward under repeated correct attempts
✓ BKT converges downward under repeated incorrect attempts
✓ a scaffold-requested attempt counts at reduced weight 0.5 (§13.4)
✓ chooses the candidate closest to the band middle, not the hardest
✓ estimates P(correct) inside the band for a mid-learned state
✓ never selects a locked candidate, and mastered candidates need a due review
✓ fades toward harder after an unassisted pass, never below none
✓ un-fades after two consecutive failures, not one
✓ a requested scaffold un-fades immediately and suppresses fading
✓ expertise reversal — mastered skills are never offered worked examples
✓ no mastery without a passed Write at ScaffoldLevel none, however good the predictions
✓ no mastery below the Write p_L threshold either
✓ beat weights follow §13.2 — Explain heavy, Write heaviest
✓ an off-by-one prediction on a range template matches range-includes-upper
✓ normalization: trailing newline, CRLF, internal double-spaces equal; case different
✓ refuses fills containing import os instead of executing them
✓ does not reveal the correct fills on failure — only which holes miss the target
✓ a source satisfying some but not all checks is Incorrect and reports only the first failure
✓ source attempting a network import is blocked, not graded
```

### What I am uncertain about
- BKT parameters and the 0.6 partial-pass threshold are un-tuned defaults; they need real
  learners. The frontier rule is my most consequential addition — review it first.

---

## M6 — Tutor voice — COMPLETE

### What I built
- `src/pack/voice-en.ts` — the web equivalent of `voice/en.toml`: five distinct default
  predict contradiction lines, misconception-specific lines, confirmation lines for all
  four beats, the Tier 3 no-gate disclaimer, the heuristic disclaimer, the honest-surface
  note, the multistructural prompt. Deterministic selection by attempt-id hash.
- Test-enforced rules: no forbidden failure/reward vocabulary anywhere in the file; every
  contradiction line ends with a question.

### Decisions I made that this prompt did not specify
- Voice lives in a TS module, not TOML: the single-file production build inlines
  everything, and a fetched .toml would add an async step to the cold open.

### Test results
```
✓ contains none of the forbidden words (Law 4, Law 6)
✓ every contradiction line ends with a question
✓ five distinct contradiction lines exist for the Predict beat
✓ line selection is deterministic — same attempt id, same line
```

### What I am uncertain about
- Whether the owner wants the literal §14 lines that mention "the interpreter"; on this
  surface the recorded run speaks, so those two lines were adapted. Same mechanism, same
  constraints.

---

## M7 — Surface: cold open and all four beats — COMPLETE (React binding, not CLI)

### What I built
- `src/components/code/ProgrammingTutor.tsx` — matches on `View`, renders, sends `Input`.
  No grading, selection, mastery arithmetic, fade decisions, or tier logic anywhere in
  `src/components` — the §15.4 contract.
- Cold open: the Appendix B program (`range(4)` accumulator), one question, no menu, no
  dashboard, no welcome. Rendered synchronously from embedded pack data.
- Beats 1 and 4 ship together; the app was never read-only at any commit.
- Capability map with locked/open/in-progress/mastered states, readings, the two local
  signals, runtime honesty lines, export and reset.
- `why` equivalent: "go one level deeper" on every reveal (misconception help / the
  after-first-pair line). `doctor` equivalent: the map's runtime status lines.

### What I did NOT build, and why
- `watch` mode (file-watching re-runner): there is no filesystem in a browser; Write is
  committed in-page and the structural verdict appears on commit.
- ANSI syntax highlighting: the code block renders numbered monospace; a highlighter would
  have been a new dependency for marginal value.

### Test results
```
✓ cold open lands in under 500 ms with a cold store and touches no interpreter (1ms)
✓ walks all four beats and masters the skill only via a scaffold-free Write
✓ a correct cold-open answer confirms, then asks the Explain question
✓ dropping the session after a commit loses nothing (Ctrl-C resilience)
✓ RequestScaffold on predict offers commitment options without revealing
```

### What I am uncertain about
- The three-column layout on narrow screens; it scrolls, but a phone-width pass with real
  hands would be wise.

---

## M8 — Persistence and the two metrics — COMPLETE

### What I built
- `src/core/store.ts` — the `Store` trait in core, `MemoryStore` fake for tests;
  `src/store/local.ts` — the browser binding (localStorage, transactional save-or-throw).
- Exactly two metrics: `first_question_answered`, `returned_within_24h` (window 20–48h),
  stored in the `event` list, displayed on the capability map. No other instrumentation
  exists; there is no telemetry path in the codebase at all (§16, §18).

### Test results
```
✓ first_question_answered fires exactly once, on the first commit
✓ returned_within_24h fires only for a reopen between 20 and 48 hours
✓ a reopen outside the 20–48 h window records nothing
```

### What I am uncertain about
- Nothing material.

---

## M9 — Ingestion — DEFERRED

### What I did NOT build, and why
- PDF text extraction, chunking, tier classification, and template proposal are not in
  this build. A pure-TS PDF parser is a substantial dependency with real failure modes,
  and shipping it half-done would create exactly the "fake gate" risk Law 8 forbids.
  The two guarantees that matter are already structurally true: the workspace contains no
  HTTP client (CI-enforced), and nothing in the app transmits anything anywhere.

### What I built instead
- Nothing as a placeholder — §22 rule 3 forbids silent stubs, and §19 forbids scaffolding
  I can't stand behind.

### Where I deviated from the Doctrine or this prompt
- §10.4 and the `lumina ingest` milestone are deferred whole. Recorded here per §22.

---

## M10 — Content fill — COMPLETE

### What I built
- The first arc: variables → conditionals → loops → functions → lists → strings → dicts,
  each skill with all four beats, misconceptions, recorded traces, and ≥ 4 hidden tests on
  every Write beat. The capability map shows one connected DAG with no orphan skills.
- Two Tier 3 readings (model-choice judgement; automation trade-offs) delivered ungated
  with the disclaimer spoken out loud, revisited weekly.

### Test results
```
✓ readings arrive ungated with the no-gate disclaimer spoken out loud
✓ every shipped template's reference solution satisfies its own checks and ≥4 hidden tests
```

---

## Final test run — all suites

```
 ✓ src/core/__tests__/session-e2e.test.ts            (9 tests)
 ✓ src/core/__tests__/generate.test.ts               (17 tests)
 ✓ src/components/code/__tests__/tutor-smoke.test.tsx (3 tests)
 ✓ src/core/__tests__/voice.test.ts                   (4 tests)
 ✓ src/core/__tests__/grading.test.ts                 (8 tests)
 ✓ src/core/__tests__/mastery.test.ts                 (13 tests)
 ✓ src/core/__tests__/reveal-barrier.test.ts          (7 tests)

 Test Files  7 passed (7)
      Tests  61 passed (61)
```

Grep for stubs (§22 rule 3):
```
$ grep -rn "TODO(M" src/
(no output — no todo!-style stubs, no unimplemented! equivalents exist)
```

---

## Honest summary

**What works end to end:** cold open → commit → contradiction/confirmation → Explain with
rubric + exemplar → Modify against recorded runs → Write with structural verdicts, all
driven by BKT mastery, adaptive fading, target-band selection, never-repeat generation,
and a capability map that is the only ascending display — persisted locally, resumable,
with the two metrics recorded. The reveal barrier, beat ordering, Law 7 mastery gate,
voice constraints, and the §11 filter chain are all test-enforced.

**What is scaffolding:** Tier 2 exists in the data model only (no content — as specified);
Write-beat grading is the weakest link by construction (a browser cannot execute code);
Tier 3 has two readings.

**What I would do next:** (1) tune BKT and the partial-pass threshold against real
learners; (2) add a second template per skill to widen variety; (3) build M9 ingestion
behind a real PDF parser; (4) a surface with an interpreter (desktop shell) where beat 4
becomes truly execution-graded — the core needs no changes for that.

**The one thing most likely to be wrong:** the frontier selection rule. It is my addition,
not the plan's text; it fixes a real stall I measured, but it changes how beats interleave
across skills, and a reviewer should challenge it before believing anything downstream of
it.
