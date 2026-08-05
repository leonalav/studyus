import { Orbit, Sigma, Binary, Landmark } from "lucide-react";
import type { Subject } from "../data/tutor";

export function SubjectIcon({ icon, size = 14, className }: { icon: Subject["icon"]; size?: number; className?: string }) {
  const common = { size, className, strokeWidth: 1.75 };
  switch (icon) {
    case "orbit":
      return <Orbit {...common} />;
    case "sigma":
      return <Sigma {...common} />;
    case "binary":
      return <Binary {...common} />;
    case "landmark":
      return <Landmark {...common} />;
  }
}
