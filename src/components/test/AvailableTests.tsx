import { useEffect, useState } from "react";
import { Eye, Play } from "lucide-react";
import { getDb } from "../../db/database";
import { beginAttempt } from "../../api";
import type { TestParams } from "../testTabIds";

export interface RealAvailableTestRecord {
  id: string;
  title: string;
  subject: string;
  format: string;
  rigor: string;
  questions: number;
  status: "new" | "in-progress" | "completed" | "grading-blocked";
  score?: number;
  due: string;
  /** Reconstructed TestParams for re-entering the attempt. */
  params: TestParams;
}

interface Props {
  onNotify: (t: string) => void;
  onStart: (params: TestParams) => void;
  /** Bumped by the parent whenever a fresh test is generated so this list
   *  re-fetches from SQLite and the new test appears without a reload. */
  refreshKey?: number;
}

export function resolveAvailableTestStatus(
  persistedStatus: string,
  responseCount: number,
  startEventCount: number
): RealAvailableTestRecord["status"] {
  if (persistedStatus === "completed") return "completed";
  if (persistedStatus === "grading_blocked") return "grading-blocked";
  if (persistedStatus === "active" && (responseCount > 0 || startEventCount > 0)) {
    return "in-progress";
  }
  return "new";
}

export function AvailableTests({ onNotify, onStart, refreshKey }: Props) {
  const [filter, setFilter] = useState<"all" | "new" | "in-progress" | "completed">("all");
  const [tests, setTests] = useState<RealAvailableTestRecord[]>([]);
  const [openingAttemptId, setOpeningAttemptId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const db = await getDb();

      // Pull the form's config_json (rigor + nodeIds + sourceName) alongside the
      // attempt metadata so a "Start"/"Resume" here can reconstruct the TestParams
      // that TestRunner expects, and so rigor reflects what was actually generated.
      const res = db.exec(`
        SELECT a.id, f.title, f.subject, f.format, a.status, a.aggregate_score,
               f.config_json,
               (SELECT COUNT(*) FROM assessment_items i WHERE i.form_id = f.id) AS q_count,
               (SELECT COALESCE(SUM(i.maximum_marks), 0) FROM assessment_items i WHERE i.form_id = f.id) AS total_marks,
               (SELECT COUNT(*) FROM attempt_responses r WHERE r.attempt_id = a.id) AS response_count,
               (SELECT COUNT(*) FROM assessment_events e
                  WHERE e.attempt_id = a.id AND e.event_type = 'attempt_started') AS start_count
        FROM assessment_attempts a
        JOIN assessment_forms f ON a.form_id = f.id
        ORDER BY a.audit_created_at DESC;
      `);

      if (!res[0]) {
        if (!cancelled) setTests([]);
        return;
      }

      const loaded: RealAvailableTestRecord[] = res[0].values.map((row) => {
        const id = row[0] as string;
        const title = row[1] as string;
        const subject = row[2] as string;
        const format = row[3] as string;
        const statusRaw = row[4] as string;
        const aggScore = (row[5] as number) ?? 0;
        let config: any = {};
        try {
          config = row[6] ? JSON.parse(row[6] as string) : {};
        } catch {
          config = {};
        }
        const qCount = (row[7] as number) ?? 0;
        const totalMarks = (row[8] as number) ?? 0;
        // Older generated tests were saved as active immediately. Do not call
        // them resumable unless a response or explicit start event proves that
        // the learner actually opened the attempt.
        const st = resolveAvailableTestStatus(
          statusRaw,
          (row[9] as number) ?? 0,
          (row[10] as number) ?? 0
        );

        // Difficulty profiles use different mark weights, so percentage must use
        // the persisted maximum-mark total rather than assuming two per item.
        const pct = Math.round((aggScore / Math.max(1, totalMarks)) * 100);
        const rigorLabel =
          config.rigor === "casual" ? "Casual"
            : config.rigor === "rigorous" ? "Rigorous"
            : "Challenging";

        const params: TestParams = {
          attemptId: id,
          title,
          subject: config.subject ?? subject,
          format: format as TestParams["format"],
          count: qCount,
          rigor: (config.rigor ?? "challenging") as TestParams["rigor"],
          docId: config.sourceName ?? null,
          picked: Array.isArray(config.nodeIds) ? config.nodeIds : [],
        };

        return {
          id,
          title,
          subject: subject.charAt(0).toUpperCase() + subject.slice(1),
          format: format.toUpperCase(),
          rigor: rigorLabel,
          questions: qCount,
          status: st,
          score: st === "completed" ? Math.min(100, pct) : undefined,
          due: "Self-paced",
          params,
        };
      });

      if (!cancelled) setTests(loaded);
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  const openTest = async (test: RealAvailableTestRecord) => {
    if (openingAttemptId) return;
    setOpeningAttemptId(test.id);
    try {
      const finished = test.status === "completed" || test.status === "grading-blocked";
      // Only a start/resume action transitions an attempt. Finished attempts
      // reopen their immutable receipt and must never be started or re-graded.
      if (!finished) await beginAttempt(test.id);
      onStart(test.params);
      onNotify(
        finished
          ? `Reviewing "${test.title}"`
          : `${test.status === "in-progress" ? "Resuming" : "Starting"} "${test.title}"`
      );
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "Could not open this test");
    } finally {
      setOpeningAttemptId(null);
    }
  };

  const rows = tests.filter((t) =>
    filter === "all"
      || t.status === filter
      || (filter === "completed" && t.status === "grading-blocked")
  );

  const statusStyle = (s: RealAvailableTestRecord["status"]) =>
    s === "new"
      ? { bg: "rgba(125,211,252,0.14)", fg: "#7dd3fc", label: "New" }
      : s === "in-progress"
      ? { bg: "rgba(252,211,77,0.14)", fg: "#fcd34d", label: "In progress" }
      : s === "grading-blocked"
        ? { bg: "rgba(252,211,77,0.14)", fg: "#fcd34d", label: "Needs review" }
        : { bg: "rgba(134,239,172,0.14)", fg: "#86efac", label: "Completed" };

  const pendingCount = tests.filter((t) => t.status === "new" || t.status === "in-progress").length;
  const completedCount = tests.filter((t) => t.status === "completed" || t.status === "grading-blocked").length;
  const completedTests = tests.filter((t) => t.status === "completed" && t.score !== undefined);
  const avgScore = completedTests.length
    ? Math.round(completedTests.reduce((n, t) => n + (t.score ?? 0), 0) / completedTests.length)
    : 0;

  return (
    <div className="mx-auto w-full max-w-[820px] px-5 pt-10 pb-16 select-none">
      <div className="mb-2 font-mono text-[10px] uppercase tracking-wider text-dim">Testing & Practice</div>
      <h1 className="mb-1 text-[36px] font-bold leading-tight tracking-tight text-fg">Available tests</h1>
      <p className="mb-6 text-[13.5px] text-dim">
        Generated and saved exams, loaded directly from the SQLite database. Generate a test in Take a test and it lands here.
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
                  {t.subject} · {t.questions} questions · {t.format} · {t.rigor} · {t.due}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {t.score !== undefined && (
                  <span className="font-mono text-[15px] font-semibold text-[#86efac]">{t.score}%</span>
                )}
                <button
                  onClick={() => void openTest(t)}
                  disabled={openingAttemptId !== null}
                  className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[12px] font-medium transition-colors disabled:cursor-wait disabled:opacity-55 ${
                    t.status === "completed" || t.status === "grading-blocked"
                      ? "border border-edge bg-white/[0.05] text-mut hover:bg-white/[0.1] hover:text-fg"
                      : "bg-accent text-white hover:bg-accent-deep"
                  }`}
                >
                  {t.status === "completed" || t.status === "grading-blocked" ? (
                    <Eye size={11} />
                  ) : (
                    <Play size={11} fill="currentColor" />
                  )}
                  {openingAttemptId === t.id
                    ? "Opening…"
                    : t.status === "completed" || t.status === "grading-blocked"
                      ? "Review"
                      : t.status === "in-progress"
                        ? "Resume"
                        : "Start"}
                </button>
              </div>
            </div>
          );
        })}
        {rows.length === 0 && (
          <div className="px-4 py-8 text-center border border-edge rounded-md bg-raise">
            <p className="text-[13px] text-dim">
              No tests here yet. Generate one in <span className="text-fg">Take a test</span> — it lands in this list.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
