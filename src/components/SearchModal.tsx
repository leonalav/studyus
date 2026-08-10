import { useEffect, useMemo, useRef, useState } from "react";
import {
  Search,
  PanelRight,
  SlidersHorizontal,
  CaseSensitive,
  UserRound,
  FileText,
  ChevronDown,
  Plus,
  CornerDownLeft,
} from "lucide-react";
import { buildSearchIndex, RECENCY_LABEL, type Recency, type SearchItem } from "../data/library";
import { getSettingsSections } from "./SettingsModal";

interface Props {
  open: boolean;
  onClose: () => void;
  onPick: (item: SearchItem) => void;
}

const ORDER: Recency[] = ["today", "past30", "older"];

export function SearchModal({ open, onClose, onPick }: Props) {
  const [q, setQ] = useState("");
  const [titleOnly, setTitleOnly] = useState(false);
  const [cursor, setCursor] = useState(0);
  const [index, setIndex] = useState<SearchItem[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Build the live index (real notes from SQLite + real settings sections)
  // every time the modal opens, so a freshly-saved chalkboard is searchable
  // without a reload. Never falls back to placeholder notes.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void buildSearchIndex(getSettingsSections()).then((items) => {
      if (!cancelled) setIndex(items);
    });
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (open) {
      setQ("");
      setCursor(0);
      window.setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open]);

  const results = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return index;
    return index.filter((item) =>
      titleOnly
        ? item.label.toLowerCase().includes(term)
        : item.label.toLowerCase().includes(term) || item.path.toLowerCase().includes(term)
    );
  }, [q, titleOnly, index]);

  const grouped = useMemo(() => {
    return ORDER.map((bucket) => ({
      bucket,
      items: results.filter((item) => item.recency === bucket),
    })).filter((group) => group.items.length > 0);
  }, [results]);

  const flat = useMemo(() => grouped.flatMap((group) => group.items), [grouped]);

  useEffect(() => {
    setCursor(0);
  }, [q]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setCursor((c) => Math.min(flat.length - 1, c + 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setCursor((c) => Math.max(0, c - 1));
      } else if (e.key === "Enter") {
        e.preventDefault();
        const item = flat[cursor];
        if (item) {
          onPick(item);
          onClose();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, flat, cursor, onClose, onPick]);

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-idx="${cursor}"]`)?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  if (!open) return null;

  let running = -1;

  return (
    <div className="fixed inset-0 z-[80] flex justify-center bg-black/45 px-4 pt-[8vh]" onMouseDown={onClose}>
      <div
        onMouseDown={(e) => e.stopPropagation()}
        className="anim-toast flex h-fit max-h-[74vh] w-[min(600px,100%)] flex-col overflow-hidden rounded-xl border border-[#333] bg-[#1e1e1e] shadow-[0_28px_80px_rgba(0,0,0,0.62)]"
      >
        {/* search row */}
        <div className="flex items-center gap-3 px-4 py-3.5">
          <Search size={17} className="shrink-0 text-mut" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search notes and settings in Studyus…"
            className="min-w-0 flex-1 bg-transparent text-[15px] text-fg outline-none placeholder:text-[#6e6e6c]"
          />
          <button className="grid h-6 w-6 place-items-center rounded text-dim transition-colors hover:bg-white/[0.07] hover:text-fg">
            <PanelRight size={15} />
          </button>
          <button className="grid h-6 w-6 place-items-center rounded-full bg-accent/15 text-accent">
            <SlidersHorizontal size={13} />
          </button>
        </div>

        {/* filter chips */}
        <div className="flex items-center gap-1 border-b border-[#2c2c2c] px-3 pb-2.5">
          <Chip active={titleOnly} onClick={() => setTitleOnly((v) => !v)} icon={<CaseSensitive size={14} />}>
            Title only
          </Chip>
          <Chip icon={<UserRound size={13} />} caret>
            Created by
          </Chip>
          <Chip icon={<FileText size={13} />} caret>
            In
          </Chip>
          <Chip icon={<Plus size={13} />}>Filter</Chip>
        </div>

        {/* results */}
        <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto py-2">
          {flat.length === 0 && (
            <p className="px-4 py-8 text-center text-[13px] text-dim">
              No notes or settings match “{q}”.
            </p>
          )}

          {grouped.map((group) => (
            <div key={group.bucket}>
              <div className="px-4 pb-1 pt-3 text-[11px] font-medium text-dim">
                {RECENCY_LABEL[group.bucket]}
              </div>
              {group.items.map((item) => {
                running += 1;
                const idx = running;
                const selected = idx === cursor;
                return (
                  <button
                    key={item.id}
                    data-idx={idx}
                    onMouseEnter={() => setCursor(idx)}
                    onClick={() => {
                      onPick(item);
                      onClose();
                    }}
                    className={`flex w-full items-center gap-2.5 px-4 py-[7px] text-left transition-colors ${
                      selected ? "bg-white/[0.07]" : "hover:bg-white/[0.04]"
                    }`}
                  >
                    <span className="grid h-[18px] w-[18px] shrink-0 place-items-center rounded-[3px]" style={{ background: `${item.accent}1f`, color: item.accent }}>
                      <FileText size={11} />
                    </span>
                    <span className="truncate text-[13.5px] font-medium text-fg">{item.label}</span>
                    {item.path && (
                      <span className="truncate text-[12.5px] text-dim">— {item.path}</span>
                    )}
                    {selected && <CornerDownLeft size={12} className="ml-auto shrink-0 text-dim" />}
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        {/* footer */}
        <div className="flex items-center gap-4 border-t border-[#2c2c2c] px-4 py-2.5">
          <Hint keys="Ctrl+↵">Open in new tab</Hint>
          <Hint keys="Ctrl+L">Copy link</Hint>
          <Hint keys="Shift+Ctrl+K">Command Search</Hint>
          <button className="ml-auto grid h-6 w-6 place-items-center rounded text-dim transition-colors hover:bg-white/[0.07] hover:text-fg">
            <SlidersHorizontal size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}

function Chip({
  children,
  icon,
  caret,
  active,
  onClick,
}: {
  children: React.ReactNode;
  icon?: React.ReactNode;
  caret?: boolean;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded-md px-2 py-1 text-[12.5px] transition-colors ${
        active ? "bg-white/[0.1] text-fg" : "text-mut hover:bg-white/[0.06] hover:text-fg"
      }`}
    >
      {icon}
      {children}
      {caret && <ChevronDown size={12} className="text-dim" />}
    </button>
  );
}

function Hint({ keys, children }: { keys: string; children: React.ReactNode }) {
  return (
    <span className="flex items-center gap-1.5 text-[11.5px] text-dim">
      <kbd className="font-mono text-[11px] text-mut">{keys}</kbd>
      {children}
    </span>
  );
}
