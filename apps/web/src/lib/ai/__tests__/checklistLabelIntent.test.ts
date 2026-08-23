import { describe, expect, it } from "vitest";
import { mentionsKnownChecklistItem } from "@/lib/ai/amoraToolPolicy";

/**
 * 관문이 손으로 쓴 낱말만 보면, 사용자가 그 낱말을 안 쓰는 순간 기능이 사라진다.
 *
 * 2026-08-23 라이브 실측:
 *     "체크리스트에서 디자인 초안 선택 다 했어"  → 카드 O
 *     "디자인 초안 선택 다 했어"                → 카드 X
 * 낱말 하나("체크리스트") 차이였다. 목록을 넓히는 것은 다음 표현에서 또 막히므로,
 * **이 커플에 실제로 있는 항목 이름**과 대조한다.
 */

const LABELS = [
  "종이·모바일 초대장 중 필요한 형태 정하기",
  "초대장 디자인 초안 선택",
  "문구 및 정보 작성",
  "하객 명단 정리 및 수량 확정",
  "초대장 주문·제작",
];

describe("커플의 실제 체크리스트 이름으로 의도를 읽는다", () => {
  it("줄여 말해도 알아본다", () => {
    for (const text of [
      "디자인 초안 선택 다 했어",
      "초대장 주문·제작 완료했어",
      "문구 및 정보 작성 다 했어",
      "하객 명단 정리 끝났어",
      "주문 제작 끝냈어요 초대장",
    ]) {
      expect(mentionsKnownChecklistItem(text, LABELS), `못 알아봄: ${text}`).toBe(true);
    }
  });

  it("스치듯 언급한 말에는 열리지 않는다", () => {
    for (const text of [
      "디자인 좋아요",
      "초대장 예쁘게 나왔어요",
      "초대장 얘기 좀 하자",
      "명단이 뭐예요?",
      "정리를 좀 해야 할 것 같아요",
    ]) {
      expect(mentionsKnownChecklistItem(text, LABELS), `잘못 열림: ${text}`).toBe(false);
    }
  });

  it("항목이 없으면 아무것도 열지 않는다", () => {
    expect(mentionsKnownChecklistItem("디자인 초안 선택 다 했어", [])).toBe(false);
    expect(mentionsKnownChecklistItem("디자인 초안 선택 다 했어", undefined)).toBe(false);
  });

  // 한 토큰만 스쳐도 열리면 평범한 대화가 카드를 받는다.
  it("토큰 하나만 겹치는 것으로는 열리지 않는다", () => {
    expect(mentionsKnownChecklistItem("초대장 봤어요", LABELS)).toBe(false);
    expect(mentionsKnownChecklistItem("선택이 어렵네요", LABELS)).toBe(false);
  });
});
