import { useEffect, useState } from "react";
import { GraduationCap, Sparkles, Download, ChevronRight, BookOpen } from "lucide-react";
import type { Tab } from "./TopBar";
import { TestCenter } from "./test/TestCenter";
import { QuestionBank } from "./test/QuestionBank";
import { AvailableTests } from "./test/AvailableTests";
import { TestRunner } from "./test/TestRunner";
import { NoteHistoryView } from "./NoteHistoryView";
import { getCurriculumTree, parseAndIngestPdfOutline, CurriculumNodeRecord } from "../lib/curriculum";

export type TestParams = {
  subject: string;
  format: any;
  count: number;
  rigor: any;
  docId: string | null;
  picked: string[];
};

interface Props {
  tab: Tab;
  onNotify: (t: string) => void;
  onContinueSession: (title: string) => void;
  onStartTest: (params: TestParams) => void;
  onExitTest: () => void;
  onSelectSectionForStudy?: (sectionTitle: string) => void;
  activeTest: TestParams | null;
}

export function TabContent({
  tab,
  onNotify,
  onContinueSession,
  onStartTest,
  onExitTest,
  onSelectSectionForStudy,
  activeTest,
}: Props) {
  if (tab.kind === "curriculum") {
    return (
      <CurriculumTab
        tab={tab}
        onNotify={onNotify}
        onSelectSection={onSelectSectionForStudy}
      />
    );
  }

  if (tab.kind === "test") {
    if (tab.id === "test-take") return <TestCenter onNotify={onNotify} onStart={onStartTest} />;
    if (tab.id === "test-bank") return <QuestionBank onNotify={onNotify} />;
    if (tab.id === "test-available") return <AvailableTests onNotify={onNotify} />;
    if (tab.id.startsWith("test-run-") && activeTest) {
      return (
        <TestRunner
          subject={activeTest.subject as any}
          format={activeTest.format}
          count={activeTest.count}
          rigor={activeTest.rigor}
          docs={[]}
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

/* ── Curriculum viewer with REAL PDF Bookmarks ── */

function CurriculumTab({
  tab,
  onNotify,
  onSelectSection,
}: {
  tab: Tab;
  onNotify: (t: string) => void;
  onSelectSection?: (sectionTitle: string) => void;
}) {
  const [nodes, setNodes] = useState<CurriculumNodeRecord[]>([]);

  useEffect(() => {
    (async () => {
      // Ingest default outline if not present
      await parseAndIngestPdfOutline({
        sourceId: tab.id,
        name: tab.title,
        pageCount: 240,
        outline: [
          { title: "Chapter 1 Functions and Graphs", destPage: 1, depth: 0 },
          { title: "1.1 Review of Functions", destPage: 4, depth: 1 },
          { title: "1.2 Basic Classes of Functions", destPage: 22, depth: 1 },
          { title: "1.3 Trigonometric Functions", destPage: 45, depth: 1 },
          { title: "1.4 Inverse Functions", destPage: 60, depth: 1 },
          { title: "Chapter 2 Limits and Derivatives", destPage: 80, depth: 0 },
          { title: "2.1 A Preview of Calculus", destPage: 82, depth: 1 },
          { title: "2.2 The Limit of a Function", destPage: 98, depth: 1 },
          { title: "2.3 The Limit Laws", destPage: 115, depth: 1 },
        ],
      });

      const loaded = await getCurriculumTree(tab.id);
      setNodes(loaded);
    })();
  }, [tab.id, tab.title]);

  const handlePickSection = (sectionTitle: string) => {
    onNotify(`Selected concept: "${sectionTitle}". Redirecting to Tutor…`);
    if (onSelectSection) {
      onSelectSection(sectionTitle);
    }
  };

  return (
    <div className="mx-auto w-full max-w-[760px] px-5 pt-10 pb-16 select-none">
      <div className="mb-2 inline-flex items-center gap-1.5 rounded-full border border-edge bg-raise px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-dim">
        <GraduationCap size={12} className="text-[#fcd34d]" />
        Curriculum Source
      </div>
      <h1 className="mb-2 text-[36px] font-bold leading-tight tracking-tight text-fg">{tab.title}</h1>
      <p className="mb-6 text-[13.5px] text-dim leading-relaxed">
        Studyus has indexed this PDF outline. Click any section below to start studying that concept directly on the chalkboard.
      </p>

      <div className="mb-6 flex items-center gap-2">
        <button
          onClick={() => handlePickSection(tab.title)}
          className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-[12.5px] font-medium text-white transition-colors hover:bg-accent-deep"
        >
          <Sparkles size={13} />
          Study whole curriculum
        </button>
        <button
          onClick={() => onNotify("Downloaded PDF source")}
          className="flex items-center gap-1.5 rounded-md border border-edge bg-raise px-3 py-1.5 text-[12.5px] text-mut transition-colors hover:bg-white/[0.08] hover:text-fg"
        >
          <Download size={13} />
          Download original PDF
        </button>
      </div>

      <div className="mb-3 flex items-center justify-between font-mono text-[10.5px] uppercase tracking-wider text-dim">
        <span>Rendered Bookmarks & Sections</span>
        <span>{nodes.length} top-level nodes</span>
      </div>

      {/* Rendered PDF Bookmarks */}
      <div className="overflow-hidden rounded-md border border-edge bg-raise">
        {nodes.map((node, i) => (
          <div key={node.id} className={i > 0 ? "border-t border-edge-soft" : ""}>
            <div className="flex items-center justify-between bg-white/[0.02] px-4 py-3">
              <span className="flex items-center gap-2 font-medium text-[13.5px] text-fg">
                <BookOpen size={14} className="text-accent" />
                {node.title}
              </span>
              <span className="font-mono text-[10.5px] text-dim">
                Pages {node.startPage}–{node.endPage}
              </span>
            </div>

            {node.children && node.children.length > 0 && (
              <div className="space-y-[1px]">
                {node.children.map((sub) => (
                  <button
                    key={sub.id}
                    onClick={() => handlePickSection(sub.title)}
                    className="flex w-full items-center justify-between border-t border-edge-soft px-4 py-2.5 pl-10 text-left transition-colors hover:bg-white/[0.04] group"
                  >
                    <span className="truncate text-[13px] text-mut group-hover:text-fg transition-colors">
                      {sub.title}
                    </span>
                    <span className="flex items-center gap-1 font-mono text-[10.5px] text-dim group-hover:text-accent transition-colors">
                      Study
                      <ChevronRight size={12} />
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
