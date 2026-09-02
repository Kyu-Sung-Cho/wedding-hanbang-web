import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

/**
 * **안 누른 확인 카드가 영원히 따라다니지 않는다.**
 *
 * 2026-09-02 운영 실측 — 카드 하나가 **무관한 답변 8개를 43분간** 따라다녔다.
 * 이월 자체는 옳다(화면이 최신 메시지의 카드만 누를 수 있게 하므로, 안 옮기면
 * 아모라가 "이대로 적용을 누르세요" 라고 하는데 버튼은 잠겨 있다). 문제는
 * **끝이 없었다**는 것이다. 상한도 범위 관문도 없었다.
 *
 * 그래서 두 가지를 얹었다:
 *   1. 결혼 이야기(W0/W1)일 때만 옮긴다 — 안전·위로 대화 턴에 "예산 5,500만원으로
 *      바꿀까요?" 가 따라오면 안 된다
 *   2. 연속 2턴까지
 *
 * 어느 쪽으로 멈추든 카드는 **원본 메시지에 그대로 남는다.** 사라지지 않는다.
 *
 * 이 검사는 소스 구조를 본다 — 라우트 통합 실행은 무겁고, 여기서 지키려는 것은
 * "관문이 존재하는가" 이기 때문이다. 관문의 **값**이 맞는지는 아래 세 번째
 * 검사가 조건식을 직접 읽어 확인한다.
 */
const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const ROUTE = readFileSync(
  join(ROOT, "apps", "web", "src", "app", "api", "chat", "route.ts"),
  "utf8",
);

test("이월에 관문이 걸려 있다", () => {
  assert.match(
    ROUTE,
    /: awaitingPendingCard && shouldCarryPendingCard/,
    "이월이 무조건 일어난다 — 관문이 사라졌다",
  );
});

test("관문이 범위와 횟수를 둘 다 본다", () => {
  const block = ROUTE.slice(
    ROUTE.indexOf("const shouldCarryPendingCard"),
    ROUTE.indexOf(";", ROUTE.indexOf("const shouldCarryPendingCard")),
  );
  assert.ok(block.length > 0, "shouldCarryPendingCard 가 없다");
  // 범위: 결혼 이야기일 때만
  assert.match(block, /W0_wedding_core/, "범위 관문이 없다");
  assert.match(block, /W1_wedding_adjacent/, "W1 이 빠졌다");
  // 횟수: 상한 비교
  assert.match(block, /nextPendingCardCarries <= MAX_PENDING_CARD_CARRIES/, "횟수 상한이 없다");
  // **안전 범위를 허용 목록에 넣지 않는다.** 넣으면 위로·안전 대화에 결혼
  // 카드가 붙는다 — 이 검사가 지키려는 바로 그 일이다.
  for (const scope of ["W2_high_risk_adjacent", "W3_social_care", "W5_safety_override"]) {
    assert.ok(!block.includes(scope), `${scope} 가 이월 허용 목록에 들어갔다`);
  }
});

test("상한이 실제 숫자로 박혀 있고 무한이 아니다", () => {
  const m = /const MAX_PENDING_CARD_CARRIES = (\d+);/.exec(ROUTE);
  assert.ok(m, "MAX_PENDING_CARD_CARRIES 가 없다");
  const limit = Number(m[1]);
  assert.ok(limit >= 1, "상한이 0이면 이월이 아예 안 돼 버튼이 잠긴다");
  assert.ok(limit <= 3, `상한이 ${limit} 이다 — 카드가 대화를 따라다닌다`);
});

test("옮길 때 횟수를 함께 적는다 — 안 적으면 영원히 0이라 상한이 무의미하다", () => {
  assert.match(
    ROUTE,
    /pending_amora_action_carry_count: nextPendingCardCarries/,
    "이월 metadata 에 횟수를 안 넣는다",
  );
  // **읽는 문자열이 있는 것만으로는 부족하다.** 삼항의 참 갈래를 0 으로
  // 바꿔 놓아도 그 문자열은 조건부에 남아 있어 통과했다(도구가 잡았다).
  // 그래서 **대입식 전체**를 꺼내 참 갈래가 실제로 직전 값을 쓰는지 본다.
  const carriesExpr = ROUTE.slice(
    ROUTE.indexOf("const previousPendingCardCarries"),
    ROUTE.indexOf(";", ROUTE.indexOf("const previousPendingCardCarries")),
  );
  assert.ok(carriesExpr.length > 0, "previousPendingCardCarries 가 없다");
  assert.match(
    carriesExpr,
    /\?\s*previousCanonicalRow\.metadata\.pending_amora_action_carry_count\s*:\s*0/,
    "참 갈래가 직전 값을 쓰지 않는다 — 매번 0에서 시작해 상한에 영원히 안 닿는다",
  );
  assert.match(
    ROUTE,
    /const nextPendingCardCarries = previousPendingCardCarries \+ 1;/,
    "다음 횟수를 직전 값에서 세지 않는다",
  );
});
