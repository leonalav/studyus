/**
 * Adaptive fading (§13.4) — fading driven by *demonstrated* mastery,
 * outperforming both fixed fading and no fading.
 *
 * Each beat has its own ladder of scaffold levels (soft → hard); fading
 * moves within the beat's ladder and never below its hardest rung.
 */

import type { Beat, ScaffoldLevel } from "./types";

const LADDERS: Record<Beat, ScaffoldLevel[]> = {
  // predict: commitments may be softened to offered choices, never revealed
  predict: ["hinted", "none"],
  // explain: any softer form would leak the graded artifact — one rung only
  explain: ["none"],
  // modify: a solved sibling may precede the completion itself
  modify: ["worked-example", "completion"],
  // write: a signature hint may precede the blank — nothing below blank
  write: ["hinted", "none"],
};

export function ladderFor(beat: Beat): ScaffoldLevel[] {
  return LADDERS[beat];
}

/** start a novice on Completion for beat 3, Hinted for beat 4 (§13.4) */
export function initialScaffold(beat: Beat): ScaffoldLevel {
  if (beat === "modify") return "completion";
  if (beat === "write") return "hinted";
  return "none";
}

/** one rung toward the hardest form; never fades below the beat's hardest */
export function fadeUp(beat: Beat, level: ScaffoldLevel): ScaffoldLevel {
  const ladder = ladderFor(beat);
  const idx = ladder.indexOf(level);
  if (idx < 0) return ladder[ladder.length - 1];
  return ladder[Math.min(idx + 1, ladder.length - 1)];
}

/** one rung toward the softest form */
export function fadeDown(beat: Beat, level: ScaffoldLevel): ScaffoldLevel {
  const ladder = ladderFor(beat);
  const idx = ladder.indexOf(level);
  if (idx < 0) return ladder[0];
  return ladder[Math.max(idx - 1, 0)];
}

export interface FadingState {
  level: ScaffoldLevel;
  consecutiveFails: number;
}

export interface FadingDecision {
  level: ScaffoldLevel;
  consecutiveFails: number;
  /** suppress fading on scaffold-requested attempts (§13.4) */
  suppressed: boolean;
}

/**
 * Apply fading rules after a graded attempt:
 * - fade one level when the learner passes at the current level *without*
 *   requesting a scaffold;
 * - un-fade one level after two consecutive failures;
 * - a requested scaffold un-fades immediately and suppresses fading on that
 *   attempt (it still counts for BKT at reduced weight 0.5);
 * - expertise reversal (§13.4): mastered skills are never offered worked
 *   examples as remediation — they become counterproductive.
 */
export function applyFading(
  beat: Beat,
  state: FadingState,
  passed: boolean,
  scaffoldRequested: boolean,
  expertiseReversalGuard: boolean,
): FadingDecision {
  if (scaffoldRequested) {
    return { level: fadeDown(beat, state.level), consecutiveFails: 0, suppressed: true };
  }
  if (passed) {
    return { level: fadeUp(beat, state.level), consecutiveFails: 0, suppressed: false };
  }
  const fails = state.consecutiveFails + 1;
  if (fails >= 2) {
    let softer = fadeDown(beat, state.level);
    if (expertiseReversalGuard && softer === "worked-example") softer = state.level;
    return { level: softer, consecutiveFails: 0, suppressed: false };
  }
  return { level: state.level, consecutiveFails: fails, suppressed: false };
}
