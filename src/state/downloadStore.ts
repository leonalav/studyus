/**
 * Download manager store.
 *
 * Tracks three phases of downloads:
 *   pending  — queued, waiting or actively downloading
 *   failed   — hit an error (network, auth, disk, model unavailable)
 *   completed — downloaded and verified, ready to be used
 *
 * The store is a singleton React-free module backed by localStorage.
 * Components subscribe via `subscribeDownloads(fn)` and call
 * `getDownloads()` for the current snapshot.
 */

export type DownloadKind = "app-update" | "model" | "docling";

export interface DownloadItem {
  id: string;
  kind: DownloadKind;
  label: string;
  /** Human-readable current step, e.g. "Downloading…", "Extracting…" */
  status: string;
  /** Fraction 0–1. 1 = complete. NaN = indeterminate. */
  progress: number;
  /** Bytes downloaded so far. -1 = indeterminate. */
  bytesSoFar: number;
  /** Total bytes, or -1 if indeterminate. */
  bytesTotal: number;
  /** ISO timestamp of when this item entered the store. */
  startedAt: string;
  /** ISO timestamp of when it completed or failed. */
  endedAt: string | null;
  phase: "pending" | "failed" | "completed";
  error: string | null;
}

const STORAGE_KEY = "studyus.downloads.v1";

function loadFromStorage(): DownloadItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed as DownloadItem[];
  } catch {
    return [];
  }
}

function saveToStorage(items: DownloadItem[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    // Storage quota or blocked — non-fatal
  }
}

let _items = loadFromStorage();
const _subscribers = new Set<(items: DownloadItem[]) => void>();

function _notify() {
  const snapshot = [..._items];
  for (const fn of _subscribers) fn(snapshot);
}

function _upsert(item: DownloadItem) {
  const idx = _items.findIndex((x) => x.id === item.id);
  if (idx >= 0) _items[idx] = item;
  else _items.push(item);
  saveToStorage(_items);
  _notify();
}

export function getDownloads(): DownloadItem[] {
  return [..._items];
}

export function subscribeDownloads(fn: (items: DownloadItem[]) => void): () => void {
  _subscribers.add(fn);
  fn([..._items]);
  return () => {
    _subscribers.delete(fn);
  };
}

/** Begin tracking a new download. Only call once per unique `id`. */
export function enqueueDownload(params: {
  id: string;
  kind: DownloadKind;
  label: string;
  bytesTotal?: number;
}): void {
  _upsert({
    id: params.id,
    kind: params.kind,
    label: params.label,
    status: "Queued",
    progress: 0,
    bytesSoFar: 0,
    bytesTotal: params.bytesTotal ?? -1,
    startedAt: new Date().toISOString(),
    endedAt: null,
    phase: "pending",
    error: null,
  });
}

/** Update the progress of a pending download. */
export function updateDownloadProgress(
  id: string,
  patch: Partial<Pick<DownloadItem, "status" | "progress" | "bytesSoFar" | "bytesTotal">>
): void {
  const item = _items.find((x) => x.id === id);
  if (!item || item.phase !== "pending") return;
  _upsert({ ...item, ...patch });
}

/** Mark a download as successfully completed. */
export function completeDownload(id: string): void {
  const item = _items.find((x) => x.id === id);
  if (!item) return;
  _upsert({
    ...item,
    phase: "completed",
    progress: 1,
    status: "Ready",
    endedAt: new Date().toISOString(),
  });
}

/** Mark a download as failed. */
export function failDownload(id: string, error: string): void {
  const item = _items.find((x) => x.id === id);
  if (!item) return;
  _upsert({
    ...item,
    phase: "failed",
    status: "Failed",
    error,
    endedAt: new Date().toISOString(),
  });
}

/** Reset a failed (or completed) item back to pending, clearing error state. */
export function retryDownload(id: string): void {
  const item = _items.find((x) => x.id === id);
  if (!item) return;
  _upsert({
    ...item,
    phase: "pending",
    status: "Queued",
    progress: 0,
    bytesSoFar: 0,
    error: null,
    endedAt: null,
  });
}

/** Remove a download from the store (clears the list). */
export function removeDownload(id: string): void {
  const before = _items.length;
  _items = _items.filter((x) => x.id !== id);
  if (_items.length !== before) {
    saveToStorage(_items);
    _notify();
  }
}

/** Prune completed items older than `maxAgeMs`. */
export function pruneDownloads(maxAgeMs = 7 * 24 * 60 * 60 * 1000): void {
  const cutoff = Date.now() - maxAgeMs;
  const before = _items.length;
  _items = _items.filter(
    (x) => x.phase === "pending" || x.endedAt === null || new Date(x.endedAt).getTime() > cutoff
  );
  if (_items.length !== before) {
    saveToStorage(_items);
    _notify();
  }
}
