import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, Check, CheckCheck, Plus, ScrollText, X } from "lucide-react";
import {
  COMMITMENT_KINDS,
  type Commitment,
  type TurnContract,
} from "../lib/contracts/types";
import {
  commitmentKindLabel,
} from "../lib/contracts/format";
import { validateTurnContract } from "../lib/contracts/validate";
import type { ExtractionOutcome } from "../lib/contracts/extract";

/**
 * The commitment review sheet.
 *
 * After the onboarding intake is submitted, a `generation`-role call proposes
 * typed learner commitments. Those are *proposals* — the learner sees them
 * here, edits the wording, removes anything the model misread, adds one the
 * model missed, and approves. Only the approved draft is persisted and
 * activated. Empty extraction is a first-class "no commitments" path, not a
 * failure: the learner can approve an empty sheet and Studyus tutors them on
 * the concept directly.
 *
 * The contract carries no authority over engine-owned support, evidence,
 * mastery, or advancement — that boundary is stated in `buildContractReminder`
 * for the tutor prompt, not here, but the sheet's framing mirrors it: these
 * are the learner's own choices about scope, representation, pace, notation,
 * examples, and goals.
 *
 * Modeled on `IntakeForm.tsx`: portal to `document.body`, grid
 * header/scroll/footer with the scrollport pinned in the middle row. Unlike
 * the intake, the review is a decision gate — Escape and backdrop clicks do
 * not close it, because closing would strand the learner between intake and
 * chalkboard with no contract decision recorded.
 */
export function ContractReview({
  open,
  outcome,
  contractSeed,
  onApproved,
  onClose: _onClose,
}: {
  open: boolean;
  /** The extraction outcome to review. `null` while extraction is in flight. */
  outcome: ExtractionOutcome | null;
  /** The proposed contract from a `proposed` outcome, used as the seed for the
   *  edited draft so the learner keeps the deterministic contractId/createdAt
   *  identity. Undefined for empty/failed outcomes. */
  contractSeed?: TurnContract;
  onApproved: (contract: TurnContract | null) => void;
  /** Reserved for callers that want a dismissible policy. The default gate
   *  ignores it (see the comment above the early return). */
  onClose: () => void;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const wasOpenRef = useRef(false);

  useEffect(() => {
    if (open && !wasOpenRef.current) {
      scrollRef.current?.scrollTo({ top: 0 });
    }
    wasOpenRef.current = open;
  }, [open]);

  // The review sheet is a decision gate, not a dismissible popover: the only
  // exits are Approve (or "Continue without" on a failed extraction). Escape
  // and backdrop clicks do nothing so the learner cannot strand themselves
  // between the intake and the chalkboard with no contract decision recorded.
  // `onClose` is kept on the props for callers that want a different policy,
  // but the default gate ignores it.

  // Draft commitments live only in the sheet until approve. Seeded from the
  // proposed contract when one exists; an empty/failed outcome starts empty.
  const seedCommitments = useMemo<Commitment[]>(
    () => (contractSeed ? contractSeed.commitments : []),
    [contractSeed],
  );
  const [draft, setDraft] = useState<Commitment[]>(seedCommitments);
  const [addErrorOpen, setAddErrorOpen] = useState(false);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);

  // Re-seed when a new extraction outcome arrives (e.g. retry after a failed
  // call). Keeps the sheet honest if the parent re-opens it with a fresh
  // proposal without unmounting.
  useEffect(() => {
    if (open) setDraft(seedCommitments);
  }, [open, seedCommitments]);

  if (!open || !outcome) return null;

  const kind = outcome.kind;
  const failed = kind === "failed";
  const warnings = kind === "proposed" ? outcome.extractionWarnings ?? [] : [];

  function updateCommitment(index: number, next: Commitment) {
    setDraft((current) => current.map((c, i) => (i === index ? next : c)));
  }
  function removeCommitment(index: number) {
    setDraft((current) => current.filter((_, i) => i !== index));
  }
  function addCommitment(commitment: Commitment) {
    setDraft((current) => [...current, commitment]);
  }

  function handleApprove() {
    // Empty drafts are an intentional approve: persist an active revision with
    // no commitments rather than fabricating one. validateTurnContract rejects
    // empty arrays (correct for a *stored active* contract read from disk),
    // but the review step must allow the empty path and persist directly.
    if (draft.length === 0) {
      setValidationErrors([]);
      onApproved(contractSeed ? { ...contractSeed, commitments: [] } : null);
      return;
    }

    if (!contractSeed) {
      // We only reach here with commitments but no seed on a `failed` outcome
      // where the learner added rows despite the failure — treat as a fresh
      // contract built from the draft. Identity/revision are still assigned
      // deterministically here, not by the model.
      const synthetic: TurnContract = {
        contractId: `tc_${Date.now().toString(36)}`,
        revision: 1,
        learnerId: "",
        schemaVersion: 1,
        commitments: draft,
        createdAt: new Date().toISOString(),
        active: true,
        source: "learner_edit",
      };
      const validated = validateTurnContract(synthetic);
      if (!validated.ok) {
        setValidationErrors(validated.errors);
        return;
      }
      setValidationErrors([]);
      onApproved(validated.value);
      return;
    }

    // Re-validate the edited draft against the seed's identity. This catches
    // a learner who edits a string into an engine-owned field (rejected by
    // validateTurnContract's ENGINE_OWNED_PATTERNS) or empties a required field.
    const candidate: TurnContract = {
      ...contractSeed,
      commitments: draft,
    };
    const validated = validateTurnContract(candidate);
    if (!validated.ok) {
      setValidationErrors(validated.errors);
      return;
    }
    setValidationErrors([]);
    onApproved(validated.value);
  }

  function handleContinueWithoutContract() {
    setValidationErrors([]);
    onApproved(null);
  }

  const total = draft.length;

  return createPortal(
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      // No click-through dismissal: the review is a decision gate (see header
      // comment). Approve or "Continue without" are the only exits.
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Review your study commitments"
        className="anim-msg relative grid h-fit max-h-[calc(100dvh-2rem)] min-h-0 w-full min-w-0 max-w-[372px] grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden rounded-2xl border border-white/10 bg-panel shadow-[0_30px_80px_rgba(0,0,0,0.6)]"
      >
        {/* header */}
        <div className="border-b border-white/8 px-4 pb-3 pt-3.5">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <ScrollText size={12} className="shrink-0 text-accent" />
                <span className="rounded-full bg-white/[0.07] px-1.5 py-px font-mono text-[9px] text-mut">
                  {total} {total === 1 ? "commitment" : "commitments"}
                </span>
              </div>
              <h2 className="mt-1 break-words text-[15.5px] font-medium leading-snug text-fg">
                Your study commitments
              </h2>
            </div>
            <button
              onClick={_onClose}
              aria-label="Close review"
              className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-dim transition-colors hover:bg-white/[0.07] hover:text-fg"
            >
              <X size={13} />
            </button>
          </div>
          <p className="mt-1.5 text-[11.5px] leading-relaxed text-mut">
            Studyus extracted these from your answers. They are your choices —
            what to cover, how to show it, your pace and notation. Edit,
            remove, or add one, then approve. They never override Studyus's
            own support, evidence, or mastery decisions.
          </p>
        </div>

        {/* body */}
        <div ref={scrollRef} className="min-h-0 space-y-2.5 overflow-y-auto overscroll-contain px-4 py-3">
          {warnings.length > 0 && (
            <div className="rounded-lg border border-warn/30 bg-warn/[0.08] px-3 py-2.5 text-[11.5px] leading-relaxed text-fg">
              <div className="mb-1 flex items-center gap-1.5 font-medium">
                <AlertTriangle size={12} /> Some proposed commitments were dropped
              </div>
              <p className="text-mut">
                Studyus kept the valid ones below and discarded the rest. You can
                add the missing preference back if it still matters to you.
              </p>
              <ul className="mt-1 list-disc space-y-0.5 pl-4 text-mut">
                {warnings.map((err, i) => (
                  <li key={i}>{err}</li>
                ))}
              </ul>
            </div>
          )}

          {failed && (
            <div className="rounded-lg border border-warn/30 bg-warn/[0.08] px-3 py-2.5 text-[11.5px] leading-relaxed text-fg">
              <div className="mb-1 flex items-center gap-1.5 font-medium">
                <AlertTriangle size={12} /> Couldn't read your commitments
              </div>
              <ul className="list-disc space-y-0.5 pl-4 text-mut">
                {outcome.errors.map((err, i) => (
                  <li key={i}>{err}</li>
                ))}
              </ul>
              <p className="mt-1.5 text-mut">
                You can start without a contract — Studyus will tutor you
                directly on the concept.
              </p>
            </div>
          )}

          {draft.length === 0 && !failed && (
            <div className="rounded-lg border border-white/8 bg-black/20 px-3 py-3 text-[12px] leading-relaxed text-mut">
              No commitments extracted from your answers. Studyus will tutor
              you on the concept directly. Add one below if you want a
              preference enforced, or approve as-is.
            </div>
          )}

          {draft.map((commitment, index) => (
            <CommitmentRow
              key={index}
              index={index}
              commitment={commitment}
              onChange={(next) => updateCommitment(index, next)}
              onRemove={() => removeCommitment(index)}
            />
          ))}

          {validationErrors.length > 0 && (
            <div className="rounded-lg border border-warn/30 bg-warn/[0.08] px-3 py-2.5 text-[11.5px] leading-relaxed text-fg">
              <div className="mb-1 flex items-center gap-1.5 font-medium">
                <AlertTriangle size={12} /> Fix before approving
              </div>
              <ul className="list-disc space-y-0.5 pl-4 text-mut">
                {validationErrors.map((err, i) => (
                  <li key={i}>{err}</li>
                ))}
              </ul>
            </div>
          )}

          {!failed && (
            <AddCommitment onAdd={addCommitment} open={addErrorOpen} setOpen={setAddErrorOpen} />
          )}
        </div>

        {/* footer */}
        <div className="flex items-center justify-end gap-2 border-t border-white/8 bg-panel px-4 py-3">
          <div className="flex items-center gap-2">
            {failed && (
              <button
                onClick={handleContinueWithoutContract}
                className="rounded-md px-2.5 py-1.5 text-[12px] text-mut transition-colors hover:bg-white/[0.05] hover:text-fg"
              >
                Continue without
              </button>
            )}
            <button
              onClick={handleApprove}
              className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-[12px] font-medium text-white transition-colors hover:bg-accent-deep"
            >
              <CheckCheck size={12} />
              {total > 0 ? "Approve" : "Approve as-is"}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

/* ──────────────────────────── rows ──────────────────────────── */

function CommitmentRow({
  index,
  commitment,
  onChange,
  onRemove,
}: {
  index: number;
  commitment: Commitment;
  onChange: (next: Commitment) => void;
  onRemove: () => void;
}) {
  const label = commitmentKindLabel(commitment.kind);
  return (
    <fieldset className="rounded-lg border border-white/8 bg-black/20 px-3 py-2.5">
      <legend className="sr-only">{label} commitment {index + 1}</legend>
      <div className="mb-1.5 flex items-start justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <span className="mt-0.5 grid h-4.5 w-4.5 shrink-0 place-items-center rounded-full bg-white/[0.07] font-mono text-[9.5px] text-mut">
            {index + 1}
          </span>
          <span className="rounded-full bg-accent/15 px-1.5 py-px text-[10px] font-medium text-accent">
            {label}
          </span>
        </div>
        <button
          onClick={onRemove}
          aria-label={`Remove ${label} commitment`}
          className="grid h-5 w-5 shrink-0 place-items-center rounded-md text-dim transition-colors hover:bg-white/[0.07] hover:text-fg"
        >
          <X size={11} />
        </button>
      </div>

      <CommitmentFields commitment={commitment} onChange={onChange} />
    </fieldset>
  );
}

function CommitmentFields({
  commitment,
  onChange,
}: {
  commitment: Commitment;
  onChange: (next: Commitment) => void;
}) {
  switch (commitment.kind) {
    case "scope_include":
    case "scope_exclude":
      return (
        <TextInput
          value={commitment.concept}
          placeholder="Concept to include or exclude…"
          ariaLabel={`${commitmentKindLabel(commitment.kind)} concept`}
          onChange={(concept) => onChange({ ...commitment, concept })}
        />
      );
    case "representation":
      return (
        <div className="space-y-1.5">
          <TextInput
            value={commitment.prefer}
            placeholder="Prefer this representation…"
            ariaLabel="Preferred representation"
            onChange={(prefer) => onChange({ ...commitment, prefer })}
          />
          <TextInput
            value={commitment.avoid ?? ""}
            placeholder="Avoid this representation (optional)…"
            ariaLabel="Representation to avoid"
            onChange={(avoid) =>
              onChange({ ...commitment, avoid: avoid.trim() ? avoid : undefined })
            }
          />
        </div>
      );
    case "pace": {
      return (
        <div className="space-y-1.5 pl-6.5">
          <NumberInput
            value={commitment.sessionsPerWeek}
            placeholder="Sessions per week"
            ariaLabel="Sessions per week"
            onChange={(value) =>
              onChange({
                ...commitment,
                sessionsPerWeek: value.trim() ? Number(value) : undefined,
              })
            }
          />
          <NumberInput
            value={commitment.minutesPerSession}
            placeholder="Minutes per session"
            ariaLabel="Minutes per session"
            onChange={(value) =>
              onChange({
                ...commitment,
                minutesPerSession: value.trim() ? Number(value) : undefined,
              })
            }
          />
        </div>
      );
    }
    case "notation":
      return (
        <TextInput
          value={commitment.rule}
          placeholder="Notation rule, e.g. 'use radians, not degrees'…"
          ariaLabel="Notation rule"
          onChange={(rule) => onChange({ ...commitment, rule })}
        />
      );
    case "example_domain":
      return (
        <TextInput
          value={commitment.domain}
          placeholder="Examples domain, e.g. 'physics'…"
          ariaLabel="Example domain"
          onChange={(domain) => onChange({ ...commitment, domain })}
        />
      );
    case "goal":
      return (
        <div className="space-y-1.5">
          <TextInput
            value={commitment.statement}
            placeholder="Goal statement…"
            ariaLabel="Goal statement"
            onChange={(statement) => onChange({ ...commitment, statement })}
          />
          <TextInput
            value={commitment.deadline ?? ""}
            placeholder="Deadline (optional)…"
            ariaLabel="Goal deadline"
            onChange={(deadline) =>
              onChange({ ...commitment, deadline: deadline.trim() ? deadline : undefined })
            }
          />
        </div>
      );
  }
}

/* ──────────────────────────── add ──────────────────────────── */

function AddCommitment({
  onAdd,
  open,
  setOpen,
}: {
  onAdd: (commitment: Commitment) => void;
  open: boolean;
  setOpen: (next: boolean) => void;
}) {
  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-white/15 px-3 py-2 text-[12px] text-mut transition-colors hover:border-white/25 hover:text-fg"
      >
        <Plus size={12} /> Add a commitment
      </button>
    );
  }

  return (
    <AddCommitmentPanel
      onAdd={(c) => {
        onAdd(c);
        setOpen(false);
      }}
      onCancel={() => setOpen(false)}
    />
  );
}

function AddCommitmentPanel({
  onAdd,
  onCancel,
}: {
  onAdd: (commitment: Commitment) => void;
  onCancel: () => void;
}) {
  const [kind, setKind] = useState<Commitment["kind"]>("scope_include");
  const [text, setText] = useState("");
  const [avoid, setAvoid] = useState("");
  const [sessionsPerWeek, setSessionsPerWeek] = useState("");
  const [minutesPerSession, setMinutesPerSession] = useState("");
  const [deadline, setDeadline] = useState("");

  function build(): Commitment | null {
    const t = text.trim();
    switch (kind) {
      case "scope_include":
      case "scope_exclude":
        return t ? { kind, concept: t } : null;
      case "representation": {
        if (!t) return null;
        const a = avoid.trim();
        return a ? { kind, prefer: t, avoid: a } : { kind, prefer: t };
      }
      case "pace": {
        const sp = sessionsPerWeek.trim();
        const mp = minutesPerSession.trim();
        const c: Commitment = { kind };
        if (sp) c.sessionsPerWeek = Number(sp);
        if (mp) c.minutesPerSession = Number(mp);
        return c.sessionsPerWeek !== undefined || c.minutesPerSession !== undefined
          ? c
          : null;
      }
      case "notation":
        return t ? { kind, rule: t } : null;
      case "example_domain":
        return t ? { kind, domain: t } : null;
      case "goal": {
        if (!t) return null;
        const d = deadline.trim();
        return d ? { kind, statement: t, deadline: d } : { kind, statement: t };
      }
    }
  }

  function commit() {
    const c = build();
    if (c) onAdd(c);
  }

  const needsText = kind !== "pace";
  const placeholderByKind: Record<Commitment["kind"], string> = {
    scope_include: "Concept to include…",
    scope_exclude: "Concept to exclude…",
    representation: "Preferred representation…",
    pace: "",
    notation: "Notation rule…",
    example_domain: "Examples domain…",
    goal: "Goal statement…",
  };

  return (
    <div className="rounded-lg border border-accent/30 bg-accent/[0.06] px-3 py-2.5">
      <div className="mb-1.5 flex items-center gap-1.5">
        <Plus size={12} className="text-accent" />
        <span className="text-[11px] font-medium text-fg">New commitment</span>
      </div>
      <div className="space-y-1.5">
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value as Commitment["kind"])}
          aria-label="Commitment kind"
          className="w-full rounded-md border border-white/10 bg-black/25 px-2 py-1.5 text-[12px] text-fg outline-none focus:border-accent/50"
        >
          {COMMITMENT_KINDS.map((k) => (
            <option key={k} value={k}>
              {commitmentKindLabel(k)}
            </option>
          ))}
        </select>

        {needsText && (
          <TextInput
            value={text}
            placeholder={placeholderByKind[kind]}
            ariaLabel={`${commitmentKindLabel(kind)} value`}
            onChange={setText}
          />
        )}

        {kind === "representation" && (
          <TextInput
            value={avoid}
            placeholder="Avoid this representation (optional)…"
            ariaLabel="Representation to avoid"
            onChange={setAvoid}
          />
        )}
        {kind === "pace" && (
          <div className="space-y-1.5">
            <NumberInput
              value={undefined}
              placeholder="Sessions per week"
              ariaLabel="Sessions per week"
              onChange={setSessionsPerWeek}
            />
            <NumberInput
              value={undefined}
              placeholder="Minutes per session"
              ariaLabel="Minutes per session"
              onChange={setMinutesPerSession}
            />
          </div>
        )}
        {kind === "goal" && (
          <TextInput
            value={deadline}
            placeholder="Deadline (optional)…"
            ariaLabel="Goal deadline"
            onChange={setDeadline}
          />
        )}
      </div>
      <div className="mt-2 flex items-center justify-end gap-2">
        <button
          onClick={onCancel}
          className="rounded-md px-2 py-1 text-[11.5px] text-dim transition-colors hover:text-fg"
        >
          Cancel
        </button>
        <button
          onClick={commit}
          className="flex items-center gap-1 rounded-md bg-accent px-2.5 py-1 text-[11.5px] font-medium text-white transition-colors hover:bg-accent-deep"
        >
          <Check size={11} strokeWidth={3} /> Add
        </button>
      </div>
    </div>
  );
}

/* ──────────────────────────── inputs ──────────────────────────── */

function TextInput({
  value,
  placeholder,
  ariaLabel,
  onChange,
}: {
  value: string;
  placeholder: string;
  ariaLabel: string;
  onChange: (value: string) => void;
}) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      aria-label={ariaLabel}
      className="mt-0.5 w-full rounded-md border border-white/10 bg-black/25 px-2 py-1.5 text-[12px] text-fg outline-none transition-colors placeholder:text-faint focus:border-accent/50"
    />
  );
}

function NumberInput({
  value,
  placeholder,
  ariaLabel,
  onChange,
}: {
  value: number | undefined;
  placeholder: string;
  ariaLabel: string;
  onChange: (value: string) => void;
}) {
  return (
    <input
      type="number"
      min={0}
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      aria-label={ariaLabel}
      className="w-full rounded-md border border-white/10 bg-black/25 px-2 py-1.5 text-[12px] text-fg outline-none transition-colors placeholder:text-faint focus:border-accent/50"
    />
  );
}
