import { useEffect, useRef, useState } from "react";
import { Lock, Globe, ChevronDown, Link2, Star, MoreHorizontal, Check } from "lucide-react";

interface Props {
  title: string;
  onNotify: (text: string) => void;
  /** Duplicate the active tab. Wired to the same handler the tab context menu
   *  uses, so both entry points behave identically. */
  onDuplicateTab?: () => void;
  /** Close the active tab. Absent or `canDeleteTab === false` disables the item. */
  onDeleteTab?: () => void;
  /** False when this is the only tab: closing it would leave no tab at all. */
  canDeleteTab?: boolean;
  /** Favourite state, owned by the app so the tab strip can render the star. */
  starred?: boolean;
  onToggleStar?: () => void;
}

export function Toolbar({
  title,
  onNotify,
  onDuplicateTab,
  onDeleteTab,
  canDeleteTab = true,
  starred: starredProp,
  onToggleStar,
}: Props) {
  const [privacyOpen, setPrivacyOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [shared, setShared] = useState(false);
  const [starredLocal, setStarredLocal] = useState(false);
  const starred = starredProp ?? starredLocal;
  const [edited, setEdited] = useState("Edited just now");
  const privacyRef = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (privacyRef.current && !privacyRef.current.contains(e.target as Node)) setPrivacyOpen(false);
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) setMoreOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const ghostBtn =
    "grid h-7 w-7 place-items-center rounded-md text-mut transition-colors hover:bg-white/[0.06] hover:text-fg";

  return (
    <div className="flex h-11 shrink-0 items-center justify-between gap-3 px-4">
      <div className="flex min-w-0 items-center gap-2">
        <h2 className="truncate text-[13px] font-semibold text-fg">{title}</h2>
        <div className="relative" ref={privacyRef}>
          <button
            onClick={() => setPrivacyOpen((v) => !v)}
            className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-dim transition-colors hover:bg-white/[0.06] hover:text-mut"
          >
            {shared ? <Globe size={12} /> : <Lock size={12} />}
            {shared ? "Shared" : "Private"}
            <ChevronDown size={12} className={`transition-transform ${privacyOpen ? "rotate-180" : ""}`} />
          </button>
          {privacyOpen && (
            <div className="anim-toast absolute left-0 top-9 z-30 w-44 rounded-md border border-edge bg-raise p-1 shadow-[0_10px_30px_rgba(0,0,0,0.5)]">
              {[
                { label: "Private", desc: "Only you", icon: Lock, val: false },
                { label: "Shared", desc: "Study group", icon: Globe, val: true },
              ].map((opt) => (
                <button
                  key={opt.label}
                  onClick={() => {
                    setShared(opt.val);
                    setPrivacyOpen(false);
                    setEdited("Edited just now");
                    onNotify(opt.val ? "Shared with your study group" : "Moved back to private");
                  }}
                  className="flex w-full items-center gap-2.5 rounded px-2 py-1.5 text-left transition-colors hover:bg-white/[0.06]"
                >
                  <opt.icon size={14} className="text-mut" />
                  <span className="flex-1">
                    <span className="block text-[13px] text-fg">{opt.label}</span>
                    <span className="block text-[11px] text-dim">{opt.desc}</span>
                  </span>
                  {shared === opt.val && <Check size={13} className="text-accent" />}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center gap-1.5">
        <span className="mr-1 hidden font-mono text-[11px] text-dim sm:block">{edited}</span>
        <button
          onClick={() => {
            onNotify("Share link copied to clipboard");
            setEdited("Edited just now");
          }}
          className="flex items-center gap-1.5 rounded-md border border-edge bg-raise px-2.5 py-1 text-xs font-medium text-fg transition-colors hover:bg-white/[0.09]"
        >
          <Lock size={11} className="text-dim" />
          Share
          <ChevronDown size={11} className="text-dim" />
        </button>
        <button
          className={ghostBtn}
          aria-label="Copy link"
          onClick={() => onNotify("Link copied — send it to a study partner")}
        >
          <Link2 size={15} />
        </button>
        <button
          className={ghostBtn}
          aria-label="Favorite"
          onClick={() => {
            if (onToggleStar) onToggleStar();
            else setStarredLocal((value) => !value);
            onNotify(starred ? "Removed from favorites" : "Added to favorites");
          }}
        >
          <Star size={15} className={starred ? "fill-[#e2b73f] text-[#e2b73f]" : ""} />
        </button>
        <div className="relative" ref={moreRef}>
          <button className={ghostBtn} aria-label="More" onClick={() => setMoreOpen((v) => !v)}>
            <MoreHorizontal size={16} />
          </button>
          {moreOpen && (
            <div className="anim-toast absolute right-0 top-9 z-30 w-48 rounded-md border border-edge bg-raise p-1 shadow-[0_10px_30px_rgba(0,0,0,0.5)]">
              {/* "Export as Markdown" and "Move to archive" used to live here.
                  Both are Past Notes operations — a live session has nothing to
                  archive and its transcript is exported from the note itself —
                  and both were no-op toasts, so they promised work that never
                  happened. */}
              <button
                onClick={() => {
                  setMoreOpen(false);
                  onDuplicateTab?.();
                }}
                className="block w-full rounded px-2.5 py-1.5 text-left text-[13px] text-fg transition-colors hover:bg-white/[0.06]"
              >
                Duplicate session
              </button>
              <button
                onClick={() => {
                  if (!canDeleteTab) return;
                  setMoreOpen(false);
                  onDeleteTab?.();
                }}
                disabled={!canDeleteTab}
                title={canDeleteTab ? undefined : "This is your only tab"}
                className="block w-full rounded px-2.5 py-1.5 text-left text-[13px] text-[#d66a5a] transition-colors hover:bg-white/[0.06] disabled:cursor-not-allowed disabled:text-[#d66a5a]/35 disabled:hover:bg-transparent"
              >
                Delete this tab
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
