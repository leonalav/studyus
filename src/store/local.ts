/**
 * Browser persistence binding — the web equivalent of the `studyus-store`
 * crate (§6): a thin adapter over the core Store trait. It lives OUTSIDE
 * src/core because it touches window/localStorage; the pedagogy core never
 * does (Law 9, enforced by scripts/check-deps.sh).
 *
 * Learner data stays on this device. There is no sync, no telemetry, no
 * network path of any kind (§16, §18).
 */

import type { PersistedState, Store } from "../core/store";
import { emptyState } from "../core/store";

export const STORAGE_KEY = "studyus.programming.v1";

export class LocalStorageStore implements Store {
  load(): PersistedState {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return emptyState();
      const parsed = JSON.parse(raw) as PersistedState;
      if (parsed.version !== 1) return emptyState();
      return { ...emptyState(), ...parsed };
    } catch {
      return emptyState();
    }
  }

  save(state: PersistedState): void {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }
}

/** §15.1 `lumina reset` — wipe local learner data */
export function resetLearnerData(): void {
  window.localStorage.removeItem(STORAGE_KEY);
}

/** §15.1 `lumina export` — the learner's data belongs to the learner */
export function exportLearnerData(): string {
  return window.localStorage.getItem(STORAGE_KEY) ?? JSON.stringify(emptyState());
}
