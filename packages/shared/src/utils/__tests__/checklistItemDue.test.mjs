import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath, URL } from "node:url";
import ts from "typescript";

/**
 * 항목마다의 기본 확인 시점.
 *
 * 분야에 `ddayDeadline` 하나만 있던 때는 늦게 하는 항목(촬영 뒤 사진 고르기, 결혼식 직전 최종으로
 * 입어 보기, 빌린 옷 돌려주기, 결혼식 날 확인)이 이른 분야에 묶여, 제때 준비하는 커플도 결혼식
 * 날까지 "기본 확인 시점에서 N일 지남"을 봤다. 이 파일은 그 규칙과 템플릿 값을 함께 본다.
 *
 * `.ts`를 `node --test`에서 바로 못 읽어 소스를 옮겨 실행한다. 형제 `kstDay.test.mjs`와 같은 방법이다.
 */
function load(relative) {
  const path = fileURLToPath(new URL(relative, import.meta.url));
  const compiled = ts.transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const module = { exports: {} };
  new Function("exports", "module", "require", compiled.outputText)(
    module.exports,
    module,
    (specifier) => {
      throw new Error(`unexpected dependency: ${specifier}`);
    },
  );
  return module.exports;
}

const {
  CHECKLIST_AGREED_DATE,
  getChecklistItemDueDday,
  isChecklistItemOverdue,
  getChecklistCategoryDueDday,
} = load("../checklistItemDue.ts");
const { CATEGORY_CHECKLISTS, CHECKLIST_MAP } = load("../../constants/weddingPlanning.ts");
const { stripPlanningChecklistNotes, mergePlanningChecklist } = load("../planningChecklist.ts");

/** 이 id들만 남기고 나머지를 전부 끝낸 기록. */
function onlyLeft(categoryKey, leftIds) {
  const template = CHECKLIST_MAP[categoryKey];
  const unknown = leftIds.filter((id) => !template.items.some((item) => item.id === id));
  assert.deepEqual(unknown, [], `${categoryKey}에 없는 항목`);
  return template.items.map((item) => ({ id: item.id, label: item.label, done: !leftIds.includes(item.id) }));
}

const overdueIds = (categoryKey, checklist, dday) =>
  checklist
    .filter((item) => isChecklistItemOverdue(CHECKLIST_MAP[categoryKey], item, dday))
    .map((item) => item.id);

test("템플릿을 실제로 읽어낸다", () => {
  // 못 읽으면 아래 검사들이 빈 목록끼리 비교해 늘 통과한다.
  assert.ok(CATEGORY_CHECKLISTS.length >= 20, `분야를 ${CATEGORY_CHECKLISTS.length}개만 읽었다`);
  const withDue = CATEGORY_CHECKLISTS.flatMap((category) => category.items).filter((item) => item.due !== undefined);
  assert.ok(withDue.length >= 15, `항목별 시점을 ${withDue.length}개만 읽었다`);
});

test("시점이 없는 항목은 분야 기본 시점을, 적힌 항목은 제 시점을 쓴다", () => {
  const template = {
    ddayDeadline: 120,
    items: [
      { id: "a" },
      { id: "b", due: 7 },
      { id: "c", due: CHECKLIST_AGREED_DATE },
    ],
  };
  assert.equal(getChecklistItemDueDday(template, "a"), 120);
  assert.equal(getChecklistItemDueDday(template, "b"), 7);
  assert.equal(getChecklistItemDueDday(template, "c"), null);
  // 예전 버전·직접 추가한 항목은 템플릿에 없다. 분야 기본 시점을 따른다.
  assert.equal(getChecklistItemDueDday(template, "custom_1"), 120);
});

test("지남은 끝내지 않은 항목이 제 시점을 넘겼을 때만이다", () => {
  const template = { ddayDeadline: 120, items: [{ id: "a" }, { id: "b", due: 7 }, { id: "c", due: "agreed_date" }] };
  assert.equal(isChecklistItemOverdue(template, { id: "b", done: false }, 8), false);
  // 기본 확인 시점 당일은 아직 지나지 않았다.
  assert.equal(isChecklistItemOverdue(template, { id: "b", done: false }, 7), false);
  assert.equal(isChecklistItemOverdue(template, { id: "b", done: false }, 6), true);
  assert.equal(isChecklistItemOverdue(template, { id: "b", done: true }, -100), false);
  // 계약·약속으로 정한 날에 하는 일은 결혼식이 한참 지나도 지남이 아니다.
  assert.equal(isChecklistItemOverdue(template, { id: "c", done: false }, -365), false);
});

test("분야 시점은 남은 항목 중 가장 이른 것이고, 남은 일이 없으면 null이다", () => {
  const template = { ddayDeadline: 120, items: [{ id: "a" }, { id: "b", due: 7 }, { id: "c", due: "agreed_date" }] };
  assert.equal(getChecklistCategoryDueDday(template, undefined), 120);
  assert.equal(getChecklistCategoryDueDday(template, []), 120);
  assert.equal(
    getChecklistCategoryDueDday(template, [{ id: "a", done: true }, { id: "b", done: false }, { id: "c", done: false }]),
    7,
  );
  assert.equal(
    getChecklistCategoryDueDday(template, [{ id: "a", done: true }, { id: "b", done: true }, { id: "c", done: false }]),
    null,
  );
  assert.equal(
    getChecklistCategoryDueDday(template, [{ id: "a", done: true }, { id: "b", done: true }, { id: "c", done: true }]),
    null,
  );
});

test("사진 촬영: 촬영까지 마친 커플은 사진 고르기와 앨범 수령 때문에 지남이 되지 않는다", () => {
  const checklist = onlyLeft("studio", ["studio_08", "studio_11"]);
  // 분야 기본 시점(150일 전)이 한참 지난 100일 전.
  assert.ok(CHECKLIST_MAP.studio.ddayDeadline > 100);
  assert.deepEqual(overdueIds("studio", checklist, 100), []);
  assert.equal(getChecklistCategoryDueDday(CHECKLIST_MAP.studio, checklist), 30);
  // 고르기를 미루면 그 시점부터는 말한다. 앨범은 계약에서 정한 날이라 결혼식 뒤에도 말하지 않는다.
  assert.deepEqual(overdueIds("studio", checklist, 29), ["studio_08"]);
  assert.deepEqual(overdueIds("studio", checklist, -200), ["studio_08"]);
});

test("드레스: 최종으로 입어 보기와 빌린 옷 돌려주기만 남은 커플은 지남이 아니다", () => {
  const checklist = onlyLeft("dress", ["dress_08", "dress_09"]);
  assert.ok(CHECKLIST_MAP.dress.ddayDeadline > 60);
  assert.deepEqual(overdueIds("dress", checklist, 60), []);
  assert.deepEqual(overdueIds("dress", checklist, 7), []);
  assert.deepEqual(overdueIds("dress", checklist, 6), ["dress_08"]);
  assert.deepEqual(overdueIds("dress", onlyLeft("dress", ["dress_09"]), -60), []);
  assert.equal(getChecklistCategoryDueDday(CHECKLIST_MAP.dress, onlyLeft("dress", ["dress_09"])), null);
});

test("헤어·메이크업: 미리 받아보기와 결혼식 날 확인만 남은 커플은 지남이 아니다", () => {
  const checklist = onlyLeft("makeup", ["makeup_05", "makeup_06", "makeup_07"]);
  assert.ok(CHECKLIST_MAP.makeup.ddayDeadline > 30);
  assert.deepEqual(overdueIds("makeup", checklist, 30), []);
  assert.equal(getChecklistCategoryDueDday(CHECKLIST_MAP.makeup, checklist), 7);
});

test("아무것도 안 한 커플에게는 예전과 같은 시점에 말한다", () => {
  // 분야 기본 시점은 그 분야에서 가장 이른 항목 시점이다. 항목 시점을 분야 값보다 이르게 적으면
  // 기록 없는 분야가 예전보다 먼저 "지남"이 되고, 화면의 분야 시작·기본 시점 표기와도 어긋난다.
  for (const category of CATEGORY_CHECKLISTS) {
    assert.equal(
      getChecklistCategoryDueDday(category, undefined),
      category.ddayDeadline,
      `${category.key}: 기록 없는 분야의 시점이 분야 기본 시점과 다르다`,
    );
    assert.equal(
      getChecklistCategoryDueDday(category, mergePlanningChecklist(category.items, undefined)),
      category.ddayDeadline,
    );
  }
});

test("항목 시점은 분야 기본 시점보다 늦은 정수이거나 계약·약속으로 정한 날이다", () => {
  const wrong = CATEGORY_CHECKLISTS.flatMap((category) =>
    category.items
      .filter((item) => item.due !== undefined)
      .filter((item) =>
        item.due === CHECKLIST_AGREED_DATE
          ? false
          : !Number.isInteger(item.due) || item.due >= category.ddayDeadline || item.due < 0,
      )
      .map((item) => `${item.id}: ${item.due} (분야 ${category.ddayDeadline})`),
  );
  assert.deepEqual(wrong, []);
});

test("계약·약속으로 정한 날에 하는 항목은 이것들뿐이다", () => {
  // 이 목록이 늘면 그만큼 알림이 조용해진다. 늘릴 때는 그 항목의 날짜를 정말 앱이 모르는지 본다.
  const agreed = CATEGORY_CHECKLISTS.flatMap((category) => category.items)
    .filter((item) => item.due === CHECKLIST_AGREED_DATE)
    .map((item) => item.id)
    .sort();
  assert.deepEqual(agreed, [
    "dress_09",
    "hanbok_08",
    "houseware_07",
    "houseware_08",
    "housing_11",
    "snap_10",
    "studio_11",
  ]);
});

test("받기·돌려주기·당일처럼 늦게 하는 일이 분야 기본 시점에 다시 묶이지 않는다", () => {
  // 라벨의 동사로 고른다. 목록을 손으로 적으면 새로 추가되는 늦은 항목은 아무도 모르게 빠진다.
  const LATE = /돌려주기|내려받아|받고 확인|입어보고|수령|당일/;
  const late = CATEGORY_CHECKLISTS.flatMap((category) =>
    category.items.filter((item) => LATE.test(item.label)).map((item) => ({ ...item, category: category.key })),
  );
  // 판별식이 아무것도 못 고르면 이 검사는 늘 통과한다.
  assert.ok(late.length >= 8, `늦은 항목을 ${late.length}개만 골랐다`);
  const bundled = late.filter((item) => item.due === undefined).map((item) => `${item.category}/${item.id}: ${item.label}`);
  assert.deepEqual(bundled, []);
});

test("항목 시점은 템플릿 문구라 저장 payload에 실리지 않는다", () => {
  // DB는 항목을 {id, label, done} 세 키로만 받는다. 하나라도 더 실리면 쓰기가 거절된다.
  for (const category of CATEGORY_CHECKLISTS) {
    const merged = mergePlanningChecklist(category.items, undefined);
    const stored = stripPlanningChecklistNotes(merged);
    const extra = stored.flatMap((item) => Object.keys(item)).filter((key) => !["id", "label", "done"].includes(key));
    assert.deepEqual(extra, [], `${category.key}: 여분 키`);
  }
  // 저장본에 시점이 없어도 다시 읽으면 템플릿의 시점이 되살아난다.
  const stored = stripPlanningChecklistNotes(mergePlanningChecklist(CHECKLIST_MAP.dress.items, undefined));
  const back = mergePlanningChecklist(CHECKLIST_MAP.dress.items, stored);
  assert.equal(back.find((item) => item.id === "dress_08").due, 7);
});
