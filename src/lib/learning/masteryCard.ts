/**
 * Filling mastery cards from the evidence ledger.
 *
 * A mastery card is the one place in the product where the system states, in
 * plain sight, what it believes the learner knows. If those numbers come from
 * the model, they are a fluent guess wearing the costume of a measurement — and
 * a learner reading "Transfer: 88%" has no way to tell the difference. So the
 * agent may author the prose of a card, and nothing else: every number, the
 * weakest link, the evidence trail, and the review date are overwritten here
 * from what the learner actually did.
 */

import type { BoardOp } from "../tutor";
import { assessMastery } from "../mastery";
import type { MasteryEvidence, WidgetIntent } from "../widgets/types";
import { toMasteryEvidence } from "./evidence";
import { DEFAULT_LEARNER_ID, getOpenReviews, getSkillEvidence, getSkillState, normalizeSkillId } from "./store";
import type { SkillState } from "./types";

const UNPROVEN: MasteryEvidence = {
  recall: 0,
  understanding: 0,
  procedure: 0,
  transfer: 0,
  independence: 0,
};

/**
 * Rewrite every mastery card in a turn's board operations from the ledger.
 *
 * Returns the ops unchanged when the turn contains no mastery card, which is
 * the overwhelmingly common case.
 */
export async function groundMasteryCards(
  boardOps: BoardOp[],
  params: { learnerId?: string; fallbackSkillId?: string }
): Promise<BoardOp[]> {
  const hasCard = boardOps.some(
    (op) =>
      (op.op === "place_widget" || op.op === "update_widget") &&
      op.intent.kind === "mastery_card"
  );
  if (!hasCard) return boardOps;

  const learnerId = params.learnerId ?? DEFAULT_LEARNER_ID;
  const out: BoardOp[] = [];

  for (const op of boardOps) {
    if (
      (op.op !== "place_widget" && op.op !== "update_widget") ||
      op.intent.kind !== "mastery_card"
    ) {
      out.push(op);
      continue;
    }
    const grounded = await groundMasteryCard(op.intent, {
      learnerId,
      fallbackSkillId: params.fallbackSkillId,
    });
    out.push({ ...op, intent: grounded } as BoardOp);
  }
  return out;
}

/** Ground a single mastery card intent against the ledger. */
export async function groundMasteryCard(
  intent: Extract<WidgetIntent, { kind: "mastery_card" }>,
  params: { learnerId?: string; fallbackSkillId?: string }
): Promise<Extract<WidgetIntent, { kind: "mastery_card" }>> {
  const learnerId = params.learnerId ?? DEFAULT_LEARNER_ID;
  const skillId = normalizeSkillId(intent.skillId ?? params.fallbackSkillId ?? intent.concept);

  const state = await getSkillState(skillId, learnerId);
  const evidence = state ? toMasteryEvidence(state) : UNPROVEN;
  const assessment = assessMastery(evidence);

  const events = state ? await getSkillEvidence(skillId, learnerId) : [];
  // Newest first, and only the ones that actually moved a dimension. A trail of
  // twenty ids is not a trail anyone follows.
  const evidenceIds = events
    .slice()
    .sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1))
    .slice(0, 8)
    .map((event) => event.evidenceId);

  const reviewIn = await describeScheduledReview(learnerId, skillId);

  return {
    ...intent,
    skillId,
    evidence,
    evidenceIds,
    weakestLink: assessment.weakestLink,
    // The card may only promise a review that is genuinely on the queue.
    // "Let's revisit this next week" with nothing scheduled is the failure mode
    // spaced practice exists to prevent, and it is worse than silence because
    // it feels like a plan.
    ...(reviewIn ? { reviewIn } : { reviewIn: undefined }),
    watch: buildWatchList(intent.watch, state, assessment.weakestLink),
  };
}

/**
 * Describe the next scheduled review in learner-facing terms.
 *
 * Returns undefined when nothing is scheduled, so the card omits the line
 * rather than inventing a date.
 */
async function describeScheduledReview(
  learnerId: string,
  skillId: string,
  now: Date = new Date()
): Promise<string | undefined> {
  const open = await getOpenReviews(learnerId);
  const forSkill = open
    .filter((task) => task.skillId === skillId)
    .sort((a, b) => (a.dueAt < b.dueAt ? -1 : 1));
  const next = forSkill[0];
  if (!next) return undefined;

  const days = Math.round((new Date(next.dueAt).getTime() - now.getTime()) / 86_400_000);
  const when =
    days <= 0 ? "due now" : days === 1 ? "in 1 day" : `in ${days} days`;
  return next.reconstruction
    ? `${when} — unaided reconstruction owed`
    : `${when} — unaided retrieval`;
}

/**
 * Append the honest caveats the ledger knows about.
 *
 * The agent's own `watch` list is kept; these are added because they are facts
 * the agent cannot see and would not volunteer.
 */
function buildWatchList(
  authored: string[] | undefined,
  state: SkillState | undefined,
  weakestLink: keyof MasteryEvidence
): string[] | undefined {
  const items = [...(authored ?? [])];

  if (!state || state.totalEvidenceCount === 0) {
    items.unshift("No recorded evidence for this skill yet — these dimensions are unproven, not zero.");
    return items.slice(0, 8);
  }
  if (state.totalEvidenceCount < 3) {
    items.push(
      `Only ${state.totalEvidenceCount} observation${state.totalEvidenceCount === 1 ? "" : "s"} so far — too little to be confident either way.`
    );
  }
  if (state.reconstructionDueTaskFamily) {
    items.push(
      `A supported success on "${state.reconstructionDueTaskFamily}" has not yet been reconstructed unaided.`
    );
  }
  if (state.supportedSuccesses > state.unaidedSuccesses && state.supportedSuccesses > 0) {
    items.push("Most successes here came with help; independence is the open question.");
  }
  if (state.successfulRetrievals === 0 && state.totalEvidenceCount >= 3) {
    items.push("Nothing has been recalled after a delay yet, so retention is untested.");
  }
  items.push(`Weakest link: ${weakestLink}.`);

  // De-duplicate while preserving order; the agent may well have said one of
  // these already, and a card that repeats itself reads as automated.
  const seen = new Set<string>();
  const unique = items.filter((item) => {
    const key = item.trim().toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return unique.slice(0, 8);
}
