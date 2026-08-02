const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const CHAT_IMAGE_EXTENSIONS: Readonly<Record<string, string>> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
};

type ChatImageObjectPathInput = {
  coupleId: string;
  senderId: string;
  clientRequestId: string;
  attachmentIndex: number;
  mediaType: string;
  base64: string;
};

function bytesToUuid(bytes: Uint8Array): string {
  const uuidBytes = bytes.slice(0, 16);
  // The Storage contract accepts canonical UUID versions 1-5. Version 5 marks
  // this filename as deterministic while SHA-256 supplies the digest bytes.
  uuidBytes[6] = (uuidBytes[6] & 0x0f) | 0x50;
  uuidBytes[8] = (uuidBytes[8] & 0x3f) | 0x80;
  const hex = Array.from(
    uuidBytes,
    (value) => value.toString(16).padStart(2, "0"),
  ).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Produces the immutable chat-image path used by the hosted Storage policy and
 * account-deletion inventory. PDF/DOCX remain provider-only attachments and
 * intentionally return null because chat-image is an image-only bucket.
 */
export async function createChatImageObjectPath(
  input: ChatImageObjectPathInput,
): Promise<string | null> {
  const extension = CHAT_IMAGE_EXTENSIONS[input.mediaType];
  if (!extension) return null;
  if (
    !UUID_RE.test(input.coupleId)
    || !UUID_RE.test(input.senderId)
    || !UUID_RE.test(input.clientRequestId)
    || !Number.isInteger(input.attachmentIndex)
    || input.attachmentIndex < 0
    || input.attachmentIndex > 4
    || input.base64.length === 0
  ) {
    throw new Error("CHAT_IMAGE_OBJECT_IDENTITY_INVALID");
  }
  if (!globalThis.crypto?.subtle) {
    throw new Error("CHAT_IMAGE_DIGEST_UNAVAILABLE");
  }

  const identity = new TextEncoder().encode([
    "amora-chat-image-v1",
    input.clientRequestId.toLowerCase(),
    String(input.attachmentIndex),
    input.mediaType,
    input.base64,
  ].join("\u0000"));
  const digest = new Uint8Array(
    await globalThis.crypto.subtle.digest("SHA-256", identity),
  );
  return `${input.coupleId}/${input.senderId}/${bytesToUuid(digest)}.${extension}`;
}

export function isExistingChatImageUploadError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const record = error as Record<string, unknown>;
  const status = String(record.statusCode ?? record.status ?? "");
  const detail = `${String(record.error ?? "")} ${String(record.message ?? "")}`
    .toLowerCase();
  return status === "409"
    && (detail.includes("duplicate") || detail.includes("already exists"));
}
