import { describe, expect, it, vi } from "vitest";
import {
  ScheduleEventConflictError,
  mutateScheduleEvent,
} from "../scheduleEventClient";

describe("mutateScheduleEvent", () => {
  it("sends the stable event id explicitly when updating", async () => {
    const event = {
      id: "evt_update_contract",
      date: "2026-08-20",
      title: "수정할 일정",
      createdAt: "2026-07-13T00:00:00.000Z",
      updatedAt: "2026-07-13T00:05:00.000Z",
    };
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      progress: { __events: [event] },
      event,
      eventId: event.id,
    }), { status: 200, headers: { "Content-Type": "application/json" } }));

    await mutateScheduleEvent({
      operation: "update",
      eventId: event.id,
      event,
      expectedUpdatedAt: "2026-07-13T00:00:00.000Z",
    }, fetcher);

    expect(JSON.parse(fetcher.mock.calls[0][1].body as string)).toEqual({
      operation: "update",
      eventId: event.id,
      event,
      expectedUpdatedAt: "2026-07-13T00:00:00.000Z",
    });
  });

  it("sends one event mutation without a stale progress array and accepts validated authoritative progress", async () => {
    const event = {
      id: "evt_client_1",
      date: "2026-08-20",
      title: "드레스 최종 피팅",
      createdAt: "2026-07-13T00:00:00.000Z",
      updatedAt: "2026-07-13T00:00:00.000Z",
    };
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      progress: {
        __events: [event, {
          id: "evt_partner_1",
          date: "2026-08-21",
          title: "파트너가 추가한 일정",
          createdAt: "2026-07-13T00:01:00.000Z",
          updatedAt: "2026-07-13T00:01:00.000Z",
        }],
      },
      event,
      eventId: event.id,
    }), { status: 200, headers: { "Content-Type": "application/json" } }));

    const result = await mutateScheduleEvent({ operation: "add", event }, fetcher);
    const requestBody = JSON.parse(fetcher.mock.calls[0][1].body as string);

    expect(fetcher).toHaveBeenCalledWith(
      "/api/journey/schedule-events",
      expect.objectContaining({ method: "POST" }),
    );
    expect(requestBody).toEqual({ operation: "add", event });
    expect(requestBody.progress).toBeUndefined();
    expect(result.progress.__events).toHaveLength(2);
  });

  it("fails closed when a successful response does not confirm the requested stable event id", async () => {
    const requestedEvent = {
      id: "evt_requested",
      date: "2026-08-20",
      title: "드레스 최종 피팅",
      createdAt: "2026-07-13T00:00:00.000Z",
      updatedAt: "2026-07-13T00:00:00.000Z",
    };
    const otherEvent = { ...requestedEvent, id: "evt_other" };
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      progress: { __events: [otherEvent] },
      event: otherEvent,
      eventId: otherEvent.id,
    }), { status: 200, headers: { "Content-Type": "application/json" } }));

    await expect(
      mutateScheduleEvent({ operation: "add", event: requestedEvent }, fetcher),
    ).rejects.toThrow("확인하지 못했습니다");
  });

  it("carries validated latest progress with a same-event conflict", async () => {
    const latestProgress = {
      __events: [{
        id: "evt_shared",
        date: "2026-08-25",
        title: "파트너가 변경한 일정",
        createdAt: "2026-07-12T00:00:00.000Z",
        updatedAt: "2026-07-13T02:00:00.000Z",
      }],
    };
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: "다른 기기에서 이 일정이 먼저 변경되었습니다.",
      progress: latestProgress,
    }), { status: 409, headers: { "Content-Type": "application/json" } }));

    let caught: unknown;
    try {
      await mutateScheduleEvent({
        operation: "delete",
        eventId: "evt_shared",
        expectedUpdatedAt: "2026-07-12T00:00:00.000Z",
      }, fetcher);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ScheduleEventConflictError);
    expect((caught as ScheduleEventConflictError).progress).toEqual(latestProgress);
  });

  it("rejects a nominal success whose optional event fields have the wrong type", async () => {
    const malformedEvent = {
      id: "evt_bad_memo",
      date: "2026-08-28",
      title: "드레스 피팅",
      memo: 42,
      createdAt: "2026-07-13T00:00:00.000Z",
      updatedAt: "2026-07-13T00:00:00.000Z",
    };
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      progress: { __events: [malformedEvent] },
      event: malformedEvent,
      eventId: malformedEvent.id,
    }), { status: 200, headers: { "Content-Type": "application/json" } }));

    await expect(mutateScheduleEvent({
      operation: "add",
      event: { ...malformedEvent, memo: undefined },
    }, fetcher)).rejects.toThrow("확인하지 못했습니다");
  });

  it("rejects authoritative progress with duplicate stable ids", async () => {
    const event = {
      id: "evt_duplicate",
      date: "2026-08-29",
      title: "일정",
      createdAt: "2026-07-13T00:00:00.000Z",
      updatedAt: "2026-07-13T00:00:00.000Z",
    };
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      progress: { __events: [event, { ...event, title: "다른 일정" }] },
      event,
      eventId: event.id,
    }), { status: 200, headers: { "Content-Type": "application/json" } }));

    await expect(
      mutateScheduleEvent({ operation: "add", event }, fetcher),
    ).rejects.toThrow("확인하지 못했습니다");
  });
});
