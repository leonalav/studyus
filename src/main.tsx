import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "katex/dist/katex.min.css";
import "./index.css";
import App from "./App";
import { CurriculumProvider } from "./state/curriculumStore";
import { initializePreferences } from "./lib/preferences";

// Restore appearance before React's first paint, avoiding a dark-theme flash
// when the learner chose Light or follows a light system theme.
initializePreferences();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <CurriculumProvider>
      <App />
    </CurriculumProvider>
  </StrictMode>
);
