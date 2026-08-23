import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BETA_SAFE_TOOLS,
  WEDDING_TOOLS,
} from "@/lib/ai/tools";
import { getAmoraActionApprovalPolicy } from "@/lib/ai/amoraActionApprovalPolicy";
import { extractAmoraPendingAction } from "@/lib/ai/amoraPendingAction";
import {
  AMORA_ATOMIC_TOOL_NAMES,
  applyAmoraAtomicToolResultToContext,
  buildAmoraAtomicToolOperation,
} from "@/lib/ai/amoraAtomicToolOperation";
import { isMutatingTool } from "@/lib/ai/mutationTools";
import type { ToolExecutionContext } from "@/lib/ai/tools/toolTypes";
import { executeGetScheduleEvents } from "@/lib/ai/tools/scheduleTools";

const ACTOR_ID = "11111111-1111-4111-8111-111111111111";
const EVENT_ID = "evt_dress_fitting";

function context(event: Record<string, unknown>): ToolExecutionContext {
  return {
    coupleId: "22222222-2222-4222-8222-222222222222",
    actorProfileId: ACTOR_ID,
    requestKey: "chat:11111111-1111-4111-8111-111111111111:33333333-3333-4333-8333-333333333333",
    requestAttemptCount: 1,
    pendingActionId: "44444444-4444-4444-8444-444444444444",
    weddingContext: {
      weddingDate: "2027-03-20",
      budget: 30_000_000,
      venue: null,
      progress: {
        __events: [event],
      } as unknown as ToolExecutionContext["weddingContext"]["progress"],
    },
  };
}

function plannedEvent(): Record<string, unknown> {
  return {
    id: EVENT_ID,
    date: "2026-08-20",
    time: "14:00",
    title: "드레스 최종 피팅",
    memo: "수선 확인",
    status: "planned",
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("Amora schedule cancellation and restoration", () => {
  it("exposes cancel/restore as couple-approved mutations and never exposes legacy delete", () => {
    const safeNames = BETA_SAFE_TOOLS.map((tool) => tool.name);
    const allNames = WEDDING_TOOLS.map((tool) => tool.name);

    expect(allNames).toContain("cancel_schedule_event");
    expect(allNames).toContain("restore_schedule_event");
    expect(safeNames).toContain("cancel_schedule_event");
    expect(safeNames).toContain("restore_schedule_event");
    expect(safeNames).not.toContain("delete_schedule_event");
    expect(getAmoraActionApprovalPolicy("cancel_schedule_event", {
      event_id: EVENT_ID,
    })).toBe("couple");
    expect(getAmoraActionApprovalPolicy("restore_schedule_event", {
      event_id: EVENT_ID,
    })).toBe("couple");
    expect(isMutatingTool("cancel_schedule_event")).toBe(true);
    expect(isMutatingTool("restore_schedule_event")).toBe(true);
    expect(AMORA_ATOMIC_TOOL_NAMES.has("cancel_schedule_event")).toBe(true);
    expect(AMORA_ATOMIC_TOOL_NAMES.has("restore_schedule_event")).toBe(true);
  });

  it("builds one exact soft-cancel CAS with a server-verified actor receipt", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-02T03:04:05.000Z"));
    const ctx = context(plannedEvent());

    const operation = buildAmoraAtomicToolOperation(
      "cancel_schedule_event",
      {
        event_id: EVENT_ID,
        expected_title: "드레스 최종 피팅",
        expected_date: "2026-08-20",
        reason: "  일정이 변경됨  ",
      },
      ctx,
    );

    expect(operation.domainMutation).toMatchObject({
      kind: "journey_progress_key_cas",
      key: "__events",
      expectedPresent: true,
    });
    const value = operation.domainMutation.value as Array<Record<string, unknown>>;
    expect(value).toHaveLength(1);
    expect(value[0]).toEqual({
      ...plannedEvent(),
      status: "cancelled",
      cancellation: {
        cancelledAt: "2026-08-02T03:04:05.000Z",
        cancelledByProfileId: ACTOR_ID,
        reason: "일정이 변경됨",
      },
      updatedAt: "2026-08-02T03:04:05.000Z",
    });
    expect(operation.result).toMatchObject({
      toolName: "cancel_schedule_event",
      success: true,
      toolOutput: {
        event: value[0],
        previous_event: plannedEvent(),
      },
    });

    applyAmoraAtomicToolResultToContext(operation.result, ctx);
    expect((ctx.weddingContext.progress as Record<string, unknown>).__events)
      .toEqual(value);
  });

  it("restores only a cancelled event, removes cancellation, and advances time", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-03T03:04:05.000Z"));
    const cancelled = {
      ...plannedEvent(),
      status: "cancelled",
      cancellation: {
        cancelledAt: "2026-08-02T03:04:05.000Z",
        cancelledByProfileId: ACTOR_ID,
        reason: "일정이 변경됨",
      },
      updatedAt: "2026-08-02T03:04:05.000Z",
    };
    const ctx = context(cancelled);

    const operation = buildAmoraAtomicToolOperation(
      "restore_schedule_event",
      {
        event_id: EVENT_ID,
        expected_title: "드레스 최종 피팅",
        expected_date: "2026-08-20",
      },
      ctx,
    );

    const value = operation.domainMutation.value as Array<Record<string, unknown>>;
    expect(value[0]).toEqual({
      ...plannedEvent(),
      status: "planned",
      updatedAt: "2026-08-03T03:04:05.000Z",
    });
    expect(value[0]).not.toHaveProperty("cancellation");
    expect(operation.result).toMatchObject({
      toolName: "restore_schedule_event",
      success: true,
      toolOutput: {
        event: value[0],
        previous_event: cancelled,
      },
    });
  });

  it("fails closed without a verified current actor or for unsafe cancellation input", () => {
    const missingActor = context(plannedEvent());
    delete missingActor.actorProfileId;

    expect(buildAmoraAtomicToolOperation(
      "cancel_schedule_event",
      {
        event_id: EVENT_ID,
        expected_title: "드레스 최종 피팅",
        expected_date: "2026-08-20",
      },
      missingActor,
    )).toMatchObject({
      domainMutation: { kind: "none" },
      result: { success: false, toolOutput: { error: "schedule_actor_missing" } },
    });
    expect(buildAmoraAtomicToolOperation(
      "cancel_schedule_event",
      {
        event_id: EVENT_ID,
        expected_title: "드레스 최종 피팅",
        expected_date: "2026-08-20",
        reason: `bad${String.fromCharCode(0)}reason`,
      },
      context(plannedEvent()),
    )).toMatchObject({
      domainMutation: { kind: "none" },
      result: { success: false, toolOutput: { error: "invalid_schedule_cancellation" } },
    });
  });

  it("binds approval copy to a human-readable target without exposing its internal ID", () => {
    const payload = {
      tool: "cancel_schedule_event",
      input: {
        event_id: EVENT_ID,
        expected_title: "드레스 최종 피팅",
        expected_date: "2026-08-20",
        reason: "업체와 날짜 재조정",
      },
    };
    const extracted = extractAmoraPendingAction({
      text: `[pending_action]${JSON.stringify(payload)}[/pending_action]`,
      allowedTools: BETA_SAFE_TOOLS,
      now: 1_789_000_000_000,
      createActionId: () => "55555555-5555-4555-8555-555555555555",
    });

    expect(extracted.pendingAction).toMatchObject(payload);
    expect(extracted.cleanText).toContain("일정 취소");
    expect(extracted.cleanText).toContain("드레스 최종 피팅");
    // 2026-08-23: 확인 카드가 날짜를 한국어로 읽어준다. 이 검사의 의도(내부 ID 대신
    // 사람이 읽는 제목+날짜로 대상을 식별한다)는 그대로이고, 표기만 더 읽기 쉬워졌다.
    expect(extracted.cleanText).toContain("2026년 8월 20일");
    expect(extracted.cleanText).toContain("업체와 날짜 재조정");
    expect(extracted.cleanText).not.toContain(EVENT_ID);

    const unsafe = extractAmoraPendingAction({
      text: `[pending_action]${JSON.stringify({
        ...payload,
        input: { ...payload.input, reason: "숨김\u200B문자" },
      })}[/pending_action]`,
      allowedTools: BETA_SAFE_TOOLS,
      now: 1_789_000_000_000,
      createActionId: () => "55555555-5555-4555-8555-555555555555",
    });
    expect(unsafe.pendingAction).toBeNull();
  });

  it("rejects a stale human-readable target even when its internal ID still exists", () => {
    const operation = buildAmoraAtomicToolOperation(
      "cancel_schedule_event",
      {
        event_id: EVENT_ID,
        expected_title: "예전 제목",
        expected_date: "2026-08-20",
      },
      context(plannedEvent()),
    );

    expect(operation).toMatchObject({
      domainMutation: { kind: "none" },
      result: {
        success: false,
        toolOutput: { error: "schedule_target_changed" },
      },
    });
  });

  it("keeps cancelled events out of ordinary reads but exposes them for an explicit restore lookup", () => {
    const cancelled = {
      ...plannedEvent(),
      status: "cancelled",
      cancellation: {
        cancelledAt: "2026-08-02T03:04:05.000Z",
        cancelledByProfileId: ACTOR_ID,
        reason: "업체 일정 변경",
      },
      updatedAt: "2026-08-02T03:04:05.000Z",
    };
    const planned = {
      ...plannedEvent(),
      id: "evt_venue_visit",
      title: "예식장 방문",
    };
    const ctx = context(cancelled);
    ctx.weddingContext.progress = {
      __events: [cancelled, planned],
    } as unknown as ToolExecutionContext["weddingContext"]["progress"];

    const ordinary = executeGetScheduleEvents({
      from_date: "2026-08-01",
      to_date: "2026-08-31",
    }, ctx);
    expect(ordinary.toolOutput.events).toEqual([{
      id: "evt_venue_visit",
      date: "2026-08-20",
      time: "14:00",
      title: "예식장 방문",
      memo: "수선 확인",
      status: "planned",
    }]);
    expect(ordinary.displayMessage).not.toContain("드레스 최종 피팅");

    const restoreLookup = executeGetScheduleEvents({
      status: "cancelled",
    }, ctx);
    expect(restoreLookup.toolOutput.events).toEqual([{
      id: EVENT_ID,
      date: "2026-08-20",
      time: "14:00",
      title: "드레스 최종 피팅",
      memo: "수선 확인",
      status: "cancelled",
      cancellation: {
        cancelledAt: "2026-08-02T03:04:05.000Z",
        reason: "업체 일정 변경",
      },
    }]);
    expect(JSON.stringify(restoreLookup.toolOutput))
      .not.toContain("cancelledByProfileId");
    expect(restoreLookup.displayMessage).toContain("취소 일정");
  });

  it("turns every legacy delete operation into a durable no-op", () => {
    const operation = buildAmoraAtomicToolOperation(
      "delete_schedule_event",
      { event_id: EVENT_ID, confirmed: true },
      context(plannedEvent()),
    );

    expect(operation).toMatchObject({
      domainMutation: { kind: "none" },
      result: {
        toolName: "delete_schedule_event",
        success: false,
        toolOutput: { error: "legacy_schedule_delete_blocked" },
      },
    });
  });
});
