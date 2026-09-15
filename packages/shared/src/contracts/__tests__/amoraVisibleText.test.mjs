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

test("정상 대괄호는 완성되면 스트리밍을 재개하고 영구 내부 표식으로 판정하지 않는다", () => {
  const text = "[예약 전] [A] 기준이에요. 비율 합계는 100%예요.";
  for (let end = 1; end <= text.length; end += 1) {
    const prefix = text.slice(0, end);
    assert.equal(hasAmoraInternalArtifactPrefix(prefix), false, prefix);
    const unfinished = prefix.lastIndexOf("[") > prefix.lastIndexOf("]");
    const expected = unfinished ? prefix.slice(0, prefix.lastIndexOf("[")) : prefix;
    assert.equal(visible(prefix, { streaming: true }), expected, prefix);
  }
  assert.equal(visible(text, { streaming: true }), text);
});

test("모든 글자 분할 지점에서 구분자와 코드가 스트림 화면에 잠깐도 보이지 않는다", () => {
  for (const payload of [`${MARKER}\n${BUDGET}`, `[${BUDGET}]`, BUDGET, `\`\`\`json\n${BUDGET}\n\`\`\``]) {
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

/** 태그는 조립해서 쓴다. 테스트 원문에 태그를 그대로 두면 편집 도구가 태그로 읽는 일이 있었다. */
const tag = (name, body, attrs = "") => `<${name}${attrs}>${body}</${name}>`;

/** 2026-09-15 감사에서 모든 층을 통과해 저장·표시된 코드 모양 출력. */
const CODE_LIKE_LEAKS = [
  'update_budget({"category":"venue","amount":33000000});',
  'update_budget({\n  "category": "venue",\n  "amount": 33000000\n});',
  'functions.update_category_budget({"category":"venue","budget":33000000})',
  "`get_budget_summary()`",
  '```python\nupdate_budget(category="venue", amount=33000000)\n```',
  '> toggle_checklist_item({"item_id":"venue_1","done":true})',
  tag("tool_call", '{"name":"update_budget","arguments":{"category":"venue","amount":33000000}}'),
  tag("thinking", "사용자는 예식장 예산을 3,300만 원으로 바꾸고 싶어 한다."),
  tag("think", "update_budget를 먼저 부른다"),
  tag("invoke", tag("parameter", "33000000", ' name="amount"'), ' name="update_budget"'),
  tag("antml:invoke", "venue", ' name="update_budget"'),
  "</tool_call>",
  '```json\n{"category_key":"venue","amount":33000000}\n```',
  '```json\n{"name":"update_budget","arguments":{"amount":33000000}}\n```',
  '```json\n{"tool_name":"update_budget","toolInput":{"amount":33000000}}\n```',
  '{"name":"update_budget","arguments":"{\\"category\\":\\"venue\\"}"}',
  '{"type":"function","function":{"name":"update_budget","arguments":"{}"}}',
  "category_key: venue",
  "> event_id: 7f3a",
  '{"tool":"update_budget","input":"{\\"category\\":\\"venue\\",\\"amount\\":33000000}"}',
];

/** 정상 답변 코퍼스. 물결·부등호·중괄호·괄호·표·목록·코드 예시가 한 글자도 바뀌면 안 된다. */
const ORDINARY_ANSWERS = [
  "예식장은 보통 12~18개월 전에 잡는 경우가 많아요.",
  "우선순위는 예식장 > 스드메 > 신혼여행 순으로 보시면 돼요.",
  "식대가 5만 원 < 7만 원이면 보증 인원을 먼저 줄여 보세요.",
  "3,000,000원은 계약금으로 먼저 나가요.",
  "{신랑} 님과 {신부} 님 이름을 넣어 주세요.",
  "| 항목 | 금액 | 시기 |\n| --- | ---: | --- |\n| 예식장 | 3,000만 원 | 12~18개월 전 |\n| 스드메 | 300~400만 원 | 6개월 전 |",
  "- 예식장: 3,000만 원\n- 스드메: 300~400만 원\n- 예비비(10%): 330만 원",
  "1) 답사 2) 계약 3) 잔금 순서예요.",
  "1. 식대\n2. 대관료\n3. 꽃장식\n4. 사회자 사례비",
  "SDM(스튜디오·드레스·메이크업)은 묶어서 계약하는 경우가 많아요.",
  "<예식 당일 챙길 것>\n- 반지\n- 신분증\n- 혼주 꽃",
  "> 계약서 3조(환불)를 꼭 확인해 주세요.",
  'JSON으로 적으면 {"문구":"우리 결혼합니다"} 모양이에요.',
  "D-100(토)까지 청첩장 시안을 받아요.",
  "하객 수 = 보증 인원 × 1.1 정도로 잡아요.",
  "오전 11시(11:00) 예식이면 9시 전에 도착하세요.",
  "wedding_hall 같은 영문 표기는 화면에 쓰지 않아요.",
  "hanbang.ai 에서 확인하실 수 있어요.",
  "ok 사인을 받으면 바로 진행할게요.",
  "Save the date: 2026.12.20 (Sun)",
  "total: 3,000만 원\nname: 김하나",
  "청첩장 문구 예시\n```\n{신랑 이름} ♥ {신부 이름}\n2026년 12월 20일 (일) 오후 1시\n```",
  "~~취소선~~ 대신 괄호로 (보류) 표시해 둘게요.",
  "혼인·출산 증여재산 공제(1억 원)도 함께 확인해 보세요.",
  "A안 > B안이라면 계약금(10%)부터 비교해 보세요.",
  "수식은 =SUM(B2:B10) 으로 넣으면 돼요.",
];

test("코드 모양 도구 호출·사고 태그·내부 키 JSON을 걷어내고 안내 문장만 남긴다", () => {
  for (const payload of CODE_LIKE_LEAKS) {
    assert.equal(strip(`${PROSE}\n\n${payload}`), PROSE, payload);
    assert.equal(strip(`${payload}\n\n${PROSE}`), PROSE, payload);
    assert.equal(visible(`${PROSE}\n\n${payload}`), PROSE, payload);
    assert.equal(visible(payload), AMORA_HIDDEN_INTERNAL_TEXT_NOTICE, payload);
  }
});

test("정상 답변 코퍼스는 한 글자도 바뀌지 않는다", () => {
  for (const text of ORDINARY_ANSWERS) {
    assert.equal(strip(text), text, text);
    assert.equal(visible(text), text, text);
    assert.equal(strip(`${PROSE}\n\n${text}`), `${PROSE}\n\n${text}`, text);
  }
});

test("스트리밍 중 도구 호출 줄은 이름 조각부터 괄호까지 한 번도 보이지 않는다", () => {
  for (const payload of ['update_budget({"category":"venue","amount":33000000});', "functions.get_budget_summary()"]) {
    const text = `${PROSE}\n\n${payload}`;
    for (let end = 1; end <= text.length; end += 1) {
      const rendered = visible(text.slice(0, end), { streaming: true });
      assert.ok(!/[a-z]|[(){}]/u.test(rendered), `prefix ${end}: ${rendered}`);
    }
    assert.equal(hasAmoraInternalArtifactPrefix(text), true);
  }
  // 영문 소문자로 시작한 정상 줄은 줄이 이어지면 다시 보인다.
  assert.equal(visible("ok 사인을 받으면 진행할게요.", { streaming: true }), "ok 사인을 받으면 진행할게요.");
  assert.equal(hasAmoraInternalArtifactPrefix("ok 사인을 받으면 진행할게요."), false);
  assert.equal(hasAmoraInternalArtifactPrefix("SDM(스튜디오·드레스·메이크업)은 묶어서 계약해요."), false);
});
