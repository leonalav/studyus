import { useEffect } from "react";
import { GraduationCap, Sparkles, Download } from "lucide-react";
import type { Tab } from "./TopBar";
import { TestCenter } from "./test/TestCenter";
import { QuestionBank } from "./test/QuestionBank";
import { AvailableTests } from "./test/AvailableTests";
import { TestRunner } from "./test/TestRunner";
import { NoteHistoryView } from "./NoteHistoryView";
import { CURRICULA, type SubjectKey, type QuestionFormat, type Rigor } from "../data/curriculum";

export type TestParams = {
  subject: SubjectKey;
  format: QuestionFormat;
  count: number;
  rigor: Rigor;
  docId: string | null;
  picked: string[];
};

interface Props {
  tab: Tab;
  onNotify: (t: string) => void;
  onContinueSession: (title: string) => void;
  onStartTest: (params: TestParams) => void;
  onExitTest: () => void;
  activeTest: TestParams | null;
}

export function TabContent({ tab, onNotify, onContinueSession, onStartTest, onExitTest, activeTest }: Props) {
  if (tab.kind === "curriculum") return <CurriculumTab tab={tab} onNotify={onNotify} />;

  if (tab.kind === "test") {
    if (tab.id === "test-take") return <TestCenter onNotify={onNotify} onStart={onStartTest} />;
    if (tab.id === "test-bank") return <QuestionBank onNotify={onNotify} />;
    if (tab.id === "test-available") return <AvailableTests onNotify={onNotify} />;
    if (tab.id.startsWith("test-run-") && activeTest) {
      const docs = CURRICULA.map((c) => ({ id: c.id, name: c.name }));
      return (
        <TestRunner
          subject={activeTest.subject}
          format={activeTest.format}
          count={activeTest.count}
          rigor={activeTest.rigor}
          docs={docs}
          docId={activeTest.docId}
          selected={activeTest.picked}
          onExit={onExitTest}
          onNotify={onNotify}
        />
      );
    }
    return <TestCenter onNotify={onNotify} onStart={onStartTest} />;
  }

  return <NoteHistoryView title={tab.title} onContinue={() => onContinueSession(tab.title)} />;
}

function encodeTestTabId(p: TestParams) {
  return `test-run-${btoa(unescape(encodeURIComponent(JSON.stringify(p))))}`;
}
function decodeTestTabId(id: string): TestParams | null {
  if (!id.startsWith("test-run-")) return null;
  try {
    return JSON.parse(decodeURIComponent(escape(atob(id.slice("test-run-".length)))));
  } catch {
    return null;
  }
}
export { encodeTestTabId, decodeTestTabId };

/* ── Curriculum viewer ─────────────────────────────────────── */

function CurriculumTab({ tab, onNotify }: { tab: Tab; onNotify: (t: string) => void }) {
  const doc =
    CURRICULA.find((c) => c.name.replace(/\.pdf$/i, "") === tab.title) ?? CURRICULA[0];

  return (
    <div className="mx-auto w-full max-w-[760px] px-5 pt-10 pb-16">
      <div className="mb-2 inline-flex items-center gap-1.5 rounded-full border border-edge bg-raise px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-dim">
        <GraduationCap size={12} className="text-[#fcd34d]" />
        Curriculum
      </div>
      <h1 className="mb-2 text-[36px] font-bold leading-tight tracking-tight text-fg">{tab.title}</h1>
      <p className="mb-6 text-[13.5px] text-dim">
        Studyus has indexed this PDF. Ask for explanations, generate practice, or build a chalkboard from any section.
      </p>

      <div className="mb-6 flex items-center gap-2">
        <button
          onClick={() => onNotify("Building a chalkboard from this curriculum…")}
          className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-[12.5px] font-medium text-white transition-colors hover:bg-accent-deep"
        >
          <Sparkles size={13} />
          Study with Studyus
        </button>
        <button
          onClick={() => onNotify("Downloaded PDF")}
          className="flex items-center gap-1.5 rounded-md border border-edge bg-raise px-3 py-1.5 text-[12.5px] text-mut transition-colors hover:bg-white/[0.08] hover:text-fg"
        >
          <Download size={13} />
          Download original
        </button>
      </div>

      <div className="mb-3 font-mono text-[10px] uppercase tracking-wider text-dim">
        Contents · {doc.pages} pages
      </div>
      <div className="overflow-hidden rounded-md border border-edge">
        {doc.sections.map((s, i) => (
          <div key={s.id} className={i > 0 ? "border-t border-edge-soft" : ""}>
            <div className="flex items-center gap-3 bg-white/[0.02] px-3.5 py-2.5">
              <span className="w-5 shrink-0 font-mono text-[11px] text-dim">
                {(i + 1).toString().padStart(2, "0")}
              </span>
              <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-fg">{s.label}</span>
              <span className="shrink-0 font-mono text-[10.5px] text-dim">
                {s.subsections.length} subsections
              </span>
            </div>
            {s.subsections.map((sub) => (
              <button
                key={sub.id}
                onClick={() => onNotify(`Loading: ${sub.label}`)}
                className="flex w-full items-center gap-3 border-t border-edge-soft px-3.5 py-2 pl-12 text-left transition-colors hover:bg-white/[0.04]"
              >
                <span className="min-w-0 flex-1 truncate text-[12.5px] text-mut">{sub.label}</span>
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/* Suppress unused-import warning for useEffect if App does not end up using it here. */
void useEffect;
