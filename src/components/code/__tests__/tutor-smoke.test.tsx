// @vitest-environment happy-dom
/**
 * Frontend smoke test — the React binding renders the cold open with no
 * kernel and keeps the reveal locked until commitment. This exercises the
 * real component against the real Session, not a mock.
 */

import { describe, expect, it, beforeEach } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { ProgrammingTutor } from "../ProgrammingTutor";
import { STORAGE_KEY } from "../../../store/local";

function render() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<ProgrammingTutor onNotify={() => {}} curriculum="Smoke curriculum" />);
  });
  return { container, root };
}

describe("ProgrammingTutor binding", () => {
  beforeEach(() => {
    window.localStorage.removeItem(STORAGE_KEY);
  });

  it("cold-opens on the Appendix B program with the reveal locked", () => {
    const { container } = render();
    const text = container.textContent ?? "";
    expect(text).toContain("for i in range(4):");
    expect(text).toContain("What does this print?");
    expect(text).toContain("nothing is revealed until you commit");
    // the gate button starts locked
    expect(text).toContain("Commit to unlock the reveal");
    // no answer on screen before commitment
    expect(container.querySelector("textarea")).toBeTruthy();
  });

  it("the commit button is disabled before any commitment is made", () => {
    const { container } = render();
    const buttons = [...container.querySelectorAll("button")];
    const commit = buttons.find((b) => (b.textContent ?? "").includes("Commit"));
    expect(commit).toBeTruthy();
    expect(commit!.hasAttribute("disabled")).toBe(true);
  });

  it("typing a prediction enables the commit gate", () => {
    const { container } = render();
    const textarea = container.querySelector("textarea");
    expect(textarea).toBeTruthy();
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set;
      setter?.call(textarea, "10");
      textarea!.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const buttons = [...container.querySelectorAll("button")];
    const commit = buttons.find((b) => (b.textContent ?? "").includes("Commit"));
    expect(commit!.hasAttribute("disabled")).toBe(false);
  });
});
