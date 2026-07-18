import { createHash } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClientFromRequest: vi.fn(),
  pricesIn: vi.fn(),
  pricesEq: vi.fn(),
  optionsIn: vi.fn(),
  comboSelect: vi.fn(),
  comboUserEq: vi.fn(),
  comboKeyEq: vi.fn(),
  maybeSingle: vi.fn(),
  insert: vi.fn(),
  single: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClientFromRequest: mocks.createClientFromRequest,
}));

import { POST } from "./route";

const USER_ID = "40000000-0000-4000-8000-000000000001";
const VENDOR_ID = "10000000-0000-4000-8000-000000000001";
const AGENCY_ID = "20000000-0000-4000-8000-000000000001";
const PRICE_ID = "30000000-0000-4000-8000-000000000001";
const IDEMPOTENCY_KEY = "60000000-0000-4000-8000-000000000001";

function comboRequest(body: unknown, idempotencyKey: string | null = IDEMPOTENCY_KEY) {
  const headers = new Headers({
    "content-type": "application/json",
    "x-forwarded-for": `${Math.floor(Math.random() * 200) + 1}.0.0.1`,
  });
  if (idempotencyKey) headers.set("idempotency-key", idempotencyKey);
  return new Request("https://hanbang.ai/api/price/combos", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
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
    mocks.single.mockResolvedValue({
      data: { id: "50000000-0000-4000-8000-000000000001" },
      error: null,
    });
    mocks.insert.mockReturnValue({
      select: vi.fn(() => ({ single: mocks.single })),
    });
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
          return { insert: mocks.insert, select: mocks.comboSelect };
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

  it("requires a UUID idempotency key before reading catalog data", async () => {
    const response = await POST(comboRequest(validBody(), null));
    expect(response.status).toBe(400);
    expect(mocks.pricesIn).not.toHaveBeenCalled();
    expect(mocks.insert).not.toHaveBeenCalled();
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
    expect(mocks.insert).toHaveBeenCalledWith(expect.objectContaining({
      idempotency_key: IDEMPOTENCY_KEY,
      user_id: USER_ID,
      name: "우리 조합",
      request_hash: normalizedRequestHash(),
      total_krw: 1_440_000,
      selections: expect.objectContaining({
        studio: expect.objectContaining({
          selected_options: [{ name: "담당자 지정", krw: 200_000 }],
        }),
      }),
    }));
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
    expect(mocks.insert).not.toHaveBeenCalled();
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
    expect(mocks.insert).not.toHaveBeenCalled();
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
    mocks.single.mockResolvedValue({ data: null, error: { code: "23505" } });

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
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it("rejects unknown keys and an empty combination", async () => {
    const response = await POST(comboRequest({
      selections: { studio: null, dress: null, makeup: null },
      user_id: USER_ID,
    }));
    expect(response.status).toBe(400);
    expect(mocks.pricesIn).not.toHaveBeenCalled();
  });
});
