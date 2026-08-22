// 근거 표식이 사용자에게 **글자 그대로** 보이면 안 된다.
//
// 2026-08-22 스테이징 실측: "축의금 보통 얼마 내?" 에 아모라가 정확히 답하고 끝에
// `[etiquette:9]` 를 붙였다. 웹은 그 태그를 안내 카드로 바꾸는데 모바일은 `{item.content}`
// 를 그대로 그려서 사용자가 `[etiquette:9]` 를 읽는다. 근거를 대라고 만든 표식이
// 깨진 텍스트로 보이는 것이고, 모바일이 소비자의 주 제품이라 이쪽이 더 나쁘다.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import {
  parseAmoraCitations,
  describeAmoraCitations,
} from "../lib/amoraCitations.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const chat = readFileSync(join(here, "../../app/(tabs)/chat.tsx"), "utf8");

test("실제로 받은 답변에서 태그가 사라지고 근거만 남는다", () => {
  const live =
    "친구 축의금은 정해진 정답이나 법정 기준이 없어요. 가까운 친구들이 실제로 내는"
    + " 금액대를 먼저 확인하고 그 흐름에 맞추는 것이 가장 무난해요. [etiquette:9]";
  const { text, parts } = parseAmoraCitations(live);
  assert.doesNotMatch(text, /etiquette/i, "표식이 본문에 남았다");
  assert.doesNotMatch(text, /\[\s*\]/u, "빈 대괄호가 남았다");
  assert.deepEqual(parts, [9]);
  assert.ok(text.endsWith("가장 무난해요."), `꼬리 공백이 남았다: ${JSON.stringify(text.slice(-24))}`);
});

test("여러 편을 근거로 하면 중복 없이 모은다", () => {
  const { text, parts } = parseAmoraCitations(
    "상견례는 집안마다 달라요. [etiquette:2] 인사 순서도 마찬가지예요. [etiquette:2][etiquette:7]",
  );
  assert.doesNotMatch(text, /etiquette/i);
  assert.deepEqual(parts, [2, 7]);
});

test("모양이 조금 달라도 새지 않는다", () => {
  // 표식이 정확 일치로만 잡히면 공백 하나에 원문이 샌다 — 같은 실수를 아모라의
  // pending_action 표식에서 이미 한 번 했다.
  for (const raw of [
    "본문 [ etiquette : 3 ]",
    "본문 [etiquette: 3]",
    "본문 [ETIQUETTE:3]",
  ]) {
    const { text, parts } = parseAmoraCitations(raw);
    assert.doesNotMatch(text, /etiquette/i, `새어 나왔다: ${raw}`);
    assert.deepEqual(parts, [3], raw);
  }
});

test("안내에 없는 번호는 링크로 세지 않는다", () => {
  const { text, parts } = parseAmoraCitations("본문 [etiquette:0] [etiquette:26] [etiquette:99]");
  assert.doesNotMatch(text, /etiquette/i, "범위를 벗어나도 본문에 남기지 않는다");
  assert.deepEqual(parts, []);
});

test("표식이 없는 답변은 한 글자도 바뀌지 않는다", () => {
  const plain = "예식장 계약 전에 확인할 것들을 정리해 드릴게요.";
  assert.equal(parseAmoraCitations(plain).text, plain);
  assert.deepEqual(parseAmoraCitations(plain).parts, []);
});

test("근거 문구는 편 수를 말한다", () => {
  assert.equal(describeAmoraCitations([]), null);
  assert.equal(describeAmoraCitations([9]), "결혼 예절 안내를 근거로 했어요");
  assert.match(describeAmoraCitations([2, 7]), /2편/u);
});

test("채팅 화면이 본문을 그대로 그리지 않는다", () => {
  assert.match(chat, /parseAmoraCitations/u, "화면이 파서를 쓰지 않는다");
  assert.match(chat, /describeAmoraCitations/u, "근거 문구를 쓰지 않는다");
});
