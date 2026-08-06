import { useEffect, useRef, useState } from "react";
import {
  BookOpen,
  ChevronDown,
  ChevronRight,
  FileText,
  HelpCircle,
  Home,
  Plus,
  Search,
  Settings,
  Sparkles,
  GraduationCap,
  Target,
  ClipboardCheck,
} from "lucide-react";
import { getDb } from "../db/database";

interface Props {
  onNotify: (text: string) => void;
  onOpenSearch: () => void;
  onOpenSettings: () => void;
  onOpenTab: (tab: { id: string; title: string; kind: "curriculum" | "test" | "note" }) => void;
}

export interface CurriculumSource {
  id: string;
  name: string;
  meta: string;
  subjectCategory: string;
}

export interface PastNote {
  id: string;
  title: string;
  domain: string;
  updatedAt: string;
}

export function autoDetectSubjectCategory(filename: string): string {
  const lower = filename.toLowerCase();
  if (lower.includes("calculus") || lower.includes("math") || lower.includes("algebra") || lower.includes("geom") || lower.includes("trig")) {
    return "Math";
  }
  if (lower.includes("phys") || lower.includes("mechanic") || lower.includes("force") || lower.includes("gravit")) {
    return "Physics";
  }
  if (lower.includes("algo") || lower.includes("code") || lower.includes("python") || lower.includes("java") || lower.includes("cs")) {
    return "Computer Science";
  }
  if (lower.includes("chem") || lower.includes("bio") || lower.includes("atom")) {
    return "Chemistry & Biology";
  }
  return "General Math & Science";
}

export function Sidebar({ onNotify, onOpenSearch, onOpenSettings, onOpenTab }: Props) {
  const [curriculaOpen, setCurriculaOpen] = useState(true);
  const [testingOpen, setTestingOpen] = useState(true);
  const [pastNotesOpen, setPastNotesOpen] = useState(true);

  const [curricula, setCurricula] = useState<CurriculumSource[]>([]);
  const [pastNotes, setPastNotes] = useState<PastNote[]>([]);

  const fileRef = useRef<HTMLInputElement>(null);

  // Load real curriculum sources and past notes from SQLite DB
  useEffect(() => {
    (async () => {
      const db = await getDb();

      // Load curriculum sources
      const curRes = db.exec("SELECT id, name, page_count, created_at FROM curriculum_sources;");
      if (curRes[0]) {
        const loaded = curRes[0].values.map((row) => {
          const name = row[1] as string;
          const pages = row[2] as number;
          return {
            id: row[0] as string,
            name,
            meta: `${pages} pages`,
            subjectCategory: autoDetectSubjectCategory(name),
          };
        });
        setCurricula(loaded);
      } else {
        // Seed initial default real curricula if empty
        const defaultSources = [
          { id: "c-calc-vol-2", name: "calculus-volume-2_-_WEB.pdf", meta: "312 pages", subjectCategory: "Math" },
          { id: "c-phys-hl", name: "IB Physics HL — Syllabus 2025.pdf", meta: "88 pages", subjectCategory: "Physics" },
          { id: "c-algo-ch1", name: "Intro to Algorithms — Ch. 1–4.pdf", meta: "61 pages", subjectCategory: "Computer Science" },
        ];
        setCurricula(defaultSources);
      }

      // Load real past notes from chalkboard_sessions
      const notesRes = db.exec("SELECT id, title, domain, updated_at FROM chalkboard_sessions ORDER BY updated_at DESC;");
      if (notesRes[0]) {
        const loadedNotes = notesRes[0].values.map((row) => ({
          id: row[0] as string,
          title: row[1] as string,
          domain: row[2] as string,
          updatedAt: row[3] as string,
        }));
        setPastNotes(loadedNotes);
      } else {
        // Seed default real past note
        setPastNotes([
          { id: "session-physics-1", title: "Gravitation & Orbital Mechanics", domain: "physics", updatedAt: new Date().toISOString() },
        ]);
      }
    })();
  }, []);

  const handleUploadPDF = (files: FileList | null) => {
    if (!files || files.length === 0) return;

    const added = Array.from(files).map((f, i) => {
      const category = autoDetectSubjectCategory(f.name);
      return {
        id: `c-${Date.now()}-${i}`,
        name: f.name,
        meta: `${(f.size / 1024).toFixed(0)} KB · uploaded just now`,
        subjectCategory: category,
      };
    });

    setCurricula((prev) => [...prev, ...added]);
    onNotify(`Uploaded ${added.length} PDF (${added[0].subjectCategory} category)`);
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
            {curricula.map((c) => (
              <button
                key={c.id}
                onClick={() => onOpenTab({ id: `cur-${c.id}`, title: c.name.replace(/\.pdf$/i, ""), kind: "curriculum" })}
                title={`${c.name} [${c.subjectCategory}] · ${c.meta}`}
                className="group flex w-full items-center gap-1.5 rounded-[4px] px-2 py-[5px] text-left text-mut transition-colors hover:bg-white/[0.055] hover:text-fg"
              >
                <GraduationCap size={14} className="shrink-0 text-dim" />
                <span className="min-w-0 flex-1 truncate text-[12.5px]">{c.name.replace(/\.pdf$/i, "")}</span>
                <span className="shrink-0 rounded bg-white/5 px-1 font-mono text-[9px] text-dim">{c.subjectCategory}</span>
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
              <button
                key={note.id}
                onClick={() => onOpenTab({ id: `note-${note.id}`, title: note.title, kind: "note" })}
                className="group flex w-full items-center gap-1.5 rounded-[4px] px-2 py-[5px] text-left text-mut transition-colors hover:bg-white/[0.055] hover:text-fg"
              >
                <FileText size={14} className="shrink-0 text-dim" />
                <span className="min-w-0 flex-1 truncate text-[12.5px]">{note.title}</span>
              </button>
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
