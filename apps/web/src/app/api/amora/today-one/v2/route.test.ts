import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";
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
import { GET } from "./route";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClientFromRequest: vi.fn() }));
vi.mock("@/lib/features/amoraCareFlags", () => ({ isAmoraTodayOneEnabled: vi.fn(() => true) }));
vi.mock("@/utils/trustedMutation", () => ({ isTrustedMutationRequest: vi.fn(() => true) }));
vi.mock("@/utils/rateLimit", () => ({
  checkRateLimit: vi.fn(() => null),
  rateLimitKey: vi.fn(() => "today-one-v2:test"),
}));

const USER_ID = "10000000-0000-4000-8000-000000000001";
const OTHER_ID = "10000000-0000-4000-8000-000000000002";
const COUPLE_ID = "20000000-0000-4000-8000-000000000001";

function query(data: unknown) {
  const builder = { select: vi.fn(), eq: vi.fn(), single: vi.fn() };
  builder.select.mockReturnValue(builder);
  builder.eq.mockReturnValue(builder);
  builder.single.mockResolvedValue({ data, error: null });
  return builder;
}

function request(actor = USER_ID) {
  return new Request("http://localhost/api/amora/today-one/v2", {
    headers: {
      "sec-fetch-site": "same-origin",
      [HANBANG_MUTATION_CONTRACT_VERSION_HEADER]: HANBANG_MUTATION_CONTRACT_VERSION,
      [HANBANG_EXPECTED_ACTOR_USER_ID_HEADER]: actor,
    },
  });
}

function explicitActionRequest(actionId = "act_first_step") {
  return new Request(
    `http://localhost/api/amora/today-one/v2?actionId=${encodeURIComponent(actionId)}`,
    { headers: request().headers },
  );
}

function installClient() {
  const profile = query({ couple_id: COUPLE_ID, role: "bride" });
  const couple = query({ bride_id: USER_ID, groom_id: null });
  const rpc = vi.fn().mockResolvedValue({ data: 5, error: null });
  const client = {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: USER_ID } } }) },
    from: vi.fn((name: string) => name === "profiles" ? profile : couple),
    rpc,
  };
  vi.mocked(createClientFromRequest).mockResolvedValue(client as never);
  return client;
}

describe("GET /api/amora/today-one/v2", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isAmoraTodayOneEnabled).mockReturnValue(true);
    vi.mocked(isTrustedMutationRequest).mockReturnValue(true);
    vi.mocked(checkRateLimit).mockReturnValue(null);
  });

  it("rejects an account-switch actor before any service RPC", async () => {
    installClient();
    const response = await GET(request(OTHER_ID));
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ code: "MUTATION_ACTOR_CHANGED" });
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("returns only a validated owner response from the server-derived couple", async () => {
    installClient();
    const claim = vi.fn().mockResolvedValue({
      data: { version: 2, state: "none", recipientUserId: USER_ID },
      error: null,
    });
    vi.mocked(createAdminClient).mockReturnValue({ rpc: claim } as never);
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    await expect(response.json()).resolves.toEqual({
      version: 2,
      state: "none",
      recipientUserId: USER_ID,
    });
    expect(claim).toHaveBeenCalledWith("claim_amora_action_follow_up_v2", {
      p_couple_id: COUPLE_ID,
      p_recipient_user_id: USER_ID,
      p_expected_privacy_epoch: 5,
    });
  });

  it("claims only the exact canonical action selected on home", async () => {
    installClient();
    const claim = vi.fn().mockResolvedValue({
      data: { version: 2, state: "none", recipientUserId: USER_ID },
      error: null,
    });
    vi.mocked(createAdminClient).mockReturnValue({ rpc: claim } as never);

    const response = await GET(explicitActionRequest());
    expect(response.status).toBe(200);
    expect(claim).toHaveBeenCalledWith("claim_amora_action_execution_v1", {
      p_couple_id: COUPLE_ID,
      p_recipient_user_id: USER_ID,
      p_expected_privacy_epoch: 5,
      p_action_id: "act_first_step",
    });
  });

  it.each([
    "?actionId=act_first_step&actionId=act_second_step",
    "?actionId=act_first_step&unexpected=1",
    "?actionId=",
  ])("rejects an ambiguous explicit action query before authentication: %s", async (queryString) => {
    const response = await GET(new Request(
      `http://localhost/api/amora/today-one/v2${queryString}`,
      { headers: request().headers },
    ));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: "TODAY_ONE_V2_QUERY_INVALID" });
    expect(createClientFromRequest).not.toHaveBeenCalled();
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("keeps a disabled rollout unavailable without authentication or RPC", async () => {
    vi.mocked(isAmoraTodayOneEnabled).mockReturnValue(false);
    const response = await GET(request());
    expect(response.status).toBe(404);
    expect(createClientFromRequest).not.toHaveBeenCalled();
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("rejects an untrusted origin before authentication", async () => {
    vi.mocked(isTrustedMutationRequest).mockReturnValue(false);
    const response = await GET(request());
    expect(response.status).toBe(403);
    expect(createClientFromRequest).not.toHaveBeenCalled();
  });

  it("requires a client update for a missing v2 actor contract before the service RPC", async () => {
    installClient();
    const response = await GET(new Request("http://localhost/api/amora/today-one/v2", {
      headers: { "sec-fetch-site": "same-origin" },
    }));
    expect(response.status).toBe(426);
    expect(response.headers.get("cache-control")).toContain("no-store");
    await expect(response.json()).resolves.toMatchObject({
      code: "CLIENT_UPDATE_REQUIRED",
    });
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("short-circuits a rate-limited owner before the service RPC", async () => {
    installClient();
    vi.mocked(checkRateLimit).mockReturnValue(NextResponse.json(
      { error: "요청이 너무 많습니다." },
      { status: 429 },
    ));
    const response = await GET(request());
    expect(response.status).toBe(429);
    expect(createAdminClient).not.toHaveBeenCalled();
  });
});
