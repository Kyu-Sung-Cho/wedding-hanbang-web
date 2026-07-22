import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  verifyAdmin: vi.fn(),
  getServiceClient: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("@/lib/utils/adminAuth", () => ({
  verifyAdmin: mocks.verifyAdmin,
  getServiceClient: mocks.getServiceClient,
}));

import { GET, POST } from "./route";

const ADMIN_ID = "00000000-0000-4000-8000-000000000001";
const ELIGIBILITY_SHA256 = "a".repeat(64);
const RECEIPT_SHA256 = "b".repeat(64);
const PRICE_ID_1 = "00000000-0000-4000-8000-000000000101";
const PRICE_ID_2 = "00000000-0000-4000-8000-000000000102";

function postRequest(body: unknown, headers: HeadersInit = {}) {
  return new Request("https://hanbang.ai/api/admin/price/bulk-approval", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://hanbang.ai",
      "sec-fetch-site": "same-origin",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

function confirmedBody(overrides: Record<string, unknown> = {}) {
  return {
    eligibility_contract_version: 1,
    confirmation: "approve_automatically_validated_pending",
    expected_eligible_count: 2,
    expected_eligibility_sha256: ELIGIBILITY_SHA256,
    ...overrides,
  };
}

describe("admin automatic validation bulk approval", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.verifyAdmin.mockResolvedValue({ authorized: true, userId: ADMIN_ID });
    mocks.getServiceClient.mockReturnValue({ rpc: mocks.rpc });
  });

  it("fails closed before service access for a non-admin count request", async () => {
    mocks.verifyAdmin.mockResolvedValue({ authorized: false });

    const response = await GET(new Request(
      "https://hanbang.ai/api/admin/price/bulk-approval",
    ));

    expect(response.status).toBe(401);
    expect(mocks.getServiceClient).not.toHaveBeenCalled();
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("gets a bounded eligibility count only from the database contract", async () => {
    mocks.rpc.mockResolvedValue({
      data: {
        eligibility_contract_version: 1,
        batch_eligible_count: 2,
        has_more: false,
        eligibility_sha256: ELIGIBILITY_SHA256,
      },
      error: null,
    });

    const response = await GET(new Request(
      "https://hanbang.ai/api/admin/price/bulk-approval",
    ));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith(
      "get_vendor_disclosure_bulk_approval_eligibility",
      { p_actor_id: ADMIN_ID, p_batch_limit: 25 },
    );
    expect(body).toEqual({
      batch_eligible_count: 2,
      has_more: false,
      count_verified: true,
      can_execute: true,
      batch_limit: 25,
      eligibility_contract_version: 1,
      eligibility_sha256: ELIGIBILITY_SHA256,
    });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("distinguishes a verified empty set from an unavailable count", async () => {
    mocks.rpc.mockResolvedValue({
      data: {
        eligibility_contract_version: 1,
        batch_eligible_count: 0,
        has_more: false,
        eligibility_sha256: null,
      },
      error: null,
    });

    const response = await GET(new Request(
      "https://hanbang.ai/api/admin/price/bulk-approval",
    ));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      batch_eligible_count: 0,
      has_more: false,
      count_verified: true,
      can_execute: false,
      eligibility_sha256: null,
    });
  });

  it("reports the count as unknown when the required RPC is absent", async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { code: "PGRST202", message: "function was not found" },
    });

    const response = await GET(new Request(
      "https://hanbang.ai/api/admin/price/bulk-approval",
    ));
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).toMatchObject({
      batch_eligible_count: null,
      has_more: null,
      count_verified: false,
      can_execute: false,
      blocked_code: "BULK_APPROVAL_DB_SUPPORT_UNAVAILABLE",
    });
  });

  it("does not misclassify an unrelated RPC failure that mentions the function name", async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: {
        code: "57014",
        message: "get_vendor_disclosure_bulk_approval_eligibility statement timeout",
      },
    });

    const response = await GET(new Request(
      "https://hanbang.ai/api/admin/price/bulk-approval",
    ));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      batch_eligible_count: null,
      count_verified: false,
      blocked_code: "BULK_APPROVAL_COUNT_UNAVAILABLE",
    });
  });

  it("rejects malformed RPC data rather than inferring eligibility in the app", async () => {
    mocks.rpc.mockResolvedValue({
      data: {
        eligibility_contract_version: 1,
        batch_eligible_count: 2,
        has_more: false,
        eligibility_sha256: null,
      },
      error: null,
    });

    const response = await GET(new Request(
      "https://hanbang.ai/api/admin/price/bulk-approval",
    ));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      batch_eligible_count: null,
      count_verified: false,
      can_execute: false,
      blocked_code: "BULK_APPROVAL_COUNT_UNAVAILABLE",
    });
  });

  it("rejects cross-site mutation metadata before auth or service access", async () => {
    const response = await POST(postRequest(confirmedBody(), {
      origin: "https://attacker.example",
      "sec-fetch-site": "cross-site",
    }));

    expect(response.status).toBe(403);
    expect(mocks.verifyAdmin).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("requires an authenticated admin with a concrete actor id", async () => {
    mocks.verifyAdmin.mockResolvedValue({ authorized: true });

    const response = await POST(postRequest(confirmedBody()));

    expect(response.status).toBe(401);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("requires a strict explicit human-confirmation payload", async () => {
    for (const body of [
      {},
      confirmedBody({ confirmation: "yes" }),
      confirmedBody({ expected_eligible_count: 0 }),
      confirmedBody({ extra: true }),
    ]) {
      const response = await POST(postRequest(body));
      expect(response.status).toBe(400);
    }
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("rejects an oversized confirmation body without calling the database", async () => {
    const response = await POST(new Request(
      "https://hanbang.ai/api/admin/price/bulk-approval",
      {
        method: "POST",
        headers: {
          origin: "https://hanbang.ai",
          "sec-fetch-site": "same-origin",
          "content-length": "4096",
        },
        body: "{}",
      },
    ));

    expect(response.status).toBe(413);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("invokes only the atomic RPC and accepts an exact all-or-nothing receipt", async () => {
    mocks.rpc.mockResolvedValue({
      data: {
        eligibility_contract_version: 1,
        approved_count: 2,
        approved_price_ids: [PRICE_ID_1, PRICE_ID_2],
        approval_receipt_sha256: RECEIPT_SHA256,
      },
      error: null,
    });

    const response = await POST(postRequest(confirmedBody()));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).toHaveBeenCalledWith(
      "approve_vendor_disclosure_validated_batch",
      {
        p_actor_id: ADMIN_ID,
        p_batch_limit: 25,
        p_expected_eligible_count: 2,
        p_expected_eligibility_sha256: ELIGIBILITY_SHA256,
      },
    );
    expect(body).toEqual({
      batch_eligible_count: 2,
      approved_count: 2,
      conflict_count: 0,
      failed_count: 0,
      batch_limit: 25,
      approval_receipt_sha256: RECEIPT_SHA256,
      results: [{ price_id: PRICE_ID_1 }, { price_id: PRICE_ID_2 }],
    });
  });

  it("returns a conflict when eligibility changed after the human count check", async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { code: "40001", message: "BULK_APPROVAL_ELIGIBILITY_CHANGED" },
    });

    const response = await POST(postRequest(confirmedBody()));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: "BULK_APPROVAL_ELIGIBILITY_CHANGED",
    });
  });

  it("retries one transient row-lock conflict without widening the approval batch", async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: null,
      error: { code: "55P03", message: "could not obtain lock on row" },
    }).mockResolvedValueOnce({
      data: {
        eligibility_contract_version: 1,
        approved_count: 2,
        approved_price_ids: [PRICE_ID_1, PRICE_ID_2],
        approval_receipt_sha256: RECEIPT_SHA256,
      },
      error: null,
    });

    const response = await POST(postRequest(confirmedBody()));

    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledTimes(2);
    expect(mocks.rpc.mock.calls[0]).toEqual(mocks.rpc.mock.calls[1]);
  });

  it("fails closed after the single bounded row-lock retry is exhausted", async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { code: "55P03", message: "could not obtain lock on row" },
    });

    const response = await POST(postRequest(confirmedBody()));

    expect(response.status).toBe(503);
    expect(mocks.rpc).toHaveBeenCalledTimes(2);
    await expect(response.json()).resolves.toMatchObject({
      code: "BULK_APPROVAL_BUSY",
      retryable: true,
    });
  });

  it("fails closed when DB support is absent or an atomic receipt is partial", async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: null,
      error: { code: "PGRST202", message: "function was not found" },
    }).mockResolvedValueOnce({
      data: {
        eligibility_contract_version: 1,
        approved_count: 1,
        approved_price_ids: [PRICE_ID_1],
        approval_receipt_sha256: RECEIPT_SHA256,
      },
      error: null,
    });

    const missing = await POST(postRequest(confirmedBody()));
    const partial = await POST(postRequest(confirmedBody()));

    expect(missing.status).toBe(503);
    await expect(missing.json()).resolves.toMatchObject({
      code: "BULK_APPROVAL_DB_SUPPORT_UNAVAILABLE",
    });
    expect(partial.status).toBe(503);
    await expect(partial.json()).resolves.toMatchObject({
      code: "BULK_APPROVAL_RESULT_INVALID",
    });
  });
});
