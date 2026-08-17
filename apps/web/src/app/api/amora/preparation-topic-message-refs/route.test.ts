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
import { GET, PUT } from "./route";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClientFromRequest: vi.fn() }));
vi.mock("@/utils/rateLimit", () => ({
  checkRateLimit: vi.fn(() => null),
  rateLimitKey: vi.fn(() => "preparation-topic-message-refs:test"),
}));
vi.mock("@/utils/trustedMutation", () => ({
  isTrustedMutationRequest: vi.fn(() => true),
}));

const RECIPIENT = "11111111-1111-4111-8111-111111111111";
const PARTNER = "22222222-2222-4222-8222-222222222222";
const COUPLE = "33333333-3333-4333-8333-333333333333";
const REF = "44444444-4444-4444-8444-444444444444";
const MESSAGE = "55555555-5555-4555-8555-555555555555";
const REQUEST_ID = "66666666-6666-4666-8666-666666666666";

const collection = {
  version: 1,
  state: "ready",
  recipientUserId: RECIPIENT,
  coupleId: COUPLE,
  references: [{
    refId: REF,
    topicKey: "venue",
    messageId: MESSAGE,
    audience: "couple_shared",
    revision: 1,
    savedAt: "2026-08-16T02:00:00.000Z",
    sourceCreatedAt: "2026-08-15T02:00:00.000Z",
    excerpt: "Compare the venue contracts before choosing.",
    canRemove: true,
    canOpenOriginal: true,
  }],
  partial: false,
};

const state = {
  version: 1,
  state: "ready",
  recipientUserId: RECIPIENT,
  coupleId: COUPLE,
  reference: {
    topicKey: "venue",
    messageId: MESSAGE,
    refId: REF,
    audience: "couple_shared",
    savedState: "saved",
    revision: 1,
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
  role?: "bride" | "groom";
  brideId?: string | null;
  groomId?: string | null;
  profileError?: unknown;
  privacyEpoch?: unknown;
  privacyError?: unknown;
} = {}) {
  const userId = options.userId === undefined ? RECIPIENT : options.userId;
  const role = options.role ?? "bride";
  const profile = query({ couple_id: COUPLE, role }, options.profileError ?? null);
  const couple = query({
    bride_id: options.brideId === undefined ? RECIPIENT : options.brideId,
    groom_id: options.groomId === undefined ? PARTNER : options.groomId,
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

function headers(actor = RECIPIENT) {
  return {
    "content-type": "application/json",
    "sec-fetch-site": "same-origin",
    [HANBANG_MUTATION_CONTRACT_VERSION_HEADER]: HANBANG_MUTATION_CONTRACT_VERSION,
    [HANBANG_EXPECTED_ACTOR_USER_ID_HEADER]: actor,
  };
}

function getRequest(suffix = "", actor = RECIPIENT) {
  return new Request(
    `http://localhost/api/amora/preparation-topic-message-refs${suffix}`,
    { headers: headers(actor) },
  );
}

function putRequest(body: unknown, suffix = "", actor = RECIPIENT) {
  return new Request(
    `http://localhost/api/amora/preparation-topic-message-refs${suffix}`,
    { method: "PUT", headers: headers(actor), body: JSON.stringify(body) },
  );
}

describe("/api/amora/preparation-topic-message-refs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isTrustedMutationRequest).mockReturnValue(true);
    vi.mocked(checkRateLimit).mockReturnValue(null);
    installClient();
  });

  it("lists a bounded recipient-and-couple-bound collection without caching", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: collection, error: null });
    vi.mocked(createAdminClient).mockReturnValue({ rpc } as never);

    const response = await GET(getRequest());

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    expect(response.headers.get("vary")).toContain("Authorization");
    await expect(response.json()).resolves.toEqual(collection);
    expect(rpc).toHaveBeenCalledWith(
      "list_amora_preparation_topic_message_refs_v1",
      {
        p_couple_id: COUPLE,
        p_recipient_user_id: RECIPIENT,
        p_expected_privacy_epoch: 7,
        p_limit: 80,
      },
    );
  });

  it("reads exact state only for one canonical topic and one source message", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: state, error: null });
    vi.mocked(createAdminClient).mockReturnValue({ rpc } as never);

    const response = await GET(getRequest(`?topicKey=venue&messageId=${MESSAGE}`));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(state);
    expect(rpc).toHaveBeenCalledWith(
      "get_amora_preparation_topic_message_ref_state_v1",
      {
        p_couple_id: COUPLE,
        p_recipient_user_id: RECIPIENT,
        p_topic_key: "venue",
        p_message_id: MESSAGE,
        p_expected_privacy_epoch: 7,
      },
    );
  });

  it("sets only the exact requested state with optimistic revision and request id", async () => {
    const receipt = { ...state, reused: false };
    const rpc = vi.fn().mockResolvedValue({ data: receipt, error: null });
    vi.mocked(createAdminClient).mockReturnValue({ rpc } as never);
    const body = {
      topicKey: "venue",
      messageId: MESSAGE,
      desiredState: "saved",
      expectedRevision: 0,
      requestId: REQUEST_ID,
    };

    const response = await PUT(putRequest(body));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(receipt);
    expect(rpc).toHaveBeenCalledWith(
      "set_amora_preparation_topic_message_ref_v1",
      {
        p_couple_id: COUPLE,
        p_actor_user_id: RECIPIENT,
        p_topic_key: "venue",
        p_message_id: MESSAGE,
        p_desired_state: "saved",
        p_expected_revision: 0,
        p_request_id: REQUEST_ID,
        p_expected_privacy_epoch: 7,
      },
    );
  });

  it.each([
    "?topicKey=venue",
    `?messageId=${MESSAGE}`,
    `?topicKey=venue&topicKey=dress&messageId=${MESSAGE}`,
    `?topicKey=venue&messageId=${MESSAGE}&ownerId=${RECIPIENT}`,
    `?topicKey=guessed&messageId=${MESSAGE}`,
  ])("rejects an ambiguous or expanding query before auth: %s", async (suffix) => {
    const response = await GET(getRequest(suffix));
    expect(response.status).toBe(400);
    expect(createClientFromRequest).not.toHaveBeenCalled();
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("rejects extra mutation fields, query input, untrusted origin, and account switch", async () => {
    const body = {
      topicKey: "venue",
      messageId: MESSAGE,
      desiredState: "saved",
      expectedRevision: 0,
      requestId: REQUEST_ID,
    };
    expect((await PUT(putRequest({ ...body, content: "do not copy this" }))).status)
      .toBe(400);
    expect((await PUT(putRequest(body, "?topicKey=venue"))).status).toBe(400);

    vi.mocked(isTrustedMutationRequest).mockReturnValueOnce(false);
    expect((await PUT(putRequest(body))).status).toBe(403);
    expect((await PUT(putRequest(body, "", PARTNER))).status).toBe(409);
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("bounds mutation bytes and rejects invalid JSON before the service RPC", async () => {
    const invalidJson = new Request(
      "http://localhost/api/amora/preparation-topic-message-refs",
      { method: "PUT", headers: headers(), body: "{" },
    );
    const oversized = new Request(
      "http://localhost/api/amora/preparation-topic-message-refs",
      { method: "PUT", headers: headers(), body: `{"padding":"${"x".repeat(2_100)}"}` },
    );

    expect((await PUT(invalidJson)).status).toBe(400);
    expect((await PUT(oversized)).status).toBe(400);
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("fails closed for authentication, roster, privacy epoch, and rate limit", async () => {
    installClient({ userId: null });
    expect((await GET(getRequest())).status).toBe(401);

    installClient({ brideId: PARTNER });
    expect((await GET(getRequest())).status).toBe(409);

    installClient({ privacyEpoch: null, privacyError: { code: "PGRST" } });
    expect((await GET(getRequest())).status).toBe(503);

    installClient();
    vi.mocked(checkRateLimit).mockReturnValueOnce(NextResponse.json(
      { code: "RATE_LIMITED" },
      { status: 429 },
    ));
    const limited = await GET(getRequest());
    expect(limited.status).toBe(429);
    expect(limited.headers.get("cache-control")).toContain("no-store");
    expect(limited.headers.get("vary")).toContain("Authorization");
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("treats a context database outage as retryable, not as an identity change", async () => {
    installClient({ profileError: { code: "XX000" } });

    const response = await GET(getRequest());

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

    const response = await GET(getRequest());

    expect(response.status).toBe(status);
    await expect(response.json()).resolves.toEqual({ code: publicCode });
  });

  it("rejects foreign or privacy-expanding service output", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.mocked(createAdminClient).mockReturnValue({
      rpc: vi.fn().mockResolvedValue({
        data: { ...collection, sourceDigest: "must-not-escape" },
        error: null,
      }),
    } as never);

    const response = await GET(getRequest());

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      code: "AMORA_PREPARATION_TOPIC_MESSAGE_REF_INVALID_RESPONSE",
    });
  });

  it("distinguishes an empty saved-ref collection from an infrastructure failure", async () => {
    const empty = { ...collection, references: [] };
    vi.mocked(createAdminClient).mockReturnValue({
      rpc: vi.fn().mockResolvedValue({ data: empty, error: null }),
    } as never);

    const response = await GET(getRequest());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(empty);
  });

  it("rejects a service receipt for a state different from the caller intent", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.mocked(createAdminClient).mockReturnValue({
      rpc: vi.fn().mockResolvedValue({
        data: {
          ...state,
          reference: {
            ...state.reference,
            refId: null,
            savedState: "removed",
            revision: 2,
          },
          reused: false,
        },
        error: null,
      }),
    } as never);

    const response = await PUT(putRequest({
      topicKey: "venue",
      messageId: MESSAGE,
      desiredState: "saved",
      expectedRevision: 1,
      requestId: REQUEST_ID,
    }));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      code: "AMORA_PREPARATION_TOPIC_MESSAGE_REF_INVALID_RESPONSE",
    });
  });
});
