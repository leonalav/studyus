import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { TopBar, type Tab } from "./components/TopBar";
import { Toolbar } from "./components/Toolbar";
import { Sidebar } from "./components/Sidebar";
import { SessionCard } from "./components/SessionCard";
import { ActivityList } from "./components/ActivityList";
import { Toasts, type ToastItem } from "./components/Toasts";
import { SearchModal } from "./components/SearchModal";
import { SettingsModal } from "./components/SettingsModal";
import { HelpModal } from "./components/HelpModal";
import { MarketplacePage } from "./components/MarketplacePage";
import { TabContent, type TestParams } from "./components/TabContent";
import { decodeTestTabId, encodeTestTabId } from "./components/testTabIds";
import { StudyRoom } from "./components/board/StudyRoom";
import { PredictionTrainer } from "./components/code/PredictionTrainer";
import { WindowControls, DragBar } from "./components/WindowControls";
import { buildBoard, detectDomain, type BoardDoc } from "./data/boards";
import { type OnboardingAnswers } from "./data/tutor";
import { getStudySession, type StoredStudySession } from "./state/studySessionStore";
import { ContextMenu, type ContextMenuTarget } from "./components/ContextMenu";
import {
  createDefaultTab,
  loadTabSession,
  saveTabSession,
} from "./state/tabSessionStore";
import type { CurriculumStudySelection } from "./types/curriculumStudy";
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
const MARKETPLACE_TAB_ID = "marketplace";
const CURRICULUM_SELECTION_KEY = "studyus.curriculum_selection.v1";

function loadCurriculumSelection(): CurriculumStudySelection | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const value = JSON.parse(localStorage.getItem(CURRICULUM_SELECTION_KEY) ?? "null") as Partial<CurriculumStudySelection> | null;
    return value && typeof value.sourceId === "string" &&
      (typeof value.nodeId === "string" || value.nodeId === null) &&
      typeof value.label === "string"
      ? value as CurriculumStudySelection
      : null;
  } catch {
    return null;
  }
}

export default function App() {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [board, setBoard] = useState<BoardDoc | null>(null);
  const [restoredSession, setRestoredSession] = useState<StoredStudySession | null>(null);
  const [pendingBoundNodes, setPendingBoundNodes] = useState<string[]>([]);
  const [pendingOnboarding, setPendingOnboarding] = useState<OnboardingAnswers | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState<
    "root" | "about" | "appearance" | "tutor" | "notifications" | "models"
  >("root");
  const [chosenSection, setChosenSection] = useState<CurriculumStudySelection | null>(loadCurriculumSelection);
  const [shellContextMenu, setShellContextMenu] = useState<ContextMenuTarget | null>(null);
  const openSettingsRoot = useCallback(() => {
    setSettingsSection("root");
    setSettingsOpen(true);
  }, []);

  const [restoredTabSession] = useState(loadTabSession);
  const [tabs, setTabs] = useState<Tab[]>(restoredTabSession.tabs);
  const [activeTabId, setActiveTabId] = useState<string>(restoredTabSession.activeTabId);
  const [closedTabs, setClosedTabs] = useState<Tab[]>(restoredTabSession.closedTabs);
  const [activeTest, setActiveTest] = useState<TestParams | null>(() => {
    const active = restoredTabSession.tabs.find((tab) => tab.id === restoredTabSession.activeTabId);
    return active ? decodeTestTabId(active.contentId ?? active.id) : null;
  });
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
    saveTabSession({ tabs, activeTabId, closedTabs });
  }, [activeTabId, closedTabs, tabs]);

  useEffect(() => {
    const active = tabs.find((tab) => tab.id === activeTabId);
    setActiveTest(active ? decodeTestTabId(active.contentId ?? active.id) : null);
  }, [activeTabId, tabs]);

  useEffect(() => {
    if (chosenSection) localStorage.setItem(CURRICULUM_SELECTION_KEY, JSON.stringify(chosenSection));
    else localStorage.removeItem(CURRICULUM_SELECTION_KEY);
  }, [chosenSection]);

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
    setActiveTest(decodeTestTabId(incoming.id));
  }, []);

  const closeTab = useCallback((id: string) => {
    if (tabs.length <= 1) return;
    const idx = tabs.findIndex((tab) => tab.id === id);
    if (idx < 0) return;
    const closed = tabs[idx];
    const next = tabs.filter((tab) => tab.id !== id);
    setTabs(next);
    setClosedTabs((history) => [closed, ...history.filter((tab) => tab.id !== closed.id)].slice(0, 20));
    if (activeTabId === id) {
      setActiveTabId((next[Math.max(0, idx - 1)] ?? next[0]).id);
    }
  }, [activeTabId, tabs]);

  const newTab = useCallback(() => {
    const id = `home-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    openTab({ id, title: "New session", kind: "board" });
  }, [openTab]);

  const removeResourceTabs = useCallback((kind: Tab["kind"], contentId: string) => {
    const retained = tabs.filter((tab) =>
      !(tab.kind === kind && (tab.contentId ?? tab.id) === contentId)
    );
    const next = retained.length > 0 ? retained : [createDefaultTab()];
    setTabs(next);
    if (!next.some((tab) => tab.id === activeTabId)) setActiveTabId(next[0].id);
    // Deleted resources must never be recoverable as broken closed tabs.
    setClosedTabs((history) => history.filter((tab) =>
      !(tab.kind === kind && (tab.contentId ?? tab.id) === contentId)
    ));
  }, [activeTabId, tabs]);

  const renameResourceTabs = useCallback((kind: Tab["kind"], contentId: string, title: string) => {
    setTabs((current) => current.map((tab) =>
      tab.kind === kind && (tab.contentId ?? tab.id) === contentId ? { ...tab, title } : tab
    ));
    setClosedTabs((history) => history.map((tab) =>
      tab.kind === kind && (tab.contentId ?? tab.id) === contentId ? { ...tab, title } : tab
    ));
  }, []);

  const openTabContextMenu = useCallback((event: ReactMouseEvent, tab: Tab) => {
    event.preventDefault();
    event.stopPropagation();
    setShellContextMenu({
      type: "app_tab",
      x: event.clientX,
      y: event.clientY,
      data: { tab, pinned: tab.pinned === true, canReopen: closedTabs.length > 0 },
    });
  }, [closedTabs.length]);

  const handleTabContextAction = useCallback((actionId: string, data?: any) => {
    const target = (data?.tab as Tab | undefined)
      ?? tabs.find((tab) => tab.id === activeTabId)
      ?? tabs[0];
    if (actionId === "open_new_tab") {
      setBoard(null);
      newTab();
      return;
    }
    if (actionId === "close_all_tabs") {
      setBoard(null);
      setClosedTabs((history) => [
        ...tabs.slice().reverse(),
        ...history,
      ].filter((tab, index, all) => all.findIndex((item) => item.id === tab.id) === index).slice(0, 20));
      const fallback = createDefaultTab();
      setTabs([fallback]);
      setActiveTabId(fallback.id);
      setActiveTest(null);
      notify("Closed all tabs and opened a new Study tab");
      return;
    }
    if (actionId === "duplicate_tab" && target) {
      setBoard(null);
      const duplicate: Tab = {
        ...target,
        id: `${target.id}-copy-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
        contentId: target.contentId ?? target.id,
        pinned: false,
      };
      setTabs((current) => [...current, duplicate]);
      setActiveTabId(duplicate.id);
      setActiveTest(decodeTestTabId(duplicate.contentId ?? duplicate.id));
      notify(`Duplicated "${target.title}"`);
      return;
    }
    if (actionId === "pin_tab" && target) {
      setTabs((current) => {
        const selected = current.find((tab) => tab.id === target.id);
        if (!selected) return current;
        const toggled = { ...selected, pinned: !selected.pinned };
        const remainder = current.filter((tab) => tab.id !== selected.id);
        if (toggled.pinned) {
          const lastPinned = remainder.reduce((last, tab, index) => tab.pinned ? index : last, -1);
          return [...remainder.slice(0, lastPinned + 1), toggled, ...remainder.slice(lastPinned + 1)];
        }
        const firstUnpinned = remainder.findIndex((tab) => !tab.pinned);
        const insertion = firstUnpinned < 0 ? remainder.length : firstUnpinned;
        return [...remainder.slice(0, insertion), toggled, ...remainder.slice(insertion)];
      });
      notify(target.pinned ? `Unpinned "${target.title}"` : `Pinned "${target.title}"`);
      return;
    }
    if (actionId === "reopen_closed_tabs") {
      if (closedTabs.length === 0) return notify("No recently closed tabs");
      setBoard(null);
      const existingIds = new Set(tabs.map((tab) => tab.id));
      const reopened = closedTabs.slice().reverse().map((tab) => {
        if (!existingIds.has(tab.id)) {
          existingIds.add(tab.id);
          return tab;
        }
        const id = `${tab.id}-reopened-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`;
        existingIds.add(id);
        return { ...tab, id, contentId: tab.contentId ?? tab.id };
      });
      setTabs((current) => [...current, ...reopened]);
      setClosedTabs([]);
      const latest = reopened[reopened.length - 1];
      if (latest) {
        setActiveTabId(latest.id);
        setActiveTest(decodeTestTabId(latest.contentId ?? latest.id));
      }
      notify(`Reopened ${reopened.length} closed tab${reopened.length === 1 ? "" : "s"}`);
    }
  }, [activeTabId, closedTabs, newTab, notify, tabs]);

  const selectTab = useCallback((id: string) => {
    setActiveTabId(id);
    const tab = tabs.find((item) => item.id === id);
    setActiveTest(tab ? decodeTestTabId(tab.contentId ?? tab.id) : null);
  }, [tabs]);

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
    setTabs((current) => current.some((tab) => tab.id === "test-take")
      ? current
      : [...current, { id: "test-take", title: "Available tests", kind: "test" }]
    );
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

  const openGeneralContextMenu = (event: ReactMouseEvent) => {
    event.preventDefault();
    setShellContextMenu({
      type: "app_tab",
      x: event.clientX,
      y: event.clientY,
      data: {
        tab: activeTab,
        pinned: activeTab?.pinned === true,
        canReopen: closedTabs.length > 0,
      },
    });
  };

  /* ── Programming gets the prediction trainer, not a chalkboard ── */
  if (board && board.domain === "programming") {
    return (
      <div
        className="ambient flex h-screen w-screen flex-col overflow-hidden"
        onContextMenu={openGeneralContextMenu}
      >
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
        <ContextMenu
          target={shellContextMenu}
          onClose={() => setShellContextMenu(null)}
          onAction={handleTabContextAction}
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
  const isRunningTest = activeTab.kind === "test" &&
    (activeTab.contentId ?? activeTab.id).startsWith("test-run-") && activeTest != null;

  // Fullscreen exam mode — no sidebar, no top bar, no toolbar, nothing else.
  if (isRunningTest) {
    return (
      <div
        className="ambient h-screen w-screen overflow-hidden"
        onContextMenu={openGeneralContextMenu}
      >
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
        <ContextMenu
          target={shellContextMenu}
          onClose={() => setShellContextMenu(null)}
          onAction={handleTabContextAction}
        />
        <Toasts items={toasts} />
      </div>
    );
  }

  return (
    <div
      className="ambient flex h-screen flex-col overflow-hidden"
      onContextMenu={openGeneralContextMenu}
    >
      <TopBar
        tabs={tabs}
        activeTabId={activeTabId}
        onSelectTab={selectTab}
        onCloseTab={closeTab}
        onNewTab={newTab}
        onTabContextMenu={openTabContextMenu}
        onToggleSidebar={() => setSidebarOpen((v) => !v)}
        onNotify={notify}
      />

      <div className="flex min-h-0 flex-1">
        {sidebarOpen && (
          <Sidebar
            onNotify={notify}
            onOpenSearch={() => setSearchOpen(true)}
            onOpenSettings={openSettingsRoot}
            onOpenHelp={() => setHelpOpen(true)}
            onOpenMarketplace={() => openTab({ id: MARKETPLACE_TAB_ID, title: "Marketplace", kind: "marketplace" })}
            onOpenTab={openTab}
            onPastNoteDeleted={(id) => removeResourceTabs("note", `note-${id}`)}
            onPastNoteRenamed={(id, title) => renameResourceTabs("note", `note-${id}`, title)}
            onCurriculumDeleted={(id) => {
              removeResourceTabs("curriculum", `cur-${id}`);
              if (chosenSection?.sourceId === id) setChosenSection(null);
            }}
            onCurriculumRenamed={(id, title) => {
              renameResourceTabs("curriculum", `cur-${id}`, title);
              setChosenSection((selection) =>
                selection?.sourceId === id && selection.nodeId === null
                  ? { ...selection, label: title }
                  : selection
              );
            }}
          />
        )}

        {/* The Marketplace is a fixed, non-scrolling page: its shelf is a preview
            behind a notice, so letting the learner scroll a wall of blurred
            placeholder content would imply there is something down there to
            reach. Every other tab keeps its normal scroll. */}
        <div
          className={`relative flex-1 ${activeTab.kind === "marketplace"
              ? "flex min-h-0 flex-col overflow-hidden"
              : "overflow-y-auto"
            }`}
        >
          <div className="sticky top-0 z-20 shrink-0 bg-ink/85 backdrop-blur-sm">
            <Toolbar
              title={activeTab.title}
              onNotify={notify}
              onDuplicateTab={() => handleTabContextAction("duplicate_tab", { tab: activeTab })}
              onDeleteTab={() => closeTab(activeTab.id)}
              // Closing the last tab would leave the shell with nothing to
              // render, so the item is disabled rather than silently ignored.
              canDeleteTab={tabs.length > 1}
              starred={activeTab.starred === true}
              onToggleStar={() =>
                setTabs((current) =>
                  current.map((tab) =>
                    tab.id === activeTab.id ? { ...tab, starred: !tab.starred } : tab
                  )
                )
              }
            />
          </div>

          {activeTab.kind === "marketplace" ? (
            <MarketplacePage />
          ) : isBoardTab ? (
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
                  {chosenSection ? `Studying concept section: ${chosenSection.label}` : "Tell Studyus what to study"}
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
              onSelectSectionForStudy={(selection) => {
                setChosenSection(selection);
                const tutorTab = tabs.find((tab) => tab.id === HOME_TAB_ID)
                  ?? tabs.find((tab) => tab.kind === "board");
                if (tutorTab) {
                  setActiveTabId(tutorTab.id);
                } else {
                  const fallback = createDefaultTab();
                  setTabs([fallback, ...tabs]);
                  setActiveTabId(fallback.id);
                }
                setActiveTest(null);
                notify(`Switched to Tutor @[${selection.label}]`);
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
            const known = ["about", "appearance", "notifications", "models"];
            if (item.settingId === "tutor") notify("Tutor Studio is coming soon in a newer update");
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

      <HelpModal open={helpOpen} onClose={() => setHelpOpen(false)} />

      <ContextMenu
        target={shellContextMenu}
        onClose={() => setShellContextMenu(null)}
        onAction={handleTabContextAction}
      />

      <Toasts items={toasts} />
    </div>
  );
}
