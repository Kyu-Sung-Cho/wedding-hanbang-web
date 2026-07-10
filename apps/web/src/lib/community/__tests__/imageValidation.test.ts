import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { validateDecodedCommunityImage } from "@/lib/community/imageValidation";

describe("validateDecodedCommunityImage", () => {
  it("accepts a small decodable image whose MIME matches", async () => {
    const png = await sharp({
      create: { width: 8, height: 8, channels: 4, background: "#fff" },
    }).png().toBuffer();

    await expect(validateDecodedCommunityImage(png, "image/png")).resolves.toBeNull();
  });

  it("rejects a valid image when the declared MIME is different", async () => {
    const png = await sharp({
      create: { width: 8, height: 8, channels: 4, background: "#fff" },
    }).png().toBuffer();

    await expect(validateDecodedCommunityImage(png, "image/jpeg")).resolves.toContain("다릅니다");
  });

  it("rejects corrupt content even if its first bytes could be spoofed upstream", async () => {
    await expect(
      validateDecodedCommunityImage(Buffer.from("not-an-image"), "image/png")
    ).resolves.toContain("손상");
  });
});
