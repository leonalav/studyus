import type { BoardBlockSpec, BoardOp, TutorTurn } from "../tutor";
import type { VisualizationIntent } from "../visualization/types";
import type { WidgetIntent } from "../widgets/types";
import { describeCommitment } from "./format";
import type { Commitment, TurnContract } from "./types";

export type ContractViolationSeverity = "hard" | "soft";

export interface ContractViolation {
  severity: ContractViolationSeverity;
  commitment: Commitment;
  /** Where in the turn it was observed, e.g. `board_ops[2] (visualize)`. */
  location: string;
  /** Index into `turn.boardOps`, when the violation is attributable to one op. */
  boardOpIndex?: number;
  /** Repair-ready sentence naming the commitment and what breached it. */
  message: string;
}

/* ─────────────────────────────────────────────────────────────
   Surface collection

   Every content surface a commitment can be observed on. Mirrors the board-op
   recursion in `enforceVisualExplanation` so nested blocks are not skipped.
   ───────────────────────────────────────────────────────────── */

interface TextSurface {
  location: string;
  text: string;
  boardOpIndex?: number;
}

interface LatexSurface {
  location: string;
  tex: string;
  boardOpIndex?: number;
}

interface VisualizationSurface {
  location: string;
  intent: VisualizationIntent;
  boardOpIndex: number;
}

interface TurnSurfaces {
  texts: TextSurface[];
  latex: LatexSurface[];
  visualizations: VisualizationSurface[];
}

/** Recursively collect every string in an intent, so widget and visualization
 *  content is covered without enumerating each of the 18 widget shapes. */
function collectStrings(value: unknown, into: string[], depth = 0): void {
  if (depth > 8) return;
  if (typeof value === "string") {
    into.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) collectStrings(entry, into, depth + 1);
    return;
  }
  if (value && typeof value === "object") {
    for (const entry of Object.values(value as Record<string, unknown>)) {
      collectStrings(entry, into, depth + 1);
    }
  }
}

function pushBlockSurfaces(
  block: BoardBlockSpec,
  location: string,
  boardOpIndex: number,
  surfaces: TurnSurfaces
): void {
  switch (block.kind) {
    case "title":
    case "text":
    case "callout":
      surfaces.texts.push({ location, text: block.text, boardOpIndex });
      return;
    case "bullets":
      surfaces.texts.push({ location, text: block.items.join(" "), boardOpIndex });
      return;
    case "latex":
      surfaces.latex.push({ location, tex: block.tex, boardOpIndex });
      if (block.caption) surfaces.texts.push({ location: `${location} caption`, text: block.caption, boardOpIndex });
      return;
    case "visualization":
      surfaces.visualizations.push({ location, intent: block.intent, boardOpIndex });
      pushIntentStrings(block.intent, location, boardOpIndex, surfaces);
      return;
    case "widget":
      pushIntentStrings(block.intent, location, boardOpIndex, surfaces);
      return;
  }
}

function pushIntentStrings(
  intent: VisualizationIntent | WidgetIntent,
  location: string,
  boardOpIndex: number,
  surfaces: TurnSurfaces
): void {
  const strings: string[] = [];
  collectStrings(intent, strings);
  if (strings.length) {
    surfaces.texts.push({ location, text: strings.join(" "), boardOpIndex });
  }
}

export function collectTurnSurfaces(turn: TutorTurn): TurnSurfaces {
  const surfaces: TurnSurfaces = { texts: [], latex: [], visualizations: [] };
  surfaces.texts.push({ location: "speech", text: turn.speech });

  turn.boardOps.forEach((op, i) => {
    const location = `board_ops[${i}] (${op.op})`;
    switch (op.op) {
      case "write_title":
      case "write_text":
      case "write_callout":
        surfaces.texts.push({ location, text: op.text, boardOpIndex: i });
        return;
      case "write_bullets":
        surfaces.texts.push({ location, text: op.items.join(" "), boardOpIndex: i });
        return;
      case "write_latex":
        surfaces.latex.push({ location, tex: op.tex, boardOpIndex: i });
        if (op.caption) surfaces.texts.push({ location: `${location} caption`, text: op.caption, boardOpIndex: i });
        return;
      case "visualize":
        surfaces.visualizations.push({ location, intent: op.intent, boardOpIndex: i });
        pushIntentStrings(op.intent, location, i, surfaces);
        return;
      case "update_visualization":
        if (op.intent) {
          surfaces.visualizations.push({ location, intent: op.intent, boardOpIndex: i });
          pushIntentStrings(op.intent, location, i, surfaces);
        }
        return;
      case "place_widget":
      case "update_widget":
        pushIntentStrings(op.intent, location, i, surfaces);
        return;
      case "replace_block":
      case "insert_after":
        pushBlockSurfaces(op.block, location, i, surfaces);
        return;
      case "revise_text":
        surfaces.texts.push({ location, text: `${op.find} ${op.replace}`, boardOpIndex: i });
        return;
      case "spawn_thread":
        surfaces.texts.push({ location, text: `${op.title} ${op.reason}`, boardOpIndex: i });
        op.initialBlocks.forEach((block, b) => {
          pushBlockSurfaces(block, `${location} initialBlocks[${b}]`, i, surfaces);
        });
        return;
      default:
        // delete_block / redraw_block carry no learner-visible content.
        return;
    }
  });

  return surfaces;
}

/* ─────────────────────────────────────────────────────────────
   Normalized concept matching
   ───────────────────────────────────────────────────────────── */

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\\${}^_]/g, " ")
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Word-boundary phrase match with light plural tolerance. Deliberately
 *  conservative: a substring hit inside a longer word is not a violation
 *  ("cosine" must not fire on "cosines of" only via boundary, not "arccosine"). */
function mentionsConcept(haystack: string, concept: string): boolean {
  const needle = normalize(concept);
  if (!needle) return false;
  const hay = normalize(haystack);
  if (!hay) return false;

  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`(^|[^a-z0-9])${escaped}(e?s)?([^a-z0-9]|$)`);
  return pattern.test(hay);
}

/* ─────────────────────────────────────────────────────────────
   Representation observability

   `displayMode` exists on exactly two of the eleven visualization intents
   (geometry and function). On the other nine, graph/graphless is not
   observable and must never be treated as a violation.
   ───────────────────────────────────────────────────────────── */

const GEOMETRY_TERMS = ["geometry", "geometric", "triangle", "right triangle", "diagram", "figure"];
const FUNCTION_TERMS = ["function", "graph", "plot", "curve"];

function intentSupportsDisplayMode(
  intent: VisualizationIntent
): intent is Extract<VisualizationIntent, { type: "geometry" | "function" }> {
  return intent.type === "geometry" || intent.type === "function";
}

function matchesAnyTerm(text: string, terms: readonly string[]): boolean {
  const normalized = normalize(text);
  return terms.some((term) => normalized.includes(term));
}

function representationViolation(
  commitment: Extract<Commitment, { kind: "representation" }>,
  surface: VisualizationSurface
): ContractViolation | null {
  const avoid = commitment.avoid;
  const avoidsGeometry = avoid ? matchesAnyTerm(avoid, GEOMETRY_TERMS) : false;
  const avoidsFunction = avoid ? matchesAnyTerm(avoid, FUNCTION_TERMS) : false;

  if (avoidsGeometry && surface.intent.type === "geometry") {
    return {
      severity: "hard",
      commitment,
      location: surface.location,
      boardOpIndex: surface.boardOpIndex,
      message:
        `Learner committed to: ${describeCommitment(commitment)} ` +
        `Your board op at ${surface.location} emitted a geometry intent, which is the representation they asked you to avoid.`,
    };
  }

  if (avoidsFunction && surface.intent.type === "function") {
    return {
      severity: "hard",
      commitment,
      location: surface.location,
      boardOpIndex: surface.boardOpIndex,
      message:
        `Learner committed to: ${describeCommitment(commitment)} ` +
        `Your board op at ${surface.location} emitted a function-graph intent, which is the representation they asked you to avoid.`,
    };
  }

  // Graph vs graphless is only observable where the intent exposes displayMode.
  if (!intentSupportsDisplayMode(surface.intent)) return null;

  const wantsGraphless = /\bgraphless\b|\bno axes\b|\bwithout axes\b/.test(normalize(commitment.prefer));
  if (wantsGraphless && surface.intent.displayMode === "graph") {
    return {
      severity: "hard",
      commitment,
      location: surface.location,
      boardOpIndex: surface.boardOpIndex,
      message:
        `Learner committed to: ${describeCommitment(commitment)} ` +
        `Your board op at ${surface.location} set displayMode="graph".`,
    };
  }

  return null;
}

/* ─────────────────────────────────────────────────────────────
   Notation rules

   A notation commitment is free text, so only the forms we can actually parse
   into a forbidden token are enforceable. Anything unparseable stays a
   prompt-level obligation rather than becoming a false positive.
   ───────────────────────────────────────────────────────────── */

const NOTATION_AVOID_PATTERNS: readonly RegExp[] = [
  /\buse\s+(?:.+?)\s+not\s+(.+)$/i,
  /\bprefer\s+(?:.+?)\s+over\s+(.+)$/i,
  /\buse\s+(?:.+?)\s+instead\s+of\s+(.+)$/i,
  /\bavoid\s+(.+)$/i,
  /\bnever\s+use\s+(.+)$/i,
  /\bdon'?t\s+use\s+(.+)$/i,
];

/** The token a notation rule forbids, or null when the rule is not machine-checkable. */
export function forbiddenNotationToken(rule: string): string | null {
  for (const pattern of NOTATION_AVOID_PATTERNS) {
    const match = pattern.exec(rule.trim());
    if (match?.[1]) {
      const token = match[1].replace(/[.;,]+$/, "").trim();
      if (token.length >= 2) return token;
    }
  }
  return null;
}

/* ─────────────────────────────────────────────────────────────
   Detector
   ───────────────────────────────────────────────────────────── */

export function detectContractViolations(
  turn: TutorTurn,
  contract: TurnContract | undefined
): ContractViolation[] {
  if (!contract || !contract.active || contract.commitments.length === 0) return [];

  const surfaces = collectTurnSurfaces(turn);
  const violations: ContractViolation[] = [];

  for (const commitment of contract.commitments) {
    switch (commitment.kind) {
      case "scope_exclude": {
        for (const surface of [...surfaces.texts, ...surfaces.latex.map((l) => ({ ...l, text: l.tex }))]) {
          if (mentionsConcept(surface.text, commitment.concept)) {
            violations.push({
              severity: "hard",
              commitment,
              location: surface.location,
              boardOpIndex: surface.boardOpIndex,
              message:
                `Learner committed to: ${describeCommitment(commitment)} ` +
                `Your ${surface.location} referenced "${commitment.concept}".`,
            });
          }
        }
        break;
      }

      case "representation": {
        for (const surface of surfaces.visualizations) {
          const violation = representationViolation(commitment, surface);
          if (violation) violations.push(violation);
        }
        break;
      }

      case "notation": {
        const forbidden = forbiddenNotationToken(commitment.rule);
        if (!forbidden) break;
        for (const surface of surfaces.latex) {
          if (mentionsConcept(surface.tex, forbidden)) {
            violations.push({
              severity: "hard",
              commitment,
              location: surface.location,
              boardOpIndex: surface.boardOpIndex,
              message:
                `Learner committed to: ${describeCommitment(commitment)} ` +
                `Your emitted LaTeX at ${surface.location} used "${forbidden}".`,
            });
          }
        }
        break;
      }

      case "example_domain": {
        // Soft: a turn may legitimately have no example at all, so absence of
        // the domain is not evidence of a breach. Reported, never enforced.
        const mentioned = surfaces.texts.some((surface) => mentionsConcept(surface.text, commitment.domain));
        if (!mentioned) {
          violations.push({
            severity: "soft",
            commitment,
            location: "turn",
            message:
              `Learner committed to: ${describeCommitment(commitment)} ` +
              `This turn drew no example from that domain.`,
          });
        }
        break;
      }

      case "scope_include":
      case "pace":
      case "goal":
        // Not observable at turn level: a single turn cannot be expected to
        // cover an included concept, hit a weekly cadence, or reach a goal.
        break;
    }
  }

  return violations;
}

/** Repair lines appended to validator errors so the existing bounded
 *  `callStructuredAgent` retry loop feeds them back to the model. */
export function contractRepairErrors(violations: readonly ContractViolation[]): string[] {
  return violations.filter((v) => v.severity === "hard").map((v) => v.message);
}

/* ─────────────────────────────────────────────────────────────
   Deterministic post-generation enforcement
   ───────────────────────────────────────────────────────────── */

export interface ContractEnforcementResult {
  turn: TutorTurn;
  /** Violations that survived the repair loop. Never presented as satisfied. */
  unresolved: ContractViolation[];
  droppedBoardOpIndices: number[];
}

/**
 * Runs after the repair loop is exhausted. Drops only board ops whose breach is
 * deterministically attributable; speech is never rewritten, because a
 * mechanical excision would produce incoherent tutoring. Unresolved violations
 * are returned for logging rather than silently marked clean.
 */
export function enforceLearnerContract(
  turn: TutorTurn,
  contract: TurnContract | undefined
): ContractEnforcementResult {
  const violations = detectContractViolations(turn, contract);
  if (violations.length === 0) {
    return { turn, unresolved: [], droppedBoardOpIndices: [] };
  }

  const dropIndices = new Set<number>();
  for (const violation of violations) {
    if (violation.severity === "hard" && violation.boardOpIndex !== undefined) {
      dropIndices.add(violation.boardOpIndex);
    }
  }

  if (dropIndices.size === 0) {
    return { turn, unresolved: violations, droppedBoardOpIndices: [] };
  }

  const boardOps: BoardOp[] = turn.boardOps.filter((_, i) => !dropIndices.has(i));
  const droppedBoardOpIndices = [...dropIndices].sort((a, b) => a - b);

  return {
    turn: { ...turn, boardOps },
    unresolved: violations.filter(
      (v) => v.boardOpIndex === undefined || !dropIndices.has(v.boardOpIndex)
    ),
    droppedBoardOpIndices,
  };
}
