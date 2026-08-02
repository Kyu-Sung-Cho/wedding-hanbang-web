// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { COMMUNITY_COMMENT_PUBLIC_SELECT } from "../commentSelect";
import { COMMUNITY_POST_PUBLIC_SELECT } from "../postSelect";

function source(path: string) {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

const postDetailPage = source("src/app/(community)/community/post/[id]/page.tsx");
const commentItem = source("src/components/community/CommentItem.tsx");
const profileRoute = source("src/app/api/community/profile/route.ts");
const authorProfiles = source("src/lib/community/authorProfiles.ts");
const mobileFeed = source("../mobile/app/(tabs)/community.tsx");
const mobileDetail = source("../mobile/app/community/post/[id].tsx");
const mobileMyPosts = source("../mobile/app/community/my-posts.tsx");
const mobileProfile = source("../mobile/app/(tabs)/profile.tsx");
const webMyPosts = source("src/app/(community)/community/my/posts/page.tsx");
const webPostEditor = source("src/app/(community)/community/post/write/page.tsx");
const contractApply = source(
  "../../supabase/platform-operations/security/20260803104500_community_public_identity_contract_apply.sql",
);
const uploadRoute = source("src/app/api/community/upload/route.ts");

describe("community public identity boundary", () => {
  it("projects public pseudonyms under backward-compatible DTO field names", () => {
    expect(COMMUNITY_POST_PUBLIC_SELECT).toContain("author_id:author_public_id");
    expect(COMMUNITY_POST_PUBLIC_SELECT.split(",").map((value) => value.trim()))
      .not.toContain("author_id");
    expect(COMMUNITY_COMMENT_PUBLIC_SELECT).toContain("author_id:author_public_id");
    expect(authorProfiles).toContain("user_id:community_public_id");
    expect(authorProfiles).toContain('.in("community_public_id", uniqueAuthorIds)');
    expect(profileRoute).toContain("user_id:community_public_id");
  });

  it("uses server ownership hints instead of comparing public IDs with Auth UUIDs", () => {
    expect(postDetailPage).toContain("post.is_author === true");
    expect(postDetailPage).not.toMatch(/user\.id\s*===\s*post\.author_id/);
    expect(commentItem).toContain("comment.is_author === true");
    expect(commentItem).not.toMatch(/currentUserId\s*===\s*comment\.author_id/);
    expect(commentItem).not.toContain("NEXT_PUBLIC_AMORA_USER_ID");
    expect(webPostEditor).toContain("post.is_author !== true");
    expect(webPostEditor).not.toContain("post.author_id !== userId");
    expect(webMyPosts).toContain("sort=my_posts");
    expect(webMyPosts).not.toContain("author_id=${userId}");
  });

  it("keeps supported mobile public reads behind the web API", () => {
    for (const mobileSource of [mobileFeed, mobileDetail, mobileMyPosts, mobileProfile]) {
      expect(mobileSource).not.toMatch(
        /\.from\(["']community_(?:posts|comments|profiles)["']\)/,
      );
    }
    expect(mobileFeed).toContain("fetchPostsFromApi(cat)");
    expect(mobileDetail).toContain("fetchPostFromApi(postId)");
    expect(mobileDetail).toContain("fetchCommentsFromApi(postId)");
    expect(mobileMyPosts).toContain("sort=my_posts");
    expect(mobileProfile).toContain("/api/community/profile");
  });

  it("pins the fail-closed contract and removes raw whole-row Realtime", () => {
    expect(contractApply).toMatch(
      /REVOKE SELECT[\s\S]+community_posts[\s\S]+community_comments[\s\S]+community_profiles/i,
    );
    expect(contractApply).toContain("author_public_id");
    expect(contractApply).toContain("community_public_id");
    expect(contractApply).toContain(
      "ALTER PUBLICATION supabase_realtime DROP TABLE public.community_posts",
    );
    expect(contractApply).toMatch(
      /GRANT SELECT ON TABLE[\s\S]+community_public_identities[\s\S]+TO service_role/i,
    );
  });

  it("uses an unlinkable random v2 path for every new public media object", () => {
    expect(uploadRoute).toContain("const finalPath = `v2/${randomUUID()}.${rule.extension}`");
    expect(uploadRoute).toContain("final_path: finalPath");
    expect(uploadRoute).not.toContain("final_path: path");
  });
});
