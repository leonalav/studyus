import { useEffect, useState } from "react";
import {
  Settings,
  ChevronRight,
  ArrowLeft,
  ChevronUp,
  ChevronDown,
  CornerDownLeft,
  Sun,
  Moon,
  MonitorSmartphone,
  Check,
  X,
  Plus,
  Trash2,
  Star,
} from "lucide-react";

interface Props {
  open: boolean;
  onClose: () => void;
  onNotify: (t: string) => void;
  /** Section to land on when opened (e.g. routed from search). Defaults to root. */
  initialSection?: Section;
}

type Section = "root" | "about" | "appearance" | "tutor" | "notifications" | "models";

const SECTIONS: { id: Section; label: string; desc: string }[] = [
  { id: "about", label: "About me", desc: "Account, usage and AI credits" },
  { id: "appearance", label: "Appearance", desc: "Theme, font, density and accessibility" },
  { id: "tutor", label: "AI Tutor & Study", desc: "How the tutor talks and approaches problems" },
  { id: "notifications", label: "Notifications", desc: "Reminders, streaks and summaries" },
  { id: "models", label: "Model configuration", desc: "Official models or your own endpoints" },
];

/** Exposes the real settings catalog to the search index, minus the synthetic
 *  "root" entry. Used by buildSearchIndex so search rows map 1:1 to a section
 *  the Settings modal can actually open. */
export function getSettingsSections(): { id: string; label: string; desc: string }[] {
  return SECTIONS.map((s) => ({ id: s.id, label: s.label, desc: s.desc }));
}

/* ══════════════════════════════════════════════════════════════
   NOTIFICATIONS
   ══════════════════════════════════════════════════════════════ */

type Channel = "Silent" | "In-app" | "Email";
interface NotifRowT {
  id: string;
  label: string;
  on: boolean;
  channel: Channel;
}
const GENERAL: NotifRowT[] = [
  { id: "mention", label: "I'm mentioned in a study group", on: true, channel: "In-app" },
  { id: "reply", label: "Someone replies to my note", on: true, channel: "Email" },
  { id: "assigned", label: "I'm assigned a practice set", on: true, channel: "In-app" },
  { id: "overdue", label: "A study goal is overdue", on: true, channel: "Email" },
];
const SUMMARY: NotifRowT[] = [
  { id: "daily", label: "Daily summary", on: false, channel: "In-app" },
  { id: "weekly", label: "Weekly summary", on: true, channel: "In-app" },
  { id: "monthly", label: "Monthly summary", on: true, channel: "Email" },
];

/* ══════════════════════════════════════════════════════════════
   APPEARANCE
   ══════════════════════════════════════════════════════════════ */

type Theme = "dark" | "light" | "system";
type Density = "comfortable" | "compact";
type SysFont = "system" | "inter" | "grotesk" | "serif" | "mono";
const SYS_FONTS: { id: SysFont; label: string; css: string }[] = [
  { id: "system", label: "System default", css: "system-ui, sans-serif" },
  { id: "inter", label: "Inter", css: "Inter, system-ui, sans-serif" },
  { id: "grotesk", label: "Space Grotesk", css: "'Space Grotesk', sans-serif" },
  { id: "serif", label: "Serif", css: "'Iowan Old Style', Georgia, serif" },
  { id: "mono", label: "Mono", css: "'Space Mono', ui-monospace, monospace" },
];

/* ══════════════════════════════════════════════════════════════
   AI TUTOR + STUDY
   ══════════════════════════════════════════════════════════════ */

interface TutorStyle {
  id: string;
  name: string;
  tone: string;
  approach: string;
  verbosity: number;
  patience: number;
  challenge: number;
  humor: number;
  preview: string;
  built?: boolean;
}

const PRESETS: TutorStyle[] = [
  {
    id: "witty",
    name: "Witty",
    tone: "Playful",
    approach: "Analogy-first",
    verbosity: 40,
    patience: 60,
    challenge: 55,
    humor: 85,
    preview: "So an orbit is really the universe's oldest running joke: you keep falling and keep missing the ground.",
    built: true,
  },
  {
    id: "professor",
    name: "Professor",
    tone: "Formal",
    approach: "First principles",
    verbosity: 80,
    patience: 70,
    challenge: 65,
    humor: 15,
    preview: "Let us begin with the definition. An orbit is the trajectory produced when gravitational acceleration balances the required centripetal acceleration.",
    built: true,
  },
  {
    id: "coach",
    name: "Coach",
    tone: "Encouraging",
    approach: "Socratic",
    verbosity: 55,
    patience: 90,
    challenge: 75,
    humor: 30,
    preview: "You've got this. Before I say anything, tell me: what has to be true for something to keep circling instead of falling straight down?",
    built: true,
  },
  {
    id: "socratic",
    name: "Socratic",
    tone: "Neutral",
    approach: "Question-led",
    verbosity: 45,
    patience: 85,
    challenge: 80,
    humor: 20,
    preview: "Interesting. What would happen if we doubled the radius — do you expect the speed to go up or down, and why?",
    built: true,
  },
  {
    id: "concise",
    name: "Concise",
    tone: "Direct",
    approach: "Result-first",
    verbosity: 20,
    patience: 40,
    challenge: 50,
    humor: 10,
    preview: "v = √(GM/r). Halves when r quadruples. Substitute your numbers, then verify units.",
    built: true,
  },
  {
    id: "storyteller",
    name: "Storyteller",
    tone: "Narrative",
    approach: "History & context",
    verbosity: 75,
    patience: 65,
    challenge: 45,
    humor: 55,
    preview: "In 1687 Newton pictured a cannon on a tall mountain. Fire it fast enough and the ball never lands — that's an orbit, and that image is where we start.",
    built: true,
  },
];

/* ══════════════════════════════════════════════════════════════
   MODELS
   ══════════════════════════════════════════════════════════════ */

interface Endpoint {
  id: string;
  label: string;
  provider: "openai" | "anthropic" | "custom";
  baseUrl: string;
  model: string;
  keyMasked: string;
  active: boolean;
}
/* No preset endpoints — the list is populated from bindings the user actually
   configures. The "studyus" provider does not exist as a real service. */
const DEFAULT_ENDPOINTS: Endpoint[] = [];

/* ══════════════════════════════════════════════════════════════
   MODAL
   ══════════════════════════════════════════════════════════════ */

export function SettingsModal({ open, onClose, onNotify, initialSection }: Props) {
  const [section, setSection] = useState<Section>("root");
  const [q, setQ] = useState("");

  // notifications
  const [general, setGeneral] = useState(GENERAL);
  const [summary, setSummary] = useState(SUMMARY);

  // appearance
  const [theme, setTheme] = useState<Theme>("dark");
  const [sysFont, setSysFont] = useState<SysFont>("grotesk");
  const [density, setDensity] = useState<Density>("comfortable");
  const [textSize, setTextSize] = useState(100);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [highContrast, setHighContrast] = useState(false);
  const [dyslexic, setDyslexic] = useState(false);
  const [captions, setCaptions] = useState(true);

  // tutor & study
  const [styles, setStyles] = useState<TutorStyle[]>(PRESETS);
  const [activeStyleId, setActiveStyleId] = useState("witty");
  const activeStyle = styles.find((s) => s.id === activeStyleId) ?? styles[0];
  const [customName, setCustomName] = useState("");
  const [sessionLen, setSessionLen] = useState(30);
  const [breakEvery, setBreakEvery] = useState(20);
  const [difficulty, setDifficulty] = useState<"easier" | "adaptive" | "harder">("adaptive");
  const [voice, setVoice] = useState(false);
  const [autoNotes, setAutoNotes] = useState(true);

  // models
  const [endpoints, setEndpoints] = useState<Endpoint[]>(DEFAULT_ENDPOINTS);
  const [showAdd, setShowAdd] = useState(false);
  const [draft, setDraft] = useState<Endpoint>({
    id: "",
    label: "",
    provider: "custom",
    baseUrl: "https://",
    model: "",
    keyMasked: "",
    active: false,
  });

  // Which agent roles actually have a bound endpoint (from the DB).
  const [boundRoles, setBoundRoles] = useState<{ tutor: boolean; generation: boolean; evaluator: boolean }>({
    tutor: false,
    generation: false,
    evaluator: false,
  });
  const refreshBoundRoles = () => {
    void import("../lib/agentRuntime").then((m) => m.getBoundRoles().then(setBoundRoles));
  };
  useEffect(() => {
    if (open) refreshBoundRoles();
  }, [open]);

  useEffect(() => {
    if (open) {
      setSection(initialSection && initialSection !== "root" ? initialSection : "root");
      setQ("");
    }
  }, [open, initialSection]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        if (section === "root") onClose();
        else setSection("root");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, section, onClose]);

  if (!open) return null;

  const sectionMeta = SECTIONS.find((s) => s.id === section);
  const inRoot = section === "root";

  const updateStyle = (patch: Partial<TutorStyle>) => {
    setStyles((list) => list.map((s) => (s.id === activeStyleId ? { ...s, ...patch } : s)));
  };

  const saveStyle = () => {
    const trimmed = customName.trim();
    if (!trimmed) {
      onNotify("Give the style a name first");
      return;
    }
    const id = `custom-${Date.now()}`;
    setStyles((list) => [...list, { ...activeStyle, id, name: trimmed, built: false }]);
    setActiveStyleId(id);
    setCustomName("");
    onNotify(`Saved style "${trimmed}"`);
  };

  const deleteStyle = (id: string) => {
    setStyles((list) => list.filter((s) => s.id !== id));
    if (activeStyleId === id) setActiveStyleId("witty");
    onNotify("Style deleted");
  };

  const commitEndpoint = () => {
    if (!draft.label.trim() || !draft.baseUrl.trim() || !draft.model.trim()) {
      onNotify("Label, URL and model are required");
      return;
    }
    const id = `ep-${Date.now()}`;
    const key = draft.keyMasked.trim();
    // Store the real key under the endpoint id; the list only ever holds a mask
    // so the key never round-trips through UI state.
    if (key) {
      void import("../lib/llm").then((m) => m.storeCredentialLocally(`endpoint_${id}`, key));
    }
    const keyMasked = key ? `sk-••••${key.slice(-4)}` : "not set";
    setEndpoints((list) => [...list, { ...draft, id, keyMasked, active: list.length === 0 }]);
    setDraft({ id: "", label: "", provider: "custom", baseUrl: "https://", model: "", keyMasked: "", active: false });
    setShowAdd(false);
    refreshBoundRoles();
    onNotify(`Added endpoint "${draft.label}"`);
  };

  const activateEndpoint = (id: string) => {
    setEndpoints((list) => list.map((e) => ({ ...e, active: e.id === id })));
  };
  const removeEndpoint = (id: string) => {
    setEndpoints((list) => list.filter((e) => e.id !== id));
  };

  return (
    <div className="fixed inset-0 z-[80] flex justify-center bg-black/50 px-4 pt-[8vh]" onMouseDown={onClose}>
      <div
        onMouseDown={(e) => e.stopPropagation()}
        className="anim-toast flex h-fit max-h-[80vh] w-[min(560px,100%)] flex-col overflow-hidden rounded-xl border border-[#3a3a3a] bg-[#252525]/97 shadow-[0_28px_80px_rgba(0,0,0,0.6)] backdrop-blur-xl"
      >
        {/* breadcrumb */}
        <div className="flex items-center gap-2 border-b border-white/[0.07] px-3.5 py-2.5">
          <Settings size={13} className="text-mut" />
          <button
            onClick={() => setSection("root")}
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
            className="ml-auto grid h-6 w-6 place-items-center rounded text-dim transition-colors hover:bg-white/[0.07] hover:text-fg"
          >
            <X size={13} />
          </button>
        </div>

        {/* search / back */}
        <div className="flex items-center gap-2 border-b border-white/[0.07] px-3.5 py-2">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={sectionMeta ? `Search in ${sectionMeta.label}` : "Search settings"}
            className="min-w-0 flex-1 bg-transparent py-1 text-[13px] text-fg outline-none placeholder:text-[#6e6e6c]"
          />
          {!inRoot && (
            <button
              onClick={() => setSection("root")}
              className="flex shrink-0 items-center gap-1.5 rounded-md border border-white/10 bg-white/[0.07] px-2 py-1 text-[11.5px] text-mut transition-colors hover:bg-white/[0.12] hover:text-fg"
            >
              <ArrowLeft size={11} />
              Back
            </button>
          )}
        </div>

        {/* body */}
        <div className="min-h-0 flex-1 overflow-y-auto px-3.5 py-3">
          {inRoot && (
            <div className="space-y-0.5">
              {SECTIONS.filter((s) => s.label.toLowerCase().includes(q.trim().toLowerCase())).map((s) => (
                <button
                  key={s.id}
                  onClick={() => setSection(s.id)}
                  className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left transition-colors hover:bg-white/[0.06]"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] text-fg">{s.label}</span>
                    <span className="block truncate text-[11.5px] text-dim">{s.desc}</span>
                  </span>
                  <ChevronRight size={13} className="text-dim" />
                </button>
              ))}
            </div>
          )}

          {section === "about" && <AboutMe onNotify={onNotify} />}
          {section === "appearance" && (
            <Appearance
              theme={theme}
              setTheme={setTheme}
              sysFont={sysFont}
              setSysFont={setSysFont}
              density={density}
              setDensity={setDensity}
              textSize={textSize}
              setTextSize={setTextSize}
              reducedMotion={reducedMotion}
              setReducedMotion={setReducedMotion}
              highContrast={highContrast}
              setHighContrast={setHighContrast}
              dyslexic={dyslexic}
              setDyslexic={setDyslexic}
              captions={captions}
              setCaptions={setCaptions}
            />
          )}
          {section === "tutor" && (
            <TutorAndStudy
              styles={styles}
              activeStyle={activeStyle}
              activeStyleId={activeStyleId}
              setActiveStyleId={setActiveStyleId}
              updateStyle={updateStyle}
              customName={customName}
              setCustomName={setCustomName}
              saveStyle={saveStyle}
              deleteStyle={deleteStyle}
              sessionLen={sessionLen}
              setSessionLen={setSessionLen}
              breakEvery={breakEvery}
              setBreakEvery={setBreakEvery}
              difficulty={difficulty}
              setDifficulty={setDifficulty}
              voice={voice}
              setVoice={setVoice}
              autoNotes={autoNotes}
              setAutoNotes={setAutoNotes}
            />
          )}
          {section === "notifications" && (
            <Notifications
              general={general}
              summary={summary}
              setGeneral={setGeneral}
              setSummary={setSummary}
              q={q}
            />
          )}
          {section === "models" && (
            <Models
              endpoints={endpoints}
              activateEndpoint={activateEndpoint}
              removeEndpoint={removeEndpoint}
              showAdd={showAdd}
              setShowAdd={setShowAdd}
              draft={draft}
              setDraft={setDraft}
              commitEndpoint={commitEndpoint}
              boundRoles={boundRoles}
              refreshBoundRoles={refreshBoundRoles}
              onNotify={onNotify}
            />
          )}
        </div>

        {/* footer */}
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

/* ── shared bits ──────────────────────────────────────────── */

function Key({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="grid h-[18px] min-w-[18px] place-items-center rounded border border-white/10 bg-white/[0.07] px-1 font-mono text-[10px] text-mut">
      {children}
    </kbd>
  );
}

function GroupLabel({ children }: { children: React.ReactNode }) {
  return <div className="mb-1.5 mt-3 px-1 text-[11.5px] font-medium uppercase tracking-wide text-dim first:mt-0">{children}</div>;
}

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
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

function Segment<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { id: T; label: React.ReactNode; icon?: typeof Sun }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex items-center gap-0.5 rounded-md bg-black/25 p-0.5">
      {options.map((opt) => (
        <button
          key={opt.id}
          onClick={() => onChange(opt.id)}
          className={`flex items-center gap-1.5 rounded px-2 py-[3px] text-[11px] transition-colors ${
            value === opt.id ? "bg-white/[0.16] text-fg" : "text-dim hover:text-mut"
          }`}
        >
          {opt.icon && <opt.icon size={11} />}
          {opt.label}
        </button>
      ))}
    </div>
  );
}

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!on)}
      className={`h-[18px] w-[32px] shrink-0 rounded-full p-[2px] transition-colors ${on ? "bg-accent" : "bg-[#4a4a48]"}`}
    >
      <span className={`block h-[14px] w-[14px] rounded-full bg-white transition-transform ${on ? "translate-x-[14px]" : ""}`} />
    </button>
  );
}

function Slider({ value, onChange, min = 0, max = 100 }: { value: number; onChange: (v: number) => void; min?: number; max?: number }) {
  return (
    <input
      type="range"
      min={min}
      max={max}
      value={value}
      onChange={(e) => onChange(parseInt(e.target.value, 10))}
      className="w-full accent-accent"
    />
  );
}

/* ── ABOUT ME ─────────────────────────────────────────────── */

function AboutMe({ onNotify }: { onNotify: (t: string) => void }) {
  const used = 720;
  const total = 1000;
  const pct = Math.round((used / total) * 100);

  const topups = [
    { credits: 500, price: 4, per: "$0.008/credit" },
    { credits: 2000, price: 12, per: "$0.006/credit", popular: true },
    { credits: 6000, price: 30, per: "$0.005/credit" },
  ];

  return (
    <div>
      <GroupLabel>Account</GroupLabel>
      <div className="mb-3 flex items-center gap-3 rounded-md border border-white/8 bg-white/[0.03] p-3">
        <div className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-accent/25 text-[16px] font-semibold text-accent">
          AR
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13.5px] font-medium text-fg">Ave Ravke</div>
          <div className="truncate text-[11.5px] text-dim">ave@studyus.ai · Pro plan · joined Mar 2025</div>
        </div>
        <button
          onClick={() => onNotify("Profile — coming up")}
          className="rounded-md border border-white/10 bg-white/[0.07] px-2.5 py-1 text-[11.5px] text-mut transition-colors hover:bg-white/[0.12] hover:text-fg"
        >
          Edit
        </button>
      </div>

      <Row label="Full name">
        <input
          defaultValue="Ave Ravke"
          className="w-[180px] rounded-md border border-white/10 bg-black/25 px-2 py-1 text-[12.5px] text-fg outline-none"
        />
      </Row>
      <Row label="Email">
        <input
          defaultValue="ave@studyus.ai"
          className="w-[180px] rounded-md border border-white/10 bg-black/25 px-2 py-1 text-[12.5px] text-fg outline-none"
        />
      </Row>
      <Row label="Timezone">
        <select className="w-[180px] rounded-md border border-white/10 bg-black/25 px-2 py-1 text-[12.5px] text-fg outline-none">
          <option>Pacific — Los Angeles</option>
          <option>Mountain — Denver</option>
          <option>Central — Chicago</option>
          <option>Eastern — New York</option>
        </select>
      </Row>

      <GroupLabel>AI usage this month</GroupLabel>
      <div className="mb-3 rounded-md border border-white/8 bg-white/[0.03] p-3">
        <div className="mb-2 flex items-baseline justify-between">
          <div>
            <div className="text-[16px] font-semibold text-fg">
              {used.toLocaleString()} <span className="text-[12px] font-normal text-dim">/ {total.toLocaleString()} credits</span>
            </div>
            <div className="text-[11.5px] text-dim">Resets in 12 days · Pro plan includes 1,000 credits/mo</div>
          </div>
          <span className="rounded-full bg-accent/15 px-2 py-0.5 text-[11px] font-medium text-accent">{pct}%</span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-white/8">
          <div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2 text-center">
          {[
            { label: "Chalkboards", val: 42 },
            { label: "Quizzes", val: 18 },
            { label: "Practice", val: 61 },
          ].map((m) => (
            <div key={m.label} className="rounded-md bg-black/25 py-2">
              <div className="text-[15px] font-semibold text-fg">{m.val}</div>
              <div className="text-[10.5px] text-dim">{m.label}</div>
            </div>
          ))}
        </div>
      </div>

      <GroupLabel>Top up · pay as you go</GroupLabel>
      <div className="mb-3 grid grid-cols-3 gap-2">
        {topups.map((t) => (
          <button
            key={t.credits}
            onClick={() => onNotify(`Charged $${t.price} for ${t.credits.toLocaleString()} credits`)}
            className={`relative rounded-md border p-3 text-left transition-colors ${
              t.popular ? "border-accent bg-accent/[0.08] hover:bg-accent/[0.12]" : "border-white/10 bg-white/[0.03] hover:bg-white/[0.06]"
            }`}
          >
            {t.popular && (
              <span className="absolute -top-2 right-2 rounded-full bg-accent px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-white">
                Popular
              </span>
            )}
            <div className="text-[15px] font-semibold text-fg">${t.price}</div>
            <div className="text-[12px] text-mut">{t.credits.toLocaleString()} credits</div>
            <div className="mt-1 text-[10.5px] text-dim">{t.per}</div>
          </button>
        ))}
      </div>
      <Row label="Auto-refill when low" hint="Buy 2,000 credits when balance drops below 100">
        <Toggle on={false} onChange={() => onNotify("Auto-refill toggled")} />
      </Row>

      <GroupLabel>Danger zone</GroupLabel>
      <button
        onClick={() => onNotify("Type your email in the confirm dialog to proceed")}
        className="w-full rounded-md border border-[#c42b1c]/40 bg-[#c42b1c]/10 py-2 text-[12.5px] font-medium text-[#ff8b80] transition-colors hover:bg-[#c42b1c]/20"
      >
        Delete account
      </button>
    </div>
  );
}

/* ── APPEARANCE ───────────────────────────────────────────── */

function Appearance(props: {
  theme: Theme;
  setTheme: (t: Theme) => void;
  sysFont: SysFont;
  setSysFont: (f: SysFont) => void;
  density: Density;
  setDensity: (d: Density) => void;
  textSize: number;
  setTextSize: (n: number) => void;
  reducedMotion: boolean;
  setReducedMotion: (b: boolean) => void;
  highContrast: boolean;
  setHighContrast: (b: boolean) => void;
  dyslexic: boolean;
  setDyslexic: (b: boolean) => void;
  captions: boolean;
  setCaptions: (b: boolean) => void;
}) {
  const { theme, setTheme, sysFont, setSysFont, density, setDensity, textSize, setTextSize,
    reducedMotion, setReducedMotion, highContrast, setHighContrast, dyslexic, setDyslexic, captions, setCaptions } = props;

  return (
    <div>
      <GroupLabel>Theme</GroupLabel>
      <div className="mb-3 flex items-center gap-1 rounded-lg bg-black/25 p-1">
        {(
          [
            { id: "dark", label: "Dark", icon: Moon, preview: "bg-[#191919]" },
            { id: "light", label: "Light", icon: Sun, preview: "bg-[#f4f4f2]" },
            { id: "system", label: "System", icon: MonitorSmartphone, preview: "bg-gradient-to-br from-[#191919] to-[#f4f4f2]" },
          ] as const
        ).map((opt) => (
          <button
            key={opt.id}
            onClick={() => setTheme(opt.id)}
            className={`flex flex-1 items-center gap-2 rounded-md px-2 py-2 text-left transition-colors ${
              theme === opt.id ? "bg-white/[0.14] text-fg" : "text-mut hover:bg-white/[0.06] hover:text-fg"
            }`}
          >
            <span className={`h-6 w-6 shrink-0 rounded border border-white/12 ${opt.preview}`} />
            <span className="flex flex-col leading-tight">
              <span className="flex items-center gap-1 text-[12.5px] font-medium">
                <opt.icon size={11} /> {opt.label}
              </span>
              <span className="text-[10px] text-dim">
                {opt.id === "system" ? "Follow OS" : opt.id === "dark" ? "Default" : "Bright"}
              </span>
            </span>
          </button>
        ))}
      </div>

      <GroupLabel>System font</GroupLabel>
      <div className="mb-3 space-y-1">
        {SYS_FONTS.map((f) => (
          <button
            key={f.id}
            onClick={() => setSysFont(f.id)}
            className={`flex w-full items-center justify-between rounded px-2 py-1.5 text-left transition-colors ${
              sysFont === f.id ? "bg-white/[0.09]" : "hover:bg-white/[0.06]"
            }`}
          >
            <span className="text-[13.5px] text-fg" style={{ fontFamily: f.css }}>
              {f.label} · The quick brown fox
            </span>
            {sysFont === f.id && <Check size={13} className="text-accent" />}
          </button>
        ))}
      </div>

      <GroupLabel>Layout</GroupLabel>
      <Row label="Density" hint="Comfortable is roomier; compact fits more.">
        <Segment
          value={density}
          onChange={setDensity}
          options={[
            { id: "comfortable", label: "Comfortable" },
            { id: "compact", label: "Compact" },
          ]}
        />
      </Row>
      <Row label={`Text size · ${textSize}%`}>
        <div className="w-[180px]">
          <Slider value={textSize} onChange={setTextSize} min={80} max={140} />
        </div>
      </Row>

      <GroupLabel>Accessibility</GroupLabel>
      <Row label="Reduce motion" hint="Cut animations and transitions">
        <Toggle on={reducedMotion} onChange={setReducedMotion} />
      </Row>
      <Row label="High contrast" hint="Stronger separators and text">
        <Toggle on={highContrast} onChange={setHighContrast} />
      </Row>
      <Row label="Dyslexia-friendly font" hint="Uses OpenDyslexic where available">
        <Toggle on={dyslexic} onChange={setDyslexic} />
      </Row>
      <Row label="Captions on tutor voice" hint="Always show what the tutor says">
        <Toggle on={captions} onChange={setCaptions} />
      </Row>
    </div>
  );
}

/* ── TUTOR & STUDY ────────────────────────────────────────── */

function TutorAndStudy(props: {
  styles: TutorStyle[];
  activeStyle: TutorStyle;
  activeStyleId: string;
  setActiveStyleId: (id: string) => void;
  updateStyle: (patch: Partial<TutorStyle>) => void;
  customName: string;
  setCustomName: (s: string) => void;
  saveStyle: () => void;
  deleteStyle: (id: string) => void;
  sessionLen: number;
  setSessionLen: (n: number) => void;
  breakEvery: number;
  setBreakEvery: (n: number) => void;
  difficulty: "easier" | "adaptive" | "harder";
  setDifficulty: (d: "easier" | "adaptive" | "harder") => void;
  voice: boolean;
  setVoice: (b: boolean) => void;
  autoNotes: boolean;
  setAutoNotes: (b: boolean) => void;
}) {
  const { styles, activeStyle, activeStyleId, setActiveStyleId, updateStyle,
    customName, setCustomName, saveStyle, deleteStyle,
    sessionLen, setSessionLen, breakEvery, setBreakEvery, difficulty, setDifficulty,
    voice, setVoice, autoNotes, setAutoNotes } = props;

  const tones = ["Playful", "Formal", "Encouraging", "Direct", "Narrative", "Neutral"];
  const approaches = ["Analogy-first", "First principles", "Socratic", "Question-led", "Result-first", "Worked example", "History & context"];

  return (
    <div>
      <GroupLabel>Talking style</GroupLabel>
      <div className="mb-3 grid grid-cols-3 gap-1.5">
        {styles.map((s) => (
          <div key={s.id} className="relative">
            <button
              onClick={() => setActiveStyleId(s.id)}
              className={`w-full rounded-md border p-2 text-left transition-colors ${
                activeStyleId === s.id ? "border-accent bg-accent/[0.08]" : "border-white/8 bg-white/[0.03] hover:bg-white/[0.06]"
              }`}
            >
              <div className="mb-0.5 flex items-center gap-1">
                {s.built && <Star size={9} className="text-dim" />}
                <span className="truncate text-[12px] font-medium text-fg">{s.name}</span>
              </div>
              <div className="truncate text-[10.5px] text-dim">
                {s.tone} · {s.approach}
              </div>
            </button>
            {!s.built && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  deleteStyle(s.id);
                }}
                className="absolute right-1 top-1 grid h-4 w-4 place-items-center rounded text-dim opacity-0 transition-opacity hover:bg-white/[0.1] hover:text-fg group-hover:opacity-100"
                style={{ opacity: 1 }}
                title="Delete style"
              >
                <X size={10} />
              </button>
            )}
          </div>
        ))}
      </div>

      <GroupLabel>Customize “{activeStyle.name}”</GroupLabel>
      <Row label="Tone">
        <select
          value={activeStyle.tone}
          onChange={(e) => updateStyle({ tone: e.target.value })}
          className="w-[180px] rounded-md border border-white/10 bg-black/25 px-2 py-1 text-[12.5px] text-fg outline-none"
        >
          {tones.map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
      </Row>
      <Row label="Problem approach">
        <select
          value={activeStyle.approach}
          onChange={(e) => updateStyle({ approach: e.target.value })}
          className="w-[180px] rounded-md border border-white/10 bg-black/25 px-2 py-1 text-[12.5px] text-fg outline-none"
        >
          {approaches.map((a) => (
            <option key={a}>{a}</option>
          ))}
        </select>
      </Row>

      {[
        { key: "verbosity", label: "Verbosity", hint: "Short answers ← → full explanations" },
        { key: "patience", label: "Patience", hint: "Straight to it ← → walks with you" },
        { key: "challenge", label: "Challenge level", hint: "Gentle ← → keeps pushing" },
        { key: "humor", label: "Humor", hint: "Deadpan ← → playful" },
      ].map((slider) => (
        <div key={slider.key} className="rounded-md px-1 py-2">
          <div className="mb-1 flex items-baseline justify-between">
            <span className="text-[12.5px] text-fg">{slider.label}</span>
            <span className="font-mono text-[11px] text-dim">{(activeStyle as any)[slider.key]}</span>
          </div>
          <Slider
            value={(activeStyle as any)[slider.key]}
            onChange={(v) => updateStyle({ [slider.key]: v } as Partial<TutorStyle>)}
          />
          <div className="mt-0.5 text-[10.5px] text-dim">{slider.hint}</div>
        </div>
      ))}

      <GroupLabel>Preview</GroupLabel>
      <div className="mb-3 rounded-md border border-white/8 bg-white/[0.03] p-3">
        <div className="mb-1 text-[10px] uppercase tracking-[0.12em] text-dim">AI Response</div>
        <p className="text-[12.5px] italic leading-relaxed text-fg/85">“{activeStyle.preview}”</p>
      </div>

      <div className="mb-3 flex items-center gap-2 rounded-md border border-white/8 bg-white/[0.03] p-2">
        <input
          value={customName}
          onChange={(e) => setCustomName(e.target.value)}
          placeholder="Save current settings as…"
          className="min-w-0 flex-1 bg-transparent px-1 text-[12.5px] text-fg outline-none placeholder:text-[#6e6e6c]"
        />
        <button
          onClick={saveStyle}
          className="flex items-center gap-1 rounded bg-accent px-2.5 py-1 text-[11.5px] font-medium text-white transition-colors hover:bg-accent-deep"
        >
          <Plus size={11} />
          Save style
        </button>
      </div>

      <GroupLabel>Session pacing</GroupLabel>
      <Row label={`Session length · ${sessionLen} min`}>
        <div className="w-[180px]"><Slider value={sessionLen} onChange={setSessionLen} min={10} max={90} /></div>
      </Row>
      <Row label={`Break every · ${breakEvery} min`}>
        <div className="w-[180px]"><Slider value={breakEvery} onChange={setBreakEvery} min={10} max={60} /></div>
      </Row>
      <Row label="Difficulty" hint="How hard the practice problems get">
        <Segment
          value={difficulty}
          onChange={setDifficulty}
          options={[
            { id: "easier", label: "Easier" },
            { id: "adaptive", label: "Adaptive" },
            { id: "harder", label: "Harder" },
          ]}
        />
      </Row>
      <Row label="Voice replies" hint="Read tutor answers aloud">
        <Toggle on={voice} onChange={setVoice} />
      </Row>
      <Row label="Auto-notes" hint="Collect key points on every session">
        <Toggle on={autoNotes} onChange={setAutoNotes} />
      </Row>
    </div>
  );
}

/* ── NOTIFICATIONS ────────────────────────────────────────── */

function Notifications({
  general,
  summary,
  setGeneral,
  setSummary,
  q,
}: {
  general: NotifRowT[];
  summary: NotifRowT[];
  setGeneral: React.Dispatch<React.SetStateAction<NotifRowT[]>>;
  setSummary: React.Dispatch<React.SetStateAction<NotifRowT[]>>;
  q: string;
}) {
  const term = q.trim().toLowerCase();
  const filter = (rows: NotifRowT[]) => (term ? rows.filter((r) => r.label.toLowerCase().includes(term)) : rows);

  const setRow = (list: "g" | "s", id: string, patch: Partial<NotifRowT>) => {
    const apply = (rows: NotifRowT[]) => rows.map((r) => (r.id === id ? { ...r, ...patch } : r));
    if (list === "g") setGeneral(apply);
    else setSummary(apply);
  };

  const channels: Channel[] = ["Silent", "In-app", "Email"];

  const render = (rows: NotifRowT[], key: "g" | "s") =>
    rows.map((r) => (
      <div key={r.id} className="flex items-center gap-3 rounded-md px-1 py-1.5">
        <Toggle on={r.on} onChange={(v) => setRow(key, r.id, { on: v })} />
        <span className="min-w-0 flex-1 truncate text-[12.5px] text-fg">{r.label}</span>
        <div className="flex shrink-0 items-center gap-0.5 rounded-md bg-black/25 p-0.5">
          {channels.map((c) => (
            <button
              key={c}
              onClick={() => setRow(key, r.id, { channel: c })}
              className={`rounded px-2 py-[3px] text-[11px] transition-colors ${
                r.channel === c ? "bg-white/[0.16] text-fg" : "text-dim hover:text-mut"
              }`}
            >
              {c}
            </button>
          ))}
        </div>
      </div>
    ));

  return (
    <div>
      <GroupLabel>General notifications</GroupLabel>
      <div className="mb-2 space-y-1">{render(filter(general), "g")}</div>
      <GroupLabel>Summary notifications</GroupLabel>
      <div className="space-y-1">{render(filter(summary), "s")}</div>
    </div>
  );
}

/* ── MODELS ───────────────────────────────────────────────── */

function Models({
  endpoints,
  activateEndpoint,
  removeEndpoint,
  showAdd,
  setShowAdd,
  draft,
  setDraft,
  commitEndpoint,
  boundRoles,
  refreshBoundRoles,
  onNotify,
}: {
  endpoints: Endpoint[];
  activateEndpoint: (id: string) => void;
  removeEndpoint: (id: string) => void;
  showAdd: boolean;
  setShowAdd: (b: boolean) => void;
  draft: Endpoint;
  setDraft: React.Dispatch<React.SetStateAction<Endpoint>>;
  commitEndpoint: () => void;
  boundRoles: { tutor: boolean; generation: boolean; evaluator: boolean };
  refreshBoundRoles: () => void;
  onNotify: (t: string) => void;
}) {
  return (
    <div>
      <GroupLabel>Three Assignable Agent Roles</GroupLabel>
      <div className="mb-3 space-y-2 rounded-md border border-white/8 bg-white/[0.03] p-3">
        {[
          { role: "tutor" as const, label: "Role 1: Socratic Tutor Agent", desc: "Chalkboard explanations, diagrams, progressive hints" },
          { role: "generation" as const, label: "Role 2: Test Generation Agent", desc: "Creates grounded assessment items & rubrics" },
          { role: "evaluator" as const, label: "Role 3: Test Evaluator Agent", desc: "Analytic rubric grading & explanation gate evaluation" },
        ].map((r) => (
          <div key={r.role} className="flex items-center justify-between border-b border-white/6 pb-2 last:border-0 last:pb-0">
            <div>
              <div className="text-[12px] font-medium text-fg">{r.label}</div>
              <div className="text-[10.5px] text-dim">{r.desc}</div>
            </div>
            <span
              className={`rounded-full px-2 py-0.5 font-mono text-[10px] ${
                boundRoles[r.role] ? "bg-accent/15 text-accent" : "bg-white/8 text-dim"
              }`}
            >
              {boundRoles[r.role] ? "Bound" : "Unbound"}
            </span>
          </div>
        ))}

        <button
          onClick={() => {
            const activeEp = endpoints.find((e) => e.active) || endpoints[0];
            if (!activeEp) {
              onNotify("Add an endpoint first");
              return;
            }
            void import("../lib/llm").then((m) => {
              const apiKey = m.getCredentialLocally(`endpoint_${activeEp.id}`);
              m.bindAllModelRoles({
                provider: activeEp.provider as any,
                baseUrl: activeEp.baseUrl,
                modelId: activeEp.model,
                apiKey: apiKey || undefined,
              }).then(() => {
                refreshBoundRoles();
                onNotify(`Bound ${activeEp.label} to all 3 roles`);
              });
            });
          }}
          className="w-full mt-2 rounded bg-accent/20 border border-accent/40 py-1.5 text-[11.5px] font-medium text-accent hover:bg-accent/30 transition-colors"
        >
          Single action: Assign active model to all 3 roles
        </button>
      </div>

      <GroupLabel>Saved endpoints</GroupLabel>
      <div className="mb-2 space-y-1.5">
        {endpoints.map((e) => (
          <div
            key={e.id}
            className={`flex items-center gap-2 rounded-md border p-2.5 transition-colors ${
              e.active ? "border-accent/60 bg-accent/[0.05]" : "border-white/8 bg-white/[0.03]"
            }`}
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="truncate text-[12.5px] font-medium text-fg">{e.label}</span>
                {e.active && (
                  <span className="rounded-full bg-accent/20 px-1.5 py-[1px] text-[9.5px] font-medium text-accent">
                    Active
                  </span>
                )}
              </div>
              <div className="truncate font-mono text-[10.5px] text-dim">
                {e.model} · {e.baseUrl} · key: {e.keyMasked}
              </div>
            </div>
            <button
              onClick={() => {
                void import("../lib/llm").then((m) => {
                  m.testModelEndpoint({
                    provider: e.provider as any,
                    baseUrl: e.baseUrl,
                    modelId: e.model,
                    apiKey: m.getCredentialLocally(`endpoint_${e.id}`) || undefined,
                  }).then((res) => {
                    if (res.reachable && res.modelAvailable) {
                      alert(`Test connection success: Model ${e.model} is reachable and available.`);
                    } else {
                      alert(`Test connection failure: ${res.error || "Could not reach endpoint."}`);
                    }
                  });
                });
              }}
              className="shrink-0 rounded-md border border-white/10 bg-white/[0.07] px-2 py-1 text-[11px] text-mut transition-colors hover:bg-white/[0.12] hover:text-fg"
            >
              Test
            </button>
            {!e.active && (
              <button
                onClick={() => activateEndpoint(e.id)}
                className="shrink-0 rounded-md border border-white/10 bg-white/[0.07] px-2 py-1 text-[11px] text-mut transition-colors hover:bg-white/[0.12] hover:text-fg"
              >
                Use
              </button>
            )}
            <button
                onClick={() => removeEndpoint(e.id)}
                className="shrink-0 grid h-6 w-6 place-items-center rounded text-dim transition-colors hover:bg-white/[0.07] hover:text-[#ff8b80]"
                title="Remove endpoint"
              >
                <Trash2 size={12} />
              </button>
          </div>
        ))}
      </div>

      {!showAdd ? (
        <button
          onClick={() => setShowAdd(true)}
          className="mb-2 flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-white/12 py-2 text-[12px] text-mut transition-colors hover:border-white/20 hover:text-fg"
        >
          <Plus size={12} />
          Add OpenAI-compatible endpoint
        </button>
      ) : (
        <div className="mb-2 space-y-2 rounded-md border border-white/10 bg-white/[0.03] p-3">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-[11.5px] font-medium text-fg">New endpoint</span>
            <button
              onClick={() => setShowAdd(false)}
              className="grid h-5 w-5 place-items-center rounded text-dim hover:bg-white/[0.07] hover:text-fg"
            >
              <X size={11} />
            </button>
          </div>
          <input
            value={draft.label}
            onChange={(e) => setDraft((d) => ({ ...d, label: e.target.value }))}
            placeholder="Label (e.g. My local Llama)"
            className="w-full rounded-md border border-white/10 bg-black/25 px-2 py-1.5 text-[12px] text-fg outline-none placeholder:text-[#6e6e6c]"
          />
          <div className="flex gap-2">
            <select
              value={draft.provider}
              onChange={(e) => setDraft((d) => ({ ...d, provider: e.target.value as Endpoint["provider"] }))}
              className="w-[110px] rounded-md border border-white/10 bg-black/25 px-2 py-1.5 text-[12px] text-fg outline-none"
            >
              <option value="openai">OpenAI</option>
              <option value="anthropic">Anthropic</option>
              <option value="custom">Custom</option>
            </select>
            <input
              value={draft.baseUrl}
              onChange={(e) => setDraft((d) => ({ ...d, baseUrl: e.target.value }))}
              placeholder="Base URL"
              className="min-w-0 flex-1 rounded-md border border-white/10 bg-black/25 px-2 py-1.5 font-mono text-[11.5px] text-fg outline-none placeholder:text-[#6e6e6c]"
            />
          </div>
          <input
            value={draft.model}
            onChange={(e) => setDraft((d) => ({ ...d, model: e.target.value }))}
            placeholder="Model identifier"
            className="w-full rounded-md border border-white/10 bg-black/25 px-2 py-1.5 font-mono text-[11.5px] text-fg outline-none placeholder:text-[#6e6e6c]"
          />
          <input
            type="password"
            value={draft.keyMasked}
            onChange={(e) => setDraft((d) => ({ ...d, keyMasked: e.target.value }))}
            placeholder="API key"
            className="w-full rounded-md border border-white/10 bg-black/25 px-2 py-1.5 font-mono text-[11.5px] text-fg outline-none placeholder:text-[#6e6e6c]"
          />
          <div className="flex items-center justify-end gap-2">
            <button
              onClick={() => setShowAdd(false)}
              className="rounded-md px-2.5 py-1 text-[11.5px] text-mut hover:text-fg"
            >
              Cancel
            </button>
            <button
              onClick={commitEndpoint}
              className="rounded-md bg-accent px-3 py-1 text-[11.5px] font-medium text-white transition-colors hover:bg-accent-deep"
            >
              Save endpoint
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
