import { describe, expect, it } from "vitest";
import { hasAmoraSafetySignal } from "@/lib/ai/amoraQuestionScope";
import { classifyAmoraQuestionScope } from "@/lib/ai/amoraQuestionScope";

/**
 * 통제를 털어놓은 말이 통제하는 사람에게 가면 안 된다.
 *
 * 2026-08-23 라이브 실측: 강압 통제 서술 11건이 전부 `visibility: shared` 로
 * 저장돼 상대가 읽을 수 있었다. `hasAmoraSafetySignal` 이 그 게이트인데
 * 중재 요청에서만 강압 어휘를 봤기 때문이다.
 *
 * 이 파일은 두 가지를 함께 고정한다 — 보호가 실제로 걸리는지, 그리고 그 대가로
 * 평범한 대화가 비공개로 새지 않는지. 둘 중 하나만 보면 반대쪽이 무너진다.
 */

const 통제_서술 = [
  "예비신랑이 제 월급을 자기가 관리하겠다고 카드를 다 가져갔어요",
  "결혼 준비하면서 친구들 만나지 말라고 해서 요즘 아무도 못 만나요",
  "제 휴대폰을 매일 확인해요. 누구랑 연락했는지 다 봐요",
];

// 같은 어휘를 **무해하게** 쓰는 문장. 쉬운 반례만 쓰면 오탐을 못 본다.
const 평범한_대화 = [
  "신랑 월급 관리는 신랑이 하고 제 월급은 제가 관리해요",
  "생활비 카드를 하나로 합칠까 하는데 어떻게들 하세요",
  "예단비는 어머니가 관리해 주시기로 했어요",
  "코로나 때문에 친구들을 못 만난 지 오래됐어요",
  "청첩장 돌릴 때 친구들 다 만나야 하나요? 시간이 없어서요",
  "혼주 화장 예약을 제가 다 확인했어요",
  "예산을 초과할까 봐 지출을 매일 확인하고 있어요",
  "스케줄을 서로 공유해서 어디 있는지 다 알아요",
  "시댁에 가는 날짜를 미리 보고드리기로 했어요",
  "저희는 싸우면 서로 며칠 말을 안 하는 스타일이에요",
  "혼수 얘기하다가 어머니가 목소리를 높이셨어요",
  "제가 반대해도 신랑이 자기 의견을 밀어붙일 때가 있어요",
  "통장을 합치는 게 좋을지 따로 두는 게 좋을지 모르겠어요",
  "직장을 그만두고 결혼 준비에 집중할까 고민이에요",
  "예산은 신랑이 관리하기로 했어요",
];

describe("강압 통제 서술은 공유 레인에 남지 않는다", () => {
  it("일반 대화에서도 보호가 걸린다", () => {
    for (const text of 통제_서술) {
      expect(hasAmoraSafetySignal(text, "chat"), `보호가 안 걸린다: ${text}`).toBe(true);
    }
  });

  it("중재에서도 그대로 걸린다", () => {
    for (const text of 통제_서술) {
      expect(hasAmoraSafetySignal(text, "mediation")).toBe(true);
    }
  });

  it("평범한 결혼 대화는 비공개로 새지 않는다", () => {
    const 샌것 = 평범한_대화.filter((t) => hasAmoraSafetySignal(t, "chat"));
    expect(샌것, `평범한 대화가 비공개로 샌다: ${샌것.join(" / ")}`).toEqual([]);
  });

  // 이 변경은 **가시성만** 바꾼다. 질문 범위가 함께 바뀌면 도구가 막혀
  // "제품 실패" 가 된다 — 원 주석이 정확히 그것을 걱정했다.
  it("질문 범위는 건드리지 않는다 — 도구가 막히면 안 된다", () => {
    for (const text of 통제_서술) {
      const scope = classifyAmoraQuestionScope({ userText: text, requestKind: "chat" }).scope;
      expect(scope, `대화 범위가 고위험으로 떨어졌다: ${text}`).not.toBe("W2_high_risk_adjacent");
    }
  });
});
