/**
 * Widget cluster groups.
 *
 * The agent often places several widgets that are really ONE piece of work:
 * three questions probing the same idea from different angles, or a scratchpad
 * feeding the challenge below it. Signalling the tutor after the first of those
 * is answered is wrong twice over — it interrupts a learner who is mid-task,
 * and it hands the agent a fragment of the evidence it needs to judge whether
 * the stage's exit condition was met.
 *
 * A cluster fixes both. Widgets sharing a `group.id` are one unit: the learner
 * must answer every answerable widget in it, and only then does the tutor get a
 * single turn carrying all of the answers together.
 *
 * Two deliberate constraints:
 *
 *  - **Membership is agent-declared, not inferred from the turn.** Two
 *    questions placed in the same turn are not necessarily one task. Inferring
 *    would silently withhold the signal from a widget the agent wanted answered
 *    on its own.
 *  - **Only answerable widgets gate the cluster.** A concept card sitting
 *    between two questions is context, not work. Counting it would deadlock the
 *    cluster, because nothing can ever "answer" it.
 */

import type { WidgetIntent, WidgetState } from "./types";
import { isActionableWidget } from "./types";

/** A widget on the board, reduced to what cluster logic needs. */
export interface ClusterMember {
  /** Board anchor of the block holding this widget. */
  blockId: string;
  intent: WidgetIntent;
  state?: WidgetState;
}

/** What a cluster looks like right now. */
export interface ClusterStatus {
  groupId: string;
  label?: string;
  /** Members that can be answered. Presentational members are excluded. */
  answerable: ClusterMember[];
  /** How many of those have been committed. */
  answered: number;
  /** How many answers the cluster needs before it is complete. */
  required: number;
  /** True when every answerable member has been committed. */
  complete: boolean;
}

/** Has the learner committed an answer to this widget? */
export function isAnswered(member: ClusterMember): boolean {
  return member.state?.submitted === true;
}

/** The group id this widget belongs to, or undefined when standalone. */
export function groupIdOf(intent: WidgetIntent): string | undefined {
  const id = intent.group?.id;
  return typeof id === "string" && id.trim().length > 0 ? id.trim() : undefined;
}

/**
 * Summarise one cluster from the widgets currently on the board.
 *
 * `required` is the number of answerable members, raised to `group.size` when
 * the agent declared a larger cluster than has rendered so far. That guard
 * matters: if the agent says the cluster holds three questions but only two
 * made it onto the board, completing both must NOT signal the tutor as though
 * the learner finished all three.
 */
export function summarizeCluster(members: ClusterMember[], groupId: string): ClusterStatus | null {
  const inGroup = members.filter((member) => groupIdOf(member.intent) === groupId);
  if (inGroup.length === 0) return null;

  const answerable = inGroup.filter((member) => isActionableWidget(member.intent));
  const answered = answerable.filter(isAnswered).length;

  // The agent's declared size, when it is a sane positive integer.
  const declared = inGroup
    .map((member) => member.intent.group?.size)
    .find((size): size is number => typeof size === "number" && Number.isFinite(size) && size > 0);

  const required = Math.max(answerable.length, declared ? Math.floor(declared) : 0);
  const label = inGroup.map((member) => member.intent.group?.label).find((text) => typeof text === "string" && text.trim().length > 0);

  return {
    groupId,
    label: label?.trim(),
    answerable,
    answered,
    required,
    // A cluster of zero answerable widgets is presentational and can never
    // complete — treating it as complete would signal the tutor for nothing.
    complete: required > 0 && answered >= required,
  };
}

/** Every distinct cluster present, in first-appearance order. */
export function collectClusters(members: ClusterMember[]): ClusterStatus[] {
  const seen: string[] = [];
  for (const member of members) {
    const id = groupIdOf(member.intent);
    if (id && !seen.includes(id)) seen.push(id);
  }
  return seen
    .map((id) => summarizeCluster(members, id))
    .filter((status): status is ClusterStatus => status !== null);
}

/**
 * The gate.
 *
 * Given the widget the learner just answered, decide whether the tutor should
 * be signalled now. A standalone widget always may. A clustered widget may only
 * when its answer was the one that completed the cluster — which also means
 * exactly one member of a cluster ever triggers the signal, so the tutor is
 * woken once no matter how many widgets the cluster holds.
 */
export function clusterAllowsSignal(
  members: ClusterMember[],
  blockId: string
): { allowed: boolean; cluster: ClusterStatus | null } {
  const self = members.find((member) => member.blockId === blockId);
  if (!self) return { allowed: false, cluster: null };

  const groupId = groupIdOf(self.intent);
  if (!groupId) return { allowed: true, cluster: null };

  const cluster = summarizeCluster(members, groupId);
  if (!cluster) return { allowed: true, cluster: null };
  return { allowed: cluster.complete, cluster };
}

/**
 * Progress line shown inside every widget in an incomplete cluster.
 *
 * The learner must be able to see WHY answering did not produce a reply — an
 * answered question that sits there silently otherwise reads as a broken app.
 */
export function clusterProgressText(cluster: ClusterStatus): string {
  const { answered, required } = cluster;
  if (required <= 1) return "";
  if (answered >= required) return "All answered — sending to your tutor…";
  const remaining = required - answered;
  return `${answered} of ${required} answered · ${remaining} more before your tutor replies`;
}
