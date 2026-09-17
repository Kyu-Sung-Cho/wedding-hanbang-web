import { describe, expect, it } from "vitest";

import {
  advanceAmoraActionQueue,
  resolveAmoraActionQueue,
  skipAmoraActionQueueHead,
  type AmoraActionQueue,
} from "@/lib/ai/amoraActionQueue";
import {
  extractAmoraPendingAction,
  type StoredAmoraPendingAction,
} from "@/lib/ai/amoraPendingAction";
import { isAmoraClarificationAnswerShaped } from "@/lib/ai/amoraClarificationContinuity";
import { hasNewAmoraChangeIntent } from "@/lib/ai/amoraPendingActionContinuity";
import { classifyAmoraQuestionScope } from "@/lib/ai/amoraQuestionScope";
import {
  AMORA_QUEUED_CARD_SKIP_TEXT,
  isAmoraQueuedCardSkip,
} from "@/lib/ai/amoraQueuedCardSkip";
import {
  classifyAmoraTypedCardAcceptance,
  isAmoraTypedCardAcceptance,
} from "@/lib/ai/amoraTypedCardAcceptance";
import type { AiToolDefinition } from "@/lib/ai/toolDefinition";

/**
 * 2026-09-18: 여러 변경 중 한 카드를 원치 않으면 그 카드를 적용하는 것 말고는 다음으로 갈 길이
 * 없었고, 남은 요청은 이월 상한에서 말없이 사라졌다. 대기열 카드의 "이 항목 건너뛰기" 는 고정
 * 문장을 보내고, 서버는 그 문장일 때만 지금 항목을 **반영하지 않고** 다음 항목을 새 확인 카드로
 * 낸다. 여기서는 건수 계산과 문장 판정, 그리고 그 문장이 기존 판정(새 변경·말로 한 승낙·범위)을
 * 건드리지 않는지를 잰다.
 */

const TOOLS: AiToolDefinition[] = [
  {
    name: "update_budget",
    description: "test",
    input_schema: {
      type: "object",
      properties: { total_budget: { type: "number" } },
      required: ["total_budget"],
    },
  },
];
const NOW = 1_787_000_000_000;
const QUEUE_ID = "11111111-1111-4111-8111-111111111111";

function card(totalBudget: number, actionId: string): StoredAmoraPendingAction {
  const extracted = extractAmoraPendingAction({
    text: `[pending_action]${JSON.stringify({ tool: "update_budget", input: { total_budget: totalBudget } })}[/pending_action]`,
    allowedTools: TOOLS,
    now: NOW,
    createActionId: () => actionId,
  });
  if (!extracted.pendingAction) throw new Error("fixture card was not issued");
  return extracted.pendingAction;
}

const item = (totalBudget: number) => ({ tool: "update_budget", input: { total_budget: totalBudget } });

function queue(totalCount: number, completedCount: number, remaining: number[]): AmoraActionQueue {
  return {
    version: 1,
    queueId: QUEUE_ID,
    currentActionId: "22222222-2222-4222-8222-222222222222",
    totalCount,
    completedCount,
    remainingActions: remaining.map(item),
  };
}

describe("대기열에서 지금 항목을 건너뛴다", () => {
  const next = card(31_000_000, "33333333-3333-4333-8333-333333333333");

  it("건너뛴 항목은 완료가 아니라 전체 건수에서 빠진다", () => {
    // 3건 중 1건 반영, 지금 카드(2번째)를 건너뛰고 3번째가 다음 카드다.
    expect(skipAmoraActionQueueHead(queue(3, 1, [31_000_000]), next)).toEqual({
      version: 1, queueId: QUEUE_ID, currentActionId: next.actionId,
      totalCount: 2, completedCount: 1, remainingActions: [],
    });
    // 아직 아무것도 반영하지 않은 3건에서 첫 카드를 건너뛴다.
    expect(skipAmoraActionQueueHead(queue(3, 0, [31_000_000, 32_000_000]), next)).toEqual({
      version: 1, queueId: QUEUE_ID, currentActionId: next.actionId,
      totalCount: 2, completedCount: 0, remainingActions: [item(32_000_000)],
    });
  });

  it("건너뛴 대기열은 다음 턴에 그대로 다시 읽힌다(건수 불변식)", () => {
    for (const [before, stored] of [
      [queue(3, 1, [31_000_000]), card(31_000_000, "33333333-3333-4333-8333-333333333333")],
      [queue(3, 0, [31_000_000, 32_000_000]), card(31_000_000, "44444444-4444-4444-8444-444444444444")],
      [queue(5, 1, [31_000_000, 32_000_000, 33_000_000]), card(31_000_000, "55555555-5555-4555-8555-555555555555")],
    ] as const) {
      const skipped = skipAmoraActionQueueHead(before, stored);
      expect(skipped).not.toBeNull();
      expect(resolveAmoraActionQueue(skipped, stored, TOOLS, NOW)).toEqual(skipped);
    }
  });

  it("남는 전체가 2건보다 적으면 대기열이 아니다 — 다음 카드는 단일 카드다", () => {
    expect(skipAmoraActionQueueHead(queue(2, 0, [31_000_000]), next)).toBeNull();
  });

  it("적용 뒤의 진행은 그대로다", () => {
    expect(advanceAmoraActionQueue(queue(3, 1, [31_000_000]), next)).toEqual({
      version: 1, queueId: QUEUE_ID, currentActionId: next.actionId,
      totalCount: 3, completedCount: 2, remainingActions: [],
    });
    expect(advanceAmoraActionQueue(queue(3, 0, [31_000_000, 32_000_000]), next)).toEqual({
      version: 1, queueId: QUEUE_ID, currentActionId: next.actionId,
      totalCount: 3, completedCount: 1, remainingActions: [item(32_000_000)],
    });
  });
});

describe("건너뛰기 문장 판정", () => {
  it.each([
    AMORA_QUEUED_CARD_SKIP_TEXT,
    `  ${AMORA_QUEUED_CARD_SKIP_TEXT}\n`,
    // 조합형·분해형 한글이 섞여 들어와도 같은 문장이다.
    AMORA_QUEUED_CARD_SKIP_TEXT.normalize("NFD"),
  ])("고정 문장만 건너뛰기다: %j", (text) => {
    expect(isAmoraQueuedCardSkip(text)).toBe(true);
  });

  it.each([
    // 자연어 거절은 무엇을 뺄지 틀릴 수 있어 받지 않는다.
    "스튜디오 예산은 안 할래",
    "드레스는 빼고 헤어메이크업은 넣어줘",
    "드레스는 건너뛰고 다음 거 보여줘",
    "이대로 적용해줘",
    "건너뛰고 드레스 300만원으로",
    "다음 항목 보여줘",
    "이 항목 건너뛰기",
    `${AMORA_QUEUED_CARD_SKIP_TEXT} 드레스는 300만원으로`,
    `드레스 300만원으로. ${AMORA_QUEUED_CARD_SKIP_TEXT}`,
    AMORA_QUEUED_CARD_SKIP_TEXT.replace(/\.$/u, ""),
    "",
  ])("그 밖의 말은 건너뛰기가 아니다: %s", (text) => {
    expect(isAmoraQueuedCardSkip(text)).toBe(false);
  });

  it("문자열이 아니면 건너뛰기가 아니다", () => {
    for (const value of [null, undefined, 1, {}, [AMORA_QUEUED_CARD_SKIP_TEXT]]) {
      expect(isAmoraQueuedCardSkip(value)).toBe(false);
    }
  });

  it("고정 문장은 새 변경 요청도, 카드에 대한 승낙도 아니다 — 대기 카드와 대기열이 이 턴에 남는다", () => {
    expect(hasNewAmoraChangeIntent(AMORA_QUEUED_CARD_SKIP_TEXT)).toBe(false);
    expect(classifyAmoraTypedCardAcceptance(AMORA_QUEUED_CARD_SKIP_TEXT)).toBeNull();
    expect(isAmoraTypedCardAcceptance(AMORA_QUEUED_CARD_SKIP_TEXT)).toBe(false);
  });

  it("고정 문장은 짧은 답 모양이라, 범위 밖이어도 라우트가 직전 카드·대기열·리비전을 읽는다", () => {
    // 범위 밖(W4) 턴은 보통 저장 문맥 읽기를 건너뛰어 직전 행을 보지 않는다. 이 문장이 그 모양에서
    // 빠지면 건너뛰기가 조용히 평범한 대화가 된다(경로 테스트가 함께 잡는다).
    expect(isAmoraClarificationAnswerShaped(AMORA_QUEUED_CARD_SKIP_TEXT)).toBe(true);
  });

  it("고정 문장은 범위 밖(W4)이고 장기 기억 대상이 아니다", () => {
    const classified = classifyAmoraQuestionScope({ userText: AMORA_QUEUED_CARD_SKIP_TEXT, requestKind: "chat" });
    expect(classified.scope).toBe("W4_out_of_scope");
    expect(classified.allowsLongTermMemory).toBe(false);
  });

  it("위기 문장에 고정 문장을 붙여도 안전 판정이 그대로이고 건너뛰기가 아니다", () => {
    const text = `죽고 싶어. ${AMORA_QUEUED_CARD_SKIP_TEXT}`;
    expect(classifyAmoraQuestionScope({ userText: text, requestKind: "chat" }).scope).toBe("W5_safety_override");
    expect(isAmoraQueuedCardSkip(text)).toBe(false);
  });
});
