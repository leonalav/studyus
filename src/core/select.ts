/**
 * Selection (§13.3) — target the small gap, not the hard problem (Law 5).
 */

import type { Beat, Skill, SkillId } from "./types";
import { beatRank } from "./types";
import type { BktState } from "./bkt";
import { predictCorrect } from "./bkt";
import type { SkillGateState } from "./mastery";
import { REVIEW_INTERVAL_DAYS } from "./mastery";

export const TARGET_BAND = { lo: 0.55, hi: 0.75 } as const;
export const BAND_MID = (TARGET_BAND.lo + TARGET_BAND.hi) / 2;

export interface Candidate {
  skill: Skill;
  beat: Beat;
  gate: SkillGateState;
  bkt?: BktState;
  /** whether an unseen parameter binding is still available for this skill+beat */
  hasUnseenBinding: boolean;
  /** beat is unlocked by the strict ordering invariant (§8.4) */
  beatUnlocked: boolean;
  now: number;
  /** spaced-retrieval due time for mastered skills, when applicable */
  reviewDueAt?: number;
}

export interface SelectionContext {
  candidates: Candidate[];
  excludeExerciseKey?: string;
  /** skill id → whether all prerequisites are mastered (tiebreak a) */
  prereqsMastered: (id: SkillId) => boolean;
}

/**
 * Choose the candidate whose estimated P(correct) is closest to the middle
 * of the target band [0.55, 0.75] — never the hardest item. Ties break by
 * (a) prerequisites all mastered, (b) longest time since last seen,
 * (c) beat order.
 */
export function selectNext(ctx: SelectionContext): Candidate | null {
  const eligible = ctx.candidates.filter((c) => {
    if (!c.beatUnlocked || !c.hasUnseenBinding) return false;
    if (c.gate === "locked") return false;
    // mastered skills only re-enter through spaced retrieval (§13.3)
    if (c.gate === "mastered") {
      return c.reviewDueAt !== undefined && c.reviewDueAt <= c.now;
    }
    return true;
  });
  if (eligible.length === 0) return null;

  let best: Candidate | null = null;
  let bestKey: [number, number, number, number] | null = null;
  for (const candidate of eligible) {
    const p = predictCorrect(candidate.bkt);
    const distance = Math.abs(p - BAND_MID);
    const spacing = candidate.bkt ? candidate.now - candidate.bkt.lastAt : Number.MAX_SAFE_INTEGER;
    const key: [number, number, number, number] = [
      distance,
      ctx.prereqsMastered(candidate.skill.id) ? 0 : 1,
      -spacing,
      beatRank(candidate.beat),
    ];
    if (bestKey === null || compareKeys(key, bestKey) < 0) {
      best = candidate;
      bestKey = key;
    }
  }
  return best;
}

function compareKeys(a: number[], b: number[]): number {
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  }
  return 0;
}

/** next spaced-retrieval due time after a successful review */
export function nextReviewDue(intervalIdx: number, at: number): { dueAt: number; intervalIdx: number } {
  const idx = Math.min(intervalIdx, REVIEW_INTERVAL_DAYS.length - 1);
  return { dueAt: at + REVIEW_INTERVAL_DAYS[idx] * 86_400_000, intervalIdx: Math.min(idx + 1, REVIEW_INTERVAL_DAYS.length - 1) };
}
