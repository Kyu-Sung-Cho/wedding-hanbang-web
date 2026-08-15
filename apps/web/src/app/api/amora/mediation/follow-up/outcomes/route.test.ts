import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  HANBANG_EXPECTED_ACTOR_USER_ID_HEADER,
  HANBANG_MUTATION_CONTRACT_VERSION,
  HANBANG_MUTATION_CONTRACT_VERSION_HEADER,
} from "@hanbang/shared";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClientFromRequest } from "@/lib/supabase/server";
import { isAmoraMediationOutcomeFollowUpEnabled } from "@/lib/features/amoraCareFlags";
import { isTrustedMutationRequest } from "@/utils/trustedMutation";
import { checkRateLimit } from "@/utils/rateLimit";
import { GET, POST } from "./route";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClientFromRequest: vi.fn() }));
vi.mock("@/lib/features/amoraCareFlags", () => ({
  isAmoraMediationOutcomeFollowUpEnabled: vi.fn(() => true),
}));
vi.mock("@/utils/trustedMutation", () => ({ isTrustedMutationRequest: vi.fn(() => true) }));
vi.mock("@/utils/rateLimit", () => ({
  checkRateLimit: vi.fn(() => null),
  rateLimitKey: vi.fn(() => "mediation-follow-up-outcome:test"),
}));

const USER_ID = "10000000-0000-4000-8000-000000000001";
const PARTNER_ID = "10000000-0000-4000-8000-000000000002";
const OTHER_ID = "10000000-0000-4000-8000-000000000003";
const COUPLE_ID = "20000000-0000-4000-8000-000000000001";
const CARD_ID = "30000000-0000-4000-8000-000000000001";
const RECEIPT_ID = "50000000-0000-4000-8000-000000000001";
const IDEMPOTENCY_KEY = "40000000-0000-4000-8000-000000000001";
const SOURCE_DIGEST = "a".repeat(64);

function query(data: unknown, error: unknown = null) {
  const builder = { select: vi.fn(), eq: vi.fn(), single: vi.fn() };
  builder.select.mockReturnValue(builder);
  builder.eq.mockReturnValue(builder);
  builder.single.mockResolvedValue({ data, error });
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

function body() {
  return {
    cardId: CARD_ID,
    cardRevision: 1,
    sourceDigest: SOURCE_DIGEST,
    outcome: "blocked",
    idempotencyKey: IDEMPOTENCY_KEY,
  };
}

function receipt() {
  return {
    version: 1,
    recipientUserId: USER_ID,
    coupleId: COUPLE_ID,
    receipt: {
      id: RECEIPT_ID,
      cardId: CARD_ID,
      cardRevision: 1,
      sourceDigest: SOURCE_DIGEST,
      outcome: "blocked",
      recordedAt: "2026-08-12T00:00:00.000Z",
      idempotencyKey: IDEMPOTENCY_KEY,
    },
  };
}

function installClient(options: {
  userId?: string | null;
  profile?: unknown;
  profileError?: unknown;
  couple?: unknown;
  coupleError?: unknown;
  privacyEpoch?: unknown;
  privacyError?: unknown;
} = {}) {
  const userId = options.userId === undefined ? USER_ID : options.userId;
  const profile = query(
    options.profile ?? { couple_id: COUPLE_ID, role: "bride" },
    options.profileError,
  );
  const couple = query(
    options.couple ?? { bride_id: USER_ID, groom_id: PARTNER_ID },
    options.coupleError,
  );
  const client = {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: userId ? { id: userId } : null },
      }),
    },
    from: vi.fn((name: string) => name === "profiles" ? profile : couple),
    rpc: vi.fn().mockResolvedValue({
      data: options.privacyEpoch ?? 5,
      error: options.privacyError ?? null,
    }),
  };
  vi.mocked(createClientFromRequest).mockResolvedValue(client as never);
  return client;
}

describe("/api/amora/mediation/follow-up/outcomes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isAmoraMediationOutcomeFollowUpEnabled).mockReturnValue(true);
    vi.mocked(isTrustedMutationRequest).mockReturnValue(true);
    vi.mocked(checkRateLimit).mockReturnValue(null);
  });

  it("stays unavailable until its independent rollout flag is exact true", async () => {
    vi.mocked(isAmoraMediationOutcomeFollowUpEnabled).mockReturnValue(false);
    const response = await POST(new Request(
      "http://localhost/api/amora/mediation/follow-up/outcomes",
      { method: "POST", headers: headers(), body: JSON.stringify(body()) },
    ));
    expect(response.status).toBe(404);
    expect(createClientFromRequest).not.toHaveBeenCalled();
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("rejects an untrusted origin or unauthenticated caller before any service RPC", async () => {
    vi.mocked(isTrustedMutationRequest).mockReturnValue(false);
    let result = await POST(new Request(
      "http://localhost/api/amora/mediation/follow-up/outcomes",
      { method: "POST", headers: headers(), body: JSON.stringify(body()) },
    ));
    expect(result.status).toBe(403);
    expect(createClientFromRequest).not.toHaveBeenCalled();
    expect(createAdminClient).not.toHaveBeenCalled();

    vi.mocked(isTrustedMutationRequest).mockReturnValue(true);
    installClient({ userId: null });
    result = await POST(new Request(
      "http://localhost/api/amora/mediation/follow-up/outcomes",
      { method: "POST", headers: headers(), body: JSON.stringify(body()) },
    ));
    expect(result.status).toBe(401);
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("rejects a missing couple, stale roster, or unavailable privacy epoch before service RPC", async () => {
    let client = installClient({ profile: { couple_id: null, role: "bride" } });
    let result = await POST(new Request(
      "http://localhost/api/amora/mediation/follow-up/outcomes",
      { method: "POST", headers: headers(), body: JSON.stringify(body()) },
    ));
    expect(result.status).toBe(409);
    expect(client.rpc).not.toHaveBeenCalled();
    expect(createAdminClient).not.toHaveBeenCalled();

    client = installClient({
      couple: { bride_id: OTHER_ID, groom_id: PARTNER_ID },
    });
    result = await POST(new Request(
      "http://localhost/api/amora/mediation/follow-up/outcomes",
      { method: "POST", headers: headers(), body: JSON.stringify(body()) },
    ));
    expect(result.status).toBe(409);
    expect(client.rpc).not.toHaveBeenCalled();
    expect(createAdminClient).not.toHaveBeenCalled();

    client = installClient({ privacyEpoch: 0 });
    result = await POST(new Request(
      "http://localhost/api/amora/mediation/follow-up/outcomes",
      { method: "POST", headers: headers(), body: JSON.stringify(body()) },
    ));
    expect(result.status).toBe(503);
    expect(client.rpc).toHaveBeenCalledWith("get_own_amora_privacy_epoch", {
      p_couple_id: COUPLE_ID,
      p_visibility: "shared",
    });
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("rejects an oversized UTF-8 body before creating the service client", async () => {
    installClient();
    const result = await POST(new Request(
      "http://localhost/api/amora/mediation/follow-up/outcomes",
      {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ ...body(), padding: "가".repeat(2_048) }),
      },
    ));

    expect(result.status).toBe(413);
    await expect(result.json()).resolves.toMatchObject({
      code: "MEDIATION_FOLLOW_UP_REQUEST_INVALID",
    });
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("fails closed when the service returns a malformed POST or GET receipt", async () => {
    installClient();
    const rpc = vi.fn().mockResolvedValue({
      data: { version: 1, recipientUserId: OTHER_ID, receipt: {} },
      error: null,
    });
    vi.mocked(createAdminClient).mockReturnValue({ rpc } as never);

    let result = await POST(new Request(
      "http://localhost/api/amora/mediation/follow-up/outcomes",
      { method: "POST", headers: headers(), body: JSON.stringify(body()) },
    ));
    expect(result.status).toBe(503);
    await expect(result.json()).resolves.toMatchObject({
      code: "MEDIATION_FOLLOW_UP_INVALID_RECEIPT",
    });

    installClient();
    result = await GET(new Request(
      `http://localhost/api/amora/mediation/follow-up/outcomes?idempotencyKey=${IDEMPOTENCY_KEY}`,
      { headers: headers() },
    ));
    expect(result.status).toBe(503);
    await expect(result.json()).resolves.toMatchObject({
      code: "MEDIATION_FOLLOW_UP_INVALID_RECEIPT",
    });
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it("posts and rereads the same bounded private receipt", async () => {
    installClient();
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: receipt(), error: null })
      .mockResolvedValueOnce({ data: receipt(), error: null });
    vi.mocked(createAdminClient).mockReturnValue({ rpc } as never);

    const posted = await POST(new Request(
      "http://localhost/api/amora/mediation/follow-up/outcomes",
      { method: "POST", headers: headers(), body: JSON.stringify(body()) },
    ));
    expect(posted.status).toBe(200);
    await expect(posted.json()).resolves.toEqual(receipt());
    expect(rpc).toHaveBeenNthCalledWith(1, "record_amora_mediation_outcome_follow_up", {
      p_couple_id: COUPLE_ID,
      p_recipient_user_id: USER_ID,
      p_expected_privacy_epoch: 5,
      p_card_id: CARD_ID,
      p_expected_card_revision: 1,
      p_expected_source_digest: SOURCE_DIGEST,
      p_outcome: "blocked",
      p_idempotency_key: IDEMPOTENCY_KEY,
    });

    const reread = await GET(new Request(
      `http://localhost/api/amora/mediation/follow-up/outcomes?idempotencyKey=${IDEMPOTENCY_KEY}`,
      { headers: headers() },
    ));
    expect(reread.status).toBe(200);
    await expect(reread.json()).resolves.toEqual(receipt());
    expect(rpc).toHaveBeenNthCalledWith(2, "read_amora_mediation_outcome_follow_up_receipt", {
      p_couple_id: COUPLE_ID,
      p_recipient_user_id: USER_ID,
      p_expected_privacy_epoch: 5,
      p_idempotency_key: IDEMPOTENCY_KEY,
    });
  });

  it("rejects free text, an account switch, and a missing strict actor contract before service RPC", async () => {
    installClient();
    vi.mocked(createAdminClient).mockReturnValue({ rpc: vi.fn() } as never);
    let response = await POST(new Request(
      "http://localhost/api/amora/mediation/follow-up/outcomes",
      {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ ...body(), note: "do not store this" }),
      },
    ));
    expect(response.status).toBe(400);
    expect(createAdminClient).not.toHaveBeenCalled();

    response = await POST(new Request(
      "http://localhost/api/amora/mediation/follow-up/outcomes",
      { method: "POST", headers: headers(OTHER_ID), body: JSON.stringify(body()) },
    ));
    expect(response.status).toBe(409);
    expect(createAdminClient).not.toHaveBeenCalled();

    response = await POST(new Request(
      "http://localhost/api/amora/mediation/follow-up/outcomes",
      {
        method: "POST",
        headers: { "content-type": "application/json", "sec-fetch-site": "same-origin" },
        body: JSON.stringify(body()),
      },
    ));
    expect(response.status).toBe(426);
    expect(response.headers.get("cache-control")).toContain("no-store");
    await expect(response.json()).resolves.toMatchObject({
      code: "CLIENT_UPDATE_REQUIRED",
    });
    expect(createAdminClient).not.toHaveBeenCalled();
  });
});
