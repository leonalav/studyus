import { DEFAULT_LEARNER_ID } from "./store";

export interface LearningPlan {
  id: string;
  learnerId: string;
  skillId: string;
  createdAt: string;
  updatedAt: string;
  status: "draft" | "active" | "paused" | "completed" | "abandoned";
  objectives: LearningObjective[];
  currentObjectiveIndex: number;
  prerequisiteThreadIds: string[];
  evidenceTrail: PlanEvidenceEntry[];
}

export interface LearningObjective {
  id: string;
  description: string;
  successCriteria: string;
  status: "pending" | "in_progress" | "completed" | "skipped";
  targetPageRange: [number, number];
  checkpointEvidence: string[];
  estimatedMinutes?: number;
}

export interface PlanEvidenceEntry {
  objectiveId: string;
  evidenceId: string;
  timestamp: string;
  verdict: "satisfied" | "partial" | "not_satisfied";
}

export type PlanEvent =
  | { type: "OBJECTIVE_COMPLETED"; objectiveId: string; evidence: string }
  | { type: "PREREQUISITE_GAP"; skillId: string; threadId: string }
  | { type: "PLAN_REVISED"; reason: string; changes: Partial<LearningPlan> }
  | { type: "PLAN_PAUSED"; reason: string }
  | { type: "PLAN_RESUMED" }
  | { type: "PLAN_COMPLETED"; summary: string };

export interface PlanDirective {
  action: "teach" | "assess" | "spawn_thread" | "pause" | "complete";
  objectiveId?: string;
  content?: string;
  reason: string;
}

export interface PlanAdherenceMetrics {
  planId: string;
  deviationCount: number;
  lastDeviationReason?: string;
  onTrackSince: string;
  estimatedCompletion?: string;
}

/**
 * Create a new learning plan for a skill
 */
export function createLearningPlan(params: {
  skillId: string;
  learnerId?: string;
  objectives: Omit<LearningObjective, "id" | "status">[];
}): LearningPlan {
  const now = new Date().toISOString();
  return {
    id: `plan-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    learnerId: params.learnerId ?? DEFAULT_LEARNER_ID,
    skillId: params.skillId,
    createdAt: now,
    updatedAt: now,
    status: "draft",
    objectives: params.objectives.map((obj, i) => ({
      ...obj,
      id: `obj-${Date.now()}-${i}`,
      status: i === 0 ? "in_progress" : "pending",
    })),
    currentObjectiveIndex: 0,
    prerequisiteThreadIds: [],
    evidenceTrail: [],
  };
}

/**
 * Process a plan event and return updated plan with next directives
 */
export function processPlanEvent(
  plan: LearningPlan,
  event: PlanEvent
): { plan: LearningPlan; nextMoves: PlanDirective[] } {
  switch (event.type) {
    case "OBJECTIVE_COMPLETED":
      return handleObjectiveCompleted(plan, event);
    case "PREREQUISITE_GAP":
      return handlePrerequisiteGap(plan, event);
    case "PLAN_REVISED":
      return handlePlanRevision(plan, event);
    case "PLAN_PAUSED":
      return { plan: { ...plan, status: "paused", updatedAt: new Date().toISOString() }, nextMoves: [{ action: "pause", reason: event.reason }] };
    case "PLAN_RESUMED":
      return { plan: { ...plan, status: "active", updatedAt: new Date().toISOString() }, nextMoves: [{ action: "teach", objectiveId: plan.objectives[plan.currentObjectiveIndex]?.id, reason: "Resuming plan" }] };
    case "PLAN_COMPLETED":
      return { plan: { ...plan, status: "completed", updatedAt: new Date().toISOString() }, nextMoves: [{ action: "complete", content: event.summary, reason: "All objectives completed" }] };
  }
}

function handleObjectiveCompleted(
  plan: LearningPlan,
  event: Extract<PlanEvent, { type: "OBJECTIVE_COMPLETED" }>
): { plan: LearningPlan; nextMoves: PlanDirective[] } {
  const objectiveIndex = plan.objectives.findIndex((o) => o.id === event.objectiveId);
  if (objectiveIndex === -1) return { plan, nextMoves: [] };

  const updatedObjectives = [...plan.objectives];
  updatedObjectives[objectiveIndex] = { ...updatedObjectives[objectiveIndex], status: "completed" };

  const evidenceEntry: PlanEvidenceEntry = {
    objectiveId: event.objectiveId,
    evidenceId: event.evidence,
    timestamp: new Date().toISOString(),
    verdict: "satisfied",
  };

  const nextObjective = updatedObjectives[plan.currentObjectiveIndex + 1];

  if (!nextObjective) {
    return {
      plan: {
        ...plan,
        objectives: updatedObjectives,
        evidenceTrail: [...plan.evidenceTrail, evidenceEntry],
        status: "completed",
        updatedAt: new Date().toISOString(),
      },
      nextMoves: [{ action: "complete", content: `Completed all ${updatedObjectives.length} objectives`, reason: "All objectives met" }],
    };
  }

  // Mark next objective as in_progress
  updatedObjectives[plan.currentObjectiveIndex + 1] = { ...nextObjective, status: "in_progress" };

  return {
    plan: {
      ...plan,
      objectives: updatedObjectives,
      currentObjectiveIndex: plan.currentObjectiveIndex + 1,
      evidenceTrail: [...plan.evidenceTrail, evidenceEntry],
      updatedAt: new Date().toISOString(),
    },
    nextMoves: [{
      action: "teach",
      objectiveId: nextObjective.id,
      content: nextObjective.description,
      reason: `Objective ${objectiveIndex + 1} complete. Advancing to: ${nextObjective.description}`,
    }],
  };
}

function handlePrerequisiteGap(
  plan: LearningPlan,
  event: Extract<PlanEvent, { type: "PREREQUISITE_GAP" }>
): { plan: LearningPlan; nextMoves: PlanDirective[] } {
  return {
    plan: {
      ...plan,
      prerequisiteThreadIds: [...plan.prerequisiteThreadIds, event.threadId],
      updatedAt: new Date().toISOString(),
    },
    nextMoves: [{
      action: "spawn_thread",
      content: event.skillId,
      reason: `Prerequisite gap detected: ${event.skillId}`,
    }],
  };
}

function handlePlanRevision(
  plan: LearningPlan,
  event: Extract<PlanEvent, { type: "PLAN_REVISED" }>
): { plan: LearningPlan; nextMoves: PlanDirective[] } {
  return {
    plan: { ...plan, ...event.changes, updatedAt: new Date().toISOString() },
    nextMoves: [{ action: "teach", content: `Plan revised: ${event.reason}`, reason: event.reason }],
  };
}

/**
 * Track plan adherence - returns metrics about deviation
 */
export function trackAdherence(
  plan: LearningPlan,
  currentAction: { type: string; targetObjectiveId?: string }
): PlanAdherenceMetrics {
  const currentObjective = plan.objectives[plan.currentObjectiveIndex];
  const isOnTrack = !currentObjective || currentAction.targetObjectiveId === currentObjective.id;

  return {
    planId: plan.id,
    deviationCount: isOnTrack ? 0 : 1,
    lastDeviationReason: isOnTrack ? undefined : `Action targeted "${currentAction.targetObjectiveId}" but current objective is "${currentObjective?.description}"`,
    onTrackSince: isOnTrack ? new Date().toISOString() : plan.updatedAt,
  };
}

/**
 * Build a learning plan from curriculum scope and learner goals
 */
export function buildPlanFromScope(params: {
  skillId: string;
  curriculumScope: { startPage: number; endPage: number; section: string }[];
  learnerGoals: string[];
}): LearningObjective[] {
  const objectives: LearningObjective[] = [];

  for (const scope of params.curriculumScope) {
    objectives.push({
      description: `Understand: ${scope.section}`,
      successCriteria: "Learner can explain the concept and complete a representative practice problem without hints",
      status: "pending",
      targetPageRange: [scope.startPage, scope.endPage],
      checkpointEvidence: [],
      estimatedMinutes: Math.ceil((scope.endPage - scope.startPage + 1) * 5), // ~5 min per page
    });
  }

  return objectives;
}
