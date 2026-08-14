import { useEffect, useMemo, useRef, useState } from "react";
import {
  Search,
  BookOpen,
  Rocket,
  PencilRuler,
  GraduationCap,
  Keyboard,
  MessageCircleQuestion,
  ChevronRight,
  ArrowLeft,
  X,
} from "lucide-react";

interface Props {
  open: boolean;
  onClose: () => void;
}

interface HelpArticle {
  id: string;
  title: string;
  summary: string;
  /** Rendered as paragraphs; a leading "- " makes a bullet. */
  body: string[];
}

interface HelpTopic {
  id: string;
  label: string;
  icon: typeof BookOpen;
  blurb: string;
  articles: HelpArticle[];
}

/**
 * Help content.
 *
 * Written against what the app actually does today. Every article here
 * describes a behaviour that exists — a help centre that documents aspirations
 * is worse than none, because it teaches the learner to distrust it.
 */
const TOPICS: HelpTopic[] = [
  {
    id: "start",
    label: "Getting started",
    icon: Rocket,
    blurb: "Import your material and open your first session.",
    articles: [
      {
        id: "import",
        title: "Import a curriculum",
        summary: "Studyus teaches from your own PDFs.",
        body: [
          "Open the Curriculum section in the sidebar and press the + button, or use the Import button on the home screen when no curriculum is loaded yet.",
          "Studyus reads the PDF's bookmarks to build a section tree, so you can point a session at one subsection rather than a whole textbook.",
          "- Without a curriculum the tutor still works, but it teaches from general knowledge and cannot follow your syllabus or quote your material.",
        ],
      },
      {
        id: "first-session",
        title: "Start a study session",
        summary: "Pick a concept, answer the intake, and the board opens.",
        body: [
          "Choose a subject, PDF and concept from the picker beside the Tutor heading, then write what you want to work on.",
          "Your counsellor asks a short set of questions before teaching begins. They calibrate the session to you — skip any or all of them if you would rather start immediately.",
          "Studyus then transcribes the pages for that section and prepares the chalkboard. The progress bar tracks real work, not a timer.",
        ],
      },
    ],
  },
  {
    id: "board",
    label: "The chalkboard",
    icon: PencilRuler,
    blurb: "How the board, widgets and threads behave.",
    articles: [
      {
        id: "widgets",
        title: "Study widgets",
        summary: "The tutor teaches by placing interactive cards.",
        body: [
          "Questions, hints, examples, scratchpads and mastery cards are placed by the tutor as it teaches. Answering one is your turn — the tutor responds to what you did.",
          "Some cards arrive as a set, marked with a badge such as Set 1/3. Answer every card in the set and the tutor replies once, considering all of your answers together.",
          "- Moving a slider or opening a hint never interrupts the tutor. Only committing an answer does.",
        ],
      },
      {
        id: "navigation",
        title: "Moving around the board",
        summary: "Pan, zoom and open side threads.",
        body: [
          "Drag empty space to pan and hold Ctrl or Cmd while scrolling to zoom. The zoom control sits in the bottom-left corner.",
          "Selecting text on the board lets you open a thread — a linked child board for a tangent, so the main lesson keeps its shape.",
        ],
      },
      {
        id: "cant-see",
        title: "Something did not render",
        summary: "Ask the tutor to redraw it.",
        body: [
          "Tell the tutor you cannot see it. It can redraw a single block without changing what the block says.",
          "If a second redraw still fails, ask for the same content in another form — the tutor will place it differently rather than repeating itself.",
        ],
      },
    ],
  },
  {
    id: "mastery",
    label: "Mastery & progress",
    icon: GraduationCap,
    blurb: "How Studyus decides you have learned something.",
    articles: [
      {
        id: "stages",
        title: "The six stages",
        summary: "Encounter, Understand, Construct, Apply, Transfer, Master.",
        body: [
          "Each stage has an exit condition. You advance when your work shows the condition is met — never because you pressed next.",
          "Going backwards is normal. A confident wrong answer during Apply sends you back to Understand, which is the system working.",
        ],
      },
      {
        id: "verdict",
        title: "Why there is no percentage",
        summary: "Mastery is judged on five kinds of evidence.",
        body: [
          "Studyus reports Recall, Understanding, Procedure, Transfer and Independence separately, and names the weakest of the five.",
          "A single score would hide the thing you actually need to fix, so the app never reduces mastery to one number.",
          "- Mastery is not permanent. Retrieval checks resurface old material, and forgetting routes you back through targeted repair.",
        ],
      },
    ],
  },
  {
    id: "shortcuts",
    label: "Keyboard shortcuts",
    icon: Keyboard,
    blurb: "Move faster.",
    articles: [
      {
        id: "keys",
        title: "Shortcuts",
        summary: "The ones worth memorising.",
        body: [
          "- Cmd/Ctrl K — open search",
          "- Cmd/Ctrl , — open settings",
          "- Enter — send your message; Shift+Enter for a new line",
          "- Esc — close a modal or the chalkboard chat dock",
          "- Cmd/Ctrl + scroll — zoom the board",
        ],
      },
    ],
  },
];

export function HelpModal({ open, onClose }: Props) {
  const [query, setQuery] = useState("");
  const [topicId, setTopicId] = useState<string | null>(null);
  const [articleId, setArticleId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setTopicId(null);
    setArticleId(null);
    window.setTimeout(() => inputRef.current?.focus(), 30);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  /** Flat article list, used only while searching. */
  const matches = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return [];
    return TOPICS.flatMap((topic) =>
      topic.articles
        .filter(
          (article) =>
            article.title.toLowerCase().includes(term) ||
            article.summary.toLowerCase().includes(term) ||
            article.body.some((line) => line.toLowerCase().includes(term))
        )
        .map((article) => ({ topic, article }))
    );
  }, [query]);

  if (!open) return null;

  const topic = TOPICS.find((item) => item.id === topicId) ?? null;
  const article = topic?.articles.find((item) => item.id === articleId) ?? null;

  return (
    <div
      className="fixed inset-0 z-[80] flex justify-center bg-black/45 px-4 pt-[8vh]"
      onMouseDown={onClose}
    >
      <div
        onMouseDown={(e) => e.stopPropagation()}
        className="anim-toast flex h-fit max-h-[76vh] w-[min(680px,100%)] flex-col overflow-hidden rounded-xl border border-edge bg-panel shadow-[0_28px_80px_rgba(0,0,0,0.45)]"
      >
        {/* header */}
        <div className="flex items-center gap-3 border-b border-edge-soft px-4 py-3.5">
          {article || topic ? (
            <button
              onClick={() => (article ? setArticleId(null) : setTopicId(null))}
              className="grid h-6 w-6 shrink-0 place-items-center rounded text-dim transition-colors hover:bg-white/[0.07] hover:text-fg"
              aria-label="Back"
            >
              <ArrowLeft size={15} />
            </button>
          ) : (
            <MessageCircleQuestion size={17} className="shrink-0 text-mut" />
          )}
          <span className="min-w-0 flex-1 truncate text-[14.5px] font-semibold text-fg">
            {article ? article.title : topic ? topic.label : "Help"}
          </span>
          <button
            onClick={onClose}
            className="grid h-6 w-6 shrink-0 place-items-center rounded text-dim transition-colors hover:bg-white/[0.07] hover:text-fg"
            aria-label="Close help"
          >
            <X size={15} />
          </button>
        </div>

        {/* search — hidden while reading a single article, where it would only
            be a way to lose your place */}
        {!article && (
          <div className="flex items-center gap-2.5 border-b border-edge-soft px-4 py-2.5">
            <Search size={15} className="shrink-0 text-dim" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search help…"
              className="min-w-0 flex-1 bg-transparent text-[13.5px] text-fg outline-none placeholder:text-[#6e6e6c]"
            />
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {/* search results cut across topics */}
          {query.trim() ? (
            matches.length === 0 ? (
              <p className="px-2.5 py-8 text-center text-[12.5px] text-dim">
                Nothing in Help matches “{query.trim()}”.
              </p>
            ) : (
              matches.map(({ topic: parent, article: found }) => (
                <button
                  key={`${parent.id}-${found.id}`}
                  onClick={() => {
                    setTopicId(parent.id);
                    setArticleId(found.id);
                    setQuery("");
                  }}
                  className="flex w-full items-start gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors hover:bg-white/[0.06]"
                >
                  <parent.icon size={14} className="mt-[3px] shrink-0 text-dim" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] text-fg">{found.title}</span>
                    <span className="block truncate text-[11.5px] text-dim">
                      {parent.label} · {found.summary}
                    </span>
                  </span>
                </button>
              ))
            )
          ) : article ? (
            <div className="space-y-2.5 px-2.5 py-2">
              <p className="text-[12.5px] text-mut">{article.summary}</p>
              {article.body.map((line, index) =>
                line.startsWith("- ") ? (
                  <p key={index} className="flex gap-2 text-[13px] leading-relaxed text-fg/85">
                    <span className="text-dim">•</span>
                    <span>{line.slice(2)}</span>
                  </p>
                ) : (
                  <p key={index} className="text-[13px] leading-relaxed text-fg/85">
                    {line}
                  </p>
                )
              )}
            </div>
          ) : topic ? (
            topic.articles.map((item) => (
              <button
                key={item.id}
                onClick={() => setArticleId(item.id)}
                className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors hover:bg-white/[0.06]"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] text-fg">{item.title}</span>
                  <span className="block truncate text-[11.5px] text-dim">{item.summary}</span>
                </span>
                <ChevronRight size={14} className="shrink-0 text-dim" />
              </button>
            ))
          ) : (
            TOPICS.map((item) => (
              <button
                key={item.id}
                onClick={() => setTopicId(item.id)}
                className="flex w-full items-center gap-3 rounded-md px-2.5 py-2.5 text-left transition-colors hover:bg-white/[0.06]"
              >
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-white/[0.06] text-mut">
                  <item.icon size={15} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium text-fg">{item.label}</span>
                  <span className="block truncate text-[11.5px] text-dim">{item.blurb}</span>
                </span>
                <ChevronRight size={14} className="shrink-0 text-dim" />
              </button>
            ))
          )}
        </div>

        <div className="flex items-center justify-between border-t border-edge-soft px-4 py-2">
          <span className="text-[11.5px] text-dim">Studyus Help</span>
          <span className="flex items-center gap-1.5 text-[11.5px] text-dim">
            <kbd className="font-mono text-[11px] text-mut">Esc</kbd> to close
          </span>
        </div>
      </div>
    </div>
  );
}
