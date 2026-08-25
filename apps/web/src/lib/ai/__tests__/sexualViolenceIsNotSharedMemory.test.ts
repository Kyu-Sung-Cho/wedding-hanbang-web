import { describe, expect, it } from "vitest";

import {
  classifyAmoraQuestionScope,
  filterAmoraToolsByQuestionScope,
} from "@/lib/ai/amoraQuestionScope";
import { BETA_SAFE_TOOLS } from "@/lib/ai/tools";
import { isMutatingTool } from "@/lib/ai/mutationTools";

/**
 * 성폭력 진술이 **커플이 함께 보는 장기 기억**에 저장되고 있었다.
 *
 * `성추행`·`강간` 이 `HIGH_RISK_SAFETY_PATTERN` 에 없었다. `성폭력` 은 `폭력` 을,
 * `성폭행` 은 `폭행` 을 부분 문자열로 포함해 우연히 걸렸지만 그 둘은 아니었다.
 *
 * 안전 관문에서 안 걸리면 아래로 흘러 결혼 낱말에 잡힌다. 그래서 이랬다
 * (2026-08-25 실측, origin/main):
 *
 *   "남편이 저를 성추행했어요"                  → W1  · 읽기 도구 4개
 *   "예비 신랑이 저를 성추행했어요"              → W0  · **기억 ON** · 도구 5개
 *   "남편이 저를 성추행하는데 결혼식을 계속할까요" → W0  · **기억 ON** · 도구 5개
 *
 * 결혼 준비 제품에서 이런 진술에 결혼 낱말이 안 섞일 확률은 낮다. 그러니
 * W0 쪽이 예외가 아니라 **주된 경로**였다.
 *
 * 이 파일이 아니라 `amoraQuestionScope.ts` 머리 주석이 이 결함 부류를 이미
 * 적어 두었다("신체 폭력 서술이 커플이 함께 보는 장기 기억에 남는다는 뜻이다").
 * 같은 구멍이 성폭력 어휘에 남아 있었다.
 *
 * ## 어휘를 넓히는 값
 *
 * 이 저장소에는 안전 어휘를 넓혔다가 평범한 결혼 문장을 함께 잡은 기록이 있다.
 * 그 낱말들(`밀쳤`·`던졌`)은 문맥에 따라 폭력이 아닐 수 있어서였다.
 * `성추행`·`강간` 은 다르다 — 결혼 준비 대화에서 무해한 쓰임이 없다.
 *
 * 오탐은 하나 확인했다: "성추행 예방 교육을 회사에서 받았어요" 도 안전 갈래로
 * 간다. 그 대가는 그 턴 하나가 결혼 도구 대신 조심스러운 답을 받는 것뿐이다 —
 * 채팅 턴의 안전 판정은 영구 효과를 남기지 않는다(`route.ts` 의 안전 차단은
 * `requestKind === "mediation"` 요청만 422 로 막는다).
 */

const READ_ONLY_BETA_TOOLS = BETA_SAFE_TOOLS.filter(
  (tool) => !isMutatingTool(tool.name),
);

/** 결혼 낱말이 섞여 W0 으로 흘러가던 것들을 일부러 포함했다. */
const SEXUAL_VIOLENCE_SAYS = [
  "남편이 저를 성추행했어요",
  "예비 신랑이 저를 성추행했어요",
  "남편이 저를 성추행하는데 결혼식을 계속해야 할까요",
  "남편이 저를 강간했어요",
  "시아버지가 저를 성추행했어요",
  "예식장 계약했는데 남편이 저를 성추행했어요",
];

/** 손대면 안 되는 평범한 결혼 대화. */
const ORDINARY_WEDDING_SAYS = [
  "예식장 계약금 500만원 냈어요",
  "드레스 투어 언제 하면 좋아?",
  "축가 부를 친구 정했어",
  "예비 신랑이랑 신혼여행 어디 갈지 정했어요",
  "시아버지가 예단 이야기를 꺼내셨어요",
];

describe("성폭력 진술", () => {
  it.each(SEXUAL_VIOLENCE_SAYS)("'%s' 는 안전 갈래로 간다", (userText) => {
    const scope = classifyAmoraQuestionScope({ userText });
    expect(scope.scope).toBe("W2_high_risk_adjacent");
    expect(scope.highRiskReason).toBe("safety");
  });

  it.each(SEXUAL_VIOLENCE_SAYS)(
    "'%s' 는 장기 기억에 남지 않는다",
    (userText) => {
      // 이것이 이 파일의 이유다. 커플이 함께 보는 기억에 성폭력 진술이
      // 저장되면 되돌릴 방법이 없다.
      expect(classifyAmoraQuestionScope({ userText }).allowsLongTermMemory)
        .toBe(false);
    },
  );

  it.each(SEXUAL_VIOLENCE_SAYS)("'%s' 에는 도구가 열리지 않는다", (userText) => {
    const tools = filterAmoraToolsByQuestionScope(
      READ_ONLY_BETA_TOOLS,
      classifyAmoraQuestionScope({ userText }),
    );
    expect(tools).toEqual([]);
  });
});

describe("평범한 결혼 대화는 그대로다", () => {
  it.each(ORDINARY_WEDDING_SAYS)("'%s' 는 결혼 대화로 남는다", (userText) => {
    // 어휘를 넓힌 변경이 여기를 건드리면 제품이 통째로 조심스러워진다.
    const scope = classifyAmoraQuestionScope({ userText });
    expect(scope.scope).toBe("W0_wedding_core");
    expect(scope.allowsLongTermMemory).toBe(true);
  });

  it.each(ORDINARY_WEDDING_SAYS)("'%s' 는 도구를 받는다", (userText) => {
    const tools = filterAmoraToolsByQuestionScope(
      READ_ONLY_BETA_TOOLS,
      classifyAmoraQuestionScope({ userText }),
    );
    expect(tools.length).toBeGreaterThan(0);
  });
});
