import { describe, it, expect } from "vitest";
import { generateAxisTicks } from "./Visuals";

describe("Graphing Tick Generation Engine", () => {
  it("generates correct numeric tick labels for positive ranges", () => {
    const ticks = generateAxisTicks(0, 10, 5);
    expect(ticks.length).toBeGreaterThan(2);
    expect(ticks[0]).toBe(0);
    expect(ticks[ticks.length - 1]).toBe(10);
  });

  it("handles negative and asymmetric awkward ranges", () => {
    const ticks = generateAxisTicks(-3.5, 7.2, 5);
    expect(ticks.length).toBeGreaterThan(2);
    expect(ticks[0]).toBeLessThanOrEqual(-3.5);
    expect(ticks[ticks.length - 1]).toBeGreaterThanOrEqual(7.0);
  });

  it("handles very small decimal ranges", () => {
    const ticks = generateAxisTicks(0.001, 0.005, 4);
    expect(ticks.length).toBeGreaterThan(2);
    expect(ticks[0]).toBeLessThanOrEqual(0.001);
  });
});
