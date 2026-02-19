import type { ChatMessage, MessageSenderRole } from "./database.types";

export interface ChatState {
  messages: ChatMessage[];
  isLoading: boolean;
  isStreaming: boolean;
  error: string | null;
}

export interface SendMessagePayload {
  content: string;
  coupleId: string;
  senderId: string;
  senderRole: MessageSenderRole;
}

export interface ChatAPIRequest {
  messages: { role: string; content: string }[];
  coupleId: string;
  senderName: string;
  weddingContext: {
    weddingDate: string | null;
    budget: number;
    progress: Record<string, unknown>;
  };
}

export interface ChatAPIResponse {
  content: string;
  messageId: string;
}
