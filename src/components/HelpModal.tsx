import { useEffect, useMemo, useRef, useState } from "react";
import { MessageCircleQuestion } from "lucide-react";

interface Props {
  open: boolean;
  onClose: () => void;
}

/**
 * One block of article content.
 *
 * `image` is the slot the author drops a screenshot into. It takes a path
 * served from `public/` (e.g. "/help/import-curriculum.png") so images can be
 * added later without touching this file's structure — and a block whose image
 * has not been supplied yet renders as a labelled placeholder rather than a
 * broken <img>, so a half-finished article still reads correctly.
 */
type Block =
  | { kind: "text"; text: string }
  | { kind: "bullets"; items: string[] }
  | { kind: "step"; title: string; text: string }
  | { kind: "note"; text: string }
  | { kind: "image"; src?: string; caption: string };

interface HelpArticle {
  id: string;
  title: string;
  summary: string;
  blocks: Block[];
}

interface HelpTopic {
  id: string;
  label: string;
  blurb: string;
  articles: HelpArticle[];
}

/**
 * Help content.
 *
 * Every article describes behaviour that exists today. A help centre that
 * documents aspirations is worse than none: it teaches the reader to distrust
 * it.
 */
const TOPICS: HelpTopic[] = [
  {
    id: "start",
    label: "Getting started",
    blurb: "Import your material and open your first session.",
    articles: [
      {
        id: "import",
        title: "Import a curriculum",
        summary: "Studyus teaches from your own PDFs, so this is the first thing to do.",
        blocks: [
          {
            kind: "text",
            text: "Studyus grounds every session in material you supply. Without a curriculum the tutor still works, but it teaches from general knowledge — it cannot follow your syllabus, quote your textbook, or judge mastery against what you are actually assessed on.",
          },
          {
            kind: "step",
            title: "Open the Curriculum section",
            text: "In the sidebar, find Curriculum and press the + button on its header row. You can also use the Import button in the notice on the home screen when nothing has been imported yet.",
          },
          { kind: "image", caption: "The Curriculum section in the sidebar, with the + button highlighted." },
          {
            kind: "step",
            title: "Choose one or more PDFs",
            text: "Select any number of PDF files. Studyus reads each file's bookmarks to build a section tree, so you can later point a session at a single subsection instead of a whole textbook.",
          },
          { kind: "image", caption: "A PDF's bookmark tree, expanded into concepts and subconcepts." },
          {
            kind: "step",
            title: "Pick a concept when you start studying",
            text: "Use the picker beside the Tutor heading to choose a subject, then a PDF, then the concept you want to work on. That choice is what the tutor reads and grounds its teaching in.",
          },
          {
            kind: "note",
            text: "A PDF with no bookmarks still imports, but it will have no section tree — you can study the whole document rather than one part of it.",
          },
        ],
      },
      {
        id: "first-session",
        title: "Start a study session",
        summary: "Pick a concept, answer the intake, and the board opens.",
        blocks: [
          {
            kind: "text",
            text: "Choose what you want to work on and write it to Studyus. Before teaching begins, your counsellor asks a short set of questions to calibrate the session to you.",
          },
          { kind: "image", caption: "The counsellor's intake questions in the composer." },
          {
            kind: "bullets",
            items: [
              "Answer one question per line, in order.",
              "Skip any or all of them — write \"skip\" or just leave the line out.",
              "Studyus then transcribes the pages for your section and prepares the chalkboard.",
            ],
          },
          {
            kind: "note",
            text: "The progress bar during preparation tracks real work — pages actually transcribed — not a timer. A section you have studied before is cached and passes through almost instantly.",
          },
        ],
      },
    ],
  },
  {
    id: "board",
    label: "The chalkboard",
    blurb: "How the board, widgets and threads behave.",
    articles: [
      {
        id: "widgets",
        title: "Study widgets",
        summary: "The tutor teaches by placing interactive cards, not by writing paragraphs.",
        blocks: [
          {
            kind: "text",
            text: "Questions, hints, examples, scratchpads and mastery cards are placed by the tutor as it teaches. Answering one is your turn — the tutor responds to what you did.",
          },
          { kind: "image", caption: "A question widget with its options and Check button." },
          {
            kind: "text",
            text: "Some cards arrive as a set, marked with a badge such as Set 1/3. Answer every card in the set and the tutor replies once, judging your answers together — the pattern across them is more informative than any single answer.",
          },
          { kind: "image", caption: "Three grouped question cards showing the Set badge and progress footer." },
          {
            kind: "bullets",
            items: [
              "Moving a slider, playing an animation or opening a hint never interrupts the tutor.",
              "Only committing an answer does.",
              "Which hint level you opened is recorded — it is how independence is measured.",
            ],
          },
        ],
      },
      {
        id: "navigation",
        title: "Moving around the board",
        summary: "Pan, zoom and open side threads.",
        blocks: [
          {
            kind: "bullets",
            items: [
              "Drag empty space to pan.",
              "Hold Ctrl or Cmd and scroll to zoom, or use the control in the bottom-left corner.",
              "Select text on the board to open a thread — a linked child board for a tangent, so the main lesson keeps its shape.",
            ],
          },
          { kind: "image", caption: "A thread opened from a selection on the main board." },
        ],
      },
      {
        id: "cant-see",
        title: "Something did not render",
        summary: "Ask the tutor to redraw it.",
        blocks: [
          {
            kind: "text",
            text: "Tell the tutor you cannot see it — \"the widget is blank\", \"the diagram didn't load\". It can redraw a single block without changing what that block says.",
          },
          {
            kind: "note",
            text: "If a second redraw still fails, ask for the same content in another form. The tutor will place it differently rather than repeating a redraw that is not working.",
          },
        ],
      },
    ],
  },
  {
    id: "mastery",
    label: "Mastery and progress",
    blurb: "How Studyus decides you have learned something.",
    articles: [
      {
        id: "stages",
        title: "The six stages",
        summary: "Encounter, Understand, Construct, Apply, Transfer, Master.",
        blocks: [
          {
            kind: "text",
            text: "Each stage has an exit condition. You advance when your work shows that condition is met — never because you pressed next.",
          },
          { kind: "image", caption: "A roadmap widget showing the six stages with the current one marked." },
          {
            kind: "note",
            text: "Going backwards is normal. A confident wrong answer during Apply sends you back to Understand — that is the system working, not a penalty.",
          },
        ],
      },
      {
        id: "verdict",
        title: "Why there is no percentage",
        summary: "Mastery is judged on five kinds of evidence, and reported by its weakest link.",
        blocks: [
          {
            kind: "text",
            text: "Studyus reports Recall, Understanding, Procedure, Transfer and Independence separately, and names the weakest of the five. A single score would hide the one thing you actually need to fix.",
          },
          { kind: "image", caption: "A mastery card showing the five evidence dimensions." },
          {
            kind: "bullets",
            items: [
              "Mastery is never declared from a raw score.",
              "It is not permanent — retrieval checks resurface old material.",
              "Detected forgetting routes you back through targeted repair, not a restart.",
            ],
          },
        ],
      },
    ],
  },
  {
    id: "shortcuts",
    label: "Keyboard shortcuts",
    blurb: "Move faster.",
    articles: [
      {
        id: "keys",
        title: "Shortcuts",
        summary: "The ones worth memorising.",
        blocks: [
          {
            kind: "bullets",
            items: [
              "Cmd/Ctrl K — open search",
              "Cmd/Ctrl , — open settings",
              "Enter — send your message; Shift+Enter for a new line",
              "Esc — close a modal, or the chalkboard chat dock",
              "Cmd/Ctrl + scroll — zoom the board",
            ],
          },
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
  const bodyRef = useRef<HTMLDivElement>(null);

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

  // Opening an article should start at its top, not wherever the list was.
  useEffect(() => {
    if (articleId && bodyRef.current) bodyRef.current.scrollTop = 0;
  }, [articleId]);

  const matches = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return [];
    const hit = (block: Block) => {
      if (block.kind === "bullets") return block.items.some((item) => item.toLowerCase().includes(term));
      if (block.kind === "image") return block.caption.toLowerCase().includes(term);
      if (block.kind === "step") return `${block.title} ${block.text}`.toLowerCase().includes(term);
      return block.text.toLowerCase().includes(term);
    };
    return TOPICS.flatMap((topic) =>
      topic.articles
        .filter(
          (article) =>
            article.title.toLowerCase().includes(term) ||
            article.summary.toLowerCase().includes(term) ||
            article.blocks.some(hit)
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
        {/* header — the question mark is the only icon in Help */}
        <div className="flex items-center gap-2.5 border-b border-edge-soft px-4 py-3.5">
          <MessageCircleQuestion size={17} className="shrink-0 text-mut" />
          <span className="min-w-0 flex-1 truncate text-[14.5px] font-semibold text-fg">Help</span>
          <button
            onClick={onClose}
            className="rounded px-1.5 py-0.5 text-[11.5px] text-dim transition-colors hover:bg-white/[0.07] hover:text-fg"
            aria-label="Close help"
          >
            Esc
          </button>
        </div>

        {/* breadcrumb — the way back, without an icon */}
        {(topic || article) && (
          <div className="flex items-center gap-1.5 border-b border-edge-soft px-4 py-2 text-[11.5px]">
            <button onClick={() => { setTopicId(null); setArticleId(null); }} className="text-dim transition-colors hover:text-fg">
              Help
            </button>
            <span className="text-faint">/</span>
            {article ? (
              <>
                <button onClick={() => setArticleId(null)} className="text-dim transition-colors hover:text-fg">
                  {topic?.label}
                </button>
                <span className="text-faint">/</span>
                <span className="min-w-0 truncate text-mut">{article.title}</span>
              </>
            ) : (
              <span className="min-w-0 truncate text-mut">{topic?.label}</span>
            )}
          </div>
        )}

        {!article && (
          <div className="border-b border-edge-soft px-4 py-2.5">
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search help…"
              className="w-full bg-transparent text-[13.5px] text-fg outline-none placeholder:text-[#6e6e6c]"
            />
          </div>
        )}

        <div ref={bodyRef} className="min-h-0 flex-1 overflow-y-auto">
          {query.trim() ? (
            <div className="p-2">
              {matches.length === 0 ? (
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
                    className="block w-full rounded-md px-2.5 py-2 text-left transition-colors hover:bg-white/[0.06]"
                  >
                    <span className="block truncate text-[13px] text-fg">{found.title}</span>
                    <span className="block truncate text-[11.5px] text-dim">
                      {parent.label} · {found.summary}
                    </span>
                  </button>
                ))
              )}
            </div>
          ) : article ? (
            <article className="px-5 py-4">
              <h2 className="text-[19px] font-semibold leading-tight text-fg">{article.title}</h2>
              <p className="mt-1 text-[12.5px] leading-relaxed text-mut">{article.summary}</p>
              <div className="mt-4 space-y-3.5">
                {article.blocks.map((block, index) => (
                  <ArticleBlock key={index} block={block} />
                ))}
              </div>
            </article>
          ) : topic ? (
            <div className="p-2">
              {topic.articles.map((item) => (
                <button
                  key={item.id}
                  onClick={() => setArticleId(item.id)}
                  className="block w-full rounded-md px-2.5 py-2 text-left transition-colors hover:bg-white/[0.06]"
                >
                  <span className="block truncate text-[13px] text-fg">{item.title}</span>
                  <span className="block truncate text-[11.5px] text-dim">{item.summary}</span>
                </button>
              ))}
            </div>
          ) : (
            <div className="p-2">
              {TOPICS.map((item) => (
                <button
                  key={item.id}
                  onClick={() => setTopicId(item.id)}
                  className="block w-full rounded-md px-2.5 py-2.5 text-left transition-colors hover:bg-white/[0.06]"
                >
                  <span className="block truncate text-[13px] font-medium text-fg">{item.label}</span>
                  <span className="block truncate text-[11.5px] text-dim">{item.blurb}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** One rendered content block. */
function ArticleBlock({ block }: { block: Block }) {
  switch (block.kind) {
    case "text":
      return <p className="text-[13px] leading-relaxed text-fg/85">{block.text}</p>;

    case "bullets":
      return (
        <ul className="space-y-1.5">
          {block.items.map((item, index) => (
            <li key={index} className="flex gap-2 text-[13px] leading-relaxed text-fg/85">
              <span className="select-none text-dim">•</span>
              <span className="min-w-0 flex-1">{item}</span>
            </li>
          ))}
        </ul>
      );

    case "step":
      return (
        <div className="rounded-md border border-edge bg-raise/50 px-3 py-2.5">
          <p className="text-[13px] font-medium text-fg">{block.title}</p>
          <p className="mt-1 text-[12.5px] leading-relaxed text-mut">{block.text}</p>
        </div>
      );

    case "note":
      return (
        <div className="rounded-md border-l-2 border-accent/50 bg-white/[0.03] px-3 py-2">
          <p className="text-[12.5px] leading-relaxed text-mut">{block.text}</p>
        </div>
      );

    case "image":
      // The slot. With a src it is the screenshot; without one it is an
      // explicit, labelled gap so an unfinished article still reads correctly
      // and it is obvious which picture is missing.
      return (
        <figure className="m-0">
          {block.src ? (
            <img
              src={block.src}
              alt={block.caption}
              loading="lazy"
              className="w-full rounded-md border border-edge bg-ink object-contain"
            />
          ) : (
            <div className="grid h-[132px] place-items-center rounded-md border border-dashed border-edge bg-ink/40 px-4 text-center">
              <span className="text-[11.5px] text-faint">Image: {block.caption}</span>
            </div>
          )}
          <figcaption className="mt-1.5 text-[11px] leading-relaxed text-dim">{block.caption}</figcaption>
        </figure>
      );
  }
}
