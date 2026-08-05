import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TopBar, type Tab } from "./components/TopBar";
import { Toolbar } from "./components/Toolbar";
import { Sidebar } from "./components/Sidebar";
import { SessionCard } from "./components/SessionCard";
import { ActivityList } from "./components/ActivityList";
import { Toasts, type ToastItem } from "./components/Toasts";
import { SearchModal } from "./components/SearchModal";
import { SettingsModal } from "./components/SettingsModal";
import { TabContent, encodeTestTabId, type TestParams } from "./components/TabContent";
import { StudyRoom } from "./components/board/StudyRoom";
import { PredictionTrainer, type TrainerMode } from "./components/code/PredictionTrainer";
import { buildBoard, detectDomain, type BoardDoc } from "./data/boards";
import { SUBJECTS, type SubjectId } from "./data/tutor";

function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 20_000);
    return () => clearInterval(id);
  }, []);
  return now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

const HOME_TAB_ID = "home";

export default function App() {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [subjectId] = useState<SubjectId>("physics");
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [board, setBoard] = useState<BoardDoc | null>(null);
  const [trainerMode, setTrainerMode] = useState<TrainerMode>("all");
  const [searchOpen, setSearchOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const subject = SUBJECTS.find((s) => s.id === subjectId)!;

  const [tabs, setTabs] = useState<Tab[]>([
    { id: HOME_TAB_ID, title: subject.topic, kind: "board" },
  ]);
  const [activeTabId, setActiveTabId] = useState<string>(HOME_TAB_ID);
  const [activeTest, setActiveTest] = useState<TestParams | null>(null);

  const toastId = useRef(0);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const time = useClock();

  const notify = useCallback((text: string) => {
    const id = ++toastId.current;
    setToasts((t) => [...t.slice(-2), { id, text }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 2600);
  }, []);

  const startPrep = useCallback((prompt: string) => {
    setTrainerMode("all");
    setBoard(buildBoard(detectDomain(prompt), prompt));
  }, []);

  // Programming curricula open the focused, no-kernel Parsons path directly.
  // Keeping this as a separate entry point makes the curriculum choice feel like
  // a route, rather than another generic chalkboard prompt.
  const openProgramming = useCallback((curriculum: string) => {
    setTrainerMode("parsons");
    setBoard(buildBoard("programming", curriculum));
    notify(`Opening Parsons suite · ${curriculum}`);
  }, [notify]);

  const openTab = useCallback((incoming: { id: string; title: string; kind: Tab["kind"] }) => {
    setTabs((current) => {
      if (current.some((t) => t.id === incoming.id)) return current;
      return [...current, incoming];
    });
    setActiveTabId(incoming.id);
  }, []);

  const closeTab = useCallback(
    (id: string) => {
      setTabs((current) => {
        if (current.length <= 1) return current;
        const idx = current.findIndex((t) => t.id === id);
        const next = current.filter((t) => t.id !== id);
        if (id === activeTabId) {
          const neighbor = next[Math.max(0, idx - 1)] ?? next[0];
          setActiveTabId(neighbor.id);
        }
        return next;
      });
    },
    [activeTabId]
  );

  const newTab = useCallback(() => {
    const id = `home-${Date.now()}`;
    openTab({ id, title: "New session", kind: "board" });
  }, [openTab]);

  const startTest = useCallback((params: TestParams) => {
    setActiveTest(params);
    const id = encodeTestTabId(params);
    const title = `${SUBJECTS.find((s) => s.id === "physics")?.label ?? "Test"} · ${params.format} · ${params.count}q`;
    setTabs((current) => {
      if (current.some((t) => t.id === id)) return current;
      return [...current, { id, title, kind: "test" }];
    });
    setActiveTabId(id);
  }, []);

  const exitTest = useCallback(() => {
    setActiveTest(null);
    setActiveTabId("test-take");
  }, []);

  /* global shortcuts: ⌘K search · ⌘, settings */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSettingsOpen(false);
        setSearchOpen((v) => !v);
      } else if (meta && e.key === ",") {
        e.preventDefault();
        setSearchOpen(false);
        setSettingsOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const activeTab = useMemo(
    () => tabs.find((t) => t.id === activeTabId) ?? tabs[0],
    [tabs, activeTabId]
  );

  /* ── Programming gets the prediction trainer, not a chalkboard ── */
  if (board && board.domain === "programming") {
    return (
      <div className="ambient flex h-screen w-screen flex-col overflow-hidden">
        <div className="flex items-center gap-3 border-b border-edge-soft bg-panel px-4 py-2">
          <button
            onClick={() => {
              setBoard(null);
              setTrainerMode("all");
              notify("Left the trainer");
            }}
            className="rounded-md border border-edge bg-raise px-2.5 py-1 text-[12px] text-mut transition-colors hover:bg-white/[0.07] hover:text-fg"
          >
            ← Back
          </button>
          <span className="text-[13px] font-semibold text-fg">
            Programming · {trainerMode === "parsons" ? "Parsons suite" : "Prediction trainer"}
          </span>
          <span className="ml-auto font-mono text-[10px] uppercase tracking-wider text-dim">
            no kernel · precomputed
          </span>
        </div>
        <PredictionTrainer
          onNotify={notify}
          curriculum={board.subtitle}
          initialMode={trainerMode}
        />
        <Toasts items={toasts} />
      </div>
    );
  }

  /* ── Study room takes over the whole screen ── */
  if (board) {
    return (
      <div className="h-screen w-screen overflow-hidden bg-black">
        <StudyRoom
          initialBoard={board}
          notify={notify}
          onLeave={() => {
            setBoard(null);
            notify("Left the chalkboard — back to prep");
          }}
        />
        <Toasts items={toasts} />
      </div>
    );
  }

  const isBoardTab = activeTab.kind === "board";
  const isRunningTest = activeTab.kind === "test" && activeTab.id.startsWith("test-run-") && activeTest != null;

  // Fullscreen exam mode — no sidebar, no top bar, no toolbar, nothing else.
  if (isRunningTest) {
    return (
      <div className="ambient h-screen w-screen overflow-hidden">
        <TabContent
          tab={activeTab}
          onNotify={notify}
          onContinueSession={() => {}}
          onStartTest={startTest}
          onExitTest={exitTest}
          onOpenProgramming={openProgramming}
          activeTest={activeTest}
        />
        <Toasts items={toasts} />
      </div>
    );
  }

  return (
    <div className="ambient flex h-screen flex-col overflow-hidden">
      <TopBar
        tabs={tabs}
        activeTabId={activeTabId}
        onSelectTab={setActiveTabId}
        onCloseTab={closeTab}
        onNewTab={newTab}
        onToggleSidebar={() => setSidebarOpen((v) => !v)}
        onNotify={notify}
      />

      <div className="flex min-h-0 flex-1">
        {sidebarOpen && (
          <Sidebar
            onNotify={notify}
            onOpenSearch={() => setSearchOpen(true)}
            onOpenSettings={() => setSettingsOpen(true)}
            onOpenTab={openTab}
            onOpenProgramming={openProgramming}
          />
        )}

        <div className="relative flex-1 overflow-y-auto">
          <div className="sticky top-0 z-20 bg-ink/85 backdrop-blur-sm">
            <Toolbar title={activeTab.title} onNotify={notify} />
          </div>

          {isBoardTab ? (
            <main className="mx-auto w-full max-w-[760px] px-5 pt-14 sm:pt-20">
              <header className="anim-fade-up mb-8">
                <h1 className="text-[38px] font-bold leading-tight tracking-tight sm:text-[44px]">
                  <span className="text-faint">@</span>
                  <span className="text-[#909090]">Today {time}</span>
                </h1>
                <p className="mt-2 font-mono text-[11px] uppercase tracking-wider text-dim">
                  Tell Studyus what to study · it builds the chalkboard
                </p>
              </header>

              <SessionCard
                key={activeTab.id}
                subject={subject}
                notify={notify}
                inputRef={inputRef}
                onPrepare={startPrep}
                onOpenProgramming={openProgramming}
              />

              <ActivityList onOpen={(title) => notify(`Opening "${title}"…`)} />
            </main>
          ) : (
            <TabContent
              tab={activeTab}
              onNotify={notify}
              onContinueSession={(title) => {
                setBoard(buildBoard(detectDomain(title), title));
                notify("Reopening the chalkboard…");
              }}
              onStartTest={startTest}
              onExitTest={exitTest}
              onOpenProgramming={openProgramming}
              activeTest={activeTest}
            />
          )}
        </div>
      </div>

      <SearchModal
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        onPick={(item) =>
          openTab({ id: `search-${item.id}`, title: item.label, kind: "note" })
        }
      />

      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} onNotify={notify} />

      <Toasts items={toasts} />
    </div>
  );
}
