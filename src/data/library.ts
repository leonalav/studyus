/**
 * Search index for Studyus.
 *
 * The searchable surface is REAL data only — persisted chalkboard notes from
 * SQLite and the app's own settings sections. There is no synthetic content
 * here: every note row comes from `chalkboard_sessions`, every settings row
 * maps to a real Settings section. The UI shell in SearchModal (recency
 * buckets, chips, keyboard nav) consumes the `SearchItem` shape unchanged.
 */

import { getDb } from "../db/database";

export type Recency = "today" | "past30" | "older";

export interface SearchItem {
  id: string;
  label: string;
  /** "note" = a persisted chalkboard session; "setting" = a Settings section. */
  type: "note" | "setting";
  /** Path / context line shown after the label. */
  path: string;
  recency: Recency;
  accent: string;
  /** For settings picks: the Settings section id to open. */
  settingId?: string;
  /** For note picks: the chalkboard_sessions id to reopen. */
  noteId?: string;
}

export const RECENCY_LABEL: Record<Recency, string> = {
  today: "Today",
  past30: "Past 30 days",
  older: "Older",
};

const ACCENTS = ["#7dd3fc", "#86efac", "#fcd34d", "#f9a8d4", "#a5b4fc", "#fca5a5"];

/** Deterministic accent per domain string so the note icon stays consistent
 *  across renders without any synthetic color data. */
function accentFor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return ACCENTS[h % ACCENTS.length];
}

function bucketFor(updatedAt: string): Recency {
  // updatedAt is an ISO timestamp stored by the session store.
  const ts = Date.parse(updatedAt);
  if (Number.isNaN(ts)) return "older";
  const ageDays = (Date.now() - ts) / 86_400_000;
  if (ageDays < 1) return "today";
  if (ageDays < 30) return "past30";
  return "older";
}

interface SessionRow {
  id: string;
  title: string;
  domain: string;
  updatedAt: string;
}

/**
 * Build the live index from SQLite + the settings catalog. Called by
 * SearchModal on open. Notes that fail to load degrade to an empty list — we
 * never fall back to placeholder notes.
 */
export async function buildSearchIndex(settings: { id: string; label: string; desc: string }[]): Promise<SearchItem[]> {
  const items: SearchItem[] = [];

  // 1. Real persisted notes (same query the Sidebar past-notes list uses).
  try {
    const db = await getDb();
    const res = db.exec(
      "SELECT id, title, domain, updated_at FROM chalkboard_sessions ORDER BY updated_at DESC;"
    );
    const rows: SessionRow[] = res[0]?.values.map((row) => ({
      id: row[0] as string,
      title: row[1] as string,
      domain: row[2] as string,
      updatedAt: row[3] as string,
    })) ?? [];
    for (const r of rows) {
      items.push({
        id: `note-${r.id}`,
        label: r.title,
        type: "note",
        path: r.domain,
        recency: bucketFor(r.updatedAt),
        accent: accentFor(r.domain),
        noteId: r.id,
      });
    }
  } catch {
    // DB not ready / unreadable: search simply has no notes this run.
  }

  // 2. Real settings sections — open the Settings modal at that section on pick.
  for (const s of settings) {
    items.push({
      id: `setting-${s.id}`,
      label: s.label,
      type: "setting",
      path: s.desc,
      recency: "today",
      accent: "#a5b4fc",
      settingId: s.id,
    });
  }

  return items;
}
