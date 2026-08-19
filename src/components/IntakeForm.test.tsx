import { describe, it, expect, vi } from "vitest";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { OnboardingForm } from "../data/tutor";
import { FormCallCard, IntakeFormSheet } from "./IntakeForm";

// Portals are client-only; for static markup the sheet renders where it is.
vi.mock("react-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-dom")>();
  return { ...actual, createPortal: (node: ReactNode) => node };
});
// The portal target argument still evaluates: give it a harmless stand-in.
vi.stubGlobal("document", { body: {} });

const FORM: OnboardingForm = {
  title: "Before we start: limits",
  invitation: "Answer whichever you can — skipping anything is completely fine.",
  questions: [
    { id: "q1", question: "How comfortable are you with limits already?", kind: "free" },
    {
      id: "q2",
      question: "Which part do you expect to trip you up?",
      kind: "choice",
      options: ["The definitions", "The algebra", "The notation"],
    },
    { id: "q3", question: "Is there a deadline pushing this?", kind: "free" },
    { id: "q4", question: "What pace do you want?", kind: "choice", options: ["Slow and thorough", "Fast overview"] },
    { id: "q5", question: "Anything else the tutor should know?", kind: "free" },
  ],
};

const render = (node: ReactNode) => renderToStaticMarkup(createElement(() => node as any));

describe("FormCallCard — the form actions card in the chat", () => {
  it("carries the agent-written title and the open action", () => {
    const html = render(createElement(FormCallCard, { form: FORM, submitted: false, onOpen: () => {} }));
    expect(html).toContain("Before we start: limits");
    expect(html).toContain("5 questions");
    expect(html).toContain("Open form");
  });

  it("never leaks the tool-call name to the learner", () => {
    const card = render(createElement(FormCallCard, { form: FORM, submitted: false, onOpen: () => {} }));
    const sheet = render(
      createElement(IntakeFormSheet, {
        form: FORM,
        open: true,
        draft: {},
        readOnly: false,
        onChange: () => {},
        onSubmit: () => {},
        onClose: () => {},
      })
    );
    expect(card).not.toContain("create_forms");
    expect(card).not.toContain("tool_call");
    expect(sheet).not.toContain("create_forms");
    expect(sheet).not.toContain("tool_call");
  });

  it("flips to a review action once answers are submitted", () => {
    const html = render(createElement(FormCallCard, { form: FORM, submitted: true, onOpen: () => {} }));
    expect(html).toContain("Review answers");
    expect(html).not.toContain("Open form");
  });
});

describe("IntakeFormSheet — the floating portrait form", () => {
  const sheet = (over: Partial<Parameters<typeof IntakeFormSheet>[0]> = {}) =>
    render(
      createElement(IntakeFormSheet, {
        form: FORM,
        open: true,
        draft: {},
        readOnly: false,
        onChange: () => {},
        onSubmit: () => {},
        onClose: () => {},
        ...over,
      })
    );

  it("renders as a dialog longer than it is wide", () => {
    const html = sheet();
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain("min-h-[540px]");
    expect(html).toContain("w-[min(348px,94vw)]");
  });

  it("renders every question with free-text and multiple-choice inputs", () => {
    const html = sheet();
    for (const q of FORM.questions) expect(html).toContain(q.question);
    expect(html).toContain('type="radio"');
    expect(html).toContain("The definitions");
    expect(html).toContain("One short line");
    expect(html).toContain(FORM.invitation!);
  });

  it("invite-only chrome: numbering is present, question ids are not", () => {
    const html = sheet();
    expect(html).not.toContain("q1");
    // Numbering is added by the app; the agent is told not to write it.
    expect(html).toContain(">1<");
    expect(html).toContain(">5<");
  });

  it("read-only review shows the answers and no submit control", () => {
    const html = sheet({ readOnly: true, draft: { q1: "Fairly ok", q2: "The algebra" } });
    expect(html).toContain("Fairly ok");
    expect(html).toContain("The algebra");
    expect(html).not.toContain("Send answers");
    expect(html).toContain("Close");
  });

  it("renders nothing while closed", () => {
    const html = sheet({ open: false });
    expect(html).toBe("");
  });

  it("hides gated questions until their constraint answer matches", () => {
    const gated: OnboardingForm = {
      title: "T",
      invitation: "i",
      questions: [
        { id: "q1", question: "Have you met this before?", kind: "choice", options: ["Brand new", "A little"] },
        { id: "q2", question: "Which part feels shakiest?", kind: "free", onlyIf: { questionId: "q1", anyOf: ["A little"] } },
      ],
    };
    const hidden = sheet({ form: gated, draft: {} });
    expect(hidden).not.toContain("shakiest");
    const stillHidden = sheet({ form: gated, draft: { q1: "Brand new" } });
    expect(stillHidden).not.toContain("shakiest");
    const shown = sheet({ form: gated, draft: { q1: "A little" } });
    expect(shown).toContain("shakiest");
  });
});
