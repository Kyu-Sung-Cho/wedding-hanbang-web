import { describe, expect, it } from "vitest";

import { selectAmoraPendingProposalTools } from "@/lib/ai/amoraToolPolicy";
import { isMutatingTool } from "@/lib/ai/mutationTools";
import { BETA_SAFE_TOOLS } from "@/lib/ai/tools";

/**
 * "할 일로 추가해줘" 에 행동 카드 도구가 하나도 열리지 않았다.
 *
 * 2026-08-25 운영 실측:
 *
 *     "결혼식장 계약서 확인하는 걸 다음 할 일로 추가해줘"
 *       → 아모라: "앱의 **할 일 추가**에서 직접 입력해 주세요."
 *     "결혼 준비 할 일에 상견례 식당 예약 확인 추가해줘"
 *       → 일정 도구로 카드를 냄
 *
 * 제안 선택기의 `ACTION_INTENT` 에 `할 일` 이 없었다(기억·메모·챙겨·리마인드만).
 * 같은 파일의 `ACTION_ADD_WRITE` 에는 이미 들어 있었는데 두 선택기가 갈려 있었다.
 * 설계된 기능이 **가장 흔한 한국어 표현으로는 닿지 않았다.**
 */

const PENDING_ACTION_TOOLS = BETA_SAFE_TOOLS.filter((tool) => isMutatingTool(tool.name));

function tools(userText: string): string[] {
  return selectAmoraPendingProposalTools({
    availableTools: PENDING_ACTION_TOOLS,
    userText,
    specialistType: "general",
  }).map((tool) => tool.name);
}

describe("할 일로 추가해 달라는 말에 행동 카드 도구가 열린다", () => {
  it.each([
    "결혼식장 계약서 확인하는 걸 다음 할 일로 추가해줘",
    "결혼 준비 할 일에 상견례 식당 예약 확인 추가해줘",
    "결혼 준비 투두에 청첩장 시안 확인 넣어줘",
  ])("%s", (text) => {
    expect(tools(text)).toContain("add_amora_action");
  });

  it("예전 표현도 그대로 열린다", () => {
    for (const text of [
      "상견례 식당 예약 확인하는 거 기억해줘",
      "드레스 투어 일정 챙겨줘",
    ]) {
      expect(tools(text)).toContain("add_amora_action");
    }
  });

  it("할 일과 무관한 결혼 요청에는 열리지 않는다", () => {
    expect(tools("총예산 5천만원으로 바꿔줘")).not.toContain("add_amora_action");
    expect(tools("식장 그랜드컨벤션으로 정했어")).not.toContain("add_amora_action");
  });
});
