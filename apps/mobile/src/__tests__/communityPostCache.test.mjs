import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath, URL } from "node:url";
import ts from "typescript";

const cachePath = fileURLToPath(new URL("../lib/communityPostCache.ts", import.meta.url));

function loadCacheModule() {
  const compiled = ts.transpileModule(readFileSync(cachePath, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  });
  const module = { exports: {} };
  new Function("exports", "module", compiled.outputText)(module.exports, module);
  return module.exports;
}

const samplePost = {
  id: "post-1",
  title: "private planning detail",
  content: "account-scoped body",
  category: "free",
  upvote_count: 0,
  downvote_count: 0,
  comment_count: 1,
  view_count: 0,
  created_at: "2026-08-02T00:00:00.000Z",
  author: { nickname: "owner-a", rank: "sprout" },
};

const sampleComments = [{
  id: "comment-1",
  content: "account-scoped comment",
  created_at: "2026-08-02T00:00:00.000Z",
  author: { nickname: "owner-a", rank: "sprout" },
}];

test("community caches fail closed until an authenticated owner is established", () => {
  const cache = loadCacheModule();

  assert.equal(cache.putCachedCommunityFeed(null, "all", [samplePost]), false);
  assert.equal(cache.putCachedCommunityPost(null, samplePost), false);
  assert.equal(cache.putCachedCommunityComments(null, samplePost.id, sampleComments), false);
  assert.equal(cache.putCachedCommunityCohort(null, { roomId: "room-a" }), false);
  assert.equal(cache.getCachedCommunityFeed(null, "all"), null);
  assert.equal(cache.getCachedCommunityPost(null, samplePost.id), null);
  assert.equal(cache.getCachedCommunityComments(null, samplePost.id), null);
  assert.equal(cache.getCachedCommunityCohort(null), null);
});
test("an identity change purges every cache and rejects stale writes from the old owner", () => {
  const cache = loadCacheModule();
  cache.setCommunityCacheOwner("owner-a");

  assert.equal(cache.putCachedCommunityFeed("owner-a", "all", [samplePost]), true);
  assert.equal(cache.putCachedCommunityPost("owner-a", samplePost), true);
  assert.equal(
    cache.putCachedCommunityComments("owner-a", samplePost.id, sampleComments),
    true,
  );
  assert.equal(cache.putCachedCommunityCohort("owner-a", { roomId: "room-a" }), true);
  assert.deepEqual(cache.getCachedCommunityFeed("owner-a", "all"), [samplePost]);

  cache.setCommunityCacheOwner("owner-b");

  assert.equal(cache.getCachedCommunityFeed("owner-a", "all"), null);
  assert.equal(cache.getCachedCommunityPost("owner-a", samplePost.id), null);
  assert.equal(cache.getCachedCommunityComments("owner-a", samplePost.id), null);
  assert.equal(cache.getCachedCommunityCohort("owner-a"), null);
  assert.equal(cache.getCachedCommunityFeed("owner-b", "all"), null);
  assert.equal(cache.putCachedCommunityFeed("owner-a", "all", [samplePost]), false);
  assert.equal(cache.putCachedCommunityPost("owner-a", samplePost), false);
  assert.equal(cache.putCachedCommunityComments("owner-a", samplePost.id, sampleComments), false);
  assert.equal(cache.putCachedCommunityCohort("owner-a", { roomId: "room-a" }), false);
  assert.equal(cache.getCachedCommunityFeed("owner-b", "all"), null);
});

test("sign-out purges account data and disables subsequent cache writes", () => {
  const cache = loadCacheModule();
  cache.setCommunityCacheOwner("owner-a");
  cache.putCachedCommunityFeed("owner-a", "all", [samplePost]);
  cache.putCachedCommunityCohort("owner-a", { roomId: "room-a" });

  cache.setCommunityCacheOwner(null);

  assert.equal(cache.isCommunityCacheOwner("owner-a"), false);
  assert.equal(cache.getCachedCommunityFeed("owner-a", "all"), null);
  assert.equal(cache.getCachedCommunityCohort("owner-a"), null);
  assert.equal(cache.putCachedCommunityFeed("owner-a", "all", [samplePost]), false);
});

test("feed, post, comment, and cohort entries all expire", () => {
  const cache = loadCacheModule();
  const originalNow = Date.now;
  let now = 1_000_000;
  Date.now = () => now;

  try {
    cache.setCommunityCacheOwner("owner-a");
    cache.putCachedCommunityFeed("owner-a", "all", [samplePost]);
    cache.putCachedCommunityPost("owner-a", samplePost);
    cache.putCachedCommunityComments("owner-a", samplePost.id, sampleComments);
    cache.putCachedCommunityCohort("owner-a", { roomId: "room-a" });

    now += 30_001;
    assert.equal(cache.getCachedCommunityComments("owner-a", samplePost.id), null);
    assert.deepEqual(cache.getCachedCommunityCohort("owner-a"), { roomId: "room-a" });

    now += 30_000;
    assert.equal(cache.getCachedCommunityCohort("owner-a"), null);
    assert.deepEqual(cache.getCachedCommunityFeed("owner-a", "all"), [samplePost]);
    assert.deepEqual(cache.getCachedCommunityPost("owner-a", samplePost.id), samplePost);

    now += 60_000;
    assert.equal(cache.getCachedCommunityFeed("owner-a", "all"), null);
    assert.equal(cache.getCachedCommunityPost("owner-a", samplePost.id), null);
  } finally {
    Date.now = originalNow;
  }
});
