import {
  Circle,
  MessageSquare,
  PencilLine,
  Settings2,
  LayoutGrid,
  Square,
  Highlighter,
  Eraser,
  Trash2,
  Download,
} from "lucide-react";

export type PanelId = "chat" | "annotate" | "settings" | "threads" | null;
export type PenTool = "pen" | "highlighter" | "eraser";

interface Props {
  active: PanelId;
  onToggle: (p: PanelId) => void;
  recording: boolean;
  onRecord: () => void;
  onExport: () => void;
  threadCount: number;
  onStop: () => void;
  penTool: PenTool;
  setPenTool: (t: PenTool) => void;
  penColor: string;
  setPenColor: (c: string) => void;
  onClearInk: () => void;
  chatCount: number;
}

const PEN_COLORS = ["#f87171", "#fbbf24", "#4ade80", "#60a5fa", "#f9a8d4", "#ffffff"];

export function BoardToolbar({
  active,
  onToggle,
  recording,
  onRecord,
  onExport,
  threadCount,
  onStop,
  penTool,
  setPenTool,
  penColor,
  setPenColor,
  onClearInk,
  chatCount,
}: Props) {
  const item = (
    id: PanelId,
    Icon: typeof MessageSquare,
    label: string,
    badge?: number
  ) => (
    <button
      key={label}
      onClick={() => onToggle(active === id ? null : id)}
      className={`relative flex w-[62px] flex-col items-center gap-1 rounded-md px-1 py-1.5 transition-colors ${
        active === id ? "bg-white/[0.14] text-white" : "text-[#c9c9c7] hover:bg-white/[0.08] hover:text-white"
      }`}
    >
      <Icon size={17} strokeWidth={1.9} />
      <span className="text-[10.5px] font-medium leading-none">{label}</span>
      {badge ? (
        <span className="absolute right-1.5 top-1 grid h-3.5 min-w-3.5 place-items-center rounded-full bg-[#2383e2] px-1 font-mono text-[8.5px] text-white">
          {badge}
        </span>
      ) : null}
    </button>
  );

  return (
    <div className="pointer-events-none absolute left-1/2 top-3 z-40 flex -translate-x-1/2 flex-col items-center gap-1.5">
      {/* main bar */}
      <div className="pointer-events-auto flex items-center gap-0.5 rounded-lg bg-[#1c1c1c]/95 px-1.5 py-1 shadow-[0_10px_34px_rgba(0,0,0,0.55)] ring-1 ring-white/10 backdrop-blur-md">
        <button
          onClick={onRecord}
          className={`flex w-[62px] flex-col items-center gap-1 rounded-md px-1 py-1.5 transition-colors ${
            recording ? "bg-[#c42b1c]/25 text-[#ff6b5e]" : "text-[#c9c9c7] hover:bg-white/[0.08] hover:text-white"
          }`}
        >
          {recording ? (
            <span className="grid h-[17px] place-items-center">
              <span className="h-2.5 w-2.5 animate-pulse rounded-sm bg-[#ff5f56]" />
            </span>
          ) : (
            <Circle size={17} strokeWidth={1.9} />
          )}
          <span className="text-[10.5px] font-medium leading-none">{recording ? "Stop rec" : "Record"}</span>
        </button>

        {item("chat", MessageSquare, "Chat", chatCount)}
        {item("annotate", PencilLine, "Annotate")}
        {item("settings", Settings2, "Settings")}
        {item("threads", LayoutGrid, "Threads", threadCount)}

        <span className="mx-1 h-8 w-px bg-white/10" />

        <button
          onClick={onExport}
          className="flex w-[62px] flex-col items-center gap-1 rounded-md px-1 py-1.5 text-[#c9c9c7] transition-colors hover:bg-white/[0.08] hover:text-white"
        >
          <Download size={17} strokeWidth={1.9} />
          <span className="text-[10.5px] font-medium leading-none">Export</span>
        </button>
        <button
          onClick={onStop}
          className="flex w-[62px] flex-col items-center gap-1 rounded-md px-1 py-1.5 text-[#c9c9c7] transition-colors hover:bg-white/[0.08] hover:text-white"
        >
          <Square size={16} strokeWidth={1.9} />
          <span className="text-[10.5px] font-medium leading-none">Leave</span>
        </button>
      </div>

      {recording && (
        <div className="pointer-events-auto flex items-center gap-1.5 rounded bg-[#1f7a3d]/80 px-2 py-0.5 text-[10px] font-medium text-white">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" />
          Sharing
        </div>
      )}

      {/* annotate sub-bar */}
      {active === "annotate" && (
        <div className="anim-toast pointer-events-auto flex items-center gap-1 rounded-lg bg-[#1c1c1c]/95 px-2 py-1.5 shadow-[0_10px_34px_rgba(0,0,0,0.55)] ring-1 ring-white/10 backdrop-blur-md">
          {(
            [
              ["pen", PencilLine, "Pen"],
              ["highlighter", Highlighter, "Highlight"],
              ["eraser", Eraser, "Erase"],
            ] as [PenTool, typeof PencilLine, string][]
          ).map(([id, Icon, label]) => (
            <button
              key={id}
              onClick={() => setPenTool(id)}
              title={label}
              className={`grid h-7 w-7 place-items-center rounded transition-colors ${
                penTool === id ? "bg-white/20 text-white" : "text-[#c9c9c7] hover:bg-white/10 hover:text-white"
              }`}
            >
              <Icon size={15} />
            </button>
          ))}
          <span className="mx-1 h-5 w-px bg-white/12" />
          {PEN_COLORS.map((c) => (
            <button
              key={c}
              onClick={() => setPenColor(c)}
              className={`h-5 w-5 rounded-full transition-transform ${penColor === c ? "scale-110 ring-2 ring-white" : "hover:scale-105"}`}
              style={{ background: c }}
              aria-label={`Color ${c}`}
            />
          ))}
          <span className="mx-1 h-5 w-px bg-white/12" />
          <button
            onClick={onClearInk}
            title="Clear ink"
            className="grid h-7 w-7 place-items-center rounded text-[#c9c9c7] transition-colors hover:bg-white/10 hover:text-white"
          >
            <Trash2 size={15} />
          </button>
        </div>
      )}
    </div>
  );
}
