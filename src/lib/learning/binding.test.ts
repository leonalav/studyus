import { describe, it, expect, beforeEach } from "vitest";
import { getDb } from "../../db/database";
import {
  bindBlockToActivity,
  getActivityForBlock,
  getLatestSessionActivity,
  recordActivityContract,
} from "./store";
import type { LearningActivityContract } from "./types";

/**
 * A widget is placed under one activity contract and may be answered several
 * turns later. By then the session's newest contract usually describes a
 * different move, on a different task family, possibly on a different skill.
 *
 * Attributing the answer to "the latest contract" therefore does not merely
 * lose precision — it files genuine learner work as evidence of something the
 * learner was never asked to do. Breadth counts inflate on a task family they
 * never attempted, and a transfer variant gets credited for a same-context
 * answer. These tests pin the binding that keeps the contract travelling with
 * the task instead of with the clock.
 */

let seq = 0;

function contract(overrides: Partial<LearningActivityContract> = {}): LearningActivityContract {
  seq += 1;
  return {
    activityId: `act_${seq}`,
    targetSkillIds: ["derivatives"],
    stage: "construct",
    mode: "guided_practice",
    taskFamily: "difference_quotient",
    contextVariant: "same",
    supportCeiling: 1,
    expectedEvidence: ["procedure"],
    successCriteria: ["states the limit correctly"],
    representationRoles: [],
    createdAt: new Date(Date.now() + seq * 1000).toISOString(),
    ...overrides,
  };
}

describe("board block → activity binding", () => {
  beforeEach(async () => {
    await getDb();
  });

  it("resolves a block to the contract it was placed under, not the newest one", async () => {
    seq += 1;
    const sessionId = `session_${seq}`;
    const placed = contract({ taskFamily: "chain_rule", contextVariant: "same" });
    await recordActivityContract(placed, sessionId);
    await bindBlockToActivity(sessionId, "block_a", placed.activityId);

    // The tutor moves on: two more contracts are authored while the learner is
    // still thinking about the first widget.
    for (const later of [
      contract({ taskFamily: "implicit_diff", contextVariant: "changed_context" }),
      contract({ taskFamily: "related_rates", contextVariant: "changed_constraints" }),
    ]) {
      await recordActivityContract(later, sessionId);
    }

    const resolved = await getActivityForBlock(sessionId, "block_a");
    expect(resolved?.activityId).toBe(placed.activityId);
    expect(resolved?.taskFamily).toBe("chain_rule");
    // This is precisely the attribution the old latest-wins lookup got wrong.
    expect((await getLatestSessionActivity(sessionId))?.taskFamily).toBe("related_rates");
  });

  it("keeps each block on its own contract when several are placed in one session", async () => {
    seq += 1;
    const sessionId = `session_${seq}`;
    const first = contract({ taskFamily: "family_one" });
    const second = contract({ taskFamily: "family_two", contextVariant: "changed_numbers" });
    await recordActivityContract(first, sessionId);
    await recordActivityContract(second, sessionId);
    await bindBlockToActivity(sessionId, "block_one", first.activityId);
    await bindBlockToActivity(sessionId, "block_two", second.activityId);

    expect((await getActivityForBlock(sessionId, "block_one"))?.taskFamily).toBe("family_one");
    expect((await getActivityForBlock(sessionId, "block_two"))?.taskFamily).toBe("family_two");
  });

  it("scopes bindings to their session so identical block ids never collide", async () => {
    seq += 1;
    const sessionA = `session_${seq}a`;
    const sessionB = `session_${seq}b`;
    const inA = contract({ taskFamily: "in_session_a" });
    const inB = contract({ taskFamily: "in_session_b" });
    await recordActivityContract(inA, sessionA);
    await recordActivityContract(inB, sessionB);
    await bindBlockToActivity(sessionA, "shared_block_id", inA.activityId);
    await bindBlockToActivity(sessionB, "shared_block_id", inB.activityId);

    expect((await getActivityForBlock(sessionA, "shared_block_id"))?.taskFamily).toBe("in_session_a");
    expect((await getActivityForBlock(sessionB, "shared_block_id"))?.taskFamily).toBe("in_session_b");
  });

  it("rebinds a block that is reissued under a new contract", async () => {
    seq += 1;
    const sessionId = `session_${seq}`;
    const original = contract({ taskFamily: "original" });
    const reissued = contract({ taskFamily: "reissued" });
    await recordActivityContract(original, sessionId);
    await recordActivityContract(reissued, sessionId);
    await bindBlockToActivity(sessionId, "block_x", original.activityId);
    // Re-placing the same block id means the task genuinely was set again.
    await bindBlockToActivity(sessionId, "block_x", reissued.activityId);

    expect((await getActivityForBlock(sessionId, "block_x"))?.taskFamily).toBe("reissued");
  });

  it("returns nothing for an unbound block rather than guessing a contract", async () => {
    seq += 1;
    const sessionId = `session_${seq}`;
    const only = contract({ taskFamily: "some_family" });
    await recordActivityContract(only, sessionId);

    // Blocks placed before binding existed, or outside a policy-governed turn,
    // must be reported as unknown. The caller then chooses its own fallback
    // knowingly instead of being handed an unrelated contract as if it were
    // the truth.
    expect(await getActivityForBlock(sessionId, "never_bound")).toBeUndefined();
  });

  it("ignores empty identifiers instead of writing a junk binding", async () => {
    seq += 1;
    const sessionId = `session_${seq}`;
    const only = contract();
    await recordActivityContract(only, sessionId);

    await bindBlockToActivity(sessionId, "   ", only.activityId);
    await bindBlockToActivity("", "block_y", only.activityId);
    await bindBlockToActivity(sessionId, "block_z", "  ");

    expect(await getActivityForBlock(sessionId, "   ")).toBeUndefined();
    expect(await getActivityForBlock(sessionId, "block_z")).toBeUndefined();
  });
});
