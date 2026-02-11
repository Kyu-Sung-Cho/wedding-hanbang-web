import { createClient } from "@/lib/supabase/client";
import { Message, MessageRole, MessageSender } from "@/types/chat.types";

export interface ChatMessageRow {
  id: string;
  couple_id: string;
  sender_type: string;
  content: string;
  role: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

// 채팅 메시지 저장
export async function saveChatMessage(
  coupleId: string,
  message: Message
) {
  const supabase = createClient();

  const metadata: Record<string, unknown> = {};
  if (message.buttons) metadata.buttons = message.buttons;
  if (message.vendorCards) metadata.vendorCards = message.vendorCards;
  if (message.quickReplies) metadata.quickReplies = message.quickReplies;
  if (message.budgetSelector) metadata.budgetSelector = message.budgetSelector;
  if (message.toolResults) metadata.toolResults = message.toolResults;
  if (message.etiquetteCards) metadata.etiquetteCards = message.etiquetteCards;
  if (message.checklistCards) metadata.checklistCards = message.checklistCards;

  const { error } = await supabase
    .from("chat_messages")
    .insert({
      id: message.id,
      couple_id: coupleId,
      sender_type: message.sender || "ai",
      content: message.content,
      role: message.role,
      metadata: Object.keys(metadata).length > 0 ? metadata : null,
      created_at: message.timestamp,
    });

  if (error) {
    console.error("채팅 저장 실패:", error);
    return false;
  }
  return true;
}

// 채팅 메시지 조회
export async function getChatMessages(
  coupleId: string,
  limit = 100
): Promise<Message[]> {
  const supabase = createClient();

  const { data, error } = await supabase
    .from("chat_messages")
    .select("*")
    .eq("couple_id", coupleId)
    .order("created_at", { ascending: true })
    .limit(limit);

  if (error) {
    console.error("채팅 조회 실패:", error);
    return [];
  }

  return (data || []).map(rowToMessage);
}

// DB Row → Message 변환
function rowToMessage(row: ChatMessageRow): Message {
  const metadata = row.metadata || {};
  return {
    id: row.id,
    role: row.role as MessageRole,
    content: row.content,
    timestamp: row.created_at,
    sender: row.sender_type as MessageSender,
    buttons: metadata.buttons as Message["buttons"],
    vendorCards: metadata.vendorCards as Message["vendorCards"],
    quickReplies: metadata.quickReplies as Message["quickReplies"],
    budgetSelector: metadata.budgetSelector as Message["budgetSelector"],
    toolResults: metadata.toolResults as Message["toolResults"],
    etiquetteCards: metadata.etiquetteCards as Message["etiquetteCards"],
    checklistCards: metadata.checklistCards as Message["checklistCards"],
  };
}

// 채팅 메시지 삭제 (전체)
export async function clearChatMessages(coupleId: string) {
  const supabase = createClient();

  const { error } = await supabase
    .from("chat_messages")
    .delete()
    .eq("couple_id", coupleId);

  if (error) {
    console.error("채팅 삭제 실패:", error);
    return false;
  }
  return true;
}

// 실시간 구독
export function subscribeToChatMessages(
  coupleId: string,
  callback: (message: Message) => void
) {
  const supabase = createClient();

  const channel = supabase
    .channel(`chat:${coupleId}`)
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "chat_messages",
        filter: `couple_id=eq.${coupleId}`,
      },
      (payload) => {
        if (payload.new) {
          callback(rowToMessage(payload.new as ChatMessageRow));
        }
      }
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}
