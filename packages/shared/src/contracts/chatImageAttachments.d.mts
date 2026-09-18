export declare const CHAT_IMAGE_URLS_ENDPOINT: "/api/chat/image-urls";
export declare const CHAT_IMAGE_MAX_ATTACHMENTS: 10;
export declare const CHAT_IMAGE_CLIENT_REFRESH_TTL_MS: number;
export declare const CHAT_IMAGE_SIGNED_URL_PATH_PREFIX: "/storage/v1/object/sign/chat-image/";

export interface ChatImageAttachmentRefs {
  /** imagePaths 다음 legacy imageUrls, 문자열만, 중복 없이, 최대 10개. */
  readonly refs: readonly string[];
  /** refs 를 `|` 로 이은 안정적인 키. 첨부가 없으면 빈 문자열이다. */
  readonly attachmentKey: string;
}

export declare function getChatImageAttachmentRefs(metadata: unknown): ChatImageAttachmentRefs;

export declare function hasChatImageAttachments(metadata: unknown): boolean;

export interface ChatImageUrlsParseResult {
  /** 그려도 되는 서명 URL. 서버가 보낸 순서 그대로다. */
  readonly urls: readonly string[];
  /** 서버가 보낸 항목 수(urls 가 배열이 아니면 0). */
  readonly received: number;
  /** 버린 항목 수. */
  readonly rejected: number;
  /** urls 가 배열이 아니거나 최대 개수를 넘어 응답 전체를 버렸다. */
  readonly malformed: boolean;
}

export declare function parseChatImageUrlsResponse(
  payload: unknown,
  options: { supabaseUrl: string | null | undefined },
): ChatImageUrlsParseResult;
