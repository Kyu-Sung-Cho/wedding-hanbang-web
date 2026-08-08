import { describe, expect, it } from "vitest";
import {
  isCommunityMediaPatchAllowedWhileDisabled,
  isCommunityMediaPublishingEnabled,
} from "@/lib/community/mediaPublishingGate";
import { isCommunityMediaPublishingUiEnabled } from "@/lib/community/mediaPublishingUiGate";

const IMAGE_A = "https://example.supabase.co/storage/v1/object/public/community-images/user/a.jpg";
const IMAGE_B = "https://example.supabase.co/storage/v1/object/public/community-images/user/b.jpg";
const IMAGE_C = "https://example.supabase.co/storage/v1/object/public/community-images/user/c.jpg";

const EXISTING_MEDIA = {
  content: `<p>기존 본문</p><img src="${IMAGE_A}"><img src="${IMAGE_B}">`,
  images: [IMAGE_A, IMAGE_B],
  slides: [
    { type: "image", url: IMAGE_A, width: 1200, height: 1500 },
    { type: "image", url: IMAGE_B, width: 1200, height: 1500 },
  ],
  visibility: "public",
};

describe("community media publishing gate", () => {
  it("is fail-closed unless the opt-in value is exactly true", () => {
    expect(isCommunityMediaPublishingEnabled({})).toBe(false);
    expect(
      isCommunityMediaPublishingEnabled({
        COMMUNITY_MEDIA_PUBLISHING_ENABLED: "false",
      }),
    ).toBe(false);
    expect(
      isCommunityMediaPublishingEnabled({
        COMMUNITY_MEDIA_PUBLISHING_ENABLED: "TRUE",
      }),
    ).toBe(false);
    expect(
      isCommunityMediaPublishingEnabled({
        COMMUNITY_MEDIA_PUBLISHING_ENABLED: "1",
      }),
    ).toBe(false);
    expect(
      isCommunityMediaPublishingEnabled({
        COMMUNITY_MEDIA_PUBLISHING_ENABLED: "true",
      }),
    ).toBe(true);
  });

  it("uses the same exact-true rule for the public browser affordance flag", () => {
    expect(isCommunityMediaPublishingUiEnabled(undefined)).toBe(false);
    expect(isCommunityMediaPublishingUiEnabled("false")).toBe(false);
    expect(isCommunityMediaPublishingUiEnabled("TRUE")).toBe(false);
    expect(isCommunityMediaPublishingUiEnabled("1")).toBe(false);
    expect(isCommunityMediaPublishingUiEnabled("true")).toBe(true);
  });

  it("allows text-only edits that retain existing media exactly", () => {
    expect(
      isCommunityMediaPatchAllowedWhileDisabled(
        {
          content: `<p>바뀐 본문</p><img src="${IMAGE_A}"><img src="${IMAGE_B}">`,
          images: [IMAGE_A, IMAGE_B],
          slides: EXISTING_MEDIA.slides,
        },
        EXISTING_MEDIA,
      ),
    ).toBe(true);
  });

  it("allows ordered media removal, including removing every attachment", () => {
    expect(
      isCommunityMediaPatchAllowedWhileDisabled(
        {
          content: `<p>이미지 B만 제거한 본문</p><img src="${IMAGE_A}">`,
          images: [IMAGE_B],
          slides: [EXISTING_MEDIA.slides[1]],
        },
        EXISTING_MEDIA,
      ),
    ).toBe(true);

    expect(
      isCommunityMediaPatchAllowedWhileDisabled(
        { content: "<p>텍스트만 남김</p>", images: [], slides: null },
        EXISTING_MEDIA,
      ),
    ).toBe(true);
  });

  it("blocks new, replaced, duplicated, reordered, or malformed media", () => {
    expect(
      isCommunityMediaPatchAllowedWhileDisabled(
        { images: [IMAGE_A, IMAGE_C] },
        EXISTING_MEDIA,
      ),
    ).toBe(false);
    expect(
      isCommunityMediaPatchAllowedWhileDisabled(
        { content: `<p>교체</p><img src="${IMAGE_C}">` },
        EXISTING_MEDIA,
      ),
    ).toBe(false);
    expect(
      isCommunityMediaPatchAllowedWhileDisabled(
        { images: [IMAGE_A, IMAGE_A] },
        EXISTING_MEDIA,
      ),
    ).toBe(false);
    expect(
      isCommunityMediaPatchAllowedWhileDisabled(
        { slides: [EXISTING_MEDIA.slides[1], EXISTING_MEDIA.slides[0]] },
        EXISTING_MEDIA,
      ),
    ).toBe(false);
    expect(
      isCommunityMediaPatchAllowedWhileDisabled(
        { images: "not-an-array" },
        EXISTING_MEDIA,
      ),
    ).toBe(false);
  });

  it("blocks publishing retained draft media to a wider audience unless it is removed", () => {
    const draft = { ...EXISTING_MEDIA, visibility: "draft" };

    expect(
      isCommunityMediaPatchAllowedWhileDisabled(
        { visibility: "public" },
        draft,
      ),
    ).toBe(false);
    expect(
      isCommunityMediaPatchAllowedWhileDisabled(
        {
          visibility: "public",
          content: "<p>텍스트만 공개</p>",
          images: [],
          slides: null,
        },
        draft,
      ),
    ).toBe(true);
  });
});
