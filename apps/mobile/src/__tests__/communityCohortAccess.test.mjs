import assert from "node:assert/strict";
import test from "node:test";

import {
  assignCurrentUserToCohort,
  createCommunityCohortGate,
  createCohortMessageIdempotencyStore,
  fetchCurrentCohortAccess,
  fetchCohortMembers,
  fetchCohortMessages,
  mergeCohortMessageSnapshot,
  parseCohortMembers,
  parseCurrentCohortAccess,
  sendCohortMessage,
} from "../lib/communityCohortAccess.mjs";

const OWNER_ID = "10000000-0000-4000-8000-000000000001";
const ROOM_ID = "30000000-0000-4000-8000-000000000001";
const OTHER_ROOM_ID = "30000000-0000-4000-8000-000000000002";

test("the current cohort contract distinguishes this room, another room, and no assignment", () => {
  assert.deepEqual(parseCurrentCohortAccess({ room: null }, ROOM_ID), {
    status: "unassigned",
  });
  assert.deepEqual(
    parseCurrentCohortAccess({
      room: { id: ROOM_ID, name: "2027 봄 동기방", member_count: 12 },
      recentMembers: [],
      lastMessage: null,
    }, ROOM_ID),
    {
      status: "member",
      room: { id: ROOM_ID, name: "2027 봄 동기방", memberCount: 12 },
    },
  );
  assert.deepEqual(
    parseCurrentCohortAccess({
      room: { id: OTHER_ROOM_ID, name: "2027 여름 동기방", member_count: 8 },
      recentMembers: [],
      lastMessage: null,
    }, ROOM_ID),
    {
      status: "different_room",
      room: { id: OTHER_ROOM_ID, name: "2027 여름 동기방", memberCount: 8 },
    },
  );
  assert.equal(
    parseCurrentCohortAccess({
      room: { id: ROOM_ID, name: "2027 봄 동기방", member_count: 12 },
      recentMembers: [],
      lastMessage: "첫 줄\n둘째 줄",
    }, ROOM_ID).status,
    "member",
  );
});

test("cohort access is verified by the server under the captured owner", async () => {
  const calls = [];
  const access = await fetchCurrentCohortAccess({
    apiFetchForExpectedUser: async (...args) => {
      calls.push(args);
      return {
        ok: true,
        status: 200,
        json: async () => ({ room: null }),
      };
    },
    ownerId: OWNER_ID,
    roomId: ROOM_ID,
  });
  assert.deepEqual(access, { status: "unassigned" });
  assert.deepEqual(calls, [[OWNER_ID, "/api/community/cohort", {}]]);
});

test("a forbidden membership recheck fails closed with a safe access message", async () => {
  await assert.rejects(
    () => fetchCurrentCohortAccess({
      apiFetchForExpectedUser: async () => ({
        ok: false,
        status: 403,
        json: async () => ({ error: "\u0000unsafe" }),
      }),
      ownerId: OWNER_ID,
      roomId: ROOM_ID,
    }),
    (error) => {
      assert.equal(error.name, "CommunityCohortAccessError");
      assert.equal(error.status, 403);
      assert.equal(error.displayMessage, "동기방 이용 권한이 없거나 종료되었어요. 현재 가입 상태를 다시 확인해주세요.");
      return true;
    },
  );
});

test("explicit cohort assignment uses the existing auto-assign POST contract", async () => {
  const calls = [];
  const result = await assignCurrentUserToCohort({
    apiFetchForExpectedUser: async (...args) => {
      calls.push(args);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          room_id: ROOM_ID,
          reason: "no_wedding_date_assigned_flexible",
          year: 9999,
          quarter: 4,
          flexible: true,
        }),
      };
    },
    ownerId: OWNER_ID,
  });

  assert.deepEqual(result, { roomId: ROOM_ID });
  assert.deepEqual(calls, [[
    OWNER_ID,
    "/api/community/cohort/auto-assign",
    { method: "POST" },
  ]]);
});

test("a null assignment is never presented as a successful room join", async () => {
  await assert.rejects(
    () => assignCurrentUserToCohort({
      apiFetchForExpectedUser: async () => ({
        ok: true,
        status: 200,
        json: async () => ({ room_id: null, reason: "community_write_blocked" }),
      }),
      ownerId: OWNER_ID,
    }),
    (error) => {
      assert.equal(error.name, "CommunityCohortAccessError");
      assert.equal(error.code, "COMMUNITY_COHORT_NOT_ASSIGNED");
      assert.equal(
        error.displayMessage,
        "동기방을 배정하지 못했어요. 커뮤니티 이용 상태를 확인한 뒤 다시 시도해주세요.",
      );
      return true;
    },
  );
});

test("cohort loads and assignments cannot commit after an account transition", () => {
  const gate = createCommunityCohortGate();
  gate.setOwner(OWNER_ID);
  assert.equal(gate.hasActiveMessage(), false);
  const loadA = gate.capture();
  const assignA = gate.beginAssignment();
  const messageA = gate.beginMessage();
  assert.ok(loadA);
  assert.ok(assignA);
  assert.ok(messageA);
  assert.equal(gate.hasActiveMessage(), true);
  assert.equal(gate.beginAssignment(), null);
  assert.equal(gate.beginMessage(), null);

  const ownerB = "10000000-0000-4000-8000-000000000002";
  gate.setOwner(ownerB);
  assert.equal(gate.hasActiveMessage(), false);
  assert.equal(gate.isCurrent(loadA), false);
  assert.equal(gate.isCurrent(assignA), false);
  assert.equal(gate.isCurrent(messageA), false);
  gate.finishAssignment(assignA);
  gate.finishMessage(messageA);

  const assignB = gate.beginAssignment();
  assert.ok(assignB);
  assert.equal(assignB.ownerId, ownerB);
  const messageB = gate.beginMessage();
  assert.equal(messageB?.ownerId, ownerB);
  assert.equal(gate.invalidateOperations(), true);
  assert.equal(gate.isCurrent(assignB), false);
  assert.equal(gate.isCurrent(messageB), false);
  assert.equal(gate.capture()?.ownerId, ownerB);
});

test("a late cohort snapshot merges instead of overwriting realtime or sent messages", () => {
  const snapshot = [
    { id: "40000000-0000-4000-8000-000000000001", created_at: "2026-08-02T10:00:00.000Z", content: "first" },
    { id: "40000000-0000-4000-8000-000000000002", created_at: "2026-08-02T10:01:00.000Z", content: "server copy" },
  ];
  const live = [
    { id: "40000000-0000-4000-8000-000000000002", created_at: "2026-08-02T10:01:00.000Z", content: "temporary copy" },
    { id: "40000000-0000-4000-8000-000000000003", created_at: "2026-08-02T10:02:00.000Z", content: "realtime" },
  ];

  assert.deepEqual(mergeCohortMessageSnapshot(snapshot, live), [
    snapshot[0],
    snapshot[1],
    live[1],
  ]);
});

test("cohort messages use the owner-bound member API and accept only the target room", async () => {
  const calls = [];
  const message = await sendCohortMessage({
    apiFetchForExpectedUser: async (...args) => {
      calls.push(args);
      return {
        ok: true,
        status: 201,
        json: async () => ({
          message: {
            id: "40000000-0000-4000-8000-000000000001",
            room_id: ROOM_ID,
            author_id: OWNER_ID,
            content: "견적 항목을 같이 봐주세요.",
            thread_topic: "price",
            created_at: "2026-08-02T10:00:00.000Z",
          },
        }),
      };
    },
    ownerId: OWNER_ID,
    roomId: ROOM_ID,
    content: "견적 항목을 같이 봐주세요.",
    threadTopic: "price",
    idempotencyKey: "60000000-0000-4000-8000-000000000001",
  });

  assert.equal(message.roomId, ROOM_ID);
  assert.equal(message.authorId, OWNER_ID);
  assert.deepEqual(calls, [[
    OWNER_ID,
    `/api/community/cohort/${ROOM_ID}/messages`,
    {
      method: "POST",
      headers: { "Idempotency-Key": "60000000-0000-4000-8000-000000000001" },
      body: JSON.stringify({
        content: "견적 항목을 같이 봐주세요.",
        thread_topic: "price",
      }),
    },
  ]]);
});

test("an uncertain cohort message retry keeps one idempotency key for the exact draft", () => {
  const ids = [
    "60000000-0000-4000-8000-000000000001",
    "60000000-0000-4000-8000-000000000002",
  ];
  const store = createCohortMessageIdempotencyStore(() => ids.shift());
  const first = store.keyFor(OWNER_ID, ROOM_ID, "같은 메시지", "price");
  assert.equal(store.keyFor(OWNER_ID, ROOM_ID, "같은 메시지", "price"), first);
  const second = store.keyFor(OWNER_ID, ROOM_ID, "같은 메시지", "review");
  assert.notEqual(second, first);
  assert.equal(store.clearIf(second), true);
});

test("member message reads reject a malformed subset instead of hiding it", async () => {
  await assert.rejects(
    () => fetchCohortMessages({
      apiFetchForExpectedUser: async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          messages: [
            {
              id: "40000000-0000-4000-8000-000000000001",
              room_id: ROOM_ID,
              author_id: OWNER_ID,
              content: "정상 메시지",
              thread_topic: null,
              created_at: "2026-08-02T10:00:00.000Z",
            },
            { id: "malformed" },
          ],
        }),
      }),
      ownerId: OWNER_ID,
      roomId: ROOM_ID,
    }),
    /COMMUNITY_COHORT_MESSAGES_RESPONSE_INVALID/,
  );
});

test("cohort members use the owner-bound API and retain only the public identity projection", async () => {
  const calls = [];
  const members = await fetchCohortMembers({
    apiFetchForExpectedUser: async (...args) => {
      calls.push(args);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          members: [{
            user_id: OWNER_ID,
            profile: { nickname: "테스터", rank: "expert" },
          }],
        }),
      };
    },
    ownerId: OWNER_ID,
    roomId: ROOM_ID,
  });

  assert.deepEqual(members, [{
    user_id: OWNER_ID,
    profile: { nickname: "테스터", rank: "expert" },
  }]);
  assert.deepEqual(calls, [[
    OWNER_ID,
    `/api/community/cohort/${ROOM_ID}/members`,
    {},
  ]]);
});

test("the mobile cohort member parser rejects wedding timing and other undeclared profile fields", () => {
  assert.throws(
    () => parseCohortMembers({
      members: [{
        user_id: OWNER_ID,
        profile: {
          nickname: "테스터",
          rank: "expert",
          wedding_year: 2027,
        },
      }],
    }),
    /COMMUNITY_COHORT_MEMBERS_RESPONSE_INVALID/,
  );
});
