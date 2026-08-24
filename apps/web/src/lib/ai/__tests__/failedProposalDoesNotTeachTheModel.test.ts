import { describe, expect, it } from "vitest";

import {
  buildAmoraHistoryContent,
  isAmoraFailedProposalNotice,
} from "@/lib/ai/amoraPendingAction";

/**
 * 실패 몇 번이 대화를 영구히 망친다.
 *
 * 아모라가 표식 없이 확인 문장만 쓰면 서버가 그것을 지우고 이 문장을 남긴다.
 *
 *     "방금 제안을 확인 카드로 만들지 못했어요. 같은 요청을 한 번만 다시
 *      보내주시겠어요?"
 *
 * 사용자에게는 이게 맞다 — 무엇을 다시 해야 하는지 알아야 하니까. 그런데 그
 * 문장을 **모델 이력에도 그대로 넣으면** 모델이 그것을 아모라 턴의 모양으로
 * 배운다.
 *
 * 실측(2026-08-24): 운영 대화의 최근 아모라 턴 17개 중 3개가 이 안내였고,
 * 그 뒤로 일정 취소 요청이 3번 연속 카드 없이 끝났다. 스테이징에서는 5번
 * 연속이었다. 표현을 확 바꾼 문장 하나가 겨우 뚫었다.
 *
 * 그래서 이 턴은 프로바이더 이력에서 뺀다. DB 와 화면은 그대로다.
 */

const FAILURE_NOTICE =
  "방금 제안을 확인 카드로 만들지 못했어요. 같은 요청을 한 번만 다시 보내주시겠어요?";

describe("실패 안내는 모델에게 가지 않는다", () => {
  it("실패 안내를 알아본다", () => {
    expect(isAmoraFailedProposalNotice(FAILURE_NOTICE)).toBe(true);
  });

  it("서버가 만든 그 문장을 이력에서 그대로 재생산하지 않는다", () => {
    // 표식 없이 확인만 약속한 턴은 이 문장으로 치환된다 — 그리고 치환된 결과가
    // 곧 실패 안내이므로 이력에서 빠져야 한다.
    const sanitized = buildAmoraHistoryContent("다음 변경을 적용할까요?", undefined);
    expect(isAmoraFailedProposalNotice(sanitized)).toBe(true);
  });

  it("평범한 아모라 답변은 실패 안내가 아니다", () => {
    for (const content of [
      "지금은 결혼식장부터 보면 돼요.",
      "공덕 인근 한정식집 검색 결과를 화면 카드로 띄워뒀어요.",
      "「드레스 가봉」(2026-12-24) 일정을 취소 상태로 남겼어요.",
      "총예산을 8,000만원에서 7,100만원으로 변경했어요.",
    ]) {
      expect(isAmoraFailedProposalNotice(content)).toBe(false);
    }
  });

  it("표식이 있던 턴은 그대로 남는다 — 그건 모델이 배워야 할 모양이다", () => {
    const action = {
      version: 2,
      actionId: "11111111-1111-4111-8111-111111111111",
      tool: "update_budget",
      input: { total_budget: 71_000_000 },
      inputDigest: "a".repeat(64),
      operationKey: "b".repeat(64),
      confirmation: "다음 변경을 적용할까요?",
      issuedAt: 1_787_000_000_000,
      expiresAt: 1_787_086_400_000,
    };
    const kept = buildAmoraHistoryContent("다음 변경을 적용할까요?", action);
    expect(isAmoraFailedProposalNotice(kept)).toBe(false);
    expect(kept).toContain("pending_action");
    // 확인되지 않은 값이 사실처럼 읽히지 않게 하는 단서는 유지된다.
    expect(kept).toContain("미확인 제안");
  });

  it("빈 값이나 이상한 타입에 터지지 않는다", () => {
    for (const value of [undefined, null, 0, {}, []]) {
      expect(isAmoraFailedProposalNotice(value)).toBe(false);
    }
  });
});
