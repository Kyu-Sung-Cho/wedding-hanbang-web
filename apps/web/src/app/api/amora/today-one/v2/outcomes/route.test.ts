import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  HANBANG_EXPECTED_ACTOR_USER_ID_HEADER,
  HANBANG_MUTATION_CONTRACT_VERSION,
  HANBANG_MUTATION_CONTRACT_VERSION_HEADER,
} from "@hanbang/shared";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClientFromRequest } from "@/lib/supabase/server";
import { isAmoraTodayOneEnabled } from "@/lib/features/amoraCareFlags";
import { isTrustedMutationRequest } from "@/utils/trustedMutation";
import { checkRateLimit } from "@/utils/rateLimit";
import { GET, POST } from "./route";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClientFromRequest: vi.fn() }));
vi.mock("@/lib/features/amoraCareFlags", () => ({ isAmoraTodayOneEnabled: vi.fn(() => true) }));
vi.mock("@/utils/trustedMutation", () => ({ isTrustedMutationRequest: vi.fn(() => true) }));
vi.mock("@/utils/rateLimit", () => ({
  checkRateLimit: vi.fn(() => null),
  rateLimitKey: vi.fn(() => "today-one-v2-outcome:test"),
}));

const USER_ID = "10000000-0000-4000-8000-000000000001";
const OTHER_ID = "10000000-0000-4000-8000-000000000002";
const COUPLE_ID = "20000000-0000-4000-8000-000000000001";
const CARD_ID = "30000000-0000-4000-8000-000000000001";
const KEY = "40000000-0000-4000-8000-000000000001";
const RECEIPT_ID = "50000000-0000-4000-8000-000000000001";

function query(data: unknown) {
  const builder = { select: vi.fn(), eq: vi.fn(), single: vi.fn() };
  builder.select.mockReturnValue(builder);
  builder.eq.mockReturnValue(builder);
  builder.single.mockResolvedValue({ data, error: null });
  return builder;
}

function headers(actor = USER_ID) {
  return {
    "content-type": "application/json",
    "sec-fetch-site": "same-origin",
    [HANBANG_MUTATION_CONTRACT_VERSION_HEADER]: HANBANG_MUTATION_CONTRACT_VERSION,
    [HANBANG_EXPECTED_ACTOR_USER_ID_HEADER]: actor,
  };
}

function installClient() {
  const profile = query({ couple_id: COUPLE_ID, role: "bride" });
  const couple = query({ bride_id: USER_ID, groom_id: null });
  const client = {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: USER_ID } } }) },
    from: vi.fn((name: string) => name === "profiles" ? profile : couple),
    rpc: vi.fn().mockResolvedValue({ data: 5, error: null }),
  };
  vi.mocked(createClientFromRequest).mockResolvedValue(client as never);
}

function receipt() {
  return {
    version: 2,
    recipientUserId: USER_ID,
    receipt: {
      id: RECEIPT_ID,
      cardId: CARD_ID,
      cardRevision: 1,
      outcome: "completed",
      actionStatus: "done",
      actionRevision: 2,
      recordedAt: "2026-08-12T10:00:00.000Z",
      idempotencyKey: KEY,
    },
  };
}

describe("/api/amora/today-one/v2/outcomes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isAmoraTodayOneEnabled).mockReturnValue(true);
    vi.mocked(isTrustedMutationRequest).mockReturnValue(true);
    vi.mocked(checkRateLimit).mockReturnValue(null);
  });

  it("rejects a POST account switch before any service RPC", async () => {
    installClient();
    const request = new Request("http://localhost/api/amora/today-one/v2/outcomes", {
      method: "POST",
      headers: headers(OTHER_ID),
      body: JSON.stringify({}),
    });
    const response = await POST(request);
    expect(response.status).toBe(409);
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("rereads a receipt only for the authenticated owner and server-derived couple", async () => {
    installClient();
    const rpc = vi.fn().mockResolvedValue({ data: receipt(), error: null });
    vi.mocked(createAdminClient).mockReturnValue({ rpc } as never);
    const request = new Request(
      `http://localhost/api/amora/today-one/v2/outcomes?idempotencyKey=${KEY}`,
      { headers: headers() },
    );
    const response = await GET(request);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(receipt());
    expect(rpc).toHaveBeenCalledWith("read_amora_action_follow_up_outcome_v2", {
      p_couple_id: COUPLE_ID,
      p_recipient_user_id: USER_ID,
      p_expected_privacy_epoch: 5,
      p_idempotency_key: KEY,
    });
  });

  it("posts a strict completed outcome with exact server-derived RPC arguments", async () => {
    installClient();
    const rpc = vi.fn().mockResolvedValue({ data: receipt(), error: null });
    vi.mocked(createAdminClient).mockReturnValue({ rpc } as never);
    const request = new Request("http://localhost/api/amora/today-one/v2/outcomes", {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        cardId: CARD_ID,
        cardRevision: 1,
        sourceRevision: 1,
        outcome: "completed",
        confirmed: true,
        idempotencyKey: KEY,
      }),
    });
    const response = await POST(request);
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("record_amora_action_follow_up_outcome_v2", {
      p_couple_id: COUPLE_ID,
      p_recipient_user_id: USER_ID,
      p_expected_privacy_epoch: 5,
      p_card_id: CARD_ID,
      p_expected_card_revision: 1,
      p_expected_source_revision: 1,
      p_outcome: "completed",
      p_blocker_code: null,
      p_confirmed: true,
      p_idempotency_key: KEY,
    });
  });

  it("records an explicit home action only through the explicit execution RPC", async () => {
    installClient();
    const rpc = vi.fn().mockResolvedValue({ data: receipt(), error: null });
    vi.mocked(createAdminClient).mockReturnValue({ rpc } as never);
    const request = new Request(
      "http://localhost/api/amora/today-one/v2/outcomes?mode=explicit_action",
      {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({
          cardId: CARD_ID,
          cardRevision: 1,
          sourceRevision: 1,
          outcome: "completed",
          confirmed: true,
          idempotencyKey: KEY,
        }),
      },
    );
    const response = await POST(request);
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("record_amora_action_execution_outcome_v1", {
      p_couple_id: COUPLE_ID,
      p_recipient_user_id: USER_ID,
      p_expected_privacy_epoch: 5,
      p_card_id: CARD_ID,
      p_expected_card_revision: 1,
      p_expected_source_revision: 1,
      p_outcome: "completed",
      p_blocker_code: null,
      p_confirmed: true,
      p_idempotency_key: KEY,
    });
  });

  it.each([
    "?mode=scheduled_follow_up",
    "?mode=explicit_action&mode=explicit_action",
    "?mode=explicit_action&unexpected=1",
  ])("rejects an ambiguous outcome mode before authentication: %s", async (queryString) => {
    const response = await POST(new Request(
      `http://localhost/api/amora/today-one/v2/outcomes${queryString}`,
      {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({}),
      },
    ));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: "TODAY_ONE_V2_REQUEST_INVALID" });
    expect(createClientFromRequest).not.toHaveBeenCalled();
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("rejects malformed and oversized bodies before the service RPC", async () => {
    installClient();
    const malformed = await POST(new Request("http://localhost/api/amora/today-one/v2/outcomes", {
      method: "POST", headers: headers(), body: "{" ,
    }));
    expect(malformed.status).toBe(400);
    expect(createAdminClient).not.toHaveBeenCalled();

    const oversized = await POST(new Request("http://localhost/api/amora/today-one/v2/outcomes", {
      method: "POST", headers: headers(), body: JSON.stringify({ padding: "x".repeat(3000) }),
    }));
    expect(oversized.status).toBe(413);
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it.each([
    ["AMORA_ACTION_FOLLOW_UP_PRIVACY_STALE", 409, "TODAY_ONE_V2_CONTEXT_CHANGED"],
    ["AMORA_ACTION_FOLLOW_UP_PREFERENCE_INACTIVE", 409, "TODAY_ONE_V2_CONTEXT_CHANGED"],
    ["AMORA_ACTION_FOLLOW_UP_IDEMPOTENCY_CONFLICT", 409, "TODAY_ONE_V2_IDEMPOTENCY_CONFLICT"],
    ["function public.record_amora_action_follow_up_outcome_v2 does not exist", 404, "TODAY_ONE_V2_UNAVAILABLE"],
  ])("maps a bounded RPC failure: %s", async (message, status, code) => {
    installClient();
    vi.mocked(createAdminClient).mockReturnValue({
      rpc: vi.fn().mockResolvedValue({ data: null, error: { message } }),
    } as never);
    const response = await POST(new Request("http://localhost/api/amora/today-one/v2/outcomes", {
      method: "POST", headers: headers(), body: JSON.stringify({
        cardId: CARD_ID, cardRevision: 1, sourceRevision: 1,
        outcome: "completed", confirmed: true, idempotencyKey: KEY,
      }),
    }));
    expect(response.status).toBe(status);
    expect(await response.json()).toMatchObject({ code });
  });

  it("fails closed on a malformed canonical receipt", async () => {
    installClient();
    vi.mocked(createAdminClient).mockReturnValue({
      rpc: vi.fn().mockResolvedValue({ data: { version: 2 }, error: null }),
    } as never);
    const response = await GET(new Request(
      `http://localhost/api/amora/today-one/v2/outcomes?idempotencyKey=${KEY}`,
      { headers: headers() },
    ));
    expect(response.status).toBe(503);
  });
});
