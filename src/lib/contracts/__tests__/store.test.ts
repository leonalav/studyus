import { describe, it, expect, beforeEach, beforeAll } from "vitest";
import { getDb } from "../../../db/database";
import {
  saveContract,
  getContractById,
  listActiveContracts,
  listAllContracts,
  revokeContract,
  createNextRevision,
  getLatestRevisionNumber,
  getActiveContract,
} from "../store";
import type { TurnContract } from "../types";

function makeContract(overrides: Partial<TurnContract> = {}): TurnContract {
  return {
    contractId: overrides.contractId ?? "tc-test-001",
    revision: overrides.revision ?? 1,
    learnerId: overrides.learnerId ?? "learner-1",
    schemaVersion: 1,
    commitments: overrides.commitments ?? [
      { kind: "scope_include", concept: "linear algebra" },
    ],
    createdAt: overrides.createdAt ?? "2026-08-24T00:00:00.000Z",
    active: overrides.active ?? true,
    ...overrides,
  };
}

beforeAll(async () => {
  await getDb();
});

beforeEach(async () => {
  const db = await getDb();
  db.run("DELETE FROM turn_contract_revisions;");
});

describe("TurnContract store - save and retrieve", () => {
  it("saveContract + getContractById round-trips correctly", async () => {
    const contract = makeContract({ contractId: "tc-round-trip-1" });
    await saveContract(contract);

    const fetched = await getContractById("tc-round-trip-1");
    expect(fetched).not.toBeNull();
    expect(fetched!.contractId).toBe("tc-round-trip-1");
    expect(fetched!.learnerId).toBe("learner-1");
    expect(fetched!.revision).toBe(1);
    expect(fetched!.commitments).toEqual([
      { kind: "scope_include", concept: "linear algebra" },
    ]);
    expect(fetched!.active).toBe(true);
  });

  it("getContractById returns null for non-existent id", async () => {
    expect(await getContractById("tc-does-not-exist")).toBeNull();
  });

  it("stores optional metadata fields", async () => {
    const contract = makeContract({
      contractId: "tc-metadata-1",
      sessionId: "session-A",
      activityId: "activity-1",
      source: "onboarding",
    });
    await saveContract(contract);

    const fetched = await getContractById("tc-metadata-1");
    expect(fetched!.sessionId).toBe("session-A");
    expect(fetched!.activityId).toBe("activity-1");
    expect(fetched!.source).toBe("onboarding");
  });
});

describe("TurnContract store - active filtering", () => {
  it("listActiveContracts returns only active revisions", async () => {
    await saveContract(makeContract({ contractId: "tc-active-1", revision: 1, active: true }));
    await saveContract(makeContract({ contractId: "tc-active-2", revision: 2, active: false, revokedAt: "2026-08-24T01:00:00.000Z", revokedReason: "superseded" }));

    const active = await listActiveContracts("learner-1");
    expect(active).toHaveLength(1);
    expect(active[0].contractId).toBe("tc-active-1");
  });

  it("listActiveContracts returns empty array when all revoked", async () => {
    await saveContract(makeContract({ contractId: "tc-revoked-1", revision: 1, active: false, revokedAt: "2026-08-24T01:00:00.000Z", revokedReason: "changed mind" }));

    const active = await listActiveContracts("learner-1");
    expect(active).toHaveLength(0);
  });

  it("listAllContracts returns both active and revoked", async () => {
    await saveContract(makeContract({ contractId: "tc-all-1", revision: 1, active: true }));
    await saveContract(makeContract({ contractId: "tc-all-2", revision: 2, active: false, revokedAt: "2026-08-24T01:00:00.000Z", revokedReason: "superseded" }));

    const all = await listAllContracts("learner-1");
    expect(all).toHaveLength(2);
  });

  it("listActiveContracts filters by learner", async () => {
    await saveContract(makeContract({ contractId: "tc-l1", revision: 1, active: true, learnerId: "learner-1" }));
    await saveContract(makeContract({ contractId: "tc-l2", revision: 1, active: true, learnerId: "learner-2" }));

    const l1 = await listActiveContracts("learner-1");
    const l2 = await listActiveContracts("learner-2");
    expect(l1).toHaveLength(1);
    expect(l2).toHaveLength(1);
    expect(l1[0].contractId).toBe("tc-l1");
    expect(l2[0].contractId).toBe("tc-l2");
  });

  it("getLatestRevisionNumber returns the historical high-water mark for a null-session lineage", async () => {
    await saveContract(makeContract({ contractId: "tc-rev-1", revision: 1, active: true }));
    await saveContract(makeContract({
      contractId: "tc-rev-3-revoked",
      revision: 3,
      active: false,
      revokedAt: "2026-08-24T01:00:00.000Z",
      revokedReason: "changed mind",
    }));

    expect(await getLatestRevisionNumber("learner-1")).toBe(3);
  });

  it("getLatestRevisionNumber isolates session and null-session lineages", async () => {
    await saveContract(makeContract({
      contractId: "tc-session-a-4",
      revision: 4,
      learnerId: "learner-lineages",
      sessionId: "session-A",
    }));
    await saveContract(makeContract({
      contractId: "tc-session-b-2",
      revision: 2,
      learnerId: "learner-lineages",
      sessionId: "session-B",
    }));
    await saveContract(makeContract({
      contractId: "tc-null-session-3",
      revision: 3,
      learnerId: "learner-lineages",
    }));

    expect(await getLatestRevisionNumber("learner-lineages", "session-A")).toBe(4);
    expect(await getLatestRevisionNumber("learner-lineages", "session-B")).toBe(2);
    expect(await getLatestRevisionNumber("learner-lineages")).toBe(3);
  });

  it("getLatestRevisionNumber returns 0 when a lineage has no revisions", async () => {
    await saveContract(makeContract({
      contractId: "tc-other-session",
      learnerId: "learner-no-history",
      sessionId: "session-A",
    }));

    expect(await getLatestRevisionNumber("learner-no-history")).toBe(0);
    expect(await getLatestRevisionNumber("learner-no-history", "session-B")).toBe(0);
  });
});

describe("TurnContract store - revocation", () => {
  it("revokeContract sets active=0 and stamps revokedAt", async () => {
    await saveContract(makeContract({ contractId: "tc-rev-1", revision: 1, active: true }));

    await revokeContract("tc-rev-1", "learner preference changed", "2026-08-24T02:00:00.000Z");

    const fetched = await getContractById("tc-rev-1");
    expect(fetched!.active).toBe(false);
    expect(fetched!.revokedAt).toBe("2026-08-24T02:00:00.000Z");
    expect(fetched!.revokedReason).toBe("learner preference changed");
  });

  it("revokeContract is idempotent (already revoked)", async () => {
    await saveContract(makeContract({ contractId: "tc-rev-idempotent", revision: 1, active: true }));

    await revokeContract("tc-rev-idempotent", "first", "2026-08-24T02:00:00.000Z");
    await revokeContract("tc-rev-idempotent", "second", "2026-08-24T03:00:00.000Z");

    const fetched = await getContractById("tc-rev-idempotent");
    expect(fetched!.active).toBe(false);
    // First revocation timestamp is preserved.
    expect(fetched!.revokedAt).toBe("2026-08-24T02:00:00.000Z");
    expect(fetched!.revokedReason).toBe("first");
  });
});

describe("TurnContract store - createNextRevision", () => {
  it("supersedes previous active revision and inserts new one", async () => {
    await saveContract(makeContract({
      contractId: "tc-nxt-1",
      revision: 1,
      learnerId: "learner-nxt",
      active: true,
      sessionId: "session-nxt",
      activityId: "activity-nxt",
    }));

    const newContract = makeContract({
      contractId: "tc-nxt-2",
      revision: 2,
      learnerId: "learner-nxt",
      active: true,
      sessionId: "session-nxt",
      activityId: "activity-nxt",
      createdAt: "2026-08-24T10:00:00.000Z",
    });

    const saved = await createNextRevision(newContract);

    expect(saved.contractId).toBe("tc-nxt-2");

    const old = await getContractById("tc-nxt-1");
    expect(old!.active).toBe(false);
    expect(old!.revokedReason).toBe("superseded");

    const active = await listActiveContracts("learner-nxt");
    expect(active).toHaveLength(1);
    expect(active[0].contractId).toBe("tc-nxt-2");
  });

  it("only supersedes within the same session scope", async () => {
    await saveContract(makeContract({
      contractId: "tc-scope-1",
      revision: 1,
      learnerId: "learner-scope",
      active: true,
      sessionId: "session-A",
      activityId: "activity-A",
    }));

    await saveContract(makeContract({
      contractId: "tc-scope-2",
      revision: 1,
      learnerId: "learner-scope",
      active: true,
      sessionId: "session-B",
      activityId: "activity-B",
    }));

    await createNextRevision(makeContract({
      contractId: "tc-scope-3",
      revision: 2,
      learnerId: "learner-scope",
      active: true,
      sessionId: "session-A",
      activityId: "activity-A",
      createdAt: "2026-08-24T10:00:00.000Z",
    }));

    const oldA = await getContractById("tc-scope-1");
    expect(oldA!.active).toBe(false);

    const oldB = await getContractById("tc-scope-2");
    expect(oldB!.active).toBe(true);
  });

  it("uses the historical high-water mark for a superseded session revision", async () => {
    await saveContract(makeContract({
      contractId: "tc-monotonic-1",
      revision: 1,
      learnerId: "learner-monotonic",
      sessionId: "session-monotonic",
      active: true,
    }));

    await createNextRevision(makeContract({
      contractId: "tc-monotonic-2",
      revision: 2,
      learnerId: "learner-monotonic",
      sessionId: "session-monotonic",
      active: true,
    }));

    await revokeContract("tc-monotonic-2", "changed mind");

    expect(await getLatestRevisionNumber("learner-monotonic", "session-monotonic")).toBe(2);
  });

  it("persists revoked revisions for auditability", async () => {    await saveContract(makeContract({
      contractId: "tc-audit-1",
      revision: 1,
      learnerId: "learner-audit",
      active: true,
    }));

    await createNextRevision(makeContract({
      contractId: "tc-audit-2",
      revision: 2,
      learnerId: "learner-audit",
      active: true,
      createdAt: "2026-08-24T10:00:00.000Z",
    }));

    const all = await listAllContracts("learner-audit");
    expect(all).toHaveLength(2);

    const active = await listActiveContracts("learner-audit");
    expect(active).toHaveLength(1);

    expect(all.find((c) => c.contractId === "tc-audit-1")).toBeDefined();
  });
});

describe("TurnContract store - getActiveContract", () => {
  it("returns null when the learner has no revisions", async () => {
    expect(await getActiveContract("learner-empty")).toBeNull();
  });

  it("returns null when all revisions are revoked", async () => {
    await saveContract(makeContract({
      contractId: "tc-ga-revoked",
      learnerId: "learner-ga-none",
      active: false,
      revokedAt: "2026-08-24T01:00:00.000Z",
      revokedReason: "changed mind",
    }));
    expect(await getActiveContract("learner-ga-none")).toBeNull();
  });

  it("returns the null-session active contract when no sessionId is given", async () => {
    await saveContract(makeContract({
      contractId: "tc-ga-null",
      learnerId: "learner-ga-null",
      revision: 1,
      active: true,
    }));
    const active = await getActiveContract("learner-ga-null");
    expect(active?.contractId).toBe("tc-ga-null");
  });

  it("prefers a session-specific active contract over the null-session one", async () => {
    await saveContract(makeContract({
      contractId: "tc-ga-general",
      learnerId: "learner-ga-mix",
      revision: 1,
      active: true,
    }));
    await saveContract(makeContract({
      contractId: "tc-ga-session",
      learnerId: "learner-ga-mix",
      sessionId: "session-mix",
      revision: 1,
      active: true,
      commitments: [{ kind: "notation", rule: "use radians" }],
    }));

    const forSession = await getActiveContract("learner-ga-mix", "session-mix");
    expect(forSession?.contractId).toBe("tc-ga-session");

    const withoutSession = await getActiveContract("learner-ga-mix");
    expect(withoutSession?.contractId).toBe("tc-ga-general");
  });

  it("falls back to the null-session active contract when the session has none", async () => {
    await saveContract(makeContract({
      contractId: "tc-ga-fallback-general",
      learnerId: "learner-ga-fallback",
      revision: 1,
      active: true,
    }));

    const forUnknownSession = await getActiveContract("learner-ga-fallback", "session-never");
    expect(forUnknownSession?.contractId).toBe("tc-ga-fallback-general");
  });

  it("returns the highest revision when multiple active revisions share a scope", async () => {
    // A supersession leaves the prior active row revoked, but a directly-
    // inserted second active row in the same scope (legacy/data anomaly) must
    // resolve to the higher revision rather than racing on insertion order.
    await saveContract(makeContract({
      contractId: "tc-ga-low",
      learnerId: "learner-ga-hwm",
      sessionId: "session-hwm",
      revision: 1,
      active: true,
    }));
    await saveContract(makeContract({
      contractId: "tc-ga-high",
      learnerId: "learner-ga-hwm",
      sessionId: "session-hwm",
      revision: 5,
      active: true,
    }));

    const active = await getActiveContract("learner-ga-hwm", "session-hwm");
    expect(active?.contractId).toBe("tc-ga-high");
    expect(active?.revision).toBe(5);
  });
});
