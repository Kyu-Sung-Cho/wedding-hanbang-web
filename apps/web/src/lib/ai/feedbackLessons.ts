/**
 * Raw user corrections must never be copied into another user's system prompt.
 * The previous global-learning path is intentionally disabled until feedback is
 * opt-in, de-identified, aggregated, and human-reviewed into static guidance.
 */
export async function loadFeedbackLessons(_coupleId: string | null): Promise<string[]> {
  void _coupleId;
  return [];
}
