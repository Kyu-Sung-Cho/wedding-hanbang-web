import type { DissatisfactionResult } from "./dissatisfaction";

export type ConversationVisibility = "shared" | "bride_private" | "groom_private";

export interface AutomaticDissatisfactionInput {
  userId: string;
  coupleId: string;
  signal: DissatisfactionResult["signal"];
  visibility: ConversationVisibility;
}

export interface AutomaticFeedbackRecord {
  user_id: string;
  couple_id: string;
  message_id: string | null;
  rating: "bad";
  category: string;
  correction: null;
  message_content: null;
}

type PersistAutomaticFeedback = (record: AutomaticFeedbackRecord) => Promise<void>;

/**
 * Persists only a structured signal from shared conversations.
 * Private turn text and automatic free text never enter chat_feedback.
 */
export async function saveAutomaticDissatisfaction(
  input: AutomaticDissatisfactionInput,
  persist: PersistAutomaticFeedback
): Promise<boolean> {
  if (input.visibility !== "shared") {
    return false;
  }

  await persist({
    user_id: input.userId,
    couple_id: input.coupleId,
    // Client-provided history IDs are not an ownership proof. Automatic
    // analytics intentionally has no link back to a conversation row.
    message_id: null,
    rating: "bad",
    category: input.signal,
    correction: null,
    message_content: null,
  });

  return true;
}
