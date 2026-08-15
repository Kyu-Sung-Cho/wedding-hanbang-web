import { describe, expect, it } from "vitest";

import {
  matchesAmoraFirstUsePendingAction,
  parseAmoraFirstUsePromotionValidation,
} from "@/lib/ai/amoraFirstUsePromotionBinding";

const promotionId = "90000000-0000-4000-8000-000000000001";
const canonicalActionInput = {
  action: "가능한 예식 시기 두 개 적기",
  reason: "다음 준비의 기준이 필요해요.",
  completionCriterion: "두 사람이 시기 두 개를 확인하면 끝나요.",
};
const canonicalAddActionInput = {
  title: canonicalActionInput.action,
  description: `이유: ${canonicalActionInput.reason} 완료 기준: ${canonicalActionInput.completionCriterion}`,
  category_key: "general" as const,
  priority: "medium" as const,
  source: "chat" as const,
};
const sharedText = [
  "나만 상담에서 정리한 이 한 가지를 둘이 볼 실행 카드로 제안해줘.",
  `지금 할 한 가지: ${canonicalActionInput.action}`,
  `이유: ${canonicalActionInput.reason}`,
  `완료 기준: ${canonicalActionInput.completionCriterion}`,
  "저장 전에는 확인 카드만 보여줘.",
].join("\n");

describe("parseAmoraFirstUsePromotionValidation", () => {
  it("returns a server binding for the exact receipt and current shared text", () => {
    expect(parseAmoraFirstUsePromotionValidation({
      value: {
        version: 1,
        promotionId,
        canonicalActionInput,
        canonicalAddActionInput,
      },
      expectedPromotionId: promotionId,
      expectedSharedText: sharedText,
    })).toEqual({
      promotionId,
      canonicalActionInput,
      canonicalAddActionInput,
    });
  });

  it("binds opaque promotion metadata only to the exact canonical pending action", () => {
    const binding = parseAmoraFirstUsePromotionValidation({
      value: {
        version: 1,
        promotionId,
        canonicalActionInput,
        canonicalAddActionInput,
      },
      expectedPromotionId: promotionId,
      expectedSharedText: sharedText,
    });

    expect(matchesAmoraFirstUsePendingAction({
      tool: "add_amora_action",
      input: canonicalAddActionInput,
    }, binding)).toBe(true);
    expect(matchesAmoraFirstUsePendingAction({
      tool: "add_amora_action",
      input: { ...canonicalAddActionInput, title: "바뀐 제목" },
    }, binding)).toBe(false);
    expect(matchesAmoraFirstUsePendingAction({
      tool: "update_budget",
      input: canonicalAddActionInput,
    }, binding)).toBe(false);
  });

  it.each([
    {
      label: "a different receipt id",
      value: {
        version: 1,
        promotionId: "90000000-0000-4000-8000-000000000002",
        canonicalActionInput,
        canonicalAddActionInput,
      },
      expectedSharedText: sharedText,
    },
    {
      label: "an edited shared draft",
      value: {
        version: 1,
        promotionId,
        canonicalActionInput,
        canonicalAddActionInput,
      },
      expectedSharedText: sharedText.replace("시기 두 개", "시기 세 개"),
    },
    {
      label: "provider-invented add-action input",
      value: {
        version: 1,
        promotionId,
        canonicalActionInput,
        canonicalAddActionInput: {
          ...canonicalAddActionInput,
          title: "모델이 바꾼 제목",
        },
      },
      expectedSharedText: sharedText,
    },
    {
      label: "an RPC response with extra fields",
      value: {
        version: 1,
        promotionId,
        canonicalActionInput,
        canonicalAddActionInput,
        sourceMessageId: "80000000-0000-4000-8000-000000000001",
      },
      expectedSharedText: sharedText,
    },
  ])("rejects $label", ({ value, expectedSharedText }) => {
    expect(parseAmoraFirstUsePromotionValidation({
      value,
      expectedPromotionId: promotionId,
      expectedSharedText,
    })).toBeNull();
  });
});
