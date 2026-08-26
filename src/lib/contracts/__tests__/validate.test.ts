import { describe, it, expect } from "vitest";
import { validateTurnContract, normalizeCommitments } from "../validate";
import type { Commitment } from "../types";

/* ─────────────────────────────────────────────────────────────
   Engine-owned field rejection
   ───────────────────────────────────────────────────────────── */

describe("validateTurnContract - engine-owned field rejection", () => {
  it("rejects a commitment with 'mastery' in the concept field", () => {
    const result = validateTurnContract({
      contractId: "tc-test-1",
      revision: 1,
      learnerId: "learner-1",
      schemaVersion: 1,
      commitments: [
        { kind: "scope_include", concept: "mastery of the quadratic formula" },
      ],
      createdAt: "2026-08-24T00:00:00.000Z",
      active: true,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => /mastery/i.test(e))).toBe(true);
    }
  });

  it("rejects a commitment with 'hint_depth' in avoid field", () => {
    const result = validateTurnContract({
      contractId: "tc-test-2",
      revision: 1,
      learnerId: "learner-1",
      schemaVersion: 1,
      commitments: [
        {
          kind: "representation",
          prefer: "visual diagrams",
          avoid: "progressive hint depth",
        },
      ],
      createdAt: "2026-08-24T00:00:00.000Z",
      active: true,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => /hint depth/i.test(e))).toBe(true);
    }
  });

  it("rejects a commitment with 'support level' in the rule field", () => {
    const result = validateTurnContract({
      contractId: "tc-test-3",
      revision: 1,
      learnerId: "learner-1",
      schemaVersion: 1,
      commitments: [
        { kind: "notation", rule: "set support level to medium" },
      ],
      createdAt: "2026-08-24T00:00:00.000Z",
      active: true,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => /support level/i.test(e))).toBe(true);
    }
  });

  it("rejects a goal with 'stage exit' in the statement", () => {
    const result = validateTurnContract({
      contractId: "tc-test-4",
      revision: 1,
      learnerId: "learner-1",
      schemaVersion: 1,
      commitments: [
        {
          kind: "goal",
          statement: "achieve stage exit by Friday",
        },
      ],
      createdAt: "2026-08-24T00:00:00.000Z",
      active: true,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => /stage exit/i.test(e))).toBe(true);
    }
  });

  it("rejects a commitment with 'advancement' in the concept", () => {
    const result = validateTurnContract({
      contractId: "tc-test-5",
      revision: 1,
      learnerId: "learner-1",
      schemaVersion: 1,
      commitments: [
        { kind: "scope_exclude", concept: "advancement to next stage" },
      ],
      createdAt: "2026-08-24T00:00:00.000Z",
      active: true,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => /advancement/i.test(e))).toBe(true);
    }
  });

  it("rejects a commitment with 'evidence sufficiency' in the statement", () => {
    const result = validateTurnContract({
      contractId: "tc-test-6",
      revision: 1,
      learnerId: "learner-1",
      schemaVersion: 1,
      commitments: [
        {
          kind: "goal",
          statement: "demonstrate evidence sufficiency for calculus",
        },
      ],
      createdAt: "2026-08-24T00:00:00.000Z",
      active: true,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => /evidence sufficiency/i.test(e))).toBe(true);
    }
  });

  it("accepts learner vocabulary that merely contains an engine term as a substring", () => {
    const result = validateTurnContract({
      contractId: "tc-test-score-substring",
      revision: 1,
      learnerId: "learner-1",
      schemaVersion: 1,
      commitments: [
        { kind: "scope_include", concept: "highscore tracking" },
        { kind: "scope_exclude", concept: "underscore conventions" },
        { kind: "example_domain", domain: "scoreboard design" },
      ],
      createdAt: "2026-08-24T00:00:00.000Z",
      active: true,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.commitments).toHaveLength(3);
    }
  });

  it("still rejects the engine term when it stands as its own word", () => {
    const result = validateTurnContract({
      contractId: "tc-test-score-word",
      revision: 1,
      learnerId: "learner-1",
      schemaVersion: 1,
      commitments: [
        { kind: "goal", statement: "raise my score to 90" },
      ],
      createdAt: "2026-08-24T00:00:00.000Z",
      active: true,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => /score/i.test(e))).toBe(true);
    }
  });

  it("rejects a routing override attempt", () => {
    const result = validateTurnContract({
      contractId: "tc-test-routing",
      revision: 1,
      learnerId: "learner-1",
      schemaVersion: 1,
      commitments: [
        { kind: "notation", rule: "apply a routing override for me" },
      ],
      createdAt: "2026-08-24T00:00:00.000Z",
      active: true,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => /routing override/i.test(e))).toBe(true);
    }
  });
});

/* ─────────────────────────────────────────────────────────────
   Normal validation shape
   ───────────────────────────────────────────────────────────── */

describe("validateTurnContract - valid contracts", () => {
  it("accepts a minimal valid contract with a single commitment", () => {
    const result = validateTurnContract({
      contractId: "tc-ok-1",
      revision: 1,
      learnerId: "learner-1",
      schemaVersion: 1,
      commitments: [
        { kind: "scope_include", concept: "linear algebra basics" },
      ],
      createdAt: "2026-08-24T00:00:00.000Z",
      active: true,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.contractId).toBe("tc-ok-1");
      expect(result.value.revision).toBe(1);
      expect(result.value.commitments).toHaveLength(1);
      expect(result.value.commitments[0].kind).toBe("scope_include");
    }
  });

  it("accepts a contract with multiple commitment kinds", () => {
    const result = validateTurnContract({
      contractId: "tc-ok-2",
      revision: 2,
      learnerId: "learner-1",
      schemaVersion: 1,
      commitments: [
        { kind: "scope_include", concept: "vectors" },
        { kind: "scope_exclude", concept: "pure theory" },
        {
          kind: "representation",
          prefer: "geometric intuition",
          avoid: "algebraic manipulation only",
        },
        { kind: "pace", sessionsPerWeek: 3, minutesPerSession: 45 },
        { kind: "notation", rule: "use standard vector arrows" },
        { kind: "example_domain", domain: "physics problems" },
        { kind: "goal", statement: "understand dot product geometric meaning" },
      ],
      createdAt: "2026-08-24T00:00:00.000Z",
      active: true,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.commitments).toHaveLength(7);
    }
  });

  it("rejects an empty commitments array", () => {
    const result = validateTurnContract({
      contractId: "tc-empty",
      revision: 1,
      learnerId: "learner-1",
      schemaVersion: 1,
      commitments: [],
      createdAt: "2026-08-24T00:00:00.000Z",
      active: true,
    });

    expect(result.ok).toBe(false);
  });

  it("rejects when schemaVersion is wrong", () => {
    const result = validateTurnContract({
      contractId: "tc-bad-version",
      revision: 1,
      learnerId: "learner-1",
      schemaVersion: 999,
      commitments: [
        { kind: "scope_include", concept: "algebra" },
      ],
      createdAt: "2026-08-24T00:00:00.000Z",
      active: true,
    });

    expect(result.ok).toBe(false);
  });

  it("rejects when active is true and revokedAt is set", () => {
    const result = validateTurnContract({
      contractId: "tc-conflict",
      revision: 1,
      learnerId: "learner-1",
      schemaVersion: 1,
      commitments: [
        { kind: "scope_include", concept: "algebra" },
      ],
      createdAt: "2026-08-24T00:00:00.000Z",
      active: true,
      revokedAt: "2026-08-24T01:00:00.000Z",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => /active.*revoked/i.test(e))).toBe(true);
    }
  });

  it("rejects when active is false and revokedAt is missing", () => {
    const result = validateTurnContract({
      contractId: "tc-no-revoked-at",
      revision: 1,
      learnerId: "learner-1",
      schemaVersion: 1,
      commitments: [
        { kind: "scope_include", concept: "algebra" },
      ],
      createdAt: "2026-08-24T00:00:00.000Z",
      active: false,
    });

    expect(result.ok).toBe(false);
  });
});

/* ─────────────────────────────────────────────────────────────
   Deterministic normalization
   ───────────────────────────────────────────────────────────── */

describe("normalizeCommitments", () => {
  it("deduplicates identical scope_include commitments", () => {
    const commitments: Commitment[] = [
      { kind: "scope_include", concept: "Linear Algebra" },
      { kind: "scope_include", concept: "linear algebra" },
      { kind: "scope_include", concept: " LINEAR  ALGEBRA " },
    ];

    const result = normalizeCommitments(commitments);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ kind: "scope_include", concept: "Linear Algebra" });
  });

  it("preserves first-seen ordering", () => {
    const commitments: Commitment[] = [
      { kind: "scope_exclude", concept: "pure theory" },
      { kind: "scope_include", concept: "vectors" },
      { kind: "scope_exclude", concept: "Pure Theory" },
    ];

    const result = normalizeCommitments(commitments);
    expect(result).toHaveLength(2);
    expect(result[0].kind).toBe("scope_exclude");
    expect(result[1].kind).toBe("scope_include");
  });

  it("deduplicates pace commitments with same values", () => {
    const commitments: Commitment[] = [
      { kind: "pace", sessionsPerWeek: 3 },
      { kind: "pace", sessionsPerWeek: 3 },
    ];

    const result = normalizeCommitments(commitments);
    expect(result).toHaveLength(1);
  });

  it("treats different pace values as distinct", () => {
    const commitments: Commitment[] = [
      { kind: "pace", sessionsPerWeek: 3, minutesPerSession: 30 },
      { kind: "pace", sessionsPerWeek: 3, minutesPerSession: 60 },
    ];

    const result = normalizeCommitments(commitments);
    expect(result).toHaveLength(2);
  });

  it("normalizes representation avoid field for deduplication", () => {
    const commitments: Commitment[] = [
      { kind: "representation", prefer: "visual", avoid: "text-heavy" },
      { kind: "representation", prefer: "visual", avoid: " Text-Heavy " },
    ];

    const result = normalizeCommitments(commitments);
    expect(result).toHaveLength(1);
  });

  it("deduplicates goal commitments including deadline", () => {
    const commitments: Commitment[] = [
      { kind: "goal", statement: "pass midterm exam", deadline: "2026-09-15" },
      { kind: "goal", statement: "Pass Midterm Exam", deadline: "2026-09-15" },
    ];

    const result = normalizeCommitments(commitments);
    expect(result).toHaveLength(1);
  });

  it("treats goals with different deadlines as distinct", () => {
    const commitments: Commitment[] = [
      { kind: "goal", statement: "pass midterm exam", deadline: "2026-09-15" },
      { kind: "goal", statement: "pass midterm exam", deadline: "2026-10-01" },
    ];

    const result = normalizeCommitments(commitments);
    expect(result).toHaveLength(2);
  });
});
