import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  createClientFromRequest: vi.fn(),
  checkRateLimitPersistent: vi.fn(),
  rateLimitKey: vi.fn(() => "money:test:key"),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mocks.createAdminClient,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClientFromRequest: mocks.createClientFromRequest,
}));

vi.mock("@/utils/rateLimit", () => ({
  checkRateLimitPersistent: mocks.checkRateLimitPersistent,
  rateLimitKey: mocks.rateLimitKey,
}));

import { DELETE, PATCH } from "./[id]/route";
import { POST } from "./route";

const USER_ID = "10000000-0000-4000-8000-000000000001";
const COUPLE_ID = "20000000-0000-4000-8000-000000000001";
const OTHER_COUPLE_ID = "20000000-0000-4000-8000-000000000002";
const MONEY_ID = "30000000-0000-4000-8000-000000000001";

function jsonRequest(method: string, body?: unknown) {
  return new Request(`https://hanbang.ai/api/money/${MONEY_ID}`, {
    method,
    headers: {
      "content-type": "application/json",
      "x-real-ip": "203.0.113.20",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function authenticatedClient(options?: { moneyCoupleId?: string | null }) {
  const userFrom = vi.fn((table: string) => {
    if (table === "profiles") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            single: vi.fn().mockResolvedValue({
              data: { couple_id: COUPLE_ID },
            }),
          })),
        })),
      };
    }
    if (table === "congratulatory_money") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            single: vi.fn().mockResolvedValue({
              data: options?.moneyCoupleId === null
                ? null
                : { couple_id: options?.moneyCoupleId ?? COUPLE_ID },
            }),
          })),
        })),
      };
    }
    throw new Error(`unexpected user table: ${table}`);
  });

  mocks.createClientFromRequest.mockResolvedValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: USER_ID } },
      }),
    },
    from: userFrom,
  });
  return userFrom;
}

describe("money mutation trust boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.checkRateLimitPersistent.mockResolvedValue(null);
  });

  it("ignores a forged couple id and inserts with the server-verified couple", async () => {
    const userFrom = authenticatedClient();
    const inserted = {
      id: MONEY_ID,
      couple_id: COUPLE_ID,
      guest_name: "Guest",
      amount: 150000,
    };
    const adminSingle = vi.fn().mockResolvedValue({ data: inserted, error: null });
    const adminSelect = vi.fn(() => ({ single: adminSingle }));
    const adminInsert = vi.fn(() => ({ select: adminSelect }));
    const adminFrom = vi.fn(() => ({ insert: adminInsert }));
    mocks.createAdminClient.mockReturnValue({ from: adminFrom });

    const response = await POST(jsonRequest("POST", {
      couple_id: OTHER_COUPLE_ID,
      guest_name: " Guest ",
      amount: 150000,
      side: "both",
      method: "cash",
      received_at: "2027-06-03",
      memo: "Thank you",
      server_only: true,
    }));

    expect(response.status).toBe(201);
    expect(userFrom).toHaveBeenCalledTimes(1);
    expect(userFrom).toHaveBeenCalledWith("profiles");
    expect(adminFrom).toHaveBeenCalledWith("congratulatory_money");
    expect(adminInsert).toHaveBeenCalledWith({
      couple_id: COUPLE_ID,
      guest_name: "Guest",
      amount: 150000,
      side: "both",
      relation: null,
      method: "cash",
      memo: "Thank you",
      received_at: "2027-06-03",
    });
    expect(JSON.stringify(adminInsert.mock.calls)).not.toContain(OTHER_COUPLE_ID);
    expect(JSON.stringify(adminInsert.mock.calls)).not.toContain("server_only");
  });

  it("updates only the verified row and couple while dropping untrusted fields", async () => {
    authenticatedClient();
    const adminSingle = vi.fn().mockResolvedValue({
      data: { id: MONEY_ID, couple_id: COUPLE_ID, amount: 200000 },
      error: null,
    });
    const adminSelect = vi.fn(() => ({ single: adminSingle }));
    const secondEq = vi.fn(() => ({ select: adminSelect }));
    const firstEq = vi.fn(() => ({ eq: secondEq }));
    const adminUpdate = vi.fn(() => ({ eq: firstEq }));
    const adminFrom = vi.fn(() => ({ update: adminUpdate }));
    mocks.createAdminClient.mockReturnValue({ from: adminFrom });

    const response = await PATCH(
      jsonRequest("PATCH", {
        couple_id: OTHER_COUPLE_ID,
        amount: 200000,
        guest_name: "Updated Guest",
        created_at: "1900-01-01",
      }),
      { params: Promise.resolve({ id: MONEY_ID }) },
    );

    expect(response.status).toBe(200);
    expect(adminUpdate).toHaveBeenCalledWith({
      amount: 200000,
      guest_name: "Updated Guest",
    });
    expect(firstEq).toHaveBeenCalledWith("id", MONEY_ID);
    expect(secondEq).toHaveBeenCalledWith("couple_id", COUPLE_ID);
    expect(JSON.stringify(adminUpdate.mock.calls)).not.toContain(OTHER_COUPLE_ID);
    expect(JSON.stringify(adminUpdate.mock.calls)).not.toContain("created_at");
  });

  it("deletes only the id and couple pair verified through the user-scoped read", async () => {
    authenticatedClient();
    const secondEq = vi.fn().mockResolvedValue({ error: null });
    const firstEq = vi.fn(() => ({ eq: secondEq }));
    const adminDelete = vi.fn(() => ({ eq: firstEq }));
    const adminFrom = vi.fn(() => ({ delete: adminDelete }));
    mocks.createAdminClient.mockReturnValue({ from: adminFrom });

    const response = await DELETE(
      jsonRequest("DELETE"),
      { params: Promise.resolve({ id: MONEY_ID }) },
    );

    expect(response.status).toBe(200);
    expect(firstEq).toHaveBeenCalledWith("id", MONEY_ID);
    expect(secondEq).toHaveBeenCalledWith("couple_id", COUPLE_ID);
  });

  it.each(["PATCH", "DELETE"] as const)(
    "blocks %s IDOR before constructing a service client",
    async (method) => {
      authenticatedClient({ moneyCoupleId: null });

      const response = method === "PATCH"
        ? await PATCH(
            jsonRequest("PATCH", { amount: 1 }),
            { params: Promise.resolve({ id: MONEY_ID }) },
          )
        : await DELETE(
            jsonRequest("DELETE"),
            { params: Promise.resolve({ id: MONEY_ID }) },
          );

      expect(response.status).toBe(404);
      expect(mocks.createAdminClient).not.toHaveBeenCalled();
    },
  );
});
