import { describe, expect, it } from "vitest";
import {
  COMMUNITY_AVATAR_OPTIONS,
  normalizeCommunityAvatar,
} from "@/lib/community/avatar";

describe("normalizeCommunityAvatar", () => {
  it.each(COMMUNITY_AVATAR_OPTIONS)("allows the product avatar %s", (avatar) => {
    expect(normalizeCommunityAvatar(avatar)).toBe(avatar);
  });

  it.each([
    "/api/messages?vendorId=00000000-0000-4000-8000-000000000001",
    "https://attacker.supabase.co/storage/v1/object/public/pixel/view.gif",
    "//attacker.example/pixel",
    "data:image/svg+xml,<svg onload=alert(1) />",
    "javascript:alert(1)",
    "🙂",
    "",
    null,
    undefined,
  ])("rejects non-product avatar input %#", (avatar) => {
    expect(normalizeCommunityAvatar(avatar)).toBeNull();
  });
});
