import assert from "node:assert/strict";
import test from "node:test";

import {
  buildMarkReadBody,
  canOpenCoupleChange,
  getCoupleChangeNativeRoute,
  isAwaitingMyApproval,
  parseCoupleChangeNotifications,
  selectCoupleChangesForViewer,
  selectUnreadCoupleChanges,
} from "../lib/coupleChangeNotifications.mjs";

// 서버(`couple_change_notifications`)와 `/api/notifications` 는 이미 있었고 웹은
// 상단 패널로 보여줬다. 그런데 **모바일에는 호출자가 0건**이라, 파트너가 총예산을
// 바꿔도 상대는 앱을 열어 숫자를 직접 보지 않는 한 알 수 없었다.
//
// 아래 행은 2026-08-22 스테이징에서 두 사람 승인 흐름을 실제로 돌려 쌓인 값이다.
const APPLIED = {
  id: "0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f",
  event_kind: "change_applied",
  action_id: "1f1f1f1f-1f1f-4f1f-8f1f-1f1f1f1f1f1f",
  tool_name: "update_budget",
  title: "함께 쓰는 정보가 변경됐어요",
  message: "예산 정보에 새 변경이 반영됐어요.",
  href: "/budget",
  read_at: null,
  created_at: "2026-08-22T10:20:00.000Z",
};

const REQUESTED = {
  id: "2f2f2f2f-2f2f-4f2f-8f2f-2f2f2f2f2f2f",
  event_kind: "approval_requested",
  action_id: "3f3f3f3f-3f3f-4f3f-8f3f-3f3f3f3f3f3f",
  tool_name: "update_budget",
  title: "함께 확인할 변경이 있어요",
  message: "총예산 변경을 함께 확인해 주세요.",
  href: "/chat",
  read_at: null,
  created_at: "2026-08-22T10:10:00.000Z",
};

// 보는 사람. 지금까지 이 자리에 action_id 를 넣고도 17개가 전부 통과했다 —
// 소유자 대조가 아예 없었다는 실증이었다.
const VIEWER = "5a5a5a5a-5a5a-4a5a-8a5a-5a5a5a5a5a5a";
const OTHER = "6b6b6b6b-6b6b-4b6b-8b6b-6b6b6b6b6b6b";
const envelope = (rows, ownerId = VIEWER) => ({ ownerId, notifications: rows });

test("서버가 보낸 실제 행을 그대로 읽는다", () => {
  const parsed = parseCoupleChangeNotifications(envelope([APPLIED, REQUESTED]));
  assert.equal(parsed.notifications.length, 2);
  assert.equal(parsed.notifications[0].title, "함께 쓰는 정보가 변경됐어요");
  assert.equal(parsed.notifications[0].message, "예산 정보에 새 변경이 반영됐어요.");
  assert.equal(parsed.notifications[0].href, "/budget");
  assert.equal(parsed.notifications[0].readAt, null);
});

test("문구를 지어내지 않는다 — 서버 값을 그대로 옮긴다", () => {
  const parsed = parseCoupleChangeNotifications(
    envelope([{ ...APPLIED, title: "직접 쓴 제목", message: "직접 쓴 본문" }]),
  );
  assert.equal(parsed.notifications[0].title, "직접 쓴 제목");
  assert.equal(parsed.notifications[0].message, "직접 쓴 본문");
});

test("깨진 줄 하나가 나머지를 못 보게 만들지 않는다", () => {
  const parsed = parseCoupleChangeNotifications(
    envelope([APPLIED, { ...REQUESTED, href: "/evil" }, { id: "nope" }]),
  );
  assert.equal(parsed.notifications.length, 1);
  assert.equal(parsed.notifications[0].id, APPLIED.id);
});

test("모르는 종류는 버린다 — 뜻을 모르는 것을 보여줄 수 없다", () => {
  const parsed = parseCoupleChangeNotifications(
    envelope([{ ...APPLIED, event_kind: "something_new" }]),
  );
  assert.equal(parsed.notifications.length, 0);
});

test("봉투가 아니면 null", () => {
  for (const bad of [null, undefined, [], "x", { notifications: null }, { notifications: [], ownerId: "x" }]) {
    assert.equal(parseCoupleChangeNotifications(bad), null);
  }
});

test("웹 경로를 모바일 경로로 옮긴다 — /dashboard 와 /lounge 는 같은 화면", () => {
  assert.equal(getCoupleChangeNativeRoute("/budget"), "/budget");
  assert.equal(getCoupleChangeNativeRoute("/schedule"), "/schedule");
  assert.equal(getCoupleChangeNativeRoute("/chat"), "/(tabs)/chat");
  assert.equal(getCoupleChangeNativeRoute("/dashboard"), "/(tabs)/lounge");
  assert.equal(getCoupleChangeNativeRoute("/lounge"), "/(tabs)/lounge");
  assert.equal(getCoupleChangeNativeRoute("/settings"), "/settings");
});

test("모르는 경로로는 보내지 않는다", () => {
  for (const bad of ["/admin", "https://evil.example", "", null, undefined, "__proto__", "constructor"]) {
    assert.equal(getCoupleChangeNativeRoute(bad), null);
  }
});

test("안 읽은 것만, 최신부터, 정해진 개수만", () => {
  const rows = parseCoupleChangeNotifications(
    envelope([
      { ...REQUESTED, created_at: "2026-08-22T10:10:00.000Z" },
      { ...APPLIED, created_at: "2026-08-22T10:20:00.000Z" },
      {
        ...APPLIED,
        id: "4f4f4f4f-4f4f-4f4f-8f4f-4f4f4f4f4f4f",
        created_at: "2026-08-22T10:30:00.000Z",
        read_at: "2026-08-22T10:31:00.000Z",
      },
    ]),
  ).notifications;
  const picked = selectUnreadCoupleChanges(rows, 1);
  assert.equal(picked.unreadCount, 2);
  assert.equal(picked.visible.length, 1);
  assert.equal(picked.visible[0].createdAt, "2026-08-22T10:20:00.000Z");
  assert.equal(picked.hiddenCount, 1);
});

test("서버 정렬을 믿지 않고 다시 정렬한다", () => {
  const rows = parseCoupleChangeNotifications(envelope([REQUESTED, APPLIED])).notifications;
  const picked = selectUnreadCoupleChanges(rows, 5);
  assert.deepEqual(
    picked.visible.map((row) => row.createdAt),
    ["2026-08-22T10:20:00.000Z", "2026-08-22T10:10:00.000Z"],
  );
});

test("알림이 없으면 조용하다", () => {
  const picked = selectUnreadCoupleChanges([], 3);
  assert.deepEqual(picked, { visible: [], unreadCount: 0, hiddenCount: 0 });
  assert.deepEqual(selectUnreadCoupleChanges(null), { visible: [], unreadCount: 0, hiddenCount: 0 });
});

// "확인 필요" 딱지를 붙일 종류. 서버가 각 종류에 쓰는 문구가 정본이고, 셋의 뜻이
// 서로 다르다. 첫 판은 approval_* 를 한 덩어리로 묶어서 "두 사람의 확인이
// 끝났어요" 옆에 "확인 필요"를 붙였다 — 서버가 방금 한 말과 어긋난다.
//
// 아래 문구는 supabase/migrations 에 있는 실제 문자열이다.
const SERVER_COPY = [
  ["approval_requested", "함께 확인할 변경이 있어요", true],
  ["approval_pending", "파트너 확인을 기다리는 계획 변경이에요", false],
  ["approval_ready", "두 사람의 확인이 끝났어요", false],
  ["approval_withdrawn", "공동 확인이 철회됐어요", false],
  ["change_applied", "함께 쓰는 정보가 변경됐어요", false],
];

for (const [kind, serverTitle, awaiting] of SERVER_COPY) {
  test(`"${serverTitle}" 에 확인 필요 딱지는 ${awaiting ? "붙는다" : "안 붙는다"}`, () => {
    const [row] = parseCoupleChangeNotifications(
      envelope([{ ...APPLIED, event_kind: kind, title: serverTitle }]),
    ).notifications;
    assert.equal(row.title, serverTitle);
    assert.equal(isAwaitingMyApproval(row), awaiting);
  });
}

test("알림이 아닌 값에는 딱지를 붙이지 않는다", () => {
  for (const bad of [null, undefined, "approval_requested", {}, []]) {
    assert.equal(isAwaitingMyApproval(bad), false);
  }
});

test("읽음 요청 본문은 서버가 받는 두 모양만 만든다", () => {
  assert.deepEqual(buildMarkReadBody("all"), { all: true });
  assert.deepEqual(buildMarkReadBody([APPLIED.id]), { ids: [APPLIED.id] });
  assert.deepEqual(buildMarkReadBody([APPLIED.id, APPLIED.id]), { ids: [APPLIED.id] });
  assert.equal(buildMarkReadBody([]), null);
  assert.equal(buildMarkReadBody(["not-a-uuid"]), null);
  assert.equal(buildMarkReadBody(new Array(51).fill(APPLIED.id)), null);
});

// 서버는 봉투에 ownerId 를 실어 보내고 웹(useNotifications)은 그것을 세션 사용자와
// 대조한다 — 회귀 테스트로 고정돼 있다. 모바일만 그 대조가 비어 있었다.
// 컴포넌트와 같은 순서로 쓴다: 응답을 파싱한 뒤 그 봉투를 넘긴다.
const parsedEnvelope = (rows, ownerId = VIEWER) =>
  parseCoupleChangeNotifications(envelope(rows, ownerId));

test("봉투 주인이 보는 사람과 다르면 한 줄도 그리지 않는다", () => {
  const mine = selectCoupleChangesForViewer(parsedEnvelope([APPLIED, REQUESTED]), VIEWER, 3);
  assert.equal(mine.unreadCount, 2);

  const theirs = selectCoupleChangesForViewer(
    parsedEnvelope([APPLIED, REQUESTED], OTHER), VIEWER, 3,
  );
  assert.deepEqual(theirs, { visible: [], unreadCount: 0, hiddenCount: 0 });
});

test("대소문자가 달라도 같은 사람으로 본다 — 저장소 관례", () => {
  const picked = selectCoupleChangesForViewer(
    parsedEnvelope([APPLIED], VIEWER.toUpperCase()),
    VIEWER,
    3,
  );
  assert.equal(picked.unreadCount, 1);
});

test("데모 세션(ownerId null)은 조용히 비운다", () => {
  assert.deepEqual(
    selectCoupleChangesForViewer(parsedEnvelope([APPLIED], null), VIEWER, 3),
    { visible: [], unreadCount: 0, hiddenCount: 0 },
  );
});

test("보는 사람을 모르면 그리지 않는다", () => {
  for (const bad of [null, undefined, "", "not-a-uuid"]) {
    assert.deepEqual(
      selectCoupleChangesForViewer(parsedEnvelope([APPLIED]), bad, 3),
      { visible: [], unreadCount: 0, hiddenCount: 0 },
    );
  }
});

// 파트너가 거절하면 모바일이 침묵하면 안 된다. 첫 판의 EVENT_KINDS 는 처음 만들어진
// 4종 + approval_pending 뿐이라 아래 두 종류를 통째로 버렸다.
test("현재 DB CHECK 의 7종을 모두 읽는다", () => {
  const kinds = [
    "approval_requested",
    "approval_pending",
    "approval_ready",
    "approval_withdrawn",
    "change_applied",
    "change_rejected",
    "change_stale",
  ];
  const rows = kinds.map((kind, index) => ({
    ...APPLIED,
    id: `7c7c7c7c-7c7c-4c7c-8c7c-7c7c7c7c7c${String(index).padStart(2, "0")}`,
    event_kind: kind,
  }));
  const parsed = parseCoupleChangeNotifications(envelope(rows));
  assert.equal(parsed.notifications.length, 7);
});

test("파트너가 거절한 줄이 화면에 남는다", () => {
  const parsed = parseCoupleChangeNotifications(envelope([{
    ...APPLIED,
    event_kind: "change_rejected",
    title: "계획 변경 요청을 반영하지 않았어요",
  }]));
  assert.equal(parsed.notifications.length, 1);
  assert.equal(parsed.notifications[0].title, "계획 변경 요청을 반영하지 않았어요");
});

// 눌러도 화면이 그대로인 줄을 읽음 처리하면 사용자는 무엇을 잃었는지 알 수 없다.
test("라운지를 가리키는 줄은 누를 수 없다", () => {
  const [budget, dash, lounge] = parseCoupleChangeNotifications(envelope([
    { ...APPLIED, href: "/budget" },
    { ...APPLIED, id: REQUESTED.id, href: "/dashboard" },
    { ...APPLIED, id: "8d8d8d8d-8d8d-4d8d-8d8d-8d8d8d8d8d8d", href: "/lounge" },
  ])).notifications;
  assert.equal(canOpenCoupleChange(budget), true);
  assert.equal(canOpenCoupleChange(dash), false);
  assert.equal(canOpenCoupleChange(lounge), false);
  assert.equal(canOpenCoupleChange(null), false);
});
