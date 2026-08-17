import {
  HANBANG_EXPECTED_ACTOR_USER_ID_HEADER,
  HANBANG_MUTATION_CONTRACT_VERSION,
  HANBANG_MUTATION_CONTRACT_VERSION_HEADER,
} from "@hanbang/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClientFromRequest } from "@/lib/supabase/server";
import { checkRateLimit } from "@/utils/rateLimit";
import { isTrustedMutationRequest } from "@/utils/trustedMutation";
import { POST } from "./route";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClientFromRequest: vi.fn() }));
vi.mock("@/utils/rateLimit", () => ({
  checkRateLimit: vi.fn(() => null),
  rateLimitKey: vi.fn(() => "preparation-catch-up:test"),
}));
vi.mock("@/utils/trustedMutation", () => ({
  isTrustedMutationRequest: vi.fn(() => true),
}));

const USER_ID = "10000000-0000-4000-8000-000000000001";
const COUPLE_ID = "20000000-0000-4000-8000-000000000001";
const REQUEST_ID = "30000000-0000-4000-8000-000000000001";
const RECEIPT_ID = "40000000-0000-4000-8000-000000000001";
const DECISION_ID = "50000000-0000-4000-8000-000000000001";

const items = [
  { topicKey: "venue", state: "completed", scope: "owner_private" },
];
const receipt = {
  version: 1,
  status: "applied",
  receiptId: RECEIPT_ID,
  coupleId: COUPLE_ID,
  requestId: REQUEST_ID,
  sourceJourneyRevision: 0,
  confirmedAt: "2026-08-18T00:10:00.000Z",
  reused: false,
  items: [{
    decisionId: DECISION_ID,
    topicKey: "venue",
    state: "completed",
    scope: "owner_private",
    source: "user_reported",
  }],
  boundaries: {
    checklistCompletionChanged: false,
    vendorConfirmation: "unconfirmed",
    paymentEvidence: false,
  },
  next: { kind: "recalculate_current_state", route: "/schedule" },
};

function query(data: unknown, error: unknown = null) {
  const builder = { select: vi.fn(), eq: vi.fn(), single: vi.fn() };
  builder.select.mockReturnValue(builder);
  builder.eq.mockReturnValue(builder);
  builder.single.mockResolvedValue({ data, error });
  return builder;
}

function installClient() {
  const profile = query({ couple_id: COUPLE_ID, role: "bride" });
  const couple = query({ bride_id: USER_ID, groom_id: null });
  const rpc = vi.fn().mockResolvedValue({ data: 7, error: null });
  vi.mocked(createClientFromRequest).mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: USER_ID } } }) },
    from: vi.fn((name: string) => name === "profiles" ? profile : couple),
    rpc,
  } as never);
}

function request(body: unknown, actor = USER_ID) {
  return new Request("http://localhost/api/amora/preparation-catch-up", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "sec-fetch-site": "same-origin",
      [HANBANG_MUTATION_CONTRACT_VERSION_HEADER]: HANBANG_MUTATION_CONTRACT_VERSION,
      [HANBANG_EXPECTED_ACTOR_USER_ID_HEADER]: actor,
    },
    body: JSON.stringify(body),
  });
}

describe("POST /api/amora/preparation-catch-up", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isTrustedMutationRequest).mockReturnValue(true);
    vi.mocked(checkRateLimit).mockReturnValue(null);
    installClient();
  });

  it("finalizes one exact server-authoritative receipt without invoking AI", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: receipt, error: null });
    vi.mocked(createAdminClient).mockReturnValue({ rpc } as never);

    const response = await POST(request({
      version: 1,
      expectedCoupleId: COUPLE_ID,
      requestId: REQUEST_ID,
      items,
    }));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    await expect(response.json()).resolves.toEqual(receipt);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("finalize_amora_preparation_catch_up_v1", {
      p_couple_id: COUPLE_ID,
      p_actor_user_id: USER_ID,
      p_request_id: REQUEST_ID,
      p_expected_privacy_epoch: 7,
      p_items: items,
    });
  });

  it("rejects malformed or foreign-couple input before the finalizer", async () => {
    const rpc = vi.fn();
    vi.mocked(createAdminClient).mockReturnValue({ rpc } as never);

    const malformed = await POST(request({
      version: 1,
      expectedCoupleId: COUPLE_ID,
      requestId: REQUEST_ID,
      items: [{ ...items[0], source: "imported" }],
    }));
    expect(malformed.status).toBe(400);

    const foreign = await POST(request({
      version: 1,
      expectedCoupleId: "20000000-0000-4000-8000-000000000099",
      requestId: REQUEST_ID,
      items,
    }));
    expect(foreign.status).toBe(409);
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each([
    ["23514", 409, "AMORA_PREPARATION_CATCH_UP_CANONICAL_EXISTS"],
    ["42501", 409, "AMORA_PREPARATION_CATCH_UP_SHARED_APPROVAL_REQUIRED"],
    ["40001", 409, "AMORA_PREPARATION_CATCH_UP_CONTEXT_CHANGED"],
    ["55000", 503, "AMORA_PREPARATION_CATCH_UP_RECONCILIATION_REQUIRED"],
  ])("maps RPC %s without guessing success", async (code, status, responseCode) => {
    vi.mocked(createAdminClient).mockReturnValue({
      rpc: vi.fn().mockResolvedValue({ data: null, error: { code } }),
    } as never);
    const response = await POST(request({
      version: 1,
      expectedCoupleId: COUPLE_ID,
      requestId: REQUEST_ID,
      items,
    }));
    expect(response.status).toBe(status);
    await expect(response.json()).resolves.toEqual({ code: responseCode });
  });

  it("withholds a committed but malformed receipt instead of showing false success", async () => {
    vi.mocked(createAdminClient).mockReturnValue({
      rpc: vi.fn().mockResolvedValue({
        data: { ...receipt, boundaries: { ...receipt.boundaries, checklistCompletionChanged: true } },
        error: null,
      }),
    } as never);
    const response = await POST(request({
      version: 1,
      expectedCoupleId: COUPLE_ID,
      requestId: REQUEST_ID,
      items,
    }));
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      code: "AMORA_PREPARATION_CATCH_UP_INVALID_RECEIPT",
      retryPolicy: "same_request",
    });
  });
});
