import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = dirname(fileURLToPath(import.meta.url));
const tabsLayoutSource = readFileSync(resolve(testDir, "../../app/(tabs)/_layout.tsx"), "utf8");
const communitySource = readFileSync(resolve(testDir, "../../app/(tabs)/community.tsx"), "utf8");
const postDetailSource = readFileSync(resolve(testDir, "../../app/community/post/[id].tsx"), "utf8");

test("the tabs layout fences warmup data and remounts community when the viewer changes", () => {
  assert.match(tabsLayoutSource, /setCommunityCacheViewer/);
  assert.match(tabsLayoutSource, /captureCommunityCacheScope/);
  assert.match(tabsLayoutSource, /isCommunityCacheScopeCurrent/);
  assert.match(tabsLayoutSource, /key=\{communityViewerKey\}/);
});

test("the community screen uses scoped feed and cohort caches with stale-response guards", () => {
  assert.doesNotMatch(communitySource, /let cohortCache:/);
  assert.match(communitySource, /getCachedCommunityCohort/);
  assert.match(communitySource, /putCachedCommunityCohort/);
  assert.match(communitySource, /captureCommunityCacheScope/);
  assert.match(communitySource, /isCommunityCacheScopeCurrent/);
  assert.match(
    communitySource,
    /putCachedCommunityFeed\(cat, nextPosts, cacheScope\)/,
  );
});

test("a post detail deep link establishes its cache viewer before storing member data", () => {
  assert.match(postDetailSource, /setCommunityCacheViewer\(ownerId\)/);
  assert.match(
    postDetailSource,
    /onAuthStateChange[\s\S]*?setCommunityCacheViewer\(session\?\.user\.id \?\? null\)/,
  );
});
