import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { formatCredits, studyusModelSpec } from "../lib/studyusModels";
import { customEndpointsProBypass } from "../lib/featureFlags";
import { EMPTY_CREDIT_USAGE, STARTING_CREDITS, formatCreditAmount, loadCreditUsage, type CreditUsage } from "../lib/credits";
import {
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  CornerDownLeft,
  Crown,
  LockKeyhole,
  MonitorSmartphone,
  Moon,
  Plus,
  Settings,
  Sun,
  Trash2,
  X,
} from "lucide-react";
import {
  DEFAULT_PREFERENCES,
  PREFERENCES_CHANGED_EVENT,
  loadPreferences,
  savePreferences,
  type AppearancePreferences,
  type DensityPreference,
  type FontPreference,
  type NotificationEventId,
  type SavedModelEndpoint,
  type StudyusPreferences,
  type SummaryCadence,
} from "../lib/preferences";
interface Props {
  open: boolean;
  onClose: () => void;
  onNotify: (text: string) => void;
  initialSection?: Section;
}

export type Section = "root" | "about" | "appearance" | "tutor" | "notifications" | "models";

const SECTIONS: { id: Exclude<Section, "root">; label: string; desc: string; disabled?: boolean }[] = [
  { id: "about", label: "About me", desc: "Profile, usage, plans and account" },
  { id: "appearance", label: "Appearance", desc: "Theme, font, layout and accessibility" },
  { id: "notifications", label: "Notifications", desc: "Study reminders, results and summaries" },
  { id: "models", label: "Model configuration", desc: "Your model endpoints and agent bindings" },
  { id: "tutor", label: "Tutor Studio", desc: "...in a newer update", disabled: true },
];

export function getSettingsSections(): { id: string; label: string; desc: string }[] {
  return SECTIONS.map(({ id, label, desc }) => ({ id, label, desc }));
}

function usePreferencesState(open: boolean) {
  const [preferences, setPreferencesState] = useState<StudyusPreferences>(() => loadPreferences());

  useEffect(() => {
    if (open) setPreferencesState(loadPreferences());
  }, [open]);

  useEffect(() => {
    const onChanged = (event: Event) => {
      const next = (event as CustomEvent<StudyusPreferences>).detail;
      if (next) setPreferencesState(next);
    };
    window.addEventListener(PREFERENCES_CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(PREFERENCES_CHANGED_EVENT, onChanged);
  }, []);

  const updatePreferences = useCallback((updater: (current: StudyusPreferences) => StudyusPreferences) => {
    setPreferencesState((current) => savePreferences(updater(current)));
  }, []);

  return [preferences, updatePreferences] as const;
}

export function SettingsModal({ open, onClose, onNotify, initialSection = "root" }: Props) {
  const [section, setSection] = useState<Section>("root");
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [preferences, updatePreferences] = usePreferencesState(open);

  const results = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return SECTIONS;
    return SECTIONS.filter((item) => `${item.label} ${item.desc}`.toLowerCase().includes(term));
  }, [query]);

  useEffect(() => {
    if (!open) return;
    setSection(initialSection === "tutor" ? "root" : initialSection);
    setQuery("");
    setCursor(0);
    window.setTimeout(() => inputRef.current?.focus(), 30);
  }, [open, initialSection]);

  useEffect(() => {
    setCursor(0);
  }, [query]);

  useEffect(() => {
    if (cursor >= results.length) setCursor(Math.max(0, results.length - 1));
  }, [cursor, results.length]);

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-settings-index="${cursor}"]`)?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        if (section === "root") onClose();
        else {
          setSection("root");
          setQuery("");
          window.setTimeout(() => inputRef.current?.focus(), 0);
        }
        return;
      }
      if (section !== "root") return;
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setCursor((current) => results.length === 0 ? 0 : (current + 1) % results.length);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        setCursor((current) => results.length === 0 ? 0 : (current - 1 + results.length) % results.length);
      } else if (event.key === "Enter") {
        const selected = results[cursor];
        if (selected) {
          event.preventDefault();
          if (!selected.disabled) {
            setSection(selected.id);
            setQuery("");
          }
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [cursor, onClose, open, results, section]);

  if (!open) return null;
  const inRoot = section === "root";
  const sectionMeta = SECTIONS.find((item) => item.id === section);

  return (
    <div className="fixed inset-0 z-[80] flex justify-center bg-black/50 px-4 pt-[8vh]" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={sectionMeta?.label ?? "Settings"}
        onMouseDown={(event) => event.stopPropagation()}
        className="settings-modal-original anim-toast flex h-fit max-h-[80vh] w-[min(560px,100%)] flex-col overflow-hidden rounded-xl border border-[#3a3a3a] bg-[#252525]/97 shadow-[0_28px_80px_rgba(0,0,0,0.6)] backdrop-blur-xl"
      >
        <div className="flex items-center gap-2 border-b border-white/[0.07] px-3.5 py-2.5">
          <Settings size={13} className="text-mut" />
          <button
            onClick={() => {
              setSection("root");
              setQuery("");
              window.setTimeout(() => inputRef.current?.focus(), 0);
            }}
            className="text-[12.5px] text-mut transition-colors hover:text-fg"
          >
            Settings
          </button>
          {!inRoot && sectionMeta && (
            <>
              <ChevronRight size={12} className="text-dim" />
              <span className="text-[12.5px] font-medium text-fg">{sectionMeta.label}</span>
            </>
          )}
          <button
            onClick={onClose}
            aria-label="Close settings"
            className="ml-auto grid h-6 w-6 place-items-center rounded text-dim transition-colors hover:bg-white/[0.07] hover:text-fg"
          >
            <X size={13} />
          </button>
        </div>

        <div className="flex items-center gap-2 border-b border-white/[0.07] px-3.5 py-2">
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => {
              if (!inRoot) setSection("root");
              setQuery(event.target.value);
            }}
            placeholder={sectionMeta ? `Search in ${sectionMeta.label}` : "Search settings"}
            aria-label="Search settings"
            className="min-w-0 flex-1 bg-transparent py-1 text-[13px] text-fg outline-none placeholder:text-[#6e6e6c]"
          />
          {!inRoot && (
            <button
              onClick={() => {
                setSection("root");
                setQuery("");
                window.setTimeout(() => inputRef.current?.focus(), 0);
              }}
              className="flex shrink-0 items-center gap-1.5 rounded-md border border-white/10 bg-white/[0.07] px-2 py-1 text-[11.5px] text-mut transition-colors hover:bg-white/[0.12] hover:text-fg"
            >
              <ArrowLeft size={11} /> Back
            </button>
          )}
        </div>

        <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto px-3.5 py-3">
          {inRoot && (
            <div role="listbox" aria-label="Settings sections" className="space-y-0.5">
              {results.map((item, index) => {
                const selected = index === cursor;
                return (
                  <button
                    key={item.id}
                    role="option"
                    aria-selected={selected}
                    data-settings-index={index}
                    onMouseEnter={() => setCursor(index)}
                    disabled={item.disabled}
                    aria-disabled={item.disabled}
                    onClick={() => {
                      if (item.disabled) return;
                      setSection(item.id);
                      setQuery("");
                    }}
                    className={`flex w-full items-center gap-3 rounded-md px-2 py-2 text-left transition-colors ${
                      item.disabled
                        ? "cursor-not-allowed text-white/30"
                        : selected ? "bg-white/[0.06]" : "hover:bg-white/[0.06]"
                    }`}
                  >
                    <span className="min-w-0 flex-1">
                      <span className={`block truncate text-[13px] ${item.disabled ? "text-white/35" : "text-fg"}`}>{item.label}</span>
                      <span className={`block truncate ${item.disabled ? "text-[10px] text-white/25" : "text-[11.5px] text-dim"}`}>{item.desc}</span>
                    </span>
                    {item.disabled ? (
                      <span className="flex shrink-0 items-center gap-1.5 font-mono text-[9px] tracking-wide text-white/30">
                        <LockKeyhole size={11} /> COMING SOON
                      </span>
                    ) : (
                      <ChevronRight size={13} className={selected ? "text-mut" : "text-dim"} />
                    )}
                  </button>
                );
              })}
              {results.length === 0 && (
                <p className="px-2 py-8 text-center text-[12.5px] text-dim">No settings match “{query}”.</p>
              )}
            </div>
          )}

          {section === "about" && (
            <AboutMe preferences={preferences} updatePreferences={updatePreferences} onNotify={onNotify} />
          )}
          {section === "appearance" && (
            <Appearance
              value={preferences.appearance}
              onChange={(appearance) => updatePreferences((current) => ({ ...current, appearance }))}
            />
          )}
          {section === "notifications" && (
            <Notifications preferences={preferences} updatePreferences={updatePreferences} onNotify={onNotify} />
          )}
          {section === "models" && (
            <Models preferences={preferences} updatePreferences={updatePreferences} onNotify={onNotify} />
          )}
        </div>

        <div className="flex items-center gap-3 border-t border-white/[0.07] px-3.5 py-2">
          <span className="text-[11.5px] text-dim">Navigate</span>
          <Key><ChevronUp size={10} /></Key>
          <Key><ChevronDown size={10} /></Key>
          <span className="ml-1 text-[11.5px] text-dim">Open</span>
          <Key><CornerDownLeft size={10} /></Key>
          <span className="ml-auto text-[11.5px] text-dim">Close</span>
          <Key>Esc</Key>
        </div>
      </div>
    </div>
  );
}

function Key({ children }: { children: ReactNode }) {
  return <kbd className="grid h-[18px] min-w-[18px] place-items-center rounded border border-white/10 bg-white/[0.07] px-1 font-mono text-[10px] text-mut">{children}</kbd>;
}

function GroupLabel({ children }: { children: ReactNode }) {
  return <div className="mb-1.5 mt-3 px-1 text-[11.5px] font-medium uppercase tracking-wide text-dim first:mt-0">{children}</div>;
}

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-3 rounded-md px-1 py-2">
      <div className="min-w-0 flex-1">
        <div className="truncate text-[12.5px] text-fg">{label}</div>
        {hint && <div className="truncate text-[11px] text-dim">{hint}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function Segment<T extends string>({ value, options, onChange }: {
  value: T;
  options: { id: T; label: ReactNode; icon?: typeof Sun }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="flex items-center gap-0.5 rounded-md bg-black/25 p-0.5">
      {options.map((option) => (
        <button
          key={option.id}
          onClick={() => onChange(option.id)}
          className={`flex items-center gap-1.5 rounded px-2 py-[3px] text-[11px] transition-colors ${
            value === option.id ? "bg-white/[0.16] text-fg" : "text-dim hover:text-mut"
          }`}
        >
          {option.icon && <option.icon size={11} />}
          {option.label}
        </button>
      ))}
    </div>
  );
}

function Toggle({ on, onChange, label }: { on: boolean; onChange: (value: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className={`h-[18px] w-[32px] shrink-0 rounded-full p-[2px] transition-colors ${on ? "bg-accent" : "bg-[#4a4a48]"}`}
    >
      <span className={`block h-[14px] w-[14px] rounded-full bg-white transition-transform ${on ? "translate-x-[14px]" : ""}`} />
    </button>
  );
}

function Slider({ value, onChange, min = 0, max = 100 }: { value: number; onChange: (value: number) => void; min?: number; max?: number }) {
  return <input type="range" min={min} max={max} value={value} onChange={(event) => onChange(Number(event.target.value))} className="w-full accent-accent" />;
}

function Field({ value, onChange, type = "text", placeholder, id }: {
  value: string;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
  id?: string;
}) {
  return (
    <input
      id={id}
      type={type}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      className="w-[180px] rounded-md border border-white/10 bg-black/25 px-2 py-1 text-[12.5px] text-fg outline-none"
    />
  );
}

/* ── About me ─────────────────────────────────────────────── */

function AboutMe({ preferences, updatePreferences, onNotify }: {
  preferences: StudyusPreferences;
  updatePreferences: (updater: (current: StudyusPreferences) => StudyusPreferences) => void;
  onNotify: (text: string) => void;
}) {
  const [usage, setUsage] = useState<CreditUsage>(EMPTY_CREDIT_USAGE);

  useEffect(() => {
    let cancelled = false;
    void loadCreditUsage()
      .then((next) => { if (!cancelled) setUsage(next); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  const profile = preferences.profile;
  const updateProfile = (patch: Partial<typeof profile>) => updatePreferences((current) => ({
    ...current,
    profile: { ...current.profile, ...patch },
  }));
  const initials = profile.fullName.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "L";
  const timezones = Array.from(new Set([profile.timezone, Intl.DateTimeFormat().resolvedOptions().timeZone, "UTC", "Asia/Bangkok", "Asia/Novosibirsk", "Europe/London", "America/New_York"])).filter(Boolean);
  // The bar now tracks the allowance, not the success rate: the headline number
  // is credits remaining, and a bar measuring something else beside it would be
  // read as belonging to it.
  const remainingPct = Math.round((usage.remaining / STARTING_CREDITS) * 100);

  return (
    <div>
      <GroupLabel>Account</GroupLabel>
      <div className="mb-3 flex items-center gap-3 rounded-md border border-white/8 bg-white/[0.03] p-3">
        <div className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-accent/25 text-[16px] font-semibold text-accent">{initials}</div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13.5px] font-medium text-fg">{profile.fullName || "Learner"}</div>
          <div className="truncate text-[11.5px] text-dim">{profile.email || "No email saved"} · stored on this device</div>
        </div>
        <button
          onClick={() => document.getElementById("settings-full-name")?.focus()}
          className="rounded-md border border-white/10 bg-white/[0.07] px-2.5 py-1 text-[11.5px] text-mut transition-colors hover:bg-white/[0.12] hover:text-fg"
        >
          Edit
        </button>
      </div>
      <Row label="Full name">
        <Field id="settings-full-name" value={profile.fullName} onChange={(fullName) => updateProfile({ fullName })} placeholder="Your name" />
      </Row>
      <Row label="Email">
        <Field value={profile.email} onChange={(email) => updateProfile({ email })} type="email" placeholder="you@example.com" />
      </Row>
      <Row label="Timezone">
        <select
          value={profile.timezone}
          onChange={(event) => updateProfile({ timezone: event.target.value })}
          className="w-[180px] rounded-md border border-white/10 bg-black/25 px-2 py-1 text-[12.5px] text-fg outline-none"
        >
          {timezones.map((timezone) => <option key={timezone}>{timezone}</option>)}
        </select>
      </Row>

      <GroupLabel>AI usage this month</GroupLabel>
      <div className="mb-3 rounded-md border border-white/8 bg-white/[0.03] p-3">
        <div className="mb-2 flex items-baseline justify-between">
          <div>
            <div className="text-[16px] font-semibold text-fg">
              {formatCreditAmount(usage.remaining)}{" "}
              <span className="text-[12px] font-normal text-dim">
                of {STARTING_CREDITS.toLocaleString()} credits
              </span>
            </div>
            <div className="text-[11.5px] text-dim">
              {usage.spent > 0
                ? `${formatCreditAmount(usage.spent)} spent · charged per request by the model you used`
                : "Charged per request, by the Studyus model you use"}
            </div>
          </div>
          <span className="rounded-full bg-accent/15 px-2 py-0.5 text-[11px] font-medium text-accent">{remainingPct}%</span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-white/8">
          <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${remainingPct}%` }} />
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2 text-center">
          {[
            { label: "Requests", value: usage.requests.toLocaleString() },
            { label: "Successful", value: usage.successful.toLocaleString() },
            { label: "Credits remaining", value: formatCreditAmount(usage.remaining) },
          ].map((metric) => (
            <div key={metric.label} className="rounded-md bg-black/25 py-2">
              <div className="text-[15px] font-semibold text-fg">{metric.value}</div>
              <div className="text-[10.5px] text-dim">{metric.label}</div>
            </div>
          ))}
        </div>
        <div className="mt-2 text-[10.5px] text-dim">
          {usage.requests > 0
            ? Object.entries(usage.byRole).map(([role, count]) => `${role}: ${count}`).join(" · ")
            : "No requests have been logged yet."}
        </div>
      </div>

      <GroupLabel>Danger zone</GroupLabel>
      <button
        onClick={() => {
          if (!window.confirm("Reset the local name, email and timezone? Notes, tests, sessions and model bindings will not be deleted.")) return;
          updatePreferences((current) => ({ ...current, profile: { ...DEFAULT_PREFERENCES.profile } }));
          onNotify("Local profile reset");
        }}
        className="w-full rounded-md border border-[#c42b1c]/40 bg-[#c42b1c]/10 py-2 text-[12.5px] font-medium text-[#ff8b80] transition-colors hover:bg-[#c42b1c]/20"
      >
        Reset local profile
      </button>
    </div>
  );
}

/* ── Appearance ───────────────────────────────────────────── */

const FONTS: { id: FontPreference; label: string; css: string }[] = [
  { id: "helvetica", label: "Helvetica Now", css: "'HelveticaNowDisplayW01-Rg', 'Helvetica Neue', Arial, sans-serif" },
  { id: "system", label: "System default", css: "system-ui, sans-serif" },
  { id: "inter", label: "Inter", css: "Inter, system-ui, sans-serif" },
  { id: "grotesk", label: "Space Grotesk", css: "'Space Grotesk', sans-serif" },
  { id: "serif", label: "Serif", css: "'Iowan Old Style', Georgia, serif" },
  { id: "mono", label: "Mono", css: "'Space Mono', ui-monospace, monospace" },
];

function Appearance({ value, onChange }: { value: AppearancePreferences; onChange: (value: AppearancePreferences) => void }) {
  const patch = <K extends keyof AppearancePreferences>(key: K, next: AppearancePreferences[K]) => onChange({ ...value, [key]: next });
  return (
    <div>
      <GroupLabel>Theme</GroupLabel>
      <div className="mb-3 flex items-center gap-1 rounded-lg bg-black/25 p-1">
        {([
          { id: "dark", label: "Dark", icon: Moon, preview: "bg-[#191919]" },
          { id: "light", label: "Light", icon: Sun, preview: "bg-[#f4f4f2]" },
          { id: "system", label: "System", icon: MonitorSmartphone, preview: "bg-gradient-to-br from-[#191919] to-[#f4f4f2]" },
        ] as const).map((option) => (
          <button
            key={option.id}
            onClick={() => patch("theme", option.id)}
            className={`flex flex-1 items-center gap-2 rounded-md px-2 py-2 text-left transition-colors ${value.theme === option.id ? "bg-white/[0.14] text-fg" : "text-mut hover:bg-white/[0.06] hover:text-fg"}`}
          >
            <span className={`h-6 w-6 shrink-0 rounded border border-white/12 ${option.preview}`} />
            <span className="flex flex-col leading-tight">
              <span className="flex items-center gap-1 text-[12.5px] font-medium"><option.icon size={11} /> {option.label}</span>
              <span className="text-[10px] text-dim">{option.id === "system" ? "Follow OS" : option.id === "dark" ? "Default" : "Bright"}</span>
            </span>
          </button>
        ))}
      </div>

      <GroupLabel>System font</GroupLabel>
      <div className="mb-3 space-y-1">
        {FONTS.map((font) => (
          <button
            key={font.id}
            onClick={() => patch("font", font.id)}
            className={`flex w-full items-center justify-between rounded px-2 py-1.5 text-left transition-colors ${value.font === font.id && !value.dyslexiaFriendly ? "bg-white/[0.09]" : "hover:bg-white/[0.06]"}`}
          >
            <span className="text-[13.5px] text-fg" style={{ fontFamily: font.css }}>{font.label} · The quick brown fox</span>
            {value.font === font.id && !value.dyslexiaFriendly && <Check size={13} className="text-accent" />}
          </button>
        ))}
      </div>

      <GroupLabel>Layout</GroupLabel>
      <Row label="Density" hint="Comfortable is roomier; compact fits more.">
        <Segment<DensityPreference>
          value={value.density}
          onChange={(density) => patch("density", density)}
          options={[{ id: "comfortable", label: "Comfortable" }, { id: "compact", label: "Compact" }]}
        />
      </Row>
      <Row label="Board pages" hint="Blocks per page">
        <Segment<"compact" | "standard" | "spacious">
          value={value.boardDensity ?? "standard"}
          onChange={(d) => patch("boardDensity", d)}
          options={[
            { id: "compact", label: "Compact" },
            { id: "standard", label: "Standard" },
            { id: "spacious", label: "Spacious" },
          ]}
        />
      </Row>
      <Row label={`Text size · ${value.textSize}%`}>
        <div className="w-[180px]"><Slider value={value.textSize} onChange={(size) => patch("textSize", size)} min={80} max={140} /></div>
      </Row>

      <GroupLabel>Accessibility</GroupLabel>
      <Row label="Reduce motion" hint="Cut animations and transitions">
        <Toggle label="Reduce motion" on={value.reducedMotion} onChange={(next) => patch("reducedMotion", next)} />
      </Row>
      <Row label="High contrast" hint="Stronger separators and text">
        <Toggle label="High contrast" on={value.highContrast} onChange={(next) => patch("highContrast", next)} />
      </Row>
      <Row label="Dyslexia-friendly font" hint="Uses OpenDyslexic where available">
        <Toggle label="Dyslexia-friendly font" on={value.dyslexiaFriendly} onChange={(next) => patch("dyslexiaFriendly", next)} />
      </Row>
      <Row label="Captions on tutor voice" hint="Always show what the tutor says">
        <Toggle label="Captions on tutor voice" on={value.captions} onChange={(next) => patch("captions", next)} />
      </Row>
    </div>
  );
}

/* ── Tutor Studio is implemented in settings/TutorStudio.tsx. ── */

/* ── Notifications ────────────────────────────────────────── */

const EVENT_LABELS: Record<NotificationEventId, string> = {
  testReady: "Generated test is ready",
  sessionComplete: "Study session is saved",
};

function Notifications({ preferences, updatePreferences, onNotify }: {
  preferences: StudyusPreferences;
  updatePreferences: (updater: (current: StudyusPreferences) => StudyusPreferences) => void;
  onNotify: (text: string) => void;
}) {
  const value = preferences.notifications;
  const updateNotifications = (notifications: typeof value) => updatePreferences((current) => ({ ...current, notifications }));
  const setEvent = (id: NotificationEventId, patch: Partial<(typeof value.events)[NotificationEventId]>) => updateNotifications({
    ...value,
    events: { ...value.events, [id]: { ...value.events[id], ...patch } },
  });

  const channelButtons = (active: "Silent" | "In-app" | "Email", choose: (channel: "Silent" | "In-app" | "Email") => void) => (
    <div className="flex shrink-0 items-center gap-0.5 rounded-md bg-black/25 p-0.5">
      {(["Silent", "In-app", "Email"] as const).map((channel) => (
        <button
          key={channel}
          onClick={() => choose(channel)}
          title={channel === "Email" ? "The preference is saved, but delivery needs a mail service" : undefined}
          className={`rounded px-2 py-[3px] text-[11px] transition-colors ${
            active === channel ? "bg-white/[0.16] text-fg" : "text-dim hover:text-mut"
          }`}
        >
          {channel}
        </button>
      ))}
    </div>
  );

  const chooseEmail = () => onNotify("Email preference saved; delivery remains unavailable until a mail service is configured");

  return (
    <div>
      <GroupLabel>General notifications</GroupLabel>
      <div className="mb-2 space-y-1">
        {(Object.keys(EVENT_LABELS) as NotificationEventId[]).map((id) => {
          const rule = value.events[id];
          const active = !rule.enabled ? "Silent" : rule.channel === "email" ? "Email" : rule.channel === "in-app" || rule.channel === "both" ? "In-app" : "Silent";
          return (
            <div key={id} className="flex items-center gap-3 rounded-md px-1 py-1.5">
              <Toggle
                label={EVENT_LABELS[id]}
                on={rule.enabled}
                onChange={(enabled) => setEvent(id, { enabled })}
              />
              <span className="min-w-0 flex-1 truncate text-[12.5px] text-fg">{EVENT_LABELS[id]}</span>
              {channelButtons(active, (channel) => {
                if (channel === "Silent") setEvent(id, { enabled: false });
                else if (channel === "Email") {
                  setEvent(id, { enabled: true, channel: "email" });
                  chooseEmail();
                } else setEvent(id, { enabled: true, channel: "in-app" });
              })}
            </div>
          );
        })}
      </div>

      <GroupLabel>Summary notifications</GroupLabel>
      <div className="space-y-1">
        {(["daily", "weekly", "monthly"] as Exclude<SummaryCadence, "off">[]).map((cadence) => {
          const enabled = value.summary.cadence === cadence;
          const active = !enabled ? "Silent" : value.summary.channel === "email" ? "Email" : value.summary.channel === "in-app" || value.summary.channel === "both" ? "In-app" : "Silent";
          const label = `${cadence[0].toUpperCase()}${cadence.slice(1)} summary`;
          return (
            <div key={cadence} className="flex items-center gap-3 rounded-md px-1 py-1.5">
              <Toggle
                label={label}
                on={enabled}
                onChange={(on) => updateNotifications({ ...value, summary: { ...value.summary, cadence: on ? cadence : "off" } })}
              />
              <span className="min-w-0 flex-1 truncate text-[12.5px] text-fg">{label}</span>
              {channelButtons(active, (channel) => {
                updateNotifications({
                  ...value,
                  summary: {
                    cadence: channel === "Silent" ? "off" : cadence,
                    channel: channel === "Silent" ? value.summary.channel : channel === "Email" ? "email" : "in-app",
                  },
                });
                if (channel === "Email") chooseEmail();
              })}
            </div>
          );
        })}
      </div>
      <p className="mt-2 px-1 text-[10.5px] text-dim">In-app summaries are checked while Studyus is open. Email is shown for continuity with the original control, but is unavailable without a mail service.</p>
    </div>
  );
}

/* ── Model configuration ──────────────────────────────────── */

/** Pro marker. The tooltip carries the explanation, so the icon stays quiet. */
function ProCrown() {
  return (
    <span
      title="Reserved for Studyus Pro subscriptions"
      className="grid h-3.5 w-3.5 place-items-center text-[#e2b73f]"
      aria-label="Reserved for Studyus Pro subscriptions"
    >
      <Crown size={11} />
    </span>
  );
}

const EMPTY_ENDPOINT: SavedModelEndpoint = {
  id: "",
  label: "",
  provider: "custom",
  baseUrl: "https://",
  model: "",
  keyMasked: "",
  active: false,
  vision: false,
};

const MODEL_ROLES = [
  ["tutor", "Assign as Tutor"],
  ["generation", "Assign as test generation agent"],
  ["evaluator", "Assign as test evaluation agent"],
] as const;

type ModelRole = (typeof MODEL_ROLES)[number][0];
type RoleAssignments = Record<ModelRole, string | null>;

const EMPTY_ASSIGNMENTS: RoleAssignments = {
  tutor: null,
  generation: null,
  evaluator: null,
};

function sameEndpoint(
  endpoint: SavedModelEndpoint,
  binding: { provider: string; baseUrl: string; modelId: string }
): boolean {
  return endpoint.provider === binding.provider
    && endpoint.baseUrl.replace(/\/+$/, "") === binding.baseUrl.replace(/\/+$/, "")
    && endpoint.model === binding.modelId;
}

function Models({ preferences, updatePreferences, onNotify }: {
  preferences: StudyusPreferences;
  updatePreferences: (updater: (current: StudyusPreferences) => StudyusPreferences) => void;
  onNotify: (text: string) => void;
}) {
  const endpoints = preferences.modelEndpoints;
  const appEndpoints = endpoints.filter((endpoint) => endpoint.provider === "studyus");
  const customEndpoints = endpoints.filter((endpoint) => endpoint.provider !== "studyus");
  const [category, setCategory] = useState<"app" | "custom">(
    appEndpoints.length > 0 ? "app" : "custom"
  );
  const [showAdd, setShowAdd] = useState(false);
  const [draft, setDraft] = useState<SavedModelEndpoint>(EMPTY_ENDPOINT);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<SavedModelEndpoint | null>(null);
  const [assignments, setAssignments] = useState<RoleAssignments>(EMPTY_ASSIGNMENTS);
  const [credentialId, setCredentialId] = useState<string | null>(null);
  const [credentialDraft, setCredentialDraft] = useState("");

  const setEndpoints = useCallback((modelEndpoints: SavedModelEndpoint[]) => {
    updatePreferences((current) => ({ ...current, modelEndpoints }));
  }, [updatePreferences]);

  const endpointConfig = useCallback(async (endpoint: SavedModelEndpoint) => {
    const { getCredentialLocally } = await import("../lib/llm");
    return {
      provider: endpoint.provider,
      baseUrl: endpoint.baseUrl,
      modelId: endpoint.model,
      apiKey: getCredentialLocally(`endpoint_${endpoint.id}`) || undefined,
    };
  }, []);

  const refreshBindings = useCallback(async () => {
    const { bindModelRole, defaultCapabilities, getModelBindings } = await import("../lib/llm");
    const roles = MODEL_ROLES.map(([role]) => role);
    let records = await getModelBindings();

    // Keep the invariant as soon as at least one usable model exists. A sole
    // model necessarily owns all roles; with several, valid independent picks
    // are preserved and only missing/stale roles are repaired.
    if (endpoints.length > 0) {
      const fallback = endpoints.find((endpoint) => endpoint.active) ?? endpoints[0];
      for (const role of roles) {
        const record = records.find((candidate) => candidate.role === role);
        const validEndpoint = record && endpoints.find((endpoint) => sameEndpoint(endpoint, record));
        const target = endpoints.length === 1 ? endpoints[0] : validEndpoint ?? fallback;
        // Re-applying a valid assignment also synchronizes its endpoint
        // credential and latest persisted capability flags into the role.
        const config = await endpointConfig(target);
        await bindModelRole(role, config, {
          ...defaultCapabilities(),
          vision: target.vision,
        });
      }
      records = await getModelBindings();
    }

    const next: RoleAssignments = { ...EMPTY_ASSIGNMENTS };
    for (const [role] of MODEL_ROLES) {
      const record = records.find((candidate) => candidate.role === role);
      next[role] = record
        ? endpoints.find((endpoint) => sameEndpoint(endpoint, record))?.id ?? null
        : null;
    }
    setAssignments(next);
  }, [endpointConfig, endpoints]);

  useEffect(() => {
    void refreshBindings().catch(() => undefined);
  }, [refreshBindings]);

  const commitEndpoint = async () => {
    const label = draft.label.trim();
    const baseUrl = draft.baseUrl.trim();
    const model = draft.model.trim();
    if (!label || !baseUrl || !model) return onNotify("Label, URL and model are required");
    if (!/^https?:\/\//i.test(baseUrl)) return onNotify("Endpoint URL must begin with http:// or https://");

    const id = `ep-${Date.now()}`;
    const key = draft.keyMasked.trim();
    const { storeCredentialLocally } = await import("../lib/llm");
    storeCredentialLocally(`endpoint_${id}`, key);
    const nextEndpoint: SavedModelEndpoint = {
      ...draft,
      id,
      label,
      baseUrl,
      model,
      keyMasked: key ? `••••${key.slice(-4)}` : "not set",
      active: endpoints.length === 0,
    };
    setEndpoints([
      ...endpoints.map((endpoint) => ({ ...endpoint, active: endpoints.length === 0 ? false : endpoint.active })),
      nextEndpoint,
    ]);
    setDraft(EMPTY_ENDPOINT);
    setShowAdd(false);
    setCategory("custom");
    onNotify(`Saved endpoint “${label}”`);
  };

  const activateEndpoint = (id: string) => {
    setEndpoints(endpoints.map((endpoint) => ({ ...endpoint, active: endpoint.id === id })));
  };

  const removeEndpoint = async (endpoint: SavedModelEndpoint) => {
    if (endpoints.length === 1) {
      onNotify("Add another model before removing the only assigned model");
      return;
    }
    if (!window.confirm(`Remove “${endpoint.label}” from saved endpoints? Its assigned roles will move to another model.`)) return;
    const { storeCredentialLocally } = await import("../lib/llm");
    storeCredentialLocally(`endpoint_${endpoint.id}`, "");
    const remaining = endpoints.filter((candidate) => candidate.id !== endpoint.id);
    if (!remaining.some((candidate) => candidate.active)) remaining[0] = { ...remaining[0], active: true };
    setEndpoints(remaining);
    onNotify("Saved endpoint removed; assignments were preserved");
  };

  const assignRole = async (role: ModelRole, endpoint: SavedModelEndpoint) => {
    if (assignments[role] === endpoint.id) {
      onNotify("Each role must always have one assigned model");
      return;
    }
    const { bindModelRole, defaultCapabilities } = await import("../lib/llm");
    try {
      await bindModelRole(role, await endpointConfig(endpoint), {
        ...defaultCapabilities(),
        vision: endpoint.vision,
      });
      await refreshBindings();
      onNotify(`${endpoint.label} assigned`);
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "Could not save model assignment");
    }
  };

  const updateVision = async (endpoint: SavedModelEndpoint, vision: boolean) => {
    const updated = { ...endpoint, vision };
    setEndpoints(endpoints.map((candidate) => candidate.id === endpoint.id ? updated : candidate));
    const { bindModelRole, defaultCapabilities } = await import("../lib/llm");
    for (const [role] of MODEL_ROLES) {
      if (assignments[role] === endpoint.id) {
        await bindModelRole(role, await endpointConfig(updated), {
          ...defaultCapabilities(),
          vision,
        });
      }
    }
  };

  const testEndpoint = async (endpoint: SavedModelEndpoint) => {
    setTestingId(endpoint.id);
    try {
      const { testModelEndpoint } = await import("../lib/llm");
      const result = await testModelEndpoint(await endpointConfig(endpoint));
      if (result.reachable && result.modelAvailable && result.capabilities.vision !== endpoint.vision) {
        await updateVision(endpoint, result.capabilities.vision);
      }
      onNotify(result.reachable && result.modelAvailable
        ? `${endpoint.model} is reachable and returned a compatible response`
        : result.error || "The endpoint did not return a compatible response");
    } finally {
      setTestingId(null);
    }
  };

  const beginEndpointEdit = (endpoint: SavedModelEndpoint) => {
    setEditingId(endpoint.id);
    setEditDraft({ ...endpoint });
    setCredentialId(null);
    setCredentialDraft("");
  };

  const cancelEndpointEdit = () => {
    setEditingId(null);
    setEditDraft(null);
    setCredentialId(null);
    setCredentialDraft("");
  };

  const saveEndpointEdit = async (endpoint: SavedModelEndpoint) => {
    if (!editDraft || editDraft.id !== endpoint.id) return;
    const label = editDraft.label.trim();
    const baseUrl = editDraft.baseUrl.trim();
    const model = editDraft.model.trim();
    if (!label || !baseUrl || !model) return onNotify("Label, URL and model are required");
    if (!/^https?:\/\//i.test(baseUrl)) return onNotify("Endpoint URL must begin with http:// or https://");

    const updated: SavedModelEndpoint = {
      ...endpoint,
      label,
      provider: editDraft.provider,
      baseUrl,
      model,
    };
    try {
      // Update every owned role before publishing the new endpoint metadata so
      // assignment records and the saved card can never disagree.
      const { bindModelRole, defaultCapabilities } = await import("../lib/llm");
      for (const [role] of MODEL_ROLES) {
        if (assignments[role] === endpoint.id) {
          await bindModelRole(role, await endpointConfig(updated), {
            ...defaultCapabilities(),
            vision: updated.vision,
          });
        }
      }
      setEndpoints(endpoints.map((candidate) => candidate.id === endpoint.id ? updated : candidate));
      cancelEndpointEdit();
      onNotify(`Updated endpoint “${label}”`);
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "Could not update this endpoint");
    }
  };

  const saveCredential = async (endpoint: SavedModelEndpoint) => {
    const { storeCredentialLocally } = await import("../lib/llm");
    const value = credentialDraft.trim();
    storeCredentialLocally(`endpoint_${endpoint.id}`, value);
    setEndpoints(endpoints.map((candidate) => candidate.id === endpoint.id
      ? { ...candidate, keyMasked: value ? `••••${value.slice(-4)}` : "not set" }
      : candidate));
    // Re-bind every role owned by this endpoint so stale role credentials are
    // replaced or explicitly cleared immediately.
    for (const [role] of MODEL_ROLES) {
      if (assignments[role] === endpoint.id) {
        const { bindModelRole, defaultCapabilities } = await import("../lib/llm");
        await bindModelRole(role, {
          provider: endpoint.provider,
          baseUrl: endpoint.baseUrl,
          modelId: endpoint.model,
          apiKey: value || undefined,
        }, { ...defaultCapabilities(), vision: endpoint.vision });
      }
    }
    setCredentialId(null);
    setCredentialDraft("");
    onNotify(value ? "API key replaced" : "API key cleared");
  };

  const visibleEndpoints = category === "app" ? appEndpoints : customEndpoints;

  return (
    <div>
      <GroupLabel>Models</GroupLabel>
      <div className="mb-3 grid grid-cols-2 rounded-md bg-black/25 p-0.5" aria-label="Model categories">
        <button
          onClick={() => setCategory("app")}
          className={`rounded px-2 py-1.5 text-[11.5px] transition-colors ${category === "app" ? "bg-white/[0.14] text-fg" : "text-dim hover:text-mut"}`}
        >
          Studyus models · {appEndpoints.length}
        </button>
        <button
          onClick={() => setCategory("custom")}
          className={`flex items-center justify-center gap-1.5 rounded px-2 py-1.5 text-[11.5px] transition-colors ${category === "custom" ? "bg-white/[0.14] text-fg" : "text-dim hover:text-mut"}`}
        >
          Custom endpoints · {customEndpoints.length}
          {!customEndpointsProBypass && <ProCrown />}
        </button>
      </div>

      {category === "app" && appEndpoints.length === 0 && (
        <div className="mb-3 rounded-md border border-dashed border-white/10 p-4 text-center text-[11.5px] text-dim">
          No app-provided model is bundled in this installation.
        </div>
      )}

      <div className="mb-2 space-y-2">
        {category === "custom" && customEndpoints.length === 0 && (
          <div className="rounded-md border border-dashed border-white/10 p-4 text-center text-[11.5px] text-dim">
            No custom endpoint is saved on this device.
          </div>
        )}
        {visibleEndpoints.map((endpoint) => {
          const editing = editingId === endpoint.id && editDraft?.id === endpoint.id;
          return (
            <div key={endpoint.id} className={`rounded-md border p-2 transition-colors ${endpoint.active ? "border-accent/50 bg-accent/[0.05]" : "border-white/8 bg-white/[0.03]"}`}>
              <div className="flex items-start gap-1.5">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-[12.5px] font-medium text-fg">{endpoint.label}</span>
                    {endpoint.active && <span className="rounded-full bg-accent/20 px-1.5 py-[1px] text-[9.5px] font-medium text-accent">Active</span>}
                    {endpoint.vision && <span className="rounded-full bg-[#7dd3fc]/15 px-1.5 py-[1px] text-[9.5px] text-[#7dd3fc]">Vision</span>}
                    {endpoint.provider === "studyus" && studyusModelSpec(endpoint.id) && (
                      <span className="rounded-full bg-white/[0.08] px-1.5 py-[1px] font-mono text-[9.5px] text-mut" title="Credits used per request">
                        {formatCredits(studyusModelSpec(endpoint.id)!.credits)}
                      </span>
                    )}
                  </div>
                  {endpoint.provider === "studyus" ? (
                    // The routed model id and the key are Studyus's, not the
                    // learner's: showing the id leaks which vendor backs each
                    // tier, and a key field they must leave blank reads as a
                    // broken form. The credit price is the fact that matters.
                    <div className="truncate text-[10.5px] text-dim">
                      {studyusModelSpec(endpoint.id)?.blurb ?? "Provided by Studyus."}
                    </div>
                  ) : (
                    <div className="truncate font-mono text-[10px] text-dim">{endpoint.model} · {endpoint.baseUrl} · key: {endpoint.keyMasked}</div>
                  )}
                </div>
                <button disabled={testingId === endpoint.id} onClick={() => { void testEndpoint(endpoint); }} className="shrink-0 rounded-md border border-white/10 bg-white/[0.07] px-2 py-1 text-[10.5px] text-mut hover:bg-white/[0.12] hover:text-fg disabled:opacity-50">{testingId === endpoint.id ? "Testing…" : "Test"}</button>
                {endpoint.provider !== "studyus" && (
                  <button
                    onClick={() => editing ? cancelEndpointEdit() : beginEndpointEdit(endpoint)}
                    className={`shrink-0 rounded-md border px-2 py-1 text-[10.5px] transition-colors ${editing ? "border-accent/35 bg-accent/15 text-accent" : "border-white/10 bg-white/[0.07] text-mut hover:bg-white/[0.12] hover:text-fg"}`}
                  >
                    Edit
                  </button>
                )}
                {!endpoint.active && <button onClick={() => activateEndpoint(endpoint.id)} className="shrink-0 rounded-md border border-white/10 bg-white/[0.07] px-2 py-1 text-[10.5px] text-mut hover:bg-white/[0.12] hover:text-fg">Use</button>}
                {endpoint.provider !== "studyus" && <button onClick={() => { void removeEndpoint(endpoint); }} title="Remove saved endpoint" className="grid h-6 w-6 shrink-0 place-items-center rounded text-dim hover:bg-white/[0.07] hover:text-[#ff8b80]"><Trash2 size={12} /></button>}
              </div>

              <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-0 border-t border-white/6 pt-1.5">
                {MODEL_ROLES.map(([role, label]) => (
                  <label key={role} className="flex cursor-pointer items-center gap-1.5 whitespace-nowrap rounded px-1 py-0.5 text-[10.5px] text-mut hover:bg-white/[0.04] hover:text-fg">
                    <input
                      type="checkbox"
                      checked={assignments[role] === endpoint.id}
                      onChange={() => { void assignRole(role, endpoint); }}
                      className="h-3.5 w-3.5 accent-[var(--accent)]"
                    />
                    {label}
                  </label>
                ))}
                <label className="flex cursor-pointer items-center gap-1.5 whitespace-nowrap rounded px-1 py-0.5 text-[10.5px] text-mut hover:bg-white/[0.04] hover:text-fg">
                  <input type="checkbox" checked={endpoint.vision} onChange={(event) => { void updateVision(endpoint, event.target.checked); }} className="h-3.5 w-3.5 accent-[var(--accent)]" />
                  Supports Vision input
                </label>
              </div>

              {editing && editDraft && (
                <div className="mt-1.5 space-y-1.5 border-t border-white/6 pt-2">
                  <div className="grid gap-1.5 sm:grid-cols-[1fr_112px]">
                    <input value={editDraft.label} onChange={(event) => setEditDraft((current) => current ? { ...current, label: event.target.value } : current)} placeholder="Endpoint label" aria-label="Endpoint label" className="min-w-0 rounded-md border border-white/10 bg-black/25 px-2 py-1.5 text-[11px] text-fg outline-none placeholder:text-[#6e6e6c]" />
                    <select value={editDraft.provider} onChange={(event) => setEditDraft((current) => current ? { ...current, provider: event.target.value as SavedModelEndpoint["provider"] } : current)} aria-label="Provider" className="rounded-md border border-white/10 bg-black/25 px-2 py-1.5 text-[11px] text-fg outline-none"><option value="openai">OpenAI</option><option value="anthropic">Anthropic</option><option value="custom">Custom</option></select>
                  </div>
                  <div className="grid gap-1.5 sm:grid-cols-2">
                    <input value={editDraft.baseUrl} onChange={(event) => setEditDraft((current) => current ? { ...current, baseUrl: event.target.value } : current)} placeholder="Base URL" aria-label="Base URL" className="min-w-0 rounded-md border border-white/10 bg-black/25 px-2 py-1.5 font-mono text-[10.5px] text-fg outline-none placeholder:text-[#6e6e6c]" />
                    <input value={editDraft.model} onChange={(event) => setEditDraft((current) => current ? { ...current, model: event.target.value } : current)} placeholder="Model identifier" aria-label="Model identifier" className="min-w-0 rounded-md border border-white/10 bg-black/25 px-2 py-1.5 font-mono text-[10.5px] text-fg outline-none placeholder:text-[#6e6e6c]" />
                  </div>
                  {credentialId === endpoint.id ? (
                    <div className="flex gap-1.5">
                      <input type="password" autoFocus value={credentialDraft} onChange={(event) => setCredentialDraft(event.target.value)} placeholder="New API key (blank clears it)" aria-label="New API key" className="min-w-0 flex-1 rounded-md border border-white/10 bg-black/25 px-2 py-1 text-[10.5px] text-fg outline-none placeholder:text-[#6e6e6c]" />
                      <button onClick={() => { void saveCredential(endpoint); }} className="rounded-md bg-accent px-2.5 py-1 text-[10.5px] font-medium text-white">Save key</button>
                      <button onClick={() => { setCredentialId(null); setCredentialDraft(""); }} className="rounded-md px-2 py-1 text-[10.5px] text-dim hover:text-fg">Cancel</button>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between gap-2 px-0.5 text-[10px] text-dim">
                      <span>API key · {endpoint.keyMasked}</span>
                      <button onClick={() => { setCredentialId(endpoint.id); setCredentialDraft(""); }} className="shrink-0 text-mut hover:text-fg">Replace or clear</button>
                    </div>
                  )}
                  <div className="flex justify-end gap-1.5">
                    <button onClick={cancelEndpointEdit} className="rounded-md px-2.5 py-1 text-[10.5px] text-dim hover:text-fg">Cancel</button>
                    <button onClick={() => { void saveEndpointEdit(endpoint); }} className="rounded-md bg-accent px-2.5 py-1 text-[10.5px] font-medium text-white">Save changes</button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {category === "custom" && !customEndpointsProBypass && (
        <div className="mb-2 flex items-start gap-2 rounded-md border border-[#e2b73f]/25 bg-[#e2b73f]/[0.06] px-2.5 py-2">
          <Crown size={12} className="mt-[2px] shrink-0 text-[#e2b73f]" />
          <p className="text-[11.5px] leading-relaxed text-mut">
            <span className="font-medium text-fg">Custom endpoints are a Pro feature.</span>{" "}
            Bring your own OpenAI-compatible model and key. Endpoints you already saved keep
            working — you can test, assign and remove them.
          </p>
        </div>
      )}

      {category === "custom" && (!showAdd ? (
        <button
          // TEMPORARY: while `customEndpointsProBypass` is set this opens the
          // add form instead of pointing at Pro; the lock returns with the flag.
          onClick={() => (customEndpointsProBypass ? setShowAdd(true) : onNotify("Custom endpoints are reserved for Studyus Pro"))}
          title={customEndpointsProBypass ? undefined : "Reserved for Studyus Pro"}
          className={customEndpointsProBypass
            ? "mb-2 flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-white/12 py-2 text-[12px] text-mut transition-colors hover:border-accent/40 hover:text-fg"
            : "mb-2 flex w-full cursor-not-allowed items-center justify-center gap-1.5 rounded-md border border-dashed border-white/12 py-2 text-[12px] text-dim transition-colors hover:border-[#e2b73f]/30"}
        >
          {customEndpointsProBypass ? <Plus size={12} /> : <Crown size={12} className="text-[#e2b73f]" />}
          Add OpenAI-compatible endpoint
        </button>
      ) : (
        <div className="mb-2 space-y-2 rounded-md border border-white/10 bg-white/[0.03] p-3">
          <div className="mb-1 flex items-center justify-between"><span className="text-[11.5px] font-medium text-fg">New custom endpoint</span><button onClick={() => setShowAdd(false)} className="grid h-5 w-5 place-items-center rounded text-dim hover:bg-white/[0.07] hover:text-fg"><X size={11} /></button></div>
          <input value={draft.label} onChange={(event) => setDraft((current) => ({ ...current, label: event.target.value }))} placeholder="Label (e.g. My local Llama)" className="w-full rounded-md border border-white/10 bg-black/25 px-2 py-1.5 text-[12px] text-fg outline-none placeholder:text-[#6e6e6c]" />
          <div className="flex gap-2">
            <select value={draft.provider} onChange={(event) => setDraft((current) => ({ ...current, provider: event.target.value as SavedModelEndpoint["provider"] }))} className="w-[110px] rounded-md border border-white/10 bg-black/25 px-2 py-1.5 text-[12px] text-fg outline-none"><option value="openai">OpenAI</option><option value="anthropic">Anthropic</option><option value="custom">Custom</option></select>
            <input value={draft.baseUrl} onChange={(event) => setDraft((current) => ({ ...current, baseUrl: event.target.value }))} placeholder="Base URL" className="min-w-0 flex-1 rounded-md border border-white/10 bg-black/25 px-2 py-1.5 font-mono text-[11.5px] text-fg outline-none placeholder:text-[#6e6e6c]" />
          </div>
          <input value={draft.model} onChange={(event) => setDraft((current) => ({ ...current, model: event.target.value }))} placeholder="Model identifier" className="w-full rounded-md border border-white/10 bg-black/25 px-2 py-1.5 font-mono text-[11.5px] text-fg outline-none placeholder:text-[#6e6e6c]" />
          <input type="password" value={draft.keyMasked} onChange={(event) => setDraft((current) => ({ ...current, keyMasked: event.target.value }))} placeholder="API key (optional for a local endpoint)" className="w-full rounded-md border border-white/10 bg-black/25 px-2 py-1.5 font-mono text-[11.5px] text-fg outline-none placeholder:text-[#6e6e6c]" />
          <label className="flex items-center gap-2 text-[11px] text-mut"><input type="checkbox" checked={draft.vision} onChange={(event) => setDraft((current) => ({ ...current, vision: event.target.checked }))} className="h-3.5 w-3.5 accent-[var(--accent)]" />This model supports Vision image input</label>
          <div className="flex items-center justify-end gap-2"><button onClick={() => setShowAdd(false)} className="rounded-md px-2.5 py-1 text-[11.5px] text-mut hover:text-fg">Cancel</button><button onClick={() => { void commitEndpoint(); }} className="rounded-md bg-accent px-3 py-1 text-[11.5px] font-medium text-white transition-colors hover:bg-accent-deep">Save endpoint</button></div>
        </div>
      ))}
      <p className="px-1 text-[10.5px] leading-relaxed text-dim">Model registrations and role assignments persist on this device. API key values remain in the local credential store and are not included in searchable settings metadata.</p>
    </div>
  );
}
