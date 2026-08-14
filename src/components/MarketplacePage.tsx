import { useState } from "react";
import { ShoppingCart, Search, UserRound, Download, Star, Sparkles, Lock } from "lucide-react";

const TABS = ["Discover", "Agents", "Curricula", "Consultants", "Connections"] as const;

const CHIPS = [
  "Study Dashboards",
  "Exam Prep",
  "Maths",
  "Physics",
  "Revision Planner",
  "Flashcards",
  "Back to school",
  "Student Life",
];

const CONSULTANTS = [
  { name: "The Organized Notebook", rating: "5.0 (3)", tone: "#6b6136" },
  { name: "The Study Bar", rating: "5.0 (23)", tone: "#2f4763" },
  { name: "Notion State", rating: "5.0 (5)", tone: "#27453a" },
  { name: "Primary Goals", rating: "5.0 (3)", tone: "#5c2f45" },
];

const AGENTS = [
  {
    name: "Exam Coach",
    desc: "Builds a revision plan from your curriculum and drills the weak spots.",
    by: "studyus",
    installs: "2.9K",
  },
  {
    name: "Proof Checker",
    desc: "Reads a written proof line by line and finds the step that does not follow.",
    by: "studyus",
    installs: "1.4K",
  },
  {
    name: "Lab Report Reviewer",
    desc: "Marks a write-up against the criteria your course actually uses.",
    by: "studyus",
    installs: "870",
  },
];

/**
 * The Marketplace, rendered as a full tab.
 *
 * The shelf is drawn for real and then covered by a single overlay saying it is
 * coming. Showing the shape of the thing is the point — an empty page reading
 * "coming soon" tells the learner nothing about what will arrive. Everything
 * beneath the overlay is `inert` and hidden from assistive tech so none of it is
 * reachable or mistakable for a working store.
 */
export function MarketplacePage() {
  const [tab] = useState<(typeof TABS)[number]>("Discover");

  return (
    <div className="relative min-h-0 flex-1 overflow-hidden">
      <div
        className="pointer-events-none absolute inset-0 select-none overflow-hidden blur-[2px]"
        aria-hidden="true"
        inert
      >
        <div className="mx-auto w-full max-w-[1100px] px-6 py-6">
          <div className="mb-5 flex items-center gap-2.5">
            <ShoppingCart size={17} className="text-accent" />
            <span className="text-[15px] font-semibold text-fg">Marketplace</span>
            <div className="ml-auto flex items-center gap-4 text-[12.5px] text-dim">
              <span className="flex items-center gap-1.5">
                <Search size={13} /> Search
              </span>
              <span className="flex items-center gap-1.5">
                <UserRound size={13} /> My profile
              </span>
              <span className="flex items-center gap-1.5">
                <Download size={13} /> Installed
              </span>
            </div>
          </div>

          <div className="mb-4 flex items-center gap-5 border-b border-edge-soft pb-2">
            {TABS.map((item) => (
              <span
                key={item}
                className={`text-[16px] ${item === tab ? "font-semibold text-fg" : "text-dim"}`}
              >
                {item}
              </span>
            ))}
          </div>

          <div className="mb-5 flex flex-wrap gap-2">
            {CHIPS.map((chip) => (
              <span
                key={chip}
                className="rounded-full border border-edge bg-raise px-3 py-1.5 text-[12px] text-mut"
              >
                {chip}
              </span>
            ))}
          </div>

          <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
            <div className="rounded-xl bg-[#1d3557] p-6 lg:col-span-2">
              <span className="flex items-center gap-1.5 text-[12px] text-[#9ec5fe]">
                <Sparkles size={13} /> Agent skills
              </span>
              <p className="mt-3 text-[28px] font-bold leading-tight text-white">
                Bring a specialist to the board
              </p>
              <p className="mt-2 max-w-[46ch] text-[13px] leading-relaxed text-white/70">
                Install agents that already know a syllabus, a marking scheme, or a way of explaining
                that works for you.
              </p>
              <span className="mt-8 inline-block text-[13px] text-white/85">Explore →</span>
            </div>
            <div className="rounded-xl bg-raise p-6">
              <span className="text-[12px] text-dim">Top creator</span>
              <p className="mt-3 text-[24px] font-bold text-fg">Teka</p>
              <p className="mt-2 text-[12.5px] leading-relaxed text-mut">
                Building tools for how students think, revise and remember.
              </p>
              <div className="mt-5 grid h-20 w-20 place-items-center rounded-full bg-white/10 text-[24px] font-bold text-fg">
                T
              </div>
            </div>
          </div>

          <div className="mb-2 flex items-center justify-between">
            <p className="text-[13px] font-medium text-mut">Featured consultants</p>
            <span className="text-[12px] text-dim">Browse all</span>
          </div>
          <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
            {CONSULTANTS.map((item) => (
              <div key={item.name} className="overflow-hidden rounded-xl border border-edge bg-raise">
                <div className="h-28" style={{ background: item.tone }} />
                <div className="flex items-center gap-2 px-3 py-2.5">
                  <span className="min-w-0 flex-1 truncate text-[12.5px] text-fg">{item.name}</span>
                  <span className="flex shrink-0 items-center gap-1 text-[11.5px] text-dim">
                    <Star size={10} className="fill-current" />
                    {item.rating}
                  </span>
                </div>
              </div>
            ))}
          </div>

          <div className="mb-2 flex items-center justify-between">
            <p className="text-[13px] font-medium text-mut">Featured agents</p>
            <span className="text-[12px] text-dim">Browse all</span>
          </div>
          <div className="space-y-2.5">
            {AGENTS.map((item) => (
              <div
                key={item.name}
                className="flex items-start gap-3.5 rounded-xl border border-edge bg-raise p-4"
              >
                <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-accent/20 text-accent">
                  <Sparkles size={18} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[14px] font-medium text-fg">{item.name}</span>
                  <span className="block truncate text-[12.5px] text-mut">{item.desc}</span>
                  <span className="mt-1 flex items-center gap-2 text-[11.5px] text-dim">
                    {item.by} · <Download size={11} /> {item.installs}
                  </span>
                </span>
                <span className="shrink-0 rounded-md border border-edge px-2.5 py-1 text-[12px] text-dim">
                  Free
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* the actual message */}
      <div className="absolute inset-0 grid place-items-center bg-ink/70 px-6 backdrop-blur-[3px]">
        <div className="flex max-w-[40ch] flex-col items-center text-center">
          <Lock size={26} className="mb-4 text-mut" />
          <p className="text-[18px] font-semibold text-fg">Marketplace is coming</p>
          <p className="mt-2 text-[13px] leading-relaxed text-mut">
            Install agents and curricula from the community in a future update. Nothing here is
            purchasable yet.
          </p>
        </div>
      </div>
    </div>
  );
}
