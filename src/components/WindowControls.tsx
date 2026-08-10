import { Minus, Square, X } from "lucide-react";
import { isTauriRuntime } from "../lib/tauri";

/**
 * Minimal, frameless window controls for the fullscreen views that have no
 * `TopBar` (the chalkboard `StudyRoom`, exam mode, and the programming trainer).
 *
 * With native decorations disabled, those screens would otherwise have no drag
 * region and no min/max/close affordance. The strip stays out of the way
 * (top-right, transparent) and is fully inert in the browser single-file build:
 * the `data-tauri-drag-region` is ignored by the browser, and each button early-
 * returns when `isTauriRuntime()` is false so it never fires in the webview-less
 * path. It deliberately emits no placeholder toasts — these screens own no
 * `notify` channel and a fake "Minimized." message would be a lie.
 *
 * Drag note: `data-tauri-drag-region` lives on a *dedicated* top strip (the
 * host view renders `DragBar` for a full-width affordance). The button cluster
 * itself is NOT a drag region, so the min/max/close clicks never get swallowed.
 */
async function minimizeWindow(): Promise<void> {
  if (!isTauriRuntime()) return;
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  await getCurrentWindow().minimize();
}
async function toggleMaximizeWindow(): Promise<void> {
  if (!isTauriRuntime()) return;
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  await getCurrentWindow().toggleMaximize();
}
async function closeWindow(): Promise<void> {
  if (!isTauriRuntime()) return;
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  await getCurrentWindow().close();
}

const btn =
  "grid h-7 w-7 place-items-center rounded-md text-mut transition-colors hover:bg-white/[0.06] hover:text-fg";

/** A thin, full-width, transparent strip that makes the otherwise frameless
 *  fullscreen views draggable.
 *
 *  `data-tauri-drag-region="deep"` — not the bare attribute: per Tauri's
 *  drag.js the bare form only starts a drag when the mousedown target IS this
 *  exact element (`el === composedPath[0]`), so any nested element would
 *  silently swallow the drag. "deep" makes any descendant a drag handle, while
 *  genuinely clickable children still block dragging.
 *
 *  `z-30` keeps it BELOW the fullscreen chrome that also lives at the top:
 *  `BoardToolbar` is `top-3 z-40` and `WindowControls` is `top-2 z-50`. Since
 *  DragBar renders after those in the DOM, an equal z-index would let it paint
 *  over their hit areas. Their own wrappers are `pointer-events-none`, so
 *  clicks in the gaps still fall through to this strip.
 *
 *  Invisible and inert in the browser build — the attribute is a no-op there. */
export function DragBar() {
  return (
    <div
      data-tauri-drag-region="deep"
      className="pointer-events-auto absolute inset-x-0 top-0 z-30 h-6"
      aria-hidden
    />
  );
}

export function WindowControls() {
  return (
    <div
      className="anim-toast pointer-events-auto absolute right-2 top-2 z-50 flex items-center gap-1 rounded-md px-1"
    >
      <button className={btn} onClick={minimizeWindow} aria-label="Minimize" title="Minimize">
        <Minus size={15} />
      </button>
      <button className={btn} onClick={toggleMaximizeWindow} aria-label="Maximize" title="Maximize">
        <Square size={12} />
      </button>
      <button
        className={`${btn} hover:bg-[#c42b1c]! hover:text-white!`}
        onClick={closeWindow}
        aria-label="Close"
        title="Close"
      >
        <X size={15} />
      </button>
    </div>
  );
}
