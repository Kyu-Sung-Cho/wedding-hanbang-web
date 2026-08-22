import { describe, expect, it } from "vitest";

import { selectAmoraTools } from "@/lib/ai/amoraToolPolicy";
import { classifyAmoraQuestionScope } from "@/lib/ai/amoraQuestionScope";
import type { AiToolDefinition } from "@/lib/ai/toolDefinition";

/**
 * 견적을 봐 달라고 하면 채팅에서 견적 체크가 열리는지 본다.
 *
 * `analyze_quote` 는 `CONTRACT_READ_TOOLS` 안에 있었고 그 묶음은 `CONTRACT_INTENT` 로만
 * 열렸는데 거기에 "견적"이 없었다. "견적"은 `BUDGET_INTENT` 에만 있어서 예산 도구만
 * 열렸다. 그래서 **"스드메 290 견적 받았는데 봐줘"로는 견적 체크가 채팅에서 안 열렸다.**
 * `prompts.ts` 는 이것을 "핵심 기능"이라 부른다.
 *
 * ## 왜 `CONTRACT_INTENT` 를 넓히지 않았나 — 두 가지 이유
 *
 * 1. 넓히면 계약 판정 도구(`analyze_contract_readiness`)까지 함께 열린다. 아모라의 계약
 *    해석은 2026-08-18 파운더 결정으로 걷어낸 방향이다.
 * 2. **계약 어휘로 확인하면 오판한다.** `amoraQuestionScope` 의 고위험 판정이 먼저 떨어져
 *    도구가 **빈 배열**이 된다. "계약서 봐줘"로 확인하면 고쳐도 안 열린 것처럼 보이고,
 *    반대로 고치지 않아도 같은 결과라 차이를 못 본다. 아래 마지막 검사가 그 함정을
 *    실제로 밟아 둔다 — 다음 사람이 같은 방법으로 확인하다 헤매지 않도록.
 */
describe("채팅에서 견적 체크 열기", () => {
  const TOOLS: AiToolDefinition[] = [
    "analyze_quote",
    "analyze_contract_readiness",
    "get_market_price",
    "update_budget",
  ].map((name) => ({ name, description: "", input_schema: { type: "object" } }) as AiToolDefinition);

  const names = (userText: string, attachmentKind?: "none" | "image" | "document") =>
    selectAmoraTools({
      availableTools: TOOLS,
      userText,
      specialistType: "general",
      attachmentKind,
    }).map((t) => t.name);

  it("견적을 말하면 견적 체크가 열린다", () => {
    for (const text of [
      "스드메 290 견적 받았는데 봐줘",
      "이 견적 좀 봐줘",
      "견적서 확인해 줄 수 있어?",
      "웨딩홀 견적이 적당한지 모르겠어",
    ]) {
      expect(names(text), `"${text}" 에서 안 열림`).toContain("analyze_quote");
    }
  });

  it("견적서를 사진으로 올려도 열린다", () => {
    // 견적서는 보통 사진으로 온다. 계약 의도는 `document` 만 봤다.
    expect(names("이거 봐줘", "image")).toContain("analyze_quote");
    expect(names("이거 봐줘", "document")).toContain("analyze_quote");
  });

  it("견적 어휘가 계약 판정 도구를 열지는 않는다", () => {
    // 좁은 문이어야 한다. 넓은 문을 냈다면 여기가 실패한다.
    expect(names("이 견적 좀 봐줘")).not.toContain("analyze_contract_readiness");
  });

  it("예산·견적 전문가로 분류되면 열린다", () => {
    // `budget_optimizer` 는 주석이 "예산/견적/시세" 담당이라고 적어 둔 전문가다
    // (`types/moat.types.ts:18`). 다른 의도들도 전부 자기 전문가를 함께 본다.
    const tools = selectAmoraTools({
      availableTools: TOOLS,
      userText: "이거 어떻게 생각해?",
      specialistType: "budget_optimizer",
    }).map((t) => t.name);
    expect(tools).toContain("analyze_quote");
  });

  it("견적과 무관한 말에는 안 열린다", () => {
    for (const text of ["예식장 어디가 좋아?", "청첩장 언제 돌려?", "오늘 뭐 해야 해?"]) {
      expect(names(text), `"${text}" 에서 잘못 열림`).not.toContain("analyze_quote");
    }
  });

  /**
   * 이 검사는 고치는 대상이 아니라 **확인 방법의 함정**을 고정한다.
   *
   * "계약서 봐줘"는 고위험(W2)으로 떨어져 도구가 통째로 사라진다. 그러니 견적 게이트를
   * 계약 어휘로 확인하면 고쳐도 안 고쳐도 결과가 같다. 반대로 견적 어휘는 고위험이
   * 아니라서 게이트의 효과가 실제로 보인다.
   */
  it("계약 어휘는 고위험으로 떨어지지만 견적 어휘는 아니다", () => {
    const contract = classifyAmoraQuestionScope({ userText: "계약서 좀 봐줘" });
    const quote = classifyAmoraQuestionScope({ userText: "이 견적 좀 봐줘" });

    expect(contract.scope, "계약서 검토가 고위험이 아니게 됐다면 이 검사의 전제를 다시 봐야 한다")
      .toBe("W2_high_risk_adjacent");
    expect(quote.scope).not.toBe("W2_high_risk_adjacent");
  });
});
