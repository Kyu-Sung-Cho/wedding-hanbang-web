import { describe, expect, it } from "vitest";
import {
  validateCompatibleTodayOneCareResponse,
  validateTodayOneCareLegacyResponse,
  validateTodayOneCareResponse,
} from "@hanbang/shared";

const USER_ID = "10000000-0000-4000-8000-000000000001";

function response() {
  return {
    version: 2,
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

function decisionFollowUpResponse() {
  const value = response();
  value.card.sourceKey = "decision:30000000-0000-4000-8000-000000000001";
  value.card.kind = "decision_follow_up";
  value.card.whyNow = "직접 확인한 결정이 반영된 뒤 하루가 지났어요.";
  value.card.confirmed = ["결정: 총예산을 3천만원으로 확정"];
  value.card.unknown = [];
  value.card.nextAction = { label: "예산 열기", href: "/budget" };
  value.card.choices[0] = { action: "open_source", label: "예산 열기" };
  return value;
}

function scheduleCareResponse() {
  const value = response();
  return {
    ...value,
    card: {
      ...value.card,
      care: {
        version: 1,
        momentType: "sanggyeonrye",
        attentionWindow: "d1",
        guidance: "내일 양쪽 부모님이 함께 만나. 필요한 것만 마지막으로 맞춰보자.",
        checklist: ["예약·참석 인원 최종 확인", "쉬어갈 신호 정하기"],
        script: "자세한 결정은 저희가 정리해서 다시 말씀드릴게요.",
        relatedChecklist: {
          categoryKey: "meeting",
          categoryLabel: "부모님 첫 만남",
        },
        evidence: {
          refs: [
            { key: "canonical_schedule_event", label: "사용자가 저장한 일정" },
            { key: "canonical_checklist_category", label: "부모님 첫 만남 체크리스트" },
          ],
          limitations: ["가족마다 관습과 기대가 달라 정답으로 단정하지 않아요."],
        },
      },
    },
  };
}

function dressFittingCareResponse(attentionWindow: "d3" | "d1" | "dAfter" = "d1") {
  const value = response();
  value.card.sourceKey = `schedule:51f7f083:${attentionWindow === "dAfter" ? "d_after" : attentionWindow}`;
  return {
    ...value,
    card: {
      ...value.card,
      care: {
        version: 1,
        momentType: "dress_fitting",
        attentionWindow,
        guidance: attentionWindow === "d3"
          ? "드레스 수선 상태를 확인하기 사흘 전이야. 최근 착용감이 걱정되면 매장에 먼저 알려 확인하자."
          : "내일 드레스 수선 상태를 확인해. 입어보기만 하지 말고 실제로 움직여보자.",
        checklist: ["앉기·걷기·팔 들기 테스트"],
        relatedChecklist: {
          categoryKey: "dress",
          categoryLabel: "드레스·예식 정장",
        },
        evidence: {
          refs: [
            { key: "canonical_schedule_event", label: "사용자가 저장한 일정" },
            { key: "canonical_checklist_category", label: "드레스·예식 정장 체크리스트" },
            { key: "current_schedule_care_catalog", label: "현재 일정 준비 안내" },
          ],
          limitations: ["저장된 일정 밖의 최신 변경은 직접 확인해야 해요."],
        },
      },
    },
  };
}

describe("TodayOneCare shared response contract", () => {
  it("accepts a bounded owner-scoped v2 card", () => {
    expect(validateTodayOneCareResponse(response(), USER_ID)).toMatchObject({
      ok: true,
      value: { state: "ready", recipientUserId: USER_ID },
    });
  });

  it("accepts a strictly bounded structured care payload on a schedule card", () => {
    expect(validateTodayOneCareResponse(scheduleCareResponse(), USER_ID)).toMatchObject({
      ok: true,
      value: {
        card: {
          kind: "schedule_moment",
          care: {
            momentType: "sanggyeonrye",
            relatedChecklist: { categoryKey: "meeting" },
          },
        },
      },
    });
  });

  it("accepts a meeting budget destination only on family care", () => {
    const familyCare = scheduleCareResponse();
    Object.assign(familyCare.card.care, {
      relatedBudget: {
        categoryKey: "meeting",
        categoryLabel: "부모님 첫 만남",
      },
    });
    expect(validateTodayOneCareResponse(familyCare, USER_ID)).toMatchObject({
      ok: true,
      value: {
        card: {
          care: {
            relatedBudget: { categoryKey: "meeting" },
          },
        },
      },
    });

    const wrongBudget = scheduleCareResponse();
    Object.assign(wrongBudget.card.care, {
      relatedBudget: {
        categoryKey: "dress",
        categoryLabel: "드레스·예식 정장",
      },
    });
    expect(validateTodayOneCareResponse(wrongBudget, USER_ID)).toEqual({
      ok: false,
      reason: "card",
    });
  });

  it("accepts checklist-only dress fitting care for D-3 and D-1", () => {
    for (const attentionWindow of ["d3", "d1"] as const) {
      expect(validateTodayOneCareResponse(
        dressFittingCareResponse(attentionWindow),
        USER_ID,
      )).toMatchObject({
        ok: true,
        value: {
          card: {
            care: {
              momentType: "dress_fitting",
              attentionWindow,
              relatedChecklist: { categoryKey: "dress" },
            },
          },
        },
      });
    }
  });

  it("rejects dress fitting care outside D-3/D-1 or with a money destination", () => {
    expect(validateTodayOneCareResponse(
      dressFittingCareResponse("dAfter"),
      USER_ID,
    )).toEqual({ ok: false, reason: "card" });

    const budgetDestination = dressFittingCareResponse();
    Object.assign(budgetDestination.card.care, {
      relatedBudget: {
        categoryKey: "dress",
        categoryLabel: "드레스·예식 정장",
      },
    });
    expect(validateTodayOneCareResponse(budgetDestination, USER_ID)).toEqual({
      ok: false,
      reason: "card",
    });

    const wrongChecklist = dressFittingCareResponse();
    wrongChecklist.card.care.relatedChecklist = {
      categoryKey: "meeting",
      categoryLabel: "부모님 첫 만남",
    };
    expect(validateTodayOneCareResponse(wrongChecklist, USER_ID)).toEqual({
      ok: false,
      reason: "card",
    });

    const wrongEvidence = dressFittingCareResponse();
    wrongEvidence.card.care.evidence.refs[2] = {
      key: "curated_family_coordination_guidance",
      label: "가족 행사 중립 안내",
    };
    expect(validateTodayOneCareResponse(wrongEvidence, USER_ID)).toEqual({
      ok: false,
      reason: "card",
    });
  });

  it("rejects care whose attention window contradicts the canonical schedule source", () => {
    const value = scheduleCareResponse();
    value.card.care.attentionWindow = "dAfter";

    expect(validateTodayOneCareResponse(value, USER_ID)).toEqual({
      ok: false,
      reason: "card",
    });
  });

  it("rejects forged care evidence, extra nested fields, and care on another card kind", () => {
    const forgedEvidence = scheduleCareResponse();
    forgedEvidence.card.care.evidence.refs[0] = {
      key: "canonical_schedule_event",
      label: "검증되지 않은 외부 자료",
    };
    expect(validateTodayOneCareResponse(forgedEvidence, USER_ID)).toEqual({
      ok: false,
      reason: "card",
    });

    const extraField = scheduleCareResponse();
    Object.assign(extraField.card.care, { rawReason: "임의 원문" });
    expect(validateTodayOneCareResponse(extraField, USER_ID)).toEqual({
      ok: false,
      reason: "card",
    });

    const misplacedCare = scheduleCareResponse();
    misplacedCare.card.kind = "budget_guardrail";
    misplacedCare.card.sourceKey = "budget:recorded-total-over-total";
    misplacedCare.card.nextAction = { label: "예산 열기", href: "/budget" };
    expect(validateTodayOneCareResponse(misplacedCare, USER_ID)).toEqual({
      ok: false,
      reason: "card",
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

  it("accepts a decision follow-up only when it points to its bounded source surface", () => {
    expect(validateTodayOneCareResponse(decisionFollowUpResponse(), USER_ID)).toMatchObject({
      ok: true,
      value: { card: { kind: "decision_follow_up" } },
    });
  });

  it("rejects owner mismatch, unknown versions, and cards on non-ready states", () => {
    expect(validateTodayOneCareResponse(response(), "30000000-0000-4000-8000-000000000001"))
      .toEqual({ ok: false, reason: "owner" });
    expect(validateTodayOneCareResponse({ ...response(), version: 1 }, USER_ID))
      .toEqual({ ok: false, reason: "version" });
    expect(validateTodayOneCareResponse({ ...response(), state: "none" }, USER_ID))
      .toEqual({ ok: false, reason: "card" });
  });

  it("keeps the frozen v1 response strict and extension-free", () => {
    const legacy = { ...response(), version: 1 };
    expect(validateTodayOneCareLegacyResponse(legacy, USER_ID)).toMatchObject({
      ok: true,
    });

    const legacyCare = { ...scheduleCareResponse(), version: 1 };
    expect(validateTodayOneCareLegacyResponse(legacyCare, USER_ID)).toEqual({
      ok: false,
      reason: "card",
    });

    const legacyDecision = { ...decisionFollowUpResponse(), version: 1 };
    expect(validateTodayOneCareLegacyResponse(legacyDecision, USER_ID)).toEqual({
      ok: false,
      reason: "card",
    });
  });

  it("lets a current client read only an exact legacy response during rolling deploy", () => {
    const legacy = { ...response(), version: 1 };
    expect(validateCompatibleTodayOneCareResponse(legacy, USER_ID)).toMatchObject({
      ok: true,
      value: {
        version: 2,
        card: { kind: "schedule_moment" },
      },
    });

    const forgedLegacy = { ...scheduleCareResponse(), version: 1 };
    expect(validateCompatibleTodayOneCareResponse(forgedLegacy, USER_ID)).toEqual({
      ok: false,
      reason: "card",
    });
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
