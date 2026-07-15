import sharp from "sharp";

export type ChatImageMediaType =
  | "image/jpeg"
  | "image/png"
  | "image/gif"
  | "image/webp";

export interface SanitizedProviderImage {
  buffer: Buffer;
  byteLength: number;
  mediaType: Exclude<ChatImageMediaType, "image/gif">;
}

interface SanitizeProviderImageInput {
  buffer: Buffer;
  declaredMediaType: ChatImageMediaType;
  maxOutputBytes: number;
  maxPixels: number;
}

const FORMAT_BY_MEDIA_TYPE: Record<ChatImageMediaType, string> = {
  "image/jpeg": "jpeg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
};

function hasEmbeddedMetadata(metadata: Awaited<ReturnType<ReturnType<typeof sharp>["metadata"]>>): boolean {
  return Boolean(
    metadata.exif
      || metadata.xmp
      || metadata.xmpAsString
      || metadata.iptc
      || metadata.icc
      || metadata.hasProfile
      || metadata.tifftagPhotoshop
      || (metadata.comments?.length ?? 0) > 0
  );
}

/**
 * Produces the only image bytes that may cross the chat provider boundary.
 * The original upload must never be used as a fallback when this throws.
 */
export async function sanitizeProviderImage({
  buffer,
  declaredMediaType,
  maxOutputBytes,
  maxPixels,
}: SanitizeProviderImageInput): Promise<SanitizedProviderImage> {
  if (!Buffer.isBuffer(buffer) || buffer.byteLength === 0) {
    throw new Error("이미지를 안전하게 읽지 못했습니다.");
  }
  if (!Number.isSafeInteger(maxOutputBytes) || maxOutputBytes <= 0) {
    throw new Error("이미지 정제 용량 제한이 올바르지 않습니다.");
  }
  if (!Number.isSafeInteger(maxPixels) || maxPixels <= 0) {
    throw new Error("이미지 해상도 제한이 올바르지 않습니다.");
  }

  const input = sharp(buffer, {
    animated: true,
    failOn: "warning",
    limitInputPixels: maxPixels,
  });
  const inputMetadata = await input.metadata();
  if (inputMetadata.format !== FORMAT_BY_MEDIA_TYPE[declaredMediaType]) {
    throw new Error("파일의 실제 이미지 형식이 선언된 형식과 다릅니다.");
  }
  const width = inputMetadata.width ?? 0;
  const height = inputMetadata.height ?? 0;
  if (width <= 0 || height <= 0 || width * height > maxPixels) {
    throw new Error("이미지 해상도가 너무 큽니다.");
  }
  if (declaredMediaType === "image/gif" && (inputMetadata.pages ?? 1) !== 1) {
    throw new Error("애니메이션 GIF는 지원되지 않습니다. 정지 이미지로 변환해주세요.");
  }

  const pipeline = sharp(buffer, {
    failOn: "warning",
    limitInputPixels: maxPixels,
  })
    .autoOrient();
  const sanitizedBuffer = declaredMediaType === "image/jpeg"
    ? await pipeline.jpeg({ quality: 90 }).toBuffer()
    : declaredMediaType === "image/png"
      ? await pipeline.png().toBuffer()
      : declaredMediaType === "image/webp"
        ? await pipeline.webp({ quality: 90 }).toBuffer()
        : await pipeline.png().toBuffer();
  const outputMediaType = declaredMediaType === "image/gif"
    ? "image/png"
    : declaredMediaType;
  const outputFormat = FORMAT_BY_MEDIA_TYPE[outputMediaType];

  if (sanitizedBuffer.byteLength > maxOutputBytes) {
    throw new Error("개인정보 메타데이터를 제거한 이미지가 첨부 용량을 초과했습니다.");
  }

  const outputMetadata = await sharp(sanitizedBuffer, {
    failOn: "warning",
    limitInputPixels: maxPixels,
  }).metadata();
  const outputWidth = outputMetadata.width ?? 0;
  const outputHeight = outputMetadata.height ?? 0;
  if (
    outputMetadata.format !== outputFormat
      || outputWidth <= 0
      || outputHeight <= 0
      || outputWidth * outputHeight > maxPixels
      || hasEmbeddedMetadata(outputMetadata)
  ) {
    throw new Error("이미지 개인정보 메타데이터를 완전히 제거하지 못했습니다.");
  }

  return {
    buffer: sanitizedBuffer,
    byteLength: sanitizedBuffer.byteLength,
    mediaType: outputMediaType,
  };
}
