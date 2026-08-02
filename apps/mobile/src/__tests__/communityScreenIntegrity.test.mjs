import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { URL } from "node:url";

const postSource = readFileSync(
  new URL("../../app/community/post/[id].tsx", import.meta.url),
  "utf8",
);
const cohortSource = readFileSync(
  new URL("../../app/community/cohort/[id].tsx", import.meta.url),
  "utf8",
);

test("post votes and bookmarks cross only owner-bound server mutation contracts", () => {
  assert.match(postSource, /submitCommunityVote\(\{/);
  assert.match(postSource, /setCommunityBookmark\(\{/);
  assert.match(postSource, /apiFetchForExpectedUser/);
  assert.match(postSource, /createCommunityPostActionGate\(\)/);
  assert.match(postSource, /supabase\.auth\.onAuthStateChange\(/);
  assert.match(postSource, /clearCommunityCaches\(\)/);
  assert.match(postSource, /setCommentText\(""\)/);
  assert.match(postSource, /setActionNotice\(null\)/);
  assert.match(postSource, /actionGateRef\.hasActiveAction\(\)/);
  assert.match(postSource, /invalidateLoadsForMutation\(\)/);
  assert.doesNotMatch(postSource, /supabase\.rpc\("community_vote_post"/);
  assert.doesNotMatch(
    postSource,
    /\.from\("community_bookmarks"\)[\s\S]{0,200}\.(?:delete|insert|upsert)\(/,
  );
});

test("post comment writes are owner-bound, atomic, and idempotent", () => {
  assert.match(postSource, /actionGateRef\.begin\("comment"\)/);
  assert.match(
    postSource,
    /apiFetchForExpectedUser\(token\.ownerId, "\/api\/community\/comments"/,
  );
  assert.match(postSource, /createCommunityCommentIdempotencyStore\(/);
  assert.match(postSource, /"Idempotency-Key": idempotencyKey/);
  assert.match(postSource, /commentIdempotencyRef\.clearIf\(idempotencyKey\)/);
  assert.match(postSource, /post_comment_count/);
});

test("cohort detail verifies membership and never auto-upserts a member", () => {
  assert.match(cohortSource, /fetchCurrentCohortAccess\(\{/);
  assert.match(cohortSource, /access\.status === "unassigned"/);
  assert.match(cohortSource, /access\.status === "different_room"/);
  assert.match(cohortSource, /assignCurrentUserToCohort\(\{/);
  assert.match(cohortSource, /동기방 배정받기/);
  assert.match(cohortSource, /supabase\.auth\.onAuthStateChange\(/);
  assert.doesNotMatch(
    cohortSource,
    /\.from\("cohort_members"\)[\s\S]{0,200}\.(?:insert|upsert)\(/,
  );
});

test("cohort message writes are owner-bound and fenced by an atomic operation token", () => {
  assert.match(cohortSource, /cohortGateRef\.beginMessage\(\)/);
  assert.match(cohortSource, /sendCohortMessage\(\{/);
  assert.match(cohortSource, /ownerId: token\.ownerId/);
  assert.match(cohortSource, /isOperationOwnerCurrent\(token\)/);
  assert.match(cohortSource, /createCohortMessageIdempotencyStore\(/);
  assert.match(cohortSource, /messageIdempotencyRef\.keyFor\(/);
  assert.match(cohortSource, /idempotencyKey/);
  assert.match(cohortSource, /messageIdempotencyRef\.clearIf\(idempotencyKey\)/);
  assert.match(cohortSource, /messageRevisionRef\.current \+= 1/);
  assert.match(cohortSource, /mergeCohortMessageSnapshot\(/);
  assert.match(cohortSource, /error\.status === 403/);
  assert.match(cohortSource, /cohortGateRef\.invalidateOperations\(\)/);
});

test("cohort membership is rechecked whenever the screen or app becomes active", () => {
  assert.match(cohortSource, /useFocusEffect\(/);
  assert.match(cohortSource, /AppState\.addEventListener\("change"/);
  assert.match(cohortSource, /nextState === "active"/);
  assert.match(cohortSource, /clearRoomState\(\{ preserveComposer: true \}\)/);
});
