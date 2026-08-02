export type ChatAttachmentDraft = {
  base64: string;
  mediaType: string;
  previewUrl?: string;
  fileName?: string;
};

export const CHAT_ATTACHMENT_MAX_COUNT = 5;
export const CHAT_ATTACHMENT_MAX_PROVIDER_BASE64_CHARS = 3 * 1024 * 1024;
export const CHAT_ATTACHMENT_MAX_RAW_BYTES =
  Math.floor(CHAT_ATTACHMENT_MAX_PROVIDER_BASE64_CHARS / 4) * 3;
export const CHAT_ATTACHMENT_MAX_RAW_MB_LABEL = "2.25MB";

export const CHAT_ATTACHMENT_TYPE_INFO: Readonly<
  Record<string, { maxSize: number; label: string }>
> = {
  "image/jpeg": { maxSize: CHAT_ATTACHMENT_MAX_RAW_BYTES, label: "이미지" },
  "image/png": { maxSize: CHAT_ATTACHMENT_MAX_RAW_BYTES, label: "이미지" },
  "image/gif": { maxSize: CHAT_ATTACHMENT_MAX_RAW_BYTES, label: "이미지" },
  "image/webp": { maxSize: CHAT_ATTACHMENT_MAX_RAW_BYTES, label: "이미지" },
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": {
    maxSize: CHAT_ATTACHMENT_MAX_RAW_BYTES,
    label: "Word",
  },
};

export const CHAT_ATTACHMENT_SIZE_ERROR =
  `첨부파일 전체 크기가 너무 커요. 전체 ${CHAT_ATTACHMENT_MAX_RAW_MB_LABEL} 이하로 줄인 뒤 파일을 다시 첨부해주세요.`;
export const CHAT_ATTACHMENT_SNAPSHOT_ERROR =
  "첨부파일을 안전하게 읽지 못했어요. 지원되는 파일인지 확인한 뒤 다시 첨부해주세요.";
export const CHAT_PDF_DISABLED_ERROR =
  "PDF는 문서 메타데이터를 안전하게 제거하는 기능이 준비될 때까지 첨부할 수 없어요. 필요한 내용을 DOCX로 다시 저장하거나 텍스트로 보내주세요.";
export const CHAT_PARTNER_ATTACHMENT_DISABLED_ERROR =
  "파일 첨부는 현재 아모라 대화에서만 안전하게 처리할 수 있어요. 상대방에게는 파일 없이 메시지를 보내주세요.";

export type PreparedChatAttachment = {
  base64: string;
  mediaType: string;
  fileName: string;
};

export type PrepareChatAttachmentResult =
  | { ok: true; attachments: PreparedChatAttachment[] }
  | { ok: false; error: string };

function isBase64Payload(value: string): boolean {
  if (!value || value.length % 4 !== 0) return false;
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  const payloadEnd = value.length - padding;
  if (payloadEnd <= 0) return false;

  for (let index = 0; index < payloadEnd; index += 1) {
    const code = value.charCodeAt(index);
    const isAlphabet =
      (code >= 65 && code <= 90)
      || (code >= 97 && code <= 122)
      || (code >= 48 && code <= 57)
      || code === 43
      || code === 47;
    if (!isAlphabet) return false;
  }
  for (let index = payloadEnd; index < value.length; index += 1) {
    if (value.charCodeAt(index) !== 61) return false;
  }
  return true;
}

/**
 * Creates the exact primitive-only provider attachment snapshot before any
 * analytics, upload, durable message write, or provider request can start.
 */
export function prepareChatAttachmentPayload(
  input: readonly unknown[] | null | undefined
): PrepareChatAttachmentResult {
  if (!input || input.length === 0) return { ok: true, attachments: [] };
  if (input.length > CHAT_ATTACHMENT_MAX_COUNT) {
    return {
      ok: false,
      error: `첨부파일은 한 번에 ${CHAT_ATTACHMENT_MAX_COUNT}개까지 보낼 수 있어요. 파일을 다시 선택해주세요.`,
    };
  }

  try {
    const allowedMediaTypes = new Set(Object.keys(CHAT_ATTACHMENT_TYPE_INFO));
    const seen = new Set<string>();
    const attachments: PreparedChatAttachment[] = [];
    let totalBase64Chars = 0;

    for (const raw of input) {
      if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
        return { ok: false, error: CHAT_ATTACHMENT_SNAPSHOT_ERROR };
      }
      const candidate = raw as Record<string, unknown>;
      const { base64, mediaType, fileName } = candidate;
      if (mediaType === "application/pdf") {
        return { ok: false, error: CHAT_PDF_DISABLED_ERROR };
      }
      if (
        typeof base64 !== "string"
        || typeof mediaType !== "string"
        || !allowedMediaTypes.has(mediaType)
        || (fileName !== undefined
          && (typeof fileName !== "string" || fileName.length < 1 || fileName.length > 255))
      ) {
        return { ok: false, error: CHAT_ATTACHMENT_SNAPSHOT_ERROR };
      }

      const key = `${mediaType}:${base64}`;
      if (seen.has(key)) continue;
      seen.add(key);

      if (totalBase64Chars + base64.length > CHAT_ATTACHMENT_MAX_PROVIDER_BASE64_CHARS) {
        return { ok: false, error: CHAT_ATTACHMENT_SIZE_ERROR };
      }
      if (!isBase64Payload(base64)) {
        return { ok: false, error: CHAT_ATTACHMENT_SNAPSHOT_ERROR };
      }

      totalBase64Chars += base64.length;
      attachments.push({
        base64,
        mediaType,
        fileName: typeof fileName === "string" ? fileName : "file",
      });
    }

    return { ok: true, attachments };
  } catch {
    return { ok: false, error: CHAT_ATTACHMENT_SNAPSHOT_ERROR };
  }
}

export function chatAttachmentKey(attachment: Pick<ChatAttachmentDraft, "base64" | "mediaType">): string {
  return `${attachment.mediaType}:${attachment.base64}`;
}

export function dedupeChatAttachments<T extends Pick<ChatAttachmentDraft, "base64" | "mediaType">>(
  attachments: readonly T[] | null | undefined
): T[] {
  if (!attachments || attachments.length === 0) return [];

  const seen = new Set<string>();
  const unique: T[] = [];
  for (const attachment of attachments) {
    const key = chatAttachmentKey(attachment);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(attachment);
  }
  return unique;
}
