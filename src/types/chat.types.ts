import type { ChatMessage, MessageSenderRole, ToolExecutionResult, ChatMessageMetadata } from "./database.types";

// 스토어 상태
export interface ChatStoreState {
  messages: ChatMessage[];
  isLoading: boolean;
  isStreaming: boolean;
  streamingContent: string;
  streamingToolResults: ToolExecutionResult[];
  suggestions: string[];
  error: string | null;

  loadMessages: (coupleId: string) => Promise<void>;
  sendMessage: (params: SendMessageParams) => Promise<void>;
  subscribeToMessages: (coupleId: string) => () => void;
  reset: () => void;
}

export interface SendMessageParams {
  content: string;
  senderId: string;
  senderRole: MessageSenderRole;
  coupleId: string;
  senderName: string;
  weddingContext: WeddingContext;
}

export interface WeddingContext {
  weddingDate: string | null;
  budget: number;
  venue: string | null;
  progress: Record<string, unknown>;
}

// API 타입
export interface ChatAPIRequest {
  messages: { role: string; content: string }[];
  coupleId: string;
  senderName: string;
  senderRole: MessageSenderRole;
  weddingContext: WeddingContext;
}

// SSE 이벤트 타입
export type SSEEvent =
  | { type: "text_delta"; content: string }
  | { type: "text_clear" }
  | { type: "tool_start"; toolName: string; toolInput: Record<string, unknown> }
  | { type: "tool_result"; result: ToolExecutionResult }
  | { type: "suggestions"; suggestions: string[] }
  | { type: "done"; fullContent: string; metadata: ChatMessageMetadata }
  | { type: "error"; message: string };

// 채팅방
export interface ChatRoom {
  id: string;
  title: string;
  createdAt: string;
}

export type { ChatMessage, MessageSenderRole, ToolExecutionResult, ChatMessageMetadata };
