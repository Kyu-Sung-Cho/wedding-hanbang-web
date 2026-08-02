import {
  AMORA_MAX_ATTACHMENT_BYTES,
  type ValidatedAmoraAttachment,
} from "@/lib/ai/amoraAttachments";
import {
  sanitizeCommunityImage,
  type SanitizedCommunityImage,
} from "@/lib/community/imageSanitizer";
import type { CommunityMimeType } from "@/lib/community/uploadPolicy";

export const AMORA_IMAGE_MEDIA_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
] as const;

export type AmoraImageMediaType = typeof AMORA_IMAGE_MEDIA_TYPES[number];

// The browser request snapshot is capped at 3 MiB of base64. Keep the
// server-produced payload within the same envelope after re-encoding.
export const AMORA_MAX_PROVIDER_IMAGE_BASE64_CHARS = 3 * 1024 * 1024;
export const AMORA_MAX_SANITIZED_IMAGE_BYTES =
  Math.floor(AMORA_MAX_PROVIDER_IMAGE_BASE64_CHARS / 4) * 3;

const IMAGE_MEDIA_TYPES = new Set<string>(AMORA_IMAGE_MEDIA_TYPES);
const EXTENSION_BY_MEDIA_TYPE: Record<AmoraImageMediaType, string> = {
  "image/jpeg": "jpeg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
};

export class AmoraImageSanitizationError extends Error {
  readonly code = "UNSAFE_IMAGE_ATTACHMENT";

  constructor() {
    super("Image attachment could not be safely decoded and re-encoded");
    this.name = "AmoraImageSanitizationError";
  }
}

export interface SanitizedAmoraImageAttachment {
  bytes: Buffer;
  base64: string;
  mediaType: AmoraImageMediaType;
  extension: string;
  width: number;
  height: number;
}

export function isAmoraImageMediaType(value: string): value is AmoraImageMediaType {
  return IMAGE_MEDIA_TYPES.has(value);
}

function failSanitization(): never {
  throw new AmoraImageSanitizationError();
}

/**
 * Treats the declared MIME as an expected format, never as proof. Sharp must
 * decode the bytes as that exact format, enforce pixel/frame bounds, rotate
 * from orientation, and re-encode without EXIF/ICC/IPTC/XMP metadata.
 */
export async function sanitizeAmoraImageAttachment(
  attachment: Pick<ValidatedAmoraAttachment, "base64" | "mediaType">,
): Promise<SanitizedAmoraImageAttachment> {
  if (!isAmoraImageMediaType(attachment.mediaType)) failSanitization();

  let source: Buffer;
  try {
    source = Buffer.from(attachment.base64, "base64");
  } catch {
    return failSanitization();
  }
  if (
    source.byteLength < 1
    || source.byteLength > AMORA_MAX_ATTACHMENT_BYTES
    || source.toString("base64") !== attachment.base64
  ) {
    failSanitization();
  }

  let sanitized: SanitizedCommunityImage;
  try {
    sanitized = await sanitizeCommunityImage(
      source,
      attachment.mediaType as CommunityMimeType,
    );
  } catch {
    return failSanitization();
  }

  if (
    sanitized.mimeType !== attachment.mediaType
    || sanitized.bytes.byteLength < 1
    || sanitized.bytes.byteLength > AMORA_MAX_SANITIZED_IMAGE_BYTES
  ) {
    failSanitization();
  }

  const base64 = sanitized.bytes.toString("base64");
  if (
    base64.length < 1
    || base64.length > AMORA_MAX_PROVIDER_IMAGE_BASE64_CHARS
  ) {
    failSanitization();
  }

  return {
    bytes: sanitized.bytes,
    base64,
    mediaType: attachment.mediaType,
    extension: EXTENSION_BY_MEDIA_TYPE[attachment.mediaType],
    width: sanitized.width,
    height: sanitized.height,
  };
}
