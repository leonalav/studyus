import { getDb } from "../db/database";
import { parseAssessmentFigureJson } from "./assessmentFigure";
import type { VisualizationIntent } from "./visualization/types";

export type QuestionBankStatus = "correct" | "wrong" | "unattempted" | "needs-review";
export type QuestionBankFormat = "mcq" | "numeric" | "proof";

export interface QuestionBankRecord {
  id: string;
  prompt: string;
  subject: string;
  topic: string;
  format: QuestionBankFormat;
  status: QuestionBankStatus;
  yourAnswer: string;
  correctAnswer: string;
  reason: string;
  figure?: VisualizationIntent;
}

/**
 * Return learner question-history records only after submission has completed.
 *
 * Every generated question is already durably logged in `assessment_items` at
 * creation time. This read boundary is what prevents those rows (and especially
 * their answer specs) from leaking through Question bank before the learner has
 * finished the test. A submitted attempt whose automatic grading was blocked is
 * still finished and is therefore revealed, but its ungraded items are labelled
 * `needs-review` rather than incorrectly counted as wrong.
 */
export async function getCompletedQuestionBankRecords(): Promise<QuestionBankRecord[]> {
  const db = await getDb();
  const itemsRes = db.exec(`
    SELECT a.id, i.id, i.stem, i.curriculum_node, i.item_type,
           i.answer_spec_json, i.figure_spec_json, f.subject, r.committed_response,
           r.grading_status, scores.awarded_mark, scores.maximum_mark, scores.rationale
    FROM assessment_attempts a
    JOIN assessment_forms f ON f.id = a.form_id
    JOIN assessment_items i ON i.form_id = a.form_id
    LEFT JOIN attempt_responses r
      ON r.attempt_id = a.id AND r.item_id = i.id
    LEFT JOIN (
      SELECT response_id,
             SUM(awarded_mark) AS awarded_mark,
             SUM(maximum_mark) AS maximum_mark,
             GROUP_CONCAT(rationale, ' ') AS rationale
      FROM criterion_scores
      GROUP BY response_id
    ) scores ON scores.response_id = r.id
    WHERE a.submitted_at IS NOT NULL
      AND a.completed_at IS NOT NULL
      AND a.status IN ('completed', 'grading_blocked')
    ORDER BY a.completed_at DESC, i.stable_ordinal ASC;
  `);

  if (!itemsRes[0]) return [];

  return itemsRes[0].values.map((row) => {
    const attemptId = row[0] as string;
    const itemId = row[1] as string;
    const prompt = row[2] as string;
    const topic = (row[3] as string) || "General Concept";
    const itemType = row[4] as string;
    const specRaw = row[5] as string;
    const storedFigure = parseAssessmentFigureJson(row[6]);
    const figure = storedFigure?.ok ? storedFigure.value : undefined;
    const rawSubject = (row[7] as string) || "General";
    const userResp = (row[8] as string) || "";
    const gradingStatus = (row[9] as string) || "unseen";
    const awarded = (row[10] as number) ?? 0;
    const maxMark = (row[11] as number) ?? 1;
    const rationale = (row[12] as string) || "";

    let status: QuestionBankStatus = "unattempted";
    if (gradingStatus === "grading_blocked") {
      status = "needs-review";
    } else if (userResp.trim()) {
      status = awarded >= maxMark ? "correct" : "wrong";
    }

    let spec: any = {};
    try {
      spec = JSON.parse(specRaw);
    } catch {
      spec = {};
    }
    const acceptedValue = spec.accepted?.[0]?.value;
    const acceptedOption = itemType === "mcq" && acceptedValue
      ? spec.options?.find((option: { id?: unknown }) => String(option?.id ?? "") === String(acceptedValue))
      : null;
    const correctAnswer = acceptedOption?.text
      ?? acceptedValue
      ?? spec.reference_solution
      ?? "No reference answer is available.";

    const format: QuestionBankFormat = itemType === "mcq"
      ? "mcq"
      : itemType === "numeric"
        ? "numeric"
        : "proof";

    return {
      // Retakes share immutable item ids, but each completed attempt is its own
      // learner record and must retain its own answer and evaluation.
      id: `${attemptId}:${itemId}`,
      prompt,
      subject: rawSubject.charAt(0).toUpperCase() + rawSubject.slice(1),
      topic,
      format,
      status,
      yourAnswer: userResp || "No attempt recorded",
      correctAnswer: String(correctAnswer),
      reason:
        rationale
        || (status === "needs-review"
          ? "Automatic grading could not make a reliable decision. This answer was held for review, not marked wrong."
          : status === "correct"
            ? "Evaluation verified requirement."
            : "Review required step."),
      figure,
    };
  });
}
