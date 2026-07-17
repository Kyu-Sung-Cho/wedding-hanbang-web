import sharp from "sharp";
import {
  COMMUNITY_MEDIA_RULES,
  type CommunityMimeType,
} from "./uploadPolicy";

export const COMMUNITY_IMAGE_MAX_PIXELS = 24_000_000;
export const COMMUNITY_IMAGE_MAX_DIMENSION = 8_192;
export const COMMUNITY_GIF_MAX_FRAMES = 120;
export const COMMUNITY_GIF_MAX_TOTAL_PIXELS = 48_000_000;

const FORMAT_BY_MIME: Record<CommunityMimeType, "jpeg" | "png" | "gif" | "webp"> = {
  "image/jpeg": "jpeg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
};

export interface SanitizedCommunityImage {
  bytes: Buffer;
  mimeType: CommunityMimeType;
  width: number;
  height: number;
}

export interface ValidatedCommunityImage {
  width: number;
  height: number;
}

function assertDecodedBounds(
  width: number | undefined,
  height: number | undefined,
  pages: number | undefined,
  pageHeight: number | undefined,
) {
  if (!width || !height || width <= 0 || height <= 0) {
    throw new Error("image decode failed");
  }

  const frameCount = pages ?? 1;
  const frameHeight = pageHeight ?? height;
  if (!Number.isSafeInteger(width)
      || !Number.isSafeInteger(frameHeight)
      || !Number.isSafeInteger(frameCount)
      || width > COMMUNITY_IMAGE_MAX_DIMENSION
      || frameHeight > COMMUNITY_IMAGE_MAX_DIMENSION
      || width * frameHeight > COMMUNITY_IMAGE_MAX_PIXELS
      || frameCount > COMMUNITY_GIF_MAX_FRAMES
      || width * frameHeight * frameCount > COMMUNITY_GIF_MAX_TOTAL_PIXELS) {
    throw new Error("image pixel limit exceeded");
  }
}

function sharpInputOptions(mimeType: CommunityMimeType) {
  return {
    animated: mimeType === "image/gif",
    failOn: "warning" as const,
    limitInputPixels: COMMUNITY_IMAGE_MAX_PIXELS,
    sequentialRead: true,
  };
}

export async function validateSanitizedCommunityImage(
  source: Uint8Array,
  mimeType: CommunityMimeType,
): Promise<ValidatedCommunityImage> {
  if (!(mimeType in FORMAT_BY_MIME) || source.byteLength === 0) {
    throw new Error("image decode failed");
  }
  const input = Buffer.from(source.buffer, source.byteOffset, source.byteLength);
  let metadata: Awaited<ReturnType<ReturnType<typeof sharp>["metadata"]>>;
  try {
    metadata = await sharp(input, sharpInputOptions(mimeType)).metadata();
  } catch {
    throw new Error("image decode failed");
  }
  if (metadata.format !== FORMAT_BY_MIME[mimeType]) {
    throw new Error("image format mismatch");
  }
  assertDecodedBounds(metadata.width, metadata.height, metadata.pages, metadata.pageHeight);
  if (metadata.exif || metadata.icc || metadata.iptc || metadata.xmp) {
    throw new Error("image metadata is not sanitized");
  }
  try {
    await sharp(input, sharpInputOptions(mimeType)).stats();
  } catch {
    throw new Error("image decode failed");
  }
  return {
    width: metadata.width!,
    height: metadata.pageHeight ?? metadata.height!,
  };
}

export async function sanitizeCommunityImage(
  source: Uint8Array,
  mimeType: CommunityMimeType,
): Promise<SanitizedCommunityImage> {
  if (!(mimeType in FORMAT_BY_MIME) || source.byteLength === 0) {
    throw new Error("image decode failed");
  }

  const input = Buffer.from(source.buffer, source.byteOffset, source.byteLength);
  const pipeline = sharp(input, sharpInputOptions(mimeType));

  let metadata: Awaited<ReturnType<typeof pipeline.metadata>>;
  try {
    metadata = await pipeline.metadata();
  } catch {
    throw new Error("image decode failed");
  }

  if (metadata.format !== FORMAT_BY_MIME[mimeType]) {
    throw new Error("image format mismatch");
  }
  assertDecodedBounds(metadata.width, metadata.height, metadata.pages, metadata.pageHeight);

  let output: Buffer;
  try {
    const normalized = pipeline.rotate();
    if (mimeType === "image/jpeg") {
      output = await normalized.jpeg({ quality: 90, mozjpeg: true }).toBuffer();
    } else if (mimeType === "image/png") {
      output = await normalized.png({ compressionLevel: 9 }).toBuffer();
    } else if (mimeType === "image/webp") {
      output = await normalized.webp({ quality: 90, effort: 5 }).toBuffer();
    } else {
      output = await normalized.gif({ effort: 7 }).toBuffer();
    }
  } catch {
    throw new Error("image decode failed");
  }

  if (output.byteLength === 0 || output.byteLength > COMMUNITY_MEDIA_RULES[mimeType].maxBytes) {
    throw new Error("sanitized image size limit exceeded");
  }

  const outputMetadata = await validateSanitizedCommunityImage(output, mimeType);

  return {
    bytes: output,
    mimeType,
    width: outputMetadata.width!,
    height: outputMetadata.height,
  };
}
