import { describe, expect, it } from "vitest";

import { getWeddingPlannerSystemPrompt } from "@/lib/ai/prompts";
import { CATEGORY_CHECKLISTS } from "@hanbang/shared/constants";

/**
 * 아무것도 안 한 커플의 프롬프트에서 체크리스트 목록이 7,081자를 차지했다.
 *
 * 프롬프트는 48,000자에서 잘린다. 2026-08-25 실측 — 대화가 쌓이면 잘리는 쪽은
 * **규칙이 아니라 커플이 실제로 정한 것들**이다(결정 40건이면 절단 시작).
 * 아직 시작도 안 한 분야의 항목 12개가 그 커플의 기록을 밀어내는 것은 값이
 * 맞지 않는다.
 *
 * 시작한 분야는 그대로 12개를 싣는다 — 지금 일하고 있는 자리이고
 * `toggle_checklist_item` 이 항목 id 를 필요로 한다.
 */

function promptWith(progress: Record<string, unknown>): string {
  return getWeddingPlannerSystemPrompt({
    weddingDate: "2027-05-15", budget: 62_000_000, venue: null, progress,
    preparationStatus: null, brideName: "신부", groomName: "신랑",
    bookings: [], scheduleEvents: [], chatSummaries: [],
    pastConflicts: [], pastDecisions: [],
  } as never);
}

const VENUE_ITEMS = CATEGORY_CHECKLISTS.find((c) => c.key === "venue")?.items ?? [];

describe("시작하지 않은 분야는 자리를 적게 쓴다", () => {
  it("아무것도 안 한 커플의 프롬프트가 눈에 띄게 짧아진다", () => {
    // 실측(2026-08-25): 46,630자 → 43,448자. 3,182자를 커플의 실제 기록에
    // 돌려줬다. 이 값이 다시 커지면 절단이 그만큼 빨리 시작된다.
    expect(promptWith({}).length).toBeLessThan(44_000);
  });

  it("미시작 분야는 항목 3개만 싣고 나머지는 개수로 알린다", () => {
    const prompt = promptWith({});
    const venueLine = prompt.split("\n").find((l) => l.includes("(venue)")) ?? "";
    const shown = (venueLine.match(/⬜venue_\d+/g) ?? []).length;
    expect(shown).toBe(3);
    expect(venueLine).toContain(`그 밖에 ${VENUE_ITEMS.length - 3}개 더 있음`);
  });

  it("시작한 분야는 예전대로 12개까지 싣는다", () => {
    const prompt = promptWith({
      venue: {
        category: "venue", status: "in_progress", budget: 20_000_000,
        checklist: [{ id: "venue_01", label: "원하는 결혼식장 형태 정하기", done: true }],
      },
    });
    const venueLine = prompt.split("\n").find((l) => l.includes("(venue)")) ?? "";
    const shown = (venueLine.match(/[⬜✅]venue_\d+/g) ?? []).length;
    expect(shown).toBeGreaterThan(3);
  });

  it("예산만 정해도 시작한 것으로 본다", () => {
    const prompt = promptWith({ venue: { category: "venue", budget: 20_000_000 } });
    const venueLine = prompt.split("\n").find((l) => l.includes("(venue)")) ?? "";
    expect((venueLine.match(/[⬜✅]venue_\d+/g) ?? []).length).toBeGreaterThan(3);
  });
});
