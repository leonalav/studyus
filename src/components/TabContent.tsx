import { useEffect, useState } from "react";
import { Download } from "lucide-react";
import type { Tab } from "./TopBar";
import { TestCenter } from "./test/TestCenter";
import { QuestionBank } from "./test/QuestionBank";
import { AvailableTests } from "./test/AvailableTests";
import { TestRunner } from "./test/TestRunner";
import {
  getCurriculumTree,
  getOriginalCurriculumPdf,
  type CurriculumNodeRecord,
} from "../lib/curriculum";
import { useCurricula } from "../state/curriculumStore";
import { PastNoteTab } from "./PastNoteTab";
import { TestParams } from "./testTabIds";
import type { CurriculumStudySelection } from "../types/curriculumStudy";

export type { TestParams } from "./testTabIds";

interface Props {
  tab: Tab;
  onNotify: (t: string) => void;
  onStartTest: (params: TestParams) => void;
  onTestGenerated: () => void;
  onExitTest: () => void;
  onSelectSectionForStudy?: (selection: CurriculumStudySelection) => void;
  onReopenSession?: (sessionId: string) => void;
  activeTest: TestParams | null;
  /** Bumped after a test is generated so Available tests re-fetches. */
  availableTestsRefreshKey?: number;
}

export function TabContent({
  tab,
  onNotify,
  onStartTest,
  onTestGenerated,
  onExitTest,
  onSelectSectionForStudy,
  onReopenSession,
  activeTest,
  availableTestsRefreshKey,
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

  if (tab.kind === "note") {
    const sessionId = (tab.contentId ?? tab.id).replace(/^note-/, "");
    return (
      <PastNoteTab
        sessionId={sessionId}
        onNotify={onNotify}
        onReopen={onReopenSession ?? (() => onNotify("This session cannot be reopened right now"))}
      />
    );
  }

  if (tab.kind === "test") {
    const contentId = tab.contentId ?? tab.id;
    if (contentId === "test-take") return <TestCenter onNotify={onNotify} onGenerated={onTestGenerated} />;
    if (contentId === "test-bank") return <QuestionBank onNotify={onNotify} />;
    if (contentId === "test-available")
      return <AvailableTests onNotify={onNotify} onStart={onStartTest} refreshKey={availableTestsRefreshKey} />;
    if (contentId.startsWith("test-run-") && activeTest) {
      return (
        <TestRunner
          attemptId={activeTest.attemptId}
          title={activeTest.title}
          rigor={activeTest.rigor}
          onExit={onExitTest}
          onNotify={onNotify}
        />
      );
    }
    return <TestCenter onNotify={onNotify} onGenerated={onTestGenerated} />;
  }

  return null;
}

/* ── Imported curriculum document ── */

function CurriculumTab({
  tab,
  onNotify,
  onSelectSection,
}: {
  tab: Tab;
  onNotify: (t: string) => void;
  onSelectSection?: (selection: CurriculumStudySelection) => void;
}) {
  const sourceId = (tab.contentId ?? tab.id).replace(/^cur-/, "");
  const { curricula } = useCurricula();
  const source = curricula.find((item) => item.id === sourceId);
  const [nodes, setNodes] = useState<CurriculumNodeRecord[]>(source?.nodes ?? []);

  useEffect(() => {
    let cancelled = false;
    getCurriculumTree(sourceId)
      .then((loaded) => {
        if (!cancelled) setNodes(loaded);
      })
      .catch((error) => {
        if (!cancelled) onNotify(error instanceof Error ? error.message : "Could not load curriculum outline");
      });
    return () => {
      cancelled = true;
    };
  }, [onNotify, sourceId]);

  const handlePickSection = (node: CurriculumNodeRecord | null) => {
    const label = node
      ? [node.sectionNumber, node.title].filter(Boolean).join(" ")
      : source?.name.replace(/\.pdf$/i, "") ?? tab.title;
    onNotify(`Selected concept: "${label}". Redirecting to Tutor…`);
    onSelectSection?.({ sourceId, nodeId: node?.id ?? null, label });
  };

  const handleDownload = async () => {
    try {
      const pdf = await getOriginalCurriculumPdf(sourceId);
      if (!pdf) {
        onNotify("The original PDF is not stored on this device. Re-import it to restore the download.");
        return;
      }
      const url = URL.createObjectURL(pdf);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = source?.name ?? `${tab.title}.pdf`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      onNotify("Downloaded original PDF");
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "Could not download the original PDF");
    }
  };

  const pageCount = source?.pageCount
    ?? nodes.reduce((highest, node) => Math.max(highest, node.endPage), 0);

  return (
    <main className="mx-auto w-full max-w-[820px] px-5 pb-20 pt-11 sm:px-8 sm:pt-14">
      <header className="mb-10">
        <h1 className="max-w-[720px] text-[34px] font-bold leading-[1.08] tracking-[-0.035em] text-fg sm:text-[42px]">
          {tab.title}
        </h1>
        <p className="mt-3 max-w-[680px] text-[13.5px] leading-[1.7] text-mut">
          Studyus has indexed this PDF. Ask for explanations, generate practice, or build a chalkboard from any section.
        </p>

        <div className="mt-6 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => handlePickSection(null)}
            className="inline-flex h-9 items-center gap-2 rounded-md bg-accent px-3.5 text-[12px] font-semibold text-white transition-colors hover:bg-accent-deep"
          >
            Study with Studyus
          </button>
          <button
            type="button"
            onClick={() => void handleDownload()}
            className="inline-flex h-9 items-center gap-2 rounded-md border border-edge bg-raise px-3.5 text-[12px] font-medium text-mut transition-colors hover:bg-white/[0.08] hover:text-fg"
          >
            <Download size={14} />
            Download original
          </button>
        </div>
      </header>

      <section aria-labelledby="curriculum-contents-heading">
        <div className="mb-3 flex items-center justify-between border-b border-edge-soft pb-3 font-mono text-[10px] uppercase tracking-[0.17em] text-dim">
          <h2 id="curriculum-contents-heading">Contents</h2>
          <span>{pageCount > 0 ? `${pageCount} pages` : "Indexed outline"}</span>
        </div>

        <div className="overflow-hidden rounded-lg border border-edge bg-raise/60">
          {nodes.length === 0 ? (
            <div className="px-6 py-12 text-center">
              <p className="text-[13px] text-mut">No indexed sections are available yet.</p>
              <p className="mt-1 text-[11px] leading-relaxed text-dim">
                PDF bookmarks will appear here after the document is ingested.
              </p>
            </div>
          ) : (
            nodes.map((node, index) => (
              <CurriculumSection
                key={node.id}
                node={node}
                index={index}
                onPick={handlePickSection}
              />
            ))
          )}
        </div>
      </section>
    </main>
  );
}

function CurriculumSection({
  node,
  index,
  onPick,
}: {
  node: CurriculumNodeRecord;
  index: number;
  onPick: (node: CurriculumNodeRecord) => void;
}) {
  const descendants = countDescendants(node);
  const sectionIndex = majorSectionLabel(node, index);
  const title = stripSectionNumber(node.title, node.sectionNumber);

  return (
    <div className={index > 0 ? "border-t border-edge" : ""}>
      <button
        type="button"
        onClick={() => onPick(node)}
        className="group flex w-full items-center gap-4 bg-white/[0.018] px-4 py-4 text-left transition-colors hover:bg-white/[0.05] sm:px-5"
      >
        <span className="w-8 shrink-0 font-mono text-[15px] font-medium tracking-[-0.02em] text-[#e1c35b]">
          {sectionIndex}
        </span>
        <span className="min-w-0 flex-1 text-[14px] font-semibold leading-snug text-fg transition-colors group-hover:text-white">
          {title}
        </span>
        <span className="shrink-0 font-mono text-[8.5px] uppercase tracking-[0.15em] text-dim">
          {descendants} subsection{descendants === 1 ? "" : "s"}
        </span>
      </button>
      {node.children && node.children.length > 0 && (
        <div className="border-t border-edge-soft bg-black/[0.06]">
          <CurriculumRows nodes={node.children} depth={0} onPick={onPick} />
        </div>
      )}
    </div>
  );
}

function CurriculumRows({
  nodes,
  depth,
  onPick,
}: {
  nodes: CurriculumNodeRecord[];
  depth: number;
  onPick: (node: CurriculumNodeRecord) => void;
}) {
  return (
    <>
      {nodes.map((node) => {
        const number = node.sectionNumber ?? "";
        const title = stripSectionNumber(node.title, node.sectionNumber);
        return (
          <div key={node.id}>
            <button
              type="button"
              onClick={() => onPick(node)}
              className="group flex w-full items-start gap-3 border-b border-edge-soft px-4 py-2.5 text-left transition-colors last:border-b-0 hover:bg-white/[0.035] sm:px-5"
              style={{ paddingLeft: 52 + depth * 20 }}
            >
              <span className="mt-[1px] w-10 shrink-0 font-mono text-[10px] text-dim transition-colors group-hover:text-[#e1c35b]">
                {number || "—"}
              </span>
              <span className="min-w-0 flex-1 text-[12.5px] leading-[1.45] text-mut transition-colors group-hover:text-fg">
                {title}
              </span>
            </button>
            {node.children && node.children.length > 0 && (
              <CurriculumRows nodes={node.children} depth={depth + 1} onPick={onPick} />
            )}
          </div>
        );
      })}
    </>
  );
}

function countDescendants(node: CurriculumNodeRecord): number {
  return (node.children ?? []).reduce((total, child) => total + 1 + countDescendants(child), 0);
}

function majorSectionLabel(node: CurriculumNodeRecord, index: number): string {
  const major = node.sectionNumber?.split(".")[0];
  const numeric = major && /^\d+$/.test(major) ? Number(major) : index + 1;
  return String(numeric).padStart(2, "0");
}

function stripSectionNumber(title: string, sectionNumber: string | null): string {
  if (!sectionNumber || !title.startsWith(sectionNumber)) return title;
  const remainder = title.slice(sectionNumber.length);
  if (!/^[\s.:)]/.test(remainder)) return title;
  return remainder.replace(/^[\s.:)]+/, "").trim() || title;
}
