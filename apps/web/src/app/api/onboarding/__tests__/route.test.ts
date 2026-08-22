import { createClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { recordDecision } from "@/lib/memory/record-decision";
import { createClientFromRequest } from "@/lib/supabase/server";
import { checkRateLimitPersistent } from "@/utils/rateLimit";
import { POST } from "../route";

vi.mock("@supabase/supabase-js", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClientFromRequest: vi.fn() }));
vi.mock("@/lib/memory/record-decision", () => ({
  recordDecision: vi.fn().mockResolvedValue({ nodeId: "decision-1" }),
}));
vi.mock("@/lib/ai/stage-router", () => ({ determineStage: vi.fn(() => "planning") }));
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
  onEq?: (column: string, value: unknown) => void;
};

class FakeQuery implements PromiseLike<QueryResult> {
  private operation: "read" | "insert" | "update" = "read";

  constructor(private readonly handler: Handler) {}

  select() {
    return this;
  }

  eq(column: string, value: unknown) {
    this.handler.onEq?.(column, value);
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
    headers: {
      "Content-Type": "application/json",
      "sec-fetch-site": "same-origin",
    },
    body: JSON.stringify(body),
  });
}

function setupClients(
  handlers: Record<string, Handler[]>,
  membershipData: unknown,
  adminRpc: QueryResult = {
    data: {
      requestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      status: "applied",
      requiredCount: 1,
      acceptedCount: 1,
      isHighImpact: true,
      appliedRevision: 1,
      summary: "총예산과 결혼 일정을 저장했어요.",
      journey: {
        couple_id: coupleId,
        state_revision: 1,
        progress: {},
      },
    },
    error: null,
  },
) {
  const authClient = {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: {
          user: {
            id: "11111111-1111-4111-8111-111111111111",
            email: "user@example.com",
            // 동의 기록이 없으면 라우트가 400 으로 막는다(소셜 계정 관문).
            // 이 파일은 그 뒤의 계약(레이트리밋 순서·입력 검증)을 보므로
            // 관문은 통과시켜 놓는다. 관문 자체는
            // onboardingConsentGate.test.ts 가 고정한다.
            user_metadata: {
              name: "테스트 사용자",
              terms_agreed: true,
              privacy_agreed: true,
            },
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

  it("rejects a cross-site mutation before authentication or service access", async () => {
    const request = onboardingRequest({
      role: "bride",
      coupleAction: "create",
    });
    request.headers.set("origin", "https://attacker.example");
    request.headers.set("sec-fetch-site", "cross-site");

    const response = await POST(request);

    expect(response.status).toBe(403);
    expect(createClientFromRequest).not.toHaveBeenCalled();
    expect(createClient).not.toHaveBeenCalled();
  });

  it("rejects an oversized streamed body before authentication", async () => {
    const response = await POST(
      new Request("http://localhost/api/onboarding", {
        method: "POST",
        headers: { "sec-fetch-site": "same-origin" },
        body: JSON.stringify({ progress: { notes: "x".repeat(129 * 1024) } }),
      }),
    );

    expect(response.status).toBe(413);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(createClientFromRequest).not.toHaveBeenCalled();
  });

  it("uses the persistent fail-closed join limiter before membership or route admin access", async () => {
    const { authClient } = setupClients({}, createSuccess);
    const limited = new Response(
      JSON.stringify({ error: "요청이 너무 많습니다." }),
      {
        status: 429,
        headers: {
          "Content-Type": "application/json",
          "Retry-After": "60",
        },
      },
    );
    vi.mocked(checkRateLimitPersistent).mockResolvedValueOnce(limited as never);

    const response = await POST(
      onboardingRequest({
        role: "bride",
        coupleAction: "join",
        partnerInviteCode: "WH-ABC123",
      }),
    );

    expect(response.status).toBe(429);
    expect(response.headers.get("cache-control")).toContain("private");
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(checkRateLimitPersistent).toHaveBeenCalledWith(
      "onboarding:user-1",
      { maxRequests: 10, windowMs: 10 * 60 * 1000 },
      { failClosed: true },
    );
    expect(authClient.auth.getUser).toHaveBeenCalledTimes(1);
    expect(authClient.rpc).not.toHaveBeenCalled();
    expect(createClient).not.toHaveBeenCalled();
  });

  it("rejects unsafe nested progress before membership or service access", async () => {
    const { authClient } = setupClients({}, createSuccess);

    const response = await POST(
      onboardingRequest({
        role: "bride",
        coupleAction: "create",
        progress: {
          venue: { label: "예식장\u202e거짓" },
        },
      }),
    );

    expect(response.status).toBe(400);
    expect(authClient.rpc).not.toHaveBeenCalled();
    expect(createClient).not.toHaveBeenCalled();
  });

  it.each([
    { __events: [] },
    { __stage: "wat" },
    { __stage: "" },
    { __stage: { value: "venue_booked" } },
    { unknown_category: { status: "not_started" } },
    { venue: { status: "done" } },
    { venue: { status: "completed", spent: 1_000_000_001 } },
    { venue: { status: "completed", spent: "10000" } },
    { venue: { status: "in_progress", spent: 10_000 } },
    {
      __preferences: {
        weddingStyle: "royal",
        priorities: [],
        budgetTendency: null,
        guestCount: null,
      },
    },
    {
      __preferences: {
        weddingStyle: "minimal",
        priorities: ["venue", "venue"],
        budgetTendency: "balanced",
        guestCount: "100to200",
      },
    },
  ])(
    "rejects non-contract progress before membership or route admin access: %o",
    async (invalidProgress) => {
      const { authClient } = setupClients({}, createSuccess);

      const response = await POST(
        onboardingRequest({
          role: "bride",
          coupleAction: "create",
          progress: invalidProgress,
        }),
      );

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({
        error: "준비 현황 형식이 올바르지 않습니다.",
      });
      expect(authClient.rpc).not.toHaveBeenCalled();
      expect(createClient).not.toHaveBeenCalled();
    },
  );

  it.each([
    [
      { weddingDate: "2027-02-30" },
      "결혼식 날짜 형식이 올바르지 않습니다.",
    ],
    [
      { sanggyeonryeDate: "2027-13-01" },
      "양쪽 부모님 첫 만남 날짜 형식이 올바르지 않습니다.",
    ],
    [
      { venue: `웨딩홀${"\u202e"}거짓` },
      "예식장 이름을 다시 확인해주세요.",
    ],
    [
      { venue: "가".repeat(101) },
      "예식장 이름을 다시 확인해주세요.",
    ],
  ])(
    "rejects malformed visible onboarding data before membership: %o",
    async (invalidFields, expectedError) => {
      const { authClient } = setupClients({}, createSuccess);

      const response = await POST(
        onboardingRequest({
          role: "bride",
          coupleAction: "create",
          ...invalidFields,
        }),
      );

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({ error: expectedError });
      expect(authClient.rpc).not.toHaveBeenCalled();
      expect(createClient).not.toHaveBeenCalled();
    },
  );

  it("creates membership through the authenticated RPC and never writes couples directly", async () => {
    let profileCompletion: unknown;
    const profileCompletionPredicates: Array<{
      column: string;
      value: unknown;
    }> = [];
    let journeyInsert: unknown;
    const { authClient, fromCalls } = setupClients(
      {
        profiles: [
          { maybeSingle: { data: { id: "user-1" }, error: null } },
          {
            onUpdate: (value) => {
              profileCompletion = value;
            },
            onEq: (column, value) => {
              profileCompletionPredicates.push({ column, value });
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
            single: {
              data: { id: "journey-1", progress: {}, state_revision: 0 },
              error: null,
            },
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
        progress: {
          venue: { status: "completed", spent: 2_000_000 },
          __stage: "venue_booked",
          __preferences: {
            weddingStyle: "minimal",
            priorities: ["venue"],
            budgetTendency: "balanced",
            guestCount: "100to200",
          },
        },
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      coupleId,
      inviteCode: "WH-ABC123",
      created: true,
      idempotent: false,
      planChange: { status: "applied" },
    });
    expect(authClient.rpc).toHaveBeenCalledWith("create_couple_for_current_user", {
      p_role: "bride",
    });
    expect(fromCalls).not.toContain("couples");
    expect(profileCompletion).toEqual({ onboarding_completed: true, onboarding_step: 5 });
    expect(profileCompletionPredicates).toEqual([
      { column: "id", value: "11111111-1111-4111-8111-111111111111" },
      { column: "couple_id", value: coupleId },
    ]);
    expect(journeyInsert).toMatchObject({
      couple_id: coupleId,
      wedding_date: null,
      venue: null,
      total_budget: 0,
      progress: {},
    });
    expect(fromCalls.indexOf("wedding_journeys")).toBeLessThan(
      fromCalls.lastIndexOf("profiles"),
    );
    expect(createClient).toHaveBeenCalled();
    const admin = vi.mocked(createClient).mock.results[0]?.value as {
      rpc: ReturnType<typeof vi.fn>;
    };
    expect(admin.rpc).toHaveBeenCalledWith("submit_couple_plan_change", {
      p_couple_id: coupleId,
      p_actor_user_id: "11111111-1111-4111-8111-111111111111",
      p_expected_revision: 0,
      p_changes: {
        wedding_date: "2027-05-08",
        venue: "테스트 웨딩홀",
        total_budget: 30_000_000,
        progress_patch: {
          venue: { status: "completed", spent: 2_000_000 },
          __stage: "venue_booked",
          __preferences: {
            weddingStyle: "minimal",
            priorities: ["venue"],
            budgetTendency: "balanced",
            guestCount: "100to200",
          },
        },
      },
      p_surface: "/dashboard",
      p_summary: "온보딩에서 입력한 결혼 준비 정보를 저장해요.",
    });
  });

  it.each([
    ["manwon", { amount: 3000, unit: "manwon" }, 30_000_000],
    ["won", { amount: 30_000_000, unit: "won" }, 30_000_000],
  ])("normalizes a tagged %s budget before applying the shared plan", async (
    _unit,
    totalBudget,
    expectedBudgetWon,
  ) => {
    const { admin } = setupClients(
      {
        profiles: [
          { maybeSingle: { data: { id: "user-1" }, error: null } },
          { single: { data: { id: "user-1", couple_id: coupleId }, error: null } },
        ],
        wedding_journeys: [
          { maybeSingle: { data: null, error: null } },
          {
            single: {
              data: { id: "journey-1", progress: {}, state_revision: 0 },
              error: null,
            },
          },
        ],
      },
      createSuccess,
    );

    const response = await POST(
      onboardingRequest({
        role: "bride",
        coupleAction: "create",
        totalBudget,
      }),
    );

    expect(response.status).toBe(200);
    expect(admin.rpc).toHaveBeenCalledWith(
      "submit_couple_plan_change",
      expect.objectContaining({
        p_changes: expect.objectContaining({ total_budget: expectedBudgetWon }),
      }),
    );
    await vi.waitFor(() => {
      expect(recordDecision).toHaveBeenCalledWith(
        expect.objectContaining({
          category: "budget",
          chosenValue: { total_budget: expectedBudgetWon },
        }),
      );
    });
  });

  it("stores zero rather than inventing a budget when the member leaves it unset", async () => {
    let journeyInsert: unknown;
    setupClients(
      {
        profiles: [
          { maybeSingle: { data: { id: "user-1" }, error: null } },
          { single: { data: { id: "user-1", couple_id: coupleId }, error: null } },
        ],
        wedding_journeys: [
          { maybeSingle: { data: null, error: null } },
          {
            onInsert: (value) => {
              journeyInsert = value;
            },
            single: {
              data: { id: "journey-1", progress: {}, state_revision: 0 },
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
    expect(journeyInsert).toMatchObject({ total_budget: 0 });
    expect(recordDecision).not.toHaveBeenCalledWith(
      expect.objectContaining({ category: "budget" }),
    );
  });

  it("returns a truthful pending result and does not record unapproved onboarding facts", async () => {
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
              data: { id: "journey-1", progress: {}, state_revision: 0 },
              error: null,
            },
          },
        ],
      },
      createSuccess,
      {
        data: {
          requestId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          status: "pending_partner",
          requiredCount: 2,
          acceptedCount: 1,
          isHighImpact: true,
          appliedRevision: null,
          summary: "결혼식 날짜: 미정 → 2027-05-08",
          journey: null,
        },
        error: null,
      },
    );

    const response = await POST(
      onboardingRequest({
        role: "bride",
        coupleAction: "create",
        weddingDate: "2027-05-08",
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      planChange: {
        status: "pending_partner",
        requestId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        summary: "결혼식 날짜: 미정 → 2027-05-08",
      },
    });
    expect(recordDecision).not.toHaveBeenCalled();
  });

  it("proposes explicit shared fields instead of dropping them when a partner journey already exists", async () => {
    let profileCompletion: unknown;
    const { admin } = setupClients(
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
          {
            maybeSingle: {
              data: {
                id: "journey-1",
                wedding_date: "2027-05-08",
                venue: "기존 웨딩홀",
                total_budget: 20_000_000,
                progress: {
                  venue: { status: "in_progress", spent: 1_000_000 },
                },
                state_revision: 7,
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
      {
        data: {
          requestId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
          status: "pending_partner",
          requiredCount: 2,
          acceptedCount: 1,
          isHighImpact: true,
          appliedRevision: null,
          summary: "총예산: 20000000원 → 30000000원",
          journey: null,
        },
        error: null,
      },
    );

    const response = await POST(
      onboardingRequest({
        role: "bride",
        coupleAction: "join",
        partnerInviteCode: "WH-ABC123",
        weddingDate: "2027-05-08",
        venue: "기존 웨딩홀",
        totalBudget: 30_000_000,
        progress: {
          venue: { status: "completed", spent: 2_000_000 },
        },
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      planChange: {
        status: "pending_partner",
        requestId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      },
      routineProgress: {
        status: "deferred",
        message: expect.stringContaining("이번 요청에 반영되지 않았어요"),
      },
    });
    expect(admin.rpc).toHaveBeenCalledWith("submit_couple_plan_change", {
      p_couple_id: coupleId,
      p_actor_user_id: "11111111-1111-4111-8111-111111111111",
      p_expected_revision: 7,
      p_changes: { total_budget: 30_000_000 },
      p_surface: "/dashboard",
      p_summary: "온보딩에서 입력한 결혼 준비 정보를 저장해요.",
    });
    expect(profileCompletion).toEqual({
      onboarding_completed: true,
      onboarding_step: 5,
    });
    expect(recordDecision).not.toHaveBeenCalled();
  });

  it("keeps a joined high-impact proposal atomic by deferring routine progress", async () => {
    let profileCompletion: unknown;
    const { admin } = setupClients(
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
            single: {
              data: { id: "journey-1", progress: {}, state_revision: 0 },
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
      {
        data: {
          requestId: "12121212-1212-4212-8212-121212121212",
          status: "pending_partner",
          requiredCount: 2,
          acceptedCount: 1,
          isHighImpact: true,
          appliedRevision: null,
          summary: "총예산: 미정 → 30000000원",
          journey: null,
        },
        error: null,
      },
    );

    const response = await POST(
      onboardingRequest({
        role: "bride",
        coupleAction: "join",
        partnerInviteCode: "WH-ABC123",
        totalBudget: 30_000_000,
        progress: {
          venue: { status: "in_progress" },
          __preferences: {
            weddingStyle: "minimal",
            priorities: ["venue"],
            budgetTendency: "balanced",
            guestCount: "100to200",
          },
        },
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      planChange: {
        status: "pending_partner",
        requestId: "12121212-1212-4212-8212-121212121212",
      },
      routineProgress: {
        status: "deferred",
        message: expect.stringContaining("다시 입력해주세요"),
      },
    });
    expect(admin.rpc).toHaveBeenCalledTimes(1);
    expect(admin.rpc).toHaveBeenCalledWith("submit_couple_plan_change", {
      p_couple_id: coupleId,
      p_actor_user_id: "11111111-1111-4111-8111-111111111111",
      p_expected_revision: 0,
      p_changes: { total_budget: 30_000_000 },
      p_surface: "/dashboard",
      p_summary: "온보딩에서 입력한 결혼 준비 정보를 저장해요.",
    });
    expect(profileCompletion).toEqual({
      onboarding_completed: true,
      onboarding_step: 5,
    });
  });

  it("treats an idempotent create retry as linked before building a high-impact delta", async () => {
    const { admin } = setupClients(
      {
        profiles: [
          { maybeSingle: { data: { id: "user-1" }, error: null } },
          { single: { data: { id: "user-1", couple_id: coupleId }, error: null } },
        ],
        wedding_journeys: [
          {
            maybeSingle: {
              data: {
                id: "journey-1",
                wedding_date: null,
                venue: null,
                total_budget: 0,
                progress: {},
                state_revision: 5,
              },
              error: null,
            },
          },
        ],
      },
      {
        success: true,
        created: false,
        idempotent: true,
        couple_id: coupleId,
        invite_code: "WH-ABC123",
        role: "bride",
      },
      {
        data: {
          requestId: "13131313-1313-4313-8313-131313131313",
          status: "pending_partner",
          requiredCount: 2,
          acceptedCount: 1,
          isHighImpact: true,
          appliedRevision: null,
          summary: "총예산: 미정 → 30000000원",
          journey: null,
        },
        error: null,
      },
    );

    const response = await POST(
      onboardingRequest({
        role: "bride",
        coupleAction: "create",
        totalBudget: 30_000_000,
        progress: {
          venue: { status: "completed", spent: 2_000_000 },
        },
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      planChange: { status: "pending_partner" },
      routineProgress: { status: "deferred" },
    });
    expect(admin.rpc).toHaveBeenCalledWith(
      "submit_couple_plan_change",
      expect.objectContaining({
        p_expected_revision: 5,
        p_changes: { total_budget: 30_000_000 },
      }),
    );
  });

  it("returns a recoverable 409 if a partner joins during a new solo mixed-delta attempt", async () => {
    const profileCompletion = vi.fn();
    const { admin } = setupClients(
      {
        profiles: [
          { maybeSingle: { data: { id: "user-1" }, error: null } },
          {
            onUpdate: profileCompletion,
            single: { data: { id: "user-1", couple_id: coupleId }, error: null },
          },
        ],
        wedding_journeys: [
          { maybeSingle: { data: null, error: null } },
          {
            single: {
              data: { id: "journey-1", progress: {}, state_revision: 0 },
              error: null,
            },
          },
        ],
      },
      createSuccess,
      {
        data: null,
        error: {
          code: "22023",
          message: "COUPLE_PLAN_CHANGE_UNSUPPORTED_MIXED_DELTA",
        },
      },
    );

    const response = await POST(
      onboardingRequest({
        role: "bride",
        coupleAction: "create",
        totalBudget: 30_000_000,
        progress: {
          venue: { status: "in_progress" },
        },
      }),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error:
        "파트너 연결 상태가 방금 바뀌어 입력을 안전하게 저장하지 않았어요. 최신 상태로 다시 시도해주세요.",
      code: "ONBOARDING_PLAN_RETRY_REQUIRED",
    });
    expect(admin.rpc).toHaveBeenCalledTimes(1);
    expect(profileCompletion).not.toHaveBeenCalled();
    expect(recordDecision).not.toHaveBeenCalled();
  });

  it("initializes progress through the RPC when an existing journey is still neutral", async () => {
    const { admin } = setupClients(
      {
        profiles: [
          { maybeSingle: { data: { id: "user-1" }, error: null } },
          { single: { data: { id: "user-1", couple_id: coupleId }, error: null } },
        ],
        wedding_journeys: [
          {
            maybeSingle: {
              data: {
                id: "journey-1",
                wedding_date: null,
                venue: null,
                total_budget: 0,
                progress: {},
                state_revision: 3,
              },
              error: null,
            },
          },
        ],
      },
      createSuccess,
      {
        data: {
          requestId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
          status: "applied",
          requiredCount: 1,
          acceptedCount: 1,
          isHighImpact: false,
          appliedRevision: 4,
          summary: "온보딩 준비 현황을 저장했어요.",
          journey: {
            couple_id: coupleId,
            state_revision: 4,
            progress: {
              venue: { status: "in_progress" },
            },
          },
        },
        error: null,
      },
    );

    const response = await POST(
      onboardingRequest({
        role: "bride",
        coupleAction: "create",
        progress: {
          venue: { status: "in_progress" },
        },
      }),
    );

    expect(response.status).toBe(200);
    expect(admin.rpc).toHaveBeenCalledWith("submit_couple_plan_change", {
      p_couple_id: coupleId,
      p_actor_user_id: "11111111-1111-4111-8111-111111111111",
      p_expected_revision: 3,
      p_changes: {
        progress_patch: {
          venue: { status: "in_progress" },
        },
      },
      p_surface: "/dashboard",
      p_summary: "온보딩에서 입력한 결혼 준비 정보를 저장해요.",
    });
  });

  it("fails closed on an impossible initial-plan RPC result", async () => {
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
              data: { id: "journey-1", progress: {}, state_revision: 0 },
              error: null,
            },
          },
        ],
      },
      createSuccess,
      {
        data: {
          requestId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
          status: "applied",
          requiredCount: 2,
          acceptedCount: 1,
          isHighImpact: true,
          appliedRevision: 1,
          summary: "결혼식 날짜를 저장했어요.",
          journey: null,
        },
        error: null,
      },
    );

    const response = await POST(
      onboardingRequest({
        role: "bride",
        coupleAction: "create",
        weddingDate: "2027-05-08",
      }),
    );

    expect(response.status).toBe(500);
    expect(recordDecision).not.toHaveBeenCalled();
  });

  it("keeps onboarding incomplete when an identical durable request was rejected", async () => {
    const profileCompletion = vi.fn();
    setupClients(
      {
        profiles: [
          { maybeSingle: { data: { id: "user-1" }, error: null } },
          {
            onUpdate: profileCompletion,
            single: { data: { id: "user-1", couple_id: coupleId }, error: null },
          },
        ],
        wedding_journeys: [
          {
            maybeSingle: {
              data: {
                id: "journey-1",
                wedding_date: null,
                venue: null,
                total_budget: 20_000_000,
                progress: {},
                state_revision: 0,
              },
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
      {
        data: {
          requestId: "12121212-1212-4212-8212-121212121212",
          status: "rejected",
          requiredCount: 2,
          acceptedCount: 1,
          isHighImpact: true,
          appliedRevision: null,
          summary: "총예산: 20000000원 → 30000000원",
          journey: null,
        },
        error: null,
      },
    );

    const response = await POST(
      onboardingRequest({
        role: "bride",
        coupleAction: "join",
        partnerInviteCode: "WH-ABC123",
        totalBudget: 30_000_000,
      }),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error:
        "파트너가 이 계획에 동의하지 않았어요. 내용을 바꾸거나 해당 항목을 비워 다시 저장해주세요.",
      planChange: {
        status: "rejected",
        requestId: "12121212-1212-4212-8212-121212121212",
      },
    });
    expect(profileCompletion).not.toHaveBeenCalled();
    expect(recordDecision).not.toHaveBeenCalled();
  });

  it("does not report success when journey persistence fails", async () => {
    const profileCompletion = vi.fn();
    setupClients(
      {
        profiles: [
          { maybeSingle: { data: { id: "user-1" }, error: null } },
          {
            onUpdate: profileCompletion,
            single: { data: { id: "user-1", couple_id: coupleId }, error: null },
          },
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
    expect(recordDecision).not.toHaveBeenCalled();
    expect(profileCompletion).not.toHaveBeenCalled();
  });

  it.each([1_000_000_001, 0.5, "not-a-budget", true, "1e3"])(
    "rejects invalid budget input %s before membership or completion",
    async (totalBudget) => {
      const { authClient } = setupClients({}, createSuccess);

      const response = await POST(
        onboardingRequest({
          role: "bride",
          coupleAction: "create",
          totalBudget,
        }),
      );

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({
        error: "총 예산은 10억 원 이하의 금액으로 입력해주세요.",
      });
      expect(authClient.rpc).not.toHaveBeenCalled();
      expect(createClient).not.toHaveBeenCalled();
    },
  );

  it.each([
    { amount: 3000, unit: "unknown" },
    { amount: 3000, unit: "manwon", currency: "KRW" },
    { amount: "3000", unit: "manwon" },
    { amount: 3000.5, unit: "manwon" },
    { amount: -1, unit: "manwon" },
    { amount: 0, unit: "manwon" },
    { amount: 100_001, unit: "manwon" },
    { amount: 1_000_000_001, unit: "won" },
  ])(
    "rejects an invalid tagged budget %# before membership or completion",
    async (totalBudget) => {
      const { authClient } = setupClients({}, createSuccess);

      const response = await POST(
        onboardingRequest({
          role: "bride",
          coupleAction: "create",
          totalBudget,
        }),
      );

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({
        error: "총 예산은 10억 원 이하의 금액으로 입력해주세요.",
      });
      expect(authClient.rpc).not.toHaveBeenCalled();
      expect(createClient).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["a non-array event container", { __events: { id: "legacy-event" } }],
    [
      "a rejected legacy event",
      {
        __events: [
          {
            id: "legacy-event",
            momentType: "venue",
            date: "2027-01-10",
            title: "기존 일정",
          },
        ],
      },
    ],
    [
      "a truncated event array",
      {
        __events: Array.from(
          { length: 501 },
          (_, index) =>
            storedScheduleEvent(`legacy-event-${index}`, "venue", "2027-01-10"),
        ),
      },
    ],
    [
      "multiple authoritative dates",
      {
        __events: [
          storedScheduleEvent(
            "legacy-sanggyeonrye-1",
            "sanggyeonrye",
            "2027-01-10",
          ),
          storedScheduleEvent(
            "legacy-sanggyeonrye-2",
            "sanggyeonrye",
            "2027-02-10",
          ),
        ],
      },
    ],
  ])(
    "fails closed before replacing stored schedule data with %s",
    async (_caseName, existingProgress) => {
      const profileCompletion = vi.fn();
      const { admin } = setupClients(
        {
          profiles: [
            { maybeSingle: { data: { id: "user-1" }, error: null } },
            {
              onUpdate: profileCompletion,
              single: {
                data: { id: "user-1", couple_id: coupleId },
                error: null,
              },
            },
          ],
          wedding_journeys: [
            {
              maybeSingle: {
                data: {
                  id: "journey-1",
                  wedding_date: null,
                  venue: null,
                  total_budget: 0,
                  progress: existingProgress,
                  state_revision: 4,
                },
                error: null,
              },
            },
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

      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toEqual({
        error:
          "저장된 일정 중 확인이 필요한 항목이 있어 양쪽 부모님 첫 만남 날짜를 저장하지 않았어요. 날짜 입력을 비우고 계속하거나, 기존 일정을 정리한 뒤 다시 시도해주세요.",
        code: "SCHEDULE_EVENTS_REPAIR_REQUIRED",
      });
      expect(admin.rpc).not.toHaveBeenCalled();
      expect(profileCompletion).not.toHaveBeenCalled();
      expect(recordDecision).not.toHaveBeenCalled();
    },
  );

  it("returns an explicit conflict for a different authoritative sanggyeonrye date", async () => {
    const profileCompletion = vi.fn();
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
          {
            onUpdate: profileCompletion,
            single: { data: { id: "user-1", couple_id: coupleId }, error: null },
          },
        ],
        wedding_journeys: [
          {
            maybeSingle: {
              data: {
                id: "journey-1",
                wedding_date: null,
                venue: null,
                total_budget: 0,
                progress: existingProgress,
                state_revision: 4,
              },
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

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error:
        "이미 저장된 양쪽 부모님 첫 만남 날짜(2027-02-01)와 요청한 날짜(2027-03-01)가 달라요. 기존 일정을 확인한 뒤 다시 입력해주세요.",
      code: "SANGGYEONRYE_DATE_CONFLICT",
      conflict: {
        field: "sanggyeonryeDate",
        existingDate: "2027-02-01",
        requestedDate: "2027-03-01",
      },
    });
    expect(admin.rpc).not.toHaveBeenCalled();
    expect(profileCompletion).not.toHaveBeenCalled();
  });

  it("treats the same authoritative sanggyeonrye date as a no-op success", async () => {
    const profileCompletion = vi.fn();
    const existingProgress = {
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
          {
            onUpdate: profileCompletion,
            single: { data: { id: "user-1", couple_id: coupleId }, error: null },
          },
        ],
        wedding_journeys: [
          {
            maybeSingle: {
              data: {
                id: "journey-1",
                wedding_date: null,
                venue: null,
                total_budget: 0,
                progress: existingProgress,
                state_revision: 4,
              },
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
        partnerInviteCode: "WH-ABC123",
        sanggyeonryeDate: "2027-02-01",
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      planChange: { status: "unchanged" },
    });
    expect(admin.rpc).not.toHaveBeenCalled();
    expect(profileCompletion).toHaveBeenCalledWith({
      onboarding_completed: true,
      onboarding_step: 5,
    });
  });

  it("keeps a cancelled sanggyeonrye record and creates the requested active event", async () => {
    const cancelledSanggyeonrye = {
      ...storedScheduleEvent("cancelled-event", "sanggyeonrye", "2027-02-01"),
      status: "cancelled",
      cancellation: {
        cancelledAt: "2026-08-02T12:30:00.000Z",
        cancelledByProfileId: "11111111-1111-4111-8111-111111111111",
      },
      updatedAt: "2026-08-02T12:30:00.000Z",
    };
    const existingProgress = {
      budget: { spent: 1_000_000 },
      __events: [
        storedScheduleEvent("other-event", "venue", "2027-01-10"),
        cancelledSanggyeonrye,
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
              data: {
                id: "journey-1",
                wedding_date: null,
                venue: null,
                total_budget: 0,
                progress: existingProgress,
                state_revision: 4,
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
      {
        data: {
          requestId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
          status: "applied",
          requiredCount: 1,
          acceptedCount: 1,
          isHighImpact: false,
          appliedRevision: 5,
          summary: "양쪽 부모님 첫 만남 일정을 저장했어요.",
          journey: {
            couple_id: coupleId,
            state_revision: 5,
            progress: {
              ...existingProgress,
              __events: [
                ...existingProgress.__events,
                storedScheduleEvent("new-event", "sanggyeonrye", "2027-03-01"),
              ],
            },
          },
        },
        error: null,
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
    expect(admin.rpc).toHaveBeenCalledWith("submit_couple_plan_change", {
      p_couple_id: coupleId,
      p_actor_user_id: "11111111-1111-4111-8111-111111111111",
      p_expected_revision: 4,
      p_changes: {
        progress_patch: {
          __events: expect.arrayContaining([
            expect.objectContaining({ id: "other-event" }),
            expect.objectContaining({
              id: "cancelled-event",
              status: "cancelled",
              cancellation: cancelledSanggyeonrye.cancellation,
            }),
            expect.objectContaining({
              momentType: "sanggyeonrye",
              date: "2027-03-01",
            }),
          ]),
        },
      },
      p_surface: "/dashboard",
      p_summary: "온보딩에서 입력한 결혼 준비 정보를 저장해요.",
    });
  });

  it("keeps a scalar approval and its new schedule event in one pending request", async () => {
    const existingProgress = {
      __events: [storedScheduleEvent("other-event", "venue", "2027-01-10")],
    };
    const { admin, fromCalls } = setupClients(
      {
        profiles: [
          { maybeSingle: { data: { id: "user-1" }, error: null } },
          { single: { data: { id: "user-1", couple_id: coupleId }, error: null } },
        ],
        wedding_journeys: [
          {
            maybeSingle: {
              data: {
                id: "journey-1",
                wedding_date: null,
                venue: null,
                total_budget: 20_000_000,
                progress: existingProgress,
                state_revision: 7,
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
      {
        data: {
          requestId: "abababab-abab-4bab-8bab-abababababab",
          status: "pending_partner",
          requiredCount: 2,
          acceptedCount: 1,
          isHighImpact: true,
          appliedRevision: null,
          summary: "총예산: 20000000원 → 30000000원",
          journey: null,
        },
        error: null,
      },
    );

    const response = await POST(
      onboardingRequest({
        role: "bride",
        coupleAction: "join",
        partnerInviteCode: "WH-ABC123",
        totalBudget: 30_000_000,
        sanggyeonryeDate: "2027-03-01",
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      planChange: {
        status: "pending_partner",
        requestId: "abababab-abab-4bab-8bab-abababababab",
      },
    });
    expect(admin.rpc).toHaveBeenCalledWith("submit_couple_plan_change", {
      p_couple_id: coupleId,
      p_actor_user_id: "11111111-1111-4111-8111-111111111111",
      p_expected_revision: 7,
      p_changes: {
        total_budget: 30_000_000,
        progress_patch: {
          __events: expect.arrayContaining([
            expect.objectContaining({ id: "other-event" }),
            expect.objectContaining({
              momentType: "sanggyeonrye",
              date: "2027-03-01",
            }),
          ]),
        },
      },
      p_surface: "/dashboard",
      p_summary: "온보딩에서 입력한 결혼 준비 정보를 저장해요.",
    });
    expect(fromCalls.filter((table) => table === "wedding_journeys")).toHaveLength(1);
    expect(recordDecision).not.toHaveBeenCalled();
  });

  it("retries the same pending schedule intent with byte-stable event identity", async () => {
    const existingJourney = {
      id: "journey-1",
      wedding_date: null,
      venue: null,
      total_budget: 20_000_000,
      progress: {
        __events: [storedScheduleEvent("other-event", "venue", "2027-01-10")],
      },
      state_revision: 7,
    };
    const { admin } = setupClients(
      {
        profiles: [
          { maybeSingle: { data: { id: "user-1" }, error: null } },
          { single: { data: { id: "user-1", couple_id: coupleId }, error: null } },
          { maybeSingle: { data: { id: "user-1" }, error: null } },
          { single: { data: { id: "user-1", couple_id: coupleId }, error: null } },
        ],
        wedding_journeys: [
          { maybeSingle: { data: existingJourney, error: null } },
          { maybeSingle: { data: existingJourney, error: null } },
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
      {
        data: {
          requestId: "abababab-abab-4bab-8bab-abababababab",
          status: "pending_partner",
          requiredCount: 2,
          acceptedCount: 1,
          isHighImpact: true,
          appliedRevision: null,
          summary: "총예산: 20000000원 → 30000000원",
          journey: null,
        },
        error: null,
      },
    );
    const body = {
      role: "bride",
      coupleAction: "join",
      partnerInviteCode: "WH-ABC123",
      totalBudget: 30_000_000,
      sanggyeonryeDate: "2027-03-01",
    };

    const firstResponse = await POST(onboardingRequest(body));
    const secondResponse = await POST(onboardingRequest(body));

    expect(firstResponse.status).toBe(200);
    expect(secondResponse.status).toBe(200);
    expect(admin.rpc).toHaveBeenCalledTimes(2);
    const firstChanges = admin.rpc.mock.calls[0]?.[1]?.p_changes;
    const secondChanges = admin.rpc.mock.calls[1]?.[1]?.p_changes;
    expect(secondChanges).toEqual(firstChanges);
    expect(firstChanges).toMatchObject({
      progress_patch: {
        __events: expect.arrayContaining([
          expect.objectContaining({
            id: "onboarding:sanggyeonrye:2027-03-01",
            sourceKey: "onboarding:sanggyeonrye",
            createdAt: "2027-03-01T00:00:00.000Z",
            updatedAt: "2027-03-01T00:00:00.000Z",
          }),
        ]),
      },
    });
    const serializedChanges = JSON.parse(
      JSON.stringify(firstChanges),
    ) as {
      progress_patch: { __events: Array<Record<string, unknown>> };
    };
    const serializedEvent = serializedChanges.progress_patch.__events.find(
      (event) => event.id === "onboarding:sanggyeonrye:2027-03-01",
    );
    expect(serializedEvent).toBeDefined();
    expect(Object.keys(serializedEvent ?? {}).sort()).toEqual([
      "createdAt",
      "date",
      "id",
      "momentType",
      "sourceKey",
      "status",
      "title",
      "updatedAt",
    ]);
    expect(serializedEvent).toHaveProperty("status", "planned");
    expect(serializedEvent).not.toHaveProperty("memo");
    expect(JSON.stringify(secondChanges)).toBe(JSON.stringify(firstChanges));
  });

  it("fails closed on a stale revision without completing the profile", async () => {
    const profileCompletion = vi.fn();
    const { admin } = setupClients(
      {
        profiles: [
          { maybeSingle: { data: { id: "user-1" }, error: null } },
          {
            onUpdate: profileCompletion,
            single: { data: { id: "user-1", couple_id: coupleId }, error: null },
          },
        ],
        wedding_journeys: [
          {
            maybeSingle: {
              data: {
                id: "journey-1",
                wedding_date: null,
                venue: null,
                total_budget: 0,
                progress: {
                  __events: [
                    storedScheduleEvent("initial-event", "venue", "2027-01-10"),
                  ],
                },
                state_revision: 9,
              },
              error: null,
            },
          },
        ],
      },
      createSuccess,
      {
        data: null,
        error: { code: "40001", message: "stale revision" },
      },
    );

    const response = await POST(
      onboardingRequest({
        role: "bride",
        coupleAction: "create",
        sanggyeonryeDate: "2027-03-01",
      }),
    );

    expect(response.status).toBe(500);
    expect(admin.rpc).toHaveBeenCalledTimes(1);
    expect(profileCompletion).not.toHaveBeenCalled();
    expect(recordDecision).not.toHaveBeenCalled();
  });

  it("treats null progress as empty only inside the revision-bound request", async () => {
    const { admin } = setupClients(
      {
        profiles: [
          { maybeSingle: { data: { id: "user-1" }, error: null } },
          { single: { data: { id: "user-1", couple_id: coupleId }, error: null } },
        ],
        wedding_journeys: [
          {
            maybeSingle: {
              data: {
                id: "journey-1",
                wedding_date: null,
                venue: null,
                total_budget: 0,
                progress: null,
                state_revision: 2,
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
      {
        data: {
          requestId: "cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd",
          status: "applied",
          requiredCount: 1,
          acceptedCount: 1,
          isHighImpact: false,
          appliedRevision: 3,
          summary: "양쪽 부모님 첫 만남 일정을 저장했어요.",
          journey: {
            couple_id: coupleId,
            state_revision: 3,
            progress: {
              __events: [
                storedScheduleEvent("ours", "sanggyeonrye", "2027-03-01"),
              ],
            },
          },
        },
        error: null,
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
    expect(admin.rpc).toHaveBeenCalledWith(
      "submit_couple_plan_change",
      expect.objectContaining({
        p_expected_revision: 2,
        p_changes: {
          progress_patch: {
            __events: expect.arrayContaining([
              expect.objectContaining({
                momentType: "sanggyeonrye",
                date: "2027-03-01",
              }),
            ]),
          },
        },
      }),
    );
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
