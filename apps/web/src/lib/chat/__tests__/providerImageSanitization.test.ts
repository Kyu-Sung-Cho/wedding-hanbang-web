import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { sanitizeProviderImage } from "../providerImageSanitization";

describe("sanitizeProviderImage", () => {
  it("applies JPEG orientation and strips location-capable metadata before provider delivery", async () => {
    const source = await sharp({
      create: { width: 12, height: 6, channels: 3, background: "#fff" },
    })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .withExif({
        IFD0: { Artist: "private-user" },
        IFD3: {
          GPSLatitudeRef: "N",
          GPSLatitude: "37/1 30/1 0/1",
          GPSLongitudeRef: "E",
          GPSLongitude: "127/1 0/1 0/1",
        },
      })
      .toBuffer();

    const sourceMetadata = await sharp(source).metadata();
    expect(sourceMetadata.orientation).toBe(6);
    expect(sourceMetadata.exif).toBeDefined();

    const sanitized = await sanitizeProviderImage({
      buffer: source,
      declaredMediaType: "image/jpeg",
      maxOutputBytes: 2 * 1024 * 1024,
      maxPixels: 16_000_000,
    });

    expect(sanitized.mediaType).toBe("image/jpeg");
    expect(sanitized.byteLength).toBe(sanitized.buffer.byteLength);

    const metadata = await sharp(sanitized.buffer).metadata();
    expect(metadata.width).toBe(6);
    expect(metadata.height).toBe(12);
    expect(metadata.orientation).toBeUndefined();
    expect(metadata.exif).toBeUndefined();
    expect(metadata.xmp).toBeUndefined();
    expect(metadata.iptc).toBeUndefined();
    expect(metadata.icc).toBeUndefined();
    expect(metadata.hasProfile).toBe(false);
    expect(metadata.tifftagPhotoshop).toBeUndefined();
    expect(metadata.comments).toBeUndefined();
  });

  it.each([
    ["image/png", "png", "image/png"],
    ["image/webp", "webp", "image/webp"],
    ["image/gif", "gif", "image/png"],
  ] as const)(
    "re-encodes a valid static %s image and returns its real provider MIME",
    async (declaredMediaType, encoder, expectedMediaType) => {
      let pipeline = sharp({
        create: { width: 8, height: 5, channels: 4, background: "#87a" },
      });
      pipeline = encoder === "png"
        ? pipeline.png()
        : encoder === "webp"
          ? pipeline.webp()
          : pipeline.gif();
      const source = await pipeline.toBuffer();

      const sanitized = await sanitizeProviderImage({
        buffer: source,
        declaredMediaType,
        maxOutputBytes: 2 * 1024 * 1024,
        maxPixels: 16_000_000,
      });

      expect(sanitized.mediaType).toBe(expectedMediaType);
      const metadata = await sharp(sanitized.buffer).metadata();
      expect(metadata.format).toBe(expectedMediaType.split("/")[1]);
      expect(metadata.exif).toBeUndefined();
      expect(metadata.xmp).toBeUndefined();
      expect(metadata.iptc).toBeUndefined();
    },
  );

  it("fails closed when the declared MIME does not match decoded bytes", async () => {
    const png = await sharp({
      create: { width: 8, height: 5, channels: 4, background: "#87a" },
    }).png().toBuffer();

    await expect(sanitizeProviderImage({
      buffer: png,
      declaredMediaType: "image/jpeg",
      maxOutputBytes: 2 * 1024 * 1024,
      maxPixels: 16_000_000,
    })).rejects.toThrow("실제 이미지 형식");
  });

  it("fails closed instead of forwarding an animated GIF", async () => {
    const red = await sharp({
      create: { width: 2, height: 2, channels: 4, background: "#f00" },
    }).png().toBuffer();
    const blue = await sharp({
      create: { width: 2, height: 2, channels: 4, background: "#00f" },
    }).png().toBuffer();
    const animated = await sharp([red, blue], { join: { animated: true } })
      .gif({ delay: [90, 140], loop: 0 })
      .toBuffer();

    await expect(sanitizeProviderImage({
      buffer: animated,
      declaredMediaType: "image/gif",
      maxOutputBytes: 2 * 1024 * 1024,
      maxPixels: 16_000_000,
    })).rejects.toThrow("애니메이션 GIF");
  });

  it("fails closed when sanitized provider bytes exceed the output boundary", async () => {
    const png = await sharp({
      create: { width: 8, height: 5, channels: 4, background: "#87a" },
    }).png().toBuffer();

    await expect(sanitizeProviderImage({
      buffer: png,
      declaredMediaType: "image/png",
      maxOutputBytes: 1,
      maxPixels: 16_000_000,
    })).rejects.toThrow("첨부 용량");
  });
});
