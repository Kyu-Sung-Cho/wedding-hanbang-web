import sharp from "sharp";
import { ProviderError } from "./api";

export const PROVIDER_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
/** 실제 디코딩 후 WebP로 다시 만들어 EXIF·GPS·원본 파일명을 보관하지 않는다. */
export async function processProviderImage(bytes: Uint8Array, mime: string): Promise<Buffer> {
  if (!bytes.length || bytes.length > PROVIDER_IMAGE_MAX_BYTES || !["image/jpeg", "image/png", "image/webp"].includes(mime)) {
    throw new ProviderError("PROVIDER_INVALID_IMAGE", 400, "5MB 이하의 JPG·PNG·WebP 사진을 선택해 주세요.");
  }
  try {
    const source = sharp(bytes, { limitInputPixels: 40_000_000, failOn: "warning", animated: false });
    const meta = await source.metadata();
    const formats: Record<string, string> = { jpeg: "image/jpeg", png: "image/png", webp: "image/webp" };
    const actualMime = formats[meta.format ?? ""];
    if (actualMime !== mime || (meta.pages ?? 1) !== 1 || !meta.width || !meta.height) throw new Error("invalid_image");
    const output = await source.rotate().resize({ width: 2400, height: 2400, fit: "inside", withoutEnlargement: true }).webp({ quality: 85 }).toBuffer();
    if (!output.length || output.length > PROVIDER_IMAGE_MAX_BYTES) throw new Error("image_too_large");
    return output;
  } catch {
    throw new ProviderError("PROVIDER_INVALID_IMAGE", 400, "사진을 읽지 못했어요. 움직이지 않는 JPG·PNG·WebP 파일로 다시 시도해 주세요.");
  }
}
