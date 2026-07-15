import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  getCachedCommunityFeed,
  getCachedCommunityComments,
  getCachedCommunityPost,
  putCachedCommunityComments,
  putCachedCommunityFeed,
  putCachedCommunityPost,
  setCommunityCacheOwner,
} from "../src/lib/communityPostCache.ts";

const mobileRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const publicPost = {
  id: "post-public-a",
  title: "공개 글",
  content: "공개 내용",
  category: "free",
  visibility: "public",
  under_review: false,
  upvote_count: 0,
  downvote_count: 0,
  comment_count: 0,
  view_count: 0,
  created_at: "2026-07-13T00:00:00.000Z",
  author: { nickname: "A", rank: "sprout" },
};

test("community cache never carries account A data into account B", () => {
  setCommunityCacheOwner("user-a");
  putCachedCommunityFeed("user-a", "all", [publicPost]);
  putCachedCommunityPost("user-a", publicPost);

  assert.equal(getCachedCommunityFeed("user-a", "all")?.[0]?.id, publicPost.id);
  assert.equal(getCachedCommunityPost("user-a", publicPost.id)?.id, publicPost.id);

  setCommunityCacheOwner(null);
  setCommunityCacheOwner("user-b");

  assert.equal(getCachedCommunityFeed("user-b", "all"), null);
  assert.equal(getCachedCommunityPost("user-b", publicPost.id), null);

  // A request that resolves after the account switch cannot repopulate B's cache.
  putCachedCommunityFeed("user-a", "all", [publicPost]);
  putCachedCommunityPost("user-a", publicPost);
  assert.equal(getCachedCommunityFeed("user-b", "all"), null);
  assert.equal(getCachedCommunityPost("user-b", publicPost.id), null);
});

test("community cache stores only reviewed public posts", () => {
  const draft = { ...publicPost, id: "post-draft", visibility: "draft" };
  const membersOnly = { ...publicPost, id: "post-members", visibility: "members" };
  const underReview = { ...publicPost, id: "post-review", under_review: true };

  setCommunityCacheOwner("user-a");
  putCachedCommunityFeed("user-a", "all", [publicPost, draft, membersOnly, underReview]);
  putCachedCommunityPost("user-a", draft);
  putCachedCommunityPost("user-a", membersOnly);
  putCachedCommunityPost("user-a", underReview);

  assert.deepEqual(
    getCachedCommunityFeed("user-a", "all")?.map((post) => post.id),
    [publicPost.id],
  );
  assert.equal(getCachedCommunityPost("user-a", draft.id), null);
  assert.equal(getCachedCommunityPost("user-a", membersOnly.id), null);
  assert.equal(getCachedCommunityPost("user-a", underReview.id), null);
});

test("community feed cache expires before stale moderation state can persist", () => {
  const realNow = Date.now;
  let now = 1_000_000;
  Date.now = () => now;
  try {
    setCommunityCacheOwner("ttl-user");
    putCachedCommunityFeed("ttl-user", "all", [publicPost]);
    assert.equal(getCachedCommunityFeed("ttl-user", "all")?.[0]?.id, publicPost.id);

    now += 30_001;
    assert.equal(getCachedCommunityFeed("ttl-user", "all"), null);
  } finally {
    Date.now = realNow;
  }
});

test("community comment previews are isolated across account changes", () => {
  const comments = [{
    id: "comment-a",
    content: "A 계정에서 읽은 댓글",
    created_at: "2026-07-13T00:01:00.000Z",
    author: { nickname: "A", rank: "sprout" },
  }];

  setCommunityCacheOwner("user-a");
  putCachedCommunityComments("user-a", publicPost.id, comments);
  assert.equal(getCachedCommunityComments("user-a", publicPost.id)?.[0]?.id, "comment-a");

  setCommunityCacheOwner(null);
  setCommunityCacheOwner("user-b");
  assert.equal(getCachedCommunityComments("user-b", publicPost.id), null);
});

test("auth lifecycle owns cache invalidation for sign-out and account switches", () => {
  const source = readFileSync(resolve(mobileRoot, "src/lib/authListener.ts"), "utf8");

  assert.match(
    source,
    /onAuthStateChange\(\(event, session\) => \{\s*setCommunityCacheOwner\(session\?\.user\.id \?\? null\)/,
  );
  assert.match(source, /if \(event === "SIGNED_OUT"\)/);
});
