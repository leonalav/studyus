/**
 * Feature gates for capabilities that have a UI but no billing backend yet.
 *
 * ── TEMPORARY ─────────────────────────────────────────────────────────────
 * `customEndpointsProBypass` re-opens the custom-endpoints flow (adding an
 * OpenAI-compatible endpoint) that the UI reserves for Studyus Pro. It exists
 * so the feature can be exercised end-to-end in a development build while
 * there is no subscription check to satisfy. Every gate that honors it sits
 * in `SettingsModal`; set this back to `false` to restore the full Pro lock.
 * ───────────────────────────────────────────────────────────────────────────
 */
export const customEndpointsProBypass = true;
