import { createElement, useState, useEffect, useRef, useCallback } from "react";

export interface AnimationKeyframe {
  id: string;
  label: string;
  description?: string;
  duration: number; // ms
  easing?: "linear" | "ease-in" | "ease-out" | "ease-in-out";
}

interface AnimationTimelineProps {
  keyframes: AnimationKeyframe[];
  autoPlay?: boolean;
  loop?: boolean;
  onKeyframeChange?: (index: number) => void;
  onPlayStateChange?: (isPlaying: boolean) => void;
}

export function AnimationTimeline({
  keyframes,
  autoPlay = false,
  loop = false,
  onKeyframeChange,
  onPlayStateChange,
}: AnimationTimelineProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(autoPlay);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const timerRef = useRef<number | null>(null);

  const totalDuration = keyframes.reduce((sum, kf) => sum + kf.duration, 0);

  const getEasing = (easing?: string): string => {
    switch (easing) {
      case "ease-in": return "cubic-bezier(0.4, 0, 1, 1)";
      case "ease-out": return "cubic-bezier(0, 0, 0.2, 1)";
      case "ease-in-out": return "cubic-bezier(0.4, 0, 0.2, 1)";
      default: return "linear";
    }
  };

  const advanceToNext = useCallback(() => {
    setCurrentIndex((prev) => {
      const next = prev + 1;
      if (next >= keyframes.length) {
        if (loop) return 0;
        setIsPlaying(false);
        onPlayStateChange?.(false);
        return prev;
      }
      return next;
    });
  }, [keyframes.length, loop, onPlayStateChange]);

  useEffect(() => {
    if (isPlaying && keyframes[currentIndex]) {
      const kf = keyframes[currentIndex];
      const adjustedDuration = kf.duration / playbackSpeed;

      timerRef.current = window.setTimeout(() => {
        advanceToNext();
      }, adjustedDuration);
    }

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, [isPlaying, currentIndex, keyframes, playbackSpeed, advanceToNext]);

  useEffect(() => {
    onKeyframeChange?.(currentIndex);
  }, [currentIndex, onKeyframeChange]);

  const togglePlay = () => {
    const newState = !isPlaying;
    setIsPlaying(newState);
    onPlayStateChange?.(newState);
  };

  const restart = () => {
    setCurrentIndex(0);
    if (!isPlaying) {
      setIsPlaying(true);
      onPlayStateChange?.(true);
    }
  };

  const goToKeyframe = (index: number) => {
    setCurrentIndex(index);
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
  };

  const currentKeyframe = keyframes[currentIndex];
  const progressPercent = ((currentIndex + 1) / keyframes.length) * 100;

  return createElement("div", { className: "animation-timeline" },
    // Timeline bar
    createElement("div", { className: "timeline-bar" },
      createElement("div", { className: "timeline-progress", style: { width: `${progressPercent}%` } }),
      keyframes.map((kf, i) =>
        createElement("div", {
          key: kf.id,
          className: `timeline-marker ${i <= currentIndex ? "active" : ""} ${i === currentIndex ? "current" : ""}`,
          style: { left: `${((i + 1) / keyframes.length) * 100}%` },
          onClick: () => goToKeyframe(i),
          title: kf.label,
        })
      )
    ),

    // Current keyframe info
    createElement("div", { className: "keyframe-info" },
      createElement("span", { className: "keyframe-label" }, currentKeyframe?.label ?? ""),
      createElement("span", { className: "keyframe-counter" }, `${currentIndex + 1} / ${keyframes.length}`)
    ),

    // Controls
    createElement("div", { className: "timeline-controls" },
      // Restart
      createElement("button", { className: "control-btn", onClick: restart, title: "Restart" }, "⏮"),

      // Play/Pause
      createElement("button", { className: "control-btn play-btn", onClick: togglePlay, title: isPlaying ? "Pause" : "Play" },
        isPlaying ? "⏸" : "▶"
      ),

      // Speed control
      createElement("div", { className: "speed-control" },
        createElement("label", null, "Speed:"),
        createElement("select", {
          value: playbackSpeed,
          onChange: (e) => setPlaybackSpeed(parseFloat(e.target.value)),
        },
          createElement("option", { value: "0.5" }, "0.5x"),
          createElement("option", { value: "1" }, "1x"),
          createElement("option", { value: "2" }, "2x"),
        )
      )
    ),

    // Keyframe labels
    createElement("div", { className: "keyframe-labels" },
      keyframes.map((kf, i) =>
        createElement("div", {
          key: kf.id,
          className: `keyframe-label-item ${i === currentIndex ? "current" : ""} ${i < currentIndex ? "past" : ""}`,
          onClick: () => goToKeyframe(i),
        }, kf.label)
      )
    )
  );
}
