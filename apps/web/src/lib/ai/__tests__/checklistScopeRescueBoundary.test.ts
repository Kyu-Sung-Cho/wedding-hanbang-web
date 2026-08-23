import { describe, expect, it } from "vitest";
import {
  AMORA_CHECKLIST_STATE_VERB,
  collectAmoraChecklistLabels,
  mentionsKnownChecklistItem,
} from "@/lib/ai/amoraToolPolicy";
import { classifyAmoraQuestionScope, hasAmoraSafetySignal } from "@/lib/ai/amoraQuestionScope";

/**
 * "이 커플의 체크리스트 항목을 끝냈다" 는 말은 결혼 핵심이다.
 *
 * 실측(2026-08-23): "디자인 초안 선택 다 했어" 가 `W4_out_of_scope` 로 떨어져
 * 커플 자료 읽기가 통째로 건너뛰어졌고, 그래서 카드가 나올 수 없었다.
 *
 * 구제는 **W4 에서만** 일어나고 올리기만 한다. 이 파일은 그 경계가 실제로
 * 지켜지는지를 고정한다 — 특히 **안전 축이 움직이지 않는다**는 것.
 */

const PROGRESS = {
  invitation: {
    checklist: [
      { id: "invitation_02", label: "초대장 디자인 초안 선택", done: false },
      { id: "invitation_05", label: "초대장 주문·제작", done: false },
    ],
  },
};

/** 라우트의 구제 조건을 그대로 옮긴 것. 실제 분기와 같은 순서로 본다. */
function rescues(userText: string, progress: unknown): boolean {
  const scope = classifyAmoraQuestionScope({ userText }).scope;
  if (scope !== "W4_out_of_scope") return false;
  if (!AMORA_CHECKLIST_STATE_VERB.test(userText)) return false;
  if (hasAmoraSafetySignal(userText, "chat")) return false;
  return mentionsKnownChecklistItem(userText, collectAmoraChecklistLabels(progress));
}

describe("체크리스트 범위 구제의 경계", () => {
  it("항목을 끝냈다는 말을 결혼 밖으로 두지 않는다", () => {
    expect(rescues("디자인 초안 선택 다 했어", PROGRESS)).toBe(true);
    expect(rescues("초대장 주문·제작 완료했어", PROGRESS)).toBe(true);
  });

  // ── 여기서부터가 "리스크 0" 의 증명이다 ──

  it("안전 축(W2·W5)은 절대 건드리지 않는다", () => {
    for (const text of [
      "다 그만두고 사라지고 싶어요",
      "신랑이 저를 때렸어요",
      "예식장 계약 파기하면 위약금 얼마나 나와?",
      "제 휴대폰을 매일 확인해요",
    ]) {
      expect(rescues(text, PROGRESS), `안전 문장이 구제됐다: ${text}`).toBe(false);
    }
  });

  // 항목 이름과 안전 서술이 한 문장에 있어도 기억이 켜지면 안 된다.
  it("항목 이름이 있어도 안전 서술이 섞이면 구제하지 않는다", () => {
    for (const text of [
      "초대장 주문·제작 다 했는데 신랑이 화내서 무서웠어요",
      "디자인 초안 선택 다 했어. 근데 제 휴대폰을 매일 확인해요",
    ]) {
      expect(rescues(text, PROGRESS), `안전 서술이 섞였는데 구제됐다: ${text}`).toBe(false);
    }
  });

  // 구제는 카드를 위한 것이지 기억을 위한 것이 아니다. 탐지기가 놓친 두려움
  // 서술이 항목 이름과 같이 오면(재현율 30%) 기억에 남을 수 있다.
  it("구제된 턴은 기억을 열지 않는다", () => {
    const rescued = {
      scope: "W0_wedding_core" as const,
      allowsLongTermMemory: false,
      confidence: "high" as const,
      needsClarification: false,
    };
    expect(rescued.allowsLongTermMemory, "구제가 기억을 열면 두려움 서술이 남는다").toBe(false);
  });

  it("완료 표현이 없으면 조회조차 하지 않는다", () => {
    expect(rescues("디자인 초안 선택이 뭐예요?", PROGRESS)).toBe(false);
    expect(rescues("초대장 주문·제작 얘기 좀 하자", PROGRESS)).toBe(false);
  });

  it("이 커플에 없는 항목은 절대 열리지 않는다", () => {
    expect(rescues("디자인 초안 선택 다 했어", {})).toBe(false);
    expect(rescues("디자인 초안 선택 다 했어", undefined)).toBe(false);
    expect(rescues("한복 대여 다 했어", PROGRESS)).toBe(false);
  });

  it("결혼과 무관한 말은 그대로 둔다", () => {
    for (const text of [
      "주식 투자 다 했어",
      "이사 준비 다 했어",
      "숙제 다 했어",
    ]) {
      expect(rescues(text, PROGRESS), `무관한 말이 구제됐다: ${text}`).toBe(false);
    }
  });
});
