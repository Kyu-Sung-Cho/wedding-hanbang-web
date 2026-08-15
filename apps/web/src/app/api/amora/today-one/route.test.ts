import { beforeEach, describe, expect, it, vi } from "vitest";
import { validateTodayOneCareLegacyResponse } from "@hanbang/shared";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClientFromRequest } from "@/lib/supabase/server";
import { isAmoraTodayOneEnabled } from "@/lib/features/amoraCareFlags";
import { buildTodayOneScheduleCandidates } from "@/lib/care/todayOne";
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

const DECISION_READY_RESPONSE = {
  ...READY_RESPONSE,
  card: {
    ...READY_RESPONSE.card,
    sourceRevision: 8,
    sourceKey: "decision:50000000-0000-4000-8000-000000000001",
    kind: "decision_follow_up",
    whyNow: "직접 확인한 결정이 반영된 뒤 하루가 지났어요. 지금도 이대로 진행할지 확인해 보세요.",
    confirmed: ["결정: 총예산을 3천만원으로 확정"],
    unknown: [],
    nextAction: { label: "예산 열기", href: "/budget" },
    impact: "확인만 하며 예산·일정·체크리스트를 자동으로 바꾸지 않아요.",
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
  decisions?: Record<string, unknown>[];
  privacyEpochs?: number[];
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
    decision_nodes: query(
      { data: null, error: null },
      { data: options?.decisions ?? [], error: null },
    ),
  };
  const from = vi.fn((name: keyof typeof tables) => tables[name]);
  const privacyEpochs = [...(options?.privacyEpochs ?? [5, 5])];
  const rpc = vi.fn().mockImplementation((name: string) => Promise.resolve(
    name === "get_own_amora_privacy_epoch"
      ? { data: privacyEpochs.shift() ?? 5, error: null }
      : options?.rpcResult ?? {
      data: {
        version: 1,
        state: "none",
        recipientUserId: USER_ID,
        claimedForDate: "2026-08-02",
      },
      error: null,
    },
  ));
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
    headers: {
      "content-type": "application/json",
      "sec-fetch-site": "same-origin",
      "x-amora-today-one-contract-version": "2",
    },
    body: JSON.stringify(body),
  });
}

function get() {
  return new Request("http://localhost/api/amora/today-one", {
    headers: {
      "sec-fetch-site": "same-origin",
      "x-amora-today-one-contract-version": "2",
    },
  });
}

function legacyGet() {
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

  it("returns structured schedule care without changing the frozen RPC presentation", async () => {
    vi.setSystemTime(new Date("2026-08-02T03:00:00.000Z"));
    const { client } = makeClient();
    vi.mocked(createClientFromRequest).mockResolvedValue(client as never);
    const scheduleCandidate = buildTodayOneScheduleCandidates({
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
      stateRevision: 7,
      now: new Date("2026-08-02T03:00:00.000Z"),
    })[0];
    expect(scheduleCandidate).toBeDefined();
    const rpcReady = {
      ...READY_RESPONSE,
      card: { ...READY_RESPONSE.card, sourceKey: scheduleCandidate.sourceKey },
    };
    const compile = vi.fn().mockResolvedValue({ data: rpcReady, error: null });
    vi.mocked(createAdminClient).mockReturnValue({ rpc: compile } as never);

    const response = await GET(get());

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      available: true,
      result: {
        version: 2,
        card: {
          sourceKey: scheduleCandidate.sourceKey,
          care: {
            momentType: "sanggyeonrye",
            attentionWindow: "d1",
            checklist: expect.arrayContaining(["예약·참석 인원 최종 확인"]),
            relatedChecklist: { categoryKey: "meeting" },
          },
        },
      },
    });
    expect(compile).toHaveBeenCalledTimes(2);
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
    const compileArgs = compile.mock.calls.find(([name]) => (
      name === "compile_amora_today_one_card"
    ))?.[1] as { p_presentation?: Record<string, unknown> } | undefined;
    expect(compileArgs?.p_presentation).not.toHaveProperty("care");
    expect(Object.keys(compileArgs?.p_presentation ?? {}).sort()).toEqual([
      "choices",
      "confirmed",
      "impact",
      "kind",
      "nextAction",
      "unknown",
      "whyNow",
    ]);
    expect(JSON.stringify(body.result.card.care)).not.toMatch(/계약|추가금|해지|위약|환불/);
  });

  it("projects a headerless schedule response to the frozen v1 shape", async () => {
    vi.setSystemTime(new Date("2026-08-02T03:00:00.000Z"));
    const { client } = makeClient();
    vi.mocked(createClientFromRequest).mockResolvedValue(client as never);
    const scheduleCandidate = buildTodayOneScheduleCandidates({
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
      stateRevision: 7,
      now: new Date("2026-08-02T03:00:00.000Z"),
    })[0];
    expect(scheduleCandidate).toBeDefined();
    const compile = vi.fn().mockResolvedValue({
      data: {
        ...READY_RESPONSE,
        card: { ...READY_RESPONSE.card, sourceKey: scheduleCandidate.sourceKey },
      },
      error: null,
    });
    vi.mocked(createAdminClient).mockReturnValue({ rpc: compile } as never);

    const response = await GET(legacyGet());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.result.version).toBe(1);
    expect(body.result.card).not.toHaveProperty("care");
    expect(validateTodayOneCareLegacyResponse(body.result, USER_ID)).toMatchObject({
      ok: true,
    });
  });

  it("does not inspect or expose decision follow-ups to a headerless v1 client", async () => {
    const { client, tables } = makeClient({ decisions: [{ id: CARD_ID }] });
    tables.wedding_journeys.single.mockResolvedValueOnce({
      data: {
        wedding_date: null,
        total_budget: null,
        progress: {},
        state_revision: 8,
      },
      error: null,
    });
    vi.mocked(createClientFromRequest).mockResolvedValue(client as never);

    const response = await GET(legacyGet());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      available: true,
      result: {
        version: 1,
        state: "none",
        recipientUserId: USER_ID,
        claimedForDate: expect.any(String),
      },
    });
    expect(tables.decision_nodes.select).not.toHaveBeenCalled();
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("rejects an unsupported response contract before claiming a card", async () => {
    const { client } = makeClient();
    vi.mocked(createClientFromRequest).mockResolvedValue(client as never);

    const response = await GET(new Request("http://localhost/api/amora/today-one", {
      headers: {
        "sec-fetch-site": "same-origin",
        "x-amora-today-one-contract-version": "99",
      },
    }));

    expect(response.status).toBe(426);
    await expect(response.json()).resolves.toMatchObject({
      code: "TODAY_ONE_CONTRACT_UNSUPPORTED",
    });
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("returns the D+1 family-greeting question through the consumer API", async () => {
    vi.setSystemTime(new Date("2026-08-02T03:00:00.000Z"));
    const familyEvent = {
      id: "evt-family",
      date: "2026-08-01",
      time: "18:00",
      title: "가족 첫인사",
      momentType: "family_greeting",
      status: "planned",
      createdAt: "2026-07-31T00:00:00.000Z",
      updatedAt: "2026-07-31T00:00:00.000Z",
    };
    const { client, tables } = makeClient();
    tables.wedding_journeys.single.mockResolvedValueOnce({
      data: {
        wedding_date: "2026-12-01",
        total_budget: null,
        progress: { __events: [familyEvent] },
        state_revision: 7,
      },
      error: null,
    });
    vi.mocked(createClientFromRequest).mockResolvedValue(client as never);
    const scheduleCandidate = buildTodayOneScheduleCandidates({
      progress: { __events: [familyEvent] },
      stateRevision: 7,
      now: new Date("2026-08-02T03:00:00.000Z"),
    })[0];
    expect(scheduleCandidate).toBeDefined();
    const compile = vi.fn().mockResolvedValue({
      data: {
        ...READY_RESPONSE,
        card: {
          ...READY_RESPONSE.card,
          sourceKey: scheduleCandidate.sourceKey,
        },
      },
      error: null,
    });
    vi.mocked(createAdminClient).mockReturnValue({ rpc: compile } as never);

    const response = await GET(get());
    const body = await response.json();

    expect({ status: response.status, body }).toMatchObject({
      status: 200,
      body: {
        available: true,
        result: {
          card: {
            care: {
              momentType: "family_greeting",
              attentionWindow: "dAfter",
              checklist: [],
              question: "분위기는 어땠어? 다음 만남에도 참고하고 싶은 호칭이나 취향이 있었다면, 저장해도 되는 내용만 알려줘.",
              relatedBudget: {
                categoryKey: "meeting",
                categoryLabel: "부모님 첫 만남",
              },
            },
          },
        },
      },
    });
  });

  it("returns dress fitting D-1 care without exposing budget fields to the compiler or consumer", async () => {
    vi.setSystemTime(new Date("2026-08-02T03:00:00.000Z"));
    const dressEvent = {
      id: "evt-dress-fitting",
      date: "2026-08-03",
      time: "18:00",
      title: "드레스 수선·최종 확인",
      categoryKey: "dress",
      momentType: "dress_fitting",
      status: "planned",
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-01T00:00:00.000Z",
    };
    const { client, tables } = makeClient();
    tables.wedding_journeys.single.mockResolvedValueOnce({
      data: {
        wedding_date: "2026-12-01",
        total_budget: null,
        progress: { __events: [dressEvent] },
        state_revision: 7,
      },
      error: null,
    });
    vi.mocked(createClientFromRequest).mockResolvedValue(client as never);
    const scheduleCandidate = buildTodayOneScheduleCandidates({
      progress: { __events: [dressEvent] },
      stateRevision: 7,
      now: new Date("2026-08-02T03:00:00.000Z"),
    })[0];
    expect(scheduleCandidate).toBeDefined();
    const compile = vi.fn().mockResolvedValue({
      data: {
        ...READY_RESPONSE,
        card: {
          ...READY_RESPONSE.card,
          sourceKey: scheduleCandidate.sourceKey,
          whyNow: scheduleCandidate.whyNow,
          confirmed: scheduleCandidate.confirmed,
        },
      },
      error: null,
    });
    vi.mocked(createAdminClient).mockReturnValue({ rpc: compile } as never);

    const response = await GET(get());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(compile).toHaveBeenCalledWith(
      "compile_amora_today_one_card",
      expect.objectContaining({
        p_source_key: scheduleCandidate.sourceKey,
        p_priority: 100,
        p_presentation: expect.not.objectContaining({ care: expect.anything() }),
      }),
    );
    expect(body).toMatchObject({
      available: true,
      result: {
        card: {
          care: {
            momentType: "dress_fitting",
            attentionWindow: "d1",
            guidance: "내일 드레스 수선 상태를 확인해. 입어보기만 하지 말고 실제로 움직여보자.",
            checklist: expect.arrayContaining(["앉기·걷기·팔 들기 테스트"]),
            relatedChecklist: {
              categoryKey: "dress",
              categoryLabel: "드레스·예식 정장",
            },
          },
        },
      },
    });
    expect(body.result.card.care).not.toHaveProperty("relatedBudget");
    expect(body.result.card.care).not.toHaveProperty("question");
    expect(JSON.stringify(body.result.card.care)).not.toMatch(/계약|추가금|해지|위약|환불|예산/);
  });

  it("maps a v2 race detected inside the v1 compile transaction to the daily limit", async () => {
    vi.setSystemTime(new Date("2026-08-02T03:00:00.000Z"));
    const { client } = makeClient();
    vi.mocked(createClientFromRequest).mockResolvedValue(client as never);
    const rpc = vi.fn().mockImplementation((name: string) => Promise.resolve(
      name === "assert_amora_today_one_v1_claim_available_v2"
        ? { data: null, error: null }
        : {
            data: null,
            error: {
              code: "P0001",
              message: "AMORA_TODAY_ONE_DAILY_LIMIT_V2",
            },
          },
    ));
    vi.mocked(createAdminClient).mockReturnValue({ rpc } as never);

    const response = await GET(get());

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      available: true,
      result: { state: "daily_limit", recipientUserId: USER_ID },
    });
    expect(rpc).toHaveBeenCalledWith(
      "compile_amora_today_one_card",
      expect.any(Object),
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
    expect(compile).toHaveBeenCalledTimes(2);
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
      result: { ...BUDGET_READY_RESPONSE, version: 2 },
    });
  });

  it("compiles a follow-up only from a current-roster confirmed shared decision receipt", async () => {
    vi.setSystemTime(new Date("2026-08-12T03:00:00.000Z"));
    const requestId = "60000000-0000-4000-8000-000000000001";
    const groomId = "10000000-0000-4000-8000-000000000002";
    const confirmedAt = "2026-08-10T00:00:00.000Z";
    const { client, tables } = makeClient({
      decisions: [{
        id: "50000000-0000-4000-8000-000000000001",
        couple_id: COUPLE_ID,
        visibility: "shared",
        decision_type: "decided",
        title: "총예산을 3천만원으로 확정",
        source_ref_id: requestId,
        source_actor_role: "bride",
        user_confirmed_at: confirmedAt,
        decided_at: confirmedAt,
        superseded_at: null,
        metadata: {
          origin: "couple_plan_change_request",
          requestId,
          changeDigest: "a".repeat(64),
          rosterFingerprint: "b".repeat(32),
          expectedRevision: 7,
          appliedRevision: 8,
          requiredCount: 2,
          acceptances: [
            { userId: USER_ID, acceptedAt: confirmedAt },
            { userId: groomId, acceptedAt: confirmedAt },
          ],
          surfaceHref: "/budget",
        },
      }],
    });
    tables.couples.single.mockResolvedValueOnce({
      data: { bride_id: USER_ID, groom_id: groomId },
      error: null,
    });
    tables.wedding_journeys.single.mockResolvedValueOnce({
      data: {
        wedding_date: "2026-12-01",
        total_budget: null,
        progress: {},
        state_revision: 8,
      },
      error: null,
    });
    vi.mocked(createClientFromRequest).mockResolvedValue(client as never);
    const compile = vi.fn().mockResolvedValue({
      data: DECISION_READY_RESPONSE,
      error: null,
    });
    vi.mocked(createAdminClient).mockReturnValue({ rpc: compile } as never);

    const response = await GET(get());

    expect(response.status).toBe(200);
    expect(tables.decision_nodes.select).toHaveBeenCalledWith(
      "id, couple_id, visibility, decision_type, title, source_ref_id, source_actor_role, user_confirmed_at, decided_at, superseded_at, metadata",
    );
    expect(compile).toHaveBeenCalledWith(
      "compile_amora_decision_follow_up_card",
      expect.objectContaining({
        p_decision_id: "50000000-0000-4000-8000-000000000001",
        p_expected_privacy_epoch: 5,
        p_source_revision: 8,
        p_priority: 80,
        p_presentation: expect.objectContaining({
          kind: "decision_follow_up",
          confirmed: ["결정: 총예산을 3천만원으로 확정"],
        }),
      }),
    );
    expect(await response.json()).toEqual({
      available: true,
      result: { ...DECISION_READY_RESPONSE, version: 2 },
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
    expect(compile).toHaveBeenCalledTimes(2);
    expect(compile).toHaveBeenCalledWith(
      "compile_amora_today_one_card",
      expect.objectContaining({
        p_source_key: expect.stringMatching(/^schedule:.+:d1$/),
        p_priority: 110,
      }),
    );
    expect(await response.json()).toEqual({
      available: true,
      result: { ...READY_RESPONSE, version: 2 },
    });
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
    expect(compile).toHaveBeenCalledTimes(2);
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
    expect(compile).toHaveBeenCalledTimes(2);
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
