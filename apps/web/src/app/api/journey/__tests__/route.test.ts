// @vitest-environment node

import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClientFromRequest } from "@/lib/supabase/server";
import { checkRateLimitPersistent } from "@/utils/rateLimit";
import { PATCH } from "../route";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const COUPLE_ID = "22222222-2222-4222-8222-222222222222";
const REQUEST_ID = "33333333-3333-4333-8333-333333333333";
const JOURNEY_ID = "44444444-4444-4444-8444-444444444444";

const mocks = vi.hoisted(() => ({
  user: {
    id: "11111111-1111-4111-8111-111111111111",
  } as { id: string } | null,
  profile: {
    couple_id: "22222222-2222-4222-8222-222222222222",
  } as { couple_id: string | null } | null,
  profileError: null as unknown,
  currentJourney: {
    progress: {},
    state_revision: 7,
  } as { progress: Record<string, unknown>; state_revision: number } | null,
  currentJourneyError: null as unknown,
  authFrom: vi.fn(),
  adminFrom: vi.fn(),
  rpc: vi.fn(),
}));

function queryResult(data: unknown, error: unknown = null) {
  const query: Record<string, unknown> = {};
  for (const method of ["select", "eq"]) {
    query[method] = vi.fn(() => query);
  }
  query.single = vi.fn(async () => ({ data, error }));
  return query;
}

vi.mock("@/lib/supabase/server", () => ({
  createClientFromRequest: vi.fn(async () => ({
    auth: {
      getUser: vi.fn(async () => ({ data: { user: mocks.user } })),
    },
    from: mocks.authFrom,
  })),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => ({
    from: mocks.adminFrom,
    rpc: mocks.rpc,
  })),
}));

vi.mock("@/utils/rateLimit", () => ({
  checkRateLimitPersistent: vi.fn(async () => null),
  rateLimitKey: vi.fn(() => "journey:test"),
}));

function journey(revision = 8) {
  return {
    id: JOURNEY_ID,
    couple_id: COUPLE_ID,
    wedding_date: "2027-05-01",
    venue: "새 예식장",
    total_budget: 40_000_000,
    progress: {},
    state_revision: revision,
  };
}

function request(
  body: unknown = {
    expected_revision: 7,
    total_budget: 40_000_000,
  },
  headers: Record<string, string> = {},
  includeExpectedCouple = true,
) {
  return new Request("http://localhost/api/journey", {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      "sec-fetch-site": "same-origin",
      ...headers,
    },
    body: JSON.stringify(includeExpectedCouple && typeof body === "object" && body !== null && !Array.isArray(body)
      ? { expected_couple_id: COUPLE_ID, ...body }
      : body),
  });
}

describe("/api/journey PATCH couple plan-change contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.user = { id: USER_ID };
    mocks.profile = { couple_id: COUPLE_ID };
    mocks.profileError = null;
    mocks.currentJourney = { progress: {}, state_revision: 7 };
    mocks.currentJourneyError = null;
    mocks.authFrom.mockImplementation((table: string) => {
      if (table === "profiles") {
        return queryResult(mocks.profile, mocks.profileError);
      }
      if (table === "wedding_journeys") {
        return queryResult(mocks.currentJourney, mocks.currentJourneyError);
      }
      throw new Error(`unexpected auth table: ${table}`);
    });
    vi.mocked(checkRateLimitPersistent).mockResolvedValue(null);
    mocks.rpc.mockResolvedValue({
      data: {
        requestId: REQUEST_ID,
        status: "applied",
        requiredCount: 1,
        acceptedCount: 1,
        journey: journey(),
      },
      error: null,
    });
  });

  it("rejects a shared action patch before constructing a privileged plan writer", async () => {
    const response = await PATCH(request({
      expected_revision: 7,
      progress_patch: { __amora_actions: [{ id: "synthetic-action", title: "합성 초안", status: "open" }] },
    }));

    expect(response.status).toBe(400);
    expect(response.headers.get("cache-control")).toContain("no-store");
    await expect(response.json()).resolves.toMatchObject({
      code: "AMORA_ACTION_VIEW_REQUIRED",
      error: expect.stringContaining("결정 보드"),
    });
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it.each([
    { progress_remove_keys: ["__amora_actions"] },
    { progress: { __amora_actions: [{ id: "synthetic-action", status: "done" }] } },
    { progress: {} },
  ])("rejects reserved action replacement or removal without any privileged write: %j", async (updates) => {
    mocks.currentJourney = {
      progress: { __amora_actions: [{ id: "synthetic-action", status: "open" }] },
      state_revision: 7,
    };
    const response = await PATCH(request({ expected_revision: 7, ...updates }));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: "AMORA_ACTION_VIEW_REQUIRED" });
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("preserves unchanged reserved actions while normal progress still uses its canonical writer", async () => {
    const actions = [{ id: "synthetic-action", title: "합성 기록", status: "open" }];
    mocks.currentJourney = {
      progress: { __amora_actions: actions, custom: { note: "이전 메모" } },
      state_revision: 7,
    };
    const response = await PATCH(request({
      expected_revision: 7,
      progress: { __amora_actions: actions, custom: { note: "새 메모" } },
    }));
    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("submit_couple_plan_change", expect.objectContaining({
      p_changes: { progress_patch: { custom: { note: "새 메모" } }, progress_remove_keys: [] },
    }));
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });

  it("submits one normalized, revision-fenced budget change through the service RPC", async () => {
    const response = await PATCH(request());

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    await expect(response.json()).resolves.toEqual({
      requestId: REQUEST_ID,
      status: "applied",
      requiredCount: 1,
      acceptedCount: 1,
      summary: "총예산: 40000000원",
      surface: "/budget",
      journey: journey(),
    });
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).toHaveBeenCalledWith("submit_couple_plan_change", {
      p_couple_id: COUPLE_ID,
      p_actor_user_id: USER_ID,
      p_expected_revision: 7,
      p_changes: { total_budget: 40_000_000 },
      p_surface: "/budget",
      p_summary: "총예산: 40000000원",
    });
    expect(mocks.adminFrom).not.toHaveBeenCalled();
  });

  it("rejects a form from a previous couple before submitting any plan change", async () => {
    const response = await PATCH(request({
      expected_revision: 7,
      expected_couple_id: "55555555-5555-4555-8555-555555555555",
      venue: "이전 커플에서 편집한 예식장",
    }));

    expect(response.status).toBe(409);
    expect(response.headers.get("cache-control")).toContain("no-store");
    await expect(response.json()).resolves.toMatchObject({ code: "PLAN_CHANGE_IDENTITY_CHANGED" });
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("rejects a legacy form with no couple binding even when the newly connected couple has the same revision", async () => {
    const newCoupleId = "55555555-5555-4555-8555-555555555555";
    mocks.profile = { couple_id: newCoupleId };
    mocks.currentJourney = { progress: {}, state_revision: 7 };
    const writes: unknown[] = [];
    mocks.rpc.mockImplementation(async (_name: string, args: unknown) => {
      writes.push(args);
      return { data: { requestId: REQUEST_ID, status: "applied", requiredCount: 1, acceptedCount: 1, journey: { ...journey(), couple_id: newCoupleId } }, error: null };
    });
    const response = await PATCH(request({ expected_revision: 7, venue: "이전 커플의 초안" }, {}, false));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: expect.stringContaining("커플") });
    expect(writes).toEqual([]);
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("keeps the caller's expected couple fixed through the canonical RPC", async () => {
    const response = await PATCH(request({
      expected_revision: 7,
      expected_couple_id: COUPLE_ID,
      venue: "새 예식장",
    }));
    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("submit_couple_plan_change", expect.objectContaining({
      p_couple_id: COUPLE_ID,
      p_actor_user_id: USER_ID,
      p_expected_revision: 7,
      p_changes: { venue: "새 예식장" },
    }));
  });

  it("rejects a detached couple even when the old revision happens to match", async () => {
    mocks.profile = { couple_id: null };
    const response = await PATCH(request({ expected_revision: 7, expected_couple_id: COUPLE_ID, venue: "새 예식장" }));
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ code: "PLAN_CHANGE_IDENTITY_CHANGED" });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it.each([null, "", "not-a-uuid", 17, {}, []])("rejects a malformed expected couple: %j", async (expectedCoupleId) => {
    const response = await PATCH(request({ expected_revision: 7, expected_couple_id: expectedCoupleId, venue: "새 예식장" }));
    expect(response.status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("does not treat a profile lookup failure as an identity match", async () => {
    mocks.profileError = { code: "unavailable" };
    const response = await PATCH(request({ expected_revision: 7, expected_couple_id: COUPLE_ID, venue: "새 예식장" }));
    expect(response.status).toBe(503);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("rejects a revision race after the settings client checks its field baseline", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: "COUPLE_PLAN_CHANGE_STALE" } });
    const response = await PATCH(request({ expected_revision: 7, expected_couple_id: COUPLE_ID, venue: "새 예식장" }));
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ code: "PLAN_CHANGE_CONFLICT" });
  });

  it("returns 202 with a server-derived summary and no optimistic journey for partner approval", async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: {
        requestId: REQUEST_ID,
        status: "pending_partner",
        requiredCount: 2,
        acceptedCount: 1,
        summary: "결혼 예정일: 2027-05-01 → 미정 · 예식장: 미정 → 새 예식장",
        surface: "/schedule",
        journey: null,
      },
      error: null,
    });

    const response = await PATCH(request({
      expected_revision: 7,
      wedding_date: null,
      venue: "  새   예식장  ",
    }));
    const body = await response.json();

    expect(response.status).toBe(202);
    expect(body).toEqual({
      requestId: REQUEST_ID,
      status: "pending_partner",
      requiredCount: 2,
      acceptedCount: 1,
      summary: "결혼 예정일: 2027-05-01 → 미정 · 예식장: 미정 → 새 예식장",
      surface: "/schedule",
    });
    expect(body).not.toHaveProperty("journey");
    expect(mocks.rpc).toHaveBeenCalledWith(
      "submit_couple_plan_change",
      expect.objectContaining({
        p_changes: {
          wedding_date: null,
          venue: "새 예식장",
        },
        p_surface: "/schedule",
        p_summary: "결혼 예정일: 미정 · 예식장: 새 예식장",
      }),
    );
  });

  it("passes the exact server-derived schedule date/time summary through to the UI contract", async () => {
    const serverSummary =
      "일정 수정: 드레스 최종 피팅 · 날짜: 2027-03-01 → 2027-03-02 · 시간: 14:00 → 없음";
    const previousEvent = {
      id: "event-dress-fitting",
      date: "2027-03-01",
      time: "14:00",
      title: "드레스 최종 피팅",
      status: "planned",
      createdAt: "2026-08-01T01:00:00.000Z",
      updatedAt: "2026-08-01T01:00:00.000Z",
    };
    const updatedEvent = {
      ...previousEvent,
      date: "2027-03-02",
      time: null,
      updatedAt: "2026-08-02T01:00:00.000Z",
    };
    mocks.currentJourney = {
      progress: { __events: [previousEvent] },
      state_revision: 7,
    };
    mocks.rpc.mockResolvedValueOnce({
      data: {
        requestId: REQUEST_ID,
        status: "pending_partner",
        requiredCount: 2,
        acceptedCount: 1,
        summary: serverSummary,
        surface: "/schedule",
        journey: null,
      },
      error: null,
    });

    const response = await PATCH(request({
      expected_revision: 7,
      progress_patch: { __events: [updatedEvent] },
    }));

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({
      status: "pending_partner",
      summary: serverSummary,
      surface: "/schedule",
    });
    expect(mocks.rpc).toHaveBeenCalledWith(
      "submit_couple_plan_change",
      expect.objectContaining({
        p_changes: { progress_patch: { __events: [updatedEvent] } },
        p_surface: "/schedule",
        p_summary: "진행 상황: 1개 수정",
      }),
    );
  });

  it("returns only the database-canonical schedule event when a client submits a future audit clock", async () => {
    const forgedFutureAt = "2099-12-31T23:59:59.999Z";
    const canonicalServerAt = "2026-08-02T05:40:00.000Z";
    const clientEvent = {
      id: "event-clock-boundary",
      date: "2027-03-01",
      time: "14:00",
      title: "드레스 최종 피팅",
      status: "cancelled",
      createdAt: "2026-08-01T01:00:00.000Z",
      updatedAt: forgedFutureAt,
      cancellation: {
        cancelledAt: forgedFutureAt,
        cancelledByProfileId: USER_ID,
      },
    };
    const canonicalEvent = {
      ...clientEvent,
      updatedAt: canonicalServerAt,
      cancellation: {
        ...clientEvent.cancellation,
        cancelledAt: canonicalServerAt,
      },
    };
    mocks.rpc.mockResolvedValueOnce({
      data: {
        requestId: REQUEST_ID,
        status: "applied",
        requiredCount: 1,
        acceptedCount: 1,
        summary:
          "일정 취소: 드레스 최종 피팅 · 날짜: 2027-03-01 → 2027-03-01 · 시간: 14:00 → 14:00",
        surface: "/schedule",
        journey: {
          ...journey(),
          progress: { __events: [canonicalEvent] },
        },
      },
      error: null,
    });

    const response = await PATCH(request({
      expected_revision: 7,
      progress_patch: { __events: [clientEvent] },
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.journey.progress.__events).toEqual([canonicalEvent]);
    expect(body.journey.progress.__events[0].updatedAt).not.toBe(
      forgedFutureAt,
    );
    expect(mocks.rpc).toHaveBeenCalledWith(
      "submit_couple_plan_change",
      expect.objectContaining({
        p_changes: { progress_patch: { __events: [clientEvent] } },
      }),
    );
  });

  it("accepts 301 valid schedule events while the request remains within 128KB", async () => {
    const events = Array.from({ length: 301 }, (_, index) => ({
      id: `event-${index}`,
      date: "2027-03-01",
      title: "일정",
      status: "planned",
    }));
    const body = {
      expected_revision: 7,
      progress_patch: { __events: events },
    };
    expect(new TextEncoder().encode(JSON.stringify(body)).byteLength).toBeLessThan(
      128 * 1024,
    );

    const response = await PATCH(request(body));

    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith(
      "submit_couple_plan_change",
      expect.objectContaining({
        p_changes: { progress_patch: { __events: events } },
        p_surface: "/schedule",
      }),
    );
  });

  it("strictly normalizes progress patch/remove changes without silently dropping keys", async () => {
    const response = await PATCH(request({
      expected_revision: 7,
      progress_patch: {
        venue: {
          category: "venue",
          label: "  예식장   계약  ",
          status: "in_progress",
        },
      },
      progress_remove_keys: ["studio"],
    }));

    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith(
      "submit_couple_plan_change",
      expect.objectContaining({
        p_changes: {
          progress_patch: {
            venue: {
              category: "venue",
              label: "예식장 계약",
              status: "in_progress",
            },
          },
          progress_remove_keys: ["studio"],
        },
        p_surface: "/schedule",
        p_summary: "진행 상황: 1개 수정 · 1개 삭제",
      }),
    );
  });

  it("routes budget ownership changes to the budget review surface", async () => {
    const response = await PATCH(request({
      expected_revision: 7,
      progress_patch: {
        venue: {
          category: "venue",
          budget: 20_000_000,
          payer: "both_parents",
        },
      },
    }));

    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith(
      "submit_couple_plan_change",
      expect.objectContaining({
        p_surface: "/budget",
      }),
    );
  });

  it("returns the database-exact spent summary without an optimistic journey while partner approval is pending", async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: {
        requestId: REQUEST_ID,
        status: "pending_partner",
        requiredCount: 2,
        acceptedCount: 1,
        summary: "예식장 지출: 1000000원 → 2000000원",
        surface: "/budget",
        journey: null,
      },
      error: null,
    });

    const response = await PATCH(request({
      expected_revision: 7,
      progress_patch: {
        venue: {
          category: "venue",
          label: "예식장",
          budget: 10_000_000,
          spent: 2_000_000,
          payer: "couple",
        },
      },
    }));
    const body = await response.json();

    expect(response.status).toBe(202);
    expect(body).toEqual({
      requestId: REQUEST_ID,
      status: "pending_partner",
      requiredCount: 2,
      acceptedCount: 1,
      summary: "예식장 지출: 1000000원 → 2000000원",
      surface: "/budget",
    });
    expect(body).not.toHaveProperty("journey");
    expect(mocks.rpc).toHaveBeenCalledWith(
      "submit_couple_plan_change",
      expect.objectContaining({
        p_surface: "/budget",
        p_summary: "진행 상황: 1개 수정",
      }),
    );
  });

  it("rejects an invalid category spent amount before the service RPC", async () => {
    const response = await PATCH(request({
      expected_revision: 7,
      progress_patch: {
        venue: {
          category: "venue",
          spent: -1,
          payer: "couple",
        },
      },
    }));

    expect(response.status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("rejects an invalid category budget amount before the service RPC", async () => {
    const response = await PATCH(request({
      expected_revision: 7,
      progress_patch: {
        venue: {
          category: "venue",
          budget: 1.5,
          payer: "couple",
        },
      },
    }));

    expect(response.status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it.each([
    ["unknown status", { status: "done", checklist: [] }],
    ["non-boolean done", { status: "not_started", checklist: [{ id: "venue_01", label: "방문", done: "yes" }] }],
    ["duplicate ids", { status: "in_progress", checklist: [
      { id: "venue_01", label: "방문", done: true },
      { id: "venue_01", label: "계약", done: false },
    ] }],
    ["mismatched derived status", { status: "completed", checklist: [{ id: "venue_01", label: "방문", done: false }] }],
  ])("rejects invalid checklist fields: %s", async (_label, venue) => {
    const response = await PATCH(request({
      expected_revision: 7,
      progress_patch: { venue: { category: "venue", ...venue } },
    }));

    expect(response.status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("accepts a safe saved-only checklist item so older user data survives", async () => {
    const response = await PATCH(request({
      expected_revision: 7,
      progress_patch: {
        venue: {
          category: "venue",
          status: "in_progress",
          checklist: [
            { id: "venue_01", label: "방문", done: true },
            { id: "custom-legacy-1", label: "직접 추가했던 항목", done: false },
          ],
        },
      },
    }));

    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledOnce();
  });

  it("rejects a non-canonical payer on a new budget patch", async () => {
    const response = await PATCH(request({
      expected_revision: 7,
      progress_patch: {
        venue: {
          category: "venue",
          budget: 10_000_000,
          payer: "bride",
        },
      },
    }));

    expect(response.status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("rejects a budget item whose category does not match its progress key", async () => {
    const response = await PATCH(request({
      expected_revision: 7,
      progress_patch: {
        venue: {
          category: "studio",
          budget: 10_000_000,
          payer: "couple",
        },
      },
    }));

    expect(response.status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("rejects an empty budget item label", async () => {
    const response = await PATCH(request({
      expected_revision: 7,
      progress_patch: {
        venue: {
          category: "venue",
          label: "   ",
          budget: 10_000_000,
        },
      },
    }));

    expect(response.status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("requires a known budget category patch to be a record", async () => {
    const response = await PATCH(request({
      expected_revision: 7,
      progress_patch: {
        venue: 10_000_000,
      },
    }));

    expect(response.status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("does not let a legacy whole-progress replacement bypass budget validation", async () => {
    const response = await PATCH(request({
      expected_revision: 7,
      progress: {
        venue: {
          category: "venue",
          spent: 1_000_000_001,
          payer: "couple",
        },
      },
    }));

    expect(response.status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("converts a legacy whole-progress replacement into an exact patch/remove contract", async () => {
    mocks.currentJourney = {
      progress: {
        studio: { status: "completed" },
        venue: { status: "not_started" },
      },
      state_revision: 7,
    };

    const response = await PATCH(request({
      expected_revision: 7,
      progress: {
        venue: { status: "in_progress" },
      },
    }));

    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith(
      "submit_couple_plan_change",
      expect.objectContaining({
        p_changes: {
          progress_patch: {
            venue: { status: "in_progress" },
          },
          progress_remove_keys: ["studio"],
        },
        p_summary: "진행 상황: 전체 변경",
      }),
    );
  });

  it("maps a stale compare-and-swap result to a retryable 409", async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: {
        requestId: REQUEST_ID,
        status: "stale",
        requiredCount: 2,
        acceptedCount: 0,
        journey: null,
      },
      error: null,
    });

    const response = await PATCH(request());

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      requestId: REQUEST_ID,
      status: "stale",
      code: "PLAN_CHANGE_STALE",
      error: expect.stringContaining("다시 불러"),
    });
  });

  it("rejects an untrusted cookie mutation before authentication or service access", async () => {
    const response = await PATCH(request(undefined, {
      origin: "https://attacker.example",
      "sec-fetch-site": "cross-site",
    }));

    expect(response.status).toBe(403);
    expect(createClientFromRequest).not.toHaveBeenCalled();
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("rejects unauthenticated and unlinked callers without creating a service client", async () => {
    mocks.user = null;
    const unauthenticated = await PATCH(request());
    expect(unauthenticated.status).toBe(401);
    expect(createAdminClient).not.toHaveBeenCalled();

    vi.clearAllMocks();
    mocks.user = { id: USER_ID };
    mocks.profile = { couple_id: null };
    mocks.authFrom.mockImplementation(() => queryResult(mocks.profile));
    vi.mocked(checkRateLimitPersistent).mockResolvedValue(null);
    const unlinked = await PATCH(request());
    expect(unlinked.status).toBe(409);
    await expect(unlinked.json()).resolves.toMatchObject({ code: "PLAN_CHANGE_IDENTITY_CHANGED" });
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("fails closed when the current profile scope cannot be loaded", async () => {
    mocks.profileError = { code: "08006", message: "connection failure" };

    const response = await PATCH(request());

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining("커플 정보"),
    });
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("rate limits authenticated mutations before profile or service access", async () => {
    vi.mocked(checkRateLimitPersistent).mockResolvedValueOnce(
      NextResponse.json({ error: "limited" }, { status: 429 }),
    );

    const response = await PATCH(request());

    expect(response.status).toBe(429);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(mocks.authFrom).not.toHaveBeenCalled();
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("bounds streamed bodies even without trusting Content-Length", async () => {
    const oversized = request({
      expected_revision: 7,
      progress_patch: { venue: { notes: "x".repeat(130 * 1024) } },
    });
    expect(oversized.headers.get("content-length")).toBeNull();

    const response = await PATCH(oversized);

    expect(response.status).toBe(413);
    expect(createClientFromRequest).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it.each([
    ["a missing revision", { total_budget: 1 }],
    ["a string revision", { expected_revision: "7", total_budget: 1 }],
    ["a negative revision", { expected_revision: -1, total_budget: 1 }],
    ["an exhausted revision", { expected_revision: Number.MAX_SAFE_INTEGER, total_budget: 1 }],
    ["an unknown key", { expected_revision: 7, total_budget: 1, couple_id: COUPLE_ID }],
    ["an empty change", { expected_revision: 7 }],
    ["a numeric budget string", { expected_revision: 7, total_budget: "40000000" }],
    ["a fractional budget", { expected_revision: 7, total_budget: 1.5 }],
    ["an impossible date", { expected_revision: 7, wedding_date: "2027-02-29" }],
    ["a year-zero date", { expected_revision: 7, wedding_date: "0000-01-01" }],
    // 2026-09-04 실측: 2020-01-01 이 그대로 저장돼 일정 화면이 "+2438일 지남" 을 그렸다.
    ["a past date", { expected_revision: 7, wedding_date: "2020-01-01" }],
    ["an overlong venue", { expected_revision: 7, venue: "가".repeat(121) }],
    ["a bidi venue", { expected_revision: 7, venue: "정상\u202e000000001원" }],
    ["an invisible progress label", {
      expected_revision: 7,
      progress_patch: { venue: { label: "예식장\u2066거짓" } },
    }],
    ["a progress/patch collision", { expected_revision: 7, progress: {}, progress_patch: {} }],
    ["a non-array remove list", { expected_revision: 7, progress_remove_keys: "venue" }],
    ["an invalid remove key", { expected_revision: 7, progress_remove_keys: ["venue", "<bad>"] }],
    ["a duplicate remove key", { expected_revision: 7, progress_remove_keys: ["venue", "venue"] }],
    ["an overlapping patch/remove key", {
      expected_revision: 7,
      progress_patch: { venue: {} },
      progress_remove_keys: ["venue"],
    }],
    ["an over-deep progress value", {
      expected_revision: 7,
      progress_patch: {
        a: { b: { c: { d: { e: { f: { g: { h: { i: true } } } } } } } },
      },
    }],
  ])("rejects %s before the service RPC", async (_label, body) => {
    const response = await PATCH(request(body));

    expect(response.status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON before the service RPC", async () => {
    const response = await PATCH(new Request("http://localhost/api/journey", {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        "sec-fetch-site": "same-origin",
      },
      body: "{",
    }));

    expect(response.status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("maps known conflicts and hides unexpected service details", async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: null,
      error: { code: "P0001", message: "COUPLE_PLAN_CHANGE_STALE" },
    });
    const conflict = await PATCH(request());
    expect(conflict.status).toBe(409);

    mocks.rpc.mockResolvedValueOnce({
      data: null,
      error: { code: "XX000", message: "secret database detail" },
    });
    const unavailable = await PATCH(request());
    const body = await unavailable.json();
    expect(unavailable.status).toBe(503);
    expect(JSON.stringify(body)).not.toContain("secret database detail");
  });

  it("explains that an existing joint decision must finish before another", async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: null,
      error: {
        code: "P0001",
        message: "COUPLE_PLAN_CHANGE_ACTIVE_REQUEST",
      },
    });

    const response = await PATCH(request());

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: "PLAN_CHANGE_ACTIVE_REQUEST",
      error: expect.stringContaining("대기 중인 공동 확인 요청"),
    });
  });

  it("asks the couple to split an unreadable multi-change approval", async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: null,
      error: {
        code: "22023",
        message: "COUPLE_PLAN_CHANGE_INVALID_SUMMARY_TOO_LONG",
      },
    });

    const response = await PATCH(request());

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: "PLAN_CHANGE_TOO_MANY_CHANGES",
      error: expect.stringContaining("나누어 요청"),
    });
  });

  it("asks the couple to separate a high-impact decision from hidden routine progress", async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: null,
      error: {
        code: "22023",
        message: "COUPLE_PLAN_CHANGE_UNSUPPORTED_MIXED_DELTA",
      },
    });

    const response = await PATCH(request({
      expected_revision: 7,
      total_budget: 40_000_000,
      progress_patch: {
        venue: { status: "in_progress" },
      },
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: "PLAN_CHANGE_MIXED_DELTA_UNSUPPORTED",
      error: expect.stringContaining("나누어"),
    });
  });

  it("asks the couple to separate an unsupported bundled schedule delta", async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: null,
      error: {
        code: "22023",
        message: "COUPLE_PLAN_CHANGE_UNSUPPORTED_EVENT_DELTA",
      },
    });

    const response = await PATCH(request({
      expected_revision: 7,
      wedding_date: "2027-05-01",
      progress_patch: {
        __events: [
          { date: "2027-03-01", title: "가족 일정 1" },
          { date: "2027-03-02", title: "가족 일정 2" },
        ],
      },
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: "PLAN_CHANGE_EVENT_DELTA_UNSUPPORTED",
      error: expect.stringContaining("나누어"),
    });
  });

  it("fails closed on a malformed or cross-couple RPC result", async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: {
        requestId: REQUEST_ID,
        status: "applied",
        requiredCount: 1,
        acceptedCount: 1,
        journey: { ...journey(), couple_id: "55555555-5555-4555-8555-555555555555" },
      },
      error: null,
    });

    const response = await PATCH(request());

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it.each([
    [
      "an applied result without every required acceptance",
      {
        requestId: REQUEST_ID,
        status: "applied",
        requiredCount: 2,
        acceptedCount: 1,
        journey: journey(),
      },
    ],
    [
      "an applied result that did not advance the requested revision",
      {
        requestId: REQUEST_ID,
        status: "applied",
        requiredCount: 1,
        acceptedCount: 1,
        journey: journey(7),
      },
    ],
    [
      "an impossible solo pending result",
      {
        requestId: REQUEST_ID,
        status: "pending_partner",
        requiredCount: 1,
        acceptedCount: 1,
      },
    ],
    [
      "a pending result that leaks a journey snapshot",
      {
        requestId: REQUEST_ID,
        status: "pending_partner",
        requiredCount: 2,
        acceptedCount: 1,
        journey: journey(),
      },
    ],
  ])("fails closed on %s", async (_label, serviceResult) => {
    mocks.rpc.mockResolvedValueOnce({ data: serviceResult, error: null });

    const response = await PATCH(request());

    expect(response.status).toBe(503);
  });

  it("contains no direct journey update or legacy progress RPC path", async () => {
    const source = await readFile(new URL("../route.ts", import.meta.url), "utf8");

    expect(source).not.toMatch(/\.update\s*\(/);
    expect(source).not.toContain("apply_journey_progress_patch");
  });
});
