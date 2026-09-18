export declare const CHAT_IMAGE_ATTACHMENT_COPY: Readonly<{
  loadFailed: string;
  retry: string;
  retryAccessibilityLabel: string;
  loadingAccessibilityLabel: string;
  openAccessibilityHint: string;
  closeAccessibilityLabel: string;
}>;

export declare function chatImageAttachmentLabel(index: number): string;

export declare const CHAT_IMAGE_THUMBNAIL_GAP: number;

export declare function chatImageThumbnailSize(count: number): number;

export declare const CHAT_MESSAGE_ID_PATTERN: RegExp;

export interface ChatImageAttachmentTarget {
  messageId: string;
  attachmentKey: string;
  /** 첨부 참조 수(최대 10). 불러오는 동안 그 수만큼 자리를 둔다. */
  count: number;
}

export declare function getChatImageAttachmentTarget(message: unknown): ChatImageAttachmentTarget | null;

export declare const CHAT_IMAGE_DIAGNOSTIC_CODE: string;

export interface ChatImageDiagnostic {
  received: number;
  accepted: number;
  rejected: number;
  malformed: boolean;
}

export declare function reportChatImageDiagnostic(diagnostic: ChatImageDiagnostic): void;

export type ChatImageAttachmentStatus = "idle" | "loading" | "ready" | "empty" | "error";

export interface ChatImageAttachmentSnapshot {
  readonly status: ChatImageAttachmentStatus;
  readonly urls: readonly string[];
}

export interface ChatImageAttachmentParams {
  generation: number;
  ownerId: string;
  messageId: string;
  attachmentKey: string;
}

export interface ChatImageAttachmentStore {
  subscribe(listener: () => void): () => void;
  getSnapshot(params: ChatImageAttachmentParams): ChatImageAttachmentSnapshot;
  load(params: ChatImageAttachmentParams): Promise<void> | undefined;
  retry(params: ChatImageAttachmentParams): Promise<void> | undefined;
  reportImageError(params: ChatImageAttachmentParams, url: string): void;
  reset(generation: number): void;
}

export declare function createChatImageAttachmentStore(options: {
  request: (ownerId: string, path: string, init: RequestInit) => Promise<Response>;
  supabaseUrl: string | null | undefined;
  now?: () => number;
  reportDiagnostic?: (diagnostic: ChatImageDiagnostic) => void;
}): ChatImageAttachmentStore;
