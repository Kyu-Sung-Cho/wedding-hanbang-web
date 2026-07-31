// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClientFromRequest } from "@/lib/supabase/server";

import { PATCH } from "./route";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createClientFromRequest: vi.fn(),
}));
vi.mock("@/utils/rateLimit", () => ({
  checkRateLimit: vi.fn(() => null),
  rateLimitKey: vi.fn(() => "payments:update:test"),
}));

const USER_ID = "11111111-1111-4111-8111-111111111111";
const PARTNER_ID = "22222222-2222-4222-8222-222222222222";
const COUPLE_ID = "33333333-3333-4333-8333-333333333333";
const PAYMENT_ID = "44444444-4444-4444-8444-444444444444";

const UPDATE_BODY = {
  itemName: "예식장 계약",
  vendorDisplayName: "한방 웨딩홀",
  categoryKey: "venue",
  contractAmountWon: 20_000_000,
  paidAmountWon: 5_000_000,
  balanceDueDate: "2026-10-01",
  refundableAmountWon: 2_000_000,
  status: "partially_paid",
  evidenceStatus: "provider_written",
  revision: 3,
};

const UPDATED_ROW = {
  id: PAYMENT_ID,
  item_name: "예식장 계약",
  vendor_display_name: "한방 웨딩홀",
  category_key: "venue",
  contract_amount_won: 20_000_000,
  paid_amount_won: 5_000_000,
  balance_amount_won: 15_000_000,
  balance_due_date: "2026-10-01",
  refundable_amount_won: 2_000_000,
  status: "partially_paid",
  evidence_status: "provider_written",
  created_by: USER_ID,
  updated_by: USER_ID,
  revision: 4,
  created_at: "2026-07-31T01:00:00.000Z",
  updated_at: "2026-07-31T02:00:00.000Z",
};

function requestClient() {
  const profile = {
    select: vi.fn(),
    eq: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue({
      data: { couple_id: COUPLE_ID },
      error: null,
    }),
  };
  profile.select.mockReturnValue(profile);
  profile.eq.mockReturnValue(profile);
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: USER_ID } },
        error: null,
      }),
    },
    from: vi.fn(() => profile),
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

function updateRequest(body = UPDATE_BODY) {
  return new Request(
    `https://hanbang.test/api/payments/${PAYMENT_ID}`,
    {
      method: "PATCH",
      headers: {
        origin: "https://hanbang.test",
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );
}

function context(id = PAYMENT_ID) {
  return { params: Promise.resolve({ id }) };
}

describe("PATCH /api/payments/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("WEDDING_PAYMENT_LEDGER_ENABLED", "true");
    vi.mocked(createClientFromRequest).mockResolvedValue(
      requestClient() as never,
    );
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("fails closed before auth or service access when rollout is not exact true", async () => {
    vi.stubEnv("WEDDING_PAYMENT_LEDGER_ENABLED", "1");

    const response = await PATCH(updateRequest(), context());

    expect(response.status).toBe(404);
    expect(createClientFromRequest).not.toHaveBeenCalled();
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("passes verified scope and revision to the atomic mutation RPC", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: UPDATED_ROW,
      error: null,
    });
    vi.mocked(createAdminClient).mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === "couples") return coupleQuery();
        throw new Error(`unexpected table ${table}`);
      }),
      rpc,
    } as never);

    const response = await PATCH(updateRequest(), context());
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith(
      "update_wedding_payment_ledger",
      expect.objectContaining({
        p_user_id: USER_ID,
        p_couple_id: COUPLE_ID,
        p_entry_id: PAYMENT_ID,
        p_expected_revision: 3,
        p_paid_amount_won: 5_000_000,
      }),
    );
    expect(payload.payment).toMatchObject({
      id: PAYMENT_ID,
      balanceAmountWon: 15_000_000,
      revision: 4,
    });
  });

  it("returns a conflict without overwriting after a stale revision", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: {
        code: "40001",
        message: "PAYMENT_LEDGER_REVISION_CONFLICT",
      },
    });
    vi.mocked(createAdminClient).mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === "couples") return coupleQuery();
        throw new Error(`unexpected table ${table}`);
      }),
      rpc,
    } as never);

    const response = await PATCH(updateRequest(), context());
    const payload = await response.json();

    expect(response.status).toBe(409);
    expect(payload.code).toBe("PAYMENT_LEDGER_REVISION_CONFLICT");
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("has no destructive method and rejects an invalid id before service access", async () => {
    const routeExports = await import("./route");
    expect("DELETE" in routeExports).toBe(false);

    const response = await PATCH(updateRequest(), context("not-an-id"));
    expect(response.status).toBe(400);
    expect(createAdminClient).not.toHaveBeenCalled();
  });
});
