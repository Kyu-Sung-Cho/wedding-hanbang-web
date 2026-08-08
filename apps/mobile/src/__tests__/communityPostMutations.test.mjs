import assert from "node:assert/strict";
import test from "node:test";

import {
  parseCommunityBookmarkResponse,
  parseCommunityVoteResponse,
  fetchCommunityPostSocialState,
  createCommunityPostActionGate,
  createCommunityCommentIdempotencyStore,
  submitCommunityVote,
  setCommunityBookmark,
} from "../lib/communityPostMutations.mjs";

const OWNER_ID = "10000000-0000-4000-8000-000000000001";
const POST_ID = "20000000-0000-4000-8000-000000000001";

test("vote success is accepted only with non-negative integer server counts", () => {
  assert.deepEqual(
    parseCommunityVoteResponse({ upvote_count: 3, downvote_count: 0 }),
    { upvoteCount: 3, downvoteCount: 0 },
  );
  assert.throws(
    () => parseCommunityVoteResponse({ upvote_count: -1, downvote_count: 0 }),
    /COMMUNITY_VOTE_RESPONSE_INVALID/,
  );
  assert.throws(
    () => parseCommunityVoteResponse({ upvote_count: 3, downvote_count: "0" }),
    /COMMUNITY_VOTE_RESPONSE_INVALID/,
  );
});

test("vote submits the actual POST contract under the captured owner", async () => {
  const calls = [];
  const result = await submitCommunityVote({
    apiFetchForExpectedUser: async (...args) => {
      calls.push(args);
      return {
        ok: true,
        status: 200,
        json: async () => ({ upvote_count: 7, downvote_count: 2 }),
      };
    },
    ownerId: OWNER_ID,
    postId: POST_ID,
    voteType: 1,
  });

  assert.deepEqual(result, { upvoteCount: 7, downvoteCount: 2, userVote: 1 });
  assert.deepEqual(calls, [[
    OWNER_ID,
    `/api/community/posts/${POST_ID}/vote`,
    { method: "POST", body: JSON.stringify({ voteType: 1 }) },
  ]]);
});

test("bookmark success is accepted only with a boolean state and server count", () => {
  assert.deepEqual(
    parseCommunityBookmarkResponse({ bookmarked: true, bookmark_count: 4 }),
    { bookmarked: true, bookmarkCount: 4 },
  );
  assert.throws(
    () => parseCommunityBookmarkResponse({ bookmarked: 1, bookmark_count: 4 }),
    /COMMUNITY_BOOKMARK_RESPONSE_INVALID/,
  );
  assert.throws(
    () => parseCommunityBookmarkResponse({ bookmarked: false, bookmark_count: -1 }),
    /COMMUNITY_BOOKMARK_RESPONSE_INVALID/,
  );
});

test("bookmark submits the desired state through the intent-based POST contract", async () => {
  const calls = [];
  const result = await setCommunityBookmark({
    apiFetchForExpectedUser: async (...args) => {
      calls.push(args);
      return {
        ok: true,
        status: 200,
        json: async () => ({ bookmarked: false, bookmark_count: 6 }),
      };
    },
    ownerId: OWNER_ID,
    postId: POST_ID,
    bookmarked: false,
  });

  assert.deepEqual(result, { bookmarked: false, bookmarkCount: 6 });
  assert.deepEqual(calls, [[
    OWNER_ID,
    `/api/community/posts/${POST_ID}/bookmark`,
    { method: "POST", body: JSON.stringify({ bookmarked: false }) },
  ]]);
});

test("a suspension response reaches the user without being reported as success", async () => {
  await assert.rejects(
    () => submitCommunityVote({
      apiFetchForExpectedUser: async () => ({
        ok: false,
        status: 403,
        json: async () => ({
          code: "COMMUNITY_SUSPENDED",
          error: "현재 커뮤니티 작성 기능을 사용할 수 없어요.",
        }),
      }),
      ownerId: OWNER_ID,
      postId: POST_ID,
      voteType: 1,
    }),
    (error) => {
      assert.equal(error.name, "CommunityPostMutationError");
      assert.equal(error.status, 403);
      assert.equal(error.code, "COMMUNITY_SUSPENDED");
      assert.equal(error.displayMessage, "현재 커뮤니티 작성 기능을 사용할 수 없어요.");
      assert.equal(error.shouldRefresh, true);
      return true;
    },
  );
});

test("rate limiting has a truthful retry-later message even with a malformed body", async () => {
  await assert.rejects(
    () => setCommunityBookmark({
      apiFetchForExpectedUser: async () => ({
        ok: false,
        status: 429,
        json: async () => ({ error: "\u0000unsafe" }),
      }),
      ownerId: OWNER_ID,
      postId: POST_ID,
      bookmarked: true,
    }),
    (error) => {
      assert.equal(error.status, 429);
      assert.equal(error.displayMessage, "요청이 너무 많아요. 잠시 후 다시 시도해주세요.");
      return true;
    },
  );
});

test("failure recovery reads the latest owner-bound social state from the post API", async () => {
  const calls = [];
  const state = await fetchCommunityPostSocialState({
    apiFetchForExpectedUser: async (...args) => {
      calls.push(args);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          id: POST_ID,
          upvote_count: 9,
          downvote_count: 1,
          user_vote: null,
          user_bookmarked: true,
          unrelated_detail: "allowed",
        }),
      };
    },
    ownerId: OWNER_ID,
    postId: POST_ID,
  });

  assert.deepEqual(state, {
    userVote: 0,
    bookmarked: true,
    upvoteCount: 9,
    downvoteCount: 1,
  });
  assert.deepEqual(calls, [[OWNER_ID, `/api/community/posts/${POST_ID}`, {}]]);
});

test("action locks are atomic and an account transition invalidates stale commits", () => {
  const gate = createCommunityPostActionGate();
  gate.setOwner(OWNER_ID);
  assert.equal(gate.hasActiveAction(), false);
  const first = gate.begin("vote");
  assert.ok(first);
  assert.equal(gate.hasActiveAction(), true);
  assert.equal(gate.begin("vote"), null);
  assert.equal(gate.isCurrent(first), true);

  const nextOwner = "10000000-0000-4000-8000-000000000002";
  gate.setOwner(nextOwner);
  assert.equal(gate.hasActiveAction(), false);
  assert.equal(gate.isCurrent(first), false);
  gate.finish(first);

  const second = gate.begin("vote");
  assert.ok(second);
  assert.equal(second.ownerId, nextOwner);
  assert.equal(gate.isCurrent(second), true);
  assert.equal(gate.finish(second), true);
  assert.equal(gate.hasActiveAction(), false);
});

test("vote and bookmark cannot race each other's social-state recovery", () => {
  const gate = createCommunityPostActionGate();
  gate.setOwner(OWNER_ID);
  const vote = gate.begin("vote");
  assert.ok(vote);
  assert.equal(gate.begin("bookmark"), null);
  assert.equal(gate.finish(vote), true);
  assert.ok(gate.begin("bookmark"));
});

test("an uncertain comment retry reuses its idempotency key until success is confirmed", () => {
  const ids = [
    "50000000-0000-4000-8000-000000000001",
    "50000000-0000-4000-8000-000000000002",
    "50000000-0000-4000-8000-000000000003",
  ];
  const store = createCommunityCommentIdempotencyStore(() => ids.shift());
  const first = store.keyFor(OWNER_ID, POST_ID, "같은 댓글");
  assert.equal(store.keyFor(OWNER_ID, POST_ID, "같은 댓글"), first);
  assert.notEqual(store.keyFor(OWNER_ID, POST_ID, "수정한 댓글"), first);
  const current = store.keyFor(OWNER_ID, POST_ID, "수정한 댓글");
  assert.equal(store.clearIf(current), true);
  assert.notEqual(store.keyFor(OWNER_ID, POST_ID, "수정한 댓글"), current);
});
