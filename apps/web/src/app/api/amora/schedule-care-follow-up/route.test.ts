import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  HANBANG_EXPECTED_ACTOR_USER_ID_HEADER,
  HANBANG_MUTATION_CONTRACT_VERSION,
  HANBANG_MUTATION_CONTRACT_VERSION_HEADER,
} from "@hanbang/shared";

import { createClientFromRequest } from "@/lib/supabase/server";
import { isAmoraTodayOneEnabled } from "@/lib/features/amoraCareFlags";
import { buildTodayOneScheduleCandidates } from "@/lib/care/todayOne";
import { checkRateLimit } from "@/utils/rateLimit";
import { GET } from "./route";

vi.mock("@/lib/supabase/server", () => ({ createClientFromRequest: vi.fn() }));
vi.mock("@/lib/features/amoraCareFlags", () => ({
  isAmoraTodayOneEnabled: vi.fn(() => true),
}));
vi.mock("@/utils/rateLimit", () => ({
  checkRateLimit: vi.fn(() => null),
  rateLimitKey: vi.fn(() => "schedule-care-follow-up:test"),
}));

const USER_ID = "00000000-0000-4000-8000-000000000001";
const PARTNER_ID = "00000000-0000-4000-8000-000000000002";
const COUPLE_ID = "10000000-0000-4000-8000-000000000001";
const CARD_ID = "20000000-0000-4000-8000-000000000001";
const SIGNAL_ID = "30000000-0000-4000-8000-000000000001";
const NOW = new Date("2026-08-15T01:00:00.000Z");
const EXPIRES_AT = "2026-08-15T15:00:00.000Z";

const journey = {
  wedding_date: "2027-04-10",
  state_revision: 7,
  progress: {
    __events: [{
      id: "schedule-event-sanggyeonrye",
      date: "2026-08-14",
      time: "12:30",
      title: "상견례",
      momentType: "sanggyeonrye",
      status: "completed",
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-14T05:00:00.000Z",
    }],
  },
};
function buildFixtureCandidate() {
  const value = buildTodayOneScheduleCandidates({
    weddingDate: journey.wedding_date,
    progress: journey.progress,
    stateRevision: journey.state_revision,
    now: NOW,
  }).find(({ attentionWindow }) => attentionWindow === "dAfter");
  if (!value) throw new Error("test fixture must compile a D+1 candidate");
  return value;
}
const candidate = buildFixtureCandidate();

function query(data: unknown, error: unknown = null) {
  const chain = {
    select: vi.fn(),
    eq: vi.fn(),
    single: vi.fn(async () => ({ data, error })),
    maybeSingle: vi.fn(async () => ({ data, error })),
  };
  chain.select.mockReturnValue(chain);
  chain.eq.mockReturnValue(chain);
  return chain;
}

type ClientOptions = {
  userId?: string | null;
  profile?: unknown;
  profileError?: unknown;
  couple?: unknown;
  privacyEpoch?: unknown;
  privacyError?: unknown;
  journey?: unknown;
  card?: unknown;
  signal?: unknown;
};

function installClient(options: ClientOptions = {}) {
  const defaultCard = {
    id: CARD_ID,
    signal_id: SIGNAL_ID,
    couple_id: COUPLE_ID,
    recipient_user_id: USER_ID,
    revision: 2,
    source_revision: 7,
    state_digest: candidate.sourceStateDigest,
    state: "ready",
    claimed_for_date: "2026-08-15",
    expires_at: EXPIRES_AT,
  };
  const defaultSignal = {
    id: SIGNAL_ID,
    couple_id: COUPLE_ID,
    recipient_user_id: USER_ID,
    source_key: candidate.sourceKey,
    state_digest: candidate.sourceStateDigest,
    source_revision: 7,
    kind: "schedule_moment",
    muted_at: null,
  };
  const tables = {
    profiles: query(
      options.profile ?? { couple_id: COUPLE_ID, role: "bride" },
      options.profileError,
    ),
    couples: query(options.couple ?? { bride_id: USER_ID, groom_id: PARTNER_ID }),
    wedding_journeys: query(options.journey ?? journey),
    amora_today_one_recipient_states: query(options.card ?? defaultCard),
    amora_today_one_signals: query(options.signal ?? defaultSignal),
  };
  const userId = options.userId === undefined ? USER_ID : options.userId;
  const client = {
    auth: {
      getUser: vi.fn(async () => ({ data: { user: userId ? { id: userId } : null } })),
    },
    from: vi.fn((table: keyof typeof tables) => tables[table]),
    rpc: vi.fn(async () => ({
      data: options.privacyEpoch ?? 5,
      error: options.privacyError ?? null,
    })),
  };
  vi.mocked(createClientFromRequest).mockResolvedValue(client as never);
  return client;
}

function request(
  queryString = `cardId=${CARD_ID}&cardRevision=2&sourceRevision=7`,
  actor = USER_ID,
) {
  return new Request(
    `http://localhost/api/amora/schedule-care-follow-up?${queryString}`,
    {
      headers: {
        "sec-fetch-site": "same-origin",
        [HANBANG_MUTATION_CONTRACT_VERSION_HEADER]: HANBANG_MUTATION_CONTRACT_VERSION,
        [HANBANG_EXPECTED_ACTOR_USER_ID_HEADER]: actor,
      },
    },
  );
}

describe("GET /api/amora/schedule-care-follow-up", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    vi.mocked(isAmoraTodayOneEnabled).mockReturnValue(true);
    vi.mocked(checkRateLimit).mockReturnValue(null);
    installClient();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("returns only the current owner-bound canonical private D+1 preview", async () => {
    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    expect(response.headers.get("vary")).toContain("Authorization");
    const body = await response.json();
    expect(body).toEqual({
      version: 1,
      state: "ready",
      recipientUserId: USER_ID,
      coupleId: COUPLE_ID,
      binding: {
        cardId: CARD_ID,
        cardRevision: 2,
        sourceRevision: 7,
      },
      expiresAt: EXPIRES_AT,
      prompt: expect.any(String),
    });
    expect(body.prompt).toContain("실제로 합의된 내용");
    expect(body.prompt).toMatch(/\n\n내 답:$/u);
  });

  it.each([
    ["extra query", `cardId=${CARD_ID}&cardRevision=2&sourceRevision=7&eventTitle=x`],
    ["duplicate query", `cardId=${CARD_ID}&cardId=${CARD_ID}&cardRevision=2&sourceRevision=7`],
    ["non-canonical revision", `cardId=${CARD_ID}&cardRevision=02&sourceRevision=7`],
    ["negative source revision", `cardId=${CARD_ID}&cardRevision=2&sourceRevision=-1`],
  ])("rejects an %s before authentication", async (_label, queryString) => {
    const response = await GET(request(queryString));

    expect(response.status).toBe(400);
    expect(createClientFromRequest).not.toHaveBeenCalled();
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("rejects cross-site and account-switched reads before source resolution", async () => {
    const crossSite = new Request(
      `http://localhost/api/amora/schedule-care-follow-up?cardId=${CARD_ID}&cardRevision=2&sourceRevision=7`,
      {
        headers: {
          origin: "https://attacker.invalid",
          "sec-fetch-site": "cross-site",
          [HANBANG_MUTATION_CONTRACT_VERSION_HEADER]: HANBANG_MUTATION_CONTRACT_VERSION,
          [HANBANG_EXPECTED_ACTOR_USER_ID_HEADER]: USER_ID,
        },
      },
    );
    expect((await GET(crossSite)).status).toBe(403);
    expect(createClientFromRequest).not.toHaveBeenCalled();

    const switched = await GET(request(
      undefined,
      "00000000-0000-4000-8000-000000000099",
    ));
    expect(switched.status).toBe(409);
  });

  it("requires current authentication and the strict actor contract", async () => {
    installClient({ userId: null });
    expect((await GET(request())).status).toBe(401);

    installClient();
    const legacy = new Request(
      `http://localhost/api/amora/schedule-care-follow-up?cardId=${CARD_ID}&cardRevision=2&sourceRevision=7`,
      { headers: { "sec-fetch-site": "same-origin" } },
    );
    expect((await GET(legacy)).status).toBe(426);
  });

  it("reports an unavailable current-profile read as retryable infrastructure failure", async () => {
    installClient({ profileError: { code: "PGRST_TIMEOUT" } });

    const response = await GET(request());

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      code: "SCHEDULE_CARE_FOLLOW_UP_UNAVAILABLE",
      retryable: true,
      retryPolicy: "same_request",
    });
  });

  it.each([
    [
      "profile couple",
      {
        profile: {
          couple_id: "10000000-0000-4000-8000-000000000099",
          role: "bride",
        },
      },
      409,
    ],
    [
      "roster",
      { couple: { bride_id: PARTNER_ID, groom_id: null } },
      403,
    ],
    [
      "privacy",
      { privacyError: { code: "PGRST" } },
      503,
    ],
    [
      "journey revision",
      { journey: { ...journey, state_revision: 8 } },
      409,
    ],
    [
      "card expiry",
      {
        card: {
          id: CARD_ID,
          signal_id: SIGNAL_ID,
          couple_id: COUPLE_ID,
          recipient_user_id: USER_ID,
          revision: 2,
          source_revision: 7,
          state_digest: candidate.sourceStateDigest,
          state: "ready",
          claimed_for_date: "2026-08-15",
          expires_at: "2026-08-15T00:59:59.999Z",
        },
      },
      409,
    ],
    [
      "card revision",
      {
        card: {
          id: CARD_ID,
          signal_id: SIGNAL_ID,
          couple_id: COUPLE_ID,
          recipient_user_id: USER_ID,
          revision: 3,
          source_revision: 7,
          state_digest: candidate.sourceStateDigest,
          state: "ready",
          claimed_for_date: "2026-08-15",
          expires_at: EXPIRES_AT,
        },
      },
      409,
    ],
    [
      "signal",
      {
        signal: {
          id: SIGNAL_ID,
          couple_id: COUPLE_ID,
          recipient_user_id: USER_ID,
          source_key: candidate.sourceKey,
          state_digest: "b".repeat(64),
          source_revision: 7,
          kind: "schedule_moment",
          muted_at: null,
        },
      },
      409,
    ],
    [
      "recomputed moment",
      { journey: { ...journey, progress: {} } },
      409,
    ],
  ] as const)("fails closed when %s context changed", async (_label, options, status) => {
    installClient(options);
    const response = await GET(request());

    expect(response.status).toBe(status);
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("keeps a rate-limit response private and skips source reads", async () => {
    const rateLimited = new Response(JSON.stringify({ code: "RATE_LIMITED" }), {
      status: 429,
      headers: { "content-type": "application/json" },
    });
    vi.mocked(checkRateLimit).mockReturnValue(rateLimited as never);
    const client = installClient();

    const response = await GET(request());

    expect(response.status).toBe(429);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(client.rpc).not.toHaveBeenCalled();
  });
});
