/* pure rendering helpers shared by the tutor views — no pedagogy here */

export function CodeBlock({ code, activeLine }: { code: string; activeLine?: number }) {
  const lines = code.split("\n");
  return (
    <pre className="font-mono text-[13px] leading-[1.7]">
      {lines.map((line, i) => {
        const number = i + 1;
        const active = activeLine === number;
        return (
          <div
            key={i}
            className="flex gap-3 rounded px-1 transition-colors"
            style={active ? { background: "rgba(35,131,226,0.16)" } : undefined}
          >
            <span className="w-5 shrink-0 select-none text-right text-dim">{number}</span>
            <span className="whitespace-pre text-fg/90">{line || " "}</span>
          </div>
        );
      })}
    </pre>
  );
}

export function TierChip({ tier }: { tier: 1 | 2 | 3 }) {
  const label = tier === 1 ? "tier 1 · checkable" : tier === 2 ? "tier 2 · behaviour" : "tier 3 · no gate";
  const tone =
    tier === 1
      ? "bg-[#86efac]/10 text-[#86efac]"
      : tier === 2
      ? "bg-[#7dd3fc]/10 text-[#7dd3fc]"
      : "bg-white/[0.07] text-mut";
  return <span className={`rounded-full px-2 py-0.5 font-mono text-[10px] ${tone}`}>{label}</span>;
}

export function BeatChip({ beat }: { beat: string }) {
  return (
    <span className="rounded-full bg-[#fcd34d]/15 px-2 py-0.5 font-mono text-[10px] text-[#fcd34d]">
      beat · {beat}
    </span>
  );
}

export function ScaffoldChip({ scaffold }: { scaffold: string }) {
  if (scaffold === "none") return null;
  const label =
    scaffold === "hinted" ? "softer: hinted" : scaffold === "completion" ? "softer: completion" : "softer: worked example";
  return <span className="rounded-full bg-[#7dd3fc]/10 px-2 py-0.5 font-mono text-[10px] text-[#7dd3fc]">{label}</span>;
}
