// @vitest-environment happy-dom
/**
 * Component-level integration: drives the real React binding through a full
 * commit → reveal → continue cycle against the real Session and store.
 * The core tests prove the pedagogy; this test proves the binding survives
 * contact with it at runtime.
 */

import { describe, expect, it, beforeEach } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { ProgrammingTutor } from "../ProgrammingTutor";
import { STORAGE_KEY } from "../../../store/local";

function mount() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<ProgrammingTutor onNotify={() => {}} />);
  });
  return { container, root };
}

function click(container: HTMLElement, label: string): HTMLButtonElement {
  const buttons = [...container.querySelectorAll("button")];
  const target = buttons.find((b) => (b.textContent ?? "").toLowerCase().includes(label.toLowerCase()));
  if (!target) throw new Error(`no button containing "${label}"`);
  act(() => {
    target.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  return target;
}

function type(container: HTMLElement, selector: string, value: string) {
  const el = container.querySelector(selector) as HTMLTextAreaElement | HTMLInputElement | null;
  if (!el) throw new Error(`no element for ${selector}`);
  act(() => {
    const proto = el instanceof window.HTMLTextAreaElement ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

const text = (container: HTMLElement) => container.textContent ?? "";

describe("ProgrammingTutor — full flow through the real binding", () => {
  beforeEach(() => {
    window.localStorage.removeItem(STORAGE_KEY);
    document.body.innerHTML = "";
  });

  it("cold open → commit a prediction → reveal → explain → continue", () => {
    const { container } = mount();
    expect(text(container)).toContain("for i in range(4):");

    // commit the classic off-by-one prediction
    type(container, "textarea", "10");
    click(container, "Commit");

    // the reveal: the machine's answer, the tutor line, the trace — all post-commit
    const revealed = text(container);
    expect(revealed).toContain("It printed 6");
    expect(revealed).toContain("range stops *before* its argument"); // misconception line
    expect(revealed).toContain("step through the recorded run");
    expect(revealed).toContain("a familiar model, detected");

    // continue → beat 2 arrives immediately (Appendix B)
    click(container, "Continue");
    const explaining = text(container);
    expect(explaining).toContain("one sentence");
    expect(explaining).toContain("what does this program do");

    // commit an explanation; heuristic caveat and exemplar must appear
    type(container, "textarea", "it adds up 0 1 2 3 and prints the total");
    click(container, "Commit");
    const explained = text(container);
    expect(explained).toContain("matching keywords");
    expect(explained).toContain("compare yours to this");

    // continue onward — whatever comes next, it renders without crashing
    click(container, "Continue");
    expect(["reading", "softer", "Commit", "Fill the blanks", "no single right answer"].some((s) =>
      text(container).toLowerCase().includes(s.toLowerCase()),
    )).toBe(true);
  });

  it("the capability map opens from the header and shows skills, signals, and honesty lines", () => {
    const { container } = mount();
    // commit once so the header offers the map from a prompting view
    type(container, "textarea", "6");
    click(container, "Commit");
    click(container, "Continue");

    click(container, "capability map");
    const map = text(container);
    expect(map).toContain("What you can now do");
    expect(map).toContain("Accumulating over a range");
    expect(map).toContain("first question answered");
    expect(map).toContain("precomputed");
    expect(map).toContain("no gate, by design");
    // export/reset affordances exist; data stays local
    expect(map).toContain("export my data");
    expect(map).toContain("everything stays on this device");

    // close the map back into the session
    click(container, "back");
    expect(["Commit", "no single right answer", "softer"].some((s) => text(container).includes(s))).toBe(true);
  });

  it("state survives a remount — the store, not the component, owns progress", () => {
    const first = mount();
    type(first.container, "textarea", "6");
    click(first.container, "Commit");
    act(() => first.root.unmount());

    // a brand-new mount resumes from the persisted store — no cold open again;
    // the beat chip in the header marks a selected (non-cold-open) exercise
    const second = mount();
    const resumed = text(second.container);
    expect(resumed).toContain("beat ·");
    expect(["one sentence", "Commit", "reading"].some((s) => resumed.includes(s))).toBe(true);
  });

  it("requesting a softer shape on predict surfaces choices without revealing", () => {
    const { container } = mount();
    click(container, "softer");
    const softened = text(container);
    // choices appear as commitment options; the reveal column stays locked
    expect(container.querySelectorAll("button").length).toBeGreaterThan(4);
    expect(softened).toContain("nothing is revealed until you commit");
  });
});
