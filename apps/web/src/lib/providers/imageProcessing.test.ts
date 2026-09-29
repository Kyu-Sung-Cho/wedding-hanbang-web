// @vitest-environment node
import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { processProviderImage } from "./imageProcessing";

describe("제공자 포트폴리오 사진", () => {
  it("실제 사진을 디코딩하고 원본 EXIF를 제거한다", async () => {
    const source = await sharp({ create: { width: 40, height: 30, channels: 3, background: "red" } }).jpeg().withMetadata({ exif: { IFD0: { Artist: "private-name" } } }).toBuffer();
    const output = await processProviderImage(source, "image/jpeg");
    const meta = await sharp(output).metadata();
    expect(meta.format).toBe("webp"); expect(meta.exif).toBeUndefined(); expect(meta.width).toBe(40);
  });
  it("파일 확장자나 MIME만 사진처럼 바꾼 입력을 거부한다", async () => {
    await expect(processProviderImage(Buffer.from("<svg><script>alert(1)</script></svg>"), "image/png")).rejects.toMatchObject({ code: "PROVIDER_INVALID_IMAGE" });
    const jpeg = await sharp({ create: { width: 8, height: 8, channels: 3, background: "red" } }).jpeg().toBuffer();
    await expect(processProviderImage(jpeg, "image/png")).rejects.toMatchObject({ code: "PROVIDER_INVALID_IMAGE" });
  });
  it("압축본이 작아도 과도한 픽셀 수를 거부한다", async () => {
    const png = await sharp({ create: { width: 7000, height: 6000, channels: 3, background: "white" } }).png().toBuffer();
    await expect(processProviderImage(png, "image/png")).rejects.toMatchObject({ code: "PROVIDER_INVALID_IMAGE" });
  });
});
