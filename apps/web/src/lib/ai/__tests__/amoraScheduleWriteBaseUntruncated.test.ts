import { afterEach, describe, expect, it, vi } from "vitest";

import { buildAmoraAtomicToolOperation } from "@/lib/ai/amoraAtomicToolOperation";
import { extractAmoraPendingAction } from "@/lib/ai/amoraPendingAction";
import { resolveAmoraWeddingContext } from "@/lib/ai/amoraWeddingContext";
import { BETA_SAFE_TOOLS } from "@/lib/ai/tools";
import { executeGetScheduleEvents } from "@/lib/ai/tools/scheduleTools";
import type { ToolExecutionContext } from "@/lib/ai/tools/toolTypes";

/**
 * 일정 쓰기의 CAS 기대값은 DB 가 비교하는 **자르지 않은 저장 행**이어야 한다.
 *
 * ## 무엇이 깨져 있었나 (2026-09-15 점검)
 *
 * 라우트는 프롬프트용으로 문자열 1,000자·배열 100개로 자른 progress 를 도구 실행 문맥에
 * 넣었다. 원자적 쓰기는 그 `progress.__events` 를 `expected` 로 보내고, DB
 * (`apply_amora_atomic_tool_execution`, 20260824120000)는 저장된 `progress -> '__events'`
 * 와 `IS DISTINCT FROM` 으로 비교한다. 메모 한 줄이 1,000자를 넘거나 일정이 101개면 둘은
 * 절대 같을 수 없어서, 아무도 바꾸지 않았는데 일정 추가·변경·취소가 전부
 * "다른 일정 변경이 먼저 반영되어 이번 요청은 적용하지 않았어요" 로 끝났다.
 *
 * 여기서는 DB 비교를 `toStrictEqual` 로 흉내 낸다. 라우트가 쓰는 것과 같은
 * `resolveAmoraWeddingContext(...).storedProgress` 로 문맥을 만든다.
 */

const ACTOR_ID = "11111111-1111-4111-8111-111111111111";

function storedEvent(index: number, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: `evt_${index}`,
    date: "2027-05-03",
    time: "14:00",
    title: `일정 ${index}`,
    memo: "메모",
    status: "planned",
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    ...overrides,
  };
}

/** 라우트와 같은 경로로 문맥을 만든다. 반환하는 `storedEvents` 는 DB 에 있는 원본이다. */
function contextFromStoredJourney(events: Array<Record<string, unknown>>) {
  const journey = { progress: { __events: events } };
  const storedEvents = structuredClone(events);
  const resolved = resolveAmoraWeddingContext({
    canonicalJourney: journey,
    clientContext: null,
    allowClientContext: false,
  });
  const context: ToolExecutionContext = {
    coupleId: "22222222-2222-4222-8222-222222222222",
    actorProfileId: ACTOR_ID,
    requestKey: "chat:11111111-1111-4111-8111-111111111111:33333333-3333-4333-8333-333333333333",
    requestAttemptCount: 1,
    pendingActionId: "44444444-4444-4444-8444-444444444444",
    weddingContext: {
      weddingDate: "2027-10-10",
      budget: 30_000_000,
      venue: null,
      progress: resolved.storedProgress as ToolExecutionContext["weddingContext"]["progress"],
    },
  };
  return { context, resolved, storedEvents };
}

const succeeded = (operation: ReturnType<typeof buildAmoraAtomicToolOperation>) =>
  operation.result.success === true;
const errorOf = (operation: ReturnType<typeof buildAmoraAtomicToolOperation>) =>
  (operation.result.toolOutput as { error?: string }).error;

afterEach(() => {
  vi.useRealTimers();
});

describe("긴 메모가 있어도 일정 쓰기의 기대값이 저장 행과 같다", () => {
  const withLongMemo = () => [
    storedEvent(0, { memo: "메".repeat(1_001) }),
    storedEvent(1, { title: "드레스 최종 피팅" }),
  ];

  it("프롬프트용 사본은 여전히 자른다 — 그래서 그걸 기대값으로 쓰면 안 된다", () => {
    const { resolved, storedEvents } = contextFromStoredJourney(withLongMemo());
    expect(resolved.progress.__events).not.toStrictEqual(storedEvents);
  });

  it.each([
    ["add_schedule_event", { date: "2027-06-01", title: "본식 리허설" }],
    ["update_schedule_event", { event_id: "evt_1", time: "15:00" }],
    [
      "cancel_schedule_event",
      { event_id: "evt_1", expected_title: "드레스 최종 피팅", expected_date: "2027-05-03" },
    ],
  ] as const)("%s", (toolName, input) => {
    const { context, storedEvents } = contextFromStoredJourney(withLongMemo());
    const operation = buildAmoraAtomicToolOperation(toolName, { ...input }, context);

    expect(succeeded(operation), JSON.stringify(operation.result)).toBe(true);
    expect(operation.domainMutation).toMatchObject({
      kind: "journey_progress_key_cas",
      key: "__events",
      expectedPresent: true,
    });
    expect((operation.domainMutation as { expected?: unknown }).expected).toStrictEqual(storedEvents);
    // 건드리지 않은 긴 메모는 새 값에도 한 글자도 잘리지 않고 남는다.
    const value = (operation.domainMutation as { value: Array<{ id: string; memo?: string }> }).value;
    expect(value.find((event) => event.id === "evt_0")?.memo).toHaveLength(1_001);
  });
});

describe("일정이 100개를 넘어도 기대값이 저장 행과 같고, 101번째 일정도 고칠 수 있다", () => {
  const manyEvents = () => Array.from({ length: 101 }, (_, index) => storedEvent(index));

  it.each([
    ["add_schedule_event", { date: "2027-06-01", title: "본식 리허설" }],
    ["update_schedule_event", { event_id: "evt_100", time: "16:00" }],
    [
      "cancel_schedule_event",
      { event_id: "evt_100", expected_title: "일정 100", expected_date: "2027-05-03" },
    ],
  ] as const)("%s", (toolName, input) => {
    const { context, storedEvents } = contextFromStoredJourney(manyEvents());
    const operation = buildAmoraAtomicToolOperation(toolName, { ...input }, context);

    expect(succeeded(operation), JSON.stringify(operation.result)).toBe(true);
    expect((operation.domainMutation as { expected?: unknown }).expected).toStrictEqual(storedEvents);
    const value = (operation.domainMutation as { value: unknown[] }).value;
    expect(value.length).toBeGreaterThanOrEqual(101);
  });

  it("101번째 일정을 가리키는 확인 카드는 '없는 일정' 으로 버려지지 않는다", () => {
    const { resolved } = contextFromStoredJourney(manyEvents());
    const extracted = extractAmoraPendingAction({
      text: `[pending_action]${JSON.stringify({
        tool: "cancel_schedule_event",
        input: { event_id: "evt_100", expected_title: "일정 100", expected_date: "2027-05-03" },
      })}[/pending_action]`,
      allowedTools: BETA_SAFE_TOOLS.filter((tool) => tool.name === "cancel_schedule_event"),
      now: 1_789_000_000_000,
      createActionId: () => "55555555-5555-4555-8555-555555555555",
      knownScheduleEventIds: new Set(resolved.storedScheduleEventIds),
    });

    expect(extracted.dropReason).toBeUndefined();
    expect(extracted.pendingAction).toMatchObject({
      tool: "cancel_schedule_event",
      input: { event_id: "evt_100" },
    });
  });

  it("취소한 일정의 복원 카드도 저장된 id 로 알아본다", () => {
    const events = manyEvents();
    events[100] = storedEvent(100, {
      status: "cancelled",
      cancellation: {
        cancelledAt: "2026-08-02T03:04:05.000Z",
        cancelledByProfileId: ACTOR_ID,
      },
      updatedAt: "2026-08-02T03:04:05.000Z",
    });
    const { resolved } = contextFromStoredJourney(events);
    const extracted = extractAmoraPendingAction({
      text: `[pending_action]${JSON.stringify({
        tool: "restore_schedule_event",
        input: { event_id: "evt_100", expected_title: "일정 100", expected_date: "2027-05-03" },
      })}[/pending_action]`,
      allowedTools: BETA_SAFE_TOOLS.filter((tool) => tool.name === "restore_schedule_event"),
      now: 1_789_000_000_000,
      createActionId: () => "55555555-5555-4555-8555-555555555555",
      knownScheduleEventIds: new Set(resolved.storedScheduleEventIds),
    });

    expect(extracted.dropReason).toBeUndefined();
    expect(extracted.pendingAction?.tool).toBe("restore_schedule_event");
  });
});

describe("300자가 넘는 제목의 일정 취소", () => {
  const longTitle = `${"가".repeat(400)} 드레스 투어`;
  const events = () => [storedEvent(7, { title: longTitle })];

  it("일정 조회가 돌려준 전체 제목으로 취소하면 반영되고 기대값도 저장 행과 같다", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-15T03:00:00.000Z"));
    const { context, storedEvents } = contextFromStoredJourney(events());
    const lookup = executeGetScheduleEvents({ from_date: "2027-05-01", to_date: "2027-05-31" }, context);
    const seen = (lookup.toolOutput.events as Array<{ id: string; title: string }>)
      .find((event) => event.id === "evt_7");
    expect(seen?.title).toBe(longTitle);

    const operation = buildAmoraAtomicToolOperation(
      "cancel_schedule_event",
      { event_id: "evt_7", expected_title: seen!.title, expected_date: "2027-05-03" },
      context,
    );
    expect(succeeded(operation), JSON.stringify(operation.result)).toBe(true);
    expect((operation.domainMutation as { expected?: unknown }).expected).toStrictEqual(storedEvents);
  });

  // 옮기기와 달리 앞부분 일치를 받지 않는다. 승인 카드 실행 때 DB 트리거
  // (`capture_amora_shared_schedule_cancel_restore_delta`)가 제목 정확 일치를 다시 요구하므로,
  // 앱이 느슨하게 통과시키면 깨끗한 안내 대신 DB 예외로 끝난다.
  it("프롬프트가 자른 300자 제목이면 아무것도 바꾸지 않고 다시 확인하라고 안내한다", () => {
    const { context } = contextFromStoredJourney(events());
    const operation = buildAmoraAtomicToolOperation(
      "cancel_schedule_event",
      { event_id: "evt_7", expected_title: longTitle.slice(0, 300), expected_date: "2027-05-03" },
      context,
    );

    expect(operation.domainMutation).toEqual({ kind: "none" });
    expect(errorOf(operation)).toBe("schedule_target_changed");
    expect(operation.result.displayMessage).toContain("현재 일정을 다시 확인해 주세요");
  });
});
