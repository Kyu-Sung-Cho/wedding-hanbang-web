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

export type ChatImageObjectPathV2Input = {
  coupleId: string;
  senderId: string;
  clientRequestId: string;
  attachmentIndex: number;
  mediaType: string;
  sha256: string;
};

export type ChatImageManifestBinding = {
  mediaType: string;
  byteLength: number;
  sha256: string;
};

export type ChatImageObjectReadResult =
  | {
      ok: true;
      stream: ReadableStream<Uint8Array>;
      byteLength: number;
      mediaType: string | null;
    }
  | { ok: false; reason: "missing" | "mismatch" | "unavailable" };

export type ChatImageObjectVerificationResult =
  | { ok: true; imagePaths: string[] }
  | {
      ok: false;
      reason:
        | "path_mismatch"
        | "object_missing"
        | "object_mismatch"
        | "object_unavailable";
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

/**
 * Produces the v2 immutable image path from the same exact-byte digest that is
 * persisted in the provider attachment manifest. Both browser uploads and
 * server verification call this function, so a different file, order, request,
 * or media type cannot reuse the displayed Storage identity.
 */
export async function createChatImageObjectPathV2(
  input: ChatImageObjectPathV2Input,
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
    || !/^[0-9a-f]{64}$/.test(input.sha256)
  ) {
    throw new Error("CHAT_IMAGE_OBJECT_IDENTITY_INVALID");
  }
  if (!globalThis.crypto?.subtle) {
    throw new Error("CHAT_IMAGE_DIGEST_UNAVAILABLE");
  }

  const identity = new TextEncoder().encode([
    "amora-chat-image-v2",
    input.clientRequestId.toLowerCase(),
    String(input.attachmentIndex),
    input.mediaType,
    input.sha256,
  ].join("\u0000"));
  const digest = new Uint8Array(
    await globalThis.crypto.subtle.digest("SHA-256", identity),
  );
  return `${input.coupleId}/${input.senderId}/${bytesToUuid(digest)}.${extension}`;
}

/**
 * Verifies both halves of the image contract: the ordered canonical path and
 * the immutable object currently stored at that path. The reader is injected
 * so API routes can keep Supabase-specific error handling at the boundary.
 */
export async function verifyChatImageObjectBindings(input: {
  coupleId: string;
  senderId: string;
  clientRequestId: string;
  manifest: readonly ChatImageManifestBinding[];
  imagePaths: readonly string[];
  readObject: (
    path: string,
    expected: ChatImageManifestBinding,
  ) => Promise<ChatImageObjectReadResult>;
}): Promise<ChatImageObjectVerificationResult> {
  try {
    const expectedImages: Array<{
      path: string;
      binding: ChatImageManifestBinding;
    }> = [];
    for (const [attachmentIndex, binding] of input.manifest.entries()) {
      const path = await createChatImageObjectPathV2({
        coupleId: input.coupleId,
        senderId: input.senderId,
        clientRequestId: input.clientRequestId,
        attachmentIndex,
        mediaType: binding.mediaType,
        sha256: binding.sha256,
      });
      if (path) expectedImages.push({ path, binding });
    }

    if (
      input.imagePaths.length !== expectedImages.length
      || input.imagePaths.some((path, index) => path !== expectedImages[index]?.path)
    ) {
      return { ok: false, reason: "path_mismatch" };
    }

    const subtle = globalThis.crypto?.subtle;
    if (!subtle) return { ok: false, reason: "object_unavailable" };
    for (const expected of expectedImages) {
      const stored = await input.readObject(expected.path, expected.binding);
      if (!stored.ok) {
        return {
          ok: false,
          reason: stored.reason === "missing"
            ? "object_missing"
            : stored.reason === "mismatch"
              ? "object_mismatch"
              : "object_unavailable",
        };
      }
      if (
        stored.byteLength !== expected.binding.byteLength
        || stored.mediaType !== expected.binding.mediaType
      ) {
        return { ok: false, reason: "object_mismatch" };
      }
      const reader = stored.stream.getReader();
      const chunks: Uint8Array[] = [];
      let totalBytes = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          totalBytes += value.byteLength;
          if (totalBytes > expected.binding.byteLength) {
            try {
              await reader.cancel("stored image exceeds its manifest binding");
            } catch {
              // Cancellation is best effort; the binding still fails closed.
            }
            return { ok: false, reason: "object_mismatch" };
          }
          chunks.push(value);
        }
      } catch {
        try {
          await reader.cancel("stored image stream could not be read");
        } catch {
          // Best effort only.
        }
        return { ok: false, reason: "object_unavailable" };
      } finally {
        reader.releaseLock();
      }
      if (totalBytes !== expected.binding.byteLength) {
        return { ok: false, reason: "object_mismatch" };
      }
      const storedBytes = new Uint8Array(totalBytes);
      let offset = 0;
      for (const chunk of chunks) {
        storedBytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      const digest = new Uint8Array(
        await subtle.digest("SHA-256", storedBytes),
      );
      const sha256 = Array.from(
        digest,
        (value) => value.toString(16).padStart(2, "0"),
      ).join("");
      if (sha256 !== expected.binding.sha256) {
        return { ok: false, reason: "object_mismatch" };
      }
    }

    return { ok: true, imagePaths: expectedImages.map((entry) => entry.path) };
  } catch {
    return { ok: false, reason: "object_unavailable" };
  }
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
