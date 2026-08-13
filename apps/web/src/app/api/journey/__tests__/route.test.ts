// @vitest-environment node

import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClientFromRequest } from "@/lib/supabase/server";
import { checkRateLimitPersistent } from "@/utils/rateLimit";
import { CATEGORY_CHECKLISTS } from "@hanbang/shared/constants";
import {
  mergePlanningChecklist,
  type PlanningChecklistItem,
} from "@hanbang/shared/utils";
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
  couple: {
    bride_id: "11111111-1111-4111-8111-111111111111",
    groom_id: "55555555-5555-4555-8555-555555555555",
  } as { bride_id: string | null; groom_id: string | null } | null,
  coupleError: null as unknown,
  currentJourney: {
    progress: {},
    state_revision: 7,
  } as {
    wedding_date?: string | null;
    venue?: string | null;
    total_budget?: number | null;
    progress: Record<string, unknown>;
    state_revision: number;
  } | null,
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

const CHECKLIST_PROFILE_ANSWERS = {
  ceremony: "no",
  legalMarriage: "undecided",
  travel: "undecided",
  housing: "undecided",
  internationalMarriage: null,
  religiousCeremony: null,
  remarriage: null,
  childrenParticipating: null,
  accessibilitySupport: null,
  healthSupport: null,
  petParticipation: null,
  familyTradition: null,
};

function checklistProfile(
  reviewedAt: string,
  overrides: {
    answers?: Record<string, unknown>;
    autoExcludedItemIds?: string[];
  } = {},
) {
  return {
    version: 1,
    reviewedAt,
    answers: {
      ...CHECKLIST_PROFILE_ANSWERS,
      ...(overrides.answers ?? {}),
    },
    autoExcludedItemIds: overrides.autoExcludedItemIds ?? ["ceremony_01", "ceremony_02"],
  };
}

function checklistProfileV2(
  reviewedAt: string,
  overrides: {
    answers?: Record<string, unknown>;
    autoExcludedItemIds?: string[];
  } = {},
) {
  return {
    version: 2,
    reviewedAt,
    answers: {
      ...CHECKLIST_PROFILE_ANSWERS,
      gathering: "undecided",
      ...(overrides.answers ?? {}),
    },
    autoExcludedItemIds: overrides.autoExcludedItemIds ?? ["ceremony_01", "ceremony_02"],
  };
}

const CHECKLIST_COPY_COMPAT_FIXTURES = [
  {
    categoryKey: "venue",
    historicalCategoryLabel: "결혼식장",
    currentCategoryLabel: "예식·모임 장소",
    items: [
      ["venue_01", "원하는 결혼식장 형태 정하기", "원하는 장소 형태 정하기"],
      ["venue_04", "하객 식사 메뉴와 1인당 금액 확인", "참석자 식사 메뉴와 1인당 금액 확인"],
      ["venue_05", "결혼식 시간대 정하기", "예식·모임 시간대 정하기"],
      ["venue_08", "대기실·주차장·사진 촬영 공간 확인", "대기·주차·사진 촬영 공간 확인"],
    ],
  },
  {
    categoryKey: "gift",
    historicalCategoryLabel: "결혼식에 온 분께 드릴 선물",
    currentCategoryLabel: "참석자에게 드릴 선물",
    items: [[
      "gift_07",
      "결혼식장에 도착할 날짜와 장소 확인",
      "예식·모임 장소에 도착할 날짜와 위치 확인",
    ]],
  },
  {
    categoryKey: "guests",
    historicalCategoryLabel: "하객·참석 답변·이동",
    currentCategoryLabel: "초대·참석 답변·이동",
    items: [[
      "guests_09",
      "정보 수정·예식 변경·긴급 연락을 전달할 방법 준비",
      "정보 수정·예식·모임 변경·긴급 연락을 전달할 방법 준비",
    ]],
  },
] as const;

function checklistCopyCompatProgress(
  copy: "historical" | "current",
  itemStates: Readonly<Record<string, string>> = {},
  itemPatches: Readonly<Record<string, Record<string, unknown>>> = {},
) {
  const progress: Record<string, Record<string, unknown>> = {};
  for (const fixture of CHECKLIST_COPY_COMPAT_FIXTURES) {
    const template = CATEGORY_CHECKLISTS.find(
      (category) => category.key === fixture.categoryKey,
    );
    if (!template) throw new Error(`missing checklist template: ${fixture.categoryKey}`);
    const itemAliases = new Map<string, { historical: string; current: string }>(
      fixture.items.map(([id, historical, current]) => [
        id,
        { historical, current },
      ]),
    );
    progress[fixture.categoryKey] = {
      category: fixture.categoryKey,
      label: copy === "historical"
        ? fixture.historicalCategoryLabel
        : fixture.currentCategoryLabel,
      status: "not_started",
      checklist: template.items.map((item) => {
        const alias = itemAliases.get(item.id);
        const state = itemStates[item.id] ?? "todo";
        return {
          ...item,
          label: alias ? alias[copy] : item.label,
          done: state === "completed",
          state,
          ...(itemPatches[item.id] ?? {}),
        };
      }),
    };
  }
  return progress;
}

function request(
  body: unknown = {
    expected_revision: 7,
    total_budget: 40_000_000,
  },
  headers: Record<string, string> = {},
) {
  return new Request("http://localhost/api/journey", {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      "sec-fetch-site": "same-origin",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

describe("/api/journey PATCH couple plan-change contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.user = { id: USER_ID };
    mocks.profile = { couple_id: COUPLE_ID };
    mocks.profileError = null;
    mocks.couple = {
      bride_id: USER_ID,
      groom_id: "55555555-5555-4555-8555-555555555555",
    };
    mocks.coupleError = null;
    mocks.currentJourney = { progress: {}, state_revision: 7 };
    mocks.currentJourneyError = null;
    mocks.authFrom.mockImplementation((table: string) => {
      if (table === "profiles") {
        return queryResult(mocks.profile, mocks.profileError);
      }
      if (table === "wedding_journeys") {
        return queryResult(mocks.currentJourney, mocks.currentJourneyError);
      }
      if (table === "couples") {
        return queryResult(mocks.couple, mocks.coupleError);
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
          status: "not_started",
        },
      },
      progress_remove_keys: ["custom_old"],
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
              status: "not_started",
            },
          },
          progress_remove_keys: ["custom_old"],
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

  it.each(["in_progress", "completed"])(
    "rejects a new status-only %s checklist row",
    async (status) => {
      const response = await PATCH(request({
        expected_revision: 7,
        progress_patch: {
          venue: { category: "venue", status },
        },
      }));

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        code: "CHECKLIST_ITEMS_REQUIRED",
      });
      expect(mocks.rpc).not.toHaveBeenCalled();
    },
  );

  it("allows an unchanged legacy status-only completion to round-trip", async () => {
    mocks.currentJourney = {
      progress: {
        venue: { category: "venue", status: "completed", budget: 10_000_000 },
      },
      state_revision: 7,
    };

    const response = await PATCH(request({
      expected_revision: 7,
      progress_patch: {
        venue: { category: "venue", status: "completed", budget: 11_000_000 },
      },
    }));

    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledOnce();
  });

  it("does not let a category patch omit existing budget or legacy metadata", async () => {
    mocks.currentJourney = {
      progress: {
        venue: {
          category: "venue",
          status: "completed",
          budget: 10_000_000,
          spent: 3_000_000,
          vendor: "legacy vendor",
        },
      },
      state_revision: 7,
    };

    const response = await PATCH(request({
      expected_revision: 7,
      progress_patch: {
        venue: { category: "venue", status: "completed" },
      },
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: "CHECKLIST_FIELDS_INVALID",
    });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("preserves a known retired item shape during a lossless budget round-trip", async () => {
    mocks.currentJourney = {
      progress: {
        venue: {
          category: "venue",
          status: "not_started",
          budget: 10_000_000,
          checklist: [{ id: "venue_01", completed: false }],
        },
      },
      state_revision: 7,
    };

    const response = await PATCH(request({
      expected_revision: 7,
      progress_patch: {
        venue: {
          category: "venue",
          status: "not_started",
          budget: 11_000_000,
          checklist: [{ id: "venue_01", completed: false }],
        },
      },
    }));

    expect(response.status).toBe(200);
    const rpcArgs = mocks.rpc.mock.calls[0]?.[1] as {
      p_changes: { progress_patch: { venue: { checklist: Array<Record<string, unknown>> } } };
    };
    expect(rpcArgs.p_changes.progress_patch.venue.checklist[0]).toEqual({
      id: "venue_01",
      completed: false,
    });
  });

  it("does not invent a completion actor while canonicalizing a retired completed item", async () => {
    mocks.currentJourney = {
      progress: {
        venue: {
          category: "venue",
          status: "completed",
          budget: 10_000_000,
          checklist: [{ id: "venue_01", completed: true }],
        },
      },
      state_revision: 7,
    };

    const response = await PATCH(request({
      expected_revision: 7,
      progress_patch: {
        venue: {
          category: "venue",
          status: "completed",
          budget: 11_000_000,
          checklist: [{ id: "venue_01", completed: true }],
        },
      },
    }));

    expect(response.status).toBe(200);
    const rpcArgs = mocks.rpc.mock.calls[0]?.[1] as {
      p_changes: { progress_patch: { venue: { checklist: Array<Record<string, unknown>> } } };
    };
    expect(rpcArgs.p_changes.progress_patch.venue.checklist[0]).toEqual({
      id: "venue_01",
      completed: true,
    });
    expect(rpcArgs.p_changes.progress_patch.venue.checklist[0])
      .not.toHaveProperty("completedAt");
    expect(rpcArgs.p_changes.progress_patch.venue.checklist[0])
      .not.toHaveProperty("completedByProfileId");
  });

  it("rejects changing a legacy status-only completion without materializing items", async () => {
    mocks.currentJourney = {
      progress: { venue: { category: "venue", status: "completed" } },
      state_revision: 7,
    };

    const response = await PATCH(request({
      expected_revision: 7,
      progress_patch: {
        venue: { category: "venue", status: "in_progress" },
      },
    }));

    expect(response.status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("does not let a status-only patch erase a materialized checklist", async () => {
    mocks.currentJourney = {
      progress: {
        venue: {
          category: "venue",
          status: "not_started",
          checklist: [{ id: "venue_01", label: "방문", done: false, state: "todo" }],
        },
      },
      state_revision: 7,
    };

    const response = await PATCH(request({
      expected_revision: 7,
      progress_patch: {
        venue: { category: "venue", status: "not_started", budget: 10_000_000 },
      },
    }));

    expect(response.status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("rejects deleting saved item identities or introducing an unknown item id", async () => {
    mocks.currentJourney = {
      progress: {
        venue: {
          category: "venue",
          status: "in_progress",
          checklist: [
            { id: "venue_01", label: "방문", done: true, state: "completed" },
            { id: "venue_02", label: "견적", done: false, state: "todo" },
          ],
        },
      },
      state_revision: 7,
    };
    const missing = await PATCH(request({
      expected_revision: 7,
      progress_patch: {
        venue: {
          category: "venue",
          status: "completed",
          checklist: [{ id: "venue_01", label: "방문", done: true, state: "completed" }],
        },
      },
    }));
    expect(missing.status).toBe(400);

    const unknown = await PATCH(request({
      expected_revision: 7,
      progress_patch: {
        venue: {
          category: "venue",
          status: "in_progress",
          checklist: [
            { id: "venue_01", label: "방문", done: true, state: "completed" },
            { id: "venue_02", label: "견적", done: false, state: "todo" },
            { id: "hostile-new", label: "임의 항목", done: false, state: "todo" },
          ],
        },
      },
    }));
    expect(unknown.status).toBe(400);

    const reordered = await PATCH(request({
      expected_revision: 7,
      progress_patch: {
        venue: {
          category: "venue",
          status: "in_progress",
          checklist: [
            { id: "venue_02", label: "견적", done: false, state: "todo" },
            { id: "venue_01", label: "방문", done: true, state: "completed" },
          ],
        },
      },
    }));
    expect(reordered.status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("rejects a lossy rich-item round trip that omits saved metadata", async () => {
    mocks.currentJourney = {
      progress: {
        venue: {
          category: "venue",
          status: "in_progress",
          checklist: [{
            id: "venue_01",
            label: "방문",
            done: false,
            state: "waiting",
            assignee: null,
            dueDate: "2026-09-01",
            note: "계약서 회신 대기",
            completedAt: null,
            completedByProfileId: null,
          }],
        },
      },
      state_revision: 7,
    };

    const response = await PATCH(request({
      expected_revision: 7,
      progress_patch: {
        venue: {
          category: "venue",
          status: "not_started",
          checklist: [{ id: "venue_01", label: "방문", done: false }],
        },
      },
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: "CHECKLIST_ITEM_FIELDS_REQUIRED",
    });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("allows canonical template expansion without dropping a saved legacy item", async () => {
    mocks.currentJourney = {
      progress: {
        venue: {
          category: "venue",
          status: "not_started",
          checklist: [{ id: "custom-legacy-1", label: "우리 확인", done: false, state: "todo" }],
        },
      },
      state_revision: 7,
    };
    const response = await PATCH(request({
      expected_revision: 7,
      progress_patch: {
        venue: {
          category: "venue",
          status: "not_started",
          checklist: [
            { id: "venue_01", label: "클라이언트 옛 라벨", done: false, state: "todo" },
            { id: "custom-legacy-1", label: "우리 확인", done: false, state: "todo" },
          ],
        },
      },
    }));
    expect(response.status).toBe(200);
    const rpcArgs = mocks.rpc.mock.calls[0]?.[1] as {
      p_changes: { progress_patch: { venue: { checklist: Array<Record<string, unknown>> } } };
    };
    expect(rpcArgs.p_changes.progress_patch.venue.checklist.map((item) => item.id))
      .toEqual(["venue_01", "custom-legacy-1"]);
    expect(rpcArgs.p_changes.progress_patch.venue.checklist[0]?.label)
      .not.toBe("클라이언트 옛 라벨");
  });

  it("shows current canonical copy after merging historical saved labels", () => {
    const historicalProgress = checklistCopyCompatProgress("historical");
    for (const fixture of CHECKLIST_COPY_COMPAT_FIXTURES) {
      const template = CATEGORY_CHECKLISTS.find(
        (category) => category.key === fixture.categoryKey,
      );
      expect(template?.label).toBe(fixture.currentCategoryLabel);
      const saved = historicalProgress[fixture.categoryKey]
        ?.checklist as Array<Record<string, unknown>>;
      const merged = mergePlanningChecklist(
        template!.items,
        saved as unknown as readonly PlanningChecklistItem[],
      );
      for (const [itemId, , currentLabel] of fixture.items) {
        expect(merged.find((item) => item.id === itemId)?.label).toBe(currentLabel);
      }
    }
  });

  it("keeps every exact historical copy alias out of a routine item edit", async () => {
    const historicalProgress = checklistCopyCompatProgress("historical");
    mocks.currentJourney = { progress: historicalProgress, state_revision: 7 };
    const currentProgress = checklistCopyCompatProgress(
      "current",
      {},
      {
        venue_01: { note: "두 곳 비교" },
        gift_07: { note: "납품 시간 확인" },
        guests_09: { note: "연락 담당 확인" },
      },
    );

    const response = await PATCH(request({
      expected_revision: 7,
      progress_patch: currentProgress,
    }));

    expect(response.status).toBe(200);
    const rpcArgs = mocks.rpc.mock.calls[0]?.[1] as {
      p_changes: { progress_patch: Record<string, Record<string, unknown>> };
    };
    for (const fixture of CHECKLIST_COPY_COMPAT_FIXTURES) {
      const category = rpcArgs.p_changes.progress_patch[fixture.categoryKey];
      expect(category.label).toBe(fixture.historicalCategoryLabel);
      const checklist = category.checklist as Array<Record<string, unknown>>;
      for (const [itemId, historicalLabel] of fixture.items) {
        expect(checklist.find((item) => item.id === itemId)?.label)
          .toBe(historicalLabel);
      }
    }
    expect((rpcArgs.p_changes.progress_patch.venue.checklist as Array<Record<string, unknown>>)
      .find((item) => item.id === "venue_01")?.note).toBe("두 곳 비교");
  });

  it("keeps every exact historical copy alias out of a situation-profile change", async () => {
    const historicalProgress = checklistCopyCompatProgress("historical");
    mocks.currentJourney = {
      progress: {
        ...historicalProgress,
        __checklist_profile: checklistProfileV2(
          "2026-08-12T08:00:00.000Z",
          { answers: { gathering: "reception" }, autoExcludedItemIds: [] },
        ),
      },
      state_revision: 7,
    };
    const aliasItemIds = CHECKLIST_COPY_COMPAT_FIXTURES.flatMap(
      (fixture) => fixture.items.map(([itemId]) => itemId),
    );
    const excludedStates = Object.fromEntries(
      aliasItemIds.map((itemId) => [itemId, "not_applicable"]),
    );

    const response = await PATCH(request({
      expected_revision: 7,
      progress_patch: {
        ...checklistCopyCompatProgress("current", excludedStates),
        __checklist_profile: checklistProfileV2(
          "2026-08-12T09:00:00.000Z",
          {
            answers: { gathering: "none" },
            autoExcludedItemIds: aliasItemIds,
          },
        ),
      },
    }));

    expect(response.status).toBe(200);
    const rpcArgs = mocks.rpc.mock.calls[0]?.[1] as {
      p_changes: { progress_patch: Record<string, Record<string, unknown>> };
    };
    for (const fixture of CHECKLIST_COPY_COMPAT_FIXTURES) {
      const category = rpcArgs.p_changes.progress_patch[fixture.categoryKey];
      expect(category.label).toBe(fixture.historicalCategoryLabel);
      const checklist = category.checklist as Array<Record<string, unknown>>;
      for (const [itemId, historicalLabel] of fixture.items) {
        expect(checklist.find((item) => item.id === itemId)).toMatchObject({
          label: historicalLabel,
          state: "not_applicable",
        });
      }
    }
    expect(rpcArgs.p_changes.progress_patch.__checklist_profile).toMatchObject({
      version: 2,
      answers: { gathering: "none" },
    });
  });

  it("does not suppress arbitrary saved labels as copy aliases", async () => {
    const historicalProgress = checklistCopyCompatProgress("historical");
    const savedVenue = historicalProgress.venue;
    const savedChecklist = savedVenue.checklist as Array<Record<string, unknown>>;
    historicalProgress.venue = {
      ...savedVenue,
      label: "우리만의 장소 이름",
      checklist: savedChecklist.map((item) => item.id === "venue_01"
        ? { ...item, label: "우리만의 항목 이름" }
        : item),
    };
    mocks.currentJourney = { progress: historicalProgress, state_revision: 7 };
    mocks.rpc.mockResolvedValueOnce({
      data: null,
      error: {
        code: "22023",
        message: "COUPLE_PLAN_CHANGE_UNSUPPORTED_MIXED_DELTA",
      },
    });

    const response = await PATCH(request({
      expected_revision: 7,
      progress_patch: checklistCopyCompatProgress(
        "current",
        {},
        { venue_01: { note: "두 곳 비교" } },
      ),
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: "PLAN_CHANGE_MIXED_DELTA_UNSUPPORTED",
    });
    const rpcArgs = mocks.rpc.mock.calls[0]?.[1] as {
      p_changes: { progress_patch: { venue: {
        label: string;
        checklist: Array<Record<string, unknown>>;
      } } };
    };
    expect(rpcArgs.p_changes.progress_patch.venue.label).toBe("예식·모임 장소");
    expect(rpcArgs.p_changes.progress_patch.venue.checklist
      .find((item) => item.id === "venue_01")?.label)
      .toBe("원하는 장소 형태 정하기");
    expect(JSON.stringify(rpcArgs.p_changes)).not.toContain("우리만의");
  });

  it("allows a new status-only category exclusion when there is no item history", async () => {
    const response = await PATCH(request({
      expected_revision: 7,
      progress_patch: {
        ceremony: { category: "ceremony", status: "not_applicable" },
      },
    }));

    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledOnce();
  });

  it("does not let a whole-progress replacement omit a materialized checklist", async () => {
    mocks.currentJourney = {
      progress: {
        venue: {
          category: "venue",
          status: "not_started",
          checklist: [{ id: "venue_01", label: "방문", done: false, state: "todo" }],
        },
      },
      state_revision: 7,
    };

    const response = await PATCH(request({
      expected_revision: 7,
      progress: {
        studio: { category: "studio", status: "not_started" },
      },
    }));

    expect(response.status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("does not let a whole-progress replacement omit a legacy checklist category", async () => {
    mocks.currentJourney = {
      progress: {
        studio: { category: "studio", status: "completed" },
      },
      state_revision: 7,
    };

    const response = await PATCH(request({
      expected_revision: 7,
      progress: {
        venue: { category: "venue", status: "not_started" },
      },
    }));

    expect(response.status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("rejects deleting a saved checklist category or situation profile", async () => {
    mocks.currentJourney = {
      progress: {
        venue: {
          category: "venue",
          status: "not_started",
          checklist: [{ id: "venue_01", label: "방문", done: false, state: "todo" }],
        },
        __checklist_profile: {
          version: 1,
          reviewedAt: "2026-08-12T08:00:00.000Z",
          answers: {},
          autoExcludedItemIds: [],
        },
      },
      state_revision: 7,
    };

    for (const key of ["venue", "__checklist_profile"]) {
      const response = await PATCH(request({
        expected_revision: 7,
        progress_remove_keys: [key],
      }));
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        code: "CHECKLIST_DELETE_NOT_ALLOWED",
      });
    }
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("still permits deleting an unrelated custom progress key", async () => {
    mocks.currentJourney = {
      progress: { custom_old: { label: "옛 사용자 항목" } },
      state_revision: 7,
    };
    const response = await PATCH(request({
      expected_revision: 7,
      progress_remove_keys: ["custom_old"],
    }));
    expect(response.status).toBe(200);
  });

  it("validates new full-journey checklist categories with the same strict schema", async () => {
    const response = await PATCH(
      request({
        expected_revision: 7,
        progress: {
          aftercare: {
            status: "completed",
            checklist: [
              { id: "aftercare_01", label: "대여품 반납 확인", done: false },
            ],
          },
        },
      }),
    );

    expect(response.status).toBe(400);
  });

  it("rejects budget fields on checklist-only journey categories", async () => {
    const response = await PATCH(request({
      expected_revision: 7,
      progress_patch: {
        aftercare: {
          category: "aftercare",
          status: "not_started",
          spent: 100_000,
        },
      },
    }));

    expect(response.status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("accepts a safe saved-only checklist item so older user data survives", async () => {
    mocks.currentJourney = {
      progress: {
        venue: {
          category: "venue",
          status: "in_progress",
          checklist: [
            { id: "venue_01", label: "옛 라벨", done: false },
            { id: "custom-legacy-1", label: "직접 추가했던 항목", done: false },
          ],
        },
      },
      state_revision: 7,
    };
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
    const rpcArgs = mocks.rpc.mock.calls[0]?.[1] as {
      p_changes: { progress_patch: { venue: { checklist: Array<Record<string, unknown>> } } };
    };
    expect(rpcArgs.p_changes.progress_patch.venue.checklist[0]).toMatchObject({
      completedByProfileId: USER_ID,
      completedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
    });
  });

  it("server-stamps a new completion even when a client omits or invents its audit time", async () => {
    const response = await PATCH(request({
      expected_revision: 7,
      progress_patch: {
        venue: {
          category: "venue",
          status: "completed",
          checklist: [{
            id: "venue_01",
            label: "방문",
            done: true,
            state: "completed",
            completedAt: "1970-01-01T00:00:00.000Z",
            completedByProfileId: USER_ID,
          }],
        },
      },
    }));

    expect(response.status).toBe(200);
    const rpcArgs = mocks.rpc.mock.calls[0]?.[1] as {
      p_changes: { progress_patch: { venue: { checklist: Array<Record<string, unknown>> } } };
    };
    const stored = rpcArgs.p_changes.progress_patch.venue.checklist[0];
    expect(stored.completedByProfileId).toBe(USER_ID);
    expect(stored.completedAt).not.toBe("1970-01-01T00:00:00.000Z");
    expect(Date.parse(String(stored.completedAt))).toBeGreaterThan(Date.parse("2026-01-01T00:00:00.000Z"));
  });

  it("requires a materialized checklist and the authenticated actor for a new review marker", async () => {
    const markerOnly = await PATCH(request({
      expected_revision: 7,
      progress_patch: {
        venue: {
          category: "venue",
          status: "not_started",
          checklistReviewedAt: "2026-08-12T08:00:00.000Z",
          checklistReviewedByProfileId: USER_ID,
          checklistReviewSource: "manual",
        },
      },
    }));
    expect(markerOnly.status).toBe(400);

    const partnerId = "55555555-5555-4555-8555-555555555555";
    const forged = await PATCH(request({
      expected_revision: 7,
      progress_patch: {
        venue: {
          category: "venue",
          status: "not_started",
          checklist: [{ id: "venue_01", label: "방문", done: false, state: "todo" }],
          checklistReviewedAt: "2026-08-12T08:00:00.000Z",
          checklistReviewedByProfileId: partnerId,
          checklistReviewSource: "manual",
        },
      },
    }));
    expect(forged.status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("server-stamps an actor-owned manual review marker", async () => {
    const response = await PATCH(request({
      expected_revision: 7,
      progress_patch: {
        venue: {
          category: "venue",
          status: "not_started",
          checklist: [{ id: "venue_01", label: "방문", done: false, state: "todo" }],
          checklistReviewedAt: "1970-01-01T00:00:00.000Z",
          checklistReviewedByProfileId: USER_ID,
          checklistReviewSource: "manual",
        },
      },
    }));
    expect(response.status).toBe(200);
    const rpcArgs = mocks.rpc.mock.calls[0]?.[1] as {
      p_changes: { progress_patch: { venue: Record<string, unknown> } };
    };
    expect(rpcArgs.p_changes.progress_patch.venue).toMatchObject({
      checklistReviewedByProfileId: USER_ID,
      checklistReviewSource: "manual",
    });
    expect(rpcArgs.p_changes.progress_patch.venue.checklistReviewedAt)
      .not.toBe("1970-01-01T00:00:00.000Z");
  });

  it("rejects a new unsupported field but preserves an unchanged legacy field", async () => {
    const invalid = await PATCH(request({
      expected_revision: 7,
      progress_patch: {
        venue: { category: "venue", status: "not_started", arbitrary_nested: { secret: true } },
      },
    }));
    expect(invalid.status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();

    mocks.currentJourney = {
      progress: {
        venue: { category: "venue", status: "not_started", arbitrary_nested: { legacy: true } },
      },
      state_revision: 7,
    };
    const legacy = await PATCH(request({
      expected_revision: 7,
      progress_patch: {
        venue: {
          category: "venue",
          status: "not_started",
          budget: 10_000_000,
          arbitrary_nested: { legacy: true },
        },
      },
    }));
    expect(legacy.status).toBe(200);
  });

  it("rejects malformed values hidden in allowlisted legacy category fields", async () => {
    for (const invalidFields of [
      { cost: { nested: true } },
      { vendor: { nested: true } },
      { notes: ["hidden"] },
      { assigned_to: { id: USER_ID } },
      { responsibility: 42 },
      { dueDate: "2026-02-30" },
      { due_date: "not-a-date" },
    ]) {
      const response = await PATCH(request({
        expected_revision: 7,
        progress_patch: {
          venue: { category: "venue", status: "not_started", ...invalidFields },
        },
      }));
      expect(response.status).toBe(400);
    }
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("preserves but never introduces an opaque legacy category cost", async () => {
    mocks.currentJourney = {
      progress: {
        venue: { category: "venue", status: "not_started", cost: { legacy: true } },
      },
      state_revision: 7,
    };
    const response = await PATCH(request({
      expected_revision: 7,
      progress_patch: {
        venue: {
          category: "venue",
          status: "not_started",
          budget: 10_000_000,
          cost: { legacy: true },
        },
      },
    }));
    expect(response.status).toBe(200);
  });

  it("accepts item execution state, stable assignee, due date, note and completion audit", async () => {
    const response = await PATCH(request({
      expected_revision: 7,
      progress_patch: {
        venue: {
          category: "venue",
          status: "in_progress",
          checklist: [
            {
              id: "venue_01",
              label: "방문",
              done: true,
              state: "completed",
              assignee: { kind: "member", profileId: USER_ID },
              dueDate: "2026-08-12",
              note: "계약서와 사진을 함께 보관",
              completedAt: "2026-08-12T07:30:00.000Z",
              completedByProfileId: USER_ID,
            },
            {
              id: "venue_02",
              label: "답변 대기",
              done: false,
              state: "waiting",
              assignee: { kind: "couple" },
              dueDate: null,
            },
          ],
        },
      },
    }));

    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledOnce();
  });

  it("accepts one minimal reviewed checklist profile with its auto-excluded item ids", async () => {
    const response = await PATCH(request({
      expected_revision: 7,
      progress_patch: {
        venue: {
          category: "venue",
          status: "not_started",
          budget: 10_000_000,
        },
        __checklist_profile: {
          version: 1,
          reviewedAt: "2026-08-12T08:00:00.000Z",
          answers: {
            ceremony: "yes",
            legalMarriage: "undecided",
            travel: "international",
            housing: "rent",
            internationalMarriage: null,
            religiousCeremony: false,
            remarriage: null,
            childrenParticipating: false,
            accessibilitySupport: null,
            healthSupport: null,
            petParticipation: false,
            familyTradition: false,
          },
          autoExcludedItemIds: ["special_cases_03", "special_cases_10"],
        },
      },
    }));

    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledOnce();
    expect(mocks.rpc.mock.calls[0]?.[1]).toMatchObject({ p_surface: "/schedule" });
  });

  it("accepts an exact version 2 checklist profile with the gathering answer", async () => {
    const response = await PATCH(request({
      expected_revision: 7,
      progress_patch: {
        __checklist_profile: checklistProfileV2(
          "2026-08-12T08:00:00.000Z",
          { autoExcludedItemIds: [] },
        ),
      },
    }));

    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledOnce();
  });

  it("accepts a profile-only v2 change when the gathering answer actually changed", async () => {
    mocks.currentJourney = {
      progress: {
        __checklist_profile: checklistProfileV2(
          "2026-08-12T08:00:00.000Z",
          { answers: { gathering: "none" }, autoExcludedItemIds: [] },
        ),
      },
      state_revision: 7,
    };

    const response = await PATCH(request({
      expected_revision: 7,
      progress_patch: {
        __checklist_profile: checklistProfileV2(
          "2026-08-12T09:00:00.000Z",
          { answers: { gathering: "reception" }, autoExcludedItemIds: [] },
        ),
      },
    }));

    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledOnce();
  });

  it("treats a v1 profile and v2 gathering=undecided as the same situation", async () => {
    mocks.currentJourney = {
      progress: {
        __checklist_profile: checklistProfile("2026-08-12T08:00:00.000Z"),
      },
      state_revision: 7,
    };

    const response = await PATCH(request({
      expected_revision: 7,
      progress_patch: {
        __checklist_profile: checklistProfileV2(
          "2026-08-12T09:00:00.000Z",
          { autoExcludedItemIds: ["ceremony_02", "ceremony_01"] },
        ),
      },
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: "CHECKLIST_PROFILE_NO_CHANGES",
    });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("rejects a v1 profile write when the stored situation profile is already v2", async () => {
    mocks.currentJourney = {
      progress: {
        __checklist_profile: checklistProfileV2("2026-08-12T08:00:00.000Z"),
      },
      state_revision: 7,
    };

    const response = await PATCH(request({
      expected_revision: 7,
      progress_patch: {
        __checklist_profile: checklistProfile("2026-08-12T09:00:00.000Z"),
      },
    }));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: "CHECKLIST_PROFILE_UPGRADE_REQUIRED",
    });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("allows a routine checklist item patch to omit the already-stored v2 profile", async () => {
    mocks.currentJourney = {
      progress: {
        __checklist_profile: checklistProfileV2(
          "2026-08-12T08:00:00.000Z",
          { autoExcludedItemIds: [] },
        ),
      },
      state_revision: 7,
    };

    const response = await PATCH(request({
      expected_revision: 7,
      progress_patch: {
        venue: {
          category: "venue",
          status: "not_started",
          checklist: [{
            id: "venue_01",
            label: "방문",
            done: false,
            state: "todo",
          }],
        },
      },
    }));

    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledOnce();
  });

  it.each([
    ["v1 with a v2-only gathering answer", {
      ...checklistProfile("2026-08-12T08:00:00.000Z"),
      answers: {
        ...checklistProfile("2026-08-12T08:00:00.000Z").answers,
        gathering: "undecided",
      },
    }],
    ["v2 without gathering", {
      ...checklistProfile("2026-08-12T08:00:00.000Z"),
      version: 2,
    }],
    ["v2 with an unknown gathering value", checklistProfileV2(
      "2026-08-12T08:00:00.000Z",
      { answers: { gathering: "after_party" } },
    )],
  ])("rejects a non-exact versioned checklist profile: %s", async (_label, profile) => {
    const response = await PATCH(request({
      expected_revision: 7,
      progress_patch: { __checklist_profile: profile },
    }));

    expect(response.status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("rejects a profile-only patch when only reviewedAt and set ordering changed", async () => {
    mocks.currentJourney = {
      wedding_date: "2027-05-01",
      venue: "현재 예식장",
      total_budget: 40_000_000,
      progress: {
        __checklist_profile: checklistProfile(
          "2026-08-12T08:00:00.000Z",
          { autoExcludedItemIds: ["ceremony_01", "ceremony_02"] },
        ),
      },
      state_revision: 7,
    };

    const response = await PATCH(request({
      expected_revision: 7,
      wedding_date: "2027-05-01",
      venue: "현재 예식장",
      total_budget: 40_000_000,
      progress_patch: {
        __checklist_profile: checklistProfile(
          "2026-08-12T09:00:00.000Z",
          { autoExcludedItemIds: ["ceremony_02", "ceremony_01"] },
        ),
      },
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: "CHECKLIST_PROFILE_NO_CHANGES",
    });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("rejects a legacy whole-progress profile replay with no effective delta", async () => {
    const storedProfile = checklistProfile("2026-08-12T08:00:00.000Z");
    const venue = {
      category: "venue",
      status: "not_started",
      budget: 10_000_000,
    };
    mocks.currentJourney = {
      progress: {
        __checklist_profile: storedProfile,
        venue,
      },
      state_revision: 7,
    };

    const response = await PATCH(request({
      expected_revision: 7,
      progress: {
        __checklist_profile: checklistProfile("2026-08-12T09:00:00.000Z"),
        venue,
      },
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: "CHECKLIST_PROFILE_NO_CHANGES",
    });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("allows the same profile receipt when a category or top-level value actually changes", async () => {
    mocks.currentJourney = {
      total_budget: 40_000_000,
      progress: {
        __checklist_profile: checklistProfile("2026-08-12T08:00:00.000Z"),
        venue: {
          category: "venue",
          status: "not_started",
          budget: 10_000_000,
        },
      },
      state_revision: 7,
    };

    const response = await PATCH(request({
      expected_revision: 7,
      total_budget: 41_000_000,
      progress_patch: {
        __checklist_profile: checklistProfile("2026-08-12T09:00:00.000Z"),
        venue: {
          category: "venue",
          status: "not_started",
          budget: 11_000_000,
        },
      },
    }));

    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledOnce();
    const rpcInput = mocks.rpc.mock.calls[0]?.[1] as {
      p_changes: { progress_patch?: Record<string, unknown> } & Record<string, unknown>;
      p_surface: string;
    };
    expect(rpcInput.p_surface).toBe("/budget");
    expect(rpcInput.p_changes).toMatchObject({
      total_budget: 41_000_000,
      progress_patch: {
        venue: { budget: 11_000_000 },
      },
    });
    expect(rpcInput.p_changes.progress_patch).not.toHaveProperty("__checklist_profile");
  });

  it("allows a profile-only request when an answer actually changed", async () => {
    mocks.currentJourney = {
      progress: {
        __checklist_profile: checklistProfile("2026-08-12T08:00:00.000Z"),
      },
      state_revision: 7,
    };

    const response = await PATCH(request({
      expected_revision: 7,
      progress_patch: {
        __checklist_profile: checklistProfile(
          "2026-08-12T09:00:00.000Z",
          { answers: { ceremony: "yes" }, autoExcludedItemIds: [] },
        ),
      },
    }));

    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledOnce();
  });

  it.each([
    ["unknown profile version", { version: 3 }],
    ["invalid review timestamp", { reviewedAt: "today" }],
    ["unknown answer", { answers: { petParticipation: "maybe" } }],
    ["unknown item id", { autoExcludedItemIds: ["not_real_01"] }],
    ["duplicate auto exclusions", { autoExcludedItemIds: ["venue_01", "venue_01"] }],
  ])("rejects invalid checklist profile metadata: %s", async (_label, override) => {
    const valid = {
      version: 1,
      reviewedAt: "2026-08-12T08:00:00.000Z",
      answers: {
        ceremony: "yes",
        legalMarriage: "undecided",
        travel: "domestic",
        housing: "other",
        internationalMarriage: null,
        religiousCeremony: null,
        remarriage: null,
        childrenParticipating: null,
        accessibilitySupport: null,
        healthSupport: null,
        petParticipation: null,
        familyTradition: null,
      },
      autoExcludedItemIds: [],
    };
    const profile = {
      ...valid,
      ...override,
      answers: {
        ...valid.answers,
        ...((override as { answers?: Record<string, unknown> }).answers ?? {}),
      },
    };
    const response = await PATCH(request({
      expected_revision: 7,
      progress_patch: { __checklist_profile: profile },
    }));

    expect(response.status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it.each([
    ["unknown item state", { done: false, state: "paused" }],
    ["done-state mismatch", { done: true, state: "waiting" }],
    ["invalid due date", { done: false, state: "todo", dueDate: "2026-02-30" }],
    ["invalid member assignee", { done: false, state: "todo", assignee: { kind: "member", profileId: "me" } }],
    ["empty external assignee", { done: false, state: "todo", assignee: { kind: "external", label: " " } }],
    ["completion audit on open work", {
      done: false,
      state: "todo",
      completedAt: "2026-08-12T07:30:00.000Z",
      completedByProfileId: USER_ID,
    }],
  ])("rejects invalid item execution metadata: %s", async (_label, fields) => {
    const response = await PATCH(request({
      expected_revision: 7,
      progress_patch: {
        venue: {
          category: "venue",
          status: fields.state === "waiting" ? "in_progress" : "not_started",
          checklist: [{ id: "venue_01", label: "방문", ...fields }],
        },
      },
    }));

    expect(response.status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("accepts a stable assignee that belongs to the same sealed couple", async () => {
    const partnerId = "55555555-5555-4555-8555-555555555555";
    const response = await PATCH(request({
      expected_revision: 7,
      progress_patch: {
        venue: {
          category: "venue",
          status: "not_started",
          checklist: [{
            id: "venue_01",
            label: "방문",
            done: false,
            state: "todo",
            assignee: { kind: "member", profileId: partnerId },
          }],
        },
      },
    }));

    expect(response.status).toBe(200);
    expect(mocks.authFrom).toHaveBeenCalledWith("couples");
  });

  it("rejects attributing a completion to the partner instead of the authenticated actor", async () => {
    const partnerId = "55555555-5555-4555-8555-555555555555";
    const response = await PATCH(request({
      expected_revision: 7,
      progress_patch: {
        venue: {
          category: "venue",
          status: "completed",
          checklist: [{
            id: "venue_01",
            label: "방문",
            done: true,
            state: "completed",
            completedAt: "2026-08-12T08:00:00.000Z",
            completedByProfileId: partnerId,
          }],
        },
      },
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining("본인"),
    });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("preserves an existing partner completion audit while the actor updates another item", async () => {
    const partnerId = "55555555-5555-4555-8555-555555555555";
    const partnerCompletedAt = "2026-08-11T08:00:00.000Z";
    mocks.currentJourney = {
      progress: {
        venue: {
          category: "venue",
          status: "in_progress",
          checklist: [
            {
              id: "venue_01",
              label: "방문",
              done: true,
              state: "completed",
              completedAt: partnerCompletedAt,
              completedByProfileId: partnerId,
            },
            { id: "venue_02", label: "견적", done: false, state: "todo" },
          ],
        },
      },
      state_revision: 7,
    };
    const response = await PATCH(request({
      expected_revision: 7,
      progress_patch: {
        venue: {
          category: "venue",
          status: "completed",
          checklist: [
            {
              id: "venue_01",
              label: "방문",
              done: true,
              state: "completed",
              completedAt: partnerCompletedAt,
              completedByProfileId: partnerId,
            },
            {
              id: "venue_02",
              label: "견적",
              done: true,
              state: "completed",
              completedAt: "2026-08-12T08:00:00.000Z",
              completedByProfileId: USER_ID,
            },
          ],
        },
      },
    }));

    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledOnce();
  });

  it("allows a partner-completed item to be auto-excluded through a disclosed situation proposal", async () => {
    const partnerId = "55555555-5555-4555-8555-555555555555";
    mocks.currentJourney = {
      progress: {
        venue: {
          category: "venue",
          status: "completed",
          checklist: [{
            id: "venue_01",
            label: "방문",
            done: true,
            state: "completed",
            completedAt: "2026-08-11T08:00:00.000Z",
            completedByProfileId: partnerId,
          }],
        },
      },
      state_revision: 7,
    };

    const response = await PATCH(request({
      expected_revision: 7,
      progress_patch: {
        __checklist_profile: checklistProfile("2026-08-12T09:00:00.000Z", {
          autoExcludedItemIds: ["venue_01"],
        }),
        venue: {
          category: "venue",
          status: "not_applicable",
          checklist: [{
            id: "venue_01",
            label: "방문",
            done: false,
            state: "not_applicable",
          }],
        },
      },
    }));

    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledOnce();
  });

  it("rejects an assignee or completion actor outside the couple", async () => {
    const response = await PATCH(request({
      expected_revision: 7,
      progress_patch: {
        venue: {
          category: "venue",
          status: "completed",
          checklist: [{
            id: "venue_01",
            label: "방문",
            done: true,
            state: "completed",
            assignee: { kind: "member", profileId: "66666666-6666-4666-8666-666666666666" },
            completedAt: "2026-08-12T08:00:00.000Z",
            completedByProfileId: "66666666-6666-4666-8666-666666666666",
          }],
        },
      },
    }));

    expect(response.status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
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
        custom_old: { status: "completed" },
        venue: { status: "not_started", label: "기존 예식장" },
      },
      state_revision: 7,
    };

    const response = await PATCH(request({
      expected_revision: 7,
      progress: {
        venue: { status: "not_started", label: "새 예식장" },
      },
    }));

    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith(
      "submit_couple_plan_change",
      expect.objectContaining({
        p_changes: {
          progress_patch: {
            venue: { status: "not_started", label: "새 예식장" },
          },
          progress_remove_keys: ["custom_old"],
        },
        p_summary: "진행 상황: 1개 수정 · 1개 삭제",
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
    expect(unlinked.status).toBe(403);
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
    expect(checkRateLimitPersistent).toHaveBeenCalledWith(
      "journey:test",
      { maxRequests: 30, windowMs: 60 * 1000 },
      { failClosed: true },
    );
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
        venue: { status: "not_started" },
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
