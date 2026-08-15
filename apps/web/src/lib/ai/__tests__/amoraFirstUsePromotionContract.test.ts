import {
  extractAmoraFirstUseActionDraft,
  validateAmoraFirstUsePromotionPreviewResponse,
} from "@hanbang/shared/amora-first-use-promotion";
import { describe, expect, it } from "vitest";

const OWNER = "11111111-1111-4111-8111-111111111111";
const COUPLE = "22222222-2222-4222-8222-222222222222";
const SOURCE = "33333333-3333-4333-8333-333333333333";
const SHARED_MESSAGE = "44444444-4444-4444-8444-444444444444";

describe("Amora first-use promotion response contract", () => {
  it("accepts only an exact current-owner ready preview", () => {
    const payload = {
      version: 1,
      state: "ready",
      ownerUserId: OWNER,
      coupleId: COUPLE,
      sourceMessageId: SOURCE,
      sourceRevision: 7,
      criterionDecisionId: null,
      canonicalDraft: {
        action: "이번 주 예식 후보 범위를 둘이 정하기",
        reason: "장소를 찾기 전에 기준을 먼저 맞추면 선택이 쉬워져요.",
        completionCriterion: "지역과 예상 인원을 각각 하나씩 적으면 끝나요.",
        sharedText: [
          "나만 상담에서 정리한 이 한 가지를 둘이 볼 실행 카드로 제안해줘.",
          "지금 할 한 가지: 이번 주 예식 후보 범위를 둘이 정하기",
          "이유: 장소를 찾기 전에 기준을 먼저 맞추면 선택이 쉬워져요.",
          "완료 기준: 지역과 예상 인원을 각각 하나씩 적으면 끝나요.",
          "저장 전에는 확인 카드만 보여줘.",
        ].join("\n"),
      },
    };

    expect(validateAmoraFirstUsePromotionPreviewResponse(
      payload,
      OWNER,
      COUPLE,
      SOURCE,
    )).toEqual({ ok: true, value: payload });

    expect(validateAmoraFirstUsePromotionPreviewResponse(
      { ...payload, ownerUserId: "55555555-5555-4555-8555-555555555555" },
      OWNER,
      COUPLE,
      SOURCE,
    )).toEqual({ ok: false, reason: "owner" });
    expect(validateAmoraFirstUsePromotionPreviewResponse(
      { ...payload, unexpected: true },
      OWNER,
      COUPLE,
      SOURCE,
    )).toEqual({ ok: false, reason: "state" });
  });

  it("accepts an exact already-shared receipt without private provenance", () => {
    const payload = {
      version: 1,
      state: "already_shared",
      ownerUserId: OWNER,
      coupleId: COUPLE,
      sourceMessageId: SOURCE,
      sharedMessageId: SHARED_MESSAGE,
    };
    expect(validateAmoraFirstUsePromotionPreviewResponse(
      payload,
      OWNER,
      COUPLE,
      SOURCE,
    )).toEqual({ ok: true, value: payload });
    expect(JSON.stringify(payload)).not.toContain("grounding");
    expect(JSON.stringify(payload)).not.toContain("privateText");
  });

  it("extracts only one bounded three-field action block from a private AI response", () => {
    expect(extractAmoraFirstUseActionDraft([
      "지금 상황을 먼저 정리해봤어요.",
      "확인된 내용:",
      "- 예식 날짜는 아직 정하지 않았어요.",
      "지금 할 한 가지: 예식 시기 후보 두 개 적기",
      "이유: 먼저 범위를 줄이면 장소를 찾기 쉬워져요.",
      "완료 기준: 가능한 시기 두 개를 적으면 끝나요.",
    ].join("\n"))).toEqual({
      action: "예식 시기 후보 두 개 적기",
      reason: "먼저 범위를 줄이면 장소를 찾기 쉬워져요.",
      completionCriterion: "가능한 시기 두 개를 적으면 끝나요.",
    });

    expect(extractAmoraFirstUseActionDraft([
      "지금 할 한 가지: 첫 번째",
      "지금 할 한 가지: 두 번째",
      "이유: 이유",
      "완료 기준: 완료",
    ].join("\n"))).toBeNull();
    expect(extractAmoraFirstUseActionDraft(
      "지금 할 한 가지: 날짜 정하기\n이유: 이유\n완료 기준: 완료\u202e",
    )).toBeNull();
  });
});
