export type AmoraPendingActionApplicationState = "none" | "awaiting_result" | "failed" | "applied";

interface ActionConfirmationMessage {
  id: string;
  sender_role?: unknown;
  sender_type?: unknown;
  metadata?: {
    in_reply_to_user_message_id?: unknown;
    confirmed_amora_action_id?: unknown;
    toolResults?: unknown;
  } | null;
}

interface ConfirmationOutcome {
  succeededTools: Set<string>;
  answered: boolean;
}

/** 확인 행에 연결된 AI 응답에서 같은 도구가 성공했을 때만 반영됐다고 표시한다. */
export function buildAmoraActionConfirmationOutcomes(
  messages: readonly ActionConfirmationMessage[],
): Map<string, ConfirmationOutcome> {
  const responsesByUserMessageId = new Map<string, ActionConfirmationMessage[]>();
  for (const message of messages) {
    if ((message.sender_role ?? message.sender_type) !== "ai") continue;
    const sourceId = message.metadata?.in_reply_to_user_message_id;
    if (typeof sourceId !== "string" || !sourceId) continue;
    const bucket = responsesByUserMessageId.get(sourceId);
    if (bucket) bucket.push(message);
    else responsesByUserMessageId.set(sourceId, [message]);
  }

  const outcomes = new Map<string, ConfirmationOutcome>();
  for (const message of messages) {
    const actionId = message.metadata?.confirmed_amora_action_id;
    if (typeof actionId !== "string" || !actionId) continue;
    const outcome = outcomes.get(actionId)
      ?? { succeededTools: new Set<string>(), answered: false };
    for (const response of responsesByUserMessageId.get(message.id) ?? []) {
      outcome.answered = true;
      const results = response.metadata?.toolResults;
      if (!Array.isArray(results)) continue;
      for (const result of results) {
        if (result !== null && typeof result === "object" &&
          result.success === true && typeof result.toolName === "string") {
          outcome.succeededTools.add(result.toolName);
        }
      }
    }
    outcomes.set(actionId, outcome);
  }
  return outcomes;
}

export function getAmoraPendingActionApplicationState(
  action: { actionId: string; tool: string },
  outcomes: Map<string, ConfirmationOutcome>,
): AmoraPendingActionApplicationState {
  const outcome = outcomes.get(action.actionId);
  if (!outcome) return "none";
  if (outcome.succeededTools.has(action.tool)) return "applied";
  return outcome.answered ? "failed" : "awaiting_result";
}
