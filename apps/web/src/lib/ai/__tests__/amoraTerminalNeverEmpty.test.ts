import { describe, expect, it } from "vitest";

import { composeAmoraPersistenceTerminal } from "@/lib/ai/amoraPersistenceClaims";

/**
 * 종단 본문이 빈 문자열이면 **턴 전체가 하드 실패한다.**
 *
 * 운영 원장 2026-08-24 14:48:41 'post_provider_payload_invalid' → 14:48:45
 * 'CHAT_TURN_FAILED'(3.7초). 종단 검증이 `!input.content.trim()` 으로 거절하고,
 * 사용자는 원인과 무관한 "이 요청은 같은 식별자로 다시 이어갈 수 없어요" 를
 * 받는다 — 재시도 버튼도 없다.
 *
 * 이 파일은 **본문을 통째로 지울 수 있는 모든 경로**에 같은 질문을 한다:
 * 걸러낸 뒤 남는 것이 있는가.
 */

function terminal(
  text: string,
  overrides: {
    hasPendingAction?: boolean;
    userRequestedChange?: boolean;
    persistenceMode?: "durable" | "demo";
  } = {},
) {
  return composeAmoraPersistenceTerminal({
    text,
    toolResults: [],
    hasPendingAction: overrides.hasPendingAction ?? false,
    persistenceMode: overrides.persistenceMode ?? "durable",
    userRequestedChange: overrides.userRequestedChange ?? true,
  });
}

describe("종단 본문은 절대 비지 않는다", () => {
  it("모든 문장이 저장 주장인 응답", () => {
    const result = terminal(
      "예산을 저장했어요. 일정도 등록해 뒀어요. 예식장도 변경 완료했어요.",
    );

    expect(result.text.trim()).not.toBe("");
    expect(result.corrected).toBe(true);
  });

  it("모든 문장이 저장 주장이고 안내가 억제되는 턴", () => {
    // 제안 도구가 하나도 안 열린 턴에서는 안내를 붙이지 않는다. 그 갈래가
    // 정확히 빈 문자열을 만들던 자리다.
    const result = terminal(
      "예산을 저장했어요. 일정도 등록해 뒀어요.",
      { userRequestedChange: false },
    );

    expect(result.text.trim()).not.toBe("");
    expect(result.corrected).toBe(true);
    expect(result.source).toBe("server_correction");
  });

  it("신뢰 스크린이 모든 문장을 지우는 응답", () => {
    // removedClaimCount 는 0 이라 안내가 안 붙는데 본문은 비어 있다.
    const result = terminal(
      "제가 다 책임질게요. 100% 안전해요. 아무것도 놓치지 않을게요.",
    );

    expect(result.text.trim()).not.toBe("");
    expect(result.text).not.toContain("책임질게요");
    expect(result.text).not.toContain("100%");
    expect(result.corrected).toBe(true);
  });

  it("제공자가 빈 텍스트를 낸 턴", () => {
    expect(terminal("").text.trim()).not.toBe("");
    expect(terminal("   \n\n  ").text.trim()).not.toBe("");
  });

  it("체험 상담에서도 비지 않는다", () => {
    const result = terminal(
      "제가 다 책임질게요. 100% 안전해요.",
      { persistenceMode: "demo" },
    );

    expect(result.text.trim()).not.toBe("");
  });

  it("미래형 약속만으로 이뤄진 응답", () => {
    const result = terminal("예식장을 그랜드호텔로 등록할게요.");

    expect(result.text.trim()).not.toBe("");
  });
});

describe("빈 본문 방지가 정상 응답을 건드리지 않는다", () => {
  it("깨끗한 답변은 원문 그대로 통과한다", () => {
    const clean = "잔금일이 사흘 남았어요. 계좌를 업체에 확인해보시겠어요?";
    const result = terminal(clean);

    expect(result.text).toBe(clean);
    expect(result.source).toBe("provider");
    expect(result.corrected).toBe(false);
  });

  it("일부만 걸러진 답변은 남은 문장을 그대로 담는다", () => {
    const result = terminal(
      "그랜드호텔은 보증 200명이에요. 예산을 저장했어요.",
    );

    expect(result.text).toContain("그랜드호텔은 보증 200명이에요.");
    expect(result.text).not.toContain("저장했어요");
  });
});
