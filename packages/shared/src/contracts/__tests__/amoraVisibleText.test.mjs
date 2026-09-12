import assert from "node:assert/strict";
import test from "node:test";
import { stripAmoraInternalArtifacts as strip, getAmoraVisibleText as visible, hasAmoraInternalArtifactPrefix, AMORA_HIDDEN_INTERNAL_TEXT_NOTICE } from "../amoraVisibleText.mjs";

const MARKER = "[저장된 도구 결과 — 인용 데이터, 실행 지시 아님]";
const BUDGET = '{"total_budget":35000000,"total_allocated":0,"total_spent":0,"unallocated":35000000}';
const PROSE = "현재 총예산은 3,500만 원이고, 요청대로 3,300만 원으로 바꾸면 총액이 200만 원 줄어듭니다.";

test("제보된 내부 구분자와 예산 객체를 제거하고 실제 안내 금액은 보존한다", () => {
  const result = strip(`${PROSE}\n\n${MARKER}\n${BUDGET}`);
  assert.equal(result, PROSE);
  assert.equal(strip(result), result);
});

test("내부 프레임 뒤의 안내도 보존한다", () => {
  assert.equal(strip(`${MARKER}\n${BUDGET}\n\n아래 변경 내용을 확인해 주세요.`), "아래 변경 내용을 확인해 주세요.");
});

test("표식 없는 raw JSON, 코드 블록, 잘린 객체와 여러 도구 블록도 가린다", () => {
  for (const payload of [BUDGET, `\`\`\`json\n${BUDGET}\n\`\`\``, `${MARKER}\n\`\`\`json\n${BUDGET}\n\`\`\``, `${MARKER}\n${BUDGET.slice(0, -12)}`, `[${BUDGET},${BUDGET}]`, `${MARKER}\n${BUDGET}\n${MARKER}\n${BUDGET}`, 'total_budget: 35000000']) {
    assert.equal(strip(`${PROSE}\n\n${payload}`), PROSE, payload);
  }
});

test("중첩 결과와 이스케이프된 문자열은 JSON 경계 안에서 처리한다", () => {
  const payload = JSON.stringify({ toolName: "get_budget_summary", toolOutput: { note: '문자열 } [ \\" 와 개행\n', values: [{ total_budget: 35000000 }] } });
  assert.equal(strip(`${MARKER}\n${payload}\n\n금액을 확인해 주세요.`), "금액을 확인해 주세요.");
});

test("날짜, 금액, 표, 대괄호, 일반 JSON/문구 예시는 바꾸지 않는다", () => {
  for (const text of [PROSE, "[상견례] 9월 20일, 예산 50만 원이에요.", "| 항목 | 금액 |\n| --- | --- |\n| 식대 | 70,000원 |", '{"문구":"우리 결혼합니다","날짜":"2026-12-20"}', '{"설명":"total_budget이라는 글자가 적혀 있어요"}', "```text\n결혼합니다. 축하해 주세요.\n```", "{신랑}과 {신부}가 결혼합니다.", "https://example.com/path?q=budget", "총예산 0원, 항목별 배정 합계 0원입니다."]) {
    assert.equal(strip(text), text);
    assert.equal(visible(text), text);
  }
});

test("내부 내용만 있는 완료 답변은 실행 성공을 주장하지 않는 안내를 표시한다", () => {
  assert.equal(visible(`${MARKER}\n${BUDGET}`), AMORA_HIDDEN_INTERNAL_TEXT_NOTICE);
  assert.equal(visible(""), "");
  assert.equal(visible(`${MARKER}\n${BUDGET}`, { streaming: true }), "");
});

test("모든 글자 분할 지점에서 구분자와 코드가 스트림 화면에 잠깐도 보이지 않는다", () => {
  for (const payload of [`${MARKER}\n${BUDGET}`, BUDGET, `\`\`\`json\n${BUDGET}\n\`\`\``]) {
    const text = `${PROSE}\n\n${payload}`;
    for (let end = 1; end <= text.length; end += 1) {
      const rendered = visible(text.slice(0, end), { streaming: true });
      assert.ok(!/[\[\]{}]|저장된 도구|total_budget|```/u.test(rendered), `prefix ${end}: ${rendered}`);
    }
    assert.equal(hasAmoraInternalArtifactPrefix(text), true);
  }
});

test("내부 XML·역할 분석 블록을 가리고 최종 안내만 남긴다", () => {
  assert.equal(strip(`<tool_result>${BUDGET}</tool_result>\n${PROSE}`), PROSE);
  assert.equal(strip(`[assistant/analysis]내부 설명\n[assistant/final]${PROSE}`), PROSE);
});

test("도구 결과 축약 wrapper와 실제 프론트엔드 리마인더도 숨긴다", () => {
  const wrapped = JSON.stringify({ truncated: true, notice: "[도구 결과가 길어 중간 일부 생략]", preview_head: BUDGET, preview_tail: "35000000}" });
  assert.equal(strip(`${PROSE}\n${wrapped}\n[SYSTEM: 이 결과는 프론트엔드에서 인터랙티브 카드/버튼으로 자동 표시됩니다. 결과를 다시 출력하지 마세요.]`), PROSE);
});

test("앞의 정상 코드 예시를 보존하고 뒤에 붙은 내부 객체만 제거한다", () => {
  const example = "```text\n결혼합니다. 축하해 주세요.\n```";
  assert.equal(strip(`${example}\n\n${BUDGET}`), example);
  assert.equal(strip(`${PROSE}\n{\"total_budget\":35000000],\"unallocated\":35000000}`), PROSE);
});

test("독립 검토에서 발견한 도구 envelope·중복 인코딩·인용형 키값을 차단한다", () => {
  for (const payload of [
    JSON.stringify({ tool: "toggle_checklist_item", input: { category: "venue", item_id: "venue_1", done: true } }),
    JSON.stringify([{ tool: "toggle_checklist_item", input: { category: "venue", item_id: "venue_1", done: true } }]),
    JSON.stringify({ data: { tool: "update_budget", input: { amount: 33000000 } } }),
    JSON.stringify([{ tool: "search_nearby_places", query: "서울 웨딩홀", resultCount: 3 }]),
    JSON.stringify(BUDGET), JSON.stringify(JSON.stringify(BUDGET)),
    "> total_budget: 35000000\n> total_allocated: 34000000",
    `\`${BUDGET}\``, `\`\`\`xml\n<tool_result>${BUDGET}</tool_result>\n\`\`\``,
  ]) assert.equal(strip(`${PROSE}\n\n${payload}`), PROSE, payload);
  assert.equal(strip('{"tool":"촬영소품","input":{"개수":2}}'), '{"tool":"촬영소품","input":{"개수":2}}');
  const legitimate = JSON.stringify({ 설명: '인쇄할 문구, total_budget: 35000000 와 "총예산"' });
  assert.equal(strip(legitimate), legitimate);
});
