import { useEffect, useState } from "react";
import { Play } from "lucide-react";
import { getDb } from "../../db/database";

export interface RealAvailableTestRecord {
  id: string;
  title: string;
  subject: string;
  format: string;
  rigor: string;
  questions: number;
  status: "new" | "in-progress" | "completed";
  score?: number;
  due: string;
}

export function AvailableTests({ onNotify }: { onNotify: (t: string) => void }) {
  const [filter, setFilter] = useState<"all" | "new" | "in-progress" | "completed">("all");
  const [tests, setTests] = useState<RealAvailableTestRecord[]>([]);

  useEffect(() => {
    (async () => {
      const db = await getDb();

      const res = db.exec(`
        SELECT a.id, f.title, f.subject, f.format, a.status, a.aggregate_score,
               (SELECT COUNT(*) FROM assessment_items i WHERE i.form_id = f.id) AS q_count
        FROM assessment_attempts a
        JOIN assessment_forms f ON a.form_id = f.id;
      `);

      if (!res[0]) {
        setTests([]);
        return;
      }

      const loaded: RealAvailableTestRecord[] = res[0].values.map((row) => {
        const id = row[0] as string;
        const title = row[1] as string;
        const subject = row[2] as string;
        const format = row[3] as string;
        const statusRaw = row[4] as string;
        const aggScore = (row[5] as number) ?? 0;
        const qCount = (row[6] as number) ?? 3;

        let st: "new" | "in-progress" | "completed" = "new";
        if (statusRaw === "completed") st = "completed";
        else if (statusRaw === "active") st = "in-progress";

        // Score percentage
        const pct = Math.round((aggScore / Math.max(1, qCount * 2)) * 100);

        return {
          id,
          title,
          subject: subject.charAt(0).toUpperCase() + subject.slice(1),
          format: format.toUpperCase(),
          rigor: "Challenging",
          questions: qCount,
          status: st,
          score: st === "completed" ? Math.min(100, pct) : undefined,
          due: "Self-paced",
        };
      });

      setTests(loaded);
    })();
  }, []);

  const rows = tests.filter((t) => filter === "all" || t.status === filter);

  const statusStyle = (s: string) =>
    s === "new"
      ? { bg: "rgba(125,211,252,0.14)", fg: "#7dd3fc", label: "New" }
      : s === "in-progress"
      ? { bg: "rgba(252,211,77,0.14)", fg: "#fcd34d", label: "In progress" }
      : { bg: "rgba(134,239,172,0.14)", fg: "#86efac", label: "Completed" };

  const pendingCount = tests.filter((t) => t.status !== "completed").length;
  const completedCount = tests.filter((t) => t.status === "completed").length;
  const completedTests = tests.filter((t) => t.status === "completed" && t.score !== undefined);
  const avgScore = completedTests.length
    ? Math.round(completedTests.reduce((n, t) => n + (t.score ?? 0), 0) / completedTests.length)
    : 0;

  return (
    <div className="mx-auto w-full max-w-[820px] px-5 pt-10 pb-16 select-none">
      <div className="mb-2 font-mono text-[10px] uppercase tracking-wider text-dim">Testing & Practice</div>
      <h1 className="mb-1 text-[36px] font-bold leading-tight tracking-tight text-fg">Available tests</h1>
      <p className="mb-6 text-[13.5px] text-dim">
        Assigned and saved exams, loaded directly from SQLite database.
      </p>

      <div className="mb-5 grid grid-cols-3 gap-2">
        <div className="rounded-md border border-edge bg-raise p-3">
          <div className="text-[18px] font-semibold text-fg">{pendingCount}</div>
          <div className="text-[11px] text-dim">Pending</div>
        </div>
        <div className="rounded-md border border-edge bg-raise p-3">
          <div className="text-[18px] font-semibold text-[#86efac]">{completedCount}</div>
          <div className="text-[11px] text-dim">Completed</div>
        </div>
        <div className="rounded-md border border-edge bg-raise p-3">
          <div className="text-[18px] font-semibold text-[#fcd34d]">{avgScore}%</div>
          <div className="text-[11px] text-dim">Average score</div>
        </div>
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
          return (
            <div key={t.id} className="flex items-center gap-3 rounded-md border border-edge bg-raise p-3">
              <span className="h-9 w-1 shrink-0 rounded-full bg-accent" />
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
                  {t.subject} · {t.questions} questions · {t.format} · {t.due}
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
        {rows.length === 0 && (
          <p className="px-4 py-8 text-center text-[13px] text-dim border border-edge rounded-md bg-raise">
            No tests found in SQLite database matching this filter.
          </p>
        )}
      </div>
    </div>
  );
}
