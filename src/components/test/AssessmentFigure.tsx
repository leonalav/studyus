import { useMemo } from "react";
import type { VisualizationIntent } from "../../lib/visualization/types";
import { validateAssessmentFigure } from "../../lib/assessmentFigure";
import { VisualizationSurface } from "../board/VisualizationSurface";

export const ASSESSMENT_FIGURE_CONTAINER_CLASS =
  "mt-5 min-w-0 max-w-full overflow-hidden rounded-xl border border-edge bg-black/20 p-3 sm:p-4 [contain:layout_paint]";

function accessibleFigureLabel(intent: VisualizationIntent): string {
  const named =
    ("title" in intent && typeof intent.title === "string" && intent.title.trim())
    || ("caption" in intent && typeof intent.caption === "string" && intent.caption.trim());
  return named ? `${named} — assessment visualization` : `${intent.type.replace("_", " ")} assessment visualization`;
}

/**
 * Read-only exam wrapper around the shared chalkboard renderer.
 *
 * The outer region clips paint to the question card while its inner horizontal
 * scroller keeps an unusually long equation reachable. The shared surface runs
 * in read-only mode: learners can use graph/chart navigation and 3D controls,
 * while authored points and network nodes cannot be moved.
 */
export function AssessmentFigure({ intent }: { intent: VisualizationIntent }) {
  const validation = useMemo(() => validateAssessmentFigure(intent), [intent]);

  if (!validation.ok) {
    // DTO loading also validates, but keep rendering as an independent trust
    // boundary in case a future caller passes runtime data directly.
    return (
      <div className={`${ASSESSMENT_FIGURE_CONTAINER_CLASS} text-[12px] text-dim`} role="status">
        Visualization unavailable because its specification is invalid.
      </div>
    );
  }

  return (
    <section
      className={ASSESSMENT_FIGURE_CONTAINER_CLASS}
      aria-label={accessibleFigureLabel(validation.value)}
      data-assessment-figure={validation.value.type}
    >
      <div className="max-w-full overflow-x-auto overflow-y-hidden overscroll-x-contain">
        <div className="min-w-0 max-w-full [&_canvas]:max-w-full [&_figure]:max-w-full [&_svg]:max-w-full">
          <VisualizationSurface
            intent={validation.value}
            chalk="#f4f1e8"
            accent="#a78bfa"
            scale={0.92}
            readOnly
          />
        </div>
      </div>
    </section>
  );
}
