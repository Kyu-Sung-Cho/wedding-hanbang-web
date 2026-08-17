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
