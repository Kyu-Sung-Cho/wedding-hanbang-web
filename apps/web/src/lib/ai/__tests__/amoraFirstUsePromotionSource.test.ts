import { describe, expect, it } from "vitest";

import {
  buildAmoraFirstUsePromotionSourceSeal,
  parseAmoraFirstUsePromotionSourceSeal,
} from "@/lib/ai/amoraFirstUsePromotion";

const grounding = {
  version: 1 as const,
  sourceRevision: 7,
  confirmed: [],
  unknowns: [
    { key: "current_progress" as const, label: "이미 마친 준비와 아직 남은 준비" },
  ],
};

describe("buildAmoraFirstUsePromotionSourceSeal", () => {
  it("seals only the safe canonical action and bounded provenance digests", () => {
    const result = buildAmoraFirstUsePromotionSourceSeal({
      content: [
        "지금 상황에서 한 가지만 먼저 해볼게요.",
        "지금 할 한 가지: 예식 시기 후보 두 개 적기",
        "이유: 먼저 범위를 줄이면 장소를 찾기 쉬워져요.",
        "완료 기준: 가능한 시기 두 개를 적으면 끝나요.",
      ].join("\n"),
      grounding,
      sourceRevision: 7,
      criterionDecisionId: null,
      privacyEpoch: 5,
      rosterFingerprint: "a".repeat(32),
    });

    expect(result).toMatchObject({
      canonicalActionInput: {
        action: "예식 시기 후보 두 개 적기",
        reason: "먼저 범위를 줄이면 장소를 찾기 쉬워져요.",
        completionCriterion: "가능한 시기 두 개를 적으면 끝나요.",
      },
      canonicalAddActionInput: {
        title: "예식 시기 후보 두 개 적기",
        description: "이유: 먼저 범위를 줄이면 장소를 찾기 쉬워져요. 완료 기준: 가능한 시기 두 개를 적으면 끝나요.",
        category_key: "general",
        priority: "medium",
        source: "chat",
      },
      metadata: {
        version: 1,
        journeyRevision: 7,
        privacyEpoch: 5,
        rosterFingerprint: "a".repeat(32),
        criterionDecisionId: null,
        canonicalActionInput: {
          action: "예식 시기 후보 두 개 적기",
          reason: "먼저 범위를 줄이면 장소를 찾기 쉬워져요.",
          completionCriterion: "가능한 시기 두 개를 적으면 끝나요.",
        },
        sourceContentDigest: expect.stringMatching(/^[0-9a-f]{64}$/),
        actionDigest: expect.stringMatching(/^[0-9a-f]{64}$/),
        sharedContentDigest: expect.stringMatching(/^[0-9a-f]{64}$/),
      },
    });
    expect(JSON.stringify(result)).not.toContain("지금 상황에서");
    expect(JSON.stringify(result)).not.toContain("grounding");
  });

  it("turns invented payment, contract, and amount claims into verification before sealing", () => {
    const result = buildAmoraFirstUsePromotionSourceSeal({
      content: [
        "지금 할 한 가지: 신라호텔 예약금 300만원 결제 완료로 기록하기",
        "이유: 업체와 계약이 확정됐고 두 사람이 동의했어요.",
        "완료 기준: 잔금 700만원을 2026-08-20까지 보내면 끝나요.",
      ].join("\n"),
      grounding,
      sourceRevision: 7,
      criterionDecisionId: null,
      privacyEpoch: 5,
      rosterFingerprint: "b".repeat(32),
    });

    expect(result?.canonicalActionInput).toEqual({
      action: "계약·결제 상태 확인하기",
      reason: "저장된 준비 기록만으로 계약·결제 상태를 확정할 수 없어 먼저 확인이 필요해요.",
      completionCriterion: "계약서와 결제 내역에서 금액·상태·마감일을 확인해 둘이 볼 기록에 적으면 끝나요.",
    });
    expect(result?.canonicalSharedText).not.toContain("300만원");
    expect(result?.canonicalSharedText).not.toContain("700만원");
  });

  it("fails closed on malformed content or mismatched privacy/currentness inputs", () => {
    const base = {
      content: "지금 할 한 가지: 날짜 정하기\n이유: 이유\n완료 기준: 완료",
      grounding,
      sourceRevision: 7,
      criterionDecisionId: null,
      privacyEpoch: 5,
      rosterFingerprint: "c".repeat(32),
    };
    expect(buildAmoraFirstUsePromotionSourceSeal({
      ...base,
      sourceRevision: 8,
    })).toBeNull();
    expect(buildAmoraFirstUsePromotionSourceSeal({
      ...base,
      privacyEpoch: 0,
    })).toBeNull();
    expect(buildAmoraFirstUsePromotionSourceSeal({
      ...base,
      rosterFingerprint: "not-a-fingerprint",
    })).toBeNull();
    expect(buildAmoraFirstUsePromotionSourceSeal({
      ...base,
      criterionDecisionId: "not-a-uuid",
    })).toBeNull();
    expect(buildAmoraFirstUsePromotionSourceSeal({
      ...base,
      content: "그냥 자연스러운 답변이에요.",
    })).toBeNull();
  });

  it("reconstructs an exact stored source seal but rejects changed content or expanded metadata", () => {
    const content = "지금 할 한 가지: 날짜 후보 적기\n이유: 범위를 줄일 수 있어요.\n완료 기준: 후보 두 개를 적으면 끝나요.";
    const built = buildAmoraFirstUsePromotionSourceSeal({
      content,
      grounding,
      sourceRevision: 7,
      criterionDecisionId: null,
      privacyEpoch: 5,
      rosterFingerprint: "d".repeat(32),
    });
    expect(built).not.toBeNull();

    expect(parseAmoraFirstUsePromotionSourceSeal({
      content,
      value: built?.metadata,
    })).toEqual(built);
    expect(parseAmoraFirstUsePromotionSourceSeal({
      content: `${content} 바뀜`,
      value: built?.metadata,
    })).toBeNull();
    expect(parseAmoraFirstUsePromotionSourceSeal({
      content,
      value: { ...built?.metadata, privateText: "노출 금지" },
    })).toBeNull();
  });
});
