import { describe, expect, it } from "vitest";
import { assessAmoraSafetyText } from "@/lib/ai/amoraCrisisClassifier";
import { classifyAmoraCrisis } from "@/lib/ai/amoraCrisisSafety";
import { classifyAmoraQuestionScope } from "@/lib/ai/amoraQuestionScope";

// 중재 요청의 답은 `visibility: "shared"`로 저장된다(stores/chatStore.ts). 그래서
// 안전 신호가 있는 중재는 모델에 닿기 전에 끝나야 한다. 답의 문구를 안전하게 바꾸는
// 것으로는 못 막는다 — 상대에게 도착하는 것은 문구가 아니라 "파트너가 아모라에게
// 안전 관련해서 뭔가 물었다"는 사실이고, 통제하는 쪽이 그걸 읽으면 되돌릴 수 없다.
//
// 그 문을 닫는 조건이 route.ts와 chatStore.ts에 있고, 두 곳 모두 **탐지기 두 갈래를
// 합쳐서** 판단한다:
//
//   갈래 A — classifyAmoraCrisis / assessAmoraSafetyText  (packages/shared)
//   갈래 B — classifyAmoraQuestionScope(...).highRiskReason === "safety"  (apps/web)
//
// 이 파일은 **B가 A에 포함되지 않는다**는 사실을 고정한다. 겹친다고 생각하고 한쪽을
// 지우면 문이 다시 열리기 때문이다. 실제로 그렇게 열려 있었다 — 아래 문장들은 전부
// B에만 걸렸고, 답이 공유 레인에 저장됐다.
//
// 실제 동작(422로 끝나고 아무것도 저장되지 않는지)은 라우트를 직접 호출하는
// api/chat/__tests__/routeOpenAIContract.test.ts에서 검사한다. 여기서 그것까지 흉내내면
// 수정과 같은 조건을 양쪽에 적어놓고 서로 확인하는 꼴이 된다.

/** 갈래 A. route.ts가 모델 앞에서 중재를 끝내던 원래 두 문. */
function branchA(text: string): boolean {
  if (classifyAmoraCrisis(text)) return true;
  const resolution = assessAmoraSafetyText(text).resolution;
  return resolution === "immediate_crisis" || resolution === "non_immediate_safety";
}

/** 갈래 B. 중재에서만 문턱을 낮춘 질문 범위 분류. */
function branchB(text: string): boolean {
  const scope = classifyAmoraQuestionScope({ userText: text, requestKind: "mediation" });
  return (
    scope.scope === "W5_safety_override"
    || (scope.scope === "W2_high_risk_adjacent" && scope.highRiskReason === "safety")
  );
}

/** B에는 걸리고 A에는 안 걸리던 문장들. 2026-08-07 측정. */
const B_ONLY = [
  "예식장 정하는 걸로 싸웠는데 제 폰을 매일 확인하고 카톡도 다 봐요",
  "헤어지자고 하면 가만 안 둔다고 해요",
  "제 월급을 다 가져가요",
  "가족을 못 만나게 해요",
  "화나면 물건을 던지고 저를 때린 적도 있어요",
  "손찌검을 한 적이 있어요",
  "저를 밀쳐서 넘어진 적 있어요",
  "한 번 때린 뒤로는 안 그런다고 하는데요",
  "목을 조른 적도 있어요",
  "화나면 물건을 집어 던져요",
  "계약금 환불 얘기하다가 저를 때린 적도 있어요",
];

describe("안전 탐지기 두 갈래는 서로를 대신하지 못한다", () => {
  it("B에만 걸리는 문장이 실재한다", () => {
    // 이 목록이 빈다면 두 갈래가 합쳐졌다는 뜻이고, 그때는 route.ts·chatStore.ts에서
    // 한쪽을 지워도 된다. 그전에는 안 된다.
    for (const text of B_ONLY) {
      expect(branchB(text), `B가 못 잡는다: ${text}`).toBe(true);
      expect(branchA(text), `A도 잡는다면 이 문장은 목록에서 빼야 한다: ${text}`).toBe(false);
    }
  });

  it("두 갈래 어느 쪽도 평범한 결혼 갈등을 잡지 않는다", () => {
    // 반대 실패도 실패다. 전부 막으면 중재가 필요한 커플이 중재를 못 받는다.
    for (const text of [
      "스드메 예산을 두고 서로 생각이 너무 달라요",
      "예식 날짜를 두고 양가 어른들 의견이 갈려요",
      "축의금을 각자 부모님께 드릴지 합칠지 의견이 달라요",
      "하객 수를 줄이자는 얘기에 서운해하더라고요",
      "신혼집 위치를 두고 직장 거리 때문에 다퉈요",
    ]) {
      expect(branchA(text), text).toBe(false);
      expect(branchB(text), text).toBe(false);
    }
  });
});
