import { useEffect, useState } from "react";
import { ShoppingCart, Search, UserRound, Download, Star, Sparkles, X } from "lucide-react";

interface Props {
  open: boolean;
  onClose: () => void;
}

const TABS = ["Discover", "Agents", "Curricula", "Consultants", "Connections"] as const;

const CHIPS = [
  "Study Dashboards",
  "Exam Prep",
  "Maths",
  "Physics",
  "Revision Planner",
  "Flashcards",
  "Back to school",
];

const CONSULTANTS = [
  { name: "The Organized Notebook", rating: "5.0 (3)", tone: "#6b6136" },
  { name: "The Study Bar", rating: "5.0 (23)", tone: "#2f4763" },
  { name: "Notion State", rating: "5.0 (5)", tone: "#27453a" },
  { name: "Primary Goals", rating: "5.0 (3)", tone: "#5c2f45" },
];

const AGENTS = [
  { name: "Exam Coach", desc: "Builds a revision plan from your curriculum and drills the weak spots.", by: "studyus", installs: "2.9K" },
  { name: "Proof Checker", desc: "Reads a written proof line by line and finds the step that does not follow.", by: "studyus", installs: "1.4K" },
];

/**
 * The Marketplace.
 *
 * The shelf is rendered for real — tabs, filter chips, featured rows — and then
 * covered by a single overlay saying it is coming. Showing the shape of the
 * thing is the point: an empty modal reading "coming soon" tells the learner
 * nothing about what will arrive. Everything beneath the overlay is inert and
 * hidden from assistive tech, so nothing here is mistaken for a working store.
 */
export function MarketplaceModal({ open, onClose }: Props) {
  const [tab, setTab] = useState<(typeof TABS)[number]>("Discover");

  useEffect(() => {
    if (!open) return;
    setTab("Discover");
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[80] flex justify-center bg-black/45 px-4 pt-[6vh]"
      onMouseDown={onClose}
    >
      <div
        onMouseDown={(e) => e.stopPropagation()}
        className="anim-toast relative flex h-fit max-h-[80vh] w-[min(920px,100%)] flex-col overflow-hidden rounded-xl border border-edge bg-panel shadow-[0_28px_80px_rgba(0,0,0,0.45)]"
      >
        {/* header stays above the overlay so the modal can always be closed */}
        <div className="relative z-20 flex items-center gap-2.5 border-b border-edge-soft bg-panel px-4 py-3">
          <ShoppingCart size={16} className="shrink-0 text-accent" />
          <span className="text-[14.5px] font-semibold text-fg">Marketplace</span>
          <span className="rounded-full bg-white/[0.07] px-2 py-[2px] font-mono text-[9.5px] uppercase tracking-wider text-dim">
            Preview
          </span>
          <div className="ml-auto flex items-center gap-1">
            <span className="hidden items-center gap-1.5 rounded-md px-2 py-1 text-[12px] text-dim sm:flex">
              <Search size={13} /> Search
            </span>
            <span className="hidden items-center gap-1.5 rounded-md px-2 py-1 text-[12px] text-dim sm:flex">
              <UserRound size={13} /> My profile
            </span>
            <button
              onClick={onClose}
              className="grid h-6 w-6 shrink-0 place-items-center rounded text-dim transition-colors hover:bg-white/[0.07] hover:text-fg"
              aria-label="Close marketplace"
            >
              <X size={15} />
            </button>
          </div>
        </div>

        <div className="relative min-h-0 flex-1">
          {/* ── the shelf, shown only to communicate what is coming ── */}
          <div
            className="pointer-events-none max-h-[62vh] select-none overflow-hidden p-4 blur-[1.5px]"
            aria-hidden="true"
            inert
          >
            <div className="mb-3 flex items-center gap-4">
              {TABS.map((item) => (
                <span
                  key={item}
                  className={`text-[15px] ${item === tab ? "font-semibold text-fg" : "text-dim"}`}
                >
                  {item}
                </span>
              ))}
            </div>

            <div className="mb-4 flex flex-wrap gap-1.5">
              {CHIPS.map((chip) => (
                <span
                  key={chip}
                  className="rounded-full border border-edge bg-raise px-2.5 py-1 text-[11.5px] text-mut"
                >
                  {chip}
                </span>
              ))}
            </div>

            <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="rounded-lg bg-[#1d3557] p-4 sm:col-span-2">
                <span className="flex items-center gap-1.5 text-[11.5px] text-[#9ec5fe]">
                  <Sparkles size={12} /> Agent skills
                </span>
                <p className="mt-2 text-[22px] font-bold leading-tight text-white">
                  Bring a specialist to the board
                </p>
                <p className="mt-1.5 max-w-[42ch] text-[12.5px] leading-relaxed text-white/70">
                  Install agents that already know a syllabus, a marking scheme, or a way of
                  explaining that works for you.
                </p>
                <span className="mt-4 inline-block text-[12.5px] text-white/85">Explore →</span>
              </div>
              <div className="rounded-lg bg-raise p-4">
                <span className="text-[11.5px] text-dim">Top creator</span>
                <p className="mt-2 text-[19px] font-bold text-fg">Teka</p>
                <p className="mt-1.5 text-[12px] leading-relaxed text-mut">
                  Building tools for how students think, revise and remember.
                </p>
                <div className="mt-3 grid h-16 w-16 place-items-center rounded-full bg-white/10 text-[19px] font-bold text-fg">
                  T
                </div>
              </div>
            </div>

            <p className="mb-2 text-[12px] font-medium text-mut">Featured consultants</p>
            <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {CONSULTANTS.map((item) => (
                <div key={item.name} className="overflow-hidden rounded-lg border border-edge bg-raise">
                  <div className="h-20" style={{ background: item.tone }} />
                  <div className="px-2.5 py-2">
                    <p className="truncate text-[12px] text-fg">{item.name}</p>
                    <p className="flex items-center gap-1 text-[11px] text-dim">
                      <Star size={10} className="fill-current" />
                      {item.rating}
                    </p>
                  </div>
                </div>
              ))}
            </div>

            <p className="mb-2 text-[12px] font-medium text-mut">Featured agents</p>
            <div className="space-y-2">
              {AGENTS.map((item) => (
                <div key={item.name} className="flex items-start gap-3 rounded-lg border border-edge bg-raise p-3">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-accent/20 text-accent">
                    <Sparkles size={16} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] font-medium text-fg">{item.name}</span>
                    <span className="block truncate text-[12px] text-mut">{item.desc}</span>
                    <span className="mt-0.5 flex items-center gap-2 text-[11px] text-dim">
                      {item.by} · <Download size={10} /> {item.installs}
                    </span>
                  </span>
                  <span className="shrink-0 rounded-md border border-edge px-2 py-1 text-[11px] text-dim">
                    Free
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* ── the actual message ── */}
          <div className="absolute inset-0 z-10 grid place-items-center bg-panel/80 px-6 backdrop-blur-[3px]">
            <div className="max-w-[38ch] text-center">
              <span className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-full border border-edge bg-raise text-accent">
                <ShoppingCart size={20} />
              </span>
              <p className="text-[16px] font-semibold text-fg">Marketplace is coming</p>
              <p className="mt-1.5 text-[12.5px] leading-relaxed text-mut">
                Install agents and curricula from the community in a future update. Nothing here is
                purchasable yet.
              </p>
              <button
                onClick={onClose}
                className="mt-4 rounded-md border border-edge bg-raise px-3 py-1.5 text-[12.5px] text-fg transition-colors hover:bg-white/[0.09]"
              >
                Back to studying
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
