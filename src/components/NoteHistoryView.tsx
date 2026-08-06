import { useEffect, useState } from "react";
import { Download, Play, MessageSquare, FileText } from "lucide-react";
import { THEMES } from "./board/Chalkboard";
import { Latex, Graph2D, Graph3D, Diagram, ChalkStrong } from "./board/Visuals";
import { getDb } from "../db/database";
import { Block, BoardDoc, boardToMarkdown, buildBoard } from "../data/boards";

interface Props {
  title: string;
  onContinue: () => void;
}

interface SavedSessionData {
  id: string;
  title: string;
  domain: string;
  updatedAt: string;
  board: BoardDoc;
  messages: { role: string; text: string }[];
}

export function NoteHistoryView({ title, onContinue }: Props) {
  const [sessionData, setSessionData] = useState<SavedSessionData | null>(null);
  const theme = THEMES[0];

  useEffect(() => {
    (async () => {
      const db = await getDb();
      // Fetch session from DB or build fallback board
      const res = db.exec("SELECT id, title, domain, updated_at FROM chalkboard_sessions WHERE title = ? OR id = ?;", [title, title]);

      let domain = "physics";
      let sessionTitle = title;

      if (res[0] && res[0].values.length > 0) {
        sessionTitle = res[0].values[0][1] as string;
        domain = res[0].values[0][2] as string;
      }

      const board = buildBoard(domain as any, sessionTitle);

      // Fetch transcript messages
      const msgRes = db.exec("SELECT role, content FROM session_messages WHERE session_id = ? ORDER BY timestamp ASC;", [title]);
      let messages: { role: string; text: string }[] = [];
      if (msgRes[0]) {
        messages = msgRes[0].values.map((r) => ({ role: r[0] as string, text: r[1] as string }));
      } else {
        messages = [
          { role: "tutor", text: `Board is up — ${sessionTitle}. I'll write equations, diagrams, and step-by-step notes here.` },
          { role: "user", text: "Walk me through the main derivation and key concepts." },
          { role: "tutor", text: "Here is the vertical breakdown on the chalkboard." },
        ];
      }

      setSessionData({
        id: title,
        title: sessionTitle,
        domain,
        updatedAt: new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
        board,
        messages,
      });
    })();
  }, [title]);

  const exportMarkdown = () => {
    if (!sessionData) return;
    const docMd = [
      `# ${sessionData.title}`,
      `*Saved Past Note — ${sessionData.updatedAt}*`,
      "",
      boardToMarkdown(sessionData.board),
      "",
      "---",
      "## Chat Transcript",
      "",
      ...sessionData.messages.map((m) => `**${m.role === "tutor" ? "Studyus" : "You"}:** ${m.text}`),
    ].join("\n");

    const blob = new Blob([docMd], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${sessionData.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-notes.md`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  if (!sessionData) return null;

  return (
    <div className="relative select-none">
      <div className="mx-auto w-full max-w-[840px] px-5 pt-8 pb-28">
        <div className="mb-2 flex items-center justify-between">
          <div className="font-mono text-[10px] uppercase tracking-wider text-dim">Past Note · Read-only</div>

          {/* Export to Markdown Button ONLY shown here for Past Notes */}
          <button
            onClick={exportMarkdown}
            className="flex items-center gap-1.5 rounded-md border border-edge bg-raise px-3 py-1.5 text-[12px] text-fg transition-colors hover:bg-white/[0.08]"
          >
            <Download size={13} className="text-accent" />
            Export to Markdown
          </button>
        </div>

        <h1 className="mb-1 text-[36px] font-bold leading-tight tracking-tight text-fg">{sessionData.title}</h1>
        <p className="mb-6 font-mono text-[11.5px] text-dim">
          {sessionData.domain.toUpperCase()} · Saved {sessionData.updatedAt} · {sessionData.board.blocks.length} Chalkboard Blocks
        </p>

        {/* EXACT CHALKBOARD rendered vertically in UI */}
        <div
          className="overflow-hidden rounded-xl border border-edge shadow-2xl"
          style={{ background: theme.bg }}
        >
          <div className="flex items-center justify-between border-b border-white/10 px-5 py-2.5 bg-black/20">
            <span className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-wider text-white/60">
              <FileText size={13} className="text-accent" />
              Chalkboard State
            </span>
            <span className="font-mono text-[10px] text-white/40">exact rendered view</span>
          </div>

          <div
            className="space-y-6 px-8 py-8"
            style={{ color: theme.chalk, fontFamily: "'Gloria Hallelujah', cursive" }}
          >
            {sessionData.board.blocks.map((block) => (
              <div key={block.id} className="anim-chalk">
                <VerticalBlockView block={block} chalk={theme.chalk} accent="#fcd34d" />
              </div>
            ))}
          </div>
        </div>

        {/* Complete Chat History Transcript */}
        <div className="mt-8 rounded-xl border border-edge bg-raise p-5">
          <div className="mb-4 flex items-center gap-2 border-b border-edge pb-2 font-mono text-[11px] uppercase tracking-wider text-dim">
            <MessageSquare size={13} className="text-accent" />
            Chat Transcript
          </div>
          <div className="space-y-3">
            {sessionData.messages.map((m, idx) => (
              <div
                key={idx}
                className={`rounded-lg p-3 text-[13px] leading-relaxed ${
                  m.role === "tutor"
                    ? "bg-white/[0.03] border border-white/6 text-fg/90"
                    : "bg-accent/10 border border-accent/20 text-fg"
                }`}
              >
                <div className="mb-1 font-mono text-[10px] uppercase text-dim">
                  {m.role === "tutor" ? "Studyus Tutor" : "You"}
                </div>
                <p className="whitespace-pre-wrap">{m.text}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Floating Continue session button */}
      <button
        onClick={onContinue}
        className="anim-toast fixed bottom-7 left-1/2 z-40 flex -translate-x-1/2 items-center gap-2 rounded-full border border-white/12 bg-[#1c1c1c]/95 py-2.5 pl-3.5 pr-4 shadow-[0_16px_44px_rgba(0,0,0,0.5)] backdrop-blur-md transition-transform hover:scale-[1.02] active:scale-95"
      >
        <span className="grid h-6 w-6 place-items-center rounded-full bg-accent text-white">
          <Play size={11} fill="currentColor" />
        </span>
        <span className="text-[13px] font-medium text-fg">Reopen live chalkboard</span>
      </button>
    </div>
  );
}

function VerticalBlockView({ block, chalk, accent }: { block: Block; chalk: string; accent: string }) {
  switch (block.kind) {
    case "title":
      return (
        <div>
          <h2 className="text-[32px] font-normal leading-snug">
            <ChalkStrong>{block.text}</ChalkStrong>
          </h2>
          <div className="h-0.5 w-40 mt-1 bg-accent/60 rounded-full" />
        </div>
      );
    case "text":
      return <p className="text-[18px] leading-relaxed max-w-[680px]">{block.text}</p>;
    case "bullets":
      return (
        <ul className="space-y-2 max-w-[620px]">
          {block.items.map((it, i) => (
            <li key={i} className="flex items-start gap-2 text-[17px]">
              <span className="text-accent">›</span>
              <span>{it}</span>
            </li>
          ))}
        </ul>
      );
    case "latex":
      return (
        <div className="py-2">
          <Latex tex={block.tex} color={chalk} size={24} />
          {block.caption && <p className="text-[14px] opacity-70 mt-1">{block.caption}</p>}
        </div>
      );
    case "graph2d":
      return <Graph2D fn={block.fn} domainX={block.domainX} caption={block.caption} curves={block.curves} color={chalk} accent={accent} />;
    case "graph3d":
      return <Graph3D surface={block.surface} caption={block.caption} color={chalk} accent={accent} />;
    case "diagram":
      return <Diagram variant={block.variant} caption={block.caption} color={chalk} accent={accent} />;
    case "callout":
      return (
        <div className="rounded-lg border-2 border-dashed border-accent/60 p-3 max-w-[500px] text-[18px]">
          <ChalkStrong>{block.text}</ChalkStrong>
        </div>
      );
    default:
      return null;
  }
}
