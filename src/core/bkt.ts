/**
 * Bayesian Knowledge Tracing, per (skill, beat) — §13.1.
 * Parameters live in config so they can be tuned without a recompile.
 */

export interface BktParams {
  pInit: number; // prior
  pT: number; // transit: probability of learning on any attempt
  pG: number; // guess: correct while not knowing
  pS: number; // slip: incorrect while knowing
}

export const DEFAULT_BKT: BktParams = { pInit: 0.15, pT: 0.2, pG: 0.2, pS: 0.1 };

export interface BktState {
  p: number; // p_L — probability the learner has learned this (skill, beat)
  attempts: number;
  correct: number;
  lastAt: number;
}

export function initBktState(at: number): BktState {
  return { p: DEFAULT_BKT.pInit, attempts: 0, correct: 0, lastAt: at };
}

/**
 * Standard BKT update for one observation, then the transit step.
 * `weight` (default 1) supports §13.4: a scaffold-requested attempt still
 * counts, at a reduced weight of 0.5 — implemented as interpolation between
 * the prior state and the fully-updated state.
 */
export function bktUpdate(state: BktState, correct: boolean, at: number, params: BktParams = DEFAULT_BKT, weight = 1): BktState {
  const pL = state.p;
  let posterior: number;
  if (correct) {
    const pCorrectGivenLearned = 1 - params.pS;
    const pCorrectGivenNot = params.pG;
    const evidence = pL * pCorrectGivenLearned + (1 - pL) * pCorrectGivenNot;
    posterior = evidence > 0 ? (pL * pCorrectGivenLearned) / evidence : pL;
  } else {
    const pWrongGivenLearned = params.pS;
    const pWrongGivenNot = 1 - params.pG;
    const evidence = pL * pWrongGivenLearned + (1 - pL) * pWrongGivenNot;
    posterior = evidence > 0 ? (pL * pWrongGivenLearned) / evidence : pL;
  }
  // transit
  const updated = posterior + (1 - posterior) * params.pT;
  // reduced-weight blend for scaffold-requested attempts
  const p = pL + (updated - pL) * Math.min(1, Math.max(0, weight));
  return {
    p,
    attempts: state.attempts + 1,
    correct: state.correct + (correct ? 1 : 0),
    lastAt: at,
  };
}

/** P(correct) estimate used by the selector (§13.3). */
export function predictCorrect(state: BktState | undefined, params: BktParams = DEFAULT_BKT): number {
  const pL = state?.p ?? params.pInit;
  return pL * (1 - params.pS) + (1 - pL) * params.pG;
}
