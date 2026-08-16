import type { VisualizationIntent, VisualizationState } from "../lib/visualization/types";
import type { WidgetIntent, WidgetState } from "../lib/widgets/types";
import { WIDGET_LABEL } from "../lib/widgets/types";

export type Domain = "math" | "physics" | "chemistry" | "biology" | "programming";

export const DOMAIN_META: Record<Domain, { label: string; accent: string; module: string }> = {
  math: { label: "Mathematics", accent: "#7dd3fc", module: "" },
  physics: { label: "Physics", accent: "#a5b4fc", module: "" },
  chemistry: { label: "Chemistry", accent: "#fca5a5", module: "" },
  biology: { label: "Biology", accent: "#86efac", module: "" },
  programming: { label: "Programming", accent: "#fcd34d", module: "" },
};

export function detectDomain(text: string): Domain {
  const t = text.toLowerCase();
  if (/\b(cell|dna|rna|enzyme|protein|mitosis|genetic|organism|photosynth|evolution|neuron)\b/.test(t)) return "biology";
  if (/\b(mole|atom|bond|acid|base|ph|reaction|molecul|titrat|oxid|electron shell|periodic)\b/.test(t)) return "chemistry";
  if (/\b(code|algorithm|big-?o|function|loop|recursion|array|complexity|python|javascript|sort|data structure)\b/.test(t))
    return "programming";
  if (/\b(orbit|force|velocity|gravity|momentum|energy|newton|kinemat|wave|quantum|thermodynam|circuit)\b/.test(t))
    return "physics";
  if (/\b(derivative|integral|limit|matrix|vector|equation|theorem|proof|algebra|geometry|probability|calculus)\b/.test(t))
    return "math";
  return "physics";
}

export type Block =
  | { id: string; kind: "title"; text: string }
  | { id: string; kind: "text"; text: string }
  | { id: string; kind: "bullets"; items: string[] }
  | { id: string; kind: "latex"; tex: string; caption?: string }
  | { id: string; kind: "visualization"; intent: VisualizationIntent; state?: VisualizationState }
  /** One of the 17 official chalkboard study widgets. `intent` is the agent's
   *  configuration; `state` is the learner's interaction with it, which
   *  round-trips through the saved session and back into the tutor prompt. */
  | { id: string; kind: "widget"; intent: WidgetIntent; state?: WidgetState }
  | { id: string; kind: "callout"; text: string }
  | { id: string; kind: "row"; children: Block[] };

export interface ThreadMetadata {
  createdBy: "learner" | "agent";
  reason: string;
  createdAt: string;
}

export interface BoardDoc {
  id: string;
  title: string;
  subtitle: string;
  domain: Domain;
  blocks: Block[];
  parentId?: string;
  /** Present for boards that were branched from another board. This metadata
   * round-trips with the stored study session and mirrors the SQLite thread log. */
  thread?: ThreadMetadata;
}

let boardSeq = 0;
const uid = (p: string) => `${p}-${++boardSeq}`;

/**
 * Build an empty board for a study session.
 *
 * `title` must NEVER be the learner's raw prompt — the Chalkboard renders the
 * title as the board's opening line when there are no blocks yet, and echoing
 * the user's own question back onto the chalkboard reads as the tutor parroting
 * them. Prefer the chosen curriculum concept; fall back to the subject label.
 * The prompt is still available to the tutor via `learnerMessage`; it just
 * doesn't get painted on the board.
 */
export function buildBoard(domain: Domain, prompt: string, concept?: string): BoardDoc {
  const title = concept?.trim() || DOMAIN_META[domain].label;
  return {
    id: uid("board"),
    domain,
    subtitle: trimPrompt(prompt),
    title,
    blocks: [],
  };
}

export function buildSubBoard(selection: string, question: string, parent: BoardDoc): BoardDoc {
  const s = selection.length > 46 ? selection.slice(0, 46) + "…" : selection;
  const domain = parent.domain;
  // Do NOT echo the learner's question back onto the board — open the branch on
  // the highlighted concept itself and let the tutor's reply fill it in.
  const blocks: Block[] = [
    { id: uid("b"), kind: "title", text: s },
    {
      id: uid("b"),
      kind: "text",
      text: "Let's unpack the part you highlighted, one layer at a time.",
    },
  ];

  return {
    id: uid("board"),
    title: s,
    subtitle: question ? trimPrompt(question) : `Branched from ${parent.title}`,
    domain,
    blocks,
    parentId: parent.id,
    thread: {
      createdBy: "learner",
      reason: question.trim() || `Explore the highlighted passage: ${s}`,
      createdAt: new Date().toISOString(),
    },
  };
}

function trimPrompt(p: string) {
  const clean = p.trim().replace(/\s+/g, " ");
  return clean.length > 68 ? clean.slice(0, 68) + "…" : clean || "Study session";
}

function visualizationLabel(intent: VisualizationIntent): string {
  switch (intent.type) {
    case "geometry":
      return intent.title ?? "Geometry";
    case "function":
      return intent.title ?? "Function Graph";
    case "chart":
      return intent.title ?? "Chart";
    case "equation":
      return "Equation";
    case "diagram":
      return intent.variant;
    case "physics":
      return intent.title ?? "Physics Diagram";
    case "biology":
      return intent.title ?? "Biology Diagram";
    case "circuit":
      return intent.title ?? "Circuit";
    case "chemistry":
      return intent.title ?? "Chemistry";
    case "graph_theory":
      return intent.title ?? "Graph";
    default:
      return "Visualization";
  }
}

function visualizationCaption(intent: VisualizationIntent): string {
  switch (intent.type) {
    case "equation":
      return intent.caption ?? intent.latex;
    case "diagram":
      return intent.caption ?? "";
    case "physics":
    case "biology":
      return intent.caption ?? "";
    case "circuit":
      return intent.caption ?? "";
    case "chemistry":
      return intent.caption ?? intent.molecule ?? intent.reaction ?? "";
    default:
      return "";
  }
}

/**
 * Export a study widget to Markdown for session notes.
 *
 * Notes are the learner's durable artifact, so a widget must export the
 * teaching content it carried — a bare "[Question]" placeholder would silently
 * drop most of the lesson from an exported session.
 */
function widgetToMarkdown(intent: WidgetIntent, state?: WidgetState): string[] {
  const heading = `**[${intent.title?.trim() || WIDGET_LABEL[intent.kind]}]**`;
  const lines: string[] = [heading];
  const bullet = (items: readonly string[] | undefined, prefix = "- ") => {
    for (const item of items ?? []) lines.push(`${prefix}${item}`);
  };

  switch (intent.kind) {
    case "roadmap":
      if (intent.heading) lines.push(intent.heading);
      for (const step of intent.steps) {
        const marker = step.state === "done" ? "x" : " ";
        lines.push(`- [${marker}] ${step.label}${step.state === "current" ? "  ← current" : ""}`);
      }
      break;
    case "concept_card":
      lines.push(`**${intent.term}** — ${intent.definition}`);
      if (intent.definitionLatex) lines.push("$$", intent.definitionLatex, "$$");
      bullet(intent.facets);
      break;
    case "slider":
      lines.push(`${intent.label}: ${state?.sliderValue ?? intent.value}${intent.unit ?? ""} (range ${intent.min}–${intent.max})`);
      if (intent.observe) lines.push(`_${intent.observe}_`);
      break;
    case "animation":
      if (intent.predictPrompt) lines.push(`_Predict:_ ${intent.predictPrompt}`);
      intent.frames.forEach((frame, index) => lines.push(`${index + 1}. ${frame.caption}`));
      break;
    case "comparison":
      if (intent.rows?.length) {
        lines.push(`| | ${intent.columns.map((column) => column.title).join(" | ")} |`);
        lines.push(`| --- | ${intent.columns.map(() => "---").join(" | ")} |`);
        for (const row of intent.rows) lines.push(`| ${row.label} | ${row.cells.join(" | ")} |`);
      } else {
        for (const column of intent.columns) {
          lines.push(`_${column.title}_`);
          bullet(column.items);
        }
      }
      if (intent.takeaway) lines.push(intent.takeaway);
      break;
    case "question":
    case "retrieval_check": {
      lines.push(intent.prompt);
      if (intent.promptLatex) lines.push("$$", intent.promptLatex, "$$");
      for (const option of intent.options ?? []) {
        lines.push(`- ${option.correct ? "**" : ""}${option.label}${option.correct ? "**" : ""}`);
      }
      if (state?.responseText) lines.push(`_Your answer:_ ${state.responseText}`);
      if (state?.correct !== undefined) lines.push(`_Result:_ ${state.correct ? "correct" : "not correct"}`);
      if (intent.explanation) lines.push(intent.explanation);
      break;
    }
    case "hint":
      for (const step of [...intent.steps].sort((a, b) => a.level - b.level)) {
        lines.push(`${step.level}. ${step.label} — ${step.body}`);
      }
      break;
    case "scratchpad":
      if (intent.prompt) lines.push(intent.prompt);
      if (state?.responseText || intent.starter) lines.push("```", state?.responseText ?? intent.starter ?? "", "```");
      break;
    case "annotation":
      if (intent.targetLabel) lines.push(`_On: ${intent.targetLabel}_`);
      for (const mark of intent.marks) lines.push(`- \`${mark.target}\` — ${mark.note}`);
      break;
    case "reveal":
      if (intent.prompt) lines.push(intent.prompt);
      for (const item of intent.items) lines.push(`- ${item.label}: ${item.contentLatex ?? item.content}`);
      break;
    case "example":
      if (intent.problem) lines.push(intent.problem);
      if (intent.problemLatex) lines.push("$$", intent.problemLatex, "$$");
      intent.steps.forEach((step, index) => {
        lines.push(`${index + 1}. ${step.latex ? `$${step.latex}$` : step.expression ?? ""} — ${step.why}`);
      });
      if (intent.conclusion) lines.push(intent.conclusion);
      break;
    case "mistake_check":
      for (const line of intent.lines) {
        lines.push(`- ${line.status === "error" ? "~~" : ""}${line.content}${line.status === "error" ? "~~" : ""}${line.diagnosis ? ` — ${line.diagnosis}` : ""}`);
      }
      if (intent.misconception) lines.push(`_Misconception:_ ${intent.misconception}`);
      if (intent.correction) lines.push(`_Correct:_ ${intent.correction}`);
      break;
    case "memory_hook":
      lines.push(`> ${intent.hook.replace(/\n/g, "\n> ")}`);
      if (intent.elaboration) lines.push(intent.elaboration);
      break;
    case "challenge":
      lines.push(intent.prompt);
      if (intent.promptLatex) lines.push("$$", intent.promptLatex, "$$");
      for (const part of intent.parts ?? []) lines.push(`- ${part.prompt}`);
      bullet(intent.successCriteria);
      if (state?.responseText) lines.push(`_Your solution:_ ${state.responseText}`);
      break;
    case "reflection":
      lines.push(intent.prompt);
      bullet(intent.guidance);
      if (state?.responseText) lines.push(`_Your explanation:_ ${state.responseText}`);
      break;
    case "mastery_card": {
      lines.push(`### ${intent.concept}`);
      // Absent evidence exports as "unproven" rather than as zeros: a markdown
      // export claiming 0% across the board reads as a measured failure, when
      // what actually happened is that nothing was measured.
      if (intent.evidence) {
        for (const [dimension, score] of Object.entries(intent.evidence)) {
          lines.push(`- ${dimension}: ${Math.round(Number(score) || 0)}%`);
        }
      } else {
        lines.push("- evidence: not yet established");
      }
      if (intent.understands?.length) { lines.push("_Understands_"); bullet(intent.understands); }
      if (intent.canDo?.length) { lines.push("_Can do_"); bullet(intent.canDo); }
      if (intent.recalls?.length) { lines.push("_Recall_"); bullet(intent.recalls); }
      if (intent.watch?.length) { lines.push("_Watch_"); bullet(intent.watch, "- △ "); }
      if (intent.next) lines.push(`_Next:_ ${intent.next}`);
      break;
    }
  }

  if (intent.note) lines.push(`_${intent.note}_`);
  return lines;
}

/**
 * Placeholder prep steps for the SessionCard animated "loading" sequence.
 * These are being replaced with a real curriculum transcription pipeline that
 * shows "Preparing curriculum..." with a progress bar. For now, returns empty
 * so the prep completes instantly and no fake text appears.
 */
export function prepSteps(_domain: Domain): string[] {
  return [];
}

export function boardToMarkdown(board: BoardDoc): string {
  const lines: string[] = [`# ${board.title}`, "", `_${DOMAIN_META[board.domain].label} · ${board.subtitle}_`, ""];

  const walk = (blocks: Block[]) => {
    for (const b of blocks) {
      switch (b.kind) {
        case "title":
          lines.push(`## ${b.text}`, "");
          break;
        case "text":
          lines.push(b.text, "");
          break;
        case "bullets":
          lines.push(...b.items.map((i) => `- ${i}`), "");
          break;
        case "latex":
          lines.push("$$", b.tex, "$$", b.caption ? `_${b.caption}_` : "", "");
          break;
        case "callout":
          lines.push(`> ${b.text}`, "");
          break;
        case "visualization": {
          const caption = visualizationCaption(b.intent);
          lines.push(caption ? `**[${visualizationLabel(b.intent)}]** ${caption}` : `**[${visualizationLabel(b.intent)}]**`, "");
          break;
        }
        case "widget":
          lines.push(...widgetToMarkdown(b.intent, b.state), "");
          break;
        case "row":
          walk(b.children);
          break;
      }
    }
  };

  walk(board.blocks);
  return lines.join("\n");
}
