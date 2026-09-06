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
  assert.match(scheduleSource, /일정 취소 요청/);
  assert.match(scheduleSource, /승인 전 기존 일정 유지/);
  assert.match(scheduleSource, /취소됨/);
  assert.match(scheduleSource, /복원 요청/);
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

test("mobile dashboard derives today's tasks only from active schedule events", () => {
  assert.match(dashboardSource, /import \{ isActiveScheduleEvent \}/);
  assert.match(
    dashboardSource,
    /Array\.isArray\(progress\.__events\)/,
  );
  assert.match(
    dashboardSource,
    /\.filter\(\(event\) => isActiveScheduleEvent\(event\) && event\.date === todayKey\)/,
  );
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
