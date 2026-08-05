import { useEffect, useRef } from "react";
import { ChevronRight } from "lucide-react";
import { RECENT_SESSIONS, SUBJECTS } from "../data/tutor";
import { SubjectIcon } from "./SubjectIcon";

export function ActivityList({ onOpen }: { onOpen: (title: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rows = Array.from(el.querySelectorAll<HTMLElement>(".reveal"));
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add("is-in");
            io.unobserve(e.target);
          }
        });
      },
      { threshold: 0.15 }
    );
    rows.forEach((r) => io.observe(r));
    return () => io.disconnect();
  }, []);

  return (
    <section ref={ref} className="mx-auto mt-16 w-full max-w-[720px] pb-28">
      <div className="reveal mb-2 flex items-center justify-between px-1">
        <span className="font-mono text-[11px] uppercase tracking-wider text-dim">Recent sessions</span>
        <button className="text-[12px] text-mut transition-colors hover:text-fg">View all</button>
      </div>
      <div className="space-y-0.5">
        {RECENT_SESSIONS.map((s, i) => {
          const subject = SUBJECTS.find((x) => x.id === s.subject)!;
          return (
            <button
              key={s.title}
              onClick={() => onOpen(s.title)}
              className="reveal group flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left transition-colors hover:bg-white/[0.035]"
              style={{ transitionDelay: `${i * 70}ms` }}
            >
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-edge bg-raise text-mut transition-colors group-hover:text-fg">
                <SubjectIcon icon={subject.icon} size={15} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px] font-medium text-fg">{s.title}</span>
                <span className="block truncate text-[12px] text-dim">{s.detail}</span>
              </span>
              <span className="hidden font-mono text-[11px] text-dim sm:block">{s.minutes} min</span>
              <span className="w-20 text-right font-mono text-[11px] text-dim">{s.when}</span>
              <ChevronRight
                size={14}
                className="-translate-x-1 text-dim opacity-0 transition-all group-hover:translate-x-0 group-hover:opacity-100"
              />
            </button>
          );
        })}
      </div>
    </section>
  );
}
