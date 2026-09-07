import { compareChatTimestamps } from "../utils/chatTimestamp";
import { todayYmdInKst } from "../utils/kstDay";
import { buildAmoraActionConfirmationOutcomes, getAmoraPendingActionApplicationState } from "./amoraPendingActionApplication";

export interface RecapMessage {
  id: string;
  couple_id: string;
  sender_id: string | null;
  sender_role?: unknown;
  sender_type?: unknown;
  visibility: string;
  content: string;
  created_at: string;
  metadata?: {
    target?: unknown;
    response_origin?: unknown;
    pinned_safety_card?: unknown;
    confirmed_amora_action_id?: unknown;
    in_reply_to_user_message_id?: unknown;
    toolResults?: unknown;
  } | null;
}

export interface RecapAction {
  actionId: string;
  tool: string;
  confirmation: string;
  expiresAt: number;
}

export interface ConversationRecap {
  day: string | null;
  messageCount: number;
  lastQuestion: { messageId: string; text: string; createdAt: string } | null;
  actions: Array<{
    actionId: string;
    messageId: string;
    text: string;
    state: "applied" | "pending" | "awaiting_result" | "failed" | "expired" | "superseded";
  }>;
}

export interface ConversationRecapInput<T extends RecapMessage> {
  messages: readonly T[];
  coupleId: string;
  userId: string;
  role: "bride" | "groom";
  visibility: "shared" | "bride_private" | "groom_private";
  clearedAt: string | null;
  nowMs: number;
  /** 각 클라이언트의 기존 엄격한 제안 파서만 사용한다. */
  readPending: (message: T) => RecapAction | null;
}

export function buildAmoraConversationRecap<T extends RecapMessage>(
  input: ConversationRecapInput<T>,
): ConversationRecap {
  const empty: ConversationRecap = { day: null, messageCount: 0, lastQuestion: null, actions: [] };
  const { coupleId, userId, role, visibility, clearedAt, nowMs } = input;
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!uuid.test(coupleId) || !uuid.test(userId) || !Number.isFinite(nowMs) || nowMs <= 0
    || (visibility !== "shared" && visibility !== `${role}_private`)
    || (clearedAt !== null && compareChatTimestamps(clearedAt, clearedAt) === null)) return empty;

  // 현재 불러온 범위 밖의 원문·임시 행·안전 카드는 정리나 재개 초안으로 복사하지 않는다.
  const candidates = input.messages.filter(message =>
    uuid.test(message.id) && message.couple_id === coupleId && message.visibility === visibility
    && typeof message.content === "string" && Number.isFinite(Date.parse(message.created_at))
    && Date.parse(message.created_at) <= nowMs
    && (clearedAt === null || compareChatTimestamps(message.created_at, clearedAt) === 1)
    && message.metadata?.target !== "partner" && !message.metadata?.response_origin
    && message.metadata?.pinned_safety_card !== true);
  const userRows = candidates.filter(message => {
    const sender = message.sender_role ?? message.sender_type;
    return (sender === "bride" || sender === "groom")
      && (visibility === "shared" || (message.sender_id === userId && sender === role));
  });
  const userRowIds = new Set(userRows.map(message => message.id));
  const rows = candidates.filter(message => {
    if ((message.sender_role ?? message.sender_type) !== "ai") return userRowIds.has(message.id);
    const sourceId = message.metadata?.in_reply_to_user_message_id;
    return typeof sourceId === "string" && userRowIds.has(sourceId);
  }).sort((a, b) => compareChatTimestamps(a.created_at, b.created_at) || a.id.localeCompare(b.id));
  const latest = rows.at(-1);
  if (!latest) return empty;
  const lastQuestion = [...rows].reverse().find(message => message.sender_id === userId
    && (message.sender_role ?? message.sender_type) === role
    && !message.metadata?.confirmed_amora_action_id && message.content.trim());
  const outcomes = buildAmoraActionConfirmationOutcomes(rows);
  const actions = new Map<string, ConversationRecap["actions"][number]>();
  if (visibility === "shared") for (const message of rows) {
    if ((message.sender_role ?? message.sender_type) !== "ai") continue;
    const action = input.readPending(message);
    if (!action || !uuid.test(action.actionId) || !action.confirmation.trim()
      || action.confirmation.length > 2000 || !Number.isFinite(action.expiresAt)) continue;
    const result = getAmoraPendingActionApplicationState(action, outcomes);
    const state = result !== "none" ? result : action.expiresAt <= nowMs ? "expired"
      : message.id !== latest.id ? "superseded" : "pending";
    actions.set(action.actionId, { actionId: action.actionId, messageId: message.id,
      text: action.confirmation, state });
  }
  return {
    day: todayYmdInKst(Date.parse(latest.created_at)), messageCount: rows.length,
    lastQuestion: lastQuestion ? { messageId: lastQuestion.id,
      text: lastQuestion.content.trim().slice(0, 600) + (lastQuestion.content.trim().length > 600 ? "…" : ""),
      createdAt: lastQuestion.created_at } : null,
    actions: [...actions.values()].reverse().slice(0, 12),
  };
}
