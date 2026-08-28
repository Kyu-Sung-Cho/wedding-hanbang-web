// 앱이 그리지도 못하는 도구를 "카드로 보인다" 고 서버에 말하지 않는가.
//
// ## 무엇이 있었나 (2026-08-28 감사)
//
// 서버는 도구 결과 뒤에 리마인더를 붙인다:
//
//     [SYSTEM: 이 결과는 프론트엔드에서 인터랙티브 카드/버튼으로 자동 표시됩니다.
//      … 간단한 안내 1~2문장만 작성하세요.]
//
// 그 판정(`UI_RENDERED_TOOLS`)이 **클라이언트를 구분하지 않았다.** 목록에는
// `analyze_quote`·`analyze_contract_readiness`·`simulate_guest_guarantee` 가
// 들어 있는데, 모바일에는 그 카드가 없다(`src/components/chat/` 에는
// `AmoraMediationCard`·`PlaceCards` 둘뿐이다).
//
// 그래서 모바일에서 "스드메 290 견적 받았는데 봐줘" 라고 물으면 모델은 1~2문장만
// 남기고, 정작 누락 항목·확인 질문·협상 문구·계산 결과는 **어디에도 나타나지
// 않는다.** 사용자에게는 제품이 답을 못 하는 것으로 보인다.
//
// ## 고친 방식
//
// 카드 세 개를 React Native 로 포팅하는 것은 약 900줄짜리 기능 개발이다. 대신
// **클라이언트가 자기가 그릴 수 있는 목록을 서버에 알린다.** 카드가 없으면 모델이
// 글로 답하므로 사용자는 답을 받는다. 카드를 만들면 그때 목록에 더한다.
//
// ## 이 검사가 지키는 것
//
// 선언한 목록과 실제로 그리는 것이 어긋나면 같은 사고가 난다 — 선언만 하고 카드를
// 안 만들면 답이 다시 사라진다.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath, URL } from "node:url";

const chat = readFileSync(
  fileURLToPath(new URL("../../app/(tabs)/chat.tsx", import.meta.url)),
  "utf8",
);
const route = readFileSync(
  fileURLToPath(new URL("../../../web/src/app/api/chat/route.ts", import.meta.url)),
  "utf8",
);

/** 앱이 서버에 "그릴 수 있다" 고 선언한 목록. */
function declaredTools() {
  const m = chat.match(/const MOBILE_RENDERED_TOOLS = \[([^\]]*)\]/u);
  assert.ok(m, "선언 목록을 찾지 못했습니다");
  return (m[1].match(/"([^"]+)"/gu) ?? []).map((q) => q.replace(/"/gu, ""));
}

test("선언한 도구를 실제로 그린다", () => {
  // 그리는 자리는 `result.toolName === "..."` 로 걸러낸다. 선언만 하고 그리지
  // 않으면 서버가 "카드로 보인다" 고 믿어 모델이 글을 안 쓴다 — 답이 사라진다.
  for (const tool of declaredTools()) {
    assert.ok(
      chat.includes(`toolName === "${tool}"`),
      `${tool} 을 그리지 않으면서 그린다고 선언했습니다`,
    );
  }
});

test("그리는 도구를 빠짐없이 선언한다", () => {
  // 반대 방향. 그리는데 선언을 안 하면 모델이 카드와 글을 둘 다 낸다(중복).
  const rendered = new Set(
    (chat.match(/toolName === "([a-z_]+)"/gu) ?? [])
      .map((m) => m.replace(/.*"([a-z_]+)".*/u, "$1")),
  );
  const declared = new Set(declaredTools());
  for (const tool of rendered) {
    assert.ok(declared.has(tool), `${tool} 을 그리면서 선언하지 않았습니다`);
  }
});

test("헤더를 실제로 보낸다", () => {
  // 목록만 두고 안 보내면 서버는 지금까지처럼 전부 카드로 본다.
  assert.match(chat, /x-hanbang-rendered-tools/u);
  assert.match(chat, /MOBILE_RENDERED_TOOLS\.join\(","\)/u);
});

test("서버가 그 헤더를 읽고, 없으면 웹 기본을 쓴다", () => {
  assert.match(route, /x-hanbang-rendered-tools/u);
  // 헤더가 없거나 비면 지금까지의 목록 그대로여야 한다 — 웹이 바뀌면 안 된다.
  assert.match(route, /declaredRenderedTools && declaredRenderedTools\.length > 0/u);
  assert.match(route, /: WEB_RENDERED_TOOLS/u);
});

test("클라이언트가 모르는 이름으로 목록을 넓히지 못한다", () => {
  // 헤더는 클라이언트가 보내는 값이다. 걸러내지 않으면 임의 문자열이 들어온다.
  assert.match(route, /WEB_RENDERED_TOOLS as readonly string\[\]\)\.includes\(name\)/u);
});
