// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClientFromRequest } from "@/lib/supabase/server";

import { GET, POST } from "./route";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createClientFromRequest: vi.fn(),
}));
vi.mock("@/utils/rateLimit", () => ({
  checkRateLimit: vi.fn(() => null),
  rateLimitKey: vi.fn(() => "payments:test"),
}));

const USER_ID = "11111111-1111-4111-8111-111111111111";
const PARTNER_ID = "22222222-2222-4222-8222-222222222222";
const COUPLE_ID = "33333333-3333-4333-8333-333333333333";
const PAYMENT_ID = "44444444-4444-4444-8444-444444444444";

const PAYMENT_ROW = {
  id: PAYMENT_ID,
  item_name: "예식장 계약",
  vendor_display_name: "한방 웨딩홀",
  category_key: "venue",
  contract_amount_won: 20_000_000,
  paid_amount_won: 2_000_000,
  balance_amount_won: 18_000_000,
  balance_due_date: "2026-10-01",
  refundable_amount_won: 1_000_000,
  status: "partially_paid",
  evidence_status: "provider_written",
  created_by: USER_ID,
  updated_by: USER_ID,
  revision: 1,
  created_at: "2026-07-31T01:00:00.000Z",
  updated_at: "2026-07-31T01:00:00.000Z",
};

const VALID_BODY = {
  clientRequestId: "55555555-5555-4555-8555-555555555555",
  itemName: "예식장 계약",
  vendorDisplayName: "한방 웨딩홀",
  categoryKey: "venue",
  contractAmountWon: 20_000_000,
  paidAmountWon: 2_000_000,
  balanceDueDate: "2026-10-01",
  refundableAmountWon: 1_000_000,
  status: "partially_paid",
  evidenceStatus: "provider_written",
};

function requestClient(options: {
  userId?: string | null;
  coupleId?: string | null;
}, paymentQuery?: unknown) {
  const profileQuery = {
    select: vi.fn(),
    eq: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue({
      data: options.coupleId === undefined
        ? { couple_id: COUPLE_ID }
        : options.coupleId === null
          ? { couple_id: null }
          : { couple_id: options.coupleId },
      error: null,
    }),
  };
  profileQuery.select.mockReturnValue(profileQuery);
  profileQuery.eq.mockReturnValue(profileQuery);
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: {
          user: options.userId === null
            ? null
            : { id: options.userId ?? USER_ID },
        },
        error: null,
      }),
    },
    from: vi.fn((table: string) => {
      if (table === "profiles") return profileQuery;
      if (table === "wedding_payment_ledger" && paymentQuery) {
        return paymentQuery;
      }
      throw new Error(`unexpected table ${table}`);
    }),
  };
}

function coupleQuery() {
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue({
      data: {
        id: COUPLE_ID,
        bride_id: USER_ID,
        groom_id: PARTNER_ID,
      },
      error: null,
    }),
  };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  return query;
}

function sameOriginRequest(
  method: "GET" | "POST",
  body?: Record<string, unknown>,
) {
  return new Request("https://hanbang.test/api/payments", {
    method,
    headers: {
      origin: "https://hanbang.test",
      "content-type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

describe("/api/payments collection boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("WEDDING_PAYMENT_LEDGER_ENABLED", "true");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("fails closed before auth or service access when the rollout flag is off", async () => {
    vi.stubEnv("WEDDING_PAYMENT_LEDGER_ENABLED", "TRUE");

    const getResponse = await GET(sameOriginRequest("GET"));
    const postResponse = await POST(sameOriginRequest("POST", VALID_BODY));

    expect(getResponse.status).toBe(404);
    expect(postResponse.status).toBe(404);
    expect(createClientFromRequest).not.toHaveBeenCalled();
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("does not create a service client before authentication", async () => {
    vi.mocked(createClientFromRequest).mockResolvedValue(
      requestClient({ userId: null }) as never,
    );

    const response = await GET(sameOriginRequest("GET"));

    expect(response.status).toBe(401);
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("lists only the server-verified couple and maps audit identities to flags", async () => {
    const listQuery = {
      select: vi.fn(),
      eq: vi.fn(),
      order: vi.fn(),
      limit: vi.fn().mockResolvedValue({
        data: [PAYMENT_ROW],
        error: null,
      }),
    };
    listQuery.select.mockReturnValue(listQuery);
    listQuery.eq.mockReturnValue(listQuery);
    listQuery.order.mockReturnValue(listQuery);
    const couples = coupleQuery();
    vi.mocked(createClientFromRequest).mockResolvedValue(
      requestClient({}, listQuery) as never,
    );
    vi.mocked(createAdminClient).mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === "couples") return couples;
        throw new Error(`unexpected table ${table}`);
      }),
    } as never);

    const response = await GET(sameOriginRequest("GET"));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(listQuery.eq).toHaveBeenCalledWith("couple_id", COUPLE_ID);
    expect(payload.payments).toEqual([
      expect.objectContaining({
        id: PAYMENT_ID,
        balanceAmountWon: 18_000_000,
        createdByMe: true,
        updatedByMe: true,
      }),
    ]);
    expect(JSON.stringify(payload)).not.toContain(USER_ID);
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("creates from verified identities and never accepts body identity fields", async () => {
    const couples = coupleQuery();
    const rpc = vi.fn().mockResolvedValue({
      data: PAYMENT_ROW,
      error: null,
    });

    vi.mocked(createClientFromRequest).mockResolvedValue(
      requestClient({}) as never,
    );
    vi.mocked(createAdminClient).mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === "couples") return couples;
        throw new Error(`unexpected table ${table}`);
      }),
      rpc,
    } as never);

    const response = await POST(sameOriginRequest("POST", VALID_BODY));
    expect(response.status).toBe(201);
    expect(rpc).toHaveBeenCalledWith(
      "create_wedding_payment_ledger",
      expect.objectContaining({
        p_user_id: USER_ID,
        p_couple_id: COUPLE_ID,
        p_client_request_id: VALID_BODY.clientRequestId,
        p_contract_amount_won: 20_000_000,
        p_paid_amount_won: 2_000_000,
      }),
    );

    vi.clearAllMocks();
    vi.mocked(createClientFromRequest).mockResolvedValue(
      requestClient({}) as never,
    );
    vi.mocked(createAdminClient).mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === "couples") return coupleQuery();
        throw new Error(`unexpected table ${table}`);
      }),
      rpc,
    } as never);
    const rejected = await POST(sameOriginRequest("POST", {
      ...VALID_BODY,
      coupleId: "55555555-5555-4555-8555-555555555555",
      userId: "66666666-6666-4666-8666-666666666666",
    }));
    expect(rejected.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("blocks cross-origin writes before authentication", async () => {
    const response = await POST(new Request(
      "https://hanbang.test/api/payments",
      {
        method: "POST",
        headers: {
          origin: "https://attacker.test",
          "content-type": "application/json",
        },
        body: JSON.stringify(VALID_BODY),
      },
    ));

    expect(response.status).toBe(403);
    expect(createClientFromRequest).not.toHaveBeenCalled();
    expect(createAdminClient).not.toHaveBeenCalled();
  });
});
