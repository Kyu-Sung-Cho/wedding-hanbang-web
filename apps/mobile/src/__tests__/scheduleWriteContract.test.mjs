import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { URL } from "node:url";
import ts from "typescript";
import { buildScheduleProgressPatch } from "../lib/scheduleMutation.mjs";

const scheduleSource = readFileSync(
  new URL("../../app/schedule/index.tsx", import.meta.url),
  "utf8",
);
const dashboardSource = readFileSync(
  new URL("../../app/(tabs)/lounge.tsx", import.meta.url),
  "utf8",
);
const apiSource = readFileSync(
  new URL("../lib/api.ts", import.meta.url),
  "utf8",
);

test("every actual checklist and schedule PATCH remains bound to the original couple after membership changes", async () => {
  const sourceFile = ts.createSourceFile("schedule.tsx", scheduleSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const calls = [];
  function visit(node) {
    if (ts.isCallExpression(node) && node.expression.getText(sourceFile) === "apiFetchForExpectedUser"
      && node.arguments[1]?.getText(sourceFile) === '"/api/journey"') calls.push(node.getText(sourceFile));
    ts.forEachChild(node, visit);
  }
  visit(sourceFile); assert.equal(calls.length, 3, "covers the common schedule writer and both checklist writers");
  const owner = "same-user", oldCouple = "old-couple", serverCouple = "new-couple";
  let writes = 0;
  for (const expression of calls) {
    let submitted;
    const send = async (userId, _path, options) => {
      assert.equal(userId, owner); submitted = JSON.parse(options.body);
      if (!submitted.expected_couple_id || submitted.expected_couple_id === serverCouple) writes++;
      return { ok: false, status: 409 };
    };
    const execute = new Function("apiFetchForExpectedUser", "sessionToken", "snapshot", "currentProgress", "categoryKey", "nextCategory", "expectedUserId", "expectedRevision", "updatedEvents", "expectedCoupleId", "buildScheduleProgressPatch", `return ${expression};`);
    await execute(send, { ownerId: owner, coupleId: oldCouple }, { stateRevision: 7 }, { venue: { checklist: [] } }, "venue", { checklist: [] }, owner, 7, [{ id: "evt-test", title: "합성 일정", date: "2027-01-01" }], oldCouple, buildScheduleProgressPatch);
    assert.equal(submitted.expected_revision, 7);
    assert.equal(submitted.expected_couple_id, oldCouple, "equal revisions in a different couple cannot authorize the request");
  }
  assert.equal(writes, 0);
});

test("mobile schedule writes use the server CAS revision contract", () => {
  assert.match(scheduleSource, /\.select\(["']progress, state_revision["']\)/);
  assert.match(scheduleSource, /isWritableJourneyRevision\(journey\.state_revision\)/);
  assert.match(
    scheduleSource,
    /buildScheduleProgressPatch\(expectedRevision,\s*updatedEvents\)/,
  );
  assert.match(scheduleSource, /PLAN_CHANGE_STALE/);
});

test("mobile schedule edit, cancellation, and restore target stable ids rather than array indexes", () => {
  assert.match(scheduleSource, /const \[editingEventId, setEditingEventId\]/);
  assert.match(scheduleSource, /openEditEventModal\(eventId: string\)/);
  assert.match(scheduleSource, /replaceScheduleEventById\(/);
  assert.match(scheduleSource, /cancelScheduleEventById\(/);
  assert.match(scheduleSource, /restoreScheduleEventById\(/);
  assert.match(scheduleSource, /evt\.cancellation\?\.reason/);
  assert.doesNotMatch(scheduleSource, /removeScheduleEventById\(/);
  assert.doesNotMatch(scheduleSource, /Trash2/);
  assert.match(scheduleSource, /일정 취소하기/);
  assert.match(scheduleSource, /승인 전 기존 일정 유지/);
  assert.match(scheduleSource, /취소됨/);
  assert.match(scheduleSource, /복원하기/);
  assert.match(scheduleSource, /restoreBtn:\s*\{[\s\S]*?minHeight:\s*44/);
  assert.match(scheduleSource, /cancelBtn:\s*\{[\s\S]*?minHeight:\s*44/);
  assert.doesNotMatch(scheduleSource, /editingIdx/);
  assert.doesNotMatch(scheduleSource, /filter\(\(_,[\s\u00a0]*i\) => i !==/);
});

test("mobile does not invent transient ids for persisted legacy events", () => {
  assert.equal(
    /id:\s*event\.id\s*\?\?\s*createEventId\(\)/.test(scheduleSource),
    false,
  );
  assert.match(scheduleSource, /key=\{`all-\$\{evt\.id\}`\}/);
  assert.match(scheduleSource, /openEditEventModal\(evt\.id\)/);
});

test("mobile never hides only the malformed subset of a stored schedule", () => {
  assert.match(
    scheduleSource,
    /function readScheduleEventsForDisplay[\s\S]*events\.some\(\(event\) => event === null\)[\s\S]*throw new ScheduleMutationError\("invalid_snapshot"\)/,
  );
  assert.match(scheduleSource, /setScheduleDataError\([\s\S]*"integrity"/);
  assert.match(scheduleSource, /원본은 바꾸지 않았습니다/);
  assert.match(
    scheduleSource,
    /disabled=\{scheduleDataError !== null\}/,
  );
  assert.doesNotMatch(
    scheduleSource,
    /readScheduleEventsForDisplay[\s\S]{0,500}\.filter\(\(event\).*event !== null/,
  );
});

// 2026-11-17 파운더 디자인 아티팩트(원문: 이 디자인 완전 같아야해): 홈은 오늘 일정을 직접 세지 않는다(홈 모델은
// 서버의 `/api/invitation/home`). 취소한 일정이 "오늘 할 일"로 되살아나던 길(이 시험이 막던 것)이 홈에는 없다.
// 홈이 다시 일정 목록을 직접 읽기 시작하면 여기서 빨개져, 위 규칙(살아 있는 일정만)을 다시 걸게 한다.
test("the 11-17 home does not read schedule events itself", () => {
  assert.doesNotMatch(dashboardSource, /progress\.__events|isActiveScheduleEvent/);
  assert.match(dashboardSource, /<InvitationHome\b/);
  // 일정 탭(상담)은 일정에 넣는 것을 서버에 맡긴다. 앱이 일정 목록을 직접 고치지 않는다.
  const consultation = readFileSync(
    new URL("../components/invitationLive/LiveConsultation.tsx", import.meta.url),
    "utf8",
  );
  assert.match(consultation, /liveOwner\.api\.addConsultationToSchedule\(replyId\)/);
  assert.doesNotMatch(consultation, /__events|\/api\/journey/);
});

test("mobile schedule exposes a truthful, refreshable joint-approval inbox without showing internal request ids", () => {
  assert.match(scheduleSource, /fetchScheduleApprovalInbox\(/);
  assert.match(scheduleSource, /actOnScheduleApproval\(/);
  assert.match(scheduleSource, /useFocusEffect\(/);
  assert.match(scheduleSource, /AppState\.addEventListener\(["']change["']/);
  assert.match(scheduleSource, /onRefresh=\{handleRefresh\}/);
  assert.match(scheduleSource, /둘이 확인할 일정 변경/);
  assert.match(scheduleSource, /내 확인 필요/);
  assert.match(scheduleSource, /파트너 확인 대기/);
  assert.match(scheduleSource, /동의하고 반영/);
  assert.match(scheduleSource, /반영하지 않기/);
  assert.match(scheduleSource, /요청 철회/);
  assert.match(scheduleSource, /승인 전에는 기존 일정이 유지돼요/);
  assert.match(scheduleSource, /PLAN_CHANGE_ACTIVE_REQUEST/);
  assert.match(scheduleSource, /먼저 대기 중인 일정 변경 요청/);
  assert.doesNotMatch(scheduleSource, /요청 ID/);
});

test("mobile schedule draws the joint-approval inbox only when a request exists", () => {
  // 2026-08-23 부터 한 사람이 저장하면 바로 반영된다. 대기 목록은 두 사람 확인이 걸린 요청만
  // 싣는데(required_count 2), 그런 요청이 더는 만들어지지 않는다.
  // 예전 조건은 목록을 불러오는 동안과 불러오지 못했을 때에도 이 구역을 그려서, 화면을 열 때마다
  // "다른 사람이 확인하기 전까지 현재 일정에 반영되지 않아요" 라는 틀린 문장이 보였다.
  // 대기 중인 요청이 실제로 있을 때만 그린다. 그때는 구역 안의 문장이 참이다.
  assert.match(
    scheduleSource,
    /\{approvalRequests\.length > 0 && \(\s*<Surface style=\{styles\.approvalSection\}>/,
  );
  assert.doesNotMatch(
    scheduleSource,
    /approvalLoading \|\| approvalError \|\| approvalRequests\.length > 0/,
  );
});

test("mobile schedule cancel and restore say what the button does, not that a request is sent", () => {
  // 취소와 복원은 누르면 바로 반영되고 상대에게는 알림만 간다. "요청" 이라고 쓰면 상대가
  // 승인해 주리라 믿고 누르게 된다. 웹은 2026-10-17 에 같은 말을 걷어냈다
  // (apps/web/src/lib/__tests__/noSilentFailures.test.ts).
  assert.match(scheduleSource, /text: "일정 취소하기"/);
  assert.match(scheduleSource, /text: "복원하기"/);
  assert.match(scheduleSource, /<Text style=\{styles\.restoreBtnText\}>복원하기<\/Text>/);
  assert.match(scheduleSource, /<Text style=\{styles\.cancelBtnText\}>일정 취소<\/Text>/);
  // 웹 가드처럼 주석까지 원문 그대로 읽는다. 옛 말이 주석에 남으면 되살리기 쉽다.
  // 「취소 요청을 보냈어요」와 「복원 요청을 보냈어요」 둘만 남긴다. 두 사람 확인이 실제로 걸린
  // 응답(pending_partner)에서만 뜨는 문장이라 그 상태에서는 참이다.
  assert.doesNotMatch(
    scheduleSource,
    /취소 요청(?!을 보냈어요)|취소를 요청할까요|복원 요청(?!을 보냈어요)/u,
  );
});

test("a later schedule identity load fences every earlier async result", () => {
  assert.match(scheduleSource, /scheduleLoadSequenceRef/);
  assert.match(scheduleSource, /const loadSequence = scheduleLoadSequenceRef\.current \+ 1/);
  assert.match(scheduleSource, /scheduleLoadSequenceRef\.current !== loadSequence/);
  assert.match(scheduleSource, /setEvents\(\[\]\)/);
  assert.match(scheduleSource, /setApprovalRequests\(\[\]\)/);
});

test("auth transitions invalidate every in-flight schedule mutation and approval action", () => {
  assert.match(scheduleSource, /createScheduleSessionFence\(\)/);
  assert.match(scheduleSource, /supabase\.auth\.onAuthStateChange\(/);
  assert.match(scheduleSource, /setTimeout\(\(\) => \{/);
  assert.ok(
    (scheduleSource.match(/isCurrent\(sessionToken\)/g) ?? []).length >= 5,
    "every schedule mutation family must reject stale session results",
  );
  assert.match(scheduleSource, /approvalBusyRef/);
  assert.match(scheduleSource, /approvalBusyRef\.current !== approvalOperationId/);
});

test("schedule requests bind the actual Bearer owner before any mutation network call", () => {
  assert.match(apiSource, /export async function apiFetchForExpectedUser\(/);
  assert.match(apiSource, /initialSession\?\.userId\.toLowerCase\(\) !== expectedUserId\.toLowerCase\(\)/);
  assert.match(scheduleSource, /apiFetchForExpectedUser\(\s*identity\.ownerId/);
  assert.match(scheduleSource, /apiFetchForExpectedUser\(\s*sessionToken\.ownerId/);
  assert.ok(
    (scheduleSource.match(/submitScheduleEvents\(\s*sessionToken\.ownerId/g) ?? []).length >= 3,
    "save, cancel, and restore must bind their starting owner",
  );
  assert.doesNotMatch(scheduleSource, /\bapiFetch\("\/api\/journey"/);
});
