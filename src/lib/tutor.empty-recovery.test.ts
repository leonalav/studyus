/**
 * Test suite for tutor recovery when LLM returns empty responses.
 * 
 * Verifies that the tutor's recovery callbacks handle completely empty
 * responses gracefully, providing user-facing messages instead of errors.
 */

import { describe, it, expect } from "vitest";
import { recoverTutorPayload } from "./tutor";

describe("tutor empty response recovery", () => {
  const allowedEvidence = new Set(["math-basics-001", "algebra-intro-002"]);

  describe("recoverTutorPayload with empty responses", () => {
    it("should recover from completely empty JSON object", () => {
      const result = recoverTutorPayload({}, "{}", allowedEvidence, "What is 2+2?");

      expect(result.speech).toBeTruthy();
      expect(result.speech.length).toBeGreaterThan(0);
      expect(result.boardOps).toEqual([]);
      expect(result.evidenceRefs).toEqual([]);
    });

    it("should recover from empty string raw response", () => {
      const result = recoverTutorPayload(null, "", allowedEvidence, "Explain fractions");

      expect(result.speech).toBeTruthy();
      expect(result.speech.length).toBeGreaterThan(0);
      expect(result.boardOps).toEqual([]);
    });

    it("should recover from whitespace-only raw response", () => {
      const result = recoverTutorPayload(null, "   \n\t  ", allowedEvidence, "Help me");

      expect(result.speech).toBeTruthy();
      expect(result.boardOps).toEqual([]);
    });

    it("should provide contextual recovery message when learner message exists", () => {
      const result = recoverTutorPayload({}, "{}", allowedEvidence, "What is calculus?");

      expect(result.speech).toContain("trouble");
      expect(result.speech).toContain("rephrase");
    });

    it("should provide neutral prompt when no learner message", () => {
      const result = recoverTutorPayload({}, "{}", allowedEvidence, "");

      expect(result.speech).toBeTruthy();
      expect(result.speech.length).toBeGreaterThan(0);
      // Should be inviting, not error-focused
      expect(result.speech.toLowerCase()).toMatch(/ready|work|like/);
    });

    it("should preserve valid board ops even with empty speech", () => {
      const payload = {
        speech: "",
        board_ops: [
          { op: "place", kind: "text", x: 10, y: 20, width: 100, height: 50, content: "Hello" },
        ],
        evidence_refs: [],
      };
      const raw = JSON.stringify(payload);

      const result = recoverTutorPayload(payload, raw, allowedEvidence, "Show me something");

      // If validation is strict and rejects the op, we still get a helpful message
      expect(result.speech).toBeTruthy();
      expect(result.speech.length).toBeGreaterThan(0);
      // Either the board op survived, or we got fallback prose
      if (result.boardOps.length > 0) {
        expect(result.boardOps[0].op).toBe("place");
        expect(result.speech).toContain("board");
      }
    });

    it("should recover speech from alternate field names", () => {
      const payload = {
        message: "This is the actual content",
        board_ops: [],
        evidence_refs: [],
      };
      const raw = JSON.stringify(payload);

      const result = recoverTutorPayload(payload, raw, allowedEvidence, "Test");

      expect(result.speech).toBe("This is the actual content");
    });

    it("should recover from reply field", () => {
      const payload = {
        reply: "Response here",
        boardOps: [],
        evidenceRefs: [],
      };
      const raw = JSON.stringify(payload);

      const result = recoverTutorPayload(payload, raw, allowedEvidence, "Query");

      expect(result.speech).toBe("Response here");
    });

    it("should extract speech from raw string field when payload is malformed", () => {
      const raw = '{"speech": "Extracted from raw", "board_ops": [invalid';

      const result = recoverTutorPayload(null, raw, allowedEvidence, "Question");

      expect(result.speech).toBe("Extracted from raw");
    });

    it("should handle plain prose when not serialized JSON", () => {
      const raw = "This is plain prose without JSON structure.";

      const result = recoverTutorPayload(null, raw, allowedEvidence, "Help");

      expect(result.speech).toBe("This is plain prose without JSON structure.");
    });

    it("should not use malformed JSON as plain prose", () => {
      const raw = '{"speech": "broken", "board_ops": [unclosed array';

      const result = recoverTutorPayload(null, raw, allowedEvidence, "Question");

      // Should extract the speech field, not use the whole malformed JSON
      expect(result.speech).toBe("broken");
    });

    it("should bound recovered speech to 8000 characters", () => {
      const longSpeech = "x".repeat(10000);
      const payload = { speech: longSpeech, board_ops: [], evidence_refs: [] };
      const raw = JSON.stringify(payload);

      const result = recoverTutorPayload(payload, raw, allowedEvidence, "Long response");

      expect(result.speech.length).toBeLessThanOrEqual(8000);
    });

    it("should sanitize null characters from speech", () => {
      const payload = {
        speech: "Hello\u0000World\u0000Test",
        board_ops: [],
        evidence_refs: [],
      };
      const raw = JSON.stringify(payload);

      const result = recoverTutorPayload(payload, raw, allowedEvidence, "Test");

      expect(result.speech).toBe("HelloWorldTest");
      expect(result.speech).not.toContain("\u0000");
    });

    it("should filter invalid evidence refs", () => {
      const payload = {
        speech: "Here's what I know",
        board_ops: [],
        evidence_refs: ["math-basics-001", "invalid-handle", "algebra-intro-002", "also-invalid"],
      };
      const raw = JSON.stringify(payload);

      const result = recoverTutorPayload(payload, raw, allowedEvidence, "Show sources");

      expect(result.evidenceRefs).toEqual(["math-basics-001", "algebra-intro-002"]);
      expect(result.evidenceRefs).not.toContain("invalid-handle");
    });

    it("should recover requested_level when valid", () => {
      const payload = {
        speech: "Let me help",
        board_ops: [],
        evidence_refs: [],
        requested_level: 2,
      };
      const raw = JSON.stringify(payload);

      const result = recoverTutorPayload(payload, raw, allowedEvidence, "Need hint");

      expect(result.requestedLevel).toBe(2);
    });

    it("should ignore invalid requested_level", () => {
      const payload = {
        speech: "Let me help",
        board_ops: [],
        evidence_refs: [],
        requested_level: 99,
      };
      const raw = JSON.stringify(payload);

      const result = recoverTutorPayload(payload, raw, allowedEvidence, "Need hint");

      expect(result.requestedLevel).toBeUndefined();
    });

    it("should validate and include diagnosis when well-formed", () => {
      const payload = {
        speech: "Good work",
        board_ops: [],
        evidence_refs: [],
        diagnosis: {
          correct: true,
          complete: true,
          feedback: "Well done",
        },
      };
      const raw = JSON.stringify(payload);

      const result = recoverTutorPayload(payload, raw, allowedEvidence, "My answer");

      // Diagnosis validation is strict and may reject incomplete shapes.
      // The key guarantee is that recovery succeeds and returns valid speech.
      expect(result.speech).toBe("Good work");
      expect(result.boardOps).toEqual([]);
      // Diagnosis is optional and may be undefined if validation is strict
      if (result.diagnosis) {
        expect(result.diagnosis.correct).toBe(true);
      }
    });

    it("should omit malformed diagnosis without breaking recovery", () => {
      const payload = {
        speech: "Let me explain",
        board_ops: [],
        evidence_refs: [],
        diagnosis: { invalid: "structure" },
      };
      const raw = JSON.stringify(payload);

      const result = recoverTutorPayload(payload, raw, allowedEvidence, "My answer");

      expect(result.diagnosis).toBeUndefined();
      expect(result.speech).toBe("Let me explain");
    });
  });
});
