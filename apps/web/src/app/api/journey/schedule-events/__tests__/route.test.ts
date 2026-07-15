import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClientFromRequest } from "@/lib/supabase/server";
import { POST } from "../route";

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClientFromRequest: vi.fn(),
}));

function createRequest(body: Record<string, unknown>) {
  return new Request("http://localhost/api/journey/schedule-events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/journey/schedule-events", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createClientFromRequest).mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } } }),
      },
    } as unknown as Awaited<ReturnType<typeof createClientFromRequest>>);
  });

  it("adds one stable-id event through the atomic couple-owned mutation and returns the authoritative progress", async () => {
    const event = {
      id: "evt_client_1",
      date: "2026-08-20",
      title: "드레스 최종 피팅",
      time: "14:30",
      memo: "오후 2시",
      categoryKey: "dress",
      createdAt: "2026-07-13T00:00:00.000Z",
      updatedAt: "2026-07-13T00:00:00.000Z",
    };
    const existingOffsetEvent = {
      id: "evt_existing_offset",
      date: "2026-08-19",
      title: "기존 상견례 일정",
      createdAt: "2026-07-12T10:00:00.123456+00:00",
      updatedAt: "2026-07-12T10:00:00.123456+00:00",
    };
    const rpc = vi.fn().mockResolvedValue({
      data: {
        progress: { __events: [existingOffsetEvent, event], venue: { status: "in_progress" } },
        event,
        eventId: event.id,
      },
      error: null,
    });
    const single = vi.fn().mockResolvedValue({
      data: { couple_id: "couple-1" },
      error: null,
    });
    const admin = {
      from: vi.fn(() => ({ select: vi.fn(() => ({ eq: vi.fn(() => ({ single })) })) })),
      rpc,
    };
    vi.mocked(createAdminClient).mockReturnValue(
      admin as unknown as ReturnType<typeof createAdminClient>,
    );

    const response = await POST(createRequest({ operation: "add", event }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("mutate_journey_schedule_event", {
      p_couple_id: "couple-1",
      p_operation: "add",
      p_event: event,
      p_event_id: event.id,
      p_expected_updated_at: null,
    });
    expect(body.progress.__events).toEqual([existingOffsetEvent, event]);
    expect(body.event).toEqual(event);
  });

  it("fails closed when the database mutation does not return authoritative schedule state", async () => {
    const malformedEvent = {
      id: "evt_invalid_optional_field",
      date: "2026-08-21",
      title: "메이크업 리허설",
      memo: 42,
      createdAt: "2026-07-13T00:00:00.000Z",
      updatedAt: "2026-07-13T00:00:00.000Z",
    };
    const single = vi.fn().mockResolvedValue({
      data: { couple_id: "couple-1" },
      error: null,
    });
    vi.mocked(createAdminClient).mockReturnValue({
      from: vi.fn(() => ({ select: vi.fn(() => ({ eq: vi.fn(() => ({ single })) })) })),
      rpc: vi.fn().mockResolvedValue({
        data: {
          progress: { __events: [malformedEvent] },
          event: malformedEvent,
          eventId: malformedEvent.id,
        },
        error: null,
      }),
    } as unknown as ReturnType<typeof createAdminClient>);

    const response = await POST(createRequest({
      operation: "add",
      event: {
        id: "evt_client_2",
        date: "2026-08-21",
        title: "메이크업 리허설",
        createdAt: "2026-07-13T00:00:00.000Z",
        updatedAt: "2026-07-13T00:00:00.000Z",
      },
    }));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toContain("확인하지 못했습니다");
  });

  it("updates one event by stable id and rejects stale same-event edits through its expected timestamp", async () => {
    const event = {
      id: "evt_shared_1",
      date: "2026-08-22",
      title: "드레스 피팅 시간 변경",
      createdAt: "2026-07-12T00:00:00.000Z",
      updatedAt: "2026-07-13T01:00:00.000Z",
    };
    const rpc = vi.fn().mockResolvedValue({
      data: {
        progress: { __events: [event] },
        event,
        eventId: event.id,
      },
      error: null,
    });
    const single = vi.fn().mockResolvedValue({
      data: { couple_id: "couple-1" },
      error: null,
    });
    vi.mocked(createAdminClient).mockReturnValue({
      from: vi.fn(() => ({ select: vi.fn(() => ({ eq: vi.fn(() => ({ single })) })) })),
      rpc,
    } as unknown as ReturnType<typeof createAdminClient>);

    const response = await POST(createRequest({
      operation: "update",
      event,
      eventId: event.id,
      expectedUpdatedAt: "2026-07-12T00:00:00.000Z",
    }));

    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("mutate_journey_schedule_event", {
      p_couple_id: "couple-1",
      p_operation: "update",
      p_event: event,
      p_event_id: event.id,
      p_expected_updated_at: "2026-07-12T00:00:00.000Z",
    });
  });

  it("fails closed when authoritative progress contains duplicate stable event ids", async () => {
    const event = {
      id: "evt_duplicate",
      date: "2026-08-22",
      title: "중복 일정",
      createdAt: "2026-07-13T00:00:00.000Z",
      updatedAt: "2026-07-13T00:00:00.000Z",
    };
    const single = vi.fn().mockResolvedValue({
      data: { couple_id: "couple-1" }, error: null,
    });
    vi.mocked(createAdminClient).mockReturnValue({
      from: vi.fn(() => ({ select: vi.fn(() => ({ eq: vi.fn(() => ({ single })) })) })),
      rpc: vi.fn().mockResolvedValue({
        data: {
          progress: { __events: [event, { ...event, title: "같은 ID의 다른 일정" }] },
          event,
          eventId: event.id,
        },
        error: null,
      }),
    } as unknown as ReturnType<typeof createAdminClient>);

    const response = await POST(createRequest({ operation: "add", event }));

    expect(response.status).toBe(500);
  });

  it("fails closed when the RPC confirms a different event id than requested", async () => {
    const requestedEvent = {
      id: "evt_requested",
      date: "2026-08-22",
      title: "요청한 일정",
      createdAt: "2026-07-13T00:00:00.000Z",
      updatedAt: "2026-07-13T00:00:00.000Z",
    };
    const otherEvent = { ...requestedEvent, id: "evt_other" };
    const single = vi.fn().mockResolvedValue({
      data: { couple_id: "couple-1" }, error: null,
    });
    vi.mocked(createAdminClient).mockReturnValue({
      from: vi.fn(() => ({ select: vi.fn(() => ({ eq: vi.fn(() => ({ single })) })) })),
      rpc: vi.fn().mockResolvedValue({
        data: {
          progress: { __events: [otherEvent] },
          event: otherEvent,
          eventId: otherEvent.id,
        },
        error: null,
      }),
    } as unknown as ReturnType<typeof createAdminClient>);

    const response = await POST(createRequest({ operation: "add", event: requestedEvent }));

    expect(response.status).toBe(500);
  });

  it("deletes exactly one stable-id event with an expected timestamp", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        progress: { __events: [] },
        event: null,
        eventId: "evt_shared_2",
      },
      error: null,
    });
    const single = vi.fn().mockResolvedValue({
      data: { couple_id: "couple-1" },
      error: null,
    });
    vi.mocked(createAdminClient).mockReturnValue({
      from: vi.fn(() => ({ select: vi.fn(() => ({ eq: vi.fn(() => ({ single })) })) })),
      rpc,
    } as unknown as ReturnType<typeof createAdminClient>);

    const response = await POST(createRequest({
      operation: "delete",
      eventId: "evt_shared_2",
      expectedUpdatedAt: "2026-07-12T00:00:00.000Z",
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("mutate_journey_schedule_event", {
      p_couple_id: "couple-1",
      p_operation: "delete",
      p_event: null,
      p_event_id: "evt_shared_2",
      p_expected_updated_at: "2026-07-12T00:00:00.000Z",
    });
    expect(body.progress.__events).toEqual([]);
    expect(body.event).toBeNull();
  });

  it("returns a conflict instead of overwriting a partner's newer edit", async () => {
    const newerEvent = {
      id: "evt_shared_3",
      date: "2026-08-23",
      title: "파트너가 먼저 바꾼 일정",
      createdAt: "2026-07-12T00:00:00.000Z",
      updatedAt: "2026-07-13T02:00:00.000Z",
    };
    const profileSingle = vi.fn().mockResolvedValue({
      data: { couple_id: "couple-1" }, error: null,
    });
    const journeySingle = vi.fn().mockResolvedValue({
      data: { progress: { __events: [newerEvent] } }, error: null,
    });
    vi.mocked(createAdminClient).mockReturnValue({
      from: vi.fn((table: string) => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            single: table === "profiles" ? profileSingle : journeySingle,
          })),
        })),
      })),
      rpc: vi.fn().mockResolvedValue({
        data: null,
        error: { code: "40001", message: "schedule_event_conflict" },
      }),
    } as unknown as ReturnType<typeof createAdminClient>);

    const response = await POST(createRequest({
      operation: "delete",
      eventId: "evt_shared_3",
      expectedUpdatedAt: "2026-07-12T00:00:00.000Z",
    }));
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error).toContain("다른 기기");
    expect(body.progress.__events).toEqual([newerEvent]);
  });
});
