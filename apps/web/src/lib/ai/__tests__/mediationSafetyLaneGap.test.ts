import { describe, expect, it } from "vitest";
import { assessAmoraSafetyText } from "@/lib/ai/amoraCrisisClassifier";
import { classifyAmoraCrisis } from "@/lib/ai/amoraCrisisSafety";
import { classifyAmoraQuestionScope, hasAmoraSafetySignal } from "@/lib/ai/amoraQuestionScope";
import { planAmoraCrisisDelivery } from "@hanbang/shared/amora-crisis-delivery";

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

/**
 * 신체 폭력 서술. B의 일반 문턱(requestKind "chat")에서도 걸린다 — 즉 중재뿐 아니라
 * 평범한 발화에서도 이 문장들은 공유 레인에서 빠져야 한다.
 */
const B_ONLY_ANY_KIND = [
  "화나면 물건을 던지고 저를 때린 적도 있어요",
  "손찌검을 한 적이 있어요",
  // 2026-09-03: "저를 밀쳐서 넘어진 적 있어요" 를 여기서 뺐다. 지워서가 아니라
  // **A(위기 분류기)도 이제 잡기 때문**이다 — 미탐 135건을 메우면서 `밀쳐서
  // 넘어졌` 형태가 A 에 들어갔다(미는 사람이 명시될 때만). 이 파일의 규칙대로
  // A 가 잡으면 B_ONLY 가 아니다. 나머지 여섯은 여전히 B 에만 걸린다.
  "한 번 때린 뒤로는 안 그런다고 하는데요",
  "목을 조른 적도 있어요",
  // 2026-09-26: "화나면 물건을 집어 던져요" 를 아래 `B_ONLY_BUT_PLANNER_CLOSED` 로 옮겼다.
  "계약금 환불 얘기하다가 저를 때린 적도 있어요",
];

/**
 * 강압적 통제 서술. **중재에서만** 걸린다. 일반 대화에까지 이 문턱을 내리면
 * "예산은 신랑이 관리해요" 같은 평범한 문장이 조용히 비공개로 새고, 그 대가가 더 크다.
 */
const B_ONLY_MEDIATION_ONLY = [
  "예식장 정하는 걸로 싸웠는데 제 폰을 매일 확인하고 카톡도 다 봐요",
  "헤어지자고 하면 가만 안 둔다고 해요",
  "제 월급을 다 가져가요",
  // 2026-09-26: "가족을 못 만나게 해요" 를 아래 `B_ONLY_BUT_PLANNER_CLOSED` 로 옮겼다.
];

/**
 * 2026-09-26: A(위기 분류기)는 여전히 못 잡지만, **전달 계획이 신호 없이도** 공유 레인에서
 * 빼는 문장. 전달 계획에 메시지 전체가 닫힌 어휘인 폭력·통제 서술을 보는 규칙
 * (`partnerViolenceClosedVocabulary.ts`)이 들어왔다 — 앱 사전 판정은 신호를 넘기지 않아서 그
 * 규칙이 전달 계획 안에 있다. "B가 A에 포함되지 않는다" 는 이 문장들에도 여전히 참이므로 첫
 * 검사에는 남기고, "신호 없이는 공유에 남는다" 검사에서만 뺀다(그 검사의 규칙: 신호 없이도
 * 빠지면 그 목록의 문장이 아니다).
 */
const B_ONLY_BUT_PLANNER_CLOSED = [
  "가족을 못 만나게 해요",
  "화나면 물건을 집어 던져요",
];

/** B에는 걸리고 A에는 안 걸리던 문장들. 2026-08-07 측정. */
const B_ONLY = [...B_ONLY_MEDIATION_ONLY, ...B_ONLY_ANY_KIND];

describe("안전 탐지기 두 갈래는 서로를 대신하지 못한다", () => {
  it("B에만 걸리는 문장이 실재한다", () => {
    // 이 목록이 빈다면 두 갈래가 합쳐졌다는 뜻이고, 그때는 route.ts·chatStore.ts에서
    // 한쪽을 지워도 된다. 그전에는 안 된다.
    for (const text of [...B_ONLY, ...B_ONLY_BUT_PLANNER_CLOSED]) {
      expect(branchB(text), `B가 못 잡는다: ${text}`).toBe(true);
      expect(branchA(text), `A도 잡는다면 이 문장은 목록에서 빼야 한다: ${text}`).toBe(false);
    }
  });

  it("전달 계획이 닫은 문장은 신호가 있든 없든 공유 레인에서 빠진다", () => {
    for (const text of B_ONLY_BUT_PLANNER_CLOSED) {
      for (const kind of ["mediation", "chat"] as const) {
        const base = {
          userText: text,
          requestedVisibility: "shared" as const,
          target: "partner" as const,
          senderRole: "bride" as const,
        };
        expect(
          planAmoraCrisisDelivery({
            ...base,
            externalSafetySignal: hasAmoraSafetySignal(text, kind),
          }).effectiveVisibility,
          `${kind}: ${text}`,
        ).toBe("bride_private");
        expect(planAmoraCrisisDelivery(base).effectiveVisibility, `신호 없음: ${text}`)
          .toBe("bride_private");
      }
    }
  });

  it("신호를 넘기면 그 발화는 공유 레인에서 빠지고, 안 넘기면 그대로 남는다", () => {
    // 여기가 이 결함의 실제 결과다. 목(mock) 없이 두 함수를 그대로 붙여서 확인한다.
    // 아래 "신호 없음" 쪽이 고치기 전 상태이고, 그 단언이 이 파일의 실패 재현성이다.
    for (const [kind, corpus] of [
      ["mediation", B_ONLY],
      ["chat", B_ONLY_ANY_KIND],
    ] as const) {
      for (const text of corpus) {
        const base = {
          userText: text,
          requestedVisibility: "shared" as const,
          target: "partner" as const,
          senderRole: "bride" as const,
        };
        expect(
          planAmoraCrisisDelivery({
            ...base,
            externalSafetySignal: hasAmoraSafetySignal(text, kind),
          }).effectiveVisibility,
          `${kind}: ${text}`,
        ).toBe("bride_private");

        expect(
          planAmoraCrisisDelivery(base).effectiveVisibility,
          `${kind}: 신호 없이도 빠진다면 이 문장은 B_ONLY가 아니다 — ${text}`,
        ).toBe("shared");
      }
    }
  });

  it("평범한 발화에 일반 문턱을 걸어도 공유 레인이 유지된다", () => {
    // 반대 실패. 여기가 깨지면 사용자가 공유하려던 말이 조용히 비공개로 간다.
    // 2026-08-07 측정 당시 아래 문장들 오탐 0이었고, 이 어휘를 깨려고 만든 문장
    // (주먹밥·주먹구구식·인파에 밀침·창문을 때리는 빗소리)이 포함돼 있다.
    for (const text of [
      "스드메 예산을 두고 서로 생각이 너무 달라요",
      "예산은 신랑이 관리해요",
      "상견례 때 주먹밥 도시락 어때요?",
      "주먹구구식으로 예산을 잡았더니 어긋나요",
      "지하철에서 사람이 많아서 밀쳐서 넘어졌어요",
      "비가 창문을 때리는 소리에 잠을 못 잤어요",
      "부케를 던지는 순서를 언제로 할까요",
      "목을 조르는 듯한 셔츠 칼라가 불편해요",
    ]) {
      expect(hasAmoraSafetySignal(text, "chat"), text).toBe(false);
      expect(
        planAmoraCrisisDelivery({
          userText: text,
          requestedVisibility: "shared",
          target: "partner",
          senderRole: "bride",
          externalSafetySignal: hasAmoraSafetySignal(text, "chat"),
        }).effectiveVisibility,
        text,
      ).toBe("shared");
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
