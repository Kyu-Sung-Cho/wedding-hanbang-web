import { describe, expect, it } from "vitest";

import { buildAmoraBudgetImpactPreview } from "@/lib/ai/amoraBudgetImpactPreview";
import { extractAmoraPendingAction } from "@/lib/ai/amoraPendingAction";
import { BETA_SAFE_TOOLS } from "@/lib/ai/tools";
import { isMutatingTool } from "@/lib/ai/mutationTools";

/**
 * 총예산을 아직 정하지 않은 커플이 첫 저장 카드에서 "초과" 를 봤다.
 *
 * 신규 커플의 총예산은 0이다(`route.ts` 의 `journey?.total_budget ?? 0`).
 * 그 상태에서 예식장 예산을 잡으면 배분 합계가 0보다 커지므로:
 *
 *   경고: "변경 후 배분 합계가 총예산보다 커요."
 *   표:   배분 후 남는 금액  0원 → -2,200만 원
 *
 * 처음 써 보는 사람이 자기 **첫 저장**에서 경고와 마이너스를 함께 본다.
 * 아직 정하지 않은 것을 넘었다고 말할 수는 없다.
 *
 * 2026-08-25 적대적 검토가 지적했고, 실측으로 재현했다.
 */

const MUTATING_TOOLS = BETA_SAFE_TOOLS.filter((tool) => isMutatingTool(tool.name));

function cardFor(input: Record<string, unknown>, tool: string) {
  const extracted = extractAmoraPendingAction({
    text: `[pending_action]${JSON.stringify({ tool, input })}[/pending_action]`,
    allowedTools: MUTATING_TOOLS,
    now: 1_787_600_000_000,
    createActionId: () => "11111111-2222-4333-8444-555555555555",
  });
  if (!extracted.pendingAction) throw new Error("운영 경로로 카드를 못 만들었다");
  return extracted.pendingAction;
}

function previewWith(totalBudget: number, progress: Record<string, unknown> = {}) {
  return buildAmoraBudgetImpactPreview({
    action: cardFor({ category: "venue", budget: 22_000_000 }, "update_category_budget"),
    sourceRevision: 1,
    context: {
      coupleId: "couple-1",
      weddingContext: { budget: totalBudget, progress, weddingDate: null, venue: null },
    } as never,
  });
}

describe("총예산을 정하기 전", () => {
  it("배분 합계가 총예산보다 크다고 말하지 않는다", () => {
    const preview = previewWith(0);
    expect(preview).not.toBeNull();
    expect(preview?.warnings ?? []).not.toContain("allocated_over_total");
  });

  it("기록 지출이 총예산보다 크다고도 말하지 않는다", () => {
    const preview = previewWith(0, {
      studio: { category: "studio", spent: 3_000_000 },
    });
    expect(preview?.warnings ?? []).not.toContain("recorded_spend_over_total");
  });

  it("남는 금액은 여전히 음수로 계산된다 — 화면이 그 줄을 감춘다", () => {
    // 계산 자체를 바꾸면 총예산을 정한 커플의 초과 표시가 함께 죽는다.
    // 숨기는 것은 화면의 몫이고, 이 값은 그대로 둔다
    // (`PendingAmoraActionCard` 의 `totalBudgetIsSet`).
    expect(previewWith(0)?.proposed.unallocatedBudget).toBe(-22_000_000);
  });
});

describe("총예산을 정한 뒤", () => {
  it("실제로 넘으면 그대로 경고한다", () => {
    // 완화가 진짜 초과까지 덮으면 안 된다.
    const preview = previewWith(10_000_000);
    expect(preview?.warnings ?? []).toContain("allocated_over_total");
  });

  it("넘지 않으면 경고하지 않는다", () => {
    const preview = previewWith(62_000_000);
    expect(preview?.warnings ?? []).not.toContain("allocated_over_total");
  });

  it("기록 지출이 총예산을 넘으면 그대로 경고한다", () => {
    const preview = previewWith(1_000_000, {
      studio: { category: "studio", spent: 3_000_000 },
    });
    expect(preview?.warnings ?? []).toContain("recorded_spend_over_total");
  });
});
