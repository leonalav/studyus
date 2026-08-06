import { PanelLeft, ChevronLeft, ChevronRight, Plus, Minus, Square, X } from "lucide-react";

export interface Tab {
  id: string;
  title: string;
  kind: "board" | "curriculum" | "test" | "note";
}

interface Props {
  tabs: Tab[];
  activeTabId: string;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  onNewTab: () => void;
  onToggleSidebar: () => void;
  onNotify: (text: string) => void;
}

export function TopBar({
  tabs,
  activeTabId,
  onSelectTab,
  onCloseTab,
  onNewTab,
  onToggleSidebar,
  onNotify,
}: Props) {
  const iconBtn =
    "grid h-7 w-7 place-items-center rounded-md text-mut transition-colors hover:bg-white/[0.06] hover:text-fg";
  return (
    <div className="flex h-10 shrink-0 items-center gap-1 border-b border-edge-soft bg-panel pl-2 pr-0">
      <button className={iconBtn} onClick={onToggleSidebar} title="Toggle sidebar" aria-label="Toggle sidebar">
        <PanelLeft size={16} />
      </button>
      <button className={iconBtn} onClick={() => onNotify("Nothing behind you — stay focused.")} aria-label="Back">
        <ChevronLeft size={16} />
      </button>
      <button className={iconBtn} onClick={() => onNotify("You're at the latest point.")} aria-label="Forward">
        <ChevronRight size={16} />
      </button>

      <div className="relative ml-2 flex h-10 min-w-0 flex-1 items-end overflow-hidden">
        <div className="flex h-full min-w-0 flex-1 items-end gap-0.5 overflow-hidden pr-1">
          {tabs.map((tab) => {
            const active = tab.id === activeTabId;
            const dotColor =
              tab.kind === "curriculum"
                ? "bg-[#fcd34d]"
                : tab.kind === "test"
                ? "bg-[#a5b4fc]"
                : tab.kind === "note"
                ? "bg-[#86efac]"
                : "bg-accent";
            return (
              <div
                key={tab.id}
                onClick={() => onSelectTab(tab.id)}
                className={`group flex h-10 min-w-[50px] max-w-[200px] flex-1 cursor-pointer items-center gap-1.5 rounded-t-md px-2.5 text-[12.5px] transition-all overflow-hidden ${
                  active
                    ? "border-x border-t border-edge-soft bg-ink font-medium text-fg"
                    : "text-mut hover:bg-white/[0.04] hover:text-fg"
                }`}
                title={tab.title}
              >
                <span className={`h-2 w-2 shrink-0 rounded-full ${dotColor}`} />
                <span className="min-w-0 flex-1 truncate text-ellipsis">
                  {tab.title}
                </span>
                {tabs.length > 1 && (
                  <button
                    className="ml-auto grid h-4 w-4 shrink-0 place-items-center rounded text-dim opacity-0 transition-opacity group-hover:opacity-100 hover:bg-white/[0.12] hover:text-fg"
                    onClick={(e) => {
                      e.stopPropagation();
                      onCloseTab(tab.id);
                    }}
                    aria-label={`Close ${tab.title}`}
                  >
                    <X size={12} />
                  </button>
                )}
              </div>
            );
          })}
        </div>
        {/* the + is a fixed 36px-wide sibling anchored to the right of the tab strip */}
        <button
          className="grid h-10 w-8 shrink-0 place-items-center self-end text-dim transition-colors hover:bg-white/[0.06] hover:text-fg"
          onClick={onNewTab}
          aria-label="New tab"
          title="New tab"
        >
          <Plus size={15} />
        </button>
      </div>

      <div className="ml-auto flex shrink-0 items-center">
        <button className={iconBtn} onClick={() => onNotify("Minimized. (Not really.)")} aria-label="Minimize">
          <Minus size={15} />
        </button>
        <button className={iconBtn} onClick={() => onNotify("Already full focus.")} aria-label="Maximize">
          <Square size={12} />
        </button>
        <button
          className={`${iconBtn} hover:bg-[#c42b1c]! hover:text-white!`}
          onClick={() => onNotify("Studyus isn't going anywhere.")}
          aria-label="Close"
        >
          <X size={15} />
        </button>
      </div>
    </div>
  );
}
