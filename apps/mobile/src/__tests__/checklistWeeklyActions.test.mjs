import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath, URL } from "node:url";
import ts from "typescript";

/**
 * 모바일 「이번 주 확인 제안」이 웹 임박 알림과 같은 **항목 단위** 기본 확인 시점을 쓰는가.
 *
 * 예전 모바일은 분야의 `ddayDeadline` 하나로 셌다. 드레스 분야(결혼식 120일 전)에서 제때 고르고
 * 계약까지 끝낸 커플이 결혼식 100일 전에 "결혼식 전 최종으로 입어 보기"와 "빌린 옷 돌려주기"만
 * 남겨 두면 "기본 확인 시점에서 20일 지났어요"를 봤다. 웹은 공유 헬퍼로 이미 고쳤다.
 *
 * `.ts` 는 `node --test` 가 바로 못 읽어 소스를 옮겨 실행한다(공유 패키지 테스트와 같은 방법).
 */
function load(relative, deps = {}) {
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
const due = load(`${SHARED}utils/checklistItemDue.ts`);
const { CATEGORY_CHECKLISTS, CHECKLIST_MAP } = load(`${SHARED}constants/weddingPlanning.ts`);
const { buildWeeklyChecklistActions } = load("../lib/checklistWeeklyActions.ts", {
  "@hanbang/shared/utils": due,
});

/** 이 id 들만 남기고 나머지를 끝낸 분야 상태. */
function stateWithOnly(categoryKey, leftIds) {
  const template = CHECKLIST_MAP[categoryKey];
  for (const id of leftIds) assert.ok(template.items.some((item) => item.id === id), `${categoryKey}에 ${id}가 없다`);
  const items = template.items.map((item) => ({ id: item.id, label: item.label, done: !leftIds.includes(item.id) }));
  const done = items.filter((item) => item.done).length;
  return { items, skipped: false, percent: Math.round((done / items.length) * 100) };
}

function actionsFor(states, dday) {
  return buildWeeklyChecklistActions(
    CATEGORY_CHECKLISTS,
    (key) => states[key] ?? { items: [], skipped: true, percent: 0 },
    dday,
    CATEGORY_CHECKLISTS.length,
  );
}

const itemDue = (categoryKey, id) => CHECKLIST_MAP[categoryKey].items.find((item) => item.id === id).due;

test("템플릿과 항목 시점을 실제로 읽는다", () => {
  // 못 읽으면 아래 검사가 빈 목록끼리 비교해 늘 통과한다.
  assert.ok(CATEGORY_CHECKLISTS.length >= 20);
  assert.equal(typeof itemDue("dress", "dress_08"), "number");
  assert.equal(itemDue("dress", "dress_09"), due.CHECKLIST_AGREED_DATE);
});

test("최종으로 입어 보기만 남은 드레스 분야는 결혼식 100일 전에 지남이 아니다", () => {
  const dress = CHECKLIST_MAP.dress;
  const dday = 100;
  assert.ok(dday < dress.ddayDeadline, "예전 규칙이면 지남으로 뜨는 날이어야 이 검사가 뜻이 있다");
  const [action] = actionsFor({ dress: stateWithOnly("dress", ["dress_08", "dress_09"]) }, dday);

  assert.equal(action.categoryKey, "dress");
  assert.notEqual(action.urgency, "overdue");
  assert.equal(action.daysUntilDeadline, dday - itemDue("dress", "dress_08"));
  assert.doesNotMatch(action.deadlineLabel, /지났어요/);
  assert.equal(action.nextItemLabel, dress.items.find((item) => item.id === "dress_08").label);
});

test("계약으로 날을 정하는 반납만 남으면 날짜가 있어도 제안에서 뺀다", () => {
  const actions = actionsFor({ dress: stateWithOnly("dress", ["dress_09"]) }, 30);
  assert.deepEqual(actions, []);
});

test("결혼식 날 헤어·메이크업 확인만 남은 분야는 결혼식 20일 전에 지남이 아니다", () => {
  const late = CHECKLIST_MAP.makeup.items.filter((item) => typeof item.due === "number").map((item) => item.id);
  assert.ok(late.length > 0);
  const [action] = actionsFor({ makeup: stateWithOnly("makeup", late) }, 20);
  assert.equal(action.urgency, "soon");
  assert.equal(action.daysUntilDeadline, 20 - Math.max(...late.map((id) => itemDue("makeup", id))));
});

test("이른 항목이 남아 있으면 예전과 같이 분야 시점으로 지남을 말하고, 그 항목을 다음 할 일로 고른다", () => {
  const dress = CHECKLIST_MAP.dress;
  const dday = dress.ddayDeadline - 20;
  const [action] = actionsFor({ dress: stateWithOnly("dress", ["dress_01", "dress_08"]) }, dday);
  assert.equal(action.urgency, "overdue");
  assert.equal(action.deadlineLabel, "기본 확인 시점에서 20일 지났어요");
  assert.equal(action.nextItemLabel, dress.items.find((item) => item.id === "dress_01").label);
});

test("아무것도 체크하지 않은 분야는 예전과 같은 날·같은 문구다", () => {
  for (const template of CATEGORY_CHECKLISTS) {
    const dday = Math.min(template.ddayStart, template.ddayDeadline + 10);
    if (dday < 0) continue;
    const state = { items: template.items.map((item) => ({ id: item.id, label: item.label, done: false })), skipped: false, percent: 0 };
    const [action] = buildWeeklyChecklistActions([template], () => state, dday);
    assert.equal(action.daysUntilDeadline, dday - template.ddayDeadline, template.key);
    assert.equal(action.nextItemLabel, template.items[0].label, template.key);
  }
});

test("결혼식 날짜가 없으면 날 수를 지어내지 않는다", () => {
  const [action] = actionsFor({ dress: stateWithOnly("dress", ["dress_09"]) }, null);
  assert.equal(action.daysUntilDeadline, null);
  assert.equal(action.deadlineLabel, "결혼식 날짜를 넣으면 기본 확인 순서를 정리해요");
});

test("끈 분야·끝난 분야·결혼식 뒤는 제안하지 않는다", () => {
  const off = { ...stateWithOnly("dress", ["dress_01"]), skipped: true };
  assert.deepEqual(actionsFor({ dress: off }, 100), []);
  assert.deepEqual(actionsFor({ dress: stateWithOnly("dress", []) }, 100), []);
  assert.deepEqual(actionsFor({ dress: stateWithOnly("dress", ["dress_01"]) }, -1), []);
});

test("체크리스트 화면이 이 규칙을 부르고, 분야 값으로 직접 빼지 않는다", () => {
  const schedule = readFileSync(new URL("../../app/schedule/index.tsx", import.meta.url), "utf8");
  assert.match(schedule, /buildWeeklyChecklistActions\(\s*CATEGORY_CHECKLISTS,/);
  assert.doesNotMatch(schedule, /dday - template\.ddayDeadline/);
});
