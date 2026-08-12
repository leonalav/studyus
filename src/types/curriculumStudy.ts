export interface CurriculumStudySelection {
  sourceId: string;
  /** Null selects the whole curriculum; a value binds the exact subsection. */
  nodeId: string | null;
  label: string;
}
