import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TopBar, type Tab } from "./components/TopBar";
import { Toolbar } from "./components/Toolbar";
import { Sidebar } from "./components/Sidebar";
import { SessionCard } from "./components/SessionCard";
import { ActivityList } from "./components/ActivityList";
import { Toasts, type ToastItem } from "./components/Toasts";
import { SearchModal } from "./components/SearchModal";
import { SettingsModal } from "./components/SettingsModal";
import { TabContent, type TestParams } from "./components/TabContent";
import { encodeTestTabId } from "./components/testTabIds";
import { StudyRoom } from "./components/board/StudyRoom";
import { PredictionTrainer } from "./components/code/PredictionTrainer";
import { WindowControls, DragBar } from "./components/WindowControls";
import { buildBoard, detectDomain, type BoardDoc } from "./data/boards";
import { type OnboardingAnswers } from "./data/tutor";
import { getStudySession, type StoredStudySession } from "./state/studySessionStore";
import {
  IN_APP_NOTIFICATION_EVENT,
  notifyStudyusEvent,
  startNotificationRuntime,
  type InAppNotificationDetail,
} from "./lib/notifications";

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
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [board, setBoard] = useState<BoardDoc | null>(null);
  const [restoredSession, setRestoredSession] = useState<StoredStudySession | null>(null);
  const [pendingBoundNodes, setPendingBoundNodes] = useState<string[]>([]);
  const [pendingOnboarding, setPendingOnboarding] = useState<OnboardingAnswers | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState<
    "root" | "about" | "appearance" | "tutor" | "notifications" | "models"
  >("root");
  const [chosenSection, setChosenSection] = useState<string | null>(null);
  const openSettingsRoot = useCallback(() => {
    setSettingsSection("root");
    setSettingsOpen(true);
  }, []);

  const [tabs, setTabs] = useState<Tab[]>([
    { id: HOME_TAB_ID, title: chosenSection ?? "Study", kind: "board" },
  ]);
  const [activeTabId, setActiveTabId] = useState<string>(HOME_TAB_ID);
  const [activeTest, setActiveTest] = useState<TestParams | null>(null);
  /** Bumped on every generated test so Available tests re-fetches from SQLite. */
  const [availableTestsRefreshKey, setAvailableTestsRefreshKey] = useState(0);

  const toastId = useRef(0);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const time = useClock();

  const notify = useCallback((text: string) => {
    const id = ++toastId.current;
    setToasts((t) => [...t.slice(-2), { id, text }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 2600);
  }, []);

  useEffect(() => {
    const onNotification = (event: Event) => {
      const detail = (event as CustomEvent<InAppNotificationDetail>).detail;
      if (detail?.title) notify(detail.body ? `${detail.title} — ${detail.body}` : detail.title);
    };
    window.addEventListener(IN_APP_NOTIFICATION_EVENT, onNotification);
    const stopRuntime = startNotificationRuntime();
    return () => {
      stopRuntime();
      window.removeEventListener(IN_APP_NOTIFICATION_EVENT, onNotification);
    };
  }, [notify]);

  const startPrep = useCallback(
    (prompt: string, boundNodes?: string[], onboarding?: OnboardingAnswers) => {
      setRestoredSession(null);
      setPendingBoundNodes(boundNodes ?? []);
      setPendingOnboarding(onboarding ?? null);
      // Title the board from the chosen concept (carried on the onboarding
      // answers), never the raw prompt — the board must not echo the learner's
      // own query back at them.
      setBoard(buildBoard(detectDomain(prompt), prompt, onboarding?.concept));
    },
    []
  );

  const openStoredSession = useCallback((id: string) => {
    const session = getStudySession(id);
    if (!session) return notify("That study session is no longer available");
    setRestoredSession(session);
    setBoard(session.boards.find((item) => item.id === session.activeId) ?? session.boards[0]);
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

  const testGenerated = useCallback(() => {
    setAvailableTestsRefreshKey((n) => n + 1);
    notifyStudyusEvent(
      "testReady",
      "Your generated test is ready",
      "Open Available tests when you are ready to begin."
    );
  }, []);

  const startTest = useCallback((params: TestParams) => {
    setActiveTest(params);
    const id = encodeTestTabId(params);
    const title = `${params.title} · ${params.count}q`;
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
        if (settingsOpen) setSettingsOpen(false);
        else openSettingsRoot();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openSettingsRoot, settingsOpen]);

  const activeTab = useMemo(
    () => tabs.find((t) => t.id === activeTabId) ?? tabs[0],
    [tabs, activeTabId]
  );

  /* ── Programming gets the prediction trainer, not a chalkboard ── */
  if (board && board.domain === "programming") {
    return (
      <div className="ambient flex h-screen w-screen flex-col overflow-hidden">
        <div className="flex items-center gap-3 border-b border-edge-soft bg-panel px-4 py-2" data-tauri-drag-region="deep">
          <button
            onClick={() => {
              setBoard(null);
              notify("Left the trainer");
            }}
            className="rounded-md border border-edge bg-raise px-2.5 py-1 text-[12px] text-mut transition-colors hover:bg-white/[0.07] hover:text-fg"
          >
            ← Back
          </button>
          <span className="text-[13px] font-semibold text-fg">Programming · Prediction trainer</span>
          <span className="ml-auto font-mono text-[10px] uppercase tracking-wider text-dim">
            no kernel · precomputed
          </span>
        </div>
        <PredictionTrainer onNotify={notify} />
        <DragBar />
        <WindowControls />
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
          initialSession={restoredSession ?? undefined}
          boundNodes={restoredSession ? undefined : pendingBoundNodes}
          onboarding={restoredSession ? undefined : pendingOnboarding ?? undefined}
          notify={notify}
          onLeave={() => {
            setBoard(null);
            const delivered = notifyStudyusEvent(
              "sessionComplete",
              "Study session saved",
              "Your chalkboard and transcript are available in Recent Sessions and Past Notes."
            );
            if (delivered === "disabled" || delivered === "permission-needed") {
              notify("Left the chalkboard — back to prep");
            }
          }}
        />
        <DragBar />
        <WindowControls />
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
          onStartTest={startTest}
          onTestGenerated={testGenerated}
          onExitTest={exitTest}
          onReopenSession={openStoredSession}
          activeTest={activeTest}
        />
        <DragBar />
        <WindowControls />
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
            onOpenSettings={openSettingsRoot}
            onOpenTab={openTab}
          />
        )}

        <div className="relative flex-1 overflow-y-auto">
          <div className="sticky top-0 z-20 bg-ink/85 backdrop-blur-sm">
            <Toolbar title={activeTab.title} onNotify={notify} />
          </div>

          {isBoardTab ? (
            <main className="mx-auto w-full max-w-[760px] px-5 pt-14 sm:pt-20">
              <header className="anim-fade-up mb-8">
                {/* The big page header always shows the current time — it is never
                    replaced by the chosen subsection name. The subsection lives in
                    the "Add context" dropdown in the SessionCard header instead. */}
                <h1 className="text-[38px] font-bold leading-tight tracking-tight sm:text-[44px]">
                  <span className="text-faint">@</span>
                  <span className="text-[#909090]">Today {time}</span>
                </h1>
                <p className="mt-2 font-mono text-[11px] uppercase tracking-wider text-dim">
                  {chosenSection ? `Studying concept section: ${chosenSection}` : "Tell Studyus what to study · it builds the chalkboard"}
                </p>
              </header>

              <SessionCard
                key={activeTab.id}
                notify={notify}
                inputRef={inputRef}
                onPrepare={startPrep}
                selectedSection={chosenSection}
                onSelectedSectionChange={setChosenSection}
              />

              <ActivityList
                onOpen={(id, title) => {
                  openStoredSession(id);
                  notify(`Reopening "${title}"…`);
                }}
                onNotify={notify}
              />
            </main>
          ) : (
            <TabContent
              tab={activeTab}
              onNotify={notify}
              onStartTest={startTest}
              onTestGenerated={testGenerated}
              onExitTest={exitTest}
              onSelectSectionForStudy={(sectionTitle) => {
                setChosenSection(sectionTitle);
                setActiveTabId(HOME_TAB_ID);
                notify(`Switched to Tutor @[${sectionTitle}]`);
              }}
              onReopenSession={openStoredSession}
              activeTest={activeTest}
              availableTestsRefreshKey={availableTestsRefreshKey}
            />
          )}
        </div>
      </div>

      <SearchModal
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        onPick={(item) => {
          if (item.type === "note" && item.noteId) {
            openTab({ id: `note-${item.noteId}`, title: item.label, kind: "note" });
            notify(`Opened past note "${item.label}"`);
          } else if (item.type === "setting" && item.settingId) {
            // A settings pick opens the Settings modal landed on that section,
            // never a note tab. Validate against the known section ids before
            // handing it to the modal.
            const known = ["about", "appearance", "tutor", "notifications", "models"];
            setSettingsSection(
              known.includes(item.settingId)
                ? (item.settingId as typeof settingsSection)
                : "root"
            );
            setSettingsOpen(true);
          }
        }}
      />

      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onNotify={notify}
        initialSection={settingsSection}
      />

      <Toasts items={toasts} />
    </div>
  );
}
