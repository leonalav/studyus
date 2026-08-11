import { useEffect, useMemo, useRef, useState } from "react";
import {
  Download,
  Layers3,
  LockKeyhole,
  MessageSquareText,
  RotateCcw,
  Sparkles,
} from "lucide-react";
import { boardToMarkdown, DOMAIN_META, type BoardDoc } from "../data/boards";
import {
  getStudySession,
  type StoredStudySession,
} from "../state/studySessionStore";
import {
  Chalkboard,
  FONTS,
  THEMES,
  type BoardView,
  type Stroke,
} from "./board/Chalkboard";
import type { ChatMsg } from "./board/BoardPanels";

interface Props {
  sessionId: string;
  onNotify: (text: string) => void;
  onReopen: (sessionId: string) => void;
}

const DEFAULT_VIEW: BoardView = { x: 48, y: 36, s: 1 };

export function PastNoteTab({ sessionId, onNotify, onReopen }: Props) {
  const session = useMemo(() => getStudySession(sessionId), [sessionId]);
  const [selectedBoardId, setSelectedBoardId] = useState(session?.activeId ?? "");

  useEffect(() => {
    setSelectedBoardId(session?.activeId ?? "");
  }, [session]);

  if (!session || session.boards.length === 0) {
    return (
      <main className="mx-auto w-full max-w-[820px] px-6 py-16">
        <div className="rounded-xl border border-edge bg-raise px-7 py-12 text-center">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-dim">Past note unavailable</p>
          <h1 className="mt-3 text-2xl font-semibold text-fg">This saved chalkboard could not be loaded.</h1>
          <p className="mx-auto mt-2 max-w-md text-[13px] leading-relaxed text-mut">
            Its session snapshot may have been removed from this device.
          </p>
        </div>
      </main>
    );
  }

  const board = session.boards.find((item) => item.id === selectedBoardId)
    ?? session.boards.find((item) => item.id === session.activeId)
    ?? session.boards[0];
  const blockCount = session.boards.reduce((total, item) => total + item.blocks.length, 0);
  const updated = new Date(session.updatedAt);
  const dateLabel = formatDate(updated);
  const timeLabel = Number.isNaN(updated.getTime())
    ? "saved session"
    : updated.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

  const appearance = session.appearance ?? {
    themeId: "classic" as const,
    fontId: "gloria",
    fontScale: 1,
    latex: true,
  };
  const theme = THEMES.find((item) => item.id === appearance.themeId) ?? THEMES[0];
  const fontCss = FONTS.find((item) => item.id === appearance.fontId)?.css ?? FONTS[0].css;

  const exportMarkdown = () => {
    const blob = new Blob([buildSessionMarkdown(session)], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `studyus-${slug(session.title)}.md`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    onNotify("Past note exported as Markdown");
  };

  return (
    <main className="mx-auto w-full max-w-[920px] px-5 pb-20 pt-11 sm:px-8 sm:pt-14">
      <header className="mb-9 border-b border-edge-soft pb-8">
        <div className="mb-4 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.17em] text-dim">
          <span>Past note</span>
          <span className="text-faint">·</span>
          <span>{dateLabel}</span>
        </div>
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h1 className="text-[34px] font-bold leading-[1.08] tracking-[-0.035em] text-fg sm:text-[40px]">
              {session.title}
            </h1>
            <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-dim">
              <span className="inline-flex items-center gap-1.5">
                <LockKeyhole size={11} />
                Private
              </span>
              <span>·</span>
              <span>{dateLabel}</span>
              <span>·</span>
              <span>{blockCount} chalkboard block{blockCount === 1 ? "" : "s"}</span>
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={exportMarkdown}
              className="inline-flex h-9 items-center gap-2 rounded-md border border-edge bg-raise px-3 text-[12px] font-medium text-mut transition-colors hover:bg-white/[0.08] hover:text-fg"
            >
              <Download size={14} />
              Export to Markdown
            </button>
            <button
              type="button"
              onClick={() => onReopen(session.id)}
              className="inline-flex h-9 items-center gap-2 rounded-md bg-accent px-3.5 text-[12px] font-semibold text-white transition-colors hover:bg-accent-deep"
            >
              <RotateCcw size={14} />
              Reopen chalkboard
            </button>
          </div>
        </div>
      </header>

      <section aria-labelledby="snapshot-heading">
        <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <Layers3 size={14} className="text-accent" />
              <h2 id="snapshot-heading" className="font-mono text-[10px] uppercase tracking-[0.17em] text-dim">
                Chalkboard snapshot
              </h2>
            </div>
            <p className="mt-1.5 text-[12px] text-mut">
              Read-only · exact saved viewport at {timeLabel}
            </p>
          </div>
          {session.boards.length > 1 && (
            <div className="flex max-w-full items-center gap-1 overflow-x-auto rounded-md border border-edge-soft bg-panel p-1">
              {session.boards.map((item, index) => (
                <button
                  key={item.id}
                  type="button"
                  title={item.title}
                  onClick={() => setSelectedBoardId(item.id)}
                  className={`max-w-[180px] truncate rounded px-2.5 py-1 text-[10.5px] transition-colors ${
                    item.id === board.id
                      ? "bg-white/[0.1] text-fg"
                      : "text-dim hover:bg-white/[0.05] hover:text-mut"
                  }`}
                >
                  {index === 0 ? "Main" : `Thread ${index}`} · {item.title}
                </button>
              ))}
            </div>
          )}
        </div>

        <BoardSnapshot
          board={board}
          view={session.viewMap[board.id] ?? DEFAULT_VIEW}
          strokes={session.strokeMap[board.id] ?? []}
          themeId={theme.id}
          fontCss={fontCss}
          fontScale={appearance.fontScale}
          latex={appearance.latex}
        />
      </section>

      <section className="mt-12" aria-labelledby="chat-heading">
        <div className="mb-4 flex items-end justify-between border-b border-edge-soft pb-3">
          <div>
            <div className="flex items-center gap-2">
              <MessageSquareText size={14} className="text-[#7dd3fc]" />
              <h2 id="chat-heading" className="font-mono text-[10px] uppercase tracking-[0.17em] text-dim">
                Session chat
              </h2>
            </div>
            <p className="mt-1.5 text-[12px] text-mut">The complete conversation, in its original order.</p>
          </div>
          <span className="font-mono text-[9.5px] uppercase tracking-wider text-dim">
            {session.messages.length} message{session.messages.length === 1 ? "" : "s"}
          </span>
        </div>

        {session.messages.length > 0 ? (
          <div className="space-y-4">
            {session.messages.map((message) => (
              <TranscriptMessage key={message.id} message={message} />
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-edge bg-white/[0.015] px-5 py-10 text-center text-[12.5px] text-dim">
            This chalkboard session has no saved chat messages.
          </div>
        )}
      </section>
    </main>
  );
}

function BoardSnapshot({
  board,
  view,
  strokes,
  themeId,
  fontCss,
  fontScale,
  latex,
}: {
  board: BoardDoc;
  view: BoardView;
  strokes: Stroke[];
  themeId: (typeof THEMES)[number]["id"];
  fontCss: string;
  fontScale: number;
  latex: boolean;
}) {
  const frameRef = useRef<HTMLDivElement>(null);
  const [frameWidth, setFrameWidth] = useState(0);
  const sourceWidth = clampDimension(view.viewportWidth, 1280, 480, 4096);
  const sourceHeight = clampDimension(view.viewportHeight, 720, 320, 2400);
  const scale = frameWidth > 0 ? frameWidth / sourceWidth : 1;
  const displayHeight = frameWidth > 0 ? sourceHeight * scale : Math.min(sourceHeight, 520);
  const theme = THEMES.find((item) => item.id === themeId) ?? THEMES[0];

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const measure = () => setFrameWidth(frame.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(frame);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="overflow-hidden rounded-xl border border-white/10 bg-black shadow-[0_22px_60px_rgba(0,0,0,0.28)]">
      <div className="flex h-8 items-center justify-between border-b border-white/[0.07] bg-[#17181a] px-3">
        <div className="flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-[#ff5f56]/80" />
          <span className="h-1.5 w-1.5 rounded-full bg-[#ffbd2e]/80" />
          <span className="h-1.5 w-1.5 rounded-full bg-[#28c840]/80" />
        </div>
        <span className="max-w-[60%] truncate font-mono text-[9px] uppercase tracking-[0.14em] text-white/35">
          {board.title} · saved frame
        </span>
        <span className="font-mono text-[9px] text-white/25">
          {Math.round(view.s * 100)}%
        </span>
      </div>
      <div
        ref={frameRef}
        className="relative w-full overflow-hidden bg-black"
        style={{ height: displayHeight }}
      >
        {frameWidth > 0 && (
          <div
            className="pointer-events-none absolute left-0 top-0"
            style={{
              width: sourceWidth,
              height: sourceHeight,
              transform: `scale(${scale})`,
              transformOrigin: "left top",
            }}
          >
            <Chalkboard
              board={board}
              theme={theme}
              fontCss={fontCss}
              fontScale={fontScale}
              writing={false}
              latex={latex}
              onAsk={() => undefined}
              annotating={false}
              penColor="#fbbf24"
              penTool="pen"
              strokesKey={`past-note-${board.id}`}
              initialView={view}
              initialStrokes={strokes}
              readOnly
            />
          </div>
        )}
      </div>
    </div>
  );
}

function TranscriptMessage({ message }: { message: ChatMsg }) {
  if (message.role === "system") {
    return (
      <div className="rounded-md border border-edge-soft bg-white/[0.025] px-3 py-2 font-mono text-[10.5px] leading-relaxed text-dim">
        {message.text}
      </div>
    );
  }

  const tutor = message.role === "tutor";
  return (
    <article className={`flex ${tutor ? "justify-start" : "justify-end"}`}>
      <div className={`w-full max-w-[760px] ${tutor ? "pr-8 sm:pr-16" : "pl-8 sm:pl-16"}`}>
        <div className={`mb-1.5 flex items-center gap-1.5 text-[9px] uppercase tracking-[0.14em] text-dim ${tutor ? "" : "justify-end"}`}>
          {tutor && <Sparkles size={10} className="text-[#7dd3fc]" />}
          {tutor ? "Studyus" : "You"}
        </div>
        <div
          className={`rounded-xl border px-4 py-3 text-[13px] leading-[1.7] whitespace-pre-wrap ${
            tutor
              ? "border-edge-soft bg-raise text-mut"
              : "border-accent/20 bg-accent/10 text-fg"
          }`}
        >
          {message.text}
          {message.imageData && (
            <img
              src={message.imageData}
              alt="Attachment saved with this message"
              className="mt-3 max-h-[360px] max-w-full rounded-lg border border-white/10 object-contain"
            />
          )}
        </div>
      </div>
    </article>
  );
}

function buildSessionMarkdown(session: StoredStudySession): string {
  const subject = DOMAIN_META[session.domain].label;
  const header = [
    "# Studyus session notes",
    "",
    `- **Session:** ${session.title}`,
    `- **Saved:** ${session.updatedAt}`,
    `- **Subject:** ${subject}`,
    `- **Boards:** ${session.boards.length}`,
    "",
    "---",
    "",
  ].join("\n");
  const boards = session.boards.map(boardToMarkdown).join("\n\n---\n\n");
  const transcript = session.messages.length > 0
    ? [
        "",
        "---",
        "",
        "## Chat transcript",
        "",
        ...session.messages.flatMap((message) => [
          `**${message.role === "tutor" ? "Studyus" : message.role === "user" ? "You" : "System"}:** ${message.text}`,
          "",
        ]),
      ].join("\n")
    : "";
  return header + boards + transcript;
}

function formatDate(date: Date): string {
  if (Number.isNaN(date.getTime())) return "Saved session";
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "past-note";
}

function clampDimension(value: number | undefined, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, value));
}
