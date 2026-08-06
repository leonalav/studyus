/**
 * §14.2 — voice rules, enforced by test.
 *
 * The voice file must contain none of the forbidden failure/reward
 * vocabulary, and every contradiction line must end with a question.
 */

import { describe, expect, it } from "vitest";
import { VOICE_EN, pickLine } from "../../pack/voice-en";

const FORBIDDEN_SUBSTRINGS = [
  "wrong",
  "incorrect",
  "failed",
  "oops",
  "sorry",
  "unfortunately",
  "great job",
  "well done",
  "keep it up",
  "you're on fire",
  "streak",
  "points",
  "level up",
];

// eslint-disable-next-line no-misleading-character-class
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{2B00}-\u{2BFF}]/u;

function allLines(): { path: string; line: string }[] {
  const out: { path: string; line: string }[] = [];
  const walk = (value: unknown, path: string) => {
    if (typeof value === "string") {
      out.push({ path, line: value });
    } else if (Array.isArray(value)) {
      value.forEach((item, i) => walk(item, `${path}[${i}]`));
    } else if (value && typeof value === "object") {
      for (const [key, nested] of Object.entries(value)) walk(nested, path ? `${path}.${key}` : key);
    }
  };
  walk(VOICE_EN, "");
  return out;
}

function contradictionLines(): { path: string; line: string }[] {
  return allLines().filter(({ path }) => path.startsWith("contradiction"));
}

describe("14.2 the tutor voice", () => {
  it("contains none of the forbidden words (Law 4, Law 6)", () => {
    for (const { path, line } of allLines()) {
      const lower = line.toLowerCase();
      for (const word of FORBIDDEN_SUBSTRINGS) {
        expect(lower, `${path} contains "${word}"`).not.toContain(word);
      }
      expect(/\bxp\b/i.test(line), `${path} contains "XP"`).toBe(false);
      expect(EMOJI.test(line), `${path} contains an emoji`).toBe(false);
    }
  });

  it("every contradiction line ends with a question", () => {
    const lines = contradictionLines();
    expect(lines.length).toBeGreaterThan(0);
    for (const { path, line } of lines) {
      expect(line.trim().endsWith("?"), `${path} must end with "?"`).toBe(true);
    }
  });

  it("five distinct contradiction lines exist for the Predict beat", () => {
    const defaults = VOICE_EN.contradiction.predict.default;
    expect(new Set(defaults).size).toBeGreaterThanOrEqual(5);
  });

  it("line selection is deterministic — same attempt id, same line", () => {
    const lines = VOICE_EN.contradiction.predict.default;
    expect(pickLine(lines, "att-123")).toBe(pickLine(lines, "att-123"));
  });
});
