import sharp from "sharp";

const MAX_IMAGE_DIMENSION = 12_000;
const MAX_IMAGE_PIXELS = 25_000_000;
const MAX_ANIMATION_FRAMES = 200;
const MAX_ANIMATED_PIXELS = 80_000_000;

const SHARP_FORMAT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpeg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
};

export async function validateDecodedCommunityImage(
  buffer: Buffer,
  declaredType: string
): Promise<string | null> {
  try {
    const metadata = await sharp(buffer, {
      animated: true,
      failOn: "warning",
      limitInputPixels: MAX_IMAGE_PIXELS,
    }).metadata();
    if (metadata.format !== SHARP_FORMAT_BY_MIME[declaredType]) {
      return "파일의 실제 이미지 형식이 선언된 형식과 다릅니다.";
    }

    const width = metadata.width ?? 0;
    const frameHeight = metadata.pageHeight ?? metadata.height ?? 0;
    const pages = metadata.pages ?? 1;
    if (width <= 0 || frameHeight <= 0) return "이미지 크기를 확인할 수 없습니다.";
    if (width > MAX_IMAGE_DIMENSION || frameHeight > MAX_IMAGE_DIMENSION) {
      return `이미지 가로·세로는 각각 ${MAX_IMAGE_DIMENSION.toLocaleString()}px 이하여야 합니다.`;
    }
    if (width * frameHeight > MAX_IMAGE_PIXELS) return "이미지 해상도가 너무 큽니다.";
    if (pages > MAX_ANIMATION_FRAMES || width * frameHeight * pages > MAX_ANIMATED_PIXELS) {
      return "움직이는 이미지의 프레임 또는 전체 해상도가 너무 큽니다.";
    }
    return null;
  } catch {
    return "손상되었거나 안전하게 처리할 수 없는 이미지입니다.";
  }
}
