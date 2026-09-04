// 아모라가 반영한 변경의 영수증 카드 (2026-09-04).
//
// 소비자 점검: 모바일은 장소 검색 카드만 그리고, 예산·일정·체크리스트 변경의 결과는
// 아모라의 산문에만 있었다. 확인 카드로 승인은 했는데 "됐다"는 표면이 없던 것이다.
// 여기서는 (1) 순수 모델이 웹 ActionCard 와 같은 제목·성공/실패·내부 id 규칙을 지키는지,
// (2) 화면이 그 카드를 실제로 그리고 서버에 "그릴 수 있다"고 알리는지 잰다.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath, URL } from "node:url";
import ts from "typescript";

const sourcePath = fileURLToPath(
  new URL("../components/chat/toolResultCardModel.ts", import.meta.url),
);
const compiled = ts.transpileModule(readFileSync(sourcePath, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
});
const module = { exports: {} };
new Function("module", "exports", compiled.outputText)(module, module.exports);
const { getToolResultCardModel, dedupeToolResultCards, TOOL_RESULT_CARD_TOOLS } = module.exports;

const chatSource = readFileSync(
  fileURLToPath(new URL("../../app/(tabs)/chat.tsx", import.meta.url)),
  "utf8",
);

test("성공한 예산 변경은 제목·반영됨·서버 문장 그대로", () => {
  const model = getToolResultCardModel({
    toolName: "update_budget",
    toolInput: { total_budget: 50000000 },
    toolOutput: { applied: true },
    success: true,
    displayMessage: "총 예산을 5,000만 원으로 바꿨어요.",
  });
  assert.deepEqual(model, {
    toolName: "update_budget",
    title: "예산 변경",
    tone: "success",
    message: "총 예산을 5,000만 원으로 바꿨어요.",
  });
});

test("내부 식별자가 든 실패 문장은 일반 문구로 바뀐다", () => {
  const model = getToolResultCardModel({
    toolName: "update_schedule_event",
    toolInput: { event_id: "evt_dress_tour_20261003" },
    toolOutput: {},
    success: false,
    displayMessage: "evt_dress_tour_20261003 일정을 찾지 못했습니다.",
  });
  assert.equal(model.tone, "failure");
  assert.equal(model.title, "일정 변경");
  assert.doesNotMatch(model.message, /evt_/);
  assert.match(model.message, /수정할 일정을 찾지 못했어요/);

  const uuid = getToolResultCardModel({
    toolName: "toggle_checklist_item",
    toolInput: {},
    toolOutput: {},
    success: false,
    displayMessage: "항목 3f2504e0-4f89-41d3-9a0c-0305e82c3301 을 찾지 못했습니다.",
  });
  assert.doesNotMatch(uuid.message, /3f2504e0/);

  // 입력에 없는 접두 id(act_/evt_…)도 가린다 — 입력 대조만으로는 못 잡는 경우다.
  const prefixed = getToolResultCardModel({
    toolName: "add_amora_action",
    toolInput: {},
    toolOutput: {},
    success: true,
    displayMessage: "act_20260904abcdef 로 저장했어요.",
  });
  assert.doesNotMatch(prefixed.message, /act_/);
  assert.equal(prefixed.message, "요청한 작업을 완료했어요.");
});

test("설명 없는 실패도 한 장은 남고, 설명 없는 성공은 일반 완료 문구", () => {
  const failed = getToolResultCardModel({
    toolName: "add_schedule_event", toolInput: {}, toolOutput: {}, success: false, displayMessage: "",
  });
  assert.equal(failed.tone, "failure");
  assert.match(failed.message, /반영되지 않았어요/);
  const ok = getToolResultCardModel({
    toolName: "add_amora_action", toolInput: {}, toolOutput: {}, success: true, displayMessage: "",
  });
  assert.equal(ok.message, "요청한 작업을 완료했어요.");
});

test("장소 검색과 읽기 도구는 이 카드가 아니다", () => {
  for (const toolName of ["search_nearby_places", "get_wedding_info", "get_budget_summary", "get_market_price"]) {
    assert.equal(getToolResultCardModel({ toolName, toolInput: {}, toolOutput: {}, success: true, displayMessage: "x" }), null, toolName);
  }
});

test("같은 실패의 반복은 한 장으로 접힌다", () => {
  const one = getToolResultCardModel({
    toolName: "toggle_checklist_item", toolInput: {}, toolOutput: {}, success: false, displayMessage: "",
  });
  assert.equal(dedupeToolResultCards([one, { ...one }, { ...one }]).length, 1);
});

test("화면이 카드를 그리고 서버에 그릴 수 있는 도구를 알린다", () => {
  assert.match(chatSource, /import \{ ToolResultCard \} from "@\/components\/chat\/ToolResultCard";/);
  assert.match(chatSource, /<ToolResultCard key=\{`\$\{model\.toolName\}-\$\{index\}`\} model=\{model\} \/>/);
  // `MOBILE_RENDERED_TOOLS` 는 chatStream.test.mjs 가 소스에서 리터럴로 뽑아 평가하므로
  // 펼침(spread) 없이 이름을 그대로 적어야 한다. 대신 모델의 목록과 같은지 여기서 잰다.
  const declaration = chatSource.match(/const MOBILE_RENDERED_TOOLS = \[([^\]]*)\] as const;/u)?.[1] ?? "";
  const rendered = [...declaration.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
  assert.deepEqual(rendered, ["search_nearby_places", ...TOOL_RESULT_CARD_TOOLS]);
  for (const name of ["update_budget", "add_schedule_event", "toggle_checklist_item", "add_amora_action"]) {
    assert.ok(TOOL_RESULT_CARD_TOOLS.includes(name), name);
  }
  // 카드가 있는 도구만 알린다 — 없는 도구를 알리면 서버가 글을 생략해 화면이 빈다.
  assert.ok(!rendered.includes("get_budget_summary"));
});
