import { createClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createClientFromRequest } from "@/lib/supabase/server";
import { POST } from "../route";

vi.mock("@supabase/supabase-js", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClientFromRequest: vi.fn() }));
vi.mock("@/utils/rateLimit", () => ({
  checkRateLimitPersistent: vi.fn(async () => null),
  rateLimitKey: vi.fn(() => "onboarding:user-1"),
}));

type QueryResult = { data?: unknown; error?: { code?: string; message?: string } | null };
type Handler = {
  maybeSingle?: QueryResult;
  single?: QueryResult;
  awaited?: QueryResult;
  onInsert?: (value: unknown) => void;
  onUpdate?: (value: unknown) => void;
  onFilter?: (column: string, operator: string, value: unknown) => void;
  onIs?: (column: string, value: unknown) => void;
};

class FakeQuery implements PromiseLike<QueryResult> {
  private operation: "read" | "insert" | "update" = "read";

  constructor(private readonly handler: Handler) {}

  select() {
    return this;
  }

  eq() {
    return this;
  }

  is(column: string, value: unknown) {
    this.handler.onIs?.(column, value);
    return this;
  }

  filter(column: string, operator: string, value: unknown) {
    this.handler.onFilter?.(column, operator, value);
    return this;
  }

  insert(value: unknown) {
    this.operation = "insert";
    this.handler.onInsert?.(value);
    return this;
  }

  update(value: unknown) {
    this.operation = "update";
    this.handler.onUpdate?.(value);
    return this;
  }

  maybeSingle() {
    return Promise.resolve(this.handler.maybeSingle ?? { data: null, error: null });
  }

  single() {
    return Promise.resolve(this.handler.single ?? { data: null, error: null });
  }

  then<TResult1 = QueryResult, TResult2 = never>(
    onfulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    const result =
      this.handler.awaited ??
      (this.operation === "read" ? { data: null, error: null } : { data: null, error: null });
    return Promise.resolve(result).then(onfulfilled, onrejected);
  }
}

function onboardingRequest(body: Record<string, unknown>) {
  return new Request("http://localhost/api/onboarding", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function setupClients(
  handlers: Record<string, Handler[]>,
  membershipData: unknown,
  adminRpc: QueryResult = { data: {}, error: null },
) {
  const authClient = {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: {
          user: {
            id: "11111111-1111-4111-8111-111111111111",
            email: "user@example.com",
            user_metadata: { name: "테스트 사용자" },
          },
        },
      }),
    },
    rpc: vi.fn().mockResolvedValue({ data: membershipData, error: null }),
  };
  vi.mocked(createClientFromRequest).mockResolvedValue(authClient as never);

  const fromCalls: string[] = [];
  const admin = {
    from: vi.fn((table: string) => {
      fromCalls.push(table);
      return new FakeQuery(handlers[table]?.shift() ?? {});
    }),
    rpc: vi.fn().mockResolvedValue(adminRpc),
  };
  vi.mocked(createClient).mockReturnValue(admin as never);

  return { authClient, admin, fromCalls };
}

const coupleId = "12345678-1234-4234-9234-123456789abc";
function storedScheduleEvent(
  id: string,
  momentType: string,
  date: string,
  title = "기존 일정",
) {
  return {
    id,
    momentType,
    date,
    title,
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
  };
}

const createSuccess = {
  success: true,
  created: true,
  idempotent: false,
  couple_id: coupleId,
  invite_code: "WH-ABC123",
  role: "bride",
};

describe("/api/onboarding POST", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://abcdefghijklmnopqrst.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = `sb_secret_${"a".repeat(40)}`;
  });

  it("rejects a browser draft when the authenticated identity changed before submit", async () => {
    const { authClient, admin } = setupClients({}, createSuccess);

    const response = await POST(
      onboardingRequest({
        expectedUserId: "22222222-2222-4222-8222-222222222222",
        role: "bride",
        coupleAction: "create",
      }),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "로그인 계정이 변경되었습니다. 온보딩을 다시 확인해주세요.",
    });
    expect(authClient.rpc).not.toHaveBeenCalled();
    expect(admin.from).not.toHaveBeenCalled();
  });

  it("creates membership through the authenticated RPC and never writes couples directly", async () => {
    let profileCompletion: unknown;
    let journeyInsert: unknown;
    const { authClient, fromCalls } = setupClients(
      {
        profiles: [
          { maybeSingle: { data: { id: "user-1" }, error: null } },
          {
            onUpdate: (value) => {
              profileCompletion = value;
            },
            single: { data: { id: "user-1", couple_id: coupleId }, error: null },
          },
        ],
        wedding_journeys: [
          { maybeSingle: { data: null, error: null } },
          {
            onInsert: (value) => {
              journeyInsert = value;
            },
            single: { data: { id: "journey-1", progress: {} }, error: null },
          },
        ],
      },
      createSuccess,
    );

    const response = await POST(
      onboardingRequest({
        role: "bride",
        coupleAction: "create",
        weddingDate: "2027-05-08",
        venue: "테스트 웨딩홀",
        totalBudget: 30_000_000,
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      coupleId,
      inviteCode: "WH-ABC123",
      created: true,
      idempotent: false,
    });
    expect(authClient.rpc).toHaveBeenCalledWith("create_couple_for_current_user", {
      p_role: "bride",
    });
    expect(fromCalls).not.toContain("couples");
    expect(profileCompletion).toEqual({ onboarding_completed: true, onboarding_step: 5 });
    expect(journeyInsert).toMatchObject({
      couple_id: coupleId,
      wedding_date: "2027-05-08",
      venue: "테스트 웨딩홀",
      total_budget: 30_000_000,
    });
  });

  it("does not report success when journey persistence fails", async () => {
    setupClients(
      {
        profiles: [
          { maybeSingle: { data: { id: "user-1" }, error: null } },
          { single: { data: { id: "user-1", couple_id: coupleId }, error: null } },
        ],
        wedding_journeys: [
          { maybeSingle: { data: null, error: null } },
          {
            single: {
              data: null,
              error: { code: "XX000", message: "storage unavailable" },
            },
          },
        ],
      },
      createSuccess,
    );

    const response = await POST(
      onboardingRequest({ role: "bride", coupleAction: "create" }),
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "온보딩 저장을 완료하지 못했습니다. 잠시 후 다시 시도해주세요.",
    });
  });

  it("preserves a partner's existing sanggyeonrye event", async () => {
    const existingProgress = {
      budget: { spent: 1_000_000 },
      __events: [
        storedScheduleEvent(
          "partner-event",
          "sanggyeonrye",
          "2027-02-01",
          "파트너 상견례",
        ),
      ],
    };
    const { admin } = setupClients(
      {
        profiles: [
          { maybeSingle: { data: { id: "user-1" }, error: null } },
          { single: { data: { id: "user-1", couple_id: coupleId }, error: null } },
        ],
        wedding_journeys: [
          {
            maybeSingle: {
              data: { id: "journey-1", progress: existingProgress },
              error: null,
            },
          },
        ],
      },
      {
        success: true,
        joined: false,
        idempotent: true,
        couple_id: coupleId,
        invite_code: "WH-ABC123",
        role: "bride",
      },
    );

    const response = await POST(
      onboardingRequest({
        role: "bride",
        coupleAction: "join",
        partnerInviteCode: "wh-abc123",
        sanggyeonryeDate: "2027-03-01",
      }),
    );

    expect(response.status).toBe(200);
    expect(admin.rpc).not.toHaveBeenCalled();
  });

  it("merges a missing sanggyeonrye event with an exact-value compare-and-swap", async () => {
    const existingProgress = {
      budget: { spent: 1_000_000 },
      __events: [storedScheduleEvent("other-event", "venue", "2027-01-10")],
    };
    let updatePayload: unknown;
    let filterCall: unknown;
    const { admin } = setupClients(
      {
        profiles: [
          { maybeSingle: { data: { id: "user-1" }, error: null } },
          { single: { data: { id: "user-1", couple_id: coupleId }, error: null } },
        ],
        wedding_journeys: [
          {
            maybeSingle: {
              data: { id: "journey-1", progress: existingProgress },
              error: null,
            },
          },
          {
            onUpdate: (value) => {
              updatePayload = value;
            },
            onFilter: (column, operator, value) => {
              filterCall = { column, operator, value };
            },
            maybeSingle: {
              data: {
                progress: {
                  ...existingProgress,
                  __events: [
                    ...existingProgress.__events,
                    storedScheduleEvent("new-event", "sanggyeonrye", "2027-03-01"),
                  ],
                },
              },
              error: null,
            },
          },
        ],
      },
      {
        success: true,
        joined: true,
        idempotent: false,
        couple_id: coupleId,
        invite_code: "WH-ABC123",
        role: "bride",
      },
    );

    const response = await POST(
      onboardingRequest({
        role: "bride",
        coupleAction: "join",
        partnerInviteCode: "WH-ABC123",
        sanggyeonryeDate: "2027-03-01",
      }),
    );

    expect(response.status).toBe(200);
    expect(updatePayload).toMatchObject({
      progress: {
        budget: { spent: 1_000_000 },
        __events: expect.arrayContaining([
          expect.objectContaining({ id: "other-event" }),
          expect.objectContaining({ momentType: "sanggyeonrye", date: "2027-03-01" }),
        ]),
      },
    });
    expect(filterCall).toEqual({
      column: "progress",
      operator: "eq",
      value: JSON.stringify(existingProgress),
    });
    expect(admin.rpc).not.toHaveBeenCalled();
  });

  it("re-reads after a lost CAS and preserves the partner's concurrent event", async () => {
    const initialProgress = {
      __events: [storedScheduleEvent("initial-event", "venue", "2027-01-10")],
    };
    const partnerProgress = {
      __events: [
        ...initialProgress.__events,
        storedScheduleEvent("partner-event", "dress", "2027-01-20"),
      ],
    };
    const updates: unknown[] = [];
    setupClients(
      {
        profiles: [
          { maybeSingle: { data: { id: "user-1" }, error: null } },
          { single: { data: { id: "user-1", couple_id: coupleId }, error: null } },
        ],
        wedding_journeys: [
          {
            maybeSingle: {
              data: { id: "journey-1", progress: initialProgress },
              error: null,
            },
          },
          {
            onUpdate: (value) => updates.push(value),
            maybeSingle: { data: null, error: null },
          },
          {
            maybeSingle: {
              data: { id: "journey-1", progress: partnerProgress },
              error: null,
            },
          },
          {
            onUpdate: (value) => updates.push(value),
            maybeSingle: {
              data: {
                progress: {
                  __events: [
                    ...partnerProgress.__events,
                    storedScheduleEvent("ours", "sanggyeonrye", "2027-03-01"),
                  ],
                },
              },
              error: null,
            },
          },
        ],
      },
      {
        success: true,
        joined: true,
        idempotent: false,
        couple_id: coupleId,
        invite_code: "WH-ABC123",
        role: "bride",
      },
    );

    const response = await POST(
      onboardingRequest({
        role: "bride",
        coupleAction: "join",
        partnerInviteCode: "WH-ABC123",
        sanggyeonryeDate: "2027-03-01",
      }),
    );

    expect(response.status).toBe(200);
    expect(updates).toHaveLength(2);
    expect(updates[1]).toMatchObject({
      progress: {
        __events: expect.arrayContaining([
          expect.objectContaining({ id: "initial-event" }),
          expect.objectContaining({ id: "partner-event" }),
          expect.objectContaining({ momentType: "sanggyeonrye" }),
        ]),
      },
    });
  });

  it("compare-and-swaps a null progress value without treating it as persisted data", async () => {
    let isPredicate: unknown;
    setupClients(
      {
        profiles: [
          { maybeSingle: { data: { id: "user-1" }, error: null } },
          { single: { data: { id: "user-1", couple_id: coupleId }, error: null } },
        ],
        wedding_journeys: [
          { maybeSingle: { data: { id: "journey-1", progress: null }, error: null } },
          {
            onIs: (column, value) => {
              isPredicate = { column, value };
            },
            maybeSingle: {
              data: {
                progress: {
                  __events: [
                    storedScheduleEvent("ours", "sanggyeonrye", "2027-03-01"),
                  ],
                },
              },
              error: null,
            },
          },
        ],
      },
      {
        success: true,
        joined: true,
        idempotent: false,
        couple_id: coupleId,
        invite_code: "WH-ABC123",
        role: "bride",
      },
    );

    const response = await POST(
      onboardingRequest({
        role: "bride",
        coupleAction: "join",
        partnerInviteCode: "WH-ABC123",
        sanggyeonryeDate: "2027-03-01",
      }),
    );

    expect(response.status).toBe(200);
    expect(isPredicate).toEqual({ column: "progress", value: null });
  });

  it("fails closed after three consecutive compare-and-swap conflicts", async () => {
    const progress = { __events: [] };
    const conflictRead = {
      maybeSingle: { data: { id: "journey-1", progress }, error: null },
    };
    setupClients(
      {
        profiles: [
          { maybeSingle: { data: { id: "user-1" }, error: null } },
          { single: { data: { id: "user-1", couple_id: coupleId }, error: null } },
        ],
        wedding_journeys: [
          conflictRead,
          { maybeSingle: { data: null, error: null } },
          conflictRead,
          { maybeSingle: { data: null, error: null } },
          conflictRead,
          { maybeSingle: { data: null, error: null } },
          conflictRead,
        ],
      },
      createSuccess,
    );

    const response = await POST(
      onboardingRequest({
        role: "bride",
        coupleAction: "create",
        sanggyeonryeDate: "2027-03-01",
      }),
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      error: "온보딩 저장을 완료하지 못했습니다. 잠시 후 다시 시도해주세요.",
    });
  });

  it("recovers a journey insert unique conflict by reading the canonical row", async () => {
    setupClients(
      {
        profiles: [
          { maybeSingle: { data: { id: "user-1" }, error: null } },
          { single: { data: { id: "user-1", couple_id: coupleId }, error: null } },
        ],
        wedding_journeys: [
          { maybeSingle: { data: null, error: null } },
          {
            single: {
              data: null,
              error: { code: "23505", message: "duplicate couple_id" },
            },
          },
          {
            maybeSingle: {
              data: { id: "canonical-journey", progress: { partner: true } },
              error: null,
            },
          },
        ],
      },
      createSuccess,
    );

    const response = await POST(
      onboardingRequest({ role: "bride", coupleAction: "create" }),
    );

    expect(response.status).toBe(200);
  });

  it("fails before the membership RPC when fallback profile creation fails", async () => {
    const { authClient } = setupClients(
      {
        profiles: [
          { maybeSingle: { data: null, error: null } },
          {
            awaited: {
              data: null,
              error: { code: "42501", message: "insert denied" },
            },
          },
        ],
      },
      createSuccess,
    );

    const response = await POST(
      onboardingRequest({ role: "bride", coupleAction: "create" }),
    );

    expect(response.status).toBe(500);
    expect(authClient.rpc).not.toHaveBeenCalled();
  });
});
