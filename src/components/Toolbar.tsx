import { useEffect, useRef, useState } from "react";
import { Lock, Globe, ChevronDown, Link2, Star, MoreHorizontal, Check } from "lucide-react";

interface Props {
  title: string;
  onNotify: (text: string) => void;
}

export function Toolbar({ title, onNotify }: Props) {
  const [privacyOpen, setPrivacyOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [shared, setShared] = useState(false);
  const [starred, setStarred] = useState(false);
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
            setStarred((s) => !s);
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
              {["Duplicate session", "Export as Markdown", "Move to archive", "Delete"].map((label, i) => (
                <button
                  key={label}
                  onClick={() => {
                    setMoreOpen(false);
                    onNotify(i === 3 ? "Too destructive for a demo — kept." : `${label} — done`);
                  }}
                  className={`block w-full rounded px-2.5 py-1.5 text-left text-[13px] transition-colors hover:bg-white/[0.06] ${
                    i === 3 ? "text-[#d66a5a]" : "text-fg"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
