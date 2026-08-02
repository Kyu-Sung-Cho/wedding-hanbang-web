import { afterEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";

import { AMORA_MAX_ATTACHMENT_BYTES } from "@/lib/ai/amoraAttachments";
import {
  AmoraImageSanitizationError,
  sanitizeAmoraImageAttachment,
} from "@/lib/ai/amoraImageAttachments";

async function tinyPng() {
  return sharp({
    create: {
      width: 3,
      height: 2,
      channels: 4,
      background: { r: 213, g: 152, b: 160, alpha: 1 },
    },
  }).png().toBuffer();
}

describe("sanitizeAmoraImageAttachment", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("strips EXIF identity and GPS metadata before producing provider/storage bytes", async () => {
    const source = await sharp({
      create: {
        width: 4,
        height: 3,
        channels: 3,
        background: { r: 80, g: 100, b: 120 },
      },
    })
      .jpeg()
      .withExif({
        IFD0: { Artist: "private-device-owner" },
        IFD3: {
          GPSLatitudeRef: "N",
          GPSLatitude: "37/1 33/1 0/1",
          GPSLongitudeRef: "E",
          GPSLongitude: "126/1 58/1 0/1",
        },
      })
      .toBuffer();

    expect((await sharp(source).metadata()).exif).toBeDefined();
    const result = await sanitizeAmoraImageAttachment({
      base64: source.toString("base64"),
      mediaType: "image/jpeg",
    });
    const metadata = await sharp(result.bytes).metadata();

    expect(result.bytes.equals(source)).toBe(false);
    expect(result.base64).toBe(result.bytes.toString("base64"));
    expect(metadata.format).toBe("jpeg");
    expect(metadata.exif).toBeUndefined();
    expect(metadata.icc).toBeUndefined();
    expect(metadata.iptc).toBeUndefined();
    expect(metadata.xmp).toBeUndefined();
    expect(result.bytes.includes(Buffer.from("private-device-owner"))).toBe(false);
    expect(result.bytes.includes(Buffer.from("126/1 58/1 0/1"))).toBe(false);
  });

  it("rejects a spoofed declared MIME even when the bytes decode as another image", async () => {
    const png = await tinyPng();

    await expect(sanitizeAmoraImageAttachment({
      base64: png.toString("base64"),
      mediaType: "image/jpeg",
    })).rejects.toBeInstanceOf(AmoraImageSanitizationError);
  });

  it("rejects malformed image bytes without logging their raw contents", async () => {
    const privateMarker = "gps=37.55,126.98;device=private-phone";
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    let caught: unknown;
    try {
      await sanitizeAmoraImageAttachment({
        base64: Buffer.from(privateMarker).toString("base64"),
        mediaType: "image/png",
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(AmoraImageSanitizationError);
    expect(String(caught)).not.toContain(privateMarker);
    expect(errorSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("rejects an image whose decoded dimension exceeds the decompression bound", async () => {
    const oversizedDimension = await sharp({
      create: {
        width: 8_193,
        height: 1,
        channels: 3,
        background: { r: 0, g: 0, b: 0 },
      },
    }).png().toBuffer();

    await expect(sanitizeAmoraImageAttachment({
      base64: oversizedDimension.toString("base64"),
      mediaType: "image/png",
    })).rejects.toBeInstanceOf(AmoraImageSanitizationError);
  });

  it("rejects oversized encoded input before decoding", async () => {
    const oversized = Buffer.alloc(AMORA_MAX_ATTACHMENT_BYTES + 1, 0x41);

    await expect(sanitizeAmoraImageAttachment({
      base64: oversized.toString("base64"),
      mediaType: "image/png",
    })).rejects.toBeInstanceOf(AmoraImageSanitizationError);
  });
});
