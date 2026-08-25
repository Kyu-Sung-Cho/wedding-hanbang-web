import { describe, expect, it } from "vitest";

import { buildAmoraSystemPrompt } from "@/lib/ai/amoraPromptComposer";
import {
  buildAmoraQuestionScopeInstruction,
  classifyAmoraQuestionScope,
} from "@/lib/ai/amoraQuestionScope";

/**
 * 폭력 진술에 아모라가 절충안을 권할 근거가 프롬프트 안에 있었다.
 *
 * 판정기는 W2 를 두 갈래로 나눠 놓았다 — 법률·의료·금융(domain)과
 * 폭력·통제·자해(safety). 그런데 **모델에게 가는 문장은 둘이 똑같았고**
 * (`highRiskReason` 은 중재 차단 함수에서만 쓰였다) 안전 이야기는 한 줄도 없었다.
 *
 * 2026-08-25 실측: "남편이 어제 저를 밀쳤어요" → `W2/safety` 로 판정되는데,
 * 전달된 프롬프트에 본문의 "편들지 않기"·"합의안"·"절충" 이 그대로 남아 있었다.
 * 중재 **요청** 경로만 서버가 막고 일반 대화는 막지 않는다.
 *
 * 안전 판정을 느슨하게 만든 것이 아니라, 같은 판정에서 **하지 말아야 할 것**을
 * 분명히 한 것이다.
 */

const CTX = {
  weddingDate: "2027-05-15",
  budget: 62_000_000,
  venue: null,
  progress: {},
  preparationStatus: null,
  brideName: "신부",
  groomName: "신랑",
  bookings: [],
  scheduleEvents: [],
  chatSummaries: [],
  pastConflicts: [],
  pastDecisions: [],
} as never;

// 안전 판정 범위는 좁다 — 경제적 통제("카드를 다 막았어요")도, 물건을 던지는
// 서술도 지금은 W0 으로 떨어진다. 그 탐지를 넓히는 것은 **별개 문제**이고,
// 예전에 시도했을 때 평범한 결혼 문장이 함께 걸렸다는 기록이 있다.
//
// 이 검사는 그 범위를 넓히지 않는다. **이미 안전으로 판정된 턴**에서
// 무엇을 하지 말아야 하는지만 고정한다.
const SAFETY_SAYS = [
  "남편이 어제 저를 밀쳤어요",
];

describe("안전 신호 턴에는 중재를 권하지 않는다", () => {
  it.each(SAFETY_SAYS)("판정이 safety 갈래다: %s", (userText) => {
    const scope = classifyAmoraQuestionScope({ userText });
    expect(scope.scope).toBe("W2_high_risk_adjacent");
    expect(scope.highRiskReason).toBe("safety");
  });

  it.each(SAFETY_SAYS)("지시문이 절충·합의를 금지한다: %s", (userText) => {
    const instruction = buildAmoraQuestionScopeInstruction(
      classifyAmoraQuestionScope({ userText }),
    );
    expect(instruction).toContain("절충안·합의안·역할 분담을 제안하지 말고");
    expect(instruction).toContain("공식 기관");
  });

  it("법률·금융 갈래는 예전 문장 그대로다", () => {
    const instruction = buildAmoraQuestionScopeInstruction(
      classifyAmoraQuestionScope({ userText: "계약금 환불 받을 수 있는지 봐줘" }),
    );
    expect(instruction).toContain("법적 판단, 진단, 처방");
    expect(instruction).not.toContain("절충안·합의안·역할 분담을 제안하지 말고");
  });

  it("본문 중재 섹션이 안전 예외를 먼저 말한다", () => {
    const prompt = buildAmoraSystemPrompt(CTX, {
      enabledToolNames: [],
      requestKind: "chat",
      persistenceMode: "durable",
    });
    const section = prompt.slice(prompt.indexOf("## 커플 갈등 중재"));
    expect(section.slice(0, 400)).toContain("안전 신호가 보이면 중재하지 마세요");
    // 예외가 갈등 조율 지침보다 **앞에** 있어야 한다.
    expect(section.indexOf("안전 신호가 보이면")).toBeLessThan(section.indexOf("합의안 제안"));
  });
});
