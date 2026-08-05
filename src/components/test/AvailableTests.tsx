import { useState } from "react";
import { Play } from "lucide-react";
import { AVAILABLE_TESTS, SUBJECT_LIST } from "../../data/curriculum";

export function AvailableTests({ onNotify }: { onNotify: (t: string) => void }) {
  const [filter, setFilter] = useState<"all" | "new" | "in-progress" | "completed">("all");
  const rows = AVAILABLE_TESTS.filter((t) => filter === "all" || t.status === filter);

  const statusStyle = (s: string) =>
    s === "new"
      ? { bg: "rgba(125,211,252,0.14)", fg: "#7dd3fc", label: "New" }
      : s === "in-progress"
      ? { bg: "rgba(252,211,77,0.14)", fg: "#fcd34d", label: "In progress" }
      : { bg: "rgba(134,239,172,0.14)", fg: "#86efac", label: "Completed" };

  return (
    <div className="mx-auto w-full max-w-[820px] px-5 pt-10 pb-16">
      <div className="mb-2 font-mono text-[10px] uppercase tracking-wider text-dim">Testing & Practice</div>
      <h1 className="mb-1 text-[36px] font-bold leading-tight tracking-tight text-fg">Available tests</h1>
      <p className="mb-6 text-[13.5px] text-dim">
        Assigned and saved exams, with everything you've already finished.
      </p>

      <div className="mb-5 grid grid-cols-3 gap-2">
        {[
          { label: "Pending", val: AVAILABLE_TESTS.filter((t) => t.status !== "completed").length, color: "text-fg" },
          { label: "Completed", val: AVAILABLE_TESTS.filter((t) => t.status === "completed").length, color: "text-[#86efac]" },
          {
            label: "Average score",
            val: `${Math.round(
              AVAILABLE_TESTS.filter((t) => t.score).reduce((n, t) => n + (t.score ?? 0), 0) /
                Math.max(1, AVAILABLE_TESTS.filter((t) => t.score).length)
            )}%`,
            color: "text-[#fcd34d]",
          },
        ].map((m) => (
          <div key={m.label} className="rounded-md border border-edge bg-raise p-3">
            <div className={`text-[18px] font-semibold ${m.color}`}>{m.val}</div>
            <div className="text-[11px] text-dim">{m.label}</div>
          </div>
        ))}
      </div>

      <div className="mb-3 flex items-center gap-1.5">
        {(["all", "new", "in-progress", "completed"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`rounded-full border px-2.5 py-1 text-[11.5px] capitalize transition-colors ${
              filter === f ? "border-accent bg-accent/15 text-fg" : "border-edge bg-raise text-mut hover:text-fg"
            }`}
          >
            {f === "all" ? "All" : f.replace("-", " ")}
          </button>
        ))}
      </div>

      <div className="space-y-2">
        {rows.map((t) => {
          const st = statusStyle(t.status);
          const subject = SUBJECT_LIST.find((s) => s.id === t.subject);
          return (
            <div key={t.id} className="flex items-center gap-3 rounded-md border border-edge bg-raise p-3">
              <span className="h-9 w-1 shrink-0 rounded-full" style={{ background: subject?.accent }} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-[13.5px] font-medium text-fg">{t.title}</span>
                  <span
                    className="shrink-0 rounded-full px-1.5 py-[1px] text-[9.5px] font-medium"
                    style={{ background: st.bg, color: st.fg }}
                  >
                    {st.label}
                  </span>
                </div>
                <div className="truncate font-mono text-[10.5px] text-dim">
                  {subject?.label} · {t.questions} questions · {t.format} · {t.rigor} · {t.due}
                </div>
              </div>
              {t.score !== undefined ? (
                <span className="shrink-0 font-mono text-[15px] font-semibold text-[#86efac]">{t.score}%</span>
              ) : (
                <button
                  onClick={() => onNotify(`Opening "${t.title}"`)}
                  className="flex shrink-0 items-center gap-1.5 rounded-md bg-accent px-2.5 py-1 text-[12px] font-medium text-white transition-colors hover:bg-accent-deep"
                >
                  <Play size={11} fill="currentColor" />
                  {t.status === "in-progress" ? "Resume" : "Start"}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
