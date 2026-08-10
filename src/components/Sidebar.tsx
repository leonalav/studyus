import { useEffect, useRef, useState } from "react";
import {
  BookOpen,
  ChevronDown,
  FileText,
  GraduationCap,
  ClipboardCheck,
  HelpCircle,
  Home,
  Plus,
  Search,
  Settings,
  Sparkles,
  Target,
  Trash2,
} from "lucide-react";
import { getDb } from "../db/database";
import { useCurricula } from "../state/curriculumStore";
import { deleteChalkboardSession } from "../api";
import { deleteStudySession } from "../state/studySessionStore";

interface Props {
  onNotify: (text: string) => void;
  onOpenSearch: () => void;
  onOpenSettings: () => void;
  onOpenTab: (tab: { id: string; title: string; kind: "curriculum" | "test" | "note" }) => void;
}

export interface PastNote {
  id: string;
  title: string;
  domain: string;
  updatedAt: string;
}

export function Sidebar({ onNotify, onOpenSearch, onOpenSettings, onOpenTab }: Props) {
  const [curriculaOpen, setCurriculaOpen] = useState(true);
  const [testingOpen, setTestingOpen] = useState(true);
  const [pastNotesOpen, setPastNotesOpen] = useState(true);

  const { curricula, addFiles } = useCurricula();
  const [pastNotes, setPastNotes] = useState<PastNote[]>([]);

  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    (async () => {
      const db = await getDb();
      const notesRes = db.exec("SELECT id, title, domain, updated_at FROM chalkboard_sessions ORDER BY updated_at DESC;");
      const loadedNotes = notesRes[0]?.values.map((row) => ({
        id: row[0] as string,
        title: row[1] as string,
        domain: row[2] as string,
        updatedAt: row[3] as string,
      })) ?? [];
      setPastNotes(loadedNotes);
    })();
  }, []);

  const handleUploadPDF = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    try {
      const added = await addFiles(files);
      if (added.length > 0) onNotify(`Imported ${added.length} PDF curriculum${added.length === 1 ? "" : "s"} with bookmark sections`);
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "PDF import failed");
    }
  };

  // Delete a past note from both stores it lives in: the SQLite chalkboard
  // session (whose transcript cascades) and the localStorage study-session
  // snapshot the home Recent-sessions list reads. Same id in both.
  const handleDeleteNote = async (note: PastNote) => {
    try {
      await deleteChalkboardSession(note.id);
      deleteStudySession(note.id);
      setPastNotes((current) => current.filter((n) => n.id !== note.id));
      onNotify(`Deleted "${note.title}"`);
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "Could not delete that note");
    }
  };

  const testingItems = [
    { id: "bank", label: "Question bank", icon: Target },
    { id: "available", label: "Available tests", icon: ClipboardCheck },
  ];

  return (
    <aside className="flex h-full w-[240px] shrink-0 flex-col border-r border-edge-soft bg-panel select-none">
      {/* Top nav */}
      <div className="space-y-[1px] px-2 pt-2.5">
        <button
          onClick={() => onNotify("Home selected")}
          className="flex w-full items-center gap-2 rounded-[4px] bg-white/[0.08] px-2 py-[5px] text-left text-[13px] font-medium text-fg"
        >
          <Home size={15} />
          Home
        </button>
        <button
          onClick={onOpenSearch}
          className="flex w-full items-center gap-2 rounded-[4px] px-2 py-[5px] text-left text-[13px] text-mut transition-colors hover:bg-white/[0.055] hover:text-fg"
        >
          <Search size={15} />
          Search
          <span className="ml-auto font-mono text-[10px] text-dim">⌘K</span>
        </button>
      </div>

      {/* Testing & Practice */}
      <div className="mt-3 border-t border-edge-soft px-2 pt-2.5">
        <button
          onClick={() => setTestingOpen((v) => !v)}
          className="mb-1 flex w-full items-center justify-between px-2 text-left"
        >
          <span className="font-mono text-[10px] uppercase tracking-wider text-dim">Testing & Practice</span>
          <ChevronDown size={12} className={`text-dim transition-transform ${testingOpen ? "" : "-rotate-90"}`} />
        </button>
        {testingOpen && (
          <div className="space-y-[1px]">
            <button
              onClick={() => onOpenTab({ id: "test-take", title: "Take a test", kind: "test" })}
              className="flex w-full items-center gap-2 rounded-[4px] px-2 py-[5px] text-left text-[13px] text-mut transition-colors hover:bg-white/[0.055] hover:text-fg"
            >
              <Sparkles size={14} />
              Take a test
            </button>
            {testingItems.map((item) => (
              <button
                key={item.id}
                onClick={() => onOpenTab({ id: `test-${item.id}`, title: item.label, kind: "test" })}
                className="flex w-full items-center gap-2 rounded-[4px] px-2 py-[5px] text-left text-[13px] text-mut transition-colors hover:bg-white/[0.055] hover:text-fg"
              >
                <item.icon size={14} />
                {item.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* CURRICULUM section with Chevron + Plus icon */}
      <div className="mt-3 flex min-h-0 shrink flex-col border-t border-edge-soft px-2 pt-2.5">
        <div className="mb-1 flex w-full items-center justify-between px-2">
          <button
            onClick={() => setCurriculaOpen((v) => !v)}
            className="flex items-center gap-1.5 text-left min-w-0"
          >
            <span className="font-mono text-[10px] uppercase tracking-wider text-dim">Curriculum</span>
            <ChevronDown size={12} className={`text-dim transition-transform ${curriculaOpen ? "" : "-rotate-90"}`} />
          </button>

          {/* Plus icon to upload real PDF curricula */}
          <button
            onClick={() => fileRef.current?.click()}
            className="grid h-5 w-5 place-items-center rounded text-dim transition-colors hover:bg-white/[0.08] hover:text-fg"
            title="Upload PDF Curriculum"
          >
            <Plus size={13} />
          </button>
        </div>

        <input
          ref={fileRef}
          type="file"
          accept="application/pdf,.pdf"
          multiple
          hidden
          onChange={(e) => {
            handleUploadPDF(e.target.files);
            if (fileRef.current) fileRef.current.value = "";
          }}
        />

        {curriculaOpen && (
          <div className="max-h-[180px] space-y-[1px] overflow-y-auto pt-1">
            {curricula.length === 0 && <p className="px-2 py-3 text-[11px] text-dim">No curriculum PDFs yet.</p>}
            {curricula.map((c) => (
              <button
                key={c.id}
                onClick={() => onOpenTab({ id: `cur-${c.id}`, title: c.name.replace(/\.pdf$/i, ""), kind: "curriculum" })}
                title={`${c.name} [${c.subject}] · ${c.pageCount} pages`}
                className="group flex w-full items-center gap-1.5 rounded-[4px] px-2 py-[5px] text-left text-mut transition-colors hover:bg-white/[0.055] hover:text-fg"
              >
                <GraduationCap size={14} className="shrink-0 text-dim" />
                <span className="min-w-0 flex-1 truncate text-[12.5px]">{c.name.replace(/\.pdf$/i, "")}</span>
                <span className="shrink-0 rounded bg-white/5 px-1 font-mono text-[9px] text-dim">{c.subject}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* PAST NOTES section (Renamed from Private, all mock placeholders removed) */}
      <div className="mt-3 flex min-h-0 flex-1 flex-col border-t border-edge-soft px-2 pt-2.5">
        <button
          onClick={() => setPastNotesOpen((v) => !v)}
          className="mb-1 flex w-full items-center justify-between px-2 text-left"
        >
          <span className="font-mono text-[10px] uppercase tracking-wider text-dim">Past Notes</span>
          <ChevronDown size={12} className={`text-dim transition-transform ${pastNotesOpen ? "" : "-rotate-90"}`} />
        </button>
        {pastNotesOpen && (
          <div className="min-h-0 flex-1 space-y-[1px] overflow-y-auto">
            {pastNotes.map((note) => (
              <div
                key={note.id}
                className="group flex w-full items-center gap-1.5 rounded-[4px] px-2 py-[5px] text-mut transition-colors hover:bg-white/[0.055] hover:text-fg"
              >
                <button
                  onClick={() => onOpenTab({ id: `note-${note.id}`, title: note.title, kind: "note" })}
                  className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                >
                  <FileText size={14} className="shrink-0 text-dim" />
                  <span className="min-w-0 flex-1 truncate text-[12.5px]">{note.title}</span>
                </button>
                <button
                  onClick={() => void handleDeleteNote(note)}
                  aria-label={`Delete ${note.title}`}
                  title="Delete note"
                  className="grid h-5 w-5 shrink-0 place-items-center rounded text-dim opacity-0 transition-all hover:bg-[#c42b1c]/15 hover:text-[#ff8b80] group-hover:opacity-100"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
            {pastNotes.length === 0 && (
              <p className="px-2 py-3 text-[11px] text-dim font-mono text-center">No past notes recorded yet.</p>
            )}
          </div>
        )}
      </div>

      {/* Bottom utilities (Trash & Invite buttons removed) */}
      <div className="space-y-[1px] border-t border-edge-soft px-2 py-2">
        <button
          onClick={onOpenSettings}
          className="flex w-full items-center gap-2 rounded-[4px] px-2 py-[5px] text-left text-[13px] text-mut transition-colors hover:bg-white/[0.055] hover:text-fg"
        >
          <Settings size={14} />
          Settings
          <span className="ml-auto font-mono text-[10px] text-dim">⌘,</span>
        </button>
        <button
          onClick={() => onNotify("Help documentation opened")}
          className="flex w-full items-center gap-2 rounded-[4px] px-2 py-[5px] text-left text-[13px] text-mut transition-colors hover:bg-white/[0.055] hover:text-fg"
        >
          <HelpCircle size={14} />
          Help
        </button>
      </div>

      <div className="border-t border-edge-soft px-2 py-2">
        <button
          onClick={() => onNotify("Library opened")}
          className="flex w-full items-center gap-2 rounded-[4px] px-2 py-[5px] text-left text-[13px] text-mut transition-colors hover:bg-white/[0.055] hover:text-fg"
        >
          <BookOpen size={14} />
          Library
        </button>
      </div>
    </aside>
  );
}
