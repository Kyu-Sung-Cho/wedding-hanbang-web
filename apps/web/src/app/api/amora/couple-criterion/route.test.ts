import { beforeEach, describe, expect, it, vi } from "vitest";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClientFromRequest } from "@/lib/supabase/server";
import { checkRateLimit } from "@/utils/rateLimit";
import { isTrustedMutationRequest } from "@/utils/trustedMutation";
import { DELETE, GET, PATCH, POST } from "./route";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClientFromRequest: vi.fn() }));
vi.mock("@/utils/rateLimit", () => ({
  checkRateLimit: vi.fn(() => null),
  rateLimitKey: vi.fn(() => "amora-couple-criterion:test"),
}));
vi.mock("@/utils/trustedMutation", () => ({
  isTrustedMutationRequest: vi.fn(() => true),
}));

const BRIDE = "11111111-1111-4111-8111-111111111111";
const GROOM = "22222222-2222-4222-8222-222222222222";
const COUPLE = "33333333-3333-4333-8333-333333333333";
const PROPOSAL = "44444444-4444-4444-8444-444444444444";
const DECISION = "55555555-5555-4555-8555-555555555555";
const REQUEST = "66666666-6666-4666-8666-666666666666";

const pendingResponse = {
  version: 1,
  coupleId: COUPLE,
  linked: true,
  current: {
    decisionId: DECISION,
    value: "우리 둘이 편안한 하루",
    confirmedAt: "2026-08-14T10:00:00.000Z",
  },
  proposal: {
    id: PROPOSAL,
    value: "우리 둘이 감당할 수 있는 범위 먼저 보기",
    revision: 1,
    proposerUserId: BRIDE,
    brideUserId: BRIDE,
    groomUserId: GROOM,
    acceptedUserIds: [BRIDE],
    createdAt: "2026-08-14T11:00:00.000Z",
    updatedAt: "2026-08-14T11:00:00.000Z",
  },
};

function query(result: { data: unknown; error: unknown }) {
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "eq"] as const) {
    builder[method] = vi.fn(() => builder);
  }
  builder.single = vi.fn().mockResolvedValue(result);
  return builder;
}

function makeClient(coupleId = COUPLE) {
  const profile = query({ data: { couple_id: coupleId, role: "bride" }, error: null });
  const couple = query({ data: { bride_id: BRIDE, groom_id: GROOM }, error: null });
  return {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: BRIDE } } }) },
    from: vi.fn((table: string) => {
      if (table === "profiles") return profile;
      if (table === "couples") return couple;
      throw new Error(`unexpected table: ${table}`);
    }),
  };
}

function headers() {
  return {
    "content-type": "application/json",
    "X-Hanbang-Mutation-Contract-Version": "2",
    "X-Hanbang-Expected-Actor-User-Id": BRIDE,
  };
}

describe("/api/amora/couple-criterion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(checkRateLimit).mockReturnValue(null);
    vi.mocked(isTrustedMutationRequest).mockReturnValue(true);
    vi.mocked(createClientFromRequest).mockResolvedValue(makeClient() as never);
  });

  it("returns the exact roster-bound current criterion and one-person pending proposal", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: pendingResponse, error: null });
    vi.mocked(createAdminClient).mockReturnValue({ rpc } as never);

    const result = await GET(new Request("http://localhost/api/amora/couple-criterion"));

    expect(result.status).toBe(200);
    expect(result.headers.get("Cache-Control")).toContain("no-store");
    expect(await result.json()).toEqual(pendingResponse);
    expect(rpc).toHaveBeenCalledWith("read_amora_couple_core_criterion_v1", {
      p_couple_id: COUPLE,
      p_recipient_user_id: BRIDE,
    });
  });

  it("proposes only the reviewed shared sentence for the captured couple", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: pendingResponse, error: null });
    vi.mocked(createAdminClient).mockReturnValue({ rpc } as never);

    const result = await POST(new Request("http://localhost/api/amora/couple-criterion", {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        version: 1,
        expectedCoupleId: COUPLE,
        expectedCurrentDecisionId: DECISION,
        requestId: REQUEST,
        value: "우리 둘이 감당할 수 있는 범위 먼저 보기",
      }),
    }));

    expect(result.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("propose_amora_couple_core_criterion_v1", {
      p_couple_id: COUPLE,
      p_recipient_user_id: BRIDE,
      p_expected_current_decision_id: DECISION,
      p_request_id: REQUEST,
      p_value: "우리 둘이 감당할 수 있는 범위 먼저 보기",
    });
  });

  it("accepts or cancels only the exact pending revision", async () => {
    const confirmed = { ...pendingResponse, current: {
      decisionId: "77777777-7777-4777-8777-777777777777",
      value: pendingResponse.proposal.value,
      confirmedAt: "2026-08-14T12:00:00.000Z",
    }, proposal: null };
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: confirmed, error: null })
      .mockResolvedValueOnce({
        data: { ...pendingResponse, proposal: null },
        error: null,
      });
    vi.mocked(createAdminClient).mockReturnValue({ rpc } as never);
    const body = {
      version: 1,
      expectedCoupleId: COUPLE,
      proposalId: PROPOSAL,
      expectedRevision: 1,
      requestId: REQUEST,
    };

    const accepted = await PATCH(new Request("http://localhost/api/amora/couple-criterion", {
      method: "PATCH", headers: headers(), body: JSON.stringify(body),
    }));
    const cancelled = await DELETE(new Request("http://localhost/api/amora/couple-criterion", {
      method: "DELETE", headers: headers(), body: JSON.stringify(body),
    }));

    expect(accepted.status).toBe(200);
    expect(cancelled.status).toBe(200);
    expect(rpc).toHaveBeenNthCalledWith(1, "accept_amora_couple_core_criterion_v1", {
      p_couple_id: COUPLE,
      p_recipient_user_id: BRIDE,
      p_proposal_id: PROPOSAL,
      p_expected_revision: 1,
      p_request_id: REQUEST,
    });
    expect(rpc).toHaveBeenNthCalledWith(2, "cancel_amora_couple_core_criterion_v1", {
      p_couple_id: COUPLE,
      p_recipient_user_id: BRIDE,
      p_proposal_id: PROPOSAL,
      p_expected_revision: 1,
      p_request_id: REQUEST,
    });
  });

  it("rejects stale couple context and missing actor headers before any service mutation", async () => {
    const rpc = vi.fn();
    vi.mocked(createAdminClient).mockReturnValue({ rpc } as never);
    const body = {
      version: 1,
      expectedCoupleId: "88888888-8888-4888-8888-888888888888",
      expectedCurrentDecisionId: DECISION,
      requestId: REQUEST,
      value: "잘못된 커플에 저장되면 안 됨",
    };

    const stale = await POST(new Request("http://localhost/api/amora/couple-criterion", {
      method: "POST", headers: headers(), body: JSON.stringify(body),
    }));
    const legacy = await POST(new Request("http://localhost/api/amora/couple-criterion", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...body, expectedCoupleId: COUPLE }),
    }));

    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ code: "AMORA_COUPLE_CRITERION_SCOPE_CHANGED" });
    expect(legacy.status).toBe(426);
    expect(rpc).not.toHaveBeenCalled();
  });
});
