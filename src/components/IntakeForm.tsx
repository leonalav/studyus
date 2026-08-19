import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Check, CheckCheck, ClipboardCheck, ClipboardList, X } from "lucide-react";
import {
  CREATE_FORMS_TOOL,
  type OnboardingForm,
  type OnboardingQuestion,
} from "../data/tutor";

/** Stable answer map for one form: question id → the free-text line or the
 *  chosen option's label. Empty / missing entries are skipped questions. */
export type IntakeDraft = Record<string, string>;

/* ────────────────────────── create_forms card ────────────────────────── */

/**
 * The tool-call pill the counsellor leaves in the chat when it runs
 * `create_forms`: a compact actions card that names the tool, carries the
 * agent-written title, and opens the form. The agent's own notification text
 * is a separate chat message — this card never invents prose for it.
 */
export function FormCallCard({
  form,
  submitted,
  onOpen,
}: {
  form: OnboardingForm;
  submitted: boolean;
  onOpen: () => void;
}) {
  return (
    <div
      data-tool-call={CREATE_FORMS_TOOL}
      className="anim-msg flex items-center gap-3 rounded-lg border border-white/10 bg-raise/70 px-3 py-2.5"
    >
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-accent/15 text-accent">
        {submitted ? <ClipboardCheck size={15} /> : <ClipboardList size={15} />}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="font-mono text-[9.5px] uppercase tracking-[0.14em] text-dim">
            {CREATE_FORMS_TOOL}
          </span>
          <span className="rounded-full bg-white/[0.07] px-1.5 py-px font-mono text-[9px] text-mut">
            {form.questions.length} questions
          </span>
        </div>
        <div className="truncate text-[12.5px] font-medium text-fg">
          {form.title ?? "Intake form"}
        </div>
      </div>
      <button
        onClick={onOpen}
        className={`shrink-0 rounded-md px-2.5 py-1.5 text-[11.5px] font-medium transition-colors ${
          submitted
            ? "border border-white/10 bg-white/[0.05] text-mut hover:bg-white/[0.1] hover:text-fg"
            : "bg-accent text-white hover:bg-accent-deep"
        }`}
      >
        {submitted ? "Review answers" : "Open form"}
      </button>
    </div>
  );
}

/* ─────────────────────────── the form sheet ─────────────────────────── */

/**
 * The `create_forms` artifact when opened: a floating portrait sheet (longer
 * than it is wide) suspended over a dimmed backdrop. Free questions take a
 * line of the learner's own words; choice questions take one option. Anything
 * left empty is a skipped question, surfaced to the tutor as "not given".
 *
 * The title and invitation are the agent's own words from its tool call; the
 * app renders them verbatim and adds only chrome (numbering, buttons).
 */
export function IntakeFormSheet({
  form,
  open,
  draft,
  readOnly,
  onChange,
  onSubmit,
  onClose,
}: {
  form: OnboardingForm;
  open: boolean;
  draft: IntakeDraft;
  /** After submission the sheet re-opens read-only for review. */
  readOnly: boolean;
  onChange: (questionId: string, value: string) => void;
  onSubmit: () => void;
  onClose: () => void;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Freshly opened editable sheets start at the top; Escape always closes.
  useEffect(() => {
    if (!open) return;
    scrollRef.current?.scrollTo({ top: 0 });
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const total = form.questions.length;
  const answered = form.questions.filter((q) => (draft[q.id] ?? "").trim()).length;

  return createPortal(
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onMouseDown={(event) => {
        // Click-through dismissal lands back on the chat card with the draft
        // intact; only the explicit controls submit or close from within.
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={form.title ?? "Intake form"}
        className="anim-msg flex min-h-[540px] w-[min(348px,94vw)] max-h-[86vh] flex-col overflow-hidden rounded-2xl border border-white/10 bg-panel shadow-[0_30px_80px_rgba(0,0,0,0.6)]"
      >
        {/* header */}
        <div className="border-b border-white/8 px-4 pb-3 pt-3.5">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <ClipboardList size={12} className="shrink-0 text-accent" />
                <span className="font-mono text-[9.5px] uppercase tracking-[0.14em] text-dim">
                  {CREATE_FORMS_TOOL}
                </span>
                <span className="rounded-full bg-white/[0.07] px-1.5 py-px font-mono text-[9px] text-mut">
                  {answered}/{total}
                </span>
              </div>
              <h2 className="mt-1 text-[15.5px] font-medium leading-snug text-fg">
                {form.title ?? "Intake form"}
              </h2>
            </div>
            <button
              onClick={onClose}
              aria-label="Close form"
              className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-dim transition-colors hover:bg-white/[0.07] hover:text-fg"
            >
              <X size={13} />
            </button>
          </div>
          {form.invitation && (
            <p className="mt-1.5 text-[11.5px] leading-relaxed text-mut">{form.invitation}</p>
          )}
        </div>

        {/* questions */}
        <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
          {form.questions.map((q, index) => (
            <QuestionBlock
              key={q.id}
              index={index}
              question={q}
              value={draft[q.id] ?? ""}
              readOnly={readOnly}
              onChange={(value) => onChange(q.id, value)}
            />
          ))}
        </div>

        {/* footer */}
        <div className="flex items-center justify-between gap-2 border-t border-white/8 px-4 py-3">
          {readOnly ? (
            <button
              onClick={onClose}
              className="w-full rounded-md border border-white/10 bg-white/[0.05] py-1.5 text-[12px] text-mut transition-colors hover:bg-white/[0.1] hover:text-fg"
            >
              Close
            </button>
          ) : (
            <>
              <button
                onClick={onClose}
                className="rounded-md px-2.5 py-1.5 text-[12px] text-dim transition-colors hover:text-fg"
              >
                Not now
              </button>
              <button
                onClick={onSubmit}
                className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-[12px] font-medium text-white transition-colors hover:bg-accent-deep"
              >
                <CheckCheck size={12} />
                {answered > 0 ? "Send answers" : "Skip all"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}

function QuestionBlock({
  index,
  question,
  value,
  readOnly,
  onChange,
}: {
  index: number;
  question: OnboardingQuestion;
  value: string;
  readOnly: boolean;
  onChange: (value: string) => void;
}) {
  const options = question.kind === "choice" ? question.options ?? [] : [];
  return (
    <fieldset className="rounded-lg border border-white/8 bg-black/20 px-3 py-2.5">
      <legend className="sr-only">Question {index + 1}</legend>
      <div className="mb-1.5 flex items-start gap-2">
        <span className="mt-0.5 grid h-4.5 w-4.5 shrink-0 place-items-center rounded-full bg-white/[0.07] font-mono text-[9.5px] text-mut">
          {index + 1}
        </span>
        <p className="text-[12.5px] leading-snug text-fg">{question.question}</p>
      </div>

      {options.length > 0 ? (
        <div className="mt-1 space-y-1 pl-6.5">
          {options.map((option) => {
            const selected = value === option;
            return (
              <label
                key={option}
                className={`flex cursor-pointer items-center gap-2 rounded-md border px-2 py-1.5 text-[12px] transition-colors ${
                  selected
                    ? "border-accent/50 bg-accent/[0.12] text-fg"
                    : "border-white/8 bg-transparent text-mut hover:border-white/20 hover:text-fg"
                } ${readOnly ? "pointer-events-none opacity-80" : ""}`}
              >
                <input
                  type="radio"
                  name={`intake-${question.id}`}
                  checked={selected}
                  disabled={readOnly}
                  onChange={() => onChange(option)}
                  className="sr-only"
                />
                <span
                  aria-hidden
                  className={`grid h-3.5 w-3.5 shrink-0 place-items-center rounded-full border ${
                    selected ? "border-accent bg-accent text-white" : "border-white/25"
                  }`}
                >
                  {selected && <Check size={9} strokeWidth={3} />}
                </span>
                {option}
              </label>
            );
          })}
        </div>
      ) : (
        <input
          value={value}
          readOnly={readOnly}
          onChange={(event) => onChange(event.target.value)}
          placeholder={readOnly ? "" : "One short line…"}
          aria-label={`Answer ${index + 1}`}
          className="mt-1 ml-6.5 w-[calc(100%-26px)] rounded-md border border-white/10 bg-black/25 px-2 py-1.5 text-[12px] text-fg outline-none transition-colors placeholder:text-faint focus:border-accent/50"
        />
      )}
    </fieldset>
  );
}
