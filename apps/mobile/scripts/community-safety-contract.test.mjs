import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const mobileRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function readSource(relativePath) {
  return readFileSync(resolve(mobileRoot, relativePath), "utf8");
}

test("mobile community publishing has no dormant feed capability or entry point", () => {
  const feed = readSource("app/(tabs)/community.tsx");

  assert.doesNotMatch(feed, /mobileCommunityPublishing|community\/post\/write/);
  assert.doesNotMatch(feed, /PenSquare|fabScale|handleFabPress|styles\.fab/);
});

test("read-only mobile feed exposes no post-writing action or invitation", () => {
  const feed = readSource("app/(tabs)/community.tsx");

  assert.doesNotMatch(feed, /mobileCommunityPublishing|\/community\/post\/write|빠른 후기|quickReview/);
  assert.doesNotMatch(feed, /첫 번째 글의 주인공이 되어보세요/);
});

test("mobile community feed contains no retired cohort runtime or database reads", () => {
  const feed = readSource("app/(tabs)/community.tsx");

  assert.doesNotMatch(feed, /cohort_members|cohort_rooms|cohortRooms/);
  assert.doesNotMatch(feed, /cohort-discovery|\/community\/cohort/);
});

test("direct mobile post-writing routes fail closed before draft or upload work starts", () => {
  const writer = readSource("app/community/post/write.tsx");

  assert.match(writer, /import \{ Redirect \} from "expo-router"/);
  assert.match(writer, /return <Redirect href="\/\(tabs\)\/community" \/>/);
  assert.doesNotMatch(writer, /apiFetch|supabase|communityDrafts|WritePostForm|PUBLIC_BETA_CAPABILITIES/);
});

test("read-only mobile post detail neither invites nor accepts new comments", () => {
  const detail = readSource("app/community/post/[id].tsx");
  assert.doesNotMatch(detail, /handleComment|communityCommentPublishing|commentBar|commentInput|\/api\/community\/comments"\s*,\s*\{\s*method:\s*"POST"/);
  assert.match(detail, /새 댓글과 답글 작성은 현재 받지 않아요/);
  assert.match(detail, /기존 댓글은 계속 읽을 수 있어요/);
  assert.doesNotMatch(detail, /첫 댓글을 남겨보세요/);
});

test("historical mobile comment likes are text only and cannot be mutated", () => {
  const detail = readSource("app/community/post/[id].tsx");

  assert.match(detail, /styles\.commentVoteCount/);
  assert.match(detail, /좋아요 \{typeof c\.upvote_count === "number" \? c\.upvote_count : 0\}/);
  assert.doesNotMatch(detail, /api\/community\/comments\/[^\s"'`]+\/vote/);
});

test("mobile post detail lets users reversibly hide another author with an explicit boundary", () => {
  const detail = readSource("app/community/post/[id].tsx");

  assert.match(detail, /작성자 글 숨기기/);
  assert.match(detail, /작성자에게 알림은 가지 않아요/);
  assert.match(detail, /프로필 > 숨긴 작성자에서 언제든 해제할 수 있어요/);
  assert.match(detail, /muteCommunityAuthor\(post\.author_id, apiFetch\)/);
  assert.match(detail, /!post\.viewer_is_author/);
  assert.doesNotMatch(detail, /post\.author_id !== cacheOwnerId/);
  assert.match(detail, /clearCommunityCaches\(\)/);
  assert.match(detail, /router\.replace\("\/\(tabs\)\/community"\)/);
});

test("mobile post detail states its narrower scope and offers the canonical full view", () => {
  const detail = readSource("app/community/post/[id].tsx");

  assert.match(detail, /모바일 커뮤니티는 현재 읽기 중심으로 제공해요/);
  assert.match(detail, /게시글 신고·수정·삭제와 기존 투표 결과 확인은 웹에서 이용해주세요/);
  assert.match(detail, /새 댓글과 답글 작성은 현재 받지 않아요/);
  assert.match(
    detail,
    /Linking\.openURL\(`\$\{MOBILE_COMMUNITY_WEB_BASE\}\/community\/post\/\$\{encodeURIComponent\(postId\)\}`\)/,
  );
  assert.match(detail, />웹에서 전체 글 보기<\/Text>/);
});

test("mobile feed discloses sponsored and advertising posts before users open them", () => {
  const feed = readSource("app/(tabs)/community.tsx");

  assert.match(feed, /sponsored: "협찬"/);
  assert.match(feed, /ad: "광고"/);
  assert.match(feed, /interface PostItem \{[\s\S]*ad_disclosure\?: string \| null/);
  assert.match(feed, /\/api\/community\/posts\?sort=new/);
  assert.match(feed, /const adLabel = AD_LABELS\[item\.ad_disclosure \?\? "general"\]/);
  assert.match(
    feed,
    /\{adLabel && \([\s\S]*?<Text style=\{styles\.postAdText\}>\{adLabel\}<\/Text>/,
  );
});

test("historical mobile post lists do not invite users into disabled publishing", () => {
  const myPosts = readSource("app/community/my-posts.tsx");

  assert.match(myPosts, /과거에 작성한 글이 있으면 여기에서 확인할 수 있어요/);
  assert.doesNotMatch(myPosts, /첫 후기를 남기면/);
});

test("mobile preview states the remaining moderation boundary instead of implying feature parity", () => {
  const detail = readSource("app/community/post/[id].tsx");

  assert.match(detail, /댓글 단위 신고는 현재 제공하지 않아요/);
  assert.match(detail, /작성자 글 숨기기는 이 화면에서 이용할 수 있어요/);
  assert.match(detail, /불편한 내용은 웹의 게시글 신고로 접수해주세요/);
});

test("mobile muted-author management preserves the list on failures and makes unhide reversible", () => {
  const mutedAuthors = readSource("app/community/muted-authors.tsx");

  assert.match(mutedAuthors, /listMutedCommunityAuthors\(apiFetch\)/);
  assert.match(mutedAuthors, /unmuteCommunityAuthor\(user\.id, apiFetch\)/);
  assert.match(mutedAuthors, /숨김을 해제할까요/);
  assert.match(mutedAuthors, /작성자의 게시글과 댓글이 다시 보일 수 있어요/);
  assert.match(mutedAuthors, /숨김을 해제하지 못했어요/);
  assert.match(mutedAuthors, /저장된 숨김 설정이 바뀐 것은 아니에요/);
  assert.match(mutedAuthors, /<ErrorRetry/);
  assert.match(mutedAuthors, /clearCommunityCaches\(\)/);
  assert.doesNotMatch(mutedAuthors, /<Text[^>]*>\{user\.id\}<\/Text>/);
});

test("mobile profile exposes a stable path to muted-author management", () => {
  const profile = readSource("app/(tabs)/profile.tsx");

  assert.match(profile, /label="숨긴 작성자"/);
  assert.match(profile, /router\.push\("\/community\/muted-authors" as Href\)/);
});

test("mobile community reads cannot bypass the server-side muted-author filter", () => {
  const feed = readSource("app/(tabs)/community.tsx");
  const detail = readSource("app/community/post/[id].tsx");
  const bookmarks = readSource("app/community/my-bookmarks.tsx");

  assert.match(feed, /fetchPostsFromApi\(cat\)/);
  assert.doesNotMatch(feed, /fetchPostsFromSupabase|\.from\("community_posts"\)|\.from\("community_profiles"\)/);
  assert.match(detail, /fetchPostFromApi\(postId\)/);
  assert.match(detail, /fetchCommentsFromApi\(postId\)/);
  assert.doesNotMatch(
    detail,
    /fetchPostFromSupabase|fetchCommentsFromSupabase|\.from\("community_posts"\)|\.from\("community_comments"\)|\.from\("community_profiles"\)/,
  );
  assert.match(bookmarks, /\/api\/community\/posts\?bookmarked=true&sort=new/);
  assert.doesNotMatch(bookmarks, /post:community_posts|\.from\("community_bookmarks"\)/);
});

test("mobile discards a cached post when the server confirms it is no longer visible", () => {
  const detail = readSource("app/community/post/[id].tsx");

  assert.match(detail, /class CommunityPostUnavailableError extends Error/);
  assert.match(detail, /response\.status === 404/);
  assert.match(detail, /error instanceof CommunityPostUnavailableError/);
  assert.match(detail, /clearCommunityCaches\(\)/);
  assert.match(detail, /setComments\(\[\]\)/);
});

test("my-posts load failures are never presented as an empty publishing history", () => {
  const myPosts = readSource("app/community/my-posts.tsx");

  assert.match(myPosts, /const \[loadError, setLoadError\] = useState\(false\)/);
  assert.match(myPosts, /setLoadError\(true\)/);
  assert.match(myPosts, /내가 쓴 글을 불러오지 못했어요/);
  assert.match(myPosts, /저장된 글이 없어진 것은 아니에요/);
  assert.match(myPosts, /<ErrorRetry/);
});

test("bookmark load failures are never presented as an empty saved list", () => {
  const bookmarks = readSource("app/community/my-bookmarks.tsx");

  assert.match(bookmarks, /const \[loadError, setLoadError\] = useState\(false\)/);
  assert.match(bookmarks, /setLoadError\(true\)/);
  assert.match(bookmarks, /북마크를 불러오지 못했어요/);
  assert.match(bookmarks, /저장한 항목이 없어진 것은 아니에요/);
  assert.match(bookmarks, /<ErrorRetry/);
});

test("post detail read failures never claim that a post was deleted", () => {
  const detail = readSource("app/community/post/[id].tsx");

  assert.match(detail, /const \[postLoadError, setPostLoadError\] = useState\(false\)/);
  assert.match(detail, /setPostLoadError\(true\)/);
  assert.match(detail, /게시글을 불러오지 못했어요/);
  assert.match(detail, /삭제된 것으로 판단하지 않았어요/);
  assert.match(detail, /저장된 미리보기를 표시하고 있어요/);
});

test("comment read failures are never presented as an empty discussion", () => {
  const detail = readSource("app/community/post/[id].tsx");

  assert.match(detail, /const \[commentsLoadError, setCommentsLoadError\] = useState\(false\)/);
  assert.match(detail, /setCommentsLoadError\(true\)/);
  assert.match(detail, /댓글을 불러오지 못했어요/);
  assert.match(detail, /댓글이 없는 것으로 판단하지 않았어요/);
  assert.match(
    detail,
    /!commentsLoading && !commentsLoadError && comments\.length === 0/,
  );
});

test("social-state read failures never overwrite or act on a false default", () => {
  const detail = readSource("app/community/post/[id].tsx");

  assert.match(detail, /if \(authError\) throw authError/);
  assert.match(detail, /if \(voteResult\.error \|\| bookmarkResult\.error\)/);
  assert.match(detail, /const \[socialStateLoaded, setSocialStateLoaded\] = useState\(false\)/);
  assert.match(detail, /setSocialStateLoaded\(true\)/);
  assert.match(detail, /setSocialStateLoaded\(false\)/);
  assert.match(detail, /if \(!socialStateLoaded\) \{/);
});
