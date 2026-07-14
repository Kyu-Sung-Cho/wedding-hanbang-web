/**
 * Raw chat feedback is intentionally excluded from model context.
 *
 * `chat_feedback.correction` can contain private conversation text and the
 * table has no visibility provenance. Until a migration adds an explicitly
 * consented, anonymized learning artifact, feedback learning fails closed.
 */
export async function loadFeedbackLessons(coupleId: string | null): Promise<string[]> {
  void coupleId;
  return [];
}
