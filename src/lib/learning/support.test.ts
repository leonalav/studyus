import { describe, it, expect } from "vitest";
import {
  decideSupport,
  formatRoutingTable,
  MIN_ATTEMPT_CHARS,
  readAttemptSignal,
  RESPONSE_ROUTING_TABLE,
} from "./support";

/**
 * The help-seeking ladder exists because the failure it prevents is invisible.
 * A tutor that answers whoever asks loudest produces a transcript full of
 * correct mathematics and a learner who cannot do any of it — and nothing in
 * the transcript looks wrong.
 *
 * So the tests here are adversarial: they are written from the position of a
 * learner trying, quite reasonably, to get the answer without doing the work.
 */

describe("readAttemptSignal — what counts as an attempt", () => {
  it("treats an empty or throwaway message as no attempt", () => {
    for (const message of ["", "   ", "idk", "?", "no"]) {
      expect(readAttemptSignal(message).madeAttempt).toBe(false);
    }
  });

  it("does not count a long complaint as work", () => {
    // Length is not effort. "I really don't understand any of this at all" is a
    // report about a feeling, not an attempt at the task.
    const signal = readAttemptSignal("I really don't get this, I'm so confused, I don't understand any of it");
    expect(signal.madeAttempt).toBe(false);
    expect(signal.requestedHelp).toBe(true);
  });

  it("counts substantive work as an attempt even when it is wrong", () => {
    const signal = readAttemptSignal("I think the derivative of x^2 is 2x^3 because you multiply by the power");
    expect(signal.madeAttempt).toBe(true);
  });

  it("counts work that ends in a question as an attempt", () => {
    // Attempting and then asking is the behaviour we want to reward, not punish.
    // Judging by message length would misread this as a bare help request,
    // because good work plus a pointed question is short while a fluent
    // complaint is long.
    const signal = readAttemptSignal(
      "I set up (f(x+h)-f(x))/h and expanded to (2xh+h^2)/h, but now do I cancel the h or not?"
    );
    expect(signal.madeAttempt).toBe(true);
    // A specific question about your own working is not a report of being
    // blocked, so it does not climb the ladder on its own.
    expect(signal.requestedHelp).toBe(false);
  });

  it("separates a worked attempt that IS blocked from one that is merely asking", () => {
    const blocked = readAttemptSignal("I tried factoring out h and got 2x + h, but I'm stuck on the limit");
    expect(blocked.madeAttempt).toBe(true);
    expect(blocked.requestedHelp).toBe(true);
  });

  it("flags an outright request for the answer", () => {
    const signal = readAttemptSignal("just tell me the answer");
    expect(signal.requestedAnswer).toBe(true);
    expect(signal.madeAttempt).toBe(false);
  });

  it("uses a real minimum length rather than accepting any keystroke", () => {
    expect(MIN_ATTEMPT_CHARS).toBeGreaterThan(1);
    expect(readAttemptSignal("x".repeat(MIN_ATTEMPT_CHARS - 1)).madeAttempt).toBe(false);
  });
});

describe("decideSupport — the ladder", () => {
  const attempted = readAttemptSignal("I tried factoring out h and got (2x + h), then I got stuck on what happens next");
  const notAttempted = readAttemptSignal("just give me the answer");

  it("grants nothing when there was no attempt, however the request is phrased", () => {
    const decision = decideSupport(notAttempted, 3);
    expect(decision.granted).toBe(0);
    // Even with the ceiling wide open: asking harder must not unlock more.
    expect(decision.ladderLevel).toBe(0);
  });

  it("climbs exactly one rung at a time rather than jumping to a worked step", () => {
    const first = decideSupport({ ...attempted, requestedHelp: true, supportAlreadyUsed: 0 }, 3);
    expect(first.granted).toBe(1);
    const second = decideSupport({ ...attempted, requestedHelp: true, supportAlreadyUsed: 1 }, 3);
    expect(second.granted).toBe(2);
    const third = decideSupport({ ...attempted, requestedHelp: true, supportAlreadyUsed: 2 }, 3);
    expect(third.granted).toBe(3);
  });

  it("never exceeds level 3 no matter how much support was already used", () => {
    const decision = decideSupport({ ...attempted, requestedHelp: true, supportAlreadyUsed: 3 }, 3);
    expect(decision.granted).toBe(3);
  });

  it("lets the policy ceiling override the ladder, never the reverse", () => {
    // This is the line that makes the ladder subordinate to the evidence the
    // current move has to produce.
    const capped = decideSupport({ ...attempted, requestedHelp: true, supportAlreadyUsed: 2 }, 0);
    expect(capped.granted).toBe(0);
    expect(capped.ladderLevel).toBe(3);
    expect(capped.ceilingBinding).toBe(true);
  });

  it("requires the tutor to name a deliberate withholding rather than feign emptiness", () => {
    const capped = decideSupport({ ...attempted, requestedHelp: true, supportAlreadyUsed: 2 }, 0);
    expect(capped.instruction).toMatch(/holding back deliberately/);
  });

  it("obliges a reconstruction exactly when support becomes substantive", () => {
    expect(decideSupport({ ...attempted, requestedHelp: true, supportAlreadyUsed: 0 }, 3).requiresReconstruction).toBe(false);
    expect(decideSupport({ ...attempted, requestedHelp: true, supportAlreadyUsed: 1 }, 3).requiresReconstruction).toBe(true);
    expect(decideSupport({ ...attempted, requestedHelp: true, supportAlreadyUsed: 2 }, 3).requiresReconstruction).toBe(true);
  });

  it("tells the tutor to shrink the task, not do it, when the answer is demanded cold", () => {
    const decision = decideSupport(notAttempted, 3);
    expect(decision.instruction).toMatch(/Reducing the task is allowed; doing the task is not/);
  });

  it("asks where the learner is stuck before hinting at an unattempted task", () => {
    const stuckNoAttempt = readAttemptSignal("i'm stuck");
    const decision = decideSupport(stuckNoAttempt, 3);
    expect(decision.granted).toBe(0);
    // Helping past the wrong obstacle teaches that saying 'stuck' yields answers.
    expect(decision.instruction).toMatch(/WHERE they are stuck/);
  });

  it("acknowledges an answer request even while refusing it", () => {
    const decision = decideSupport({ ...attempted, requestedAnswer: true, requestedHelp: true }, 1);
    expect(decision.instruction).toMatch(/A refusal that ignores the request reads as evasion/);
  });
});

describe("RESPONSE_ROUTING_TABLE — resolving ask-vs-tell", () => {
  it("puts direct answers to factual questions ahead of the attempt requirement", () => {
    // The old prompt held both 'require an attempt first' and 'default to
    // direct help' with no way to tell which applied. Order resolves it.
    const factual = RESPONSE_ROUTING_TABLE.findIndex((row) => /factual question/i.test(row.condition));
    const blocked = RESPONSE_ROUTING_TABLE.findIndex((row) => /blocked mid-task/i.test(row.condition));
    expect(factual).toBeGreaterThanOrEqual(0);
    expect(factual).toBeLessThan(blocked);
  });

  it("honours an explicit visualization request rather than withholding it", () => {
    const row = RESPONSE_ROUTING_TABLE.find((entry) => /visualize/i.test(entry.condition));
    expect(row?.action).toMatch(/Render it first/);
  });

  it("ends with an unconditional fallback so no input is unrouted", () => {
    const last = RESPONSE_ROUTING_TABLE[RESPONSE_ROUTING_TABLE.length - 1];
    expect(last.condition).toMatch(/None of the above/);
    expect(last.action).toMatch(/planned instructional move/);
  });

  it("keeps a ceiling of 0 unhelpable regardless of the ask", () => {
    const row = RESPONSE_ROUTING_TABLE.find((entry) => /ceiling is 0/i.test(entry.condition));
    expect(row?.action).toMatch(/Hold the ceiling/);
    expect(row?.reason).toMatch(/helping deletes the measurement/);
  });
});

describe("formatRoutingTable", () => {
  it("renders every row, numbered, with first-match-wins stated up front", () => {
    const rendered = formatRoutingTable();
    expect(rendered).toMatch(/apply the FIRST row that matches/);
    for (let index = 0; index < RESPONSE_ROUTING_TABLE.length; index += 1) {
      expect(rendered).toContain(`${index + 1}. IF `);
    }
  });

  it("states that it supersedes general ask-or-tell guidance", () => {
    // Without this the table becomes one more competing instruction.
    expect(formatRoutingTable()).toMatch(/replaces any general instruction about whether to ask or tell/);
  });
});
