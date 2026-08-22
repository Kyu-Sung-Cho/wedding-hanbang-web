import { describe, expect, it } from "vitest";

import {
  composeAmoraPersistenceTerminal,
  guardUnverifiedAmoraPersistenceClaims,
} from "../amoraPersistenceClaims";

describe("composeAmoraPersistenceTerminal", () => {
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
