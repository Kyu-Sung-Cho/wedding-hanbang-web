import { classifyAmoraQuestionScope } from "@/lib/ai/amoraQuestionScope";
import type { ChatMessage } from "@/types/database.types";

type CommunitySafetyMessage = Pick<
  ChatMessage,
  "sender_role" | "content" | "metadata"
>;

/**
 * Fails closed for product-owned chat-to-community suggestions. Server scope
 * metadata is authoritative for AI rows; legacy human rows are reclassified
 * from their own text so missing historical metadata cannot expose W2/W5 copy.
 */
export function isAmoraCommunityBridgeSafetyScoped(
  message: CommunitySafetyMessage,
): boolean {
  if (message.metadata?.pinned_safety_card === true) return true;
  const questionScope = message.metadata?.question_scope;
  if (
    typeof questionScope === "string"
    && (
      questionScope.startsWith("W2_")
      || questionScope.startsWith("W5_")
    )
  ) return true;
  if (message.sender_role !== "bride" && message.sender_role !== "groom") {
    return false;
  }

  const classifiedScope = classifyAmoraQuestionScope({
    userText: message.content,
  }).scope;
  return classifiedScope === "W2_high_risk_adjacent"
    || classifiedScope === "W5_safety_override";
}
