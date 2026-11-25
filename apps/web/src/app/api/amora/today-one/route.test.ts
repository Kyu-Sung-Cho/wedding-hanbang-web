import { beforeEach, describe, expect, it, vi } from "vitest";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClientFromRequest } from "@/lib/supabase/server";
import { isAmoraTodayOneEnabled } from "@/lib/features/amoraCareFlags";
import { buildTodayOneScheduleCandidates } from "@/lib/care/todayOne";
import { readAmoraActionSnapshot } from "@/lib/amora/actionRepository";
import { loadCoupleContext } from "@/lib/invitation/coupleContext";
import { checkRateLimit } from "@/utils/rateLimit";
import { isTrustedMutationRequest } from "@/utils/trustedMutation";
import { GET, POST } from "./route";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClientFromRequest: vi.fn() }));
vi.mock("@/lib/features/amoraCareFlags", () => ({
  isAmoraTodayOneEnabled: vi.fn(() => true),
}));
vi.mock("@/utils/rateLimit", () => ({
  checkRateLimit: vi.fn(() => null),
  rateLimitKey: vi.fn(() => "amora-today-one:test"),
}));
vi.mock("@/utils/trustedMutation", () => ({
  isTrustedMutationRequest: vi.fn(() => true),
}));
// 25장 2절의 새 종류가 읽는 자료. `?kinds=2` 가 없으면 이 셋은 불리지 않아야 한다.
vi.mock("@/lib/amora/actionRepository", () => ({ readAmoraActionSnapshot: vi.fn() }));
vi.mock("@/lib/invitation/coupleContext", () => ({ loadCoupleContext: vi.fn() }));
vi.mock("@/lib/invitation/letterService", () => ({ loadLetterView: vi.fn() }));

const USER_ID = "10000000-0000-4000-8000-000000000001";
const COUPLE_ID = "20000000-0000-4000-8000-000000000001";
const CARD_ID = "30000000-0000-4000-8000-000000000001";

const READY_RESPONSE = {
  version: 1,
  state: "ready",
  recipientUserId: USER_ID,
  claimedForDate: "2026-08-02",
  card: {
    id: CARD_ID,
    revision: 1,
    sourceRevision: 7,
    sourceKey: "schedule:0123456789abcdef01234567:d1",
    kind: "schedule_moment",
    whyNow: "내일 상견례 일정이 있어요.",
    confirmed: ["일정: 상견례", "날짜: 2026-08-03 18:00"],
    unknown: ["가족의 최신 변경 여부는 아직 확인되지 않았어요."],
    nextAction: { label: "일정 열기", href: "/schedule" },
    impact: "확인만 하며 실제 일정이나 외부 서비스는 바꾸지 않아요.",
    choices: [
      { action: "open_source", label: "일정 열기" },
      { action: "snooze", label: "나중에" },
      { action: "dismiss", label: "오늘 닫기" },
      { action: "mute_source", label: "내용이 바뀔 때까지 숨기기" },
    ],
    expiresAt: "2026-08-03T15:00:00.000Z",
  },
};

const BUDGET_READY_RESPONSE = {
  ...READY_RESPONSE,
  card: {
    ...READY_RESPONSE.card,
    sourceKey: "budget:recorded-total-over-total",
    kind: "budget_guardrail",
    whyNow: "직접 기록한 지출 합계가 설정한 총예산보다 커졌어요.",
    confirmed: [
      "설정 총예산: 30,000,000원",
      "기록 지출 합계: 31,000,000원",
    ],
    unknown: [
      "기록 지출은 결제 완료 증빙이 아님",
      "환불·취소·최종 결제 여부는 이 기록만으로 확인되지 않아요.",
    ],
    nextAction: { label: "예산 열기", href: "/budget" },
    choices: [
      { action: "open_source", label: "예산 열기" },
      { action: "snooze", label: "나중에" },
      { action: "dismiss", label: "오늘 닫기" },
      { action: "mute_source", label: "내용이 바뀔 때까지 숨기기" },
    ],
  },
};

type TableResult = { data: unknown; error: unknown };

function query(
  result: TableResult,
  listResult: TableResult = { data: [], error: null },
  likeListResult: TableResult = listResult,
) {
  const builder = {
    select: vi.fn(),
    eq: vi.fn(),
    in: vi.fn(),
    like: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(),
    single: vi.fn().mockResolvedValue(result),
    maybeSingle: vi.fn().mockResolvedValue(result),
  };
  builder.select.mockReturnValue(builder);
  builder.eq.mockReturnValue(builder);
  builder.in.mockReturnValue(builder);
  builder.like.mockReturnValue(builder);
  builder.order.mockReturnValue(builder);
  builder.limit.mockImplementation(() => (
    builder.like.mock.calls.length > 0 ? Promise.resolve(likeListResult) : Promise.resolve(listResult)
  ));
  return builder;
}

function makeClient(options?: {
  userId?: string | null;
  preference?: Record<string, unknown> | null;
  cardState?: Record<string, unknown> | null;
  exposureSignals?: Record<string, unknown>[];
  budgetExposureSignals?: Record<string, unknown>[];
  exposureStates?: Record<string, unknown>[];
  rpcResult?: { data: unknown; error: unknown };
}) {
  const tables = {
    profiles: query({
      data: { couple_id: COUPLE_ID, role: "bride" },
      error: null,
    }),
    couples: query({
      data: { bride_id: USER_ID, groom_id: null },
      error: null,
    }),
    wedding_journeys: query({
      data: {
        wedding_date: "2026-12-01",
        total_budget: 30_000_000,
        progress: {
          __events: [{
            id: "evt-1",
            date: "2026-08-03",
            time: "18:00",
            title: "상견례",
            momentType: "sanggyeonrye",
            status: "planned",
            createdAt: "2026-08-01T00:00:00.000Z",
            updatedAt: "2026-08-01T00:00:00.000Z",
          }],
        },
        state_revision: 7,
      },
      error: null,
    }),
    amora_today_one_preferences: query({
      data: options?.preference ?? {
        enabled: true,
        opted_in_at: "2026-08-01T00:00:00.000Z",
        paused_until: null,
        daily_limit: 1,
      },
      error: null,
    }),
    amora_today_one_recipient_states: query(
      {
        data: options?.cardState ?? {
          id: CARD_ID,
          couple_id: COUPLE_ID,
          recipient_user_id: USER_ID,
          revision: 1,
          source_revision: 7,
          state: "ready",
          claimed_for_date: "2026-08-02",
          expires_at: "2026-08-03T15:00:00.000Z",
        },
        error: null,
      },
      { data: options?.exposureStates ?? [], error: null },
    ),
    amora_today_one_signals: query(
      { data: null, error: null },
      { data: options?.exposureSignals ?? [], error: null },
      { data: options?.budgetExposureSignals ?? [], error: null },
    ),
  };
  const from = vi.fn((name: keyof typeof tables) => tables[name]);
  const rpc = vi.fn().mockResolvedValue(
    options?.rpcResult ?? {
      data: {
        version: 1,
        state: "none",
        recipientUserId: USER_ID,
        claimedForDate: "2026-08-02",
      },
      error: null,
    },
  );
  return {
    client: {
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: options?.userId === null ? null : { id: options?.userId ?? USER_ID } },
        }),
      },
      from,
      rpc,
    },
    from,
    rpc,
    tables,
  };
}

function post(body: unknown) {
  return new Request("http://localhost/api/amora/today-one", {
    method: "POST",
    headers: { "content-type": "application/json", "sec-fetch-site": "same-origin" },
    body: JSON.stringify(body),
  });
}

function get() {
  return new Request("http://localhost/api/amora/today-one", {
    headers: { "sec-fetch-site": "same-origin" },
  });
}

describe("/api/amora/today-one", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isAmoraTodayOneEnabled).mockReturnValue(true);
    vi.mocked(checkRateLimit).mockReturnValue(null);
    vi.mocked(isTrustedMutationRequest).mockReturnValue(true);
  });

  it("keeps the rollout default-off without constructing an admin client", async () => {
    const { client, from } = makeClient();
    vi.mocked(createClientFromRequest).mockResolvedValue(client as never);
    vi.mocked(isAmoraTodayOneEnabled).mockReturnValue(false);

    const response = await GET(new Request("http://localhost/api/amora/today-one"));

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(await response.json()).toEqual({ available: false });
    expect(from).not.toHaveBeenCalled();
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("compiles only a server-derived journey candidate through the service RPC", async () => {
    vi.setSystemTime(new Date("2026-08-02T03:00:00.000Z"));
    const { client } = makeClient();
    vi.mocked(createClientFromRequest).mockResolvedValue(client as never);
    const compile = vi.fn().mockResolvedValue({ data: READY_RESPONSE, error: null });
    vi.mocked(createAdminClient).mockReturnValue({ rpc: compile } as never);

    const response = await GET(get());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ available: true, result: READY_RESPONSE });
    expect(compile).toHaveBeenCalledTimes(1);
    expect(compile).toHaveBeenCalledWith(
      "compile_amora_today_one_card",
      expect.objectContaining({
        p_couple_id: COUPLE_ID,
        p_recipient_user_id: USER_ID,
        p_source_revision: 7,
        p_priority: 110,
        p_presentation: expect.objectContaining({
          kind: "schedule_moment",
          confirmed: ["일정: 상견례", "날짜: 2026-08-03 18:00"],
        }),
      }),
    );
  });

  it("loads total_budget and gives an explicit recorded-spend guardrail priority", async () => {
    vi.setSystemTime(new Date("2026-08-02T03:00:00.000Z"));
    const { client, tables } = makeClient();
    tables.wedding_journeys.single.mockResolvedValueOnce({
      data: {
        wedding_date: "2026-12-01",
        total_budget: 30_000_000,
        progress: {
          venue: {
            status: "in_progress",
            spent: 31_000_000,
            cost: 999_000_000,
          },
          __events: [{
            id: "evt-1",
            date: "2026-08-03",
            time: "18:00",
            title: "상견례",
            momentType: "sanggyeonrye",
            status: "planned",
            createdAt: "2026-08-01T00:00:00.000Z",
            updatedAt: "2026-08-01T00:00:00.000Z",
          }],
        },
        state_revision: 7,
      },
      error: null,
    });
    vi.mocked(createClientFromRequest).mockResolvedValue(client as never);
    const compile = vi.fn().mockResolvedValue({
      data: BUDGET_READY_RESPONSE,
      error: null,
    });
    vi.mocked(createAdminClient).mockReturnValue({ rpc: compile } as never);

    const response = await GET(get());

    expect(response.status).toBe(200);
    expect(tables.wedding_journeys.select).toHaveBeenCalledWith(
      "wedding_date, total_budget, progress, state_revision",
    );
    expect(compile).toHaveBeenCalledTimes(1);
    expect(compile).toHaveBeenCalledWith(
      "compile_amora_today_one_card",
      expect.objectContaining({
        p_source_key: "budget:recorded-total-over-total",
        p_source_revision: 7,
        p_priority: 300,
        p_presentation: expect.objectContaining({
          kind: "budget_guardrail",
          nextAction: { label: "예산 열기", href: "/budget" },
          unknown: expect.arrayContaining(["기록 지출은 결제 완료 증빙이 아님"]),
        }),
      }),
    );
    expect(await response.json()).toEqual({
      available: true,
      result: BUDGET_READY_RESPONSE,
    });
  });

  it("puts an unseen D-1 schedule ahead of an already exposed budget domain", async () => {
    vi.setSystemTime(new Date("2026-08-02T03:00:00.000Z"));
    const budgetSignalId = "40000000-0000-4000-8000-000000000001";
    const { client, tables } = makeClient({
      exposureSignals: [{
        id: budgetSignalId,
        source_key: "budget:recorded-total-over-total",
      }],
      exposureStates: [{
        signal_id: budgetSignalId,
        state_digest: "a".repeat(64),
        claimed_for_date: "2026-08-01",
      }],
    });
    tables.wedding_journeys.single.mockResolvedValueOnce({
      data: {
        wedding_date: "2026-12-01",
        total_budget: 30_000_000,
        progress: {
          venue: { status: "in_progress", spent: 31_000_000 },
          __events: [{
            id: "evt-1",
            date: "2026-08-03",
            time: "18:00",
            title: "상견례",
            momentType: "sanggyeonrye",
            status: "planned",
            createdAt: "2026-08-01T00:00:00.000Z",
            updatedAt: "2026-08-01T00:00:00.000Z",
          }],
        },
        state_revision: 7,
      },
      error: null,
    });
    vi.mocked(createClientFromRequest).mockResolvedValue(client as never);
    const compile = vi.fn().mockResolvedValue({ data: READY_RESPONSE, error: null });
    vi.mocked(createAdminClient).mockReturnValue({ rpc: compile } as never);

    const response = await GET(get());

    expect(response.status).toBe(200);
    expect(compile).toHaveBeenCalledTimes(1);
    expect(compile).toHaveBeenCalledWith(
      "compile_amora_today_one_card",
      expect.objectContaining({
        p_source_key: expect.stringMatching(/^schedule:.+:d1$/),
        p_priority: 110,
      }),
    );
    expect(await response.json()).toEqual({ available: true, result: READY_RESPONSE });
  });

  it("updates today's changed source before trying a different higher-priority candidate", async () => {
    vi.setSystemTime(new Date("2026-08-02T03:00:00.000Z"));
    const scheduleEvent = {
      id: "evt-1",
      date: "2026-08-03",
      time: "19:00",
      title: "상견례",
      momentType: "sanggyeonrye",
      status: "planned",
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-02T01:00:00.000Z",
    };
    const changedSchedule = buildTodayOneScheduleCandidates({
      weddingDate: "2026-12-01",
      progress: { __events: [scheduleEvent] },
      stateRevision: 8,
      now: new Date("2026-08-02T03:00:00.000Z"),
    })[0];
    expect(changedSchedule).toBeDefined();

    const signalId = "40000000-0000-4000-8000-000000000003";
    const { client, tables } = makeClient({
      exposureSignals: [{ id: signalId, source_key: changedSchedule.sourceKey }],
      exposureStates: [{
        signal_id: signalId,
        state_digest: "d".repeat(64),
        claimed_for_date: "2026-08-02",
      }],
    });
    tables.wedding_journeys.single.mockResolvedValueOnce({
      data: {
        wedding_date: "2026-12-01",
        total_budget: 30_000_000,
        progress: {
          venue: { status: "in_progress", spent: 31_000_000 },
          __events: [scheduleEvent],
        },
        state_revision: 8,
      },
      error: null,
    });
    vi.mocked(createClientFromRequest).mockResolvedValue(client as never);
    const compile = vi.fn().mockResolvedValue({ data: READY_RESPONSE, error: null });
    vi.mocked(createAdminClient).mockReturnValue({ rpc: compile } as never);

    const response = await GET(get());

    expect(response.status).toBe(200);
    expect(compile).toHaveBeenCalledTimes(1);
    expect(compile).toHaveBeenCalledWith(
      "compile_amora_today_one_card",
      expect.objectContaining({
        p_source_key: changedSchedule.sourceKey,
        p_state_digest: changedSchedule.sourceStateDigest,
        p_source_revision: 8,
      }),
    );
  });

  it("keeps budget-domain exposure durable when the previously shown source is no longer current", async () => {
    vi.setSystemTime(new Date("2026-08-02T03:00:00.000Z"));
    const oldBudgetSignalId = "40000000-0000-4000-8000-000000000002";
    const { client, tables } = makeClient({
      exposureSignals: [],
      budgetExposureSignals: [{
        id: oldBudgetSignalId,
        source_key: "budget:allocated-total-over-total",
      }],
      exposureStates: [{
        signal_id: oldBudgetSignalId,
        state_digest: "b".repeat(64),
        claimed_for_date: "2026-08-01",
      }],
    });
    tables.wedding_journeys.single.mockResolvedValueOnce({
      data: {
        wedding_date: "2026-12-01",
        total_budget: 30_000_000,
        progress: {
          venue: { status: "in_progress", spent: 31_000_000 },
          __events: [{
            id: "evt-1",
            date: "2026-08-03",
            time: "18:00",
            title: "상견례",
            momentType: "sanggyeonrye",
            status: "planned",
            createdAt: "2026-08-01T00:00:00.000Z",
            updatedAt: "2026-08-01T00:00:00.000Z",
          }],
        },
        state_revision: 7,
      },
      error: null,
    });
    vi.mocked(createClientFromRequest).mockResolvedValue(client as never);
    const compile = vi.fn().mockResolvedValue({ data: READY_RESPONSE, error: null });
    vi.mocked(createAdminClient).mockReturnValue({ rpc: compile } as never);

    const response = await GET(get());

    expect(response.status).toBe(200);
    expect(tables.amora_today_one_signals.like).toHaveBeenCalledWith(
      "source_key",
      "budget:%",
    );
    expect(compile).toHaveBeenCalledTimes(1);
    expect(compile).toHaveBeenCalledWith(
      "compile_amora_today_one_card",
      expect.objectContaining({
        p_source_key: expect.stringMatching(/^schedule:.+:d1$/),
        p_priority: 110,
      }),
    );
  });

  it("blocks a cross-site GET before its durable daily-card claim", async () => {
    const { client, from } = makeClient();
    vi.mocked(createClientFromRequest).mockResolvedValue(client as never);
    vi.mocked(isTrustedMutationRequest).mockReturnValueOnce(false);

    const response = await GET(new Request("http://localhost/api/amora/today-one", {
      headers: { "sec-fetch-site": "cross-site" },
    }));

    expect(response.status).toBe(403);
    expect(from).not.toHaveBeenCalled();
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("rejects a stale client action before the owner RPC", async () => {
    const { client, rpc } = makeClient();
    vi.mocked(createClientFromRequest).mockResolvedValue(client as never);

    const response = await POST(post({
      cardId: CARD_ID,
      expectedRevision: 1,
      expectedSourceRevision: 6,
      action: "dismiss",
    }));

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      code: "TODAY_ONE_SOURCE_STALE",
      error: "일정·예산 기록이나 카드 상태가 바뀌었어요. 최신 내용을 다시 확인해 주세요.",
    });
    expect(rpc).not.toHaveBeenCalled();
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("treats an already-acted card as a stale conflict, not a reusable action", async () => {
    const { client, rpc, tables } = makeClient();
    tables.amora_today_one_recipient_states.maybeSingle.mockResolvedValueOnce({
      data: {
        id: CARD_ID,
        couple_id: COUPLE_ID,
        recipient_user_id: USER_ID,
        revision: 2,
        source_revision: 7,
        state: "dismissed",
        claimed_for_date: "2026-08-02",
        expires_at: "2026-08-03T15:00:00.000Z",
      },
      error: null,
    });
    vi.mocked(createClientFromRequest).mockResolvedValue(client as never);

    const response = await POST(post({
      cardId: CARD_ID,
      expectedRevision: 1,
      expectedSourceRevision: 7,
      action: "dismiss",
    }));

    expect(response.status).toBe(409);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("uses the authenticated owner RPC and waits for its validated result", async () => {
    const { client, rpc } = makeClient();
    vi.mocked(createClientFromRequest).mockResolvedValue(client as never);

    const response = await POST(post({
      cardId: CARD_ID,
      expectedRevision: 1,
      expectedSourceRevision: 7,
      action: "dismiss",
    }));

    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("act_on_amora_today_one_card", {
      p_card_id: CARD_ID,
      p_expected_revision: 1,
      p_expected_source_revision: 7,
      p_action: "dismiss",
    });
    expect(createAdminClient).not.toHaveBeenCalled();
    expect(await response.json()).toMatchObject({
      available: true,
      result: { state: "none", recipientUserId: USER_ID },
    });
  });

  it("rejects untrusted mutations and roster mismatches without writing", async () => {
    const { client, rpc, tables } = makeClient();
    vi.mocked(createClientFromRequest).mockResolvedValue(client as never);
    vi.mocked(isTrustedMutationRequest).mockReturnValueOnce(false);

    const untrusted = await POST(post({
      cardId: CARD_ID,
      expectedRevision: 1,
      expectedSourceRevision: 7,
      action: "dismiss",
    }));
    expect(untrusted.status).toBe(403);

    vi.mocked(isTrustedMutationRequest).mockReturnValue(true);
    tables.couples.single.mockResolvedValueOnce({
      data: { bride_id: "90000000-0000-4000-8000-000000000009", groom_id: null },
      error: null,
    });
    const mismatched = await POST(post({
      cardId: CARD_ID,
      expectedRevision: 1,
      expectedSourceRevision: 7,
      action: "dismiss",
    }));
    expect(mismatched.status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("/api/amora/today-one 의 새 종류(25장 2절)", () => {
  const TASK = {
    id: "act-1",
    title: "청첩장 문구 정하기",
    dueDate: "2026-08-03",
    priority: "normal",
    status: "open",
    source: "amora",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
  };

  function getMore() {
    return new Request("http://localhost/api/amora/today-one?kinds=2", {
      headers: { "sec-fetch-site": "same-origin" },
    });
  }

  function withoutSchedule(tables: ReturnType<typeof makeClient>["tables"]) {
    tables.wedding_journeys.single.mockResolvedValueOnce({
      data: { wedding_date: null, total_budget: null, progress: {}, state_revision: 7 },
      error: null,
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isAmoraTodayOneEnabled).mockReturnValue(true);
    vi.mocked(checkRateLimit).mockReturnValue(null);
    vi.mocked(isTrustedMutationRequest).mockReturnValue(true);
    vi.mocked(loadCoupleContext).mockResolvedValue({
      ok: false,
      status: 503,
      code: "COUPLE_UNAVAILABLE",
      error: "x",
    });
  });

  it("옛 화면(표시 없음)에는 새 종류의 자료를 읽지도 고르지도 않는다", async () => {
    vi.setSystemTime(new Date("2026-08-02T03:00:00.000Z"));
    const { client, tables } = makeClient();
    withoutSchedule(tables);
    vi.mocked(createClientFromRequest).mockResolvedValue(client as never);
    const compile = vi.fn();
    vi.mocked(createAdminClient).mockReturnValue({ rpc: compile } as never);

    const response = await GET(get());

    expect(response.status).toBe(200);
    expect((await response.json()).result.state).toBe("none");
    expect(readAmoraActionSnapshot).not.toHaveBeenCalled();
    expect(loadCoupleContext).not.toHaveBeenCalled();
    expect(compile).not.toHaveBeenCalled();
  });

  it("새 화면에는 내일이 마감인 함께 쓰는 할 일을 정해진 문장과 다음 행동으로 고른다", async () => {
    vi.setSystemTime(new Date("2026-08-02T03:00:00.000Z"));
    const { client, tables } = makeClient();
    withoutSchedule(tables);
    vi.mocked(createClientFromRequest).mockResolvedValue(client as never);
    vi.mocked(readAmoraActionSnapshot).mockResolvedValue({ actions: [TASK] } as never);
    const compile = vi.fn().mockResolvedValue({
      data: { version: 1, state: "none", recipientUserId: USER_ID, claimedForDate: "2026-08-02" },
      error: null,
    });
    vi.mocked(createAdminClient).mockReturnValue({ rpc: compile } as never);

    await GET(getMore());

    expect(readAmoraActionSnapshot).toHaveBeenCalledWith(client, COUPLE_ID, [], "open");
    expect(compile).toHaveBeenCalledTimes(1);
    const args = compile.mock.calls[0][1];
    expect(args.p_priority).toBe(105);
    expect(args.p_source_key).toMatch(/^task:[0-9a-f]{24}:d1$/);
    expect(args.p_presentation).toEqual({
      kind: "task_deadline",
      whyNow: "내일까지 해 둘 할 일이 있어요.",
      confirmed: ["할 일: 청첩장 문구 정하기", "마감: 8월 3일"],
      unknown: ["어디까지 했는지는 할 일 기록만으로는 알 수 없어요."],
      nextAction: { label: "할 일 보기", href: "/lounge" },
      impact: "확인만 하며 할 일이나 일정은 바꾸지 않아요.",
      choices: [
        { action: "open_source", label: "할 일 보기" },
        { action: "snooze", label: "나중에" },
        { action: "dismiss", label: "오늘 닫기" },
        { action: "mute_source", label: "내용이 바뀔 때까지 숨기기" },
      ],
    });
  });

  it("새 종류의 자료를 읽지 못해도 일정 카드는 그대로 고른다", async () => {
    vi.setSystemTime(new Date("2026-08-02T03:00:00.000Z"));
    const { client } = makeClient();
    vi.mocked(createClientFromRequest).mockResolvedValue(client as never);
    vi.mocked(readAmoraActionSnapshot).mockRejectedValue(Object.assign(new Error("down"), { code: "PGRST205" }));
    vi.mocked(loadCoupleContext).mockRejectedValue(new Error("down"));
    const compile = vi.fn().mockResolvedValue({ data: READY_RESPONSE, error: null });
    vi.mocked(createAdminClient).mockReturnValue({ rpc: compile } as never);
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await GET(getMore());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ available: true, result: READY_RESPONSE });
    expect(compile.mock.calls[0][1].p_presentation.kind).toBe("schedule_moment");
    // 로그에는 코드만 남고 내용은 남지 않는다.
    expect(JSON.stringify(errors.mock.calls)).not.toContain("down");
    errors.mockRestore();
  });
});
