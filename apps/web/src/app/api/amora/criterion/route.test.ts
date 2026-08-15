import { beforeEach, describe, expect, it, vi } from "vitest";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClientFromRequest } from "@/lib/supabase/server";
import { checkRateLimit } from "@/utils/rateLimit";
import { isTrustedMutationRequest } from "@/utils/trustedMutation";
import { DELETE, GET, PUT } from "./route";

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClientFromRequest: vi.fn(),
}));
vi.mock("@/utils/rateLimit", () => ({
  checkRateLimit: vi.fn(() => null),
  rateLimitKey: vi.fn(() => "amora-core-criterion:test"),
}));
vi.mock("@/utils/trustedMutation", () => ({
  isTrustedMutationRequest: vi.fn(() => true),
}));

const USER_ID = "11111111-1111-4111-8111-111111111111";
const COUPLE_ID = "22222222-2222-4222-8222-222222222222";
const CRITERION_ID = "33333333-3333-4333-8333-333333333333";
const UPDATED_AT = "2026-08-14T04:00:00.000Z";

function query(result: { data: unknown; error: unknown }) {
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "eq", "contains", "order", "limit"] as const) {
    builder[method] = vi.fn(() => builder);
  }
  builder.single = vi.fn().mockResolvedValue(result);
  builder.maybeSingle = vi.fn().mockResolvedValue(result);
  return builder;
}

function makeClient() {
  const profile = query({ data: { couple_id: COUPLE_ID, role: "bride" }, error: null });
  const couple = query({ data: { bride_id: USER_ID, groom_id: null }, error: null });
  const criterion = query({
    data: {
      id: CRITERION_ID,
      chosen_value: { value: "우리 둘이 편안한 하루" },
      metadata: {
        criterion_contract: "amora_core_criterion_v1",
        criterion_version: 1,
        owner_user_id: USER_ID,
        explicit: true,
      },
      updated_at: UPDATED_AT,
    },
    error: null,
  });
  const from = vi.fn((table: string) => {
    if (table === "profiles") return profile;
    if (table === "couples") return couple;
    if (table === "decision_nodes") return criterion;
    throw new Error(`unexpected table: ${table}`);
  });
  return {
    client: {
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: USER_ID } } }),
      },
      from,
    },
    from,
    criterion,
  };
}

describe("/api/amora/criterion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(checkRateLimit).mockReturnValue(null);
    vi.mocked(isTrustedMutationRequest).mockReturnValue(true);
  });

  it("returns only the current owner's latest private explicit criterion receipt", async () => {
    const { client, criterion } = makeClient();
    vi.mocked(createClientFromRequest).mockResolvedValue(client as never);

    const result = await GET(new Request("http://localhost/api/amora/criterion"));

    expect(result.status).toBe(200);
    expect(result.headers.get("Cache-Control")).toContain("no-store");
    expect(await result.json()).toEqual({
      version: 1,
      criterion: {
        id: CRITERION_ID,
        value: "우리 둘이 편안한 하루",
        updatedAt: UPDATED_AT,
      },
    });
    expect(criterion.eq).toHaveBeenCalledWith("couple_id", COUPLE_ID);
    expect(criterion.eq).toHaveBeenCalledWith("visibility", "bride_private");
    expect(criterion.eq).toHaveBeenCalledWith("source_actor_role", "bride");
    expect(criterion.contains).toHaveBeenCalledWith("metadata", {
      criterion_contract: "amora_core_criterion_v1",
      owner_user_id: USER_ID,
    });
  });

  it("stores a normalized owner-private criterion through the service-only RPC", async () => {
    const { client } = makeClient();
    vi.mocked(createClientFromRequest).mockResolvedValue(client as never);
    const rpc = vi.fn().mockResolvedValue({
      data: {
        version: 1,
        deleted: false,
        criterionId: CRITERION_ID,
        value: "우리 둘이 편안한 하루",
        updatedAt: UPDATED_AT,
      },
      error: null,
    });
    vi.mocked(createAdminClient).mockReturnValue({ rpc } as never);

    const result = await PUT(new Request("http://localhost/api/amora/criterion", {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        "X-Hanbang-Mutation-Contract-Version": "2",
        "X-Hanbang-Expected-Actor-User-Id": USER_ID,
      },
      body: JSON.stringify({
        version: 1,
        expectedCriterionId: null,
        requestId: "44444444-4444-4444-8444-444444444444",
        value: "우리 둘이 편안한 하루",
      }),
    }));

    expect(result.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("set_amora_core_criterion_v1", {
      p_couple_id: COUPLE_ID,
      p_recipient_user_id: USER_ID,
      p_expected_criterion_id: null,
      p_request_id: "44444444-4444-4444-8444-444444444444",
      p_value: "우리 둘이 편안한 하루",
      p_delete: false,
    });
    expect(await result.json()).toEqual({
      version: 1,
      criterion: {
        id: CRITERION_ID,
        value: "우리 둘이 편안한 하루",
        updatedAt: UPDATED_AT,
      },
    });
  });

  it("deletes the exact current criterion and returns an empty receipt", async () => {
    const { client } = makeClient();
    vi.mocked(createClientFromRequest).mockResolvedValue(client as never);
    const rpc = vi.fn().mockResolvedValue({
      data: {
        version: 1,
        deleted: true,
        criterionId: "55555555-5555-4555-8555-555555555555",
        value: null,
        updatedAt: UPDATED_AT,
      },
      error: null,
    });
    vi.mocked(createAdminClient).mockReturnValue({ rpc } as never);

    const result = await DELETE(new Request("http://localhost/api/amora/criterion", {
      method: "DELETE",
      headers: {
        "content-type": "application/json",
        "X-Hanbang-Mutation-Contract-Version": "2",
        "X-Hanbang-Expected-Actor-User-Id": USER_ID,
      },
      body: JSON.stringify({
        version: 1,
        expectedCriterionId: CRITERION_ID,
        requestId: "66666666-6666-4666-8666-666666666666",
      }),
    }));

    expect(result.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("set_amora_core_criterion_v1", {
      p_couple_id: COUPLE_ID,
      p_recipient_user_id: USER_ID,
      p_expected_criterion_id: CRITERION_ID,
      p_request_id: "66666666-6666-4666-8666-666666666666",
      p_value: null,
      p_delete: true,
    });
    expect(await result.json()).toEqual({ version: 1, criterion: null });
  });

  it("rejects a write captured by a different account before any service call", async () => {
    const { client } = makeClient();
    vi.mocked(createClientFromRequest).mockResolvedValue(client as never);
    const rpc = vi.fn();
    vi.mocked(createAdminClient).mockReturnValue({ rpc } as never);

    const result = await PUT(new Request("http://localhost/api/amora/criterion", {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        "X-Hanbang-Mutation-Contract-Version": "2",
        "X-Hanbang-Expected-Actor-User-Id":
          "77777777-7777-4777-8777-777777777777",
      },
      body: JSON.stringify({
        version: 1,
        expectedCriterionId: null,
        requestId: "44444444-4444-4444-8444-444444444444",
        value: "우리 둘이 편안한 하루",
      }),
    }));

    expect(result.status).toBe(409);
    expect(await result.json()).toMatchObject({ code: "MUTATION_ACTOR_CHANGED" });
    expect(rpc).not.toHaveBeenCalled();
  });
});
