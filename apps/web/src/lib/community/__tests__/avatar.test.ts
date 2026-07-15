import { describe, expect, it } from "vitest";
import { normalizeCommunityAvatar } from "@/lib/community/avatar";

describe("normalizeCommunityAvatar", () => {
  it("allows a small user-selected emoji", () => {
    expect(normalizeCommunityAvatar("  🌿  ")).toBe("🌿");
    expect(normalizeCommunityAvatar("👩‍❤️‍👩")).toBe("👩‍❤️‍👩");
  });

  it("rejects remote, relative, data, and mixed-text tracking values", () => {
    for (const value of [
      "https://tracker.example/pixel.png",
      "/api/tracking-pixel",
      "data:image/svg+xml;base64,abc",
      "hello🌿",
      "plain text",
    ]) {
      expect(normalizeCommunityAvatar(value)).toBeNull();
    }
  });
});
