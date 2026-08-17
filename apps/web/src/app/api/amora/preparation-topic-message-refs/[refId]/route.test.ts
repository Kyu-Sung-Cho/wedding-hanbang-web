import { NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  HANBANG_EXPECTED_ACTOR_USER_ID_HEADER,
  HANBANG_MUTATION_CONTRACT_VERSION,
  HANBANG_MUTATION_CONTRACT_VERSION_HEADER,
} from "@hanbang/shared";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClientFromRequest } from "@/lib/supabase/server";
import { checkRateLimit } from "@/utils/rateLimit";
import { isTrustedMutationRequest } from "@/utils/trustedMutation";
import { GET } from "./route";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClientFromRequest: vi.fn() }));
vi.mock("@/utils/rateLimit", () => ({
  checkRateLimit: vi.fn(() => null),
  rateLimitKey: vi.fn(() => "preparation-topic-message-ref-resolve:test"),
}));
vi.mock("@/utils/trustedMutation", () => ({
  isTrustedMutationRequest: vi.fn(() => true),
}));

const RECIPIENT = "11111111-1111-4111-8111-111111111111";
const PARTNER = "22222222-2222-4222-8222-222222222222";
const COUPLE = "33333333-3333-4333-8333-333333333333";
const REF = "44444444-4444-4444-8444-444444444444";
const MESSAGE = "55555555-5555-4555-8555-555555555555";
const QUESTION = "66666666-6666-4666-8666-666666666666";

const resolved = {
  version: 1,
  state: "ready",
  recipientUserId: RECIPIENT,
  coupleId: COUPLE,
  reference: {
    refId: REF,
    topicKey: "venue",
    messageId: MESSAGE,
    audience: "couple_shared",
    revision: 3,
    savedAt: "2026-08-16T02:00:00.000Z",
  },
  target: {
    messageId: MESSAGE,
    lane: "shared",
    content: "Compare the two venue contracts clause by clause.",
    createdAt: "2026-08-15T02:00:01.000Z",
  },
  question: {
    messageId: QUESTION,
    lane: "shared",
    senderType: "groom",
    content: "Which clauses should we compare before choosing?",
    createdAt: "2026-08-15T02:00:00.000Z",
  },
};

function query(data: unknown, error: unknown = null) {
  const builder = { select: vi.fn(), eq: vi.fn(), single: vi.fn() };
  builder.select.mockReturnValue(builder);
  builder.eq.mockReturnValue(builder);
  builder.single.mockResolvedValue({ data, error });
  return builder;
}

function installClient(options: {
  userId?: string | null;
  brideId?: string | null;
  profileError?: unknown;
  privacyEpoch?: unknown;
  privacyError?: unknown;
} = {}) {
  const userId = options.userId === undefined ? RECIPIENT : options.userId;
  const profile = query(
    { couple_id: COUPLE, role: "bride" },
    options.profileError ?? null,
  );
  const couple = query({
    bride_id: options.brideId === undefined ? RECIPIENT : options.brideId,
    groom_id: PARTNER,
  });
  const rpc = vi.fn().mockResolvedValue({
    data: options.privacyEpoch === undefined ? 7 : options.privacyEpoch,
    error: options.privacyError ?? null,
  });
  const client = {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: userId === null ? null : { id: userId } },
      }),
    },
    from: vi.fn((name: string) => name === "profiles" ? profile : couple),
    rpc,
  };
  vi.mocked(createClientFromRequest).mockResolvedValue(client as never);
  return client;
}

function request(suffix = "", actor = RECIPIENT) {
  return new Request(
    `http://localhost/api/amora/preparation-topic-message-refs/${REF}${suffix}`,
    {
      headers: {
        "sec-fetch-site": "same-origin",
        [HANBANG_MUTATION_CONTRACT_VERSION_HEADER]: HANBANG_MUTATION_CONTRACT_VERSION,
        [HANBANG_EXPECTED_ACTOR_USER_ID_HEADER]: actor,
      },
    },
  );
}

function context(refId = REF) {
  return { params: Promise.resolve({ refId }) };
}

describe("GET /api/amora/preparation-topic-message-refs/[refId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isTrustedMutationRequest).mockReturnValue(true);
    vi.mocked(checkRateLimit).mockReturnValue(null);
    installClient();
  });

  it("resolves the exact saved ref to its current source pair without caching", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: resolved, error: null });
    vi.mocked(createAdminClient).mockReturnValue({ rpc } as never);

    const response = await GET(request(), context());

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    expect(response.headers.get("vary")).toContain("Authorization");
    await expect(response.json()).resolves.toEqual(resolved);
    expect(rpc).toHaveBeenCalledWith(
      "resolve_amora_preparation_topic_message_ref_v1",
      {
        p_couple_id: COUPLE,
        p_recipient_user_id: RECIPIENT,
        p_ref_id: REF,
        p_expected_privacy_epoch: 7,
      },
    );
  });

  it("rejects invalid ref ids, query expansion, untrusted origin, and actor switch before service access", async () => {
    expect((await GET(request(), context("not-a-uuid"))).status).toBe(404);
    expect((await GET(request("?messageId=foreign"), context())).status).toBe(400);

    vi.mocked(isTrustedMutationRequest).mockReturnValueOnce(false);
    expect((await GET(request(), context())).status).toBe(403);
    expect((await GET(request("", PARTNER), context())).status).toBe(409);
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("fails closed for auth, roster, privacy epoch, and rate limit", async () => {
    installClient({ userId: null });
    expect((await GET(request(), context())).status).toBe(401);

    installClient({ brideId: PARTNER });
    expect((await GET(request(), context())).status).toBe(409);

    installClient({ privacyEpoch: null, privacyError: { code: "PGRST" } });
    expect((await GET(request(), context())).status).toBe(503);

    installClient();
    vi.mocked(checkRateLimit).mockReturnValueOnce(NextResponse.json(
      { code: "RATE_LIMITED" },
      { status: 429 },
    ));
    const limited = await GET(request(), context());
    expect(limited.status).toBe(429);
    expect(limited.headers.get("cache-control")).toContain("no-store");
    expect(limited.headers.get("vary")).toContain("Authorization");
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("treats a context database outage as retryable, not as an identity change", async () => {
    installClient({ profileError: { code: "XX000" } });

    const response = await GET(request(), context());

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      code: "AMORA_PREPARATION_TOPIC_MESSAGE_REF_UNAVAILABLE",
    });
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it.each([
    ["P0002", 404, "AMORA_PREPARATION_TOPIC_MESSAGE_REF_NOT_FOUND"],
    ["40001", 409, "AMORA_PREPARATION_TOPIC_MESSAGE_REF_CONFLICT"],
    ["PT409", 409, "AMORA_PREPARATION_TOPIC_MESSAGE_REF_CONFLICT"],
    ["22023", 400, "AMORA_PREPARATION_TOPIC_MESSAGE_REF_REQUEST_INVALID"],
    ["XX000", 503, "AMORA_PREPARATION_TOPIC_MESSAGE_REF_UNAVAILABLE"],
  ])("maps SQLSTATE %s without exposing service details", async (code, status, publicCode) => {
    vi.mocked(createAdminClient).mockReturnValue({
      rpc: vi.fn().mockResolvedValue({
        data: null,
        error: { code, message: "private source details" },
      }),
    } as never);

    const response = await GET(request(), context());

    expect(response.status).toBe(status);
    await expect(response.json()).resolves.toEqual({ code: publicCode });
  });

  it.each([
    { ...resolved, recipientUserId: PARTNER },
    { ...resolved, reference: { ...resolved.reference, refId: QUESTION } },
    { ...resolved, target: { ...resolved.target, messageId: QUESTION } },
    { ...resolved, question: { ...resolved.question, senderType: undefined } },
    { ...resolved, sourceDigest: "must-not-escape" },
  ])("rejects foreign, mismatched, or privacy-expanding resolver output", async (data) => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.mocked(createAdminClient).mockReturnValue({
      rpc: vi.fn().mockResolvedValue({ data, error: null }),
    } as never);

    const response = await GET(request(), context());

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      code: "AMORA_PREPARATION_TOPIC_MESSAGE_REF_INVALID_RESPONSE",
    });
  });
});
