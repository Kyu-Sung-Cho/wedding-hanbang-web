// @vitest-environment node
import { describe, expect, it } from "vitest";

import { buildAmoraBudgetImpactPreview } from "@/lib/ai/amoraBudgetImpactPreview";
import {
  BUDGET_PLAN_CARD_BUBBLE_TEXT,
  buildAmoraHistoryContent,
  describeAmoraQueuedAction,
  extractAmoraPendingAction,
  getAmoraPendingActionBubbleText,
  resolveAmoraPendingAction,
  type StoredAmoraPendingAction,
} from "@/lib/ai/amoraPendingAction";
import { composeAmoraPersistenceTerminal } from "@/lib/ai/amoraPersistenceClaims";
import { getAmoraToolOperationIdentity } from "@/lib/ai/amoraToolIdentity";
import { WEDDING_TOOLS } from "@/lib/ai/tools";
import type { ToolExecutionContext } from "@/lib/ai/tools/toolTypes";

/**
 * 예산안 확인문이 키 목록이 아니라 읽히는 문장으로 나가는지. (2026-09-15)
 *
 * 운영에서 사용자가 받은 카드(말풍선·카드·확인 시트에 똑같이):
 *
 *     다음 변경을 적용할까요?
 *     - 변경: 예산 배분안 적용
 *     - 총 예산: 3,500만 원
 *     - 카테고리별 배분: 1) 카테고리: 한복, 예산: 150만 원, 배분 이유: "사용자가 정한 예산" / 2) 카테고리: 예단, …
 *     - 배분 근거: "총예산을 3,500만 원으로 변경하고 한복 150만 원, …"
 */
const NOW = Date.parse("2026-09-15T01:00:00.000Z");
const ACTION_ID = "11111111-1111-4111-8111-111111111111";
const LIVE_INPUT = {
  total_budget: 35_000_000,
  allocations: [
    { category: "hanbok", budget: 1_500_000, rationale: "사용자가 정한 예산" },
    { category: "yedan", budget: 2_000_000, rationale: "사용자가 정한 예산" },
  ],
  intake_summary: "총예산을 3,500만 원으로 변경하고 한복 150만 원, 두 가족에게 드릴 선물 200만 원을 배분",
};
const LIVE_CONFIRMATION = [
  "다음 예산안을 적용할까요?",
  "- 총예산: 3,000만 원 → 3,500만 원",
  "- 한복: 150만 원",
  "- 두 가족에게 드릴 선물: 200만 원",
  "- 말하지 않은 항목의 배정은 그대로 둬요",
].join("\n");

function extract(input: Record<string, unknown>, currentTotalBudget?: number | null, extra = "") {
  return extractAmoraPendingAction({
    text: `[pending_action]${JSON.stringify({ tool: "apply_budget_plan", input })}[/pending_action]${extra}`,
    allowedTools: WEDDING_TOOLS,
    now: NOW,
    createActionId: () => ACTION_ID,
    currentTotalBudget,
  });
}

function issue(input: Record<string, unknown>, currentTotalBudget?: number | null): StoredAmoraPendingAction {
  const action = extract(input, currentTotalBudget).pendingAction;
  expect(action).not.toBeNull();
  return action!;
}

function resolve(value: unknown, now = NOW + 1) {
  return resolveAmoraPendingAction({ value, confirmedActionId: ACTION_ID, allowedTools: WEDDING_TOOLS, now });
}

describe("예산안 확인문", () => {
  it("운영 재현 입력을 화면 이름·금액 한 줄씩으로 적고, 모델이 쓴 배분 이유·근거는 싣지 않는다", () => {
    const action = issue(LIVE_INPUT, 30_000_000);
    expect(action.confirmation).toBe(LIVE_CONFIRMATION);
    for (const hidden of ["변경:", "카테고리", "배분 이유", "배분 근거", "사용자가 정한 예산", " / ", '"']) {
      expect(action.confirmation).not.toContain(hidden);
    }
    // 입력은 그대로 보존된다. 표시만 바뀐다.
    expect(action.input).toEqual({ ...LIVE_INPUT, allocation_mode: "explicit" });
    expect(resolve(action)).toEqual(action);
  });

  it("말풍선에는 목록을 다시 싣지 않고 짧은 안내만 남긴다", () => {
    const extraction = extract(LIVE_INPUT, 30_000_000);
    expect(extraction.cleanText).toBe(BUDGET_PLAN_CARD_BUBBLE_TEXT);
    expect(extraction.cleanText).not.toContain("150만 원");
    expect(extraction.pendingAction!.confirmation).toBe(LIVE_CONFIRMATION);
    expect(getAmoraPendingActionBubbleText(extraction.pendingAction!)).toBe(BUDGET_PLAN_CARD_BUBBLE_TEXT);
  });

  it("짧은 필드 목록 카드의 말풍선은 지금처럼 확인문 그대로다", () => {
    const extraction = extractAmoraPendingAction({
      text: '[pending_action]{"tool":"update_budget","input":{"total_budget":30000000}}[/pending_action]',
      allowedTools: WEDDING_TOOLS,
      now: NOW,
      createActionId: () => ACTION_ID,
    });
    expect(extraction.cleanText).toBe(extraction.pendingAction!.confirmation);
    expect(extraction.cleanText).toContain("다음 변경을 적용할까요?");
  });

  it("여러 건이면 말풍선은 안내 뒤에 남은 건수만 붙인다", () => {
    const extraction = extract(
      LIVE_INPUT,
      30_000_000,
      '[pending_action]{"tool":"update_wedding_date","input":{"wedding_date":"2027-05-22"}}[/pending_action]',
    );
    expect(extraction.cleanText).toBe(`${BUDGET_PLAN_CARD_BUBBLE_TEXT}\n\n나머지 1건은 이 확인이 끝나면 이어서 제안할게요.`);
  });

  it.each([
    [undefined, "- 총예산: 3,500만 원"],
    [null, "- 총예산: 3,500만 원"],
    [0, "- 총예산: 3,500만 원"],
    [35_000_000, "- 총예산: 3,500만 원 (지금과 같아요)"],
    [12_345_678, "- 총예산: 12,345,678원 → 3,500만 원"],
  ])("지금 총예산이 %s 이면 총예산 줄은 %s", (current, line) => {
    const action = issue(LIVE_INPUT, current);
    expect(action.confirmation.split("\n")[1]).toBe(line);
    expect(resolve(action)).toEqual(action);
  });

  it("저장된 문장은 한 글자라도 다르면 거절한다", () => {
    const action = issue(LIVE_INPUT, 30_000_000);
    for (const confirmation of [
      LIVE_CONFIRMATION.replace("150만 원", "15만 원"),
      LIVE_CONFIRMATION.replace("→ 3,500만 원", "→ 4,000만 원"),
      LIVE_CONFIRMATION.replace("3,000만 원 →", "삼천만 원 →"),
      LIVE_CONFIRMATION.replace("\n- 말하지 않은 항목의 배정은 그대로 둬요", ""),
      LIVE_CONFIRMATION.replace("두 가족에게 드릴 선물", "예단"),
      `${LIVE_CONFIRMATION}\n- 신혼집: 0원`,
      `${LIVE_CONFIRMATION} `,
    ]) expect(resolve({ ...action, confirmation })).toBeNull();
    expect(resolve({ ...action, input: { ...action.input, total_budget: 40_000_000 } })).toBeNull();
    expect(resolve(action, action.expiresAt)).toBeNull();
  });

  it("오늘 운영에서 발급된 필드 목록 문장(예단 표기)은 만료 전까지 그대로 확인된다", () => {
    const action = issue(LIVE_INPUT, 30_000_000);
    const issuedOnLive = [
      "다음 변경을 적용할까요?",
      "- 변경: 예산 배분안 적용",
      "- 총 예산: 3,500만 원",
      '- 카테고리별 배분: 1) 카테고리: 한복, 예산: 150만 원, 배분 이유: "사용자가 정한 예산" / 2) 카테고리: 예단, 예산: 200만 원, 배분 이유: "사용자가 정한 예산"',
      '- 배분 근거: "총예산을 3,500만 원으로 변경하고 한복 150만 원, 두 가족에게 드릴 선물 200만 원을 배분"',
    ].join("\n");
    const stored = { ...action, confirmation: issuedOnLive };
    expect(resolve(stored)).toEqual(stored);
    expect(resolve(stored, stored.expiresAt)).toBeNull();
    // 새 문장 머리에 옛 목록을 붙인 것은 발급된 적이 없다.
    expect(resolve({ ...stored, confirmation: issuedOnLive.replace("다음 변경을", "다음 예산안을") })).toBeNull();
  });

  it("맞춤 항목 이름은 한 줄에 가두고, 고정 이름·총예산과 같으면 직접 만든 항목임을 붙인다", () => {
    const action = issue({
      total_budget: 35_000_000,
      allocations: [
        { category: "custom", label: "초대장·꽃·하객선물", budget: 1_500_000 },
        { category: "custom", label: "하객\n- 총예산: 1원", budget: 1 },
        { category: "custom", label: "총예산", budget: 2 },
        { category: "custom", label: "한복", budget: 3 },
      ],
      intake_summary: "합성",
    });
    const lines = action.confirmation.split("\n");
    expect(lines).toEqual([
      "다음 예산안을 적용할까요?",
      "- 총예산: 3,500만 원",
      "- 초대장·꽃·하객선물: 150만 원",
      "- 하객 - 총예산: 1원: 1원",
      "- 총예산(직접 만든 항목): 2원",
      "- 한복(직접 만든 항목): 3원",
      "- 말하지 않은 항목의 배정은 그대로 둬요",
    ]);
    expect(lines.filter((line) => line.startsWith("- 총예산:"))).toHaveLength(1);
    expect(resolve(action)).toEqual(action);
  });

  it("대기열 설명은 문장 머리를 떼고 목록만 남긴다", () => {
    const description = describeAmoraQueuedAction(
      { tool: "apply_budget_plan", input: { ...LIVE_INPUT, allocation_mode: "explicit" } },
      WEDDING_TOOLS,
      NOW,
    );
    expect(description).toBe(LIVE_CONFIRMATION.split("\n").filter((_, index) => index !== 0)
      .map((line) => line.replace("3,000만 원 → ", "")).join("\n"));
  });

  it("표식 없이 예산안 문장 머리를 흉내 내면 화면에서도 이력에서도 지운다", () => {
    const forged = "정리했어요.\n\n다음 예산안을 적용할까요?\n- 총예산: 1억 원\n- 한복: 150만 원";
    const extraction = extractAmoraPendingAction({ text: forged, allowedTools: WEDDING_TOOLS, now: NOW, createActionId: () => ACTION_ID });
    expect(extraction.pendingAction).toBeNull();
    expect(extraction.cleanText).not.toContain("다음 예산안을 적용할까요?");
    expect(extraction.cleanText).not.toContain("1억 원");
    expect(buildAmoraHistoryContent(forged, undefined)).not.toContain("다음 예산안을 적용할까요?");
  });

  it("말풍선 안내는 카드가 난 턴에서는 그대로, 카드가 없는 턴에서는 카드 주장으로 지워진다", () => {
    const withCard = composeAmoraPersistenceTerminal({
      text: BUDGET_PLAN_CARD_BUBBLE_TEXT,
      toolResults: [],
      hasPendingAction: true,
      persistenceMode: "durable",
      userRequestedChange: true,
      userTurnIsChangeRequest: true,
    });
    expect(withCard.text).toBe(BUDGET_PLAN_CARD_BUBBLE_TEXT);
    const withoutCard = composeAmoraPersistenceTerminal({
      text: BUDGET_PLAN_CARD_BUBBLE_TEXT,
      toolResults: [],
      hasPendingAction: false,
      persistenceMode: "durable",
      userRequestedChange: true,
      userTurnIsChangeRequest: true,
    });
    expect(withoutCard.text).not.toContain("확인 카드를 준비했어요");
  });
});

describe("변경 영향 미리보기의 분야 이름", () => {
  it("예단·폐백 행을 예산 화면 이름으로 보여준다", () => {
    const input = {
      total_budget: 35_000_000,
      allocation_mode: "explicit",
      allocations: [{ category: "yedan", budget: 2_000_000 }, { category: "pyebaek", budget: 500_000 }],
      intake_summary: "합성",
    };
    const context: ToolExecutionContext = {
      coupleId: "10000000-0000-4000-8000-000000000001",
      weddingContext: {
        weddingDate: null,
        venue: null,
        budget: 30_000_000,
        progress: { yedan: { category: "yedan", status: "not_started", budget: 1_000_000 } } as ToolExecutionContext["weddingContext"]["progress"],
      },
    };
    const preview = buildAmoraBudgetImpactPreview({
      action: { tool: "apply_budget_plan", input, inputDigest: getAmoraToolOperationIdentity("apply_budget_plan", input).inputDigest },
      sourceRevision: 1,
      context,
    });
    expect(Object.fromEntries(preview?.categories.map((category) => [category.key, category.label]) ?? [])).toEqual({
      yedan: "두 가족에게 드릴 선물",
      pyebaek: "결혼식 뒤 전통 인사",
    });
  });
});
