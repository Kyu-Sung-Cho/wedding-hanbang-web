import { describe, expect, it } from "vitest";

import { selectAmoraPendingProposalTools } from "@/lib/ai/amoraToolPolicy";
import { isMutatingTool } from "@/lib/ai/mutationTools";
import { BETA_SAFE_TOOLS } from "@/lib/ai/tools";

// 운영이 실제로 넘기는 집합과 같게 만든다(route.ts:189).
const PENDING_ACTION_TOOLS = BETA_SAFE_TOOLS.filter((tool) => isMutatingTool(tool.name));

/**
 * 일정을 바꾸는 가장 흔한 두 문장에 확인 카드가 한 개도 안 나왔다.
 *
 *   "3월 15일에 스튜디오 촬영이랑 드레스 투어가 겹쳐서 드레스 투어를
 *    3월 22일로 옮겨줘"                          → 카드 0개
 *   "방금 추가한 드레스 투어 일정 취소해줘"        → 카드 0개
 *
 * 원인이 둘이었다.
 *   1) `AVOIDANCE` 에 `겹쳐|겹치` 가 들어 있었다. 일정이 겹치는 것은 **바꾸려는
 *      이유**지 값을 피하려는 말이 아닌데, 그 낱말 하나로 문장 전체가 막혔다.
 *   2) `RETRACTION` 이 `(?:아까|방금|앞서).{0,40}취소` 를 말 무르기로 봤다.
 *      이미 저장된 일정을 가리키는 "방금 추가한 …" 까지 같이 삼켰다.
 *
 * 베타 첫 주에 가장 많이 밟는 '방금 한 걸 되돌리기' 경로다.
 */

function tools(userText: string): string[] {
  return selectAmoraPendingProposalTools({
    availableTools: PENDING_ACTION_TOOLS,
    userText,
    specialistType: "general",
  }).map((tool) => tool.name);
}

describe("겹치는 일정을 옮겨 달라는 말에 카드가 나온다", () => {
  it.each([
    "3월 15일에 스튜디오 촬영이랑 드레스 투어가 겹쳐서 드레스 투어를 3월 22일로 옮겨줘",
    "본식이랑 상견례가 겹치니까 상견례를 4월 5일로 바꿔줘",
  ])("%s", (text) => {
    expect(tools(text).length).toBeGreaterThan(0);
  });

  it("정말 피하겠다는 말은 그대로 막는다", () => {
    expect(tools("9월은 성수기라 피하고 싶어")).toEqual([]);
    expect(tools("주말은 피하자")).toEqual([]);
  });
});

describe("방금 한 것을 되돌려 달라는 말에 카드가 나온다", () => {
  it.each([
    "방금 추가한 드레스 투어 일정 취소해줘",
    "아까 추가한 상견례 일정 취소해줘",
    "아까 취소한 드레스 투어 일정 다시 살려줘",
  ])("%s", (text) => {
    expect(tools(text).length).toBeGreaterThan(0);
  });

  it("앞서 한 **말**을 무르는 것은 그대로 막는다", () => {
    // 저장된 것이 아니라 자기가 방금 한 말을 취소하는 경우다.
    expect(tools("아까 말한 예산 배분안 그거 취소해줘")).toEqual([]);
    expect(tools("방금 얘기한 거 없던 걸로 해줘")).toEqual([]);
    expect(tools("아까 한 말 잊어줘")).toEqual([]);
  });
});
