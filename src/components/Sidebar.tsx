import { useRef, useState } from "react";
import {
  BookOpen,
  ChevronDown,
  ChevronRight,
  FileText,
  FolderClosed,
  FolderOpen,
  HelpCircle,
  Home,
  Plus,
  Search,
  Settings,
  Sparkles,
  Trash2,
  UserPlus,
  GraduationCap,
  FileUp,
  Target,
  ClipboardCheck,
} from "lucide-react";
import { PRIVATE_TREE, GROUPS_TREE, type TreeItem } from "../data/library";

interface Props {
  onNotify: (text: string) => void;
  onOpenSearch: () => void;
  onOpenSettings: () => void;
  onOpenTab: (tab: { id: string; title: string; kind: "curriculum" | "test" | "note" }) => void;
  onOpenProgramming: (curriculum: string) => void;
}

interface Curriculum {
  id: string;
  name: string;
  meta: string;
  subject?: "math" | "physics" | "chemistry" | "biology" | "programming";
}

const DEFAULT_CURRICULA: Curriculum[] = [
  { id: "c1", name: "AP Calculus BC — Course Guide.pdf", meta: "384 KB · 172 pages", subject: "math" },
  { id: "c2", name: "IB Physics HL — Syllabus 2025.pdf", meta: "212 KB · 88 pages", subject: "physics" },
  { id: "c3", name: "Intro to Algorithms — Ch. 1–4.pdf", meta: "1.2 MB · 61 pages", subject: "programming" },
];

function isProgrammingCurriculum(curriculum: Curriculum) {
  return curriculum.subject === "programming" || /algorithm|program|python|javascript|coding|data structure/i.test(curriculum.name);
}

function TreeNode({
  item,
  depth = 0,
  onNotify,
  onOpenTab,
}: {
  item: TreeItem;
  depth?: number;
  onNotify: (text: string) => void;
  onOpenTab: Props["onOpenTab"];
}) {
  const [open, setOpen] = useState(depth < 1);
  const pad = 8 + depth * 14;

  if (item.type === "note") {
    return (
      <button
        onClick={() => onOpenTab({ id: `note-${item.label}`, title: item.label, kind: "note" })}
        className="group flex w-full items-center gap-1.5 rounded-[4px] py-[5px] text-left text-mut transition-colors hover:bg-white/[0.055] hover:text-fg"
        style={{ paddingLeft: pad }}
      >
        <FileText size={14} className="shrink-0 text-dim" />
        <span className="min-w-0 flex-1 truncate text-[13px]">{item.label}</span>
      </button>
    );
  }

  return (
    <div>
      <button
        onClick={() => setOpen((v) => !v)}
        className="group flex w-full items-center gap-1.5 rounded-[4px] py-[5px] text-left text-mut transition-colors hover:bg-white/[0.055] hover:text-fg"
        style={{ paddingLeft: pad }}
      >
        <ChevronRight size={12} className={`shrink-0 text-dim transition-transform ${open ? "rotate-90" : ""}`} />
        {open ? (
          <FolderOpen size={14} className="shrink-0 text-dim" />
        ) : (
          <FolderClosed size={14} className="shrink-0 text-dim" />
        )}
        <span className="min-w-0 flex-1 truncate text-[13px]">{item.label}</span>
      </button>
      {open && (
        <div>
          {item.children.map((child) => (
            <TreeNode key={child.label} item={child} depth={depth + 1} onNotify={onNotify} onOpenTab={onOpenTab} />
          ))}
        </div>
      )}
    </div>
  );
}

export function Sidebar({ onNotify, onOpenSearch, onOpenSettings, onOpenTab, onOpenProgramming }: Props) {
  const [privateOpen, setPrivateOpen] = useState(true);
  const [teamOpen, setTeamOpen] = useState(true);
  const [curriculaOpen, setCurriculaOpen] = useState(true);
  const [testingOpen, setTestingOpen] = useState(true);
  const [curricula, setCurricula] = useState<Curriculum[]>(DEFAULT_CURRICULA);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleUpload = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const added = Array.from(files).map((f, i) => ({
      id: `c-${Date.now()}-${i}`,
      name: f.name,
      meta: `${(f.size / 1024).toFixed(0)} KB · uploaded just now`,
      subject: /algorithm|program|python|javascript|coding|data structure/i.test(f.name)
        ? ("programming" as const)
        : undefined,
    }));
    setCurricula((c) => [...c, ...added]);
    onNotify(`Added ${added.length} curriculum ${added.length === 1 ? "PDF" : "PDFs"}`);
  };

  const testingItems = [
    { id: "bank", label: "Question bank", icon: Target },
    { id: "available", label: "Available tests", icon: ClipboardCheck },
  ];

  return (
    <aside className="flex h-full w-[240px] shrink-0 flex-col border-r border-edge-soft bg-panel">
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

      {/* Testing & Practice (was AI Tutor) */}
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

      {/* Curriculum */}
      <div className="mt-3 flex min-h-0 shrink flex-col border-t border-edge-soft px-2 pt-2.5">
        <button
          onClick={() => setCurriculaOpen((v) => !v)}
          className="mb-1 flex w-full items-center justify-between px-2 text-left"
        >
          <span className="font-mono text-[10px] uppercase tracking-wider text-dim">Curriculum</span>
          <ChevronDown size={12} className={`text-dim transition-transform ${curriculaOpen ? "" : "-rotate-90"}`} />
        </button>
        {curriculaOpen && (
          <div className="max-h-[150px] space-y-[1px] overflow-y-auto">
            {curricula.map((c) => (
              <button
                key={c.id}
                onClick={() => {
                  const title = c.name.replace(/\.pdf$/i, "");
                  if (isProgrammingCurriculum(c)) onOpenProgramming(title);
                  else onOpenTab({ id: `cur-${c.id}`, title, kind: "curriculum" });
                }}
                title={isProgrammingCurriculum(c) ? `${c.meta} · opens Parsons` : c.meta}
                className="group flex w-full items-center gap-1.5 rounded-[4px] px-2 py-[5px] text-left text-mut transition-colors hover:bg-white/[0.055] hover:text-fg"
              >
                <GraduationCap size={14} className={`shrink-0 ${isProgrammingCurriculum(c) ? "text-[#fcd34d]" : "text-dim"}`} />
                <span className="min-w-0 flex-1 truncate text-[13px]">{c.name.replace(/\.pdf$/i, "")}</span>
                {isProgrammingCurriculum(c) && <span className="font-mono text-[9px] text-[#fcd34d]/70">P</span>}
              </button>
            ))}
            <p className="px-2 py-1 font-mono text-[9.5px] leading-relaxed text-dim">
              <span className="text-[#fcd34d]">P</span> programming curricula open the Parsons suite
            </p>
            <input
              ref={fileRef}
              type="file"
              accept="application/pdf,.pdf"
              multiple
              hidden
              onChange={(e) => {
                handleUpload(e.target.files);
                if (fileRef.current) fileRef.current.value = "";
              }}
            />
            <button
              onClick={() => fileRef.current?.click()}
              className="flex w-full items-center gap-1.5 rounded-[4px] px-2 py-[5px] text-left text-[13px] text-dim transition-colors hover:bg-white/[0.055] hover:text-mut"
            >
              <FileUp size={13} />
              Add curriculum PDF
            </button>
          </div>
        )}
      </div>

      {/* Private */}
      <div className="mt-3 flex min-h-0 flex-1 flex-col border-t border-edge-soft px-2 pt-2.5">
        <button
          onClick={() => setPrivateOpen((v) => !v)}
          className="mb-1 flex w-full items-center justify-between px-2 text-left"
        >
          <span className="font-mono text-[10px] uppercase tracking-wider text-dim">Private</span>
          <ChevronDown size={12} className={`text-dim transition-transform ${privateOpen ? "" : "-rotate-90"}`} />
        </button>
        {privateOpen && (
          <div className="min-h-0 flex-1 space-y-[1px] overflow-y-auto">
            {PRIVATE_TREE.map((item) => (
              <TreeNode key={item.label} item={item} onNotify={onNotify} onOpenTab={onOpenTab} />
            ))}
            <button
              onClick={() => onNotify("Create a new folder or note")}
              className="flex w-full items-center gap-1.5 rounded-[4px] px-2 py-[5px] text-left text-[13px] text-dim transition-colors hover:bg-white/[0.055] hover:text-mut"
            >
              <Plus size={13} />
              Add new
            </button>
          </div>
        )}
      </div>

      {/* Study groups */}
      <div className="mt-3 flex min-h-0 shrink flex-col border-t border-edge-soft px-2 pt-2.5">
        <button
          onClick={() => setTeamOpen((v) => !v)}
          className="mb-1 flex w-full items-center justify-between px-2 text-left"
        >
          <span className="font-mono text-[10px] uppercase tracking-wider text-dim">Study Groups</span>
          <ChevronDown size={12} className={`text-dim transition-transform ${teamOpen ? "" : "-rotate-90"}`} />
        </button>
        {teamOpen && (
          <div className="max-h-[170px] space-y-[1px] overflow-y-auto">
            {GROUPS_TREE.map((item) => (
              <TreeNode key={item.label} item={item} onNotify={onNotify} onOpenTab={onOpenTab} />
            ))}
          </div>
        )}
      </div>

      {/* Bottom utilities */}
      <div className="space-y-[1px] border-t border-edge-soft px-2 py-2">
        <button
          onClick={onOpenSettings}
          className="flex w-full items-center gap-2 rounded-[4px] px-2 py-[5px] text-left text-[13px] text-mut transition-colors hover:bg-white/[0.055] hover:text-fg"
        >
          <Settings size={14} />
          Settings
          <span className="ml-auto font-mono text-[10px] text-dim">⌘,</span>
        </button>
        {[
          { label: "Invite classmates", icon: UserPlus },
          { label: "Help", icon: HelpCircle },
          { label: "Trash", icon: Trash2 },
        ].map((item) => (
          <button
            key={item.label}
            onClick={() => onNotify(`${item.label} opened`)}
            className="flex w-full items-center gap-2 rounded-[4px] px-2 py-[5px] text-left text-[13px] text-mut transition-colors hover:bg-white/[0.055] hover:text-fg"
          >
            <item.icon size={14} />
            {item.label}
          </button>
        ))}
      </div>

      {/* Quiet Books link — extra learning shortcut */}
      <div className="border-t border-edge-soft px-2 py-2">
        <button
          onClick={() => onNotify("Library — coming up")}
          className="flex w-full items-center gap-2 rounded-[4px] px-2 py-[5px] text-left text-[13px] text-mut transition-colors hover:bg-white/[0.055] hover:text-fg"
        >
          <BookOpen size={14} />
          Library
        </button>
      </div>
    </aside>
  );
}
