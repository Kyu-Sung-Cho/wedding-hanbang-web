import { describe, expect, it } from "vitest";
import sharp from "sharp";
import {
  COMMUNITY_IMAGE_MAX_PIXELS,
  sanitizeCommunityImage,
  validateSanitizedCommunityImage,
} from "../imageSanitizer";

async function tinyPng() {
  return sharp({
    create: {
      width: 2,
      height: 2,
      channels: 4,
      background: { r: 238, g: 120, b: 135, alpha: 1 },
    },
  }).png().toBuffer();
}

describe("sanitizeCommunityImage", () => {
  it("decodes and re-encodes JPEG without EXIF or other source metadata", async () => {
    const source = await sharp({
      create: {
        width: 3,
        height: 2,
        channels: 3,
        background: { r: 120, g: 80, b: 40 },
      },
    })
      .jpeg()
      .withMetadata({ exif: { IFD0: { Artist: "private-device-owner" } } })
      .toBuffer();

    const result = await sanitizeCommunityImage(source, "image/jpeg");
    const metadata = await sharp(result.bytes).metadata();

    expect(result.mimeType).toBe("image/jpeg");
    expect(result.width).toBe(3);
    expect(result.height).toBe(2);
    expect(metadata.exif).toBeUndefined();
    expect(metadata.icc).toBeUndefined();
    expect(metadata.xmp).toBeUndefined();
    expect(result.bytes.includes(Buffer.from("private-device-owner"))).toBe(false);
    await expect(validateSanitizedCommunityImage(result.bytes, "image/jpeg"))
      .resolves.toMatchObject({ width: 3, height: 2 });
    await expect(validateSanitizedCommunityImage(source, "image/jpeg"))
      .rejects.toThrow(/metadata/i);
  });

  it("rejects a malformed file even when its first bytes look like PNG", async () => {
    const malformed = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    ]);

    await expect(sanitizeCommunityImage(malformed, "image/png"))
      .rejects.toThrow(/decode/i);
  });

  it("strips bytes appended after a valid image instead of publishing a polyglot", async () => {
    const png = await tinyPng();
    const marker = Buffer.from("<script>private-polyglot-payload</script>");
    const source = Buffer.concat([png, marker]);

    const result = await sanitizeCommunityImage(source, "image/png");
    const metadata = await sharp(result.bytes).metadata();

    expect(metadata.format).toBe("png");
    expect(result.bytes.includes(marker)).toBe(false);
    expect(result.bytes.byteLength).toBeLessThan(source.byteLength);
  });

  it("rejects images whose decoded pixel count exceeds the decompression bound", async () => {
    const width = 6_000;
    const height = Math.floor(COMMUNITY_IMAGE_MAX_PIXELS / width) + 1;
    const compressedBomb = await sharp({
      create: {
        width,
        height,
        channels: 3,
        background: { r: 0, g: 0, b: 0 },
      },
    }).png({ compressionLevel: 9 }).toBuffer();

    await expect(sanitizeCommunityImage(compressedBomb, "image/png"))
      .rejects.toThrow(/pixel|decode/i);
  }, 30_000);
});
