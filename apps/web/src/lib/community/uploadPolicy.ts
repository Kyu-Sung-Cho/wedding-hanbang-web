export const COMMUNITY_STAGING_BUCKET = "community-media-staging";
export const COMMUNITY_IMAGE_BUCKET = "community-images";
export const COMMUNITY_VIDEO_BUCKET = "community-videos";
export const COMMUNITY_SIGNED_UPLOAD_TTL_MS = 2 * 60 * 60 * 1000;

export const COMMUNITY_MEDIA_RULES = {
  "image/jpeg": { extension: "jpg", maxBytes: 5 * 1024 * 1024, bucket: COMMUNITY_IMAGE_BUCKET, type: "image" },
  "image/png": { extension: "png", maxBytes: 5 * 1024 * 1024, bucket: COMMUNITY_IMAGE_BUCKET, type: "image" },
  "image/gif": { extension: "gif", maxBytes: 6 * 1024 * 1024, bucket: COMMUNITY_IMAGE_BUCKET, type: "gif" },
  "image/webp": { extension: "webp", maxBytes: 5 * 1024 * 1024, bucket: COMMUNITY_IMAGE_BUCKET, type: "image" },
} as const;

export type CommunityMimeType = keyof typeof COMMUNITY_MEDIA_RULES;
export type CommunityMediaType = "image" | "gif";

export function normalizeCommunityMimeType(value: unknown): CommunityMimeType | null {
  if (typeof value !== "string") return null;
  const normalized = value.split(";", 1)[0]?.trim().toLowerCase();
  return normalized && normalized in COMMUNITY_MEDIA_RULES
    ? normalized as CommunityMimeType
    : null;
}

export function isValidCommunityMediaSize(mimeType: CommunityMimeType, size: unknown): size is number {
  return typeof size === "number"
    && Number.isSafeInteger(size)
    && size > 0
    && size <= COMMUNITY_MEDIA_RULES[mimeType].maxBytes;
}

export function communityMediaSignatureMatches(
  mimeType: CommunityMimeType,
  bytes: Uint8Array,
): boolean {
  const byte = (index: number) => bytes[index];
  const ascii = (start: number, length: number) =>
    String.fromCharCode(...bytes.slice(start, start + length));

  if (mimeType === "image/jpeg") {
    return bytes.length >= 3 && byte(0) === 0xff && byte(1) === 0xd8 && byte(2) === 0xff;
  }
  if (mimeType === "image/png") {
    return bytes.length >= 8
      && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
        .every((expected, index) => byte(index) === expected);
  }
  if (mimeType === "image/gif") {
    return bytes.length >= 6 && (ascii(0, 6) === "GIF87a" || ascii(0, 6) === "GIF89a");
  }
  if (mimeType === "image/webp") {
    return bytes.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP";
  }
  return false;
}
