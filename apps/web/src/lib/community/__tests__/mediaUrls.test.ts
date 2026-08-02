import { afterEach, describe, expect, it } from "vitest";
import {
  COMMUNITY_IMAGE_BUCKET,
  COMMUNITY_VIDEO_BUCKET,
  validateCommunityHtmlImageSources,
  validateCommunityMessageImageSources,
  validateCommunityAttachmentUrl,
  validateCommunityMediaUrl,
  validateRetainedCommunityImageUrl,
  validateRetainedCommunityVideoUrl,
} from "@/lib/community/mediaUrls";

const SUPABASE_URL = "https://project.supabase.co";
const OWNER_ID = "11111111-1111-1111-1111-111111111111";
const OTHER_OWNER_ID = "22222222-2222-2222-2222-222222222222";
const UPLOAD_ID = "33333333-3333-4333-8333-333333333333";

function publicObjectUrl(bucket: string, ownerId = OWNER_ID, fileName = "1700000000000_file.jpg") {
  return `${SUPABASE_URL}/storage/v1/object/public/${bucket}/${ownerId}/${fileName}`;
}

describe("validateCommunityMediaUrl", () => {
  const originalSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;

  afterEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = originalSupabaseUrl;
  });

  it("accepts image URLs from the community image bucket owned by the user", () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE_URL;
    const url = publicObjectUrl(COMMUNITY_IMAGE_BUCKET);

    const result = validateCommunityMediaUrl(url, {
      kind: "image",
      ownerIds: OWNER_ID,
    });

    expect(result).toMatchObject({
      ok: true,
      url,
      bucket: COMMUNITY_IMAGE_BUCKET,
      ownerId: OWNER_ID,
      objectPath: `${OWNER_ID}/1700000000000_file.jpg`,
    });
  });

  it("accepts video URLs only from the community video bucket", () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE_URL;
    const url = publicObjectUrl(COMMUNITY_VIDEO_BUCKET, OWNER_ID, "1700000000000_file.mp4");

    const result = validateCommunityMediaUrl(url, {
      kind: "video",
      ownerIds: OWNER_ID,
    });

    expect(result).toMatchObject({
      ok: true,
      bucket: COMMUNITY_VIDEO_BUCKET,
      objectPath: `${OWNER_ID}/1700000000000_file.mp4`,
    });
  });

  it("rejects external origins", () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE_URL;

    const result = validateCommunityMediaUrl(
      `https://example.com/storage/v1/object/public/${COMMUNITY_IMAGE_BUCKET}/${OWNER_ID}/file.jpg`,
      { kind: "image", ownerIds: OWNER_ID }
    );

    expect(result).toEqual({ ok: false, reason: "wrong_origin" });
  });

  it("rejects media from another user's folder", () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE_URL;
    const url = publicObjectUrl(COMMUNITY_IMAGE_BUCKET, OTHER_OWNER_ID);

    const result = validateCommunityMediaUrl(url, {
      kind: "image",
      ownerIds: OWNER_ID,
    });

    expect(result).toEqual({ ok: false, reason: "wrong_owner" });
  });

  it("rejects an image field pointing at the video bucket", () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE_URL;
    const url = publicObjectUrl(COMMUNITY_VIDEO_BUCKET, OWNER_ID, "1700000000000_file.mp4");

    const result = validateCommunityMediaUrl(url, {
      kind: "image",
      ownerIds: OWNER_ID,
    });

    expect(result).toEqual({ ok: false, reason: "wrong_bucket" });
  });

  it("accepts only canonical image upload-session paths for new post attachments", () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE_URL;
    const imageUrl = publicObjectUrl(COMMUNITY_IMAGE_BUCKET, OWNER_ID, `${UPLOAD_ID}.png`);
    const videoUrl = publicObjectUrl(COMMUNITY_VIDEO_BUCKET, OWNER_ID, "1700000000000_file.mp4");
    const encodedIdUrl = imageUrl.replace(UPLOAD_ID, `%33${UPLOAD_ID.slice(1)}`);

    expect(validateCommunityAttachmentUrl(imageUrl, { ownerIds: OWNER_ID })).toMatchObject({
      ok: true,
      kind: "image",
      bucket: COMMUNITY_IMAGE_BUCKET,
    });
    expect(validateCommunityAttachmentUrl(videoUrl, { ownerIds: OWNER_ID }).ok).toBe(false);
    expect(validateCommunityAttachmentUrl(encodedIdUrl, { ownerIds: OWNER_ID }).ok).toBe(false);
    expect(validateCommunityAttachmentUrl(
      publicObjectUrl(COMMUNITY_IMAGE_BUCKET),
      { ownerIds: OWNER_ID },
    ).ok).toBe(false);
  });

  it("accepts unlinkable v2 image paths without treating the path as ownership proof", () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE_URL;
    const randomFinalId = "44444444-4444-4444-8444-444444444444";
    const url = `${SUPABASE_URL}/storage/v1/object/public/${COMMUNITY_IMAGE_BUCKET}/v2/${randomFinalId}.webp`;

    expect(validateCommunityAttachmentUrl(url, { ownerIds: OWNER_ID })).toEqual({
      ok: true,
      kind: "image",
      url,
      bucket: COMMUNITY_IMAGE_BUCKET,
      ownerId: null,
      objectPath: `v2/${randomFinalId}.webp`,
    });
    expect(validateCommunityAttachmentUrl(
      `${SUPABASE_URL}/storage/v1/object/public/${COMMUNITY_IMAGE_BUCKET}/v2/${randomFinalId}.webp/extra`,
      { ownerIds: OWNER_ID },
    )).toEqual({ ok: false, reason: "unsafe_path" });
  });

  it("allows an update to retain only a video URL already present on that post", () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE_URL;
    const retained = publicObjectUrl(COMMUNITY_VIDEO_BUCKET, OWNER_ID, "old.mp4");
    const other = publicObjectUrl(COMMUNITY_VIDEO_BUCKET, OWNER_ID, "other.mp4");
    const existingSlides = [{ type: "video", url: retained }];

    expect(validateRetainedCommunityVideoUrl(retained, existingSlides, {
      ownerIds: OWNER_ID,
    })).toMatchObject({ ok: true, url: retained, bucket: COMMUNITY_VIDEO_BUCKET });
    expect(validateRetainedCommunityVideoUrl(other, existingSlides, {
      ownerIds: OWNER_ID,
    })).toEqual({ ok: false, reason: "unsafe_path" });
  });

  it("allows only an exact legacy image or thumbnail already present on the same post", () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE_URL;
    const retainedImage = publicObjectUrl(COMMUNITY_IMAGE_BUCKET, OWNER_ID, "1700000000000_old.jpg");
    const retainedThumbnail = publicObjectUrl(COMMUNITY_IMAGE_BUCKET, OWNER_ID, "1700000000000_thumb.jpg");
    const other = publicObjectUrl(COMMUNITY_IMAGE_BUCKET, OWNER_ID, "1700000000000_other.jpg");
    const existingMedia = [
      retainedImage,
      { type: "video", url: publicObjectUrl(COMMUNITY_VIDEO_BUCKET, OWNER_ID, "old.mp4"), thumbnail_url: retainedThumbnail },
    ];

    expect(validateRetainedCommunityImageUrl(retainedImage, existingMedia, {
      ownerIds: OWNER_ID,
    })).toMatchObject({ ok: true, url: retainedImage, bucket: COMMUNITY_IMAGE_BUCKET });
    expect(validateRetainedCommunityImageUrl(retainedThumbnail, existingMedia, {
      ownerIds: OWNER_ID,
    })).toMatchObject({ ok: true, url: retainedThumbnail, bucket: COMMUNITY_IMAGE_BUCKET });
    expect(validateRetainedCommunityImageUrl(other, existingMedia, {
      ownerIds: OWNER_ID,
    })).toEqual({ ok: false, reason: "unsafe_path" });
  });

  it("rejects encoded path traversal", () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE_URL;
    const url = `${SUPABASE_URL}/storage/v1/object/public/${COMMUNITY_IMAGE_BUCKET}/${OWNER_ID}/%2e%2e/file.jpg`;

    const result = validateCommunityMediaUrl(url, {
      kind: "image",
      ownerIds: OWNER_ID,
    });

    expect(result.ok).toBe(false);
  });

  it("accepts HTML image sources from the owner's community image folder", () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE_URL;
    const url = publicObjectUrl(COMMUNITY_IMAGE_BUCKET, OWNER_ID, `${UPLOAD_ID}.png`);

    const result = validateCommunityHtmlImageSources(`<p>본문</p><img src="${url}" alt="">`, {
      ownerIds: OWNER_ID,
    });

    expect(result).toEqual({ ok: true });
  });

  it("rejects external HTML image sources", () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE_URL;

    const result = validateCommunityHtmlImageSources(
      `<p>본문</p><img src="https://example.com/tracker.jpg" alt="">`,
      { ownerIds: OWNER_ID }
    );

    expect(result).toMatchObject({ ok: false, src: "https://example.com/tracker.jpg" });
  });

  it("rejects duplicate image sources instead of validating only the last one", () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE_URL;
    const ownedUrl = publicObjectUrl(COMMUNITY_IMAGE_BUCKET, OWNER_ID, `${UPLOAD_ID}.png`);

    const result = validateCommunityHtmlImageSources(
      `<img src="https://attacker.example/collect" src="${ownedUrl}" alt="photo">`,
      { ownerIds: OWNER_ID },
    );

    expect(result).toMatchObject({
      ok: false,
      src: "https://attacker.example/collect",
      reason: "wrong_origin",
    });
  });

  it("allows cohort image tokens only for the author's finalized upload", () => {
    const ownedUrl = publicObjectUrl(COMMUNITY_IMAGE_BUCKET, OWNER_ID, `${UPLOAD_ID}.png`);

    expect(validateCommunityMessageImageSources(
      `사진이에요 [img:${ownedUrl}]`,
      { ownerId: OWNER_ID, supabaseUrl: SUPABASE_URL },
    )).toEqual({ ok: true });

    expect(validateCommunityMessageImageSources(
      `추적 [img:https://attacker.supabase.co/pixel.gif]`,
      { ownerId: OWNER_ID, supabaseUrl: SUPABASE_URL },
    )).toMatchObject({ ok: false, reason: "wrong_origin" });

    expect(validateCommunityMessageImageSources(
      `내부 호출 [img:/api/messages?vendorId=${OTHER_OWNER_ID}]`,
      { ownerId: OWNER_ID, supabaseUrl: SUPABASE_URL },
    )).toMatchObject({ ok: false, reason: "invalid_url" });

    expect(validateCommunityMessageImageSources(
      `다른 사람 파일 [img:${publicObjectUrl(COMMUNITY_IMAGE_BUCKET, OTHER_OWNER_ID, `${UPLOAD_ID}.png`)}]`,
      { ownerId: OWNER_ID, supabaseUrl: SUPABASE_URL },
    )).toMatchObject({ ok: false, reason: "wrong_owner" });
  });
});
