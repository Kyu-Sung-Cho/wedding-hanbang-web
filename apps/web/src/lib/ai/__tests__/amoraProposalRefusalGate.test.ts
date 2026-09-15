// @vitest-environment node
import { describe, expect, it } from "vitest";

import { buildAmoraAtomicToolOperation } from "@/lib/ai/amoraAtomicToolOperation";
import { findAmoraBudgetProposalRefusal } from "@/lib/ai/amoraBudgetImpactPreview";
import type { ToolExecutionContext } from "@/lib/ai/tools/toolTypes";

/**
 * 리뷰 [2]: "누르면 반드시 거절될 카드는 내지 않는다" 게이트가 예산 도구에만 걸려 있었다.
 * 순수 연산이 **같은 정본 문맥만으로** 확실히 거절하는 경우 — '안 해요'로 끈 분야의 체크,
 * 취소된 일정을 옮기거나 다시 취소하기, 취소되지 않은 일정 복원, 제목·날짜가 저장값과 다른
 * 취소 — 는 카드 대신 그 이유를 지금 말한다. 실행 때만 알 수 있는 거절(구성원 확인 등)과
 * 거절이 아닌 "이미 그 값" 은 거르지 않는다.
 */
const ACTOR_ID = "11111111-1111-4111-8111-111111111111";
const EVENT_ID = "evt_dress_fitting";

function context(progress: Record<string, unknown>, withActor = true): ToolExecutionContext {
  return {
    coupleId: "22222222-2222-4222-8222-222222222222",
    ...(withActor ? { actorProfileId: ACTOR_ID } : {}),
    weddingContext: {
      weddingDate: "2027-03-20",
      budget: 30_000_000,
      venue: null,
      progress: progress as unknown as ToolExecutionContext["weddingContext"]["progress"],
    },
  };
}

function event(status: "planned" | "cancelled", title = "드레스 최종 피팅"): Record<string, unknown> {
  return {
    id: EVENT_ID,
    date: "2027-02-20",
    time: "14:00",
    title,
    status,
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...(status === "cancelled"
      ? { cancellation: { cancelledAt: "2026-08-01T00:00:00.000Z", cancelledByProfileId: ACTOR_ID } }
      : {}),
  };
}

const refusal = (tool: string, input: Record<string, unknown>, ctx: ToolExecutionContext) =>
  findAmoraBudgetProposalRefusal({ action: { tool, input }, context: ctx });

describe("체크리스트 항목 체크", () => {
  it("'안 해요'로 끈 분야의 체크 카드는 내지 않고 이유를 말한다", () => {
    const result = refusal(
      "toggle_checklist_item",
      { category: "hanbok", item_id: "hanbok_03", done: true },
      context({ hanbok: { category: "hanbok", status: "not_applicable" } }),
    );
    expect(result).toMatchObject({ error: "progress_state_invalid" });
    expect(result?.text).toContain("'안 해요'로 표시한 분야라 항목을 체크하지 않았어요");
  });

  it("없는 항목도 카드 대신 이유를 말한다", () => {
    expect(refusal(
      "toggle_checklist_item",
      { category: "hanbok", item_id: "hanbok_999", done: true },
      context({ hanbok: { category: "hanbok", status: "not_started" } }),
    )).toMatchObject({ error: "checklist_item_not_found" });
  });

  it("체크할 수 있는 항목과 이미 같은 상태인 항목은 거르지 않는다", () => {
    const ctx = context({ hanbok: { category: "hanbok", status: "not_started" } });
    expect(refusal("toggle_checklist_item", { category: "hanbok", item_id: "hanbok_03", done: true }, ctx)).toBeNull();
    // 이미 미완료인 항목을 미완료로: no_change 는 거절이 아니다.
    expect(refusal("toggle_checklist_item", { category: "hanbok", item_id: "hanbok_03", done: false }, ctx)).toBeNull();
  });
});

describe("일정을 가리키는 카드", () => {
  it("취소된 일정을 옮기는 카드는 내지 않고, 먼저 복원해야 한다고 말한다", () => {
    const result = refusal(
      "update_schedule_event",
      { event_id: EVENT_ID, date: "2027-02-27" },
      context({ __events: [event("cancelled")] }),
    );
    expect(result).toMatchObject({ error: "schedule_event_cancelled" });
    expect(result?.text).toContain("취소된 상태라 수정하지 않았어요");
    expect(result?.text).toContain("복원");
    expect(result?.text).toContain("않았어요");
  });

  it("이미 취소된 일정을 다시 취소하는 카드는 내지 않는다", () => {
    const result = refusal(
      "cancel_schedule_event",
      { event_id: EVENT_ID, expected_title: "드레스 최종 피팅", expected_date: "2027-02-20" },
      context({ __events: [event("cancelled")] }),
    );
    expect(result).toMatchObject({ error: "schedule_event_cancelled" });
    expect(result?.text).toContain("이미 취소된 상태라 다시 취소하지 않았어요");
  });

  it("취소되지 않은 일정을 복원하는 카드는 내지 않는다", () => {
    const result = refusal(
      "restore_schedule_event",
      { event_id: EVENT_ID, expected_title: "드레스 최종 피팅", expected_date: "2027-02-20" },
      context({ __events: [event("planned")] }),
    );
    expect(result).toMatchObject({ error: "schedule_event_not_cancelled" });
    expect(result?.text).toContain("취소된 상태가 아니라 복원하지 않았어요");
  });

  it("저장된 제목과 다른(잘린) 제목의 취소 카드는 내지 않는다", () => {
    const longTitle = "가".repeat(320);
    const result = refusal(
      "cancel_schedule_event",
      { event_id: EVENT_ID, expected_title: longTitle.slice(0, 300), expected_date: "2027-02-20" },
      context({ __events: [event("planned", longTitle)] }),
    );
    expect(result).toMatchObject({ error: "schedule_target_changed" });
    expect(result?.text).toContain("현재 일정을 다시 확인해 주세요");
  });

  it("없는 일정 id 도 카드 대신 이유를 말한다", () => {
    expect(refusal(
      "update_schedule_event",
      { event_id: "evt_missing", date: "2027-02-27" },
      context({ __events: [event("planned")] }),
    )).toMatchObject({ error: "schedule_event_not_found" });
  });

  it("적용 가능한 옮기기·취소·복원과 바뀔 것이 없는 옮기기는 거르지 않는다", () => {
    const planned = context({ __events: [event("planned")] });
    const cancelled = context({ __events: [event("cancelled")] });
    expect(refusal("update_schedule_event", { event_id: EVENT_ID, date: "2027-02-27" }, planned)).toBeNull();
    expect(refusal("update_schedule_event", { event_id: EVENT_ID, date: "2027-02-20" }, planned)).toBeNull();
    expect(refusal("cancel_schedule_event", { event_id: EVENT_ID, expected_title: "드레스 최종 피팅", expected_date: "2027-02-20" }, planned)).toBeNull();
    expect(refusal("restore_schedule_event", { event_id: EVENT_ID, expected_title: "드레스 최종 피팅", expected_date: "2027-02-20" }, cancelled)).toBeNull();
  });

  it("실행 때만 알 수 있는 거절(변경하는 구성원 확인)은 카드 발급 때 판단하지 않는다", () => {
    expect(refusal(
      "cancel_schedule_event",
      { event_id: EVENT_ID, expected_title: "드레스 최종 피팅", expected_date: "2027-02-20" },
      context({ __events: [event("planned")] }, false),
    )).toBeNull();
  });
});

describe("게이트 밖의 도구", () => {
  it("순수 연산이 판정 전권을 갖지 않는 도구는 거르지 않는다", () => {
    const ctx = context({ hanbok: { category: "hanbok", status: "not_applicable" } });
    // update_task_status 의 체크리스트 추종 거절은 되묻는 문장을 담고 있어 여기서 가로채지 않는다.
    expect(refusal("update_task_status", { category: "hanbok", status: "completed" }, ctx)).toBeNull();
    expect(refusal("update_wedding_date", { wedding_date: "2000-01-01" }, ctx)).toBeNull();
    expect(refusal("add_schedule_event", { date: "2027-13-40", title: "x" }, ctx)).toBeNull();
  });

  it("미리 돌려 봐도 원본 문맥과 입력은 그대로다", () => {
    const ctx = context({ __events: [event("cancelled")], hanbok: { category: "hanbok", status: "not_applicable" } });
    const inputs = [
      ["update_schedule_event", { event_id: EVENT_ID, date: "2027-02-27" }],
      ["toggle_checklist_item", { category: "hanbok", item_id: "hanbok_03", done: true }],
    ] as const;
    const before = structuredClone({ ctx, inputs });
    for (const [tool, input] of inputs) refusal(tool, input, ctx);
    expect({ ctx, inputs }).toEqual(before);
  });
});

describe("실행 때의 같은 거절 문장", () => {
  it("승인 뒤 실행도 취소된 일정에 대해 같은 사실을 말한다", () => {
    const operation = buildAmoraAtomicToolOperation(
      "update_schedule_event",
      { event_id: EVENT_ID, date: "2027-02-27" },
      context({ __events: [event("cancelled")] }),
    );
    expect(operation.domainMutation).toEqual({ kind: "none" });
    expect(operation.result.toolOutput).toMatchObject({ error: "schedule_event_cancelled" });
    expect(operation.result.displayMessage).not.toContain("날짜와 제목을 다시 확인");
  });
});
