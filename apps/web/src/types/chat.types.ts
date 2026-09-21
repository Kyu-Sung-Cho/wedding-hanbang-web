import type { ChatMessage, MessageSenderRole, ToolExecutionResult, ChatMessageMetadata, ChatMessageTarget, ChatMessageVisibility } from "./database.types";

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
  sendMessage: (params: SendMessageParams) => Promise<ChatSendOutcome>;
  subscribeToMessages: (coupleId: string) => () => void;
  reset: () => void;
}

export type ChatSendOutcome =
  | {
      userMessage: "persisted";
      userMessageId: string;
      effectiveVisibility?: ChatMessageVisibility;
      safetyPrivacyRedirected?: true;
    }
  | {
      userMessage: "ephemeral_demo";
      userMessageId: string;
      effectiveVisibility?: ChatMessageVisibility;
      safetyPrivacyRedirected?: true;
    }
  | {
      userMessage: "ephemeral_safety";
      safetyCardId: string;
      effectiveVisibility: ChatMessageVisibility;
      safetyPrivacyRedirected: boolean;
      partnerDeliveryHeld: boolean;
    }
  | { userMessage: "persistence_unknown"; clientRequestId: string }
  | {
      userMessage: "not_persisted";
      reason: "busy" | "validation" | "storage" | "database" | "unexpected";
      clientRequestId?: string;
    };

export interface ImageAttachmentData {
  base64: string;
  mediaType:
    | "image/jpeg"
    | "image/png"
    | "image/gif"
    | "image/webp"
    | "application/pdf"
    | "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  fileName?: string;
  previewUrl: string; // 로컬 미리보기용 object URL
}

export interface SendMessageParams {
  content: string;
  senderId: string;
  senderRole: MessageSenderRole;
  coupleId: string;
  senderName: string;
  weddingContext: WeddingContext;
  images?: ImageAttachmentData[];
  target?: ChatMessageTarget; // "ai" (기본) | "partner"
  /** Exact opposite roster slot; DB auto-pins only for legacy callers. */
  partnerRecipientId?: string;
  visibility?: ChatMessageVisibility; // "shared" (기본) | "bride_private" | "groom_private"
  /** Exact server-issued action id from an explicit confirmation control. */
  confirmedActionId?: string;
  /** Reuse only after a persistence-unknown outcome for the exact same draft. */
  clientRequestId?: string;
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
  | { type: "quota"; remaining: number; period?: "daily" | "total" }
  | { type: "done"; fullContent: string; metadata: ChatMessageMetadata }
  | {
      type: "error";
      code?: string;
      message: string;
      /** Whether the exact immutable request key may be replayed safely. */
      retryable?: boolean;
      /** Explicit replay contract. Takes precedence over the legacy boolean. */
      retryPolicy?: "same_request" | "new_message";
    };

export type { ChatMessage, MessageSenderRole, ToolExecutionResult, ChatMessageMetadata, ChatMessageTarget, ChatMessageVisibility };
