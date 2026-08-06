/**
 * Mastery model (§13.2) — beat weighting and the Law 7 gate.
 */

import type { Beat, Skill, SkillId } from "./types";
import type { BktState } from "./bkt";

/** §13.2 — Explain weighted heavily (strongest predictor of writing ability);
 * Write most, because it *is* the target. */
export const BEAT_WEIGHT: Record<Beat, number> = {
  predict: 0.15,
  explain: 0.3,
  modify: 0.2,
  write: 0.35,
};

export const WRITE_MASTERY_THRESHOLD = 0.85;

/** §13.3 — expanding spaced-retrieval intervals (days). */
export const REVIEW_INTERVAL_DAYS = [1, 3, 7, 21, 60];

export interface SkillMasteryInput {
  skill: Skill;
  bkt: Partial<Record<Beat, BktState>>;
  /** true once a Write attempt passed at ScaffoldLevel 'none' */
  writePassedAtNone: boolean;
}

/** weighted blend of per-beat p_L over the beats the skill supports */
export function skillMasteryScore(input: SkillMasteryInput): number {
  let weightSum = 0;
  let weighted = 0;
  for (const beat of input.skill.beats) {
    const state = input.bkt[beat];
    weighted += BEAT_WEIGHT[beat] * (state?.p ?? 0.15);
    weightSum += BEAT_WEIGHT[beat];
  }
  return weightSum > 0 ? weighted / weightSum : 0;
}

/**
 * Law 7: a skill is Mastered only if Write p_L ≥ 0.85 AND at least one Write
 * attempt passed at ScaffoldLevel::None. No amount of prediction accuracy
 * can substitute.
 */
export function isMastered(input: SkillMasteryInput): boolean {
  if (!input.skill.beats.includes("write")) return false;
  const writeP = input.bkt.write?.p ?? 0;
  return writeP >= WRITE_MASTERY_THRESHOLD && input.writePassedAtNone;
}

export type SkillGateState = "locked" | "open" | "in-progress" | "mastered";

export function skillGateState(
  skill: Skill,
  allSkills: Skill[],
  masteryOf: (id: SkillId) => boolean,
  hasAttempts: (id: SkillId) => boolean,
): SkillGateState {
  if (masteryOf(skill.id)) return "mastered";
  const prereqsMet = skill.prerequisites.every((p) => {
    const prereq = allSkills.find((s) => s.id === p);
    // unknown prerequisites never lock content (pack validation rejects them separately)
    return prereq ? masteryOf(p) : true;
  });
  if (!prereqsMet) return "locked";
  return hasAttempts(skill.id) ? "in-progress" : "open";
}
