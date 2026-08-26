import { createElement, useState, useEffect, useRef } from "react";
import { renderMath } from "../../lib/latex/render";

export interface MathStep {
  tex: string;
  label?: string;
  highlight?: string;
}

export interface DiagramAnnotation {
  from: string;
  to: string;
  type: "arrow" | "brace" | "box" | "highlight";
  label?: string;
  color?: string;
}

interface MathDiagramProps {
  tex: string;
  variant?: "equation" | "derivation" | "proof" | "definition";
  steps?: MathStep[];
  showStepper?: boolean;
  annotations?: DiagramAnnotation[];
  autoReveal?: boolean;
  revealDelay?: number;
}

export function MathDiagram({
  tex,
  variant = "equation",
  steps = [],
  showStepper = false,
  annotations = [],
  autoReveal = false,
  revealDelay = 1500,
}: MathDiagramProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const [isRevealed, setIsRevealed] = useState(!autoReveal);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (autoReveal && !isRevealed) {
      const timer = setTimeout(() => setIsRevealed(true), revealDelay);
      return () => clearTimeout(timer);
    }
  }, [autoReveal, isRevealed, revealDelay]);

  const displayedTex = showStepper && steps.length > 0
    ? steps[currentStep]?.tex ?? tex
    : tex;

  const currentStepData = steps[currentStep];

  const goToStep = (index: number) => {
    if (index >= 0 && index < steps.length) {
      setCurrentStep(index);
    }
  };

  const nextStep = () => goToStep(currentStep + 1);
  const prevStep = () => goToStep(currentStep - 1);
  const reveal = () => setIsRevealed(true);

  const html = renderMath(displayedTex, true).html;

  return createElement("div", {
    ref: containerRef,
    className: `math-diagram variant-${variant}`,
    "data-variant": variant,
  },
    variant !== "equation" && createElement("div", { className: "variant-badge" }, variant),

    createElement("div", {
      className: `math-content ${isRevealed ? "revealed" : "hidden"}`,
      onClick: !isRevealed ? reveal : undefined,
    },
      createElement("span", {
        className: "katex-display",
        dangerouslySetInnerHTML: { __html: html },
      }),

      currentStepData?.label && createElement("span", { className: "step-label" }, currentStepData.label)
    ),

    annotations.length > 0 && isRevealed && createElement("div", { className: "annotations-layer" },
      annotations.map((ann, i) =>
        createElement("div", {
          key: i,
          className: `annotation annotation-${ann.type}`,
          style: { color: ann.color },
        }, ann.label)
      )
    ),

    showStepper && steps.length > 1 && createElement("div", { className: "stepper-controls" },
      createElement("button", {
        className: "stepper-btn",
        onClick: prevStep,
        disabled: currentStep === 0,
      }, "←"),

      createElement("span", { className: "step-counter" },
        `${currentStep + 1} / ${steps.length}`
      ),

      currentStep < steps.length - 1
        ? createElement("button", { className: "stepper-btn", onClick: nextStep }, "→")
        : createElement("button", { className: "stepper-btn complete", disabled: true }, "✓")
    ),

    !isRevealed && createElement("div", { className: "reveal-hint" }, "Click to reveal")
  );
}

interface DerivationStepperProps {
  steps: MathStep[];
  initialStep?: number;
  showNavigation?: boolean;
  highlightChanges?: boolean;
}

export function DerivationStepper({
  steps,
  initialStep = 0,
  showNavigation = true,
  highlightChanges = true,
}: DerivationStepperProps) {
  const [currentStep, setCurrentStep] = useState(initialStep);

  const current = steps[currentStep];
  const prev = steps[currentStep - 1];

  const getChangedElements = (): string | null => {
    if (!highlightChanges || !prev) return null;
    return current.highlight ?? null;
  };

  const changed = getChangedElements();

  return createElement("div", { className: "derivation-stepper" },
    createElement("div", { className: "derivation-steps" },
      steps.map((step, i) =>
        createElement("div", {
          key: i,
          className: `derivation-step ${i < currentStep ? "completed" : ""} ${i === currentStep ? "current" : ""}`,
          onClick: () => setCurrentStep(i),
        },
          createElement("span", { className: "step-number" }, i + 1),
          createElement("span", {
            className: "step-tex",
            dangerouslySetInnerHTML: { __html: renderMath(step.tex, true).html },
          }),
          step.label && createElement("span", { className: "step-label" }, step.label)
        )
      )
    ),

    showNavigation && createElement("div", { className: "derivation-nav" },
      createElement("button", {
        className: "nav-btn",
        onClick: () => setCurrentStep((s) => Math.max(0, s - 1)),
        disabled: currentStep === 0,
      }, "Previous"),

      createElement("button", {
        className: "nav-btn primary",
        onClick: () => setCurrentStep((s) => Math.min(steps.length - 1, s + 1)),
        disabled: currentStep === steps.length - 1,
      }, "Next")
    ),

    createElement("div", { className: "derivation-progress" },
      createElement("div", {
        className: "progress-fill",
        style: { width: `${((currentStep + 1) / steps.length) * 100}%` },
      })
    )
  );
}
