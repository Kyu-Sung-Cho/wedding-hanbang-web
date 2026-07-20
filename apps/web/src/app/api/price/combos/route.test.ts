import { createHash } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  createClientFromRequest: vi.fn(),
  pricesIn: vi.fn(),
  pricesEq: vi.fn(),
  optionsIn: vi.fn(),
  comboSelect: vi.fn(),
  comboUserEq: vi.fn(),
  comboKeyEq: vi.fn(),
  maybeSingle: vi.fn(),
  rpc: vi.fn(),
  rpcSingle: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClientFromRequest: mocks.createClientFromRequest,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mocks.createAdminClient,
}));

import { GET, POST } from "./route";
import { MOBILE_BRIDGE_RESPONSE_BYTES_HEADER } from "@/lib/mobile/boundedJsonResponse";

const USER_ID = "40000000-0000-4000-8000-000000000001";
const VENDOR_ID = "10000000-0000-4000-8000-000000000001";
const AGENCY_ID = "20000000-0000-4000-8000-000000000001";
const PRICE_ID = "30000000-0000-4000-8000-000000000001";
const IDEMPOTENCY_KEY = "60000000-0000-4000-8000-000000000001";

function comboRequest(
  body: unknown,
  idempotencyKey: string | null = IDEMPOTENCY_KEY,
  extraHeaders: HeadersInit = {},
) {
  const headers = new Headers({
    "content-type": "application/json",
    "sec-fetch-site": "same-origin",
    "x-forwarded-for": `${Math.floor(Math.random() * 200) + 1}.0.0.1`,
    ...extraHeaders,
  });
  if (idempotencyKey) headers.set("idempotency-key", idempotencyKey);
  return new Request("https://hanbang.ai/api/price/combos", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

function streamedComboRequest(chunks: string[]) {
  const encoder = new TextEncoder();
  let index = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      const chunk = chunks[index];
      index += 1;
      if (chunk === undefined) {
        controller.close();
        return;
      }
      controller.enqueue(encoder.encode(chunk));
    },
  });
  return new Request("https://hanbang.ai/api/price/combos", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": IDEMPOTENCY_KEY,
      "sec-fetch-site": "same-origin",
      "x-forwarded-for": `${Math.floor(Math.random() * 200) + 1}.0.0.1`,
    },
    body,
    duplex: "half",
  } as RequestInit & { duplex: "half" });
}

function validBody() {
  return {
    name: "우리 조합",
    selections: {
      studio: {
        vendor_id: VENDOR_ID,
        agency_id: AGENCY_ID,
        base_krw: 1_240_000,
        selected_options: [{ name: "담당자 지정", krw: 1 }],
        custom_krw: null,
      },
      dress: null,
      makeup: null,
    },
  };
}

function normalizedRequestHash(body = validBody()) {
  return createHash("sha256").update(JSON.stringify(body)).digest("hex");
}

describe("GET /api/price/combos", () => {
  it("returns only the latest saved combo through the bounded mobile contract", async () => {
    const latest = {
      id: "50000000-0000-4000-8000-000000000001",
      name: "최근 조합",
      selections: validBody().selections,
      total_krw: 1_440_000,
      created_at: "2026-07-20T00:00:00.000Z",
      updated_at: "2026-07-20T00:00:00.000Z",
    };
    const limit = vi.fn().mockResolvedValue({ data: [latest], error: null });
    const order = vi.fn().mockReturnValue({ limit });
    const eq = vi.fn().mockReturnValue({ order });
    const select = vi.fn().mockReturnValue({ eq });
    mocks.createClientFromRequest.mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: USER_ID } } }) },
      from: vi.fn().mockReturnValue({ select }),
    });

    const response = await GET(new Request("https://hanbang.ai/api/price/combos"));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("private");
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(limit).toHaveBeenCalledWith(1);
    await expect(response.json()).resolves.toEqual({ combos: [latest] });
    expect(response.headers.get(MOBILE_BRIDGE_RESPONSE_BYTES_HEADER)).toMatch(/^[1-9][0-9]*$/);
  });
});

describe("POST /api/price/combos", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.pricesEq.mockResolvedValue({
      data: [{
        official_price_id: PRICE_ID,
        vendor_id: VENDOR_ID,
        category: "studio",
        agency_id: AGENCY_ID,
        price_min_krw: 1_240_000,
      }],
      error: null,
    });
    mocks.pricesIn.mockReturnValue({ eq: mocks.pricesEq });
    mocks.optionsIn.mockResolvedValue({
      data: [{
        official_price_id: PRICE_ID,
        name: "담당자 지정",
        price_min_krw: 200_000,
      }],
      error: null,
    });
    mocks.maybeSingle.mockResolvedValue({ data: null, error: null });
    mocks.comboKeyEq.mockReturnValue({ maybeSingle: mocks.maybeSingle });
    mocks.comboUserEq.mockReturnValue({ eq: mocks.comboKeyEq });
    mocks.comboSelect.mockReturnValue({ eq: mocks.comboUserEq });
    mocks.rpcSingle.mockResolvedValue({
      data: {
        id: "50000000-0000-4000-8000-000000000001",
        name: "우리 조합",
        selections: validBody().selections,
        total_krw: 1_440_000,
        request_hash: normalizedRequestHash(),
        replayed: false,
      },
      error: null,
    });
    mocks.rpc.mockReturnValue({ single: mocks.rpcSingle });
    mocks.createAdminClient.mockReturnValue({ rpc: mocks.rpc });
    mocks.createClientFromRequest.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: USER_ID } } }),
      },
      from: vi.fn((table: string) => {
        if (table === "v_public_prices") {
          return { select: vi.fn(() => ({ in: mocks.pricesIn })) };
        }
        if (table === "v_public_price_options") {
          return { select: vi.fn(() => ({ in: mocks.optionsIn })) };
        }
        if (table === "combos") {
          return { select: mocks.comboSelect };
        }
        throw new Error(`unexpected table: ${table}`);
      }),
    });
  });

  it("requires authentication before reading catalog data", async () => {
    const from = vi.fn();
    mocks.createClientFromRequest.mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }) },
      from,
    });
    const response = await POST(comboRequest(validBody()));
    expect(response.status).toBe(401);
    expect(from).not.toHaveBeenCalled();
  });

  it("rejects cross-site cookie mutations before authentication", async () => {
    const response = await POST(comboRequest(validBody(), IDEMPOTENCY_KEY, {
      origin: "https://attacker.example",
      "sec-fetch-site": "cross-site",
    }));

    expect(response.status).toBe(403);
    expect(mocks.createClientFromRequest).not.toHaveBeenCalled();
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it("accepts a native Bearer mutation without browser origin metadata", async () => {
    const request = comboRequest(validBody(), IDEMPOTENCY_KEY, {
      authorization: "Bearer native-session-token",
    });
    request.headers.delete("sec-fetch-site");

    const response = await POST(request);

    expect(response.status).toBe(201);
    expect(mocks.createClientFromRequest).toHaveBeenCalledOnce();
    expect(mocks.rpc).toHaveBeenCalledOnce();
  });

  it("requires a UUID idempotency key before reading catalog data", async () => {
    const response = await POST(comboRequest(validBody(), null));
    expect(response.status).toBe(400);
    expect(mocks.pricesIn).not.toHaveBeenCalled();
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it("stops a chunked body at the byte cap before catalog or service access", async () => {
    const response = await POST(streamedComboRequest([
      "x".repeat(20_000),
      "x".repeat(20_000),
    ]));

    expect(response.status).toBe(413);
    expect(mocks.pricesIn).not.toHaveBeenCalled();
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it("counts UTF-8 bytes rather than JavaScript characters", async () => {
    const response = await POST(streamedComboRequest([
      "가".repeat(11_000),
    ]));

    expect(response.status).toBe(413);
    expect(mocks.pricesIn).not.toHaveBeenCalled();
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it("stores the authenticated owner and server-repriced total", async () => {
    const response = await POST(comboRequest(validBody()));
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      combo: expect.objectContaining({
        id: "50000000-0000-4000-8000-000000000001",
        total_krw: 1_440_000,
      }),
    });
    expect(mocks.rpc).toHaveBeenCalledWith(
      "save_price_combo_service_v1",
      expect.objectContaining({
        p_idempotency_key: IDEMPOTENCY_KEY,
        p_user_id: USER_ID,
        p_name: "우리 조합",
        p_request_hash: normalizedRequestHash(),
        p_total_krw: 1_440_000,
        p_selections: expect.objectContaining({
          studio: expect.objectContaining({
            selected_options: [{ name: "담당자 지정", krw: 200_000 }],
          }),
        }),
      }),
    );
  });

  it("returns the existing row for an exact replay without repricing or inserting", async () => {
    mocks.maybeSingle.mockResolvedValue({
      data: {
        id: "50000000-0000-4000-8000-000000000001",
        name: "우리 조합",
        selections: validBody().selections,
        total_krw: 1_440_000,
        created_at: "2026-07-18T00:00:00.000Z",
        updated_at: "2026-07-18T00:00:00.000Z",
        request_hash: normalizedRequestHash(),
      },
      error: null,
    });
    const response = await POST(comboRequest(validBody()));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      combo: expect.objectContaining({
        id: "50000000-0000-4000-8000-000000000001",
      }),
      replayed: true,
    });
    expect(mocks.pricesIn).not.toHaveBeenCalled();
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it("rejects reuse of one idempotency key for different content", async () => {
    mocks.maybeSingle.mockResolvedValue({
      data: {
        id: "50000000-0000-4000-8000-000000000001",
        request_hash: "b".repeat(64),
      },
      error: null,
    });
    const response = await POST(comboRequest(validBody()));
    expect(response.status).toBe(409);
    expect(mocks.pricesIn).not.toHaveBeenCalled();
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it("recovers the winner when concurrent inserts race on the unique key", async () => {
    const winner = {
      id: "50000000-0000-4000-8000-000000000001",
      name: "우리 조합",
      selections: validBody().selections,
      total_krw: 1_440_000,
      created_at: "2026-07-18T00:00:00.000Z",
      updated_at: "2026-07-18T00:00:00.000Z",
      request_hash: normalizedRequestHash(),
    };
    mocks.maybeSingle
      .mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce({ data: winner, error: null });
    mocks.rpcSingle.mockResolvedValue({ data: null, error: { code: "23505" } });

    const response = await POST(comboRequest(validBody()));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      combo: expect.objectContaining({ id: winner.id }),
      replayed: true,
    });
  });

  it("fails closed when the selected vendor is no longer public", async () => {
    mocks.pricesEq.mockResolvedValue({ data: [], error: null });
    const response = await POST(comboRequest(validBody()));
    expect(response.status).toBe(409);
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it("rejects unknown keys and an empty combination", async () => {
    const response = await POST(comboRequest({
      selections: { studio: null, dress: null, makeup: null },
      user_id: USER_ID,
    }));
    expect(response.status).toBe(400);
    expect(mocks.pricesIn).not.toHaveBeenCalled();
  });

  it("fails closed when the destination-fenced service client is unavailable", async () => {
    mocks.createAdminClient.mockImplementation(() => {
      throw new Error("SUPABASE_SERVICE_DESTINATION_INVALID");
    });

    const response = await POST(comboRequest(validBody()));
    expect(response.status).toBe(503);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("fails closed when the service RPC returns no row without an error", async () => {
    mocks.rpcSingle.mockResolvedValue({ data: null, error: null });

    const response = await POST(comboRequest(validBody()));
    expect(response.status).toBe(503);
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });
});
