import { describe, expect, it } from "vitest";
import { validateTodayOneCareResponse } from "@hanbang/shared";

const USER_ID = "10000000-0000-4000-8000-000000000001";

function response() {
  return {
    version: 1,
    state: "ready",
    recipientUserId: USER_ID,
    claimedForDate: "2026-08-02",
    card: {
      id: "20000000-0000-4000-8000-000000000001",
      revision: 0,
      sourceRevision: 7,
      sourceKey: "schedule:51f7f083:d1",
      kind: "schedule_moment",
      whyNow: "내일 상견례 일정이 있어요.",
      confirmed: ["일정: 상견례", "날짜: 2026-08-03 18:00"],
      unknown: ["업체·가족의 최신 변경 여부는 아직 확인되지 않았어요."],
      nextAction: { label: "일정 열기", href: "/schedule" },
      impact: "확인만 하며 일정이나 외부 서비스는 바꾸지 않아요.",
      choices: [
        { action: "open_source", label: "일정 열기" },
        { action: "snooze", label: "나중에" },
        { action: "dismiss", label: "오늘 닫기" },
        { action: "mute_source", label: "내용이 바뀔 때까지 숨기기" },
      ],
      expiresAt: "2026-08-03T15:00:00.000Z",
    },
  };
}

function budgetResponse() {
  const value = response();
  value.card.sourceKey = "budget:recorded-total-over-total";
  value.card.kind = "budget_guardrail";
  value.card.whyNow = "직접 기록한 지출 합계가 설정한 총예산보다 커졌어요.";
  value.card.confirmed = [
    "설정 총예산: 30,000,000원",
    "기록 지출 합계: 31,000,000원",
  ];
  value.card.unknown = [
    "기록 지출은 결제 완료 증빙이 아님",
    "환불·취소·최종 결제 여부는 이 기록만으로 확인되지 않아요.",
  ];
  value.card.nextAction = { label: "예산 열기", href: "/budget" };
  value.card.choices[0] = { action: "open_source", label: "예산 열기" };
  return value;
}

describe("TodayOneCare shared response contract", () => {
  it("accepts a bounded owner-scoped v1 card", () => {
    expect(validateTodayOneCareResponse(response(), USER_ID)).toMatchObject({
      ok: true,
      value: { state: "ready", recipientUserId: USER_ID },
    });
  });

  it("accepts a budget guardrail only with its exact budget destination", () => {
    expect(validateTodayOneCareResponse(budgetResponse(), USER_ID)).toMatchObject({
      ok: true,
      value: { card: { kind: "budget_guardrail" } },
    });

    const wrongDestination = budgetResponse();
    wrongDestination.card.nextAction = { label: "일정 열기", href: "/schedule" };
    expect(validateTodayOneCareResponse(wrongDestination, USER_ID)).toEqual({
      ok: false,
      reason: "card",
    });
  });

  it("accepts the 25장 2절 kinds only with their fixed next actions", () => {
    const withKind = (kind: string, label: string, href: string) => {
      const value = response();
      value.card.kind = kind;
      value.card.nextAction = { label, href };
      value.card.choices[0] = { action: "open_source", label };
      return value;
    };
    for (const [kind, label, href] of [
      ["task_deadline", "할 일 보기", "/lounge"],
      ["couple_decision", "정할 것 보기", "/halls/consultation"],
      ["couple_decision", "정할 것 보기", "/halls/letter"],
      ["inquiry_waiting", "문의 보기", "/halls/consultation"],
    ] as const) {
      expect(validateTodayOneCareResponse(withKind(kind, label, href), USER_ID).ok, `${kind} ${href}`).toBe(true);
    }
    for (const [kind, label, href] of [
      ["task_deadline", "할 일 보기", "/schedule"],
      ["task_deadline", "일정 열기", "/lounge"],
      ["couple_decision", "정할 것 보기", "/lounge"],
      ["inquiry_waiting", "문의 보기", "/halls/letter"],
      ["task_completed", "결과 보기", "/lounge"],
    ] as const) {
      expect(validateTodayOneCareResponse(withKind(kind, label, href), USER_ID).ok, `${kind} ${href}`).toBe(false);
    }
  });

  it("rejects owner mismatch, unknown versions, and cards on non-ready states", () => {
    expect(validateTodayOneCareResponse(response(), "30000000-0000-4000-8000-000000000001"))
      .toEqual({ ok: false, reason: "owner" });
    expect(validateTodayOneCareResponse({ ...response(), version: 2 }, USER_ID))
      .toEqual({ ok: false, reason: "version" });
    expect(validateTodayOneCareResponse({ ...response(), state: "none" }, USER_ID))
      .toEqual({ ok: false, reason: "card" });
  });

  it.each([
    "https://evil.example/steal",
    "//evil.example/steal",
    "/\\evil.example/steal",
    "javascript:alert(1)",
  ])("rejects unsafe navigation: %s", (href) => {
    const value = response();
    value.card.nextAction.href = href;
    expect(validateTodayOneCareResponse(value, USER_ID)).toEqual({
      ok: false,
      reason: "navigation",
    });
  });

  it("rejects duplicate choices, unsafe text, and unbounded fields", () => {
    const duplicateChoice = response();
    duplicateChoice.card.choices[1] = duplicateChoice.card.choices[0];
    expect(validateTodayOneCareResponse(duplicateChoice, USER_ID)).toEqual({
      ok: false,
      reason: "card",
    });

    const unsafeText = response();
    unsafeText.card.whyNow = "확인\u202E거짓";
    expect(validateTodayOneCareResponse(unsafeText, USER_ID)).toEqual({
      ok: false,
      reason: "card",
    });

    const tooManyUnknowns = response();
    tooManyUnknowns.card.unknown = Array.from({ length: 5 }, () => "미확인");
    expect(validateTodayOneCareResponse(tooManyUnknowns, USER_ID)).toEqual({
      ok: false,
      reason: "card",
    });
  });
});
