import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("community media retirement", () => {
  it("makes legacy buckets private without deleting unreviewed objects", () => {
    const migration = read(
      "../../supabase/migrations/20260713113000_retire_public_community_media.sql",
    );

    expect(migration).toContain("SET public = FALSE");
    expect(migration).toContain("'community-images', 'community-videos'");
    expect(migration).toContain("block_retired_community_media_object_writes");
    expect(migration).toContain("block_retired_community_post_media_writes");
    expect(migration).toContain("block_retired_community_poll_writes");
    expect(migration).toContain("BEFORE INSERT OR UPDATE ON storage.objects");
    expect(migration).not.toMatch(/DELETE\s+FROM\s+storage\.objects/i);
  });

  it("removes media from public payloads and mutation contracts", () => {
    const select = read("src/lib/community/postSelect.ts");
    const createRoute = read("src/app/api/community/posts/route.ts");
    const updateRoute = read("src/app/api/community/posts/[id]/route.ts");
    const types = read("src/types/community.types.ts");

    expect(select).not.toMatch(/\bimages\b|\bslides\b|\bcost_data\b|\brating\b/);
    for (const route of [createRoute, updateRoute]) {
      expect(route).toContain("community_structured_fields_retired");
      expect(route).toContain("community_media_retired");
    }
    const createInput = types.slice(
      types.indexOf("export interface CreatePostInput"),
      types.indexOf("export interface UpdatePostInput"),
    );
    expect(createInput).not.toMatch(/images|slides|vendor_tags|rating|poll/);

    const chat = read("src/components/app/chat/ChatContent.tsx");
    const chatPostPayload = chat.slice(
      chat.indexOf("const submitCommunityDraft"),
      chat.indexOf("const data = await res.json", chat.indexOf("const submitCommunityDraft")),
    );
    expect(chatPostPayload).not.toMatch(/\bimages\b|\bvendor_tags\b/);
  });

  it("physically removes obsolete upload and carousel components", () => {
    for (const path of [
      "src/components/community/ImageUploader.tsx",
      "src/components/community/SlideBuilder.tsx",
      "src/components/community/SlideCarousel.tsx",
      "src/components/community/PollEditor.tsx",
    ]) {
      expect(existsSync(resolve(process.cwd(), path))).toBe(false);
    }
  });
});
