import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClientFromRequest } from "@/lib/supabase/server";
import { DELETE, PATCH } from "../route";

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClientFromRequest: vi.fn(),
}));

vi.mock("@/utils/rateLimit", () => ({
  checkRateLimit: vi.fn(() => null),
  rateLimitKey: vi.fn(() => "money:delete:user-1"),
}));

const MONEY_ID = "12345678-1234-4234-9234-123456789abc";
const context = { params: Promise.resolve({ id: MONEY_ID }) };

function authenticatedClient() {
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: "user-1" } },
        error: null,
      }),
    },
    rpc: vi.fn().mockResolvedValue({
      data: [{
        id: "user-1",
        name: "",
        role: "bride",
        couple_id: "couple-1",
        onboarding_completed: true,
        onboarding_step: 0,
        has_phone: false,
      }],
      error: null,
    }),
    from: vi.fn(),
  };
}

function adminDeleteQuery(result: { data: unknown; error: unknown }) {
  const query = {
    delete: vi.fn(),
    eq: vi.fn(),
    select: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue(result),
  };
  query.delete.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  query.select.mockReturnValue(query);
  return query;
}

describe("/api/money/[id] retired mutation boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 410 for updates before params, auth, body, or database access", async () => {
    const response = await PATCH();

    expect(response.status).toBe(410);
    await expect(response.json()).resolves.toMatchObject({
      code: "congratulatory_money_retired",
    });
    expect(createClientFromRequest).not.toHaveBeenCalled();
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("keeps defensive deletion private to the original record owner", async () => {
    const client = authenticatedClient();
    vi.mocked(createClientFromRequest).mockResolvedValue(client as never);
    const deleteQuery = adminDeleteQuery({ data: null, error: null });
    vi.mocked(createAdminClient).mockReturnValue({
      from: vi.fn(() => deleteQuery),
    } as never);

    const response = await DELETE(
      new Request(`http://localhost/api/money/${MONEY_ID}`, { method: "DELETE" }),
      context,
    );

    expect(response.status).toBe(404);
    expect(client.from).not.toHaveBeenCalled();
    expect(deleteQuery.eq).toHaveBeenNthCalledWith(1, "id", MONEY_ID);
    expect(deleteQuery.eq).toHaveBeenNthCalledWith(2, "owner_user_id", "user-1");
    expect(deleteQuery.eq).toHaveBeenNthCalledWith(3, "couple_id", "couple-1");
  });

  it("allows the original owner to permanently delete an existing record", async () => {
    const client = authenticatedClient();
    vi.mocked(createClientFromRequest).mockResolvedValue(client as never);
    const deleteQuery = adminDeleteQuery({ data: { id: MONEY_ID }, error: null });
    const adminFrom = vi.fn(() => deleteQuery);
    vi.mocked(createAdminClient).mockReturnValue({ from: adminFrom } as never);

    const response = await DELETE(
      new Request(`http://localhost/api/money/${MONEY_ID}`, { method: "DELETE" }),
      context,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true });
    expect(deleteQuery.delete).toHaveBeenCalledTimes(1);
    expect(deleteQuery.eq).toHaveBeenNthCalledWith(1, "id", MONEY_ID);
    expect(deleteQuery.eq).toHaveBeenNthCalledWith(2, "owner_user_id", "user-1");
    expect(deleteQuery.eq).toHaveBeenNthCalledWith(3, "couple_id", "couple-1");
    expect(deleteQuery.select).toHaveBeenCalledWith("id");
    expect(client.from).not.toHaveBeenCalled();
  });
});
