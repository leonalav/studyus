/**
 * Renderer-agnostic study-widget protocol.
 *
 * The 17 chalkboard study widgets are the tutor agent's *teaching vocabulary*.
 * They are configured exactly the way visualization intents are configured
 * (`lib/visualization/types.ts`): the agent emits a semantic, fully-specified
 * JSON intent — never markup, never a preset name — a validator enforces
 * structural and numeric bounds, and a renderer owns every pixel.
 *
 * Three of the twenty widgets in the original board specification (Graph,
 * Point/Geometry, Equation) are NOT defined here: they already exist as
 * first-class visualization intents (`function`, `geometry`, `equation`) and
 * must keep going through `visualize`. The remaining seventeen live here.
 *
 * Design rules for every widget in this file:
 *  - Every learner-visible string is agent-supplied. No hardcoded lesson text.
 *  - Every widget is spawnable in isolation and carries its own teaching intent.
 *  - Interactive widgets separate *configuration* (`WidgetIntent`, authored by
 *    the agent) from *learner interaction* (`WidgetState`, authored by the
 *    learner and fed back to the agent on the next turn).
 */

/* ── Core Intent Union ── */

export type WidgetIntent =
  | RoadmapWidget
  | ConceptCardWidget
  | SliderWidget
  | AnimationWidget
  | ComparisonWidget
  | QuestionWidget
  | HintWidget
  | ScratchpadWidget
  | AnnotationWidget
  | RevealWidget
  | ExampleWidget
  | MistakeCheckWidget
  | MemoryHookWidget
  | RetrievalCheckWidget
  | ChallengeWidget
  | ReflectionWidget
  | MasteryCardWidget;

export type WidgetKind = WidgetIntent["kind"];

/** Every widget kind, in the canonical board order (widget numbers 1–20 with
 *  the three built-in visualization widgets 3/4/5 omitted). */
export const WIDGET_KINDS = [
  "roadmap",
  "concept_card",
  "slider",
  "animation",
  "comparison",
  "question",
  "hint",
  "scratchpad",
  "annotation",
  "reveal",
  "example",
  "mistake_check",
  "memory_hook",
  "retrieval_check",
  "challenge",
  "reflection",
  "mastery_card",
] as const satisfies readonly WidgetKind[];

/** Board-spec widget numbers, preserved so product/design references line up. */
export const WIDGET_BOARD_NUMBER: Record<WidgetKind, number> = {
  roadmap: 1,
  concept_card: 2,
  slider: 6,
  animation: 7,
  comparison: 8,
  question: 9,
  hint: 10,
  scratchpad: 11,
  annotation: 12,
  reveal: 13,
  example: 14,
  mistake_check: 15,
  memory_hook: 16,
  retrieval_check: 17,
  challenge: 18,
  reflection: 19,
  mastery_card: 20,
};

export const WIDGET_LABEL: Record<WidgetKind, string> = {
  roadmap: "Roadmap",
  concept_card: "Concept Card",
  slider: "Slider",
  animation: "Animation",
  comparison: "Comparison",
  question: "Question",
  hint: "Hint",
  scratchpad: "Scratchpad",
  annotation: "Annotation",
  reveal: "Reveal",
  example: "Example",
  mistake_check: "Mistake Check",
  memory_hook: "Memory Hook",
  retrieval_check: "Retrieval Check",
  challenge: "Challenge",
  reflection: "Reflection",
  mastery_card: "Mastery Card",
};

/** Fields shared by every widget. `title` overrides the default header label;
 *  `tag` is the small uppercase chip in the widget header. */
export interface WidgetBase {
  /** Optional stable id. Used by `annotation.targetWidgetId` and by state. */
  id?: string;
  title?: string;
  tag?: string;
  /** One-line teaching purpose. Rendered as the widget's footer rationale and
   *  echoed back to the agent so it can see why it placed the widget. */
  note?: string;
  /**
   * Cluster membership.
   *
   * When the agent places several widgets that form ONE piece of work — three
   * questions probing the same idea, a scratchpad plus the challenge it feeds —
   * it gives them a shared `group.id`. The tutor is then signalled once, after
   * the learner has answered every answerable widget in the group, instead of
   * being woken by each one in turn.
   *
   * Omitted means standalone: the widget signals on its own exactly as before.
   */
  group?: WidgetGroupRef;
}

/**
 * A widget's membership in a cluster.
 *
 * Deliberately agent-declared rather than inferred from the turn boundary. Two
 * questions placed together are not necessarily one task — the agent may want a
 * quick check answered immediately and a deeper one left for later — and only
 * the agent knows which. Inferring from the turn would silently withhold the
 * signal for a widget it wanted answered on its own.
 */
export interface WidgetGroupRef {
  /** Shared identifier. Widgets carrying the same id form one cluster. */
  id: string;
  /** Optional learner-facing heading for the cluster, e.g. "Check yourself". */
  label?: string;
  /**
   * Optional count of answerable widgets the agent intends this cluster to
   * hold. When set, the cluster stays incomplete until at least this many
   * answers exist, which protects against signalling early if part of the
   * cluster failed to render or arrives in a later turn.
   */
  size?: number;
}

/* ── 1 · Roadmap — "where this lesson goes" ── */

export type RoadmapStepState = "done" | "current" | "upcoming";

export interface RoadmapStep {
  id: string;
  label: string;
  /** Optional sub-line, e.g. the exit condition for that step. */
  detail?: string;
  state?: RoadmapStepState;
}

export interface RoadmapWidget extends WidgetBase {
  kind: "roadmap";
  /** Lesson/section heading, e.g. "8.1 Derivatives". */
  heading?: string;
  steps: RoadmapStep[];
}

/* ── 2 · Concept Card — the durable definition ── */

export interface ConceptCardWidget extends WidgetBase {
  kind: "concept_card";
  term: string;
  /** e.g. "/vəˈlɒsɪti/ · vector" */
  pronunciation?: string;
  classification?: string;
  definition: string;
  /** Formal statement rendered with KaTeX under the plain-language definition. */
  definitionLatex?: string;
  /** Short "three meanings of this idea"-style facets. */
  facets?: string[];
}

/* ── 6 · Slider — manipulate one parameter ── */

export interface SliderTick {
  value: number;
  label: string;
}

export interface SliderWidget extends WidgetBase {
  kind: "slider";
  /** Human label, e.g. "Launch angle θ". */
  label: string;
  /** Symbol the readout expressions bind to, e.g. "theta", "h". */
  parameter: string;
  min: number;
  max: number;
  step?: number;
  /** Initial position. Learner movement is stored in WidgetState. */
  value: number;
  unit?: string;
  ticks?: SliderTick[];
  /** Derived quantities recomputed as the learner drags. Expressions are
   *  evaluated by a bounded math evaluator with `parameter` in scope. */
  readouts?: { id: string; label: string; expression: string; precision?: number; unit?: string }[];
  /** What the learner should watch while dragging. */
  observe?: string;
  /** Optional prompt so the learner can report what they observed. Without it
   *  the slider is watch-only and yields no evidence of understanding. */
  respond?: WidgetRespondSpec;
}

/* ── 7 · Animation — show the idea over time ── */

export interface AnimationFrame {
  id: string;
  caption: string;
  latex?: string;
}

/** Optional parametric motion drawn on the animation stage, e.g. a secant line
 *  rotating into a tangent as its second point approaches the first. */
export interface AnimationMotion {
  /** Bounded expressions in `t`. */
  xExpression: string;
  yExpression: string;
  tDomain: [number, number];
  /** Leave a fading trace of the path. */
  trace?: boolean;
  /** Optional static guide curve, also in `t`. */
  guideXExpression?: string;
  guideYExpression?: string;
}

/**
 * A point in the animation where the learner must answer before continuing.
 *
 * Checkpoints are what turn watching into thinking. An animation that plays
 * straight through produces a learner who has seen a thing happen and can tell
 * you nothing about why; stopping it at the moment the interesting change occurs
 * and requiring an answer is the difference between a demonstration and an
 * activity.
 */
export interface AnimationCheckpoint {
  id: string;
  /** Normalized playhead position, 0–1, where playback halts. */
  at: number;
  /** The question asked at this point. */
  prompt: string;
  /** Options when the checkpoint is a discrimination rather than open. */
  options?: QuestionOption[];
  /** Accepted free-text answers, for deterministic grading. */
  acceptedAnswers?: string[];
  /** Why this moment. Kept so a checkpoint cannot be placed decoratively. */
  rationale?: string;
}

/** Which playback affordances the learner is given. */
export interface AnimationControls {
  /** Learner can scrub the playhead freely. */
  scrub?: boolean;
  /** Learner can step one frame at a time. */
  step?: boolean;
  /** Learner can vary playback rate. */
  speed?: boolean;
  /** Learner can replay from the start. */
  replay?: boolean;
}

/**
 * Another representation kept in sync with the animation.
 *
 * A learner who can watch a value change on a graph while the same value changes
 * in a table is being shown that the two are the same fact in different clothes.
 * That linkage is the instructional content; presenting either alone loses it.
 */
export interface AnimationLinkedRepresentation {
  id: string;
  /** Semantic kind of the linked view — never a component name. */
  representation: "graph" | "table" | "equation" | "number_line" | "diagram";
  label: string;
  /** What in this view tracks the animation. */
  tracks: string;
}

export interface AnimationWidget extends WidgetBase {
  kind: "animation";
  frames: AnimationFrame[];
  motion?: AnimationMotion;
  /** Total run time across all frames. */
  durationMs?: number;
  loop?: boolean;
  /** The prediction the learner must commit BEFORE playback is unlocked.
   *
   *  When present, the surface locks the play control until an answer is
   *  submitted. An unlocked prediction is not a prediction — a learner who can
   *  watch first and answer after has been asked to describe, not to predict,
   *  and the two produce completely different evidence. */
  predictPrompt?: string;
  /** Prompt for committing that prediction in writing. */
  respond?: WidgetRespondSpec;
  /** Points where playback halts and an answer is required. */
  checkpoints?: AnimationCheckpoint[];
  /** Playback affordances offered to the learner. Controlled observation beats
   *  passive playback: a learner who can stop and step is examining, and one who
   *  can only watch is spectating. */
  controls?: AnimationControls;
  /** Other representations held in sync with the animation. */
  linkedRepresentations?: AnimationLinkedRepresentation[];
  /** Asked after playback, to reconcile prediction against observation.
   *
   *  This is the step that makes a wrong prediction valuable. Without it the
   *  learner sees they were wrong and moves on; with it they have to say what
   *  they expected, what happened, and what accounts for the gap — which is the
   *  moment the belief actually changes. */
  reconcilePrompt?: string;
  /** Asked last: rebuild the idea unaided, in the learner's own terms. */
  reconstructPrompt?: string;
}

/* ── 8 · Comparison — put two ideas side by side ── */

export interface ComparisonColumn {
  id: string;
  title: string;
  /** Free-form bullets when the comparison is not a strict table. */
  items?: string[];
  accent?: "cyan" | "amber" | "violet" | "ember" | "neutral";
}

export interface ComparisonRow {
  id: string;
  label: string;
  /** One cell per column, in column order. */
  cells: string[];
}

export interface ComparisonWidget extends WidgetBase {
  kind: "comparison";
  columns: ComparisonColumn[];
  /** When present the widget renders as an aligned table rather than columns. */
  rows?: ComparisonRow[];
  /** The single sentence the comparison exists to make land. */
  takeaway?: string;
}

/* ── 9 · Question & 17 · Retrieval Check — shared answer machinery ── */

export type QuestionFormat = "multiple_choice" | "short_answer" | "numeric";

export interface QuestionOption {
  id: string;
  label: string;
  correct?: boolean;
  /** The specific misconception this distractor detects. Shown after the
   *  learner picks it — a distractor without a diagnosis teaches nothing. */
  misconception?: string;
}

export interface NumericAnswerSpec {
  value: number;
  tolerance?: number;
  unit?: string;
}

export interface QuestionWidget extends WidgetBase {
  kind: "question";
  prompt: string;
  promptLatex?: string;
  format: QuestionFormat;
  options?: QuestionOption[];
  /** Accepted answers for short_answer, compared case/space-insensitively. */
  acceptedAnswers?: string[];
  numericAnswer?: NumericAnswerSpec;
  /** Revealed only after the learner commits an answer. */
  explanation?: string;
  placeholder?: string;
}

/* ── 10 · Hint — progressive, level-gated disclosure ── */

/**
 * An agent-authored prompt that gives the learner somewhere to answer inside a
 * widget that would otherwise be watch-only.
 *
 * Slider, Animation, Hint and Annotation teach by exploration, and exploration
 * alone produces no evidence: the tutor cannot tell a learner who understood
 * the sweep from one who dragged the handle and moved on. This turns the
 * exploration into a claim the learner commits to, which is what the mastery
 * loop can actually assess.
 *
 * Optional on every widget — a tutor may legitimately place a slider purely to
 * illustrate. When absent the widget stays watch-only, exactly as before.
 */
export interface WidgetRespondSpec {
  /** The question put to the learner, e.g. "What happens to the area as h shrinks?" */
  prompt: string;
  /** Placeholder for the input. */
  placeholder?: string;
  /** Button label. Defaults to "Submit". */
  submitLabel?: string;
  /** Shown after submitting, before the tutor replies. */
  acknowledgement?: string;
}

export interface HintStep {
  /** 1 = nudge, 2 = lead, 3 = reveal the idea. Never the final answer. */
  level: 1 | 2 | 3;
  label: string;
  body: string;
}

export interface HintWidget extends WidgetBase {
  kind: "hint";
  /** Optional prompt so the learner can try again after opening a hint. A hint
   *  read but never acted on is not evidence the block was cleared. */
  respond?: WidgetRespondSpec;
  steps: HintStep[];
}

/* ── 11 · Scratchpad — the learner does the work ── */

export interface ScratchpadWidget extends WidgetBase {
  kind: "scratchpad";
  /** The instruction, e.g. "Your turn. Expand this." */
  prompt?: string;
  /** Agent-written starting line the learner continues from. */
  starter?: string;
  placeholder?: string;
  lines?: number;
  /** "math" renders the learner's text in the chalk hand for algebra work. */
  mode?: "text" | "math";
}

/* ── 12 · Annotation — the agent points at something ── */

export interface AnnotationMark {
  id: string;
  /** The exact fragment being pointed at, e.g. "h → 0". */
  target: string;
  /** What the agent wants noticed about it. */
  note: string;
  emphasis?: "circle" | "underline" | "arrow" | "strike";
}

export interface AnnotationWidget extends WidgetBase {
  kind: "annotation";
  /** Anchor of the board block being annotated, when annotating one. */
  targetAnchor?: string;
  /** Plain description of what is being annotated, for the header line. */
  targetLabel?: string;
  marks: AnnotationMark[];
  /** Optional prompt so the learner can respond to what was pointed out. */
  respond?: WidgetRespondSpec;
}

/* ── 13 · Reveal — hide, then show, on the learner's terms ── */

export interface RevealItem {
  id: string;
  label: string;
  content: string;
  contentLatex?: string;
}

export interface RevealWidget extends WidgetBase {
  kind: "reveal";
  prompt?: string;
  items: RevealItem[];
  /** Text shown on the reveal control. */
  actionLabel?: string;
}

/* ── 14 · Example — the worked demonstration ── */

export interface ExampleStep {
  id: string;
  /** The line of work itself (plain text form). */
  expression?: string;
  /** The same line as TeX, preferred for rendering when present. */
  latex?: string;
  /** Why this step happens. A step without a reason is a magic trick. */
  why: string;
}

export interface ExampleWidget extends WidgetBase {
  kind: "example";
  /** The problem being worked. */
  problem?: string;
  problemLatex?: string;
  steps: ExampleStep[];
  conclusion?: string;
}

/* ── 15 · Mistake Check — diagnose, never replace, the learner's work ── */

export interface MistakeLine {
  id: string;
  content: string;
  contentLatex?: string;
  status: "ok" | "error";
  /** Required when status is "error": what specifically went wrong. */
  diagnosis?: string;
}

export interface MistakeCheckWidget extends WidgetBase {
  kind: "mistake_check";
  prompt?: string;
  lines: MistakeLine[];
  /** The underlying misconception, not just the surface slip. */
  misconception?: string;
  /** The question that leads the learner to their own correction. */
  repairQuestion?: string;
  /** Corrected form. Withheld from the board until the learner responds. */
  correction?: string;
  correctionLatex?: string;
}

/* ── 16 · Memory Hook — the compressed thing to remember ── */

export interface MemoryHookWidget extends WidgetBase {
  kind: "memory_hook";
  hook: string;
  hookLatex?: string;
  /** Unpacks the hook for the learner who forgot what it stood for. */
  elaboration?: string;
  /** Concept keys this hook should resurface against later. */
  resurfaceFor?: string[];
}

/* ── 17 · Retrieval Check — no notes, from memory, later ── */

export interface RetrievalCheckWidget extends WidgetBase {
  kind: "retrieval_check";
  prompt: string;
  promptLatex?: string;
  format: QuestionFormat;
  options?: QuestionOption[];
  acceptedAnswers?: string[];
  numericAnswer?: NumericAnswerSpec;
  /** Where this came from, e.g. "8.1 Derivatives · two sessions ago". */
  source?: string;
  /** Points a complete recalled answer must contain. */
  expectedPoints?: string[];
  explanation?: string;
  placeholder?: string;
}

/* ── 18 · Challenge — on your own ── */

export interface ChallengePart {
  id: string;
  prompt: string;
  promptLatex?: string;
}

export interface ChallengeWidget extends WidgetBase {
  kind: "challenge";
  badge?: string;
  prompt: string;
  promptLatex?: string;
  parts?: ChallengePart[];
  /** Observable criteria for a complete answer. */
  successCriteria?: string[];
  /** Set when the challenge deliberately changes context/representation. */
  transferNote?: string;
}

/* ── 19 · Reflection — explain it in your own words ── */

export interface ReflectionWidget extends WidgetBase {
  kind: "reflection";
  prompt: string;
  /** Scaffolding the learner may use, e.g. "mention what happens as h → 0". */
  guidance?: string[];
  /** What the agent will evaluate the explanation against. */
  evaluationCriteria?: string[];
  minWords?: number;
  placeholder?: string;
}

/* ── 20 · Mastery Card — evidence, not a completion badge ── */

/** The five kinds of evidence the mastery gate requires. Percentages are the
 *  agent's assessment; the verdict itself is computed deterministically in
 *  `lib/mastery.ts` and can never be asserted by the model. */
export interface MasteryEvidence {
  recall: number;
  understanding: number;
  procedure: number;
  transfer: number;
  independence: number;
}

/**
 * Widget kinds that give the learner something to DO.
 *
 * The app's standing policy is that the learner is never passive. A turn whose
 * board additions are all from outside this set has explained at the learner
 * rather than handed them the work — the roadmap-and-nothing-else turn is the
 * canonical failure. `respond` promotes the exploration widgets into this set,
 * which is exactly why it exists.
 */
export const ACTIONABLE_WIDGET_KINDS = [
  "question",
  "retrieval_check",
  "challenge",
  "reflection",
  "scratchpad",
  "mistake_check",
  "reveal",
] as const satisfies readonly WidgetKind[];

/** Exploration widgets become actionable only once the agent attaches a
 *  `respond` prompt; without one there is nowhere for the learner to answer. */
export const RESPONDABLE_WIDGET_KINDS = [
  "slider",
  "animation",
  "hint",
  "annotation",
] as const satisfies readonly WidgetKind[];

/** Does this widget give the learner a way to act or answer? */
export function isActionableWidget(intent: WidgetIntent): boolean {
  if ((ACTIONABLE_WIDGET_KINDS as readonly string[]).includes(intent.kind)) return true;
  return (
    (RESPONDABLE_WIDGET_KINDS as readonly string[]).includes(intent.kind) &&
    (intent as { respond?: unknown }).respond !== undefined
  );
}

export const MASTERY_EVIDENCE_DIMENSIONS = [
  "recall",
  "understanding",
  "procedure",
  "transfer",
  "independence",
] as const;

export type MasteryEvidenceDimension = typeof MASTERY_EVIDENCE_DIMENSIONS[number];

export interface MasteryCardWidget extends WidgetBase {
  kind: "mastery_card";
  concept: string;
  /** The skill whose ledger fills this card in.
   *
   *  Supplied by the agent so the harness knows which evidence to read. */
  skillId?: string;
  /** The five dimensions — COMPUTED from the evidence ledger, never authored.
   *
   *  Optional in the wire schema because the agent is not permitted to supply
   *  it: whatever arrives here is overwritten by the harness before the card
   *  reaches the board. A card whose skill has no ledger entries renders as
   *  unproven rather than as zeros presented like measurements. */
  evidence?: MasteryEvidence;
  /** Ids of the evidence events behind the numbers, so a claim about the
   *  learner can be traced back to the thing the learner actually did. */
  evidenceIds?: string[];
  /** The weakest dimension, named by the mastery gate. */
  weakestLink?: keyof MasteryEvidence;
  understands?: string[];
  canDo?: string[];
  recalls?: string[];
  /** Things the agent does not yet trust — the honest part of the card. */
  watch?: string[];
  next?: string;
  /** When this concept is actually scheduled to resurface. Filled in from the
   *  review queue, not from the agent's intention to remember. */
  reviewIn?: string;
}

/* ── Learner interaction state ── */

/**
 * Learner-authored widget state. Persisted onto the owning board block so it
 * survives a session reopen, and summarized back into the tutor prompt so the
 * agent can actually see what the learner did rather than guessing.
 */
export interface WidgetState {
  /** question / retrieval_check: chosen option id. */
  selectedOptionId?: string;
  /** question / retrieval_check / scratchpad / reflection: typed answer. */
  responseText?: string;
  /** True once the learner commits an answer, which unlocks the explanation. */
  submitted?: boolean;
  /** Deterministically graded outcome for auto-gradable formats. */
  correct?: boolean;
  /** slider: current parameter value. */
  sliderValue?: number;
  /** animation: playhead position, 0–1. */
  animationProgress?: number;
  /** animation: the prediction was committed, which unlocks playback. */
  predictionLocked?: boolean;
  /** animation: answers given at checkpoints, keyed by checkpoint id.
   *
   *  Deliberately a compact semantic record rather than a playback trace. What
   *  a learner answered at the moment the curve changed direction is evidence;
   *  the sequence of scrub positions that got them there is telemetry, and
   *  storing telemetry as if it were evidence is how systems end up concluding
   *  that the learner who fidgeted with the slider understands more than the one
   *  who thought before answering. */
  checkpointResponses?: Record<string, { response: string; correct?: boolean }>;
  /** animation: the post-playback reconciliation of prediction vs observation. */
  reconcileText?: string;
  /** animation: the unaided reconstruction written after reconciliation. */
  reconstructText?: string;
  /** hint: highest hint level the learner has opened. */
  hintLevelOpened?: number;
  /** Learner's own confidence in this answer, 0–100.
   *
   *  Recorded only when the surface asked for it explicitly. It is never
   *  inferred from hesitation, typing speed, or edit count — inferring
   *  confidence from behaviour is a guess dressed as a measurement. Its purpose
   *  is calibration: the gap between what a learner believes they know and what
   *  they demonstrate is itself a teachable fact, and it cannot be computed
   *  without asking. */
  confidence?: number;
  /** reveal: ids the learner has uncovered. */
  revealedIds?: string[];
  /** ISO timestamp of the learner's last interaction. */
  interactedAt?: string;
  [key: string]: unknown;
}
