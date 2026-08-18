import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { URL } from "node:url";

const notesSource = await readFile(
  new URL("../../app/amora-notes.tsx", import.meta.url),
  "utf8",
).catch(() => "");
const chatSource = await readFile(
  new URL("../../app/(tabs)/chat.tsx", import.meta.url),
  "utf8",
);
const rootLayoutSource = await readFile(
  new URL("../../app/_layout.tsx", import.meta.url),
  "utf8",
);

test("Amora chat exposes one explicit preparation-notes entry without adding a fifth tab", () => {
  assert.match(chatSource, /router\.push\("\/amora-notes" as never\)/u);
  assert.match(chatSource, /accessibilityLabel="우리 준비 노트 열기"/u);
  assert.match(chatSource, />준비 노트<\/Text>/u);
  assert.match(chatSource, /headerLeft: \{ flex: 1, minWidth: 0,/u);
  assert.match(chatSource, /style=\{st\.headerBrandText\}[\s\S]{0,180}numberOfLines=\{1\}/u);
  assert.match(rootLayoutSource, /<Stack\.Screen name="amora-notes"/u);
});

test("the notes screen loads and projects only an exact current owner and couple snapshot", () => {
  assert.match(notesSource, /buildScheduleIdentitySnapshot/u);
  assert.match(notesSource, /loadAmoraPreparationNotesSources\(\{/u);
  assert.match(notesSource, /apiFetchForExpectedUser\(identity\.ownerId, path, options\)/u);
  assert.match(notesSource, /buildAmoraPreparationNotes\(\{/u);
  assert.match(notesSource, /isSameScheduleIdentitySnapshot/u);
  assert.match(notesSource, /\.from\("amora_actions"\)/u);
  assert.match(notesSource, /\.eq\("couple_id", coupleId\)/u);
  assert.match(notesSource, /\.eq\("status", "open"\)/u);
  assert.match(notesSource, /lastVerifiedSnapshotRef/u);
  assert.match(notesSource, /allSourcesUnavailable/u);
  assert.match(notesSource, /새로 확인하지 못해 마지막으로 확인한 기록을 보여드려요/u);
});

test("the notes screen is scan-first, privacy-explicit, and returns to exact source context", () => {
  assert.match(notesSource, /title="우리 준비 노트"/u);
  assert.match(notesSource, /각 기록마다 나만 보기와 함께 보기를 구분해요\./u);
  assert.match(notesSource, /placeholder="상담 내용이나 준비 주제 검색"/u);
  assert.match(notesSource, /value: "all", label: "전체"/u);
  assert.match(notesSource, /value: "owner_private", label: "나만 보기"/u);
  assert.match(notesSource, /value: "couple_shared", label: "함께 보기"/u);
  assert.match(notesSource, /accessibilityLabel="준비 주제 필터"/u);
  assert.match(notesSource, /setTopicFilter\(topic\.key\)/u);
  assert.match(notesSource, /topicMessageRefId: record\.openOriginal\.refId/u);
  assert.match(notesSource, /notesScrollOffsetRef/u);
  assert.match(notesSource, /pendingRestoreOffsetRef/u);
  assert.match(notesSource, /scrollTo\(\{ y: restoreOffset, animated: false \}\)/u);
  assert.match(notesSource, /buildChecklistDeepLinkParams\(\{/u);
  assert.match(notesSource, /LoadingState/u);
  assert.match(notesSource, /EmptyState/u);
  assert.match(notesSource, /일부 기록은 지금 확인하지 못했어요/u);
  assert.match(
    notesSource,
    /view\.state === "partial"[\s\S]{0,80}\? "확인된 기록"[\s\S]{0,80}: `\$\{view\.records\.length\}개`/u,
  );
});

test("question search and load-more keep the last verified snapshot until an exact page is ready", () => {
  assert.match(notesSource, /loadAmoraPreparationNotesMessagePage/u);
  assert.match(notesSource, /messageReferencePages/u);
  assert.match(notesSource, /SEARCH_DEBOUNCE_MS = 350/u);
  assert.match(notesSource, /nextCursor/u);
  assert.match(notesSource, />질문</u);
  assert.match(notesSource, />\s*더 보기\s*</u);
  assert.match(notesSource, /새 검색을 확인하지 못해 이전 결과를 유지했어요/u);
  assert.match(notesSource, /다음 기록을 확인하지 못해 지금까지 확인한 기록을 유지했어요/u);
  assert.match(notesSource, /readCurrentNotesIdentity\(\)[\s\S]{0,500}isSameScheduleIdentitySnapshot/u);
  assert.match(notesSource, /view\.state === "partial" \|\| hasMorePreparationRecords/u);
});

test("verified applied actions join search, pagination, and exact dashboard continuation", () => {
  assert.match(notesSource, /value: "applied_receipt", label: "실제 반영"/u);
  assert.match(notesSource, /validateAmoraPreparationActionReceiptV2PageResponse/u);
  assert.match(notesSource, /AmoraPreparationActionReceiptV2PageResponse/u);
  assert.match(notesSource, /loadAmoraPreparationActionReceiptPage/u);
  assert.match(notesSource, /actionReceiptPages/u);
  assert.match(notesSource, /Promise\.all\(\[[\s\S]{0,800}loadAmoraPreparationNotesMessagePage[\s\S]{0,800}loadAmoraPreparationActionReceiptPage/u);
  assert.match(notesSource, /stageActionReceiptHomeHandoff\(\{/u);
  assert.match(notesSource, /ownerUserId: snapshot\.identity\.ownerId/u);
  assert.match(notesSource, /actionId: record\.openAction\.actionId/u);
  assert.match(notesSource, /pathname: "\/\(tabs\)\/dashboard"/u);
  assert.match(notesSource, /params: \{ actionReceiptHandoff \}/u);
  assert.match(notesSource, /record\.type === "applied_receipt"[\s\S]{0,200}"홈에서 확인"/u);
  assert.match(notesSource, /hasMorePreparationRecords/u);
  assert.match(notesSource, /sources\.actionReceiptReadState === "unavailable"/u);
  assert.doesNotMatch(notesSource, /sourceMessageId|promotionId|privateGrounding/u);
});

test("approved first-use context stays structured, complete at large text, and ordered for assistive technology", () => {
  const rowSource = notesSource.slice(
    notesSource.indexOf("function NotesRecordRow"),
    notesSource.indexOf("export default function AmoraPreparationNotesScreen"),
  );
  const accessibilitySource = rowSource.slice(
    rowSource.indexOf("const accessibilityLabel = ["),
    rowSource.indexOf("].filter(Boolean).join"),
  );

  assert.match(rowSource, /record\.approvedFirstAction/u);
  assert.match(rowSource, />\s*반영 당시 이유\s*</u);
  assert.match(rowSource, />\s*완료 기준\s*</u);
  assert.match(rowSource, /approvedFirstAction\?\.action/u);
  assert.match(rowSource, /approvedFirstAction\.reason/u);
  assert.match(rowSource, /approvedFirstAction\.completionCriterion/u);
  const accessibilityOrder = [
    "record.typeLabel",
    "approvedFirstAction?.action",
    "반영 당시 이유",
    "approvedFirstAction.reason",
    "완료 기준",
    "approvedFirstAction.completionCriterion",
    "topicLabel",
    "record.scopeLabel",
    "formatSavedAt(record.savedAt)",
    "destinationLabel",
  ];
  let previousIndex = -1;
  for (const token of accessibilityOrder) {
    const index = accessibilitySource.indexOf(token);
    assert.ok(index > previousIndex, `${token} must follow the previous accessibility field`);
    previousIndex = index;
  }
  assert.doesNotMatch(
    rowSource,
    /numberOfLines=\{\d+\}[\s\S]{0,180}approvedFirstAction\.(?:action|reason|completionCriterion)/u,
  );
  assert.doesNotMatch(rowSource, /style=\{styles\.recordMeta\} numberOfLines=\{1\}/u);
});

test("verified schedule decisions join search, pagination, and a read-only schedule return", () => {
  assert.match(notesSource, /value: "confirmed_decision", label: "확인한 결정"/u);
  assert.match(notesSource, /validateAmoraPreparationScheduleDecisionPageResponse/u);
  assert.match(notesSource, /loadAmoraPreparationScheduleDecisionPage/u);
  assert.match(notesSource, /scheduleDecisionPages/u);
  assert.match(notesSource, /Promise\.all\(\[[\s\S]{0,1400}loadAmoraPreparationNotesMessagePage[\s\S]{0,1400}loadAmoraPreparationScheduleDecisionPage/u);
  assert.match(notesSource, /record\.type === "confirmed_decision"[\s\S]{0,240}"일정에서 보기"/u);
  assert.match(notesSource, /router\.push\("\/schedule"\)/u);
  assert.match(notesSource, /hasMorePreparationRecords/u);
  assert.match(notesSource, /sources\.scheduleDecisionReadState === "unavailable"/u);
  assert.doesNotMatch(notesSource, /record\.type === "confirmed_decision"[\s\S]{0,400}openEditEventModal/u);
});
