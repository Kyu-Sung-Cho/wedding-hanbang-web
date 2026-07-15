import assert from "node:assert/strict";
import test from "node:test";

import {
  listMutedCommunityAuthors,
  muteCommunityAuthor,
  unmuteCommunityAuthor,
} from "../src/lib/communityMutes.ts";

const Response = globalThis.Response;

test("mobile lists only the authenticated account's server-confirmed muted authors", async () => {
  const calls = [];
  const users = [
    {
      id: "11111111-1111-4111-8111-111111111111",
      nickname: "조용한예신",
      mutedAt: "2026-07-14T08:00:00.000Z",
    },
  ];

  const result = await listMutedCommunityAuthors(async (path, options) => {
    calls.push({ path, options });
    return new Response(JSON.stringify({ users }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });

  assert.deepEqual(calls, [{ path: "/api/community/mutes", options: undefined }]);
  assert.deepEqual(result, users);
});

test("mobile keeps the existing muted-author list when the server cannot confirm it", async () => {
  await assert.rejects(
    listMutedCommunityAuthors(async () => new Response(JSON.stringify({
      error: "숨긴 작성자 목록을 불러오지 못했습니다.",
    }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    })),
    /숨긴 작성자 목록을 불러오지 못했습니다/,
  );
});

test("mobile rejects a malformed muted-author success response", async () => {
  await assert.rejects(
    listMutedCommunityAuthors(async () => new Response(JSON.stringify({
      users: [{ id: "not-a-user-id", nickname: "", mutedAt: "sometime" }],
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })),
    /숨긴 작성자 목록 상태를 확인하지 못했습니다/,
  );
});

test("mobile hides an author only after the server confirms the exact account", async () => {
  const userId = "22222222-2222-4222-8222-222222222222";
  const calls = [];

  await muteCommunityAuthor(userId, async (path, options) => {
    calls.push({ path, options });
    return new Response(JSON.stringify({ muted: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, "/api/community/mutes");
  assert.equal(calls[0].options.method, "POST");
  assert.deepEqual(JSON.parse(calls[0].options.body), { userId });
});

test("mobile restores an author only after the server confirms the exact account", async () => {
  const userId = "33333333-3333-4333-8333-333333333333";
  const calls = [];

  await unmuteCommunityAuthor(userId, async (path, options) => {
    calls.push({ path, options });
    return new Response(JSON.stringify({ muted: false }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, "/api/community/mutes");
  assert.equal(calls[0].options.method, "DELETE");
  assert.deepEqual(JSON.parse(calls[0].options.body), { userId });
});
