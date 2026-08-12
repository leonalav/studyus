import { useEffect, useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import {
  deleteStudySession,
  listStudySessions,
  subscribeToStudySessions,
} from "../state/studySessionStore";
import { deleteChalkboardSession } from "../api";

export function ActivityList({ onOpen, onNotify }: { onOpen: (id: string, title: string) => void; onNotify?: (t: string) => void }) {
  const [sessions, setSessions] = useState(() => listStudySessions());
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const refresh = () => setSessions(listStudySessions());
    const unsubscribe = subscribeToStudySessions(refresh);
    window.addEventListener("focus", refresh);
    return () => {
      unsubscribe();
      window.removeEventListener("focus", refresh);
    };
  }, []);

  // Remove a finished session everywhere it is persisted: the localStorage
  // study-session snapshot (what this list reads) AND the SQLite chalkboard
  // session + its cascaded transcript. Both are keyed by the same id.
  const remove = async (id: string, title: string) => {
    try {
      // Delete the relational record first; a missing old row is a successful
      // SQLite no-op. The snapshot write then broadcasts to both visible lists.
      await deleteChalkboardSession(id);
      deleteStudySession(id);
      onNotify?.(`Deleted "${title}"`);
    } catch (error) {
      onNotify?.(error instanceof Error ? error.message : "Could not delete that session");
    }
  };

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rows = Array.from(el.querySelectorAll<HTMLElement>(".reveal"));
    const io = new IntersectionObserver((entries) => entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add("is-in");
        io.unobserve(entry.target);
      }
    }), { threshold: 0.15 });
    rows.forEach((row) => io.observe(row));
    return () => io.disconnect();
  }, [sessions.length]);

  return (
    <section ref={ref} className="mx-auto mt-16 w-full max-w-[720px] pb-28">
      <div className="reveal mb-2 flex items-center justify-between px-1">
        <span className="font-mono text-[11px] uppercase tracking-wider text-dim">Recent sessions</span>
        <button className="text-[12px] text-mut transition-colors hover:text-fg">View all</button>
      </div>
      <div className="space-y-0.5">
        {sessions.length === 0 ? (
          <div className="rounded-md border border-dashed border-edge px-3 py-5 text-center text-[12px] text-dim">Your finished chalkboard sessions will appear here.</div>
        ) : sessions.map((session, index) => (
          <div key={session.id} className="reveal group flex w-full items-center gap-3 rounded-md px-3 py-2.5 transition-colors hover:bg-white/[0.035]" style={{ transitionDelay: `${index * 70}ms` }}>
            <button onClick={() => onOpen(session.id, session.title)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-edge bg-raise text-mut"><span className="text-[11px]">✦</span></span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px] font-medium text-fg">{session.title}</span>
                <span className="block truncate text-[12px] text-dim">{session.messages.length} messages · {session.boards.length} boards</span>
              </span>
              <span className="w-24 text-right font-mono text-[11px] text-dim">{new Date(session.updatedAt).toLocaleDateString()}</span>
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                void remove(session.id, session.title);
              }}
              aria-label={`Delete ${session.title}`}
              title="Delete session"
              className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-dim opacity-0 transition-all hover:bg-[#c42b1c]/15 hover:text-[#ff8b80] group-hover:opacity-100"
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}
