import { describe, expect, it } from "vitest";
import { splitAmoraClaimSegments } from "../amoraClaimSegments";

import {
  composeAmoraPersistenceTerminal,
  guardUnverifiedAmoraPersistenceClaims,
  isExplicitAmoraChangeRequest,
  SERVER_OWNED_EMPTY_ANSWER_NOTICE,
  SERVER_OWNED_MISSING_CARD_NOTICE,
  SERVER_OWNED_UNVERIFIED_NOTICE,
} from "../amoraPersistenceClaims";

describe("composeAmoraPersistenceTerminal", () => {
  it.each([
    "같은 배분 변경 카드가 이미 화면에 대기 중이에요.",
    "동일한 변경 카드가 이미 대기 중입니다. 새 카드 없이 기존 카드에서 확인해 주세요.",
    "새 카드 없이 기존 카드에서 확인하시면 돼요.",
  ])("corrects an existing-card claim when no card is emitted: %s", text => {
    const result = composeAmoraPersistenceTerminal({
      text, hasPendingAction: false, hasEmittedPendingAction: false,
      persistenceMode: "durable", toolResults: [],
    });
    expect(result.text).toBe(SERVER_OWNED_MISSING_CARD_NOTICE);
    expect(result.source).toBe("server_correction");
    expect(result.removedClaimCount).toBeGreaterThan(0);
  });

  it.each([
    "변경 카드가 이미 대기 중인가요?",
    "‘변경 카드가 이미 대기 중입니다.’라는 안내를 보셨나요?",
    "변경 카드가 대기 중이라면 기존 카드에서 확인해 주세요.",
    "이전 변경 카드는 대기 중이었어요.",
  ])("preserves questions, quotations, conditions and past card descriptions: %s", text => {
    const result = composeAmoraPersistenceTerminal({
      text, hasPendingAction: false, hasEmittedPendingAction: false,
      persistenceMode: "durable", toolResults: [],
    });
    expect(result.text).toBe(text);
    expect(result.removedClaimCount).toBe(0);
  });

  it("keeps an existing-card statement when the server actually emits its card", () => {
    const text = "동일한 변경 카드가 이미 대기 중입니다. 기존 카드에서 확인해 주세요.";
    expect(composeAmoraPersistenceTerminal({
      text, hasPendingAction: false, hasEmittedPendingAction: true,
      persistenceMode: "durable", toolResults: [],
    }).text).toBe(text);
  });

  it("preserves the existing claim screening boundaries across punctuation and layout structures", () => {
    const phrases = ["예산을 저장했어요.", "아직 저장하지 않았어요.", "Saved!", "not saved?", "31.4%", "3.5만원", "https://example.com/p?a=1", "**강조**", "| 항목 | 금액 |", "- 다음 할 일", "등록됐어요。", "미확인！？", "🧡", ""];
    for (const first of phrases) for (const second of phrases) for (const separator of ["", " ", "\n", "\n\n", "\r\n", "\t"]) {
      const source = `${first}${separator}${second}`;
      const segments = splitAmoraClaimSegments(source);
      expect(segments.map(segment => segment.claim).filter(Boolean)).toEqual(source.split(/(?<=[.!?。！？])\s*|\n+/u).map(segment => segment.trim()).filter(Boolean));
      expect(segments.map(segment => segment.source).join("")).toBe(source);
    }
  });

  it("removes an unverified write without changing the budget table, decimal amounts, or source URL", () => {
    const table = "| 항목 | 제안 금액 | 비율 |\n|---|---|---|\n| 결혼식장·식사 | 1,100만원 | 31.4% |\n| 신혼여행 | 800만원 | 22.9% |";
    const details = "금액은 3.5만원 단위예요.\n출처: https://example.com/prices?region=seoul&year=2026";
    const result = composeAmoraPersistenceTerminal({
      text: `예산을 저장했어요.\n\n${table}\n\n${details}`,
      hasPendingAction: false, persistenceMode: "durable", toolResults: [],
    });
    expect(result.text).not.toContain("예산을 저장했어요.");
    expect(result.text).toContain(table);
    expect(result.text).toContain(details);
    expect(result.removedClaimCount).toBe(1);
  });

  it("uses only ordered server display messages when mutating receipts exist", () => {
    const result = composeAmoraPersistenceTerminal({
      text: "예산과 일정 모두 저장해뒀어요.",
      hasPendingAction: false,
      persistenceMode: "durable",
      toolResults: [
        {
          toolName: "update_budget",
          toolInput: { total: 30_000_000 },
          toolOutput: { budgetId: "budget-1" },
          success: true,
          displayMessage: "총예산을 3,000만 원으로 변경했어요.",
        },
        {
          toolName: "get_budget",
          toolInput: {},
          toolOutput: { total: 30_000_000 },
          success: true,
          displayMessage: "현재 총예산은 3,000만 원이에요.",
        },
        {
          toolName: "add_schedule_event",
          toolInput: { title: "드레스 투어" },
          toolOutput: { error: "conflict" },
          success: false,
          displayMessage: "같은 시간의 일정이 있어 추가하지 못했어요.",
        },
      ],
    });

    expect(result).toEqual({
      text: [
        "총예산을 3,000만 원으로 변경했어요.",
        "같은 시간의 일정이 있어 추가하지 못했어요.",
      ].join("\n\n"),
      corrected: true,
      removedClaimCount: 0,
      source: "server_mutation_receipts",
    });
  });

  it("fails closed when a mutating receipt has no display message", () => {
    const result = composeAmoraPersistenceTerminal({
      text: "예산을 확실히 저장했어요.",
      hasPendingAction: false,
      persistenceMode: "durable",
      toolResults: [{
        toolName: "update_budget",
        toolInput: { total_budget: 30_000_000 },
        toolOutput: { success: true },
        success: true,
        displayMessage: "   ",
      }],
    });

    expect(result.text).toBe(
      "변경 실행 결과를 안전하게 표시할 수 없어 반영 여부를 확인하지 못했어요. 현재 화면에서 값을 확인해주세요.",
    );
    expect(result.text).not.toContain("확실히 저장했어요");
    expect(result.source).toBe("server_mutation_receipts");
  });

  it("removes a demo write claim and adds the server-owned demo disclosure", () => {
    const result = composeAmoraPersistenceTerminal({
      text: "총예산을 3,000만 원으로 설정했어요.",
      toolResults: [],
      hasPendingAction: false,
      persistenceMode: "demo",
      demoUserText: "총예산을 3,000만 원으로 바꿨어.",
    });

    expect(result.text).toBe(
      "참고로 체험 상담이라 말씀하신 예산은 실제 예산 관리에는 아직 저장되지 않았어요.",
    );
    expect(result.text).not.toContain("설정했어요");
    expect(result.source).toBe("server_correction");
  });

  it("does not let a negative sentence shield a sibling write claim", () => {
    const result = composeAmoraPersistenceTerminal({
      text: "예산은 아직 반영되지 않았어요.일정은 캘린더에 넣어뒀어요.",
      toolResults: [],
      hasPendingAction: false,
      persistenceMode: "durable",
    });

    expect(result.text).toContain("예산은 아직 반영되지 않았어요.");
    expect(result.text).not.toContain("넣어뒀어요");
    expect(result.text).toContain("실제 실행 결과가 확인되지 않아");
  });

  it("does not let a negative clause shield a write claim in the same sentence", () => {
    const result = composeAmoraPersistenceTerminal({
      text: "예산은 아직 반영되지 않았지만 드레스 투어 일정은 저장했어요.",
      toolResults: [],
      hasPendingAction: false,
      persistenceMode: "durable",
    });

    expect(result.text).not.toContain("저장했어요");
    expect(result.text).toContain("실제 실행 결과가 확인되지 않아");
  });

  it("does not let a negative English clause shield a later completion claim", () => {
    const result = composeAmoraPersistenceTerminal({
      text: "The budget wasn't saved, but the schedule was updated successfully.",
      toolResults: [],
      hasPendingAction: false,
      persistenceMode: "durable",
    });

    expect(result.text).not.toContain("updated successfully");
    expect(result.text).toContain("실제 실행 결과가 확인되지 않아");
  });

  it("keeps a purely negative English persistence statement", () => {
    const text = "The budget was not saved.";
    const result = composeAmoraPersistenceTerminal({
      text,
      toolResults: [],
      hasPendingAction: false,
      persistenceMode: "durable",
    });

    expect(result).toMatchObject({ text, corrected: false, source: "provider" });
  });

  it.each([
    "드레스 투어 일정 저장 완료예요.",
    "드레스 투어 일정이 저장되어 있어요.",
    "드레스 투어 일정을 캘린더에 넣었어요.",
    "드레스 투어 일정을 바꿔뒀어요.",
    "드레스 투어 일정을 처리해드렸어요.",
    "Saved successfully.",
  ])("blocks another unsupported completion form: %s", (text) => {
    const result = composeAmoraPersistenceTerminal({
      text,
      toolResults: [],
      hasPendingAction: false,
      persistenceMode: "durable",
    });

    expect(result.text).not.toContain(text);
    expect(result.text).toContain("실제 실행 결과가 확인되지 않아");
  });

  it.each([
    "웨딩홀 선호는 강남으로 기억해둘게요.",
    "말씀하신 예산을 기억하고 있을게요.",
    "말씀하신 취향은 제가 기억해 드릴게요.",
    "이 일정 기준은 앞으로 기억해 놓겠습니다.",
    "I will remember that venue preference.",
    "We’ll remember that budget limit.",
  ])("does not present an uncompiled long-term memory as already remembered: %s", (text) => {
    const result = composeAmoraPersistenceTerminal({
      text,
      toolResults: [],
      hasPendingAction: false,
      persistenceMode: "durable",
    });

    expect(result.text).not.toContain(text);
    expect(result.text).toContain("실제 실행 결과가 확인되지 않아");
  });
});

describe("guardUnverifiedAmoraPersistenceClaims", () => {
  it.each([
    "총예산을 3,000만 원으로 반영했어요.",
    "총예산을 3,000만 원으로 반영해드렸어요.",
    "드레스 투어 일정을 저장해뒀어요.",
    "드레스 투어 일정을 저장해놨어요.",
    "예식장을 새 장소로 변경했습니다.",
    "예식장 변경 완료했어요.",
    "기존 일정을 삭제했어요.",
    "체크리스트에 추가됐어요.",
  ])("removes an affirmative write claim without a mutation receipt: %s", (text) => {
    const result = guardUnverifiedAmoraPersistenceClaims({
      text,
      hasVerifiedMutationReceipt: false,
      hasPendingAction: false,
    });

    expect(result.corrected).toBe(true);
    expect(result.removedClaimCount).toBe(1);
    expect(result.text).not.toContain(text);
    expect(result.text).toContain("실제 실행 결과가 확인되지 않아");
    expect(result.text).toContain("아직 반영되지 않았어요");
  });

  it("keeps useful prose while removing only the unverified success sentence", () => {
    const result = guardUnverifiedAmoraPersistenceClaims({
      text: "예산이 넉넉하지 않아 우선순위를 정하는 게 좋아요. 총예산은 3,000만 원으로 반영했어요.",
      hasVerifiedMutationReceipt: false,
      hasPendingAction: false,
    });

    expect(result.text).toContain("예산이 넉넉하지 않아 우선순위를 정하는 게 좋아요.");
    expect(result.text).not.toContain("3,000만 원으로 반영했어요");
    expect(result.text).toContain("아직 반영되지 않았어요");
  });

  it("uses a pending-specific disclosure instead of claiming completion", () => {
    const result = guardUnverifiedAmoraPersistenceClaims({
      text: "예식일을 변경했어요.",
      hasVerifiedMutationReceipt: false,
      hasPendingAction: true,
    });

    expect(result.text).toBe(
      "아직 실제 준비에는 반영되지 않았어요. 아래 확인 내용을 검토해주세요.",
    );
  });

  it.each([
    "예산은 아직 반영되지 않았어요.",
    "\"저장했어요\"라는 문구는 실제 실행 결과가 아니에요.",
    "만약 일정을 변경했다면 업체에도 확인해주세요.",
    "예산 변경을 도와드릴게요.",
  ])("does not rewrite a negative, quoted, hypothetical, or future statement: %s", (text) => {
    expect(guardUnverifiedAmoraPersistenceClaims({
      text,
      hasVerifiedMutationReceipt: false,
      hasPendingAction: false,
    })).toEqual({
      text,
      corrected: false,
      removedClaimCount: 0,
    });
  });

  it("allows an affirmative claim only when a successful mutation receipt exists", () => {
    const text = "총예산을 3,000만 원으로 반영했어요.";
    expect(guardUnverifiedAmoraPersistenceClaims({
      text,
      hasVerifiedMutationReceipt: true,
      hasPendingAction: false,
    })).toEqual({
      text,
      corrected: false,
      removedClaimCount: 0,
    });
  });
});

/**
 * 2026-08-22 스테이징 라이브에서 사용자가 실제로 본 답변.
 *
 * "친구는 스드메에 600만원 썼대" 라고만 했는데 돌아온 것:
 *
 *     다만 업체마다 포함 구성과 별도 금액이 달라서, …
 *     …먼저 정하면 돼요.
 *     실제 실행 결과가 확인되지 않아 이 변경은 아직 반영되지 않았어요.
 *     변경할 내용을 확인한 뒤 다시 요청해주세요.
 *
 * 두 가지가 잘못됐다. 앞 문장이 거짓 주장이라 지워지면서 **"다만" 만 남았고**,
 * 요청하지도 않은 변경의 **실패 안내**가 붙었다.
 */
describe("지운 자리를 수습한다", () => {
  it("앞 문장이 지워져도 접속사만 남기지 않는다", () => {
    const result = composeAmoraPersistenceTerminal({
      text: "스드메 예산을 600만 원으로 반영했어요. 다만 업체마다 포함 구성이 달라요.",
      toolResults: [],
      hasPendingAction: false,
      persistenceMode: "durable",
    });

    expect(result.text).not.toContain("반영했어요");
    expect(result.text.startsWith("다만")).toBe(false);
    expect(result.text).toContain("업체마다 포함 구성이 달라요");
  });

  it("사용자가 변경을 요청하지 않았으면 실패 안내를 붙이지 않는다", () => {
    const result = composeAmoraPersistenceTerminal({
      text: "스드메 예산을 600만 원으로 반영했어요. 업체마다 포함 구성이 달라요.",
      toolResults: [],
      hasPendingAction: false,
      persistenceMode: "durable",
      userRequestedChange: false,
    });

    expect(result.text).not.toContain("반영했어요");
    expect(result.text).not.toContain("다시 요청해주세요");
    expect(result.text).toContain("업체마다 포함 구성이 달라요");
    expect(result.corrected).toBe(true);
  });

  it("변경을 요청한 턴에서는 그대로 알린다", () => {
    const result = composeAmoraPersistenceTerminal({
      text: "스드메 예산을 600만 원으로 반영했어요.",
      toolResults: [],
      hasPendingAction: false,
      persistenceMode: "durable",
      userRequestedChange: true,
    });

    expect(result.text).toContain("실제 실행 결과가 확인되지 않아");
  });

  it("확인 카드가 나온 턴은 요청 여부와 무관하게 안내한다", () => {
    const result = composeAmoraPersistenceTerminal({
      text: "예산을 반영했어요.",
      toolResults: [],
      hasPendingAction: true,
      persistenceMode: "durable",
      userRequestedChange: false,
    });

    expect(result.text).toContain("아직 실제 준비에는 반영되지 않았어요");
  });
});

/**
 * 2026-08-22 라이브. 문장을 지우니 강조 구간이 문단을 가로질렀다:
 *
 *     우리 예산은 아직 **400만 원으로 확정되지 않았어요.
 *
 *     ** 400만 원과 600만 원 중 어느 쪽을…
 *
 * 마크다운은 문단을 넘는 강조를 허용하지 않아 별표가 글자 그대로 보였다.
 */
describe("지우면서 강조가 쪼개지지 않는다", () => {
  it("짝이 문단을 가로지르면 강조를 지운다", () => {
    const result = composeAmoraPersistenceTerminal({
      text: [
        "우리 예산은 아직 **400만 원으로 확정되지 않았어요.",
        "예산을 400만 원으로 저장했어요.",
        "** 400만 원과 600만 원 중 어느 쪽으로 할까요?",
      ].join("\n"),
      toolResults: [],
      hasPendingAction: false,
      persistenceMode: "durable",
      userRequestedChange: false,
    });

    for (const paragraph of result.text.split("\n\n")) {
      const markers = paragraph.match(/\*\*/g) ?? [];
      expect(markers.length % 2).toBe(0);
    }
    expect(result.text).not.toContain("저장했어요");
  });

  it("한 문단 안에서 짝이 맞는 강조는 그대로 둔다", () => {
    const result = composeAmoraPersistenceTerminal({
      text: "예산을 저장했어요. 지금은 **400만 원**이 기준이에요.",
      toolResults: [],
      hasPendingAction: false,
      persistenceMode: "durable",
      userRequestedChange: false,
    });

    expect(result.text).toContain("**400만 원**");
  });
});

/**
 * 2026-09-14 출시 실사. 프롬프트가 `### 등록된 일정` 과 예산 요약을 문맥에 인라인하므로
 * "상견례 일정 언제야?" 같은 읽기 턴은 도구를 하나도 안 돌린다. 그런데 상태 서술
 * 정규식은 **성공한 읽기 영수증이 있을 때만** 봐줬기 때문에, 영수증 없는 읽기 답
 *
 *     10월 5일 오후 12시로 등록되어 있어요.
 *     드레스 예산은 450만 원으로 설정되어 있어요.
 *
 * 이 통째로 지워지고 "지금은 답을 만들지 못했어요. 한 번 더 물어봐 주세요." 만 나갔다 —
 * 다시 물어도 같다. 변경 요청이 아닌 턴(요청 없음·카드 없음)의 상태 서술은 영수증과
 * 무관하게 남기고, 실행 주장("변경했어요")과 미래 약속은 변함없이 지운다.
 */
describe("도구 없는 읽기 턴의 상태 서술은 지우지 않는다", () => {
  const readTurn = {
    toolResults: [],
    hasPendingAction: false,
    persistenceMode: "durable" as const,
    userRequestedChange: false,
  };

  it.each([
    "10월 5일 오후 12시로 등록되어 있어요.",
    "드레스 예산은 450만 원으로 설정되어 있어요.",
    "상견례 일정은 10월 5일 오후 12시로 등록돼 있어요.",
    "총예산은 3,500만 원으로 저장되어 있습니다.",
    "예식장은 그랜드호텔로 확정돼 있습니다.",
    "결혼 예정일은 2027년 5월 16일로 설정되어 있다.",
    "청첩장 발송은 완료로 기록되어 있어요.",
    "상견례 일정은 10월 5일 오후 12시로 등록되어 있어요. 장소는 아직 정해지지 않았어요.",
  ])("그대로 내보낸다: %s", (text) => {
    const result = composeAmoraPersistenceTerminal({ ...readTurn, text });
    expect(result.text).toBe(text);
    expect(result.text).not.toBe(SERVER_OWNED_EMPTY_ANSWER_NOTICE);
    expect(result.removedClaimCount).toBe(0);
    expect(result.corrected).toBe(false);
    expect(result.source).toBe("provider");
  });

  it.each([
    "상견례 일정을 10월 5일 오후 12시로 변경했어요.",
    "드레스 예산을 450만 원으로 저장했어요.",
    "총예산을 3,500만 원으로 반영했어요.",
    "예식장을 그랜드호텔로 등록해 뒀어요.",
    "결혼 예정일을 2027년 5월 16일로 설정했습니다.",
    "청첩장 발송을 완료 처리했어요.",
    "드레스 예산 450만 원으로 저장할게요.",
  ])("같은 턴이라도 실행 주장과 약속은 여전히 지운다: %s", (text) => {
    const result = composeAmoraPersistenceTerminal({ ...readTurn, text });
    expect(result.text).not.toContain(text);
    expect(result.text).toBe(SERVER_OWNED_EMPTY_ANSWER_NOTICE);
    expect(result.removedClaimCount).toBe(1);
    expect(result.source).toBe("server_correction");
  });

  it("상태 서술은 남기고 같은 답의 실행 주장만 지운다", () => {
    const result = composeAmoraPersistenceTerminal({
      ...readTurn,
      text: "상견례 일정은 10월 5일 오후 12시로 등록되어 있어요. 장소는 한정식집으로 저장했어요.",
    });
    expect(result.text).toBe("상견례 일정은 10월 5일 오후 12시로 등록되어 있어요.");
    expect(result.text).not.toContain(SERVER_OWNED_UNVERIFIED_NOTICE);
    expect(result.removedClaimCount).toBe(1);
    expect(result.source).toBe("server_correction");
  });

  it.each([
    "10월 5일 오후 12시로 등록되어 있어요.",
    "드레스 예산은 450만 원으로 설정되어 있어요.",
  ])("변경을 요청한 턴에서는 같은 상태 서술을 영수증 없이 믿지 않는다: %s", (text) => {
    const result = composeAmoraPersistenceTerminal({ ...readTurn, text, userRequestedChange: true });
    expect(result.text).not.toContain(text);
    expect(result.text).toBe(SERVER_OWNED_UNVERIFIED_NOTICE);
  });

  it("확인 카드가 살아 있는 턴에서는 상태 서술을 카드 확인 전 사실로 내보내지 않는다", () => {
    const result = composeAmoraPersistenceTerminal({
      ...readTurn, hasPendingAction: true, text: "드레스 예산은 450만 원으로 설정되어 있어요.",
    });
    expect(result.text).not.toContain("설정되어 있어요");
    expect(result.text).toContain("아직 실제 준비에는 반영되지 않았어요");
  });

  it("이월 카드가 실린 턴에서도 상태 서술을 카드 확인 전 사실로 내보내지 않는다", () => {
    const text = "드레스 예산은 450만 원으로 설정되어 있어요.";
    const result = composeAmoraPersistenceTerminal({ ...readTurn, hasEmittedPendingAction: true, text });
    expect(result.text).not.toContain("설정되어 있어요");
    expect(result.removedClaimCount).toBe(1);
  });

  /**
   * 2차 검토(2026-09-14). 라우트의 `userRequestedChange` 는 **제안 도구가 열렸을 때만** 참이다
   * (`pendingOfferEnabled && isExplicitAmoraChangeRequest(lastUserText)`). 그래서 "총예산
   * 5천만원으로 바꿔 ㅋㅋ" 처럼 도구가 하나도 안 열린 변경 요청 턴은 요청 아님으로 들어오고,
   * 위 봐주기가 "총예산은 5천만 원으로 설정되어 있어요." 를 상태 서술로 살려 보냈다 —
   * 사용자는 바꿨다고 믿는다. 발화 자체의 요청 판정(`userTurnIsChangeRequest`)을 도구 관문과
   * 떼어 따로 받고, "…완료예요"·"반영되어 있어요" 같은 완료 주장은 읽기 턴에서도 지운다.
   */
  const changeAsk = "총예산 5천만원으로 바꿔 ㅋㅋ";
  const readAsk = "상견례 일정 언제야?";

  it("발화가 변경 요청이면 제안 도구가 안 열렸어도 상태 서술을 영수증 없이 믿지 않는다", () => {
    expect(isExplicitAmoraChangeRequest(changeAsk)).toBe(true);
    const text = "총예산은 5천만 원으로 설정되어 있어요.";
    const result = composeAmoraPersistenceTerminal({
      ...readTurn, text, userRequestedChange: false,
      userTurnIsChangeRequest: isExplicitAmoraChangeRequest(changeAsk),
    });
    expect(result.text).not.toContain(text);
    expect(result.text).toBe(SERVER_OWNED_EMPTY_ANSWER_NOTICE);
    expect(result.removedClaimCount).toBe(1);
    expect(result.source).toBe("server_correction");
  });

  it("읽기 발화의 상태 서술은 발화 판정을 거쳐도 그대로 나간다", () => {
    expect(isExplicitAmoraChangeRequest(readAsk)).toBe(false);
    const text = "10월 5일 오후 12시로 등록되어 있어요.";
    const result = composeAmoraPersistenceTerminal({
      ...readTurn, text, userTurnIsChangeRequest: isExplicitAmoraChangeRequest(readAsk),
    });
    expect(result.text).toBe(text);
    expect(result.removedClaimCount).toBe(0);
    expect(result.source).toBe("provider");
  });

  it.each([
    "예산 반영 완료예요.",
    "총예산 5천만 원 설정 완료예요.",
    "총예산 5천만 원으로 등록 완료입니다.",
    "저장 완료예요.",
    "이제 예산표에 반영되어 있어요.",
    "총예산이 5천만 원으로 변경되어 있어요.",
    "상견례 일정이 10월 5일로 수정되어 있어요.",
  ])("읽기 턴이라도 완료 주장은 상태 서술이 아니다 — 영수증 없이 지운다: %s", (text) => {
    const result = composeAmoraPersistenceTerminal({
      ...readTurn, text, userTurnIsChangeRequest: isExplicitAmoraChangeRequest(readAsk),
    });
    expect(result.text).not.toContain(text);
    expect(result.text).toBe(SERVER_OWNED_EMPTY_ANSWER_NOTICE);
    expect(result.removedClaimCount).toBe(1);
  });

  it("한 답에 상태 서술과 완료 주장이 섞이면 완료 주장만 지운다", () => {
    const result = composeAmoraPersistenceTerminal({
      ...readTurn, userTurnIsChangeRequest: false,
      text: "총예산은 5천만 원으로 설정되어 있어요. 이제 예산표에 반영되어 있어요.",
    });
    expect(result.text).toBe("총예산은 5천만 원으로 설정되어 있어요.");
    expect(result.removedClaimCount).toBe(1);
  });
});

/**
 * 3차 검토(2026-09-14). 2차 수정이 세 가지를 HEAD 보다 뒤로 물렸다.
 *
 *  1. "…반영되어 있어요"·"…적용되어 있어요" 를 **무조건** 지웠다. 성공한 읽기 영수증이
 *     있는 읽기 턴에서 HEAD 는 `verifiedByRead` 로 살렸는데 트리는 중립 안내로 바꿨다.
 *  2. 이월 카드(`hasEmittedPendingAction`)가 실리면 영수증이 있어도 상태 서술을 지웠다.
 *     카드는 최대 2턴 이월되므로 "상견례 일정 언제야?" 를 다시 물어도 같은 증상이 난다.
 *  3. `isExplicitAmoraChangeRequest` 가 부분일치라 "예산 설정돼 있는 거 맞아?" 같은
 *     **상태 질문**이 변경 요청으로 읽혀, 영수증이 있는 참 답이 거짓 사과로 바뀌었다.
 *
 * 그리고 `잡았/맞췄` 가 완료형 어휘에 없어 "드레스 예산을 300만 원으로 잡았어요." 가
 * 카드도 안내도 없이 그대로 나갔다.
 */
describe("3차 검토(2026-09-14): 읽기 영수증·이월 카드·상태 질문·잡았/맞췄", () => {
  const readReceipt = (toolName: string, success = true) => ({
    toolName, toolInput: {}, toolOutput: { ok: success }, success, displayMessage: "",
  }) as never;
  const readTurn = {
    hasPendingAction: false,
    persistenceMode: "durable" as const,
    userRequestedChange: false,
    userTurnIsChangeRequest: false,
  };

  describe("(1) 성공한 읽기 영수증이 있는 읽기 턴의 '…되어 있어요' 는 상태 서술이다", () => {
    it.each([
      "드레스 예산은 450만 원으로 반영되어 있어요.",
      "현재 예산표에는 드레스 450만 원으로 적용되어 있어요.",
      "총예산이 5천만 원으로 변경되어 있어요.",
      "상견례 일정이 10월 5일로 수정되어 있어요.",
    ])("그대로 내보낸다: %s", (text) => {
      const result = composeAmoraPersistenceTerminal({
        ...readTurn, text, toolResults: [readReceipt("get_budget_summary")],
      });
      expect(result.text).toBe(text);
      expect(result.removedClaimCount).toBe(0);
      expect(result.corrected).toBe(false);
      expect(result.source).toBe("provider");
    });

    it.each([
      "예산 반영 완료예요.",
      "총예산 5천만 원으로 등록 완료입니다.",
      "저장 완료예요.",
    ])("읽기 영수증이 있어도 '…완료예요' 는 완료 주장이라 지운다: %s", (text) => {
      const result = composeAmoraPersistenceTerminal({
        ...readTurn, text, toolResults: [readReceipt("get_budget_summary")],
      });
      expect(result.text).not.toContain(text);
      expect(result.text).toBe(SERVER_OWNED_EMPTY_ANSWER_NOTICE);
      expect(result.removedClaimCount).toBe(1);
    });

    it.each([
      "이제 예산표에 반영되어 있어요.",
      "드레스 예산은 450만 원으로 반영되어 있어요.",
      "현재 예산표에는 드레스 450만 원으로 적용되어 있어요.",
    ])("영수증이 없는 읽기 턴에서는 같은 문장을 여전히 지운다: %s", (text) => {
      const result = composeAmoraPersistenceTerminal({ ...readTurn, text, toolResults: [] });
      expect(result.text).toBe(SERVER_OWNED_EMPTY_ANSWER_NOTICE);
      expect(result.removedClaimCount).toBe(1);
    });

    it("실패한 읽기 영수증은 검증이 아니다", () => {
      const text = "드레스 예산은 450만 원으로 반영되어 있어요.";
      const result = composeAmoraPersistenceTerminal({
        ...readTurn, text, toolResults: [readReceipt("get_budget_summary", false)],
      });
      expect(result.text).toBe(SERVER_OWNED_EMPTY_ANSWER_NOTICE);
      expect(result.removedClaimCount).toBe(1);
    });

    it("변경 발화 턴에서는 읽기 영수증이 있어도 '…반영되어 있어요' 를 지운다", () => {
      const text = "총예산이 5천만 원으로 변경되어 있어요.";
      const receipt = [readReceipt("get_budget_summary")];
      expect(composeAmoraPersistenceTerminal({
        ...readTurn, text, toolResults: receipt, userTurnIsChangeRequest: true,
      }).text).toBe(SERVER_OWNED_EMPTY_ANSWER_NOTICE);
      expect(composeAmoraPersistenceTerminal({
        ...readTurn, text, toolResults: receipt, userRequestedChange: true, userTurnIsChangeRequest: true,
      }).text).toBe(SERVER_OWNED_UNVERIFIED_NOTICE);
    });

    it("읽기 영수증이 있어도 실행 주장('변경했어요')과 약속은 지운다", () => {
      for (const text of ["드레스 예산을 450만 원으로 변경했어요.", "드레스 예산 450만 원으로 반영할게요."]) {
        const result = composeAmoraPersistenceTerminal({
          ...readTurn, text, toolResults: [readReceipt("get_budget_summary")],
        });
        expect(result.text, text).toBe(SERVER_OWNED_EMPTY_ANSWER_NOTICE);
        expect(result.removedClaimCount, text).toBe(1);
      }
    });
  });

  describe("(2) 이월 카드가 실린 읽기 턴", () => {
    const stateAnswer = "10월 5일 오후 12시로 등록되어 있어요.";

    it("성공한 읽기 영수증이 있으면 상태 서술을 그대로 낸다 — 다시 물어도 같다", () => {
      expect(isExplicitAmoraChangeRequest("상견례 일정 언제야?")).toBe(false);
      const result = composeAmoraPersistenceTerminal({
        ...readTurn, text: stateAnswer, hasEmittedPendingAction: true,
        toolResults: [readReceipt("get_schedule_events")],
      });
      expect(result.text).toBe(stateAnswer);
      expect(result.removedClaimCount).toBe(0);
      expect(result.source).toBe("provider");
    });

    it("영수증이 없으면 이월 카드 턴의 상태 서술은 여전히 지운다", () => {
      const result = composeAmoraPersistenceTerminal({
        ...readTurn, text: stateAnswer, hasEmittedPendingAction: true, toolResults: [],
      });
      expect(result.text).not.toContain(stateAnswer);
      expect(result.removedClaimCount).toBe(1);
    });

    it("이월 카드 턴의 완료 주장은 영수증이 있어도 지운다", () => {
      const result = composeAmoraPersistenceTerminal({
        ...readTurn, text: "예산 반영 완료예요.", hasEmittedPendingAction: true,
        toolResults: [readReceipt("get_budget_summary")],
      });
      expect(result.text).toBe(SERVER_OWNED_EMPTY_ANSWER_NOTICE);
      expect(result.removedClaimCount).toBe(1);
    });

    it("새 카드가 살아 있는 턴(hasPendingAction)은 영수증이 있어도 상태 서술을 지운다", () => {
      const result = composeAmoraPersistenceTerminal({
        ...readTurn, text: stateAnswer, hasPendingAction: true, hasEmittedPendingAction: true,
        toolResults: [readReceipt("get_schedule_events")],
      });
      expect(result.text).not.toContain(stateAnswer);
      expect(result.text).toContain("아직 실제 준비에는 반영되지 않았어요");
    });

    const changeAsk = "총예산 5천만원으로 바꿔 ㅋㅋ";
    it.each([
      ["영수증 없음", []],
      ["읽기 영수증 있음", [readReceipt("get_budget_summary")]],
    ])("변경 발화 + 상태 서술은 영수증과 무관하게 지운다: %s", (_label, toolResults) => {
      expect(isExplicitAmoraChangeRequest(changeAsk)).toBe(true);
      const text = "총예산은 5천만 원으로 설정되어 있어요.";
      const noTool = composeAmoraPersistenceTerminal({
        ...readTurn, text, toolResults, userTurnIsChangeRequest: isExplicitAmoraChangeRequest(changeAsk),
      });
      expect(noTool.text).toBe(SERVER_OWNED_EMPTY_ANSWER_NOTICE);
      expect(noTool.removedClaimCount).toBe(1);
      const toolOpened = composeAmoraPersistenceTerminal({
        ...readTurn, text, toolResults, userRequestedChange: true,
        userTurnIsChangeRequest: isExplicitAmoraChangeRequest(changeAsk),
      });
      expect(toolOpened.text).toBe(SERVER_OWNED_UNVERIFIED_NOTICE);
    });
  });

  describe("(3) 상태를 묻는 발화는 변경 요청이 아니다", () => {
    const stateQuestions: Array<[string, string, string]> = [
      ["예산 설정돼 있는 거 맞아?", "총예산은 5천만 원으로 설정되어 있어요.", "get_budget_summary"],
      ["상견례 일정 등록돼 있어?", "네, 10월 5일 오후 12시로 등록되어 있어요.", "get_schedule_events"],
      ["드레스 예산 반영됐어?", "드레스 예산은 300만 원으로 설정되어 있어요.", "get_budget_summary"],
    ];

    it.each(stateQuestions)("%s → 읽기 턴: 영수증이 있으면 참 답을 그대로 낸다", (ask, text, tool) => {
      expect(isExplicitAmoraChangeRequest(ask)).toBe(false);
      // 라우트: userRequestedChange = pendingOfferEnabled && isExplicit(...), 제안 도구가 열렸다고 가정.
      const result = composeAmoraPersistenceTerminal({
        ...readTurn, text, toolResults: [readReceipt(tool)],
        userRequestedChange: isExplicitAmoraChangeRequest(ask),
        userTurnIsChangeRequest: isExplicitAmoraChangeRequest(ask),
      });
      expect(result.text).toBe(text);
      expect(result.text).not.toContain("아직 반영되지 않았어요");
      expect(result.removedClaimCount).toBe(0);
      expect(result.source).toBe("provider");
    });

    it.each(stateQuestions)("%s → 도구 없는 읽기 턴도 그대로 낸다", (ask, text) => {
      const result = composeAmoraPersistenceTerminal({
        ...readTurn, text, toolResults: [],
        userRequestedChange: isExplicitAmoraChangeRequest(ask),
        userTurnIsChangeRequest: isExplicitAmoraChangeRequest(ask),
      });
      expect(result.text).toBe(text);
      expect(result.removedClaimCount).toBe(0);
    });

    it.each([
      "총예산 설정돼 있나요?",
      "상견례 일정 등록되어 있는지 알려줘",
      "드레스 예산 반영됐나요",
      "예식장 확정된 거야?",
      "예산 5천으로 변경돼 있어 ㅋㅋ",
      "상견례 일정 등록되어 있습니까?",
      "그 일정 저장돼 있는 거 맞지?",
    ])("다른 상태 질문 모양도 요청이 아니다: %s", (ask) => {
      expect(isExplicitAmoraChangeRequest(ask)).toBe(false);
    });

    it.each([
      "예산 설정돼 있어? 아니면 5천으로 바꿔줘",
      "등록돼 있는 상견례 일정 취소해줘",
      "드레스 예산 반영됐어? 안 됐으면 반영해줘",
      "지금 저장돼 있는 값 말고 300만원으로 잡아줘",
      "총예산 5천만원으로 바꿔 ㅋㅋ",
      "우리 총 예산 4000만원으로 잡아줘",
    ])("상태 질문 뒤에 붙은 변경 요청은 그대로 요청이다: %s", (ask) => {
      expect(isExplicitAmoraChangeRequest(ask)).toBe(true);
    });
  });

  describe("(4) 변경 턴의 '잡았/맞췄' 는 저장 주장이다", () => {
    const changeTurn = {
      toolResults: [],
      hasPendingAction: false,
      persistenceMode: "durable" as const,
      userRequestedChange: true,
      userTurnIsChangeRequest: true,
    };

    it.each([
      "드레스 예산을 300만 원으로 잡았어요.",
      "드레스 예산을 300만 원으로 잡았습니다.",
      "드레스 예산을 300만 원으로 맞췄어요.",
      "드레스 예산을 300만 원으로 잡아 두었어요.",
      "상견례 날짜를 10월 5일로 잡아 뒀어요.",
      "드레스 예산은 300만 원에 맞춰 놓았어요.",
      "드레스 예산을 300만 원으로 잡아 드렸어요.",
    ])("영수증 없이 지우고 안내를 붙인다: %s", (text) => {
      expect(isExplicitAmoraChangeRequest("드레스 300만원으로 잡아줘 ㅎㅎ")).toBe(true);
      const result = composeAmoraPersistenceTerminal({ ...changeTurn, text });
      expect(result.text).not.toContain(text);
      expect(result.text).toContain(SERVER_OWNED_UNVERIFIED_NOTICE);
      expect(result.removedClaimCount).toBe(1);
      expect(result.source).toBe("server_correction");
    });

    it.each([
      "예산 잡았던 게 언제였지?",
      "예산을 300만 원으로 잡았던 걸로 기억해요.",
      "300만 원으로 잡았을 때 남는 금액은 없어요.",
      "300만 원으로 잡았다면 드레스는 여유가 있어요.",
      "예산을 300만 원에 맞췄을 경우 사진은 줄여야 해요.",
      "예산을 300만 원으로 잡았나요?",
      "요즘은 자연스러운 야외 촬영이 자리를 잡았어요.",
      "이제 감을 잡았어요.",
      "예산을 300만 원으로 저장했던 게 언제였죠?",
    ])("회상·가정·질문·관용구는 잡지 않는다: %s", (text) => {
      const result = composeAmoraPersistenceTerminal({ ...changeTurn, text });
      expect(result.text).toBe(text);
      expect(result.removedClaimCount).toBe(0);
      expect(result.source).toBe("provider");
    });

    it("한 답에서 회상은 남기고 주장만 지운다", () => {
      const result = composeAmoraPersistenceTerminal({
        ...changeTurn,
        text: "예산을 300만 원으로 잡았던 걸로 기억해요. 이번에는 350만 원으로 잡았어요.",
      });
      expect(result.text).toContain("예산을 300만 원으로 잡았던 걸로 기억해요.");
      expect(result.text).not.toContain("350만 원으로 잡았어요");
      expect(result.text).toContain(SERVER_OWNED_UNVERIFIED_NOTICE);
      expect(result.removedClaimCount).toBe(1);
    });
  });

  /**
   * 4차 검토(2026-09-14). (4) 의 어휘를 **모든 턴**에서 봤더니 변경을 요청하지 않은 턴의
   * 설명 문장("식대는 1인 7만 원으로 잡았어요" — 추정, "세 벌 모두 두 분 예산에 맞췄어요" —
   * 추천 근거)이 안내 없이 조용히 지워졌고, 한 문장짜리 답은 빈 안내가 됐다. 그 묶음은
   * 변경 요청 턴·카드가 살아 있는 턴에서만 본다.
   */
  describe("(5) 변경을 요청하지 않은 턴의 '잡았/맞췄' 는 설명이다", () => {
    const planTurn = {
      toolResults: [],
      hasPendingAction: false,
      persistenceMode: "durable" as const,
      userRequestedChange: false,
      userTurnIsChangeRequest: false,
    };

    it.each([
      "식대는 1인 7만 원으로 잡았어요. 하객 200명이면 1,400만 원이에요. 이대로 적용할까요?",
      "하객은 200명 기준으로 잡았어요. 양가 100명씩이면 무난해요.",
      "세 벌 모두 두 분 예산에 맞췄어요. 첫 번째는 클래식한 실루엣이에요.",
      "추천은 두 분 일정에 맞췄어요. 주말 오전 촬영이 가장 여유로워요.",
      "후보는 강남 쪽 세 곳으로 잡았어요.",
    ])("그대로 내보낸다: %s", (text) => {
      const result = composeAmoraPersistenceTerminal({ ...planTurn, text });
      expect(result.text).toBe(text);
      expect(result.removedClaimCount).toBe(0);
      expect(result.source).toBe("provider");
    });

    it.each([
      { label: "도구가 안 열린 변경 요청", turn: { userRequestedChange: false, userTurnIsChangeRequest: true } },
      { label: "카드가 살아 있는 턴", turn: { userRequestedChange: false, userTurnIsChangeRequest: false, hasEmittedPendingAction: true } },
    ])("$label 에서는 같은 문장이 저장 주장이다", ({ turn }) => {
      const text = "드레스 예산을 300만 원으로 잡았어요.";
      const result = composeAmoraPersistenceTerminal({ ...planTurn, ...turn, text });
      expect(result.text).not.toContain(text);
      expect(result.removedClaimCount).toBe(1);
      expect(result.source).toBe("server_correction");
    });
  });
});
