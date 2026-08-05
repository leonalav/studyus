import { Play } from "lucide-react";
import { historyFor } from "../data/curriculum";
import { THEMES } from "./board/Chalkboard";

interface Props {
  title: string;
  onContinue: () => void;
}

export function NoteHistoryView({ title, onContinue }: Props) {
  const h = historyFor(title);
  const board = THEMES[0];

  return (
    <div className="relative">
      <div className="mx-auto w-full max-w-[820px] px-5 pt-10 pb-28">
        <div className="mb-2 font-mono text-[10px] uppercase tracking-wider text-dim">Saved note</div>
        <h1 className="mb-1 text-[36px] font-bold leading-tight tracking-tight text-fg">{h.title}</h1>
        <p className="mb-6 font-mono text-[11.5px] text-dim">
          {h.subject} · {h.when} · {h.duration} · {h.boards} board{h.boards === 1 ? "" : "s"}
        </p>

        {/* the chalkboard as it was written */}
        <div
          className="overflow-hidden rounded-lg border border-edge"
          style={{ background: board.bg }}
        >
          <div className="flex items-center justify-between border-b border-white/10 px-4 py-2">
            <span className="font-mono text-[10px] uppercase tracking-wider text-white/45">
              Chalkboard · saved state
            </span>
            <span className="font-mono text-[10px] text-white/35">read-only</span>
          </div>
          <div
            className="space-y-4 px-7 py-7"
            style={{ color: board.chalk, fontFamily: "'Gloria Hallelujah', cursive" }}
          >
            {h.lines.map((line, i) => (
              <p
                key={i}
                className="anim-chalk leading-relaxed"
                style={{
                  fontSize: i === 0 ? 30 : 18,
                  animationDelay: `${Math.min(i, 6) * 60}ms`,
                  opacity: i === 0 ? 1 : 0.92,
                }}
              >
                {line}
              </p>
            ))}
          </div>
        </div>

        <p className="mt-4 text-[12.5px] text-dim">
          This is exactly what the tutor wrote during the session. Continue to reopen the live chalkboard and keep going.
        </p>
      </div>

      {/* floating continue */}
      <button
        onClick={onContinue}
        className="anim-toast fixed bottom-7 left-1/2 z-40 flex -translate-x-1/2 items-center gap-2 rounded-full border border-white/12 bg-[#1c1c1c]/95 py-2.5 pl-3.5 pr-4 shadow-[0_16px_44px_rgba(0,0,0,0.5)] backdrop-blur-md transition-transform hover:scale-[1.02] active:scale-95"
      >
        <span className="grid h-6 w-6 place-items-center rounded-full bg-accent text-white">
          <Play size={11} fill="currentColor" />
        </span>
        <span className="text-[13px] font-medium text-fg">Continue session</span>
        <span className="font-mono text-[10.5px] text-dim">{h.subject.split(" · ")[1] ?? h.subject}</span>
      </button>
    </div>
  );
}
