import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath, URL } from "node:url";
import ts from "typescript";

/**
 * 라운지의 「기본 확인 시점」 목록이 체크리스트 화면과 같은 **항목 단위** 시점을 쓰는가.
 *
 * 2026-09-15: 체크리스트 화면은 공유 헬퍼 `getChecklistCategoryDueDday` 로 **아직 안 끝낸 항목 중
 * 가장 이른 시점**을 셌는데(`checklistWeeklyActions.ts`), 라운지는 여전히 분야의 `ddayDeadline`
 * 하나로 뺐다. 드레스를 제때 고르고 "결혼식 전 최종으로 입어 보기"·"빌린 옷 돌려주기"만 남긴 커플이
 * 체크리스트 화면에서는 지남이 아닌데 라운지에서는 "기본 확인 시점에서 20일 지남"을 봤다.
 *
 * 화면 파일에서 실제 `calcUrgentTasks` 를 떼어 공유 소스와 함께 돌린다.
 */
function loadModule(relative, deps = {}) {
  const path = fileURLToPath(new URL(relative, import.meta.url));
  const compiled = ts.transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const module = { exports: {} };
  new Function("exports", "module", "require", compiled.outputText)(
    module.exports,
    module,
    (specifier) => {
      if (Object.hasOwn(deps, specifier)) return deps[specifier];
      throw new Error(`unexpected dependency: ${specifier}`);
    },
  );
  return module.exports;
}

const SHARED = "../../../../packages/shared/src/";
const due = loadModule(`${SHARED}utils/checklistItemDue.ts`);
const planning = loadModule(`${SHARED}utils/planningChecklist.ts`, { "./checklistItemDue": due });
const { CATEGORY_CHECKLISTS, CHECKLIST_MAP } = loadModule(`${SHARED}constants/weddingPlanning.ts`);

const loungeSource = readFileSync(new URL("../../app/(tabs)/lounge.tsx", import.meta.url), "utf8");
const loungeTree = ts.createSourceFile("lounge.tsx", loungeSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let calcUrgentTasksText;
ts.forEachChild(loungeTree, (node) => {
  if (ts.isFunctionDeclaration(node) && node.name?.text === "calcUrgentTasks") calcUrgentTasksText = node.getText(loungeTree);
});
assert.ok(calcUrgentTasksText, "lounge.tsx 에 calcUrgentTasks 가 있어야 한다");
const calcUrgentTasks = new Function(
  "CATEGORY_CHECKLISTS", "resolvePlanningChecklistStatus", "mergePlanningChecklist", "getChecklistCategoryDueDday",
  `${ts.transpileModule(calcUrgentTasksText, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText}\nreturn calcUrgentTasks;`,
)(CATEGORY_CHECKLISTS, planning.resolvePlanningChecklistStatus, planning.mergePlanningChecklist, due.getChecklistCategoryDueDday);

/** 이 id 들만 남기고 나머지를 끝낸 저장 모양(라운지가 읽는 `progress[분야]`). */
function progressWithOnly(categoryKey, leftIds) {
  const template = CHECKLIST_MAP[categoryKey];
  for (const id of leftIds) assert.ok(template.items.some((item) => item.id === id), `${categoryKey}에 ${id}가 없다`);
  return {
    status: "in_progress",
    checklist: template.items.map((item) => ({ id: item.id, done: !leftIds.includes(item.id) })),
  };
}

/** 나머지 분야는 전부 "안 해요" 로 둬서 이 분야만 본다. */
function onlyCategory(categoryKey, progress) {
  return Object.fromEntries(CATEGORY_CHECKLISTS.map((template) => [
    template.key,
    template.key === categoryKey ? progress : { status: "not_applicable" },
  ]));
}

const itemDue = (categoryKey, id) => CHECKLIST_MAP[categoryKey].items.find((item) => item.id === id).due;

test("최종으로 입어 보기만 남은 드레스 분야는 결혼식 100일 전 라운지에서 지남이 아니다", () => {
  const dress = CHECKLIST_MAP.dress;
  const dday = 100;
  assert.ok(dday < dress.ddayDeadline, "예전 규칙이면 지남으로 뜨는 날이어야 이 검사가 뜻이 있다");
  assert.equal(typeof itemDue("dress", "dress_08"), "number");

  const [task] = calcUrgentTasks(dday, onlyCategory("dress", progressWithOnly("dress", ["dress_08", "dress_09"])));
  assert.equal(task.categoryKey, "dress");
  assert.notEqual(task.urgency, "overdue");
  assert.equal(task.ddayDeadline, itemDue("dress", "dress_08"));
  assert.equal(task.remainingDays, dday - itemDue("dress", "dress_08"));
});

test("계약으로 날을 정하는 반납만 남으면 라운지 목록에서 뺀다", () => {
  assert.equal(itemDue("dress", "dress_09"), due.CHECKLIST_AGREED_DATE);
  assert.deepEqual(calcUrgentTasks(30, onlyCategory("dress", progressWithOnly("dress", ["dress_09"]))), []);
});

test("이른 항목이 남아 있으면 예전과 같이 분야 시점으로 지남을 말한다", () => {
  const dress = CHECKLIST_MAP.dress;
  const dday = dress.ddayDeadline - 20;
  const [task] = calcUrgentTasks(dday, onlyCategory("dress", progressWithOnly("dress", ["dress_01", "dress_08"])));
  assert.equal(task.urgency, "overdue");
  assert.equal(task.remainingDays, -20);
  assert.equal(task.ddayDeadline, dress.ddayDeadline);
});

test("기록이 없는 분야는 예전과 같은 날이다", () => {
  for (const template of CATEGORY_CHECKLISTS) {
    const dday = Math.min(template.ddayStart, template.ddayDeadline + 10);
    if (dday <= 0) continue;
    const tasks = calcUrgentTasks(dday, onlyCategory(template.key, undefined));
    assert.equal(tasks.length, 1, template.key);
    assert.equal(tasks[0].remainingDays, dday - template.ddayDeadline, template.key);
  }
});

test("옛 플랫 불리언 기록도 템플릿과 합쳐 항목 시점으로 센다", () => {
  const dress = CHECKLIST_MAP.dress;
  const flat = Object.fromEntries(dress.items.map((item) => [item.id, item.id !== "dress_08" && item.id !== "dress_09"]));
  const [task] = calcUrgentTasks(100, onlyCategory("dress", flat));
  assert.notEqual(task.urgency, "overdue");
  assert.equal(task.remainingDays, 100 - itemDue("dress", "dress_08"));
});
