import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ArrowLeft,
  Bell,
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  CornerDownLeft,
  Cpu,
  Eye,
  MonitorSmartphone,
  Moon,
  Palette,
  Plus,
  Settings,
  Star,
  Sun,
  Trash2,
  UserRound,
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
  type NotificationChannel,
  type NotificationEventId,
  type SavedModelEndpoint,
  type StudyusPreferences,
  type SummaryCadence,
  type TutorDifficulty,
  type TutorStylePreference,
} from "../lib/preferences";
import {
  getDesktopNotificationPermission,
  requestDesktopNotificationPermission,
  sendNotificationPreview,
} from "../lib/notifications";

interface Props {
  open: boolean;
  onClose: () => void;
  onNotify: (text: string) => void;
  initialSection?: Section;
}

export type Section = "root" | "about" | "appearance" | "tutor" | "notifications" | "models";

const SECTIONS: { id: Exclude<Section, "root">; label: string; desc: string }[] = [
  { id: "about", label: "About me", desc: "Local profile and actual AI usage" },
  { id: "appearance", label: "Appearance", desc: "Theme, font, density and accessibility" },
  { id: "tutor", label: "AI Tutor & Study", desc: "Tutor behavior, difficulty and session pacing" },
  { id: "notifications", label: "Notifications", desc: "Study events, delivery channels and summaries" },
  { id: "models", label: "Model configuration", desc: "Your model endpoints and agent bindings" },
];

const SECTION_ICONS = {
  about: UserRound,
  appearance: Palette,
  tutor: Bot,
  notifications: Bell,
  models: Cpu,
} satisfies Record<Exclude<Section, "root">, typeof UserRound>;

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
    setSection(initialSection);
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
          setSection(selected.id);
          setQuery("");
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
        className="anim-toast flex h-fit max-h-[82vh] w-[min(600px,100%)] flex-col overflow-hidden rounded-xl border border-edge bg-panel/97 text-fg shadow-[0_28px_80px_rgba(0,0,0,0.45)] backdrop-blur-xl"
      >
        <div className="flex items-center gap-2 border-b border-edge-soft px-3.5 py-2.5">
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

        <div className="flex items-center gap-2 border-b border-edge-soft px-3.5 py-2">
          {inRoot ? (
            <input
              ref={inputRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search settings"
              aria-label="Search settings"
              className="min-w-0 flex-1 bg-transparent py-1 text-[13px] text-fg outline-none placeholder:text-dim"
            />
          ) : (
            <>
              <button
                onClick={() => {
                  setSection("root");
                  setQuery("");
                  window.setTimeout(() => inputRef.current?.focus(), 0);
                }}
                className="flex items-center gap-1.5 rounded-md border border-edge bg-raise px-2 py-1 text-[11.5px] text-mut transition-colors hover:text-fg"
              >
                <ArrowLeft size={11} /> Back to all settings
              </button>
              <span className="ml-auto text-[11px] text-dim">Changes save automatically</span>
            </>
          )}
        </div>

        <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto px-3.5 py-3">
          {inRoot && (
            <div role="listbox" aria-label="Settings sections" className="space-y-0.5">
              {results.map((item, index) => {
                const Icon = SECTION_ICONS[item.id];
                const selected = index === cursor;
                return (
                  <button
                    key={item.id}
                    role="option"
                    aria-selected={selected}
                    data-settings-index={index}
                    onMouseEnter={() => setCursor(index)}
                    onClick={() => {
                      setSection(item.id);
                      setQuery("");
                    }}
                    className={`flex w-full items-center gap-3 rounded-md px-2 py-2 text-left transition-colors ${
                      selected ? "bg-raise" : "hover:bg-raise/70"
                    }`}
                  >
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-edge bg-card text-accent">
                      <Icon size={15} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] text-fg">{item.label}</span>
                      <span className="block truncate text-[11.5px] text-dim">{item.desc}</span>
                    </span>
                    {selected ? <CornerDownLeft size={13} className="text-accent" /> : <ChevronRight size={13} className="text-dim" />}
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
          {section === "tutor" && (
            <TutorAndStudy preferences={preferences} updatePreferences={updatePreferences} onNotify={onNotify} />
          )}
          {section === "notifications" && (
            <Notifications preferences={preferences} updatePreferences={updatePreferences} onNotify={onNotify} />
          )}
          {section === "models" && (
            <Models preferences={preferences} updatePreferences={updatePreferences} onNotify={onNotify} />
          )}
        </div>

        <div className="flex items-center gap-3 border-t border-edge-soft px-3.5 py-2">
          {inRoot ? (
            <>
              <span className="text-[11.5px] text-dim">Navigate</span>
              <Key><ChevronUp size={10} /></Key>
              <Key><ChevronDown size={10} /></Key>
              <span className="ml-1 text-[11.5px] text-dim">Open</span>
              <Key><CornerDownLeft size={10} /></Key>
              <span className="ml-auto text-[11.5px] text-dim">Close</span>
              <Key>Esc</Key>
            </>
          ) : (
            <>
              <span className="text-[11.5px] text-dim">Back</span>
              <Key>Esc</Key>
              <span className="ml-auto text-[11.5px] text-dim">Close</span>
              <button onClick={onClose} className="text-[11.5px] text-mut hover:text-fg">Close settings</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Key({ children }: { children: ReactNode }) {
  return <kbd className="grid h-[18px] min-w-[18px] place-items-center rounded border border-edge bg-raise px-1 font-mono text-[10px] text-mut">{children}</kbd>;
}

function GroupLabel({ children }: { children: ReactNode }) {
  return <div className="mb-1.5 mt-3 px-1 text-[11.5px] font-medium uppercase tracking-wide text-dim first:mt-0">{children}</div>;
}

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-3 rounded-md px-1 py-2">
      <div className="min-w-0 flex-1">
        <div className="text-[12.5px] text-fg">{label}</div>
        {hint && <div className="text-[11px] text-dim">{hint}</div>}
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
    <div className="flex items-center gap-0.5 rounded-md bg-ink/45 p-0.5">
      {options.map((option) => (
        <button
          key={option.id}
          onClick={() => onChange(option.id)}
          className={`flex items-center gap-1.5 rounded px-2 py-[3px] text-[11px] transition-colors ${
            value === option.id ? "bg-raise text-fg shadow-sm" : "text-dim hover:text-mut"
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
      className={`h-[20px] w-[34px] shrink-0 rounded-full p-[2px] transition-colors ${on ? "bg-accent" : "bg-faint"}`}
    >
      <span className={`block h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${on ? "translate-x-[14px]" : ""}`} />
    </button>
  );
}

function Slider({ value, onChange, min = 0, max = 100 }: { value: number; onChange: (value: number) => void; min?: number; max?: number }) {
  return <input type="range" min={min} max={max} value={value} onChange={(event) => onChange(Number(event.target.value))} className="w-full accent-accent" />;
}

function Field({ value, onChange, type = "text", placeholder }: {
  value: string;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      className="w-[220px] max-w-[45vw] rounded-md border border-edge bg-ink/35 px-2 py-1.5 text-[12px] text-fg outline-none placeholder:text-dim focus:border-accent"
    />
  );
}

/* ── About me ─────────────────────────────────────────────── */

interface UsageStats {
  calls: number;
  successful: number;
  tokens: number;
  byRole: Record<string, number>;
}

function AboutMe({ preferences, updatePreferences, onNotify }: {
  preferences: StudyusPreferences;
  updatePreferences: (updater: (current: StudyusPreferences) => StudyusPreferences) => void;
  onNotify: (text: string) => void;
}) {
  const [usage, setUsage] = useState<UsageStats>({ calls: 0, successful: 0, tokens: 0, byRole: {} });

  useEffect(() => {
    let cancelled = false;
    void import("../db/database").then(async ({ getDb }) => {
      const db = await getDb();
      const result = db.exec("SELECT role, outcome, token_counts_json FROM agent_calls;");
      const next: UsageStats = { calls: 0, successful: 0, tokens: 0, byRole: {} };
      for (const row of result[0]?.values ?? []) {
        const role = String(row[0] ?? "unknown");
        next.calls += 1;
        next.byRole[role] = (next.byRole[role] ?? 0) + 1;
        if (row[1] === "success") next.successful += 1;
        try {
          const parsed = JSON.parse(String(row[2] || "{}")) as { total?: unknown };
          if (typeof parsed.total === "number" && Number.isFinite(parsed.total)) next.tokens += parsed.total;
        } catch {}
      }
      if (!cancelled) setUsage(next);
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  const profile = preferences.profile;
  const updateProfile = (patch: Partial<typeof profile>) => updatePreferences((current) => ({
    ...current,
    profile: { ...current.profile, ...patch },
  }));
  const initials = profile.fullName.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "L";
  const timezones = Array.from(new Set([profile.timezone, Intl.DateTimeFormat().resolvedOptions().timeZone, "UTC", "Asia/Bangkok", "Asia/Novosibirsk", "Europe/London", "America/New_York"])).filter(Boolean);

  return (
    <div>
      <GroupLabel>Local learner profile</GroupLabel>
      <div className="mb-3 flex items-center gap-3 rounded-md border border-edge bg-card p-3">
        <div className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-accent/15 text-[15px] font-semibold text-accent">{initials}</div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13.5px] font-medium text-fg">{profile.fullName || "Learner"}</div>
          <div className="truncate text-[11.5px] text-dim">{profile.email || "No email saved"} · stored on this device</div>
        </div>
      </div>
      <Row label="Full name" hint="Used to personalize local Studyus surfaces.">
        <Field value={profile.fullName} onChange={(fullName) => updateProfile({ fullName })} placeholder="Your name" />
      </Row>
      <Row label="Email" hint="Saved locally; Studyus does not claim to send account mail.">
        <Field value={profile.email} onChange={(email) => updateProfile({ email })} type="email" placeholder="you@example.com" />
      </Row>
      <Row label="Timezone" hint="Saved with your local profile; elapsed-time reminders follow this device's clock.">
        <select
          value={profile.timezone}
          onChange={(event) => updateProfile({ timezone: event.target.value })}
          className="w-[220px] max-w-[45vw] rounded-md border border-edge bg-ink/35 px-2 py-1.5 text-[12px] text-fg outline-none"
        >
          {timezones.map((timezone) => <option key={timezone}>{timezone}</option>)}
        </select>
      </Row>

      <GroupLabel>Actual AI usage on this device</GroupLabel>
      <div className="mb-3 rounded-md border border-edge bg-card p-3">
        <div className="grid grid-cols-3 gap-2 text-center">
          {[
            { label: "Agent calls", value: usage.calls.toLocaleString() },
            { label: "Successful", value: usage.successful.toLocaleString() },
            { label: "Tokens reported", value: usage.tokens.toLocaleString() },
          ].map((metric) => (
            <div key={metric.label} className="rounded-md bg-ink/35 px-1 py-2">
              <div className="text-[15px] font-semibold text-fg">{metric.value}</div>
              <div className="text-[10.5px] text-dim">{metric.label}</div>
            </div>
          ))}
        </div>
        <div className="mt-2 text-[10.5px] text-dim">
          {usage.calls > 0
            ? Object.entries(usage.byRole).map(([role, count]) => `${role}: ${count}`).join(" · ")
            : "No agent calls have been logged yet."}
        </div>
      </div>

      <GroupLabel>Profile reset</GroupLabel>
      <button
        onClick={() => {
          if (!window.confirm("Reset the local name, email and timezone? Notes, tests, sessions and model bindings will not be deleted.")) return;
          updatePreferences((current) => ({ ...current, profile: { ...DEFAULT_PREFERENCES.profile } }));
          onNotify("Local profile reset");
        }}
        className="w-full rounded-md border border-[#c42b1c]/40 bg-[#c42b1c]/10 py-2 text-[12.5px] font-medium text-[#e35d50] transition-colors hover:bg-[#c42b1c]/20"
      >
        Reset local profile
      </button>
    </div>
  );
}

/* ── Appearance ───────────────────────────────────────────── */

const FONTS: { id: FontPreference; label: string; css: string }[] = [
  { id: "grotesk", label: "Space Grotesk", css: "'Space Grotesk', system-ui, sans-serif" },
  { id: "system", label: "System UI", css: "system-ui, sans-serif" },
  { id: "serif", label: "Serif", css: "Georgia, serif" },
  { id: "mono", label: "Mono", css: "'Space Mono', ui-monospace, monospace" },
];

function Appearance({ value, onChange }: { value: AppearancePreferences; onChange: (value: AppearancePreferences) => void }) {
  const patch = <K extends keyof AppearancePreferences>(key: K, next: AppearancePreferences[K]) => onChange({ ...value, [key]: next });
  return (
    <div>
      <GroupLabel>Theme</GroupLabel>
      <div className="mb-3 flex items-center gap-1 rounded-lg bg-ink/45 p-1">
        {([
          { id: "dark", label: "Dark", icon: Moon, preview: "bg-[#191919]" },
          { id: "light", label: "Light", icon: Sun, preview: "bg-[#f4f4f2]" },
          { id: "system", label: "System", icon: MonitorSmartphone, preview: "bg-gradient-to-br from-[#191919] to-[#f4f4f2]" },
        ] as const).map((option) => (
          <button
            key={option.id}
            onClick={() => patch("theme", option.id)}
            className={`flex flex-1 items-center gap-2 rounded-md px-2 py-2 text-left transition-colors ${value.theme === option.id ? "bg-raise text-fg shadow-sm" : "text-mut hover:bg-raise/60"}`}
          >
            <span className={`h-6 w-6 shrink-0 rounded border border-edge ${option.preview}`} />
            <span className="flex flex-col leading-tight">
              <span className="flex items-center gap-1 text-[12.5px] font-medium"><option.icon size={11} />{option.label}</span>
              <span className="text-[10px] text-dim">{option.id === "system" ? "Follow OS" : option.id === "dark" ? "Low light" : "Bright"}</span>
            </span>
          </button>
        ))}
      </div>

      <GroupLabel>Application font</GroupLabel>
      <div className="mb-3 space-y-1">
        {FONTS.map((font) => (
          <button
            key={font.id}
            onClick={() => patch("font", font.id)}
            className={`flex w-full items-center justify-between rounded px-2 py-1.5 text-left transition-colors ${value.font === font.id && !value.dyslexiaFriendly ? "bg-raise" : "hover:bg-raise/70"}`}
          >
            <span className="text-[13.5px] text-fg" style={{ fontFamily: font.css }}>{font.label} · The quick brown fox</span>
            {value.font === font.id && !value.dyslexiaFriendly && <Check size={13} className="text-accent" />}
          </button>
        ))}
      </div>

      <GroupLabel>Layout</GroupLabel>
      <Row label="Density" hint="Compact reduces global spacing; comfortable keeps the default rhythm.">
        <Segment<DensityPreference>
          value={value.density}
          onChange={(density) => patch("density", density)}
          options={[{ id: "comfortable", label: "Comfortable" }, { id: "compact", label: "Compact" }]}
        />
      </Row>
      <Row label={`Text size · ${value.textSize}%`} hint="Scales rem-based text and controls throughout the app.">
        <div className="w-[190px]"><Slider value={value.textSize} onChange={(size) => patch("textSize", size)} min={80} max={140} /></div>
      </Row>

      <GroupLabel>Accessibility</GroupLabel>
      <Row label="Reduce motion" hint="Stops nonessential animation and transition movement.">
        <Toggle label="Reduce motion" on={value.reducedMotion} onChange={(next) => patch("reducedMotion", next)} />
      </Row>
      <Row label="High contrast" hint="Strengthens shared text and separator colors.">
        <Toggle label="High contrast" on={value.highContrast} onChange={(next) => patch("highContrast", next)} />
      </Row>
      <Row label="Dyslexia-friendly font" hint="Uses OpenDyslexic or readable local fallbacks without downloading a font.">
        <Toggle label="Dyslexia-friendly font" on={value.dyslexiaFriendly} onChange={(next) => patch("dyslexiaFriendly", next)} />
      </Row>
      <Row label="Tutor voice captions" hint="Shows a readable live caption while a tutor reply is spoken aloud.">
        <Toggle label="Tutor voice captions" on={value.captions} onChange={(next) => patch("captions", next)} />
      </Row>
      <div className="mt-2 flex items-start gap-2 rounded-md border border-edge bg-card p-2.5 text-[11px] leading-relaxed text-dim">
        <Eye size={14} className="mt-0.5 shrink-0 text-accent" />
        Changes apply to the whole app immediately and are restored before the next page paint.
      </div>
    </div>
  );
}

/* ── AI Tutor & Study ─────────────────────────────────────── */

function TutorAndStudy({ preferences, updatePreferences, onNotify }: {
  preferences: StudyusPreferences;
  updatePreferences: (updater: (current: StudyusPreferences) => StudyusPreferences) => void;
  onNotify: (text: string) => void;
}) {
  const tutor = preferences.tutor;
  const [customName, setCustomName] = useState("");
  const activeStyle = tutor.styles.find((style) => style.id === tutor.activeStyleId) ?? tutor.styles[0];

  const updateTutor = (patch: Partial<typeof tutor>) => updatePreferences((current) => ({
    ...current,
    tutor: { ...current.tutor, ...patch },
  }));
  const updateStyle = (patch: Partial<TutorStylePreference>) => updateTutor({
    styles: tutor.styles.map((style) => style.id === activeStyle.id ? { ...style, ...patch } : style),
  });

  const saveStyle = () => {
    const name = customName.trim();
    if (!name) return onNotify("Give the style a name first");
    const id = `custom-${Date.now()}`;
    updateTutor({ styles: [...tutor.styles, { ...activeStyle, id, name, built: false }], activeStyleId: id });
    setCustomName("");
    onNotify(`Saved tutor style “${name}”`);
  };

  const deleteStyle = (id: string) => {
    const styles = tutor.styles.filter((style) => style.id !== id);
    updateTutor({ styles, activeStyleId: tutor.activeStyleId === id ? (styles[0]?.id ?? "witty") : tutor.activeStyleId });
    onNotify("Tutor style deleted");
  };

  return (
    <div>
      <GroupLabel>Talking style</GroupLabel>
      <div className="mb-3 grid grid-cols-2 gap-1.5 sm:grid-cols-3">
        {tutor.styles.map((style) => (
          <div key={style.id} className="relative">
            <button
              onClick={() => updateTutor({ activeStyleId: style.id })}
              className={`w-full rounded-md border p-2 text-left transition-colors ${tutor.activeStyleId === style.id ? "border-accent bg-accent/[0.08]" : "border-edge bg-card hover:bg-raise"}`}
            >
              <div className="mb-0.5 flex items-center gap-1">{style.built && <Star size={9} className="text-dim" />}<span className="truncate text-[12px] font-medium text-fg">{style.name}</span></div>
              <div className="truncate text-[10.5px] text-dim">{style.tone} · {style.approach}</div>
            </button>
            {!style.built && (
              <button onClick={() => deleteStyle(style.id)} title="Delete style" className="absolute right-1 top-1 grid h-5 w-5 place-items-center rounded text-dim hover:bg-raise hover:text-fg"><X size={10} /></button>
            )}
          </div>
        ))}
      </div>

      <GroupLabel>Customize “{activeStyle.name}”</GroupLabel>
      <Row label="Tone">
        <select value={activeStyle.tone} onChange={(event) => updateStyle({ tone: event.target.value })} className="w-[190px] rounded-md border border-edge bg-ink/35 px-2 py-1 text-[12px] text-fg outline-none">
          {["Playful", "Formal", "Encouraging", "Direct", "Narrative", "Neutral"].map((tone) => <option key={tone}>{tone}</option>)}
        </select>
      </Row>
      <Row label="Problem approach">
        <select value={activeStyle.approach} onChange={(event) => updateStyle({ approach: event.target.value })} className="w-[190px] rounded-md border border-edge bg-ink/35 px-2 py-1 text-[12px] text-fg outline-none">
          {["Analogy-first", "First principles", "Socratic", "Question-led", "Result-first", "Worked example", "History & context"].map((approach) => <option key={approach}>{approach}</option>)}
        </select>
      </Row>
      {([
        ["verbosity", "Verbosity", "Short answers ← → full explanations"],
        ["patience", "Patience", "Straight to it ← → walks with you"],
        ["challenge", "Challenge level", "Gentle ← → keeps pushing"],
        ["humor", "Humor", "Deadpan ← → playful"],
      ] as const).map(([key, label, hint]) => (
        <div key={key} className="rounded-md px-1 py-2">
          <div className="mb-1 flex items-baseline justify-between"><span className="text-[12.5px] text-fg">{label}</span><span className="font-mono text-[11px] text-dim">{activeStyle[key]}</span></div>
          <Slider value={activeStyle[key]} onChange={(value) => updateStyle({ [key]: value })} />
          <div className="mt-0.5 text-[10.5px] text-dim">{hint}</div>
        </div>
      ))}

      <GroupLabel>Preview</GroupLabel>
      <div className="mb-3 rounded-md border border-edge bg-card p-3">
        <div className="mb-1 text-[10px] uppercase tracking-[0.12em] text-dim">AI Response</div>
        <p className="text-[12.5px] italic leading-relaxed text-fg/85">“{activeStyle.preview}”</p>
      </div>
      <div className="mb-3 flex items-center gap-2 rounded-md border border-edge bg-card p-2">
        <input value={customName} onChange={(event) => setCustomName(event.target.value)} placeholder="Save current settings as…" className="min-w-0 flex-1 bg-transparent px-1 text-[12.5px] text-fg outline-none placeholder:text-dim" />
        <button onClick={saveStyle} className="flex items-center gap-1 rounded bg-accent px-2.5 py-1 text-[11.5px] font-medium text-white hover:bg-accent-deep"><Plus size={11} />Save style</button>
      </div>

      <GroupLabel>Session pacing</GroupLabel>
      <Row label={`Session reminder · ${tutor.sessionLength} min`} hint="Studyus reminds you when the preferred session length is reached.">
        <div className="w-[190px]"><Slider value={tutor.sessionLength} onChange={(sessionLength) => updateTutor({ sessionLength })} min={10} max={90} /></div>
      </Row>
      <Row label={`Break reminder · every ${tutor.breakEvery} min`} hint="Active chalkboards show a local break reminder on this interval.">
        <div className="w-[190px]"><Slider value={tutor.breakEvery} onChange={(breakEvery) => updateTutor({ breakEvery })} min={10} max={60} /></div>
      </Row>
      <Row label="Difficulty" hint="Passed to the tutor as a real practice-calibration target.">
        <Segment<TutorDifficulty>
          value={tutor.difficulty}
          onChange={(difficulty) => updateTutor({ difficulty })}
          options={[{ id: "easier", label: "Easier" }, { id: "adaptive", label: "Adaptive" }, { id: "harder", label: "Harder" }]}
        />
      </Row>
      <Row label="Voice replies" hint="Uses this device's speech synthesizer for new tutor responses.">
        <Toggle label="Voice replies" on={tutor.voiceReplies} onChange={(voiceReplies) => updateTutor({ voiceReplies })} />
      </Row>
      <div className="mt-2 rounded-md border border-edge bg-card p-2.5 text-[11px] leading-relaxed text-dim">
        Saved tutor controls are appended to every tutor-agent system prompt. Curriculum grounding and assistance-policy safeguards still take priority.
      </div>
    </div>
  );
}

/* ── Notifications ────────────────────────────────────────── */

const EVENT_LABELS: Record<NotificationEventId, { label: string; hint: string }> = {
  testReady: { label: "Generated test is ready", hint: "Emitted after a test is safely saved; it does not open the test automatically." },
  sessionComplete: { label: "Study session is saved", hint: "Emitted when leaving a chalkboard after its session has been persisted." },
};

function Notifications({ preferences, updatePreferences, onNotify }: {
  preferences: StudyusPreferences;
  updatePreferences: (updater: (current: StudyusPreferences) => StudyusPreferences) => void;
  onNotify: (text: string) => void;
}) {
  const value = preferences.notifications;
  const [permission, setPermission] = useState(() => getDesktopNotificationPermission());
  const channels: { id: NotificationChannel; label: string }[] = [
    { id: "in-app", label: "In-app" },
    { id: "desktop", label: "Desktop" },
    { id: "both", label: "Both" },
  ];

  const updateNotifications = (notifications: typeof value) => updatePreferences((current) => ({ ...current, notifications }));
  const setEvent = (id: NotificationEventId, patch: Partial<(typeof value.events)[NotificationEventId]>) => updateNotifications({
    ...value,
    events: { ...value.events, [id]: { ...value.events[id], ...patch } },
  });
  const chooseChannel = async (channel: NotificationChannel, apply: () => void) => {
    if ((channel === "desktop" || channel === "both") && permission === "default") {
      const next = await requestDesktopNotificationPermission();
      setPermission(next);
      if (next === "denied") onNotify("Desktop notifications were denied; you can still choose In-app");
      if (next === "unsupported") onNotify("Desktop notifications are not supported in this environment");
    }
    apply();
  };

  const testNotification = async () => {
    const channel = value.events.testReady.channel;
    if ((channel === "desktop" || channel === "both") && getDesktopNotificationPermission() === "default") {
      setPermission(await requestDesktopNotificationPermission());
    }
    const delivered = sendNotificationPreview(channel);
    if (delivered === "permission-needed") onNotify("Desktop permission is required before that channel can deliver");
    else if (delivered === "disabled") onNotify("That notification channel is unavailable");
  };

  return (
    <div>
      <GroupLabel>Studyus events</GroupLabel>
      <div className="space-y-1">
        {(Object.keys(EVENT_LABELS) as NotificationEventId[]).map((id) => {
          const rule = value.events[id];
          const copy = EVENT_LABELS[id];
          return (
            <div key={id} className="rounded-md border border-edge bg-card px-2.5 py-2">
              <div className="flex items-center gap-3">
                <Toggle label={copy.label} on={rule.enabled} onChange={(enabled) => setEvent(id, { enabled })} />
                <div className="min-w-0 flex-1"><div className="text-[12.5px] text-fg">{copy.label}</div><div className="text-[10.5px] leading-snug text-dim">{copy.hint}</div></div>
              </div>
              <div className="mt-2 flex justify-end">
                <Segment<NotificationChannel>
                  value={rule.channel}
                  onChange={(channel) => { void chooseChannel(channel, () => setEvent(id, { channel })); }}
                  options={channels}
                />
              </div>
            </div>
          );
        })}
      </div>

      <GroupLabel>Study summary</GroupLabel>
      <Row label="Frequency" hint="Checked while Studyus is running; no server or background push service is implied.">
        <Segment<SummaryCadence>
          value={value.summary.cadence}
          onChange={(cadence) => updateNotifications({ ...value, summary: { ...value.summary, cadence } })}
          options={[{ id: "off", label: "Off" }, { id: "daily", label: "Daily" }, { id: "weekly", label: "Weekly" }, { id: "monthly", label: "Monthly" }]}
        />
      </Row>
      {value.summary.cadence !== "off" && (
        <Row label="Summary delivery">
          <Segment<NotificationChannel>
            value={value.summary.channel}
            onChange={(channel) => { void chooseChannel(channel, () => updateNotifications({ ...value, summary: { ...value.summary, channel } })); }}
            options={channels}
          />
        </Row>
      )}

      <GroupLabel>Desktop permission</GroupLabel>
      <div className="rounded-md border border-edge bg-card p-3">
        <div className="flex items-center gap-2">
          <Bell size={14} className="text-accent" />
          <div className="min-w-0 flex-1 text-[12px] text-fg">Status: <span className="font-medium capitalize">{permission}</span></div>
          {permission === "default" && (
            <button onClick={() => { void requestDesktopNotificationPermission().then(setPermission); }} className="rounded-md border border-edge bg-raise px-2 py-1 text-[11px] text-mut hover:text-fg">Allow</button>
          )}
        </div>
        <button onClick={() => { void testNotification(); }} className="mt-3 w-full rounded-md bg-accent px-3 py-1.5 text-[11.5px] font-medium text-white hover:bg-accent-deep">Send a test notification</button>
      </div>
    </div>
  );
}

/* ── Model configuration ──────────────────────────────────── */

const EMPTY_ENDPOINT: SavedModelEndpoint = {
  id: "",
  label: "",
  provider: "custom",
  baseUrl: "https://",
  model: "",
  keyMasked: "",
  active: false,
};

function Models({ preferences, updatePreferences, onNotify }: {
  preferences: StudyusPreferences;
  updatePreferences: (updater: (current: StudyusPreferences) => StudyusPreferences) => void;
  onNotify: (text: string) => void;
}) {
  const endpoints = preferences.modelEndpoints;
  const [showAdd, setShowAdd] = useState(false);
  const [draft, setDraft] = useState<SavedModelEndpoint>(EMPTY_ENDPOINT);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [boundRoles, setBoundRoles] = useState({ tutor: false, generation: false, evaluator: false });

  const refreshRoles = useCallback(() => {
    void import("../lib/agentRuntime").then(({ getBoundRoles }) => getBoundRoles().then(setBoundRoles)).catch(() => undefined);
  }, []);
  useEffect(refreshRoles, [refreshRoles]);

  const setEndpoints = (modelEndpoints: SavedModelEndpoint[]) => updatePreferences((current) => ({ ...current, modelEndpoints }));

  const commitEndpoint = async () => {
    const label = draft.label.trim();
    const baseUrl = draft.baseUrl.trim();
    const model = draft.model.trim();
    if (!label || !baseUrl || !model) return onNotify("Label, URL and model are required");
    if (!/^https?:\/\//i.test(baseUrl)) return onNotify("Endpoint URL must begin with http:// or https://");

    const id = `ep-${Date.now()}`;
    const key = draft.keyMasked.trim();
    const { storeCredentialLocally } = await import("../lib/llm");
    if (key) storeCredentialLocally(`endpoint_${id}`, key);
    setEndpoints([...endpoints.map((endpoint) => ({ ...endpoint, active: endpoints.length === 0 ? false : endpoint.active })), {
      ...draft,
      id,
      label,
      baseUrl,
      model,
      keyMasked: key ? `••••${key.slice(-4)}` : "not set",
      active: endpoints.length === 0,
    }]);
    setDraft(EMPTY_ENDPOINT);
    setShowAdd(false);
    onNotify(`Saved endpoint “${label}”`);
  };

  const activateEndpoint = (id: string) => setEndpoints(endpoints.map((endpoint) => ({ ...endpoint, active: endpoint.id === id })));

  const removeEndpoint = async (endpoint: SavedModelEndpoint) => {
    if (!window.confirm(`Remove “${endpoint.label}” from saved endpoints? Existing agent-role bindings remain until you replace them.`)) return;
    const { storeCredentialLocally } = await import("../lib/llm");
    storeCredentialLocally(`endpoint_${endpoint.id}`, "");
    const remaining = endpoints.filter((candidate) => candidate.id !== endpoint.id);
    if (remaining.length > 0 && !remaining.some((candidate) => candidate.active)) remaining[0] = { ...remaining[0], active: true };
    setEndpoints(remaining);
    onNotify("Saved endpoint removed; role bindings were left intact");
  };

  const testEndpoint = async (endpoint: SavedModelEndpoint) => {
    setTestingId(endpoint.id);
    try {
      const { getCredentialLocally, testModelEndpoint } = await import("../lib/llm");
      const result = await testModelEndpoint({
        provider: endpoint.provider,
        baseUrl: endpoint.baseUrl,
        modelId: endpoint.model,
        apiKey: getCredentialLocally(`endpoint_${endpoint.id}`) || undefined,
      });
      onNotify(result.reachable && result.modelAvailable
        ? `${endpoint.model} is reachable and returned a compatible response`
        : result.error || "The endpoint did not return a compatible response");
    } finally {
      setTestingId(null);
    }
  };

  const bindAll = async () => {
    const endpoint = endpoints.find((candidate) => candidate.active) ?? endpoints[0];
    if (!endpoint) return onNotify("Add an endpoint first");
    const { bindAllModelRoles, getCredentialLocally } = await import("../lib/llm");
    try {
      await bindAllModelRoles({
        provider: endpoint.provider,
        baseUrl: endpoint.baseUrl,
        modelId: endpoint.model,
        apiKey: getCredentialLocally(`endpoint_${endpoint.id}`) || undefined,
      });
      refreshRoles();
      onNotify(`Bound ${endpoint.label} to all three agent roles`);
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "Could not save model bindings");
    }
  };

  return (
    <div>
      <GroupLabel>Agent roles</GroupLabel>
      <div className="mb-3 space-y-2 rounded-md border border-edge bg-card p-3">
        {([
          ["tutor", "Socratic Tutor Agent", "Chalkboard explanations, diagrams and progressive hints"],
          ["generation", "Test Generation Agent", "Grounded assessment items and rubrics"],
          ["evaluator", "Test Evaluator Agent", "Analytic rubric grading and feedback"],
        ] as const).map(([role, label, desc]) => (
          <div key={role} className="flex items-center justify-between gap-3 border-b border-edge-soft pb-2 last:border-0 last:pb-0">
            <div><div className="text-[12px] font-medium text-fg">{label}</div><div className="text-[10.5px] text-dim">{desc}</div></div>
            <span className={`rounded-full px-2 py-0.5 font-mono text-[10px] ${boundRoles[role] ? "bg-accent/15 text-accent" : "bg-raise text-dim"}`}>{boundRoles[role] ? "Bound" : "Unbound"}</span>
          </div>
        ))}
        <button onClick={() => { void bindAll(); }} className="mt-2 w-full rounded border border-accent/40 bg-accent/15 py-1.5 text-[11.5px] font-medium text-accent hover:bg-accent/25">Assign active endpoint to all three roles</button>
      </div>

      <GroupLabel>Saved endpoints</GroupLabel>
      <div className="mb-2 space-y-1.5">
        {endpoints.length === 0 && <div className="rounded-md border border-dashed border-edge p-4 text-center text-[11.5px] text-dim">No endpoint metadata is saved on this device.</div>}
        {endpoints.map((endpoint) => (
          <div key={endpoint.id} className={`flex items-center gap-2 rounded-md border p-2.5 ${endpoint.active ? "border-accent/60 bg-accent/[0.05]" : "border-edge bg-card"}`}>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5"><span className="truncate text-[12.5px] font-medium text-fg">{endpoint.label}</span>{endpoint.active && <span className="rounded-full bg-accent/15 px-1.5 py-[1px] text-[9.5px] text-accent">Active</span>}</div>
              <div className="truncate font-mono text-[10.5px] text-dim">{endpoint.model} · {endpoint.baseUrl} · {endpoint.keyMasked}</div>
            </div>
            <button disabled={testingId === endpoint.id} onClick={() => { void testEndpoint(endpoint); }} className="rounded-md border border-edge bg-raise px-2 py-1 text-[11px] text-mut hover:text-fg disabled:opacity-50">{testingId === endpoint.id ? "Testing…" : "Test"}</button>
            {!endpoint.active && <button onClick={() => activateEndpoint(endpoint.id)} className="rounded-md border border-edge bg-raise px-2 py-1 text-[11px] text-mut hover:text-fg">Use</button>}
            <button onClick={() => { void removeEndpoint(endpoint); }} title="Remove saved endpoint" className="grid h-6 w-6 place-items-center rounded text-dim hover:bg-raise hover:text-[#e35d50]"><Trash2 size={12} /></button>
          </div>
        ))}
      </div>

      {!showAdd ? (
        <button onClick={() => setShowAdd(true)} className="mb-2 flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-edge py-2 text-[12px] text-mut hover:text-fg"><Plus size={12} />Add OpenAI-compatible endpoint</button>
      ) : (
        <div className="mb-2 space-y-2 rounded-md border border-edge bg-card p-3">
          <div className="flex items-center justify-between"><span className="text-[11.5px] font-medium text-fg">New endpoint</span><button onClick={() => setShowAdd(false)} className="text-dim hover:text-fg"><X size={12} /></button></div>
          <input value={draft.label} onChange={(event) => setDraft((current) => ({ ...current, label: event.target.value }))} placeholder="Label (for example, Local Llama)" className="w-full rounded-md border border-edge bg-ink/35 px-2 py-1.5 text-[12px] text-fg outline-none placeholder:text-dim" />
          <div className="flex gap-2">
            <select value={draft.provider} onChange={(event) => setDraft((current) => ({ ...current, provider: event.target.value as SavedModelEndpoint["provider"] }))} className="w-[110px] rounded-md border border-edge bg-ink/35 px-2 py-1.5 text-[12px] text-fg outline-none"><option value="openai">OpenAI</option><option value="anthropic">Anthropic</option><option value="custom">Custom</option></select>
            <input value={draft.baseUrl} onChange={(event) => setDraft((current) => ({ ...current, baseUrl: event.target.value }))} placeholder="Base URL" className="min-w-0 flex-1 rounded-md border border-edge bg-ink/35 px-2 py-1.5 font-mono text-[11.5px] text-fg outline-none placeholder:text-dim" />
          </div>
          <input value={draft.model} onChange={(event) => setDraft((current) => ({ ...current, model: event.target.value }))} placeholder="Model identifier" className="w-full rounded-md border border-edge bg-ink/35 px-2 py-1.5 font-mono text-[11.5px] text-fg outline-none placeholder:text-dim" />
          <input type="password" value={draft.keyMasked} onChange={(event) => setDraft((current) => ({ ...current, keyMasked: event.target.value }))} placeholder="API key (stored only on this device)" className="w-full rounded-md border border-edge bg-ink/35 px-2 py-1.5 font-mono text-[11.5px] text-fg outline-none placeholder:text-dim" />
          <div className="flex justify-end gap-2"><button onClick={() => setShowAdd(false)} className="px-2.5 py-1 text-[11.5px] text-mut hover:text-fg">Cancel</button><button onClick={() => { void commitEndpoint(); }} className="rounded-md bg-accent px-3 py-1 text-[11.5px] font-medium text-white hover:bg-accent-deep">Save endpoint</button></div>
        </div>
      )}
      <p className="px-1 text-[10.5px] leading-relaxed text-dim">Endpoint metadata and obfuscated key labels persist in preferences. API key values use the existing local credential store and are never included in search or usage displays.</p>
    </div>
  );
}
