import { getDb } from "../db/database";

export type QuestionBankStatus = "correct" | "wrong" | "unattempted";

export interface QuestionBankRecord {
  id: string;
  prompt: string;
  subject: string;
  topic: string;
  format: "mcq" | "proof";
  status: QuestionBankStatus;
  yourAnswer: string;
  correctAnswer: string;
  reason: string;
}

/**
 * Return learner question-history records only after their attempt is fully
 * completed. Generated and in-progress forms remain available to the test
 * runner, but must not leak into Question bank as unattempted questions.
 */
export async function getCompletedQuestionBankRecords(): Promise<QuestionBankRecord[]> {
  const db = await getDb();
  const itemsRes = db.exec(`
    SELECT a.id, i.id, i.stem, i.curriculum_node, i.item_type,
           i.answer_spec_json, f.subject, r.committed_response,
           scores.awarded_mark, scores.maximum_mark, scores.rationale
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
    WHERE a.status = 'completed'
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
    const rawSubject = (row[6] as string) || "General";
    const userResp = (row[7] as string) || "";
    const awarded = (row[8] as number) ?? 0;
    const maxMark = (row[9] as number) ?? 1;
    const rationale = (row[10] as string) || "";

    let status: QuestionBankStatus = "unattempted";
    if (userResp.trim()) {
      status = awarded >= maxMark ? "correct" : "wrong";
    }

    let spec: any = {};
    try {
      spec = JSON.parse(specRaw);
    } catch {
      spec = {};
    }
    const correctAnswer = spec.accepted?.[0]?.value ?? spec.reference_solution ?? "Reference solution";

    return {
      // Retakes share immutable item ids, but each completed attempt is its own
      // learner record and must retain its own answer and evaluation.
      id: `${attemptId}:${itemId}`,
      prompt,
      subject: rawSubject.charAt(0).toUpperCase() + rawSubject.slice(1),
      topic,
      format: itemType === "mcq" ? "mcq" : "proof",
      status,
      yourAnswer: userResp || "No attempt recorded",
      correctAnswer,
      reason:
        rationale
        || (status === "correct" ? "Evaluation verified requirement." : "Review required step."),
    };
  });
}
