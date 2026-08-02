import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath, URL } from "node:url";

function read(relativePath) {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

const authListener = read("../lib/authListener.ts");
const tabsLayout = read("../../app/(tabs)/_layout.tsx");
const communityScreen = read("../../app/(tabs)/community.tsx");
const postDetail = read("../../app/community/post/[id].tsx");

test("global auth events bind or purge the community cache for every session transition", () => {
  assert.match(authListener, /onAuthStateChange\(\(event, session\)\s*=>/);
  assert.match(authListener, /const candidateUserId = session\?\.user\.id \?\? null/);
  assert.match(authListener, /setCommunityCacheOwner\(candidateUserId\)/);
  assert.match(authListener, /beginMobileAuthIdentityTransition\(candidateUserId\)/);
  assert.match(authListener, /setCommunityCacheOwner\(null\)[\s\S]*stopAutoRefresh/);
});

test("tab warmup authenticates before reading cache and rejects responses after identity changes", () => {
  const sessionRead = tabsLayout.indexOf("supabase.auth.getSession()");
  const cacheRead = tabsLayout.indexOf("getCachedCommunityFeed(ownerId");
  assert.ok(sessionRead >= 0);
  assert.ok(cacheRead > sessionRead);
  assert.match(tabsLayout, /if \(cancelled \|\| !isCommunityCacheOwner\(ownerId\)\) return/);
});

test("community screens render blank state until auth resolves and scope every cache access", () => {
  assert.match(communityScreen, /const \[posts, setPosts\] = useState<PostItem\[]>\(\[\]\)/);
  assert.match(communityScreen, /if \(!authResolved\) return/);
  assert.match(communityScreen, /getCachedCommunityFeed<PostItem>\(viewerId, category\)/);
  assert.match(communityScreen, /putCachedCommunityCohort<CohortCache>\(viewerId/);
  assert.doesNotMatch(communityScreen, /let cohortCache/);

  assert.match(postDetail, /const \[post, setPost\] = useState<PostDetail \| null>\(null\)/);
  assert.match(postDetail, /getCachedCommunityPost\(viewerId, postId\)/);
  assert.match(postDetail, /getCachedCommunityComments\(viewerId, postId\)/);
  assert.match(postDetail, /if \(!isCommunityCacheOwner\(viewerId\)\) return/);
});
