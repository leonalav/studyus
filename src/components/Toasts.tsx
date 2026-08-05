import { Check } from "lucide-react";

export interface ToastItem {
  id: number;
  text: string;
}

export function Toasts({ items }: { items: ToastItem[] }) {
  return (
    <div className="pointer-events-none fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 flex-col items-center gap-2">
      {items.map((t) => (
        <div
          key={t.id}
          className="anim-toast flex items-center gap-2.5 rounded-md border border-edge bg-raise px-3.5 py-2 text-[13px] text-fg shadow-[0_8px_24px_rgba(0,0,0,0.45)]"
        >
          <span className="grid h-4 w-4 place-items-center rounded-full bg-ok/20">
            <Check size={11} className="text-ok" strokeWidth={3} />
          </span>
          {t.text}
        </div>
      ))}
    </div>
  );
}
