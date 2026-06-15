import { afterEach, describe, expect, it } from "vitest";
import {
  COMMUNITY_IMAGE_BUCKET,
  COMMUNITY_VIDEO_BUCKET,
  validateCommunityHtmlImageSources,
  validateCommunityAttachmentUrl,
  validateCommunityMediaUrl,
} from "@/lib/community/mediaUrls";

const SUPABASE_URL = "https://project.supabase.co";
const OWNER_ID = "11111111-1111-1111-1111-111111111111";
const OTHER_OWNER_ID = "22222222-2222-2222-2222-222222222222";

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

  it("accepts regular post attachments from image or video buckets", () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE_URL;
    const imageUrl = publicObjectUrl(COMMUNITY_IMAGE_BUCKET);
    const videoUrl = publicObjectUrl(COMMUNITY_VIDEO_BUCKET, OWNER_ID, "1700000000000_file.mp4");

    expect(validateCommunityAttachmentUrl(imageUrl, { ownerIds: OWNER_ID })).toMatchObject({
      ok: true,
      kind: "image",
      bucket: COMMUNITY_IMAGE_BUCKET,
    });
    expect(validateCommunityAttachmentUrl(videoUrl, { ownerIds: OWNER_ID })).toMatchObject({
      ok: true,
      kind: "video",
      bucket: COMMUNITY_VIDEO_BUCKET,
    });
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
    const url = publicObjectUrl(COMMUNITY_IMAGE_BUCKET);

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
});
