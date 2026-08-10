export type SubjectKey = "math" | "biology" | "chemistry" | "physics" | "programming";

export const SUBJECT_LIST: { id: SubjectKey; label: string; accent: string }[] = [
  { id: "math", label: "Math", accent: "#7dd3fc" },
  { id: "biology", label: "Biology", accent: "#86efac" },
  { id: "chemistry", label: "Chemistry", accent: "#fca5a5" },
  { id: "physics", label: "Physics", accent: "#a5b4fc" },
  { id: "programming", label: "Programming", accent: "#fcd34d" },
];

export interface Subsection {
  id: string;
  label: string;
}
export interface Section {
  id: string;
  label: string;
  subsections: Subsection[];
}
export interface CurriculumDoc {
  id: string;
  name: string;
  subject: SubjectKey;
  pages: number;
  sections: Section[];
}

export type ExamMode = "module" | "final" | "custom";
export type Rigor = "casual" | "challenging" | "rigorous";
export type QuestionFormat = "mcq" | "proof" | "mixed";

export const MAX_MCQ = 50;
export const MAX_PROOF = 15;

export function maxQuestions(format: QuestionFormat) {
  if (format === "mcq") return MAX_MCQ;
  if (format === "proof") return MAX_PROOF;
  return Math.round((MAX_MCQ + MAX_PROOF) / 2); // mixed
}
