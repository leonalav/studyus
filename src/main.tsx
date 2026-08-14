import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "katex/dist/katex.min.css";
import "./index.css";
import App from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { CurriculumProvider } from "./state/curriculumStore";
import { initializePreferences } from "./lib/preferences";

// Restore appearance before React's first paint, avoiding a dark-theme flash
// when the learner chose Light or follows a light system theme.
initializePreferences();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {/* Last line of defence. Inner boundaries should catch failures long before
        this one, but an uncaught throw must never leave a blank white window
        with no explanation and no way back. */}
    <ErrorBoundary
      label="Studyus"
      fallback={(error) => (
        <div className="grid h-full min-h-screen place-items-center bg-ink px-6 text-fg">
          <div className="max-w-md">
            <h1 className="m-0 text-[18px] font-semibold">Studyus hit an unexpected error</h1>
            <p className="mt-2 text-[13px] leading-relaxed text-mut">
              Your saved sessions and notes are stored on this device and were not affected.
              Reloading usually clears it.
            </p>
            <pre className="mt-3 overflow-auto rounded-md border border-edge bg-raise p-3 text-[11px] text-dim">
              {error.message}
            </pre>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mt-3 rounded-md bg-accent px-3 py-1.5 text-[13px] font-medium text-white"
            >
              Reload Studyus
            </button>
          </div>
        </div>
      )}
    >
      <CurriculumProvider>
        <App />
      </CurriculumProvider>
    </ErrorBoundary>
  </StrictMode>
);
