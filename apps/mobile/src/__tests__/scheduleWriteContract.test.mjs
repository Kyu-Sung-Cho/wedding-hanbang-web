import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { URL } from "node:url";

const scheduleSource = readFileSync(
  new URL("../../app/schedule/index.tsx", import.meta.url),
  "utf8",
);
const dashboardSource = readFileSync(
  new URL("../../app/(tabs)/dashboard.tsx", import.meta.url),
  "utf8",
);
const apiSource = readFileSync(
  new URL("../lib/api.ts", import.meta.url),
  "utf8",
);

test("mobile schedule writes use the server CAS revision contract", () => {
  assert.match(scheduleSource, /\.select\(["']progress, state_revision["']\)/);
  assert.match(scheduleSource, /isWritableJourneyRevision\(journey\.state_revision\)/);
  assert.match(
    scheduleSource,
    /buildScheduleProgressPatch\(expectedCoupleId,\s*expectedRevision,\s*updatedEvents\)/,
  );
  assert.match(scheduleSource, /PLAN_CHANGE_STALE/);
});

test("mobile schedule lets the user explicitly opt into a supported Amora care moment", () => {
  assert.match(scheduleSource, /SCHEDULE_CARE_MOMENT_OPTIONS/);
  assert.match(scheduleSource, /const \[formMomentType, setFormMomentType\] = useState\(""\)/);
  assert.match(scheduleSource, /setFormMomentType\(evt\.momentType \?\? ""\)/);
  assert.match(
    scheduleSource,
    /validateScheduleEventDraft\(\{[\s\S]*?momentType:\s*formMomentType,[\s\S]*?\}\)/,
  );
  assert.match(
    scheduleSource,
    /const newEvent:[\s\S]*?\.\.\.draftValidation\.value/,
  );
  assert.match(
    scheduleSource,
    /momentType:\s*draftValidation\.value\.momentType/,
  );
  assert.match(scheduleSource, /아모라가 챙길 중요한 날 \(선택\)/);
  assert.match(scheduleSource, /선택하면 일정 전후에 아모라가 준비물과 안부를 챙겨드릴 수 있어요/);
  assert.match(scheduleSource, /accessibilityRole="radio"/);
  assert.match(scheduleSource, /accessibilityRole="radiogroup"/);
  assert.match(scheduleSource, /기타 일정 · 기존 설정 유지/);
  assert.match(scheduleSource, /chip:\s*\{[\s\S]*?minHeight:\s*44/);
});

test("mobile schedule displays friendly category labels but persists canonical checklist keys", () => {
  assert.match(
    scheduleSource,
    /CATEGORY_CHECKLISTS\.map\(\(category\)\s*=>\s*\(\{\s*key:\s*category\.key,\s*label:\s*category\.label,\s*\}\)\)/,
  );
  assert.match(scheduleSource, /key=\{category\.key\}/);
  assert.match(scheduleSource, /formCategoryKey === category\.key/);
  assert.match(scheduleSource, /setFormCategoryKey\(category\.key\)/);
  assert.match(scheduleSource, /\{category\.label\}/);
  assert.doesNotMatch(
    scheduleSource,
    /CATEGORY_CHECKLISTS\.map\(\(category\)\s*=>\s*category\.label\)/,
  );
});

test("editing a legacy label-backed schedule upgrades it to the same canonical category key", () => {
  assert.match(
    scheduleSource,
    /function canonicalScheduleCategoryKey\(value: string\)[\s\S]*?option\.key === value \|\| option\.label === value[\s\S]*?return option\?\.key \?\? value/,
  );
  assert.match(
    scheduleSource,
    /setFormCategoryKey\(canonicalScheduleCategoryKey\(evt\.categoryKey \?\? ""\)\)/,
  );
});

test("an Amora care moment selects and persists its canonical checklist category", () => {
  assert.match(scheduleSource, /getCanonicalCategoryKeyForMoment/);
  assert.match(
    scheduleSource,
    /function selectCareMoment\(momentType: string\)[\s\S]*?setFormMomentType\(momentType\)[\s\S]*?getCanonicalCategoryKeyForMoment\(momentType\)[\s\S]*?setFormCategoryKey\(categoryKey\)/,
  );
  assert.match(
    scheduleSource,
    /const canonicalMomentCategoryKey = getCanonicalCategoryKeyForMoment\(formMomentType\)/,
  );
  assert.match(
    scheduleSource,
    /categoryKey:\s*canonicalMomentCategoryKey \?\? formCategoryKey/,
  );
  assert.match(
    scheduleSource,
    /outcome\.status === "applied"[\s\S]*?CATEGORY_CHECKLISTS\.some\(\(category\) => category\.key === appliedCategoryKey\)[\s\S]*?setExpandedKey\(appliedCategoryKey\)/,
  );
});

test("stored canonical category keys are rendered with human labels", () => {
  assert.match(
    scheduleSource,
    /function scheduleCategoryLabel\(value: string\)[\s\S]*?option\?\.label \?\? value/,
  );
  assert.match(scheduleSource, /\{scheduleCategoryLabel\(evt\.categoryKey\)\}/);
  assert.doesNotMatch(scheduleSource, /\{evt\.categoryKey\}<\/Text>/);
});

test("mobile persists append-only event order and sorts only display copies", () => {
  assert.doesNotMatch(scheduleSource, /updatedEvents\.sort\(/);
  assert.match(
    scheduleSource,
    /const orderedActiveEvents = \[\.\.\.activeEvents\]\.sort\(/,
  );
  assert.match(scheduleSource, /orderedActiveEvents\.map\(\(evt\) =>/);
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
