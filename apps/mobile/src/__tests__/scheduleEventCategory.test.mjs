import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath, URL } from "node:url";
import ts from "typescript";

/**
 * 일정의 분야 값은 **키**로 저장하고, 화면에는 **한국어 이름**을 보여준다.
 *
 * 2026-09-18까지 앱 일정 입력은 분야를 한국어 이름 그대로(`"결혼식장"`, `"기타"`) 저장했고,
 * 웹은 같은 자리에 키(`"venue"`, `"general"`)를 저장했다. 그래서
 *
 *   - 앱에서 넣은 일정은 웹 일정 화면에서 분야 묶음에 끼지 못했고(키가 아니라서),
 *   - 웹에서 넣은 일정은 앱 임박 일정 목록에 `venue` 같은 키가 그대로 보였다.
 *
 * 이미 한국어 이름으로 저장된 값은 **읽을 때만** 키로 바꾼다(운영 DB는 고치지 않는다 —
 * 2026-09-18 파운더 결정). 취소한 날짜는 UTC 문자열을 잘라 보여줘서 한국 새벽에 취소하면
 * 전날로 보였다.
 */
function compile(relative, deps = {}) {
  const path = fileURLToPath(new URL(relative, import.meta.url));
  const compiled = ts.transpileModule(readFileSync(path, "utf8"), {
    fileName: "module.ts",
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  });
  const module = { exports: {} };
  new Function("exports", "module", "require", compiled.outputText)(module.exports, module, (specifier) => {
    if (Object.hasOwn(deps, specifier)) return deps[specifier];
    throw new Error(`unmocked dependency: ${specifier}`);
  });
  return module.exports;
}

const read = (relative) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

const planning = compile("../../../../packages/shared/src/constants/weddingPlanning.ts");
const kstDay = compile("../../../../packages/shared/src/utils/kstDay.ts");
const category = compile("../../../../packages/shared/src/constants/scheduleEventCategory.ts", {
  "./weddingPlanning": planning,
});
const display = compile("../lib/scheduleEventDisplay.ts", {
  "@hanbang/shared/constants": category,
  "@hanbang/shared/utils": kstDay,
});

const {
  SCHEDULE_EVENT_CATEGORY_LABELS,
  SCHEDULE_EVENT_CATEGORY_OPTIONS,
  scheduleEventCategoryKeyFromStored,
  scheduleEventCategoryLabel,
} = category;
const { PLANNING_CATEGORY_LABELS, CATEGORY_CHECKLISTS } = planning;

const webForm = read("../../../web/src/components/app/schedule/EventFormModal.tsx");
const webContent = read("../../../web/src/components/app/schedule/ScheduleContent.tsx");
const schedule = read("../../app/schedule/index.tsx");

test("고를 수 있는 분야는 웹 일정 입력과 같은 키·이름이다", () => {
  const webGeneral = /\{ key: "general", label: "([^"]+)" \}/.exec(webForm)?.[1];
  assert.ok(webGeneral, "웹 일정 입력의 '일반' 선택지를 찾지 못했다");
  assert.match(webForm, /\.filter\(\(\[key\]\) => key !== "reserve"\)/, "웹이 예비비를 빼는 규칙을 바꿨다면 여기도 다시 맞춰야 한다");

  const expected = [
    { key: "general", label: webGeneral },
    ...Object.entries(PLANNING_CATEGORY_LABELS)
      .filter(([key]) => key !== "reserve")
      .map(([key, label]) => ({ key, label })),
  ];
  assert.deepEqual(SCHEDULE_EVENT_CATEGORY_OPTIONS.map((option) => ({ ...option })), expected);
  assert.ok(!SCHEDULE_EVENT_CATEGORY_OPTIONS.some((option) => option.key === "기타"), "'기타'는 이름이지 키가 아니다");
});

test("목록에 쓰는 이름표는 웹 일정 화면과 같다", () => {
  const block = /const CATEGORY_LABELS: Record<string, string> = \{([\s\S]*?)\};/.exec(webContent)?.[1];
  assert.ok(block, "웹 일정 화면의 분야 이름표를 찾지 못했다");
  assert.match(block, /\.\.\.PLANNING_CATEGORY_LABELS/);
  const extras = Object.fromEntries([...block.matchAll(/(\w+): "([^"]+)"/g)].map((match) => [match[1], match[2]]));
  assert.deepEqual({ ...SCHEDULE_EVENT_CATEGORY_LABELS }, { ...PLANNING_CATEGORY_LABELS, ...extras });
});

test("이미 한국어 이름으로 저장된 분야는 읽을 때 키로 바뀐다", () => {
  // 지금 체크리스트 분야 이름 — 2026-04 이후 앱이 저장해 온 값이다.
  for (const template of CATEGORY_CHECKLISTS) {
    assert.equal(scheduleEventCategoryKeyFromStored(template.label), template.key, template.label);
  }
  // 앱이 저장했던 옛 이름들(2026-04 이전 선택지와 체크리스트 분야의 옛 이름).
  for (const [stored, key] of [
    ["기타", "general"],
    ["예식장", "venue"],
    ["상견례", "meeting"],
    ["드레스/턱시도", "dress"],
    ["예복", "dress"],
    ["예물(반지)", "ring"],
    ["예물", "ring"],
    ["혼수(가전/가구)", "houseware"],
    ["허니문", "honeymoon"],
    ["본식 스냅/영상", "snap"],
    ["영상", "snap"],
    ["사회/축가", "mc"],
    ["축가", "mc"],
    ["웨딩 구두", "shoes"],
    ["부케/꽃장식", "bouquet"],
    ["답례품", "gift"],
    ["예단", "yedan"],
    ["함", "ham"],
    ["폐백", "pyebaek"],
  ]) {
    assert.equal(scheduleEventCategoryKeyFromStored(stored), key, stored);
  }
  // 키는 그대로다.
  for (const key of ["venue", "general", "etiquette"]) {
    assert.equal(scheduleEventCategoryKeyFromStored(key), key);
  }
});

test("어느 분야인지 하나로 정할 수 없는 값은 지어내지 않고 그대로 둔다", () => {
  // 스드메는 사진·드레스·메이크업 세 분야다. 하나로 바꾸면 사용자가 고르지 않은 분야가 된다.
  assert.equal(scheduleEventCategoryKeyFromStored("스드메"), "스드메");
  assert.equal(scheduleEventCategoryLabel("스드메"), "스드메");
  for (const empty of [undefined, null, "", "   ", 3, {}]) {
    assert.equal(scheduleEventCategoryKeyFromStored(empty), undefined);
    assert.equal(scheduleEventCategoryLabel(empty), null);
  }
  // 객체 원형의 이름은 분야가 아니다.
  for (const prototypeKey of ["__proto__", "constructor", "toString"]) {
    assert.equal(scheduleEventCategoryLabel(prototypeKey), null, prototypeKey);
  }
});

test("화면에는 키가 새지 않고 한국어 이름이 보인다", () => {
  assert.equal(scheduleEventCategoryLabel("venue"), "결혼식장");
  assert.equal(scheduleEventCategoryLabel("general"), "일반");
  assert.equal(scheduleEventCategoryLabel("etiquette"), "결혼 예절 참고");
  assert.equal(scheduleEventCategoryLabel("결혼식장"), "결혼식장");
  assert.equal(scheduleEventCategoryLabel("기타"), "일반");
  assert.equal(scheduleEventCategoryLabel("예식장"), "결혼식장");
  // 모르는 키 모양 값은 그대로 보여주지 않는다 — `venue` 가 새던 것과 같은 모양이다.
  for (const unknownKey of ["housewarming", "family", "some_future_key"]) {
    assert.equal(scheduleEventCategoryLabel(unknownKey), null, unknownKey);
  }
});

test("표시용으로 읽은 일정만 분야를 키로 바꾸고 원본은 건드리지 않는다", () => {
  const stored = Object.freeze({ id: "evt_1", date: "2026-10-01", title: "홀 투어", categoryKey: "결혼식장" });
  const shown = display.withScheduleCategoryKey(stored);
  assert.equal(shown.categoryKey, "venue");
  assert.equal(stored.categoryKey, "결혼식장", "읽는 쪽이 저장된 값을 바꾸면 안 된다");
  assert.notEqual(shown, stored);

  const general = display.withScheduleCategoryKey({ id: "evt_2", date: "2026-10-01", title: "모임", categoryKey: "기타" });
  assert.equal(general.categoryKey, "general");

  const none = display.withScheduleCategoryKey({ id: "evt_3", date: "2026-10-01", title: "메모" });
  assert.equal("categoryKey" in none, false, "분야가 없던 일정에 빈 분야를 만들지 않는다");
});

test("취소한 날은 한국 날짜로 보여준다", () => {
  // 한국 2026-08-03 01:30 에 취소 = UTC 로는 전날 16:30. 문자열을 자르면 08-02 가 된다.
  assert.equal(display.kstDateOfInstant("2026-08-02T16:30:00.000Z"), "2026-08-03");
  assert.equal(display.kstDateOfInstant("2026-08-02T12:30:00.000Z"), "2026-08-02");
  assert.equal(display.kstDateOfInstant("2026-08-03T01:30:00+09:00"), "2026-08-03");
  for (const broken of ["", "어제", undefined, null, 1]) {
    assert.equal(display.kstDateOfInstant(broken), null);
  }
});

test("일정 화면이 키를 저장하고 이름을 보여준다", () => {
  // 선택지를 키로 저장한다.
  assert.match(schedule, /SCHEDULE_EVENT_CATEGORY_OPTIONS\.map\(\(option\) =>/);
  assert.match(schedule, /setFormCategoryKey\(option\.key\)/);
  assert.doesNotMatch(schedule, /CATEGORY_CHECKLISTS\.map\(\(category\) => category\.label\)/, "이름 목록을 저장값으로 쓰던 선택지가 남아 있다");
  assert.doesNotMatch(schedule, /setFormCategoryKey\(cat\)/);
  // 표시용 읽기에서만 키로 바꾼다. 쓰기 경로(readScheduleEventsForMutation)는 저장된 값을 그대로 쓴다.
  const displayReader = /function readScheduleEventsForDisplay[\s\S]*?\n}\n/.exec(schedule)?.[0] ?? "";
  const mutationReader = /function readScheduleEventsForMutation[\s\S]*?\n}\n/.exec(schedule)?.[0] ?? "";
  assert.match(displayReader, /withScheduleCategoryKey/);
  assert.doesNotMatch(mutationReader, /withScheduleCategoryKey/, "쓰기 경로가 다른 일정의 분야까지 고쳐 쓰면 DB를 바꾸게 된다");
  // 목록에는 이름을 그린다.
  assert.doesNotMatch(schedule, /\{evt\.categoryKey\}/, "키를 그대로 그리고 있다");
  assert.match(schedule, /scheduleEventCategoryLabel\(evt\.categoryKey\)/);
  // 취소한 날은 한국 날짜다.
  assert.doesNotMatch(schedule, /cancelledAt\.slice\(0, 10\)/);
  assert.match(schedule, /kstDateOfInstant\(evt\.cancellation\?\.cancelledAt\)/);
});
