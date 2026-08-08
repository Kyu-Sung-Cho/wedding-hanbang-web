import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  verifyAdmin: vi.fn(),
  getServiceClient: vi.fn(),
}));

vi.mock("@/utils/trustedMutation", () => ({
  isTrustedMutationRequest: vi.fn(() => true),
}));

vi.mock("@/lib/utils/adminAuth", () => ({
  verifyAdmin: mocks.verifyAdmin,
  getServiceClient: mocks.getServiceClient,
}));

import { POST } from "./route";

const POST_ID = "00000000-0000-4000-8000-000000000001";
const ADMIN_ID = "00000000-0000-4000-8000-000000000002";
const EVENT_ID = "00000000-0000-4000-8000-000000000003";
const IDEMPOTENCY_KEY = "00000000-0000-4000-8000-000000000004";
const NOTICE_ID = "00000000-0000-4000-8000-000000000005";

function validReceipt(
  action: "hide" | "restore" | "soft_delete",
  overrides: Record<string, unknown> = {},
) {
  const contained = action !== "restore";
  return {
    ok: true,
    receipt_version: 3,
    event_id: EVENT_ID,
    notice_id: NOTICE_ID,
    operation_key: IDEMPOTENCY_KEY,
    target_type: "post",
    target_id: POST_ID,
    report_id: null,
    status: null,
    requested_action: action,
    action,
    content_action: action,
    target_contained: contained,
    source_event_id: action === "restore" ? EVENT_ID : null,
    original_outcome: {
      content_action: action,
      target_contained: contained,
      report_status: null,
    },
    current_postcondition: {
      target_contained: contained,
      superseded: false,
      causal_head_event_id: EVENT_ID,
      author_state: {},
    },
    ...overrides,
  };
}

function request(body: unknown, idempotencyKey: string | null = IDEMPOTENCY_KEY) {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (idempotencyKey) headers.set("Idempotency-Key", idempotencyKey);
  return new NextRequest(`https://hanbang.ai/api/admin/posts/${POST_ID}/moderate`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

function context(id = POST_ID) {
  return { params: Promise.resolve({ id }) };
}

describe("POST /api/admin/posts/:id/moderate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.verifyAdmin.mockResolvedValue({
      authorized: true,
      userId: ADMIN_ID,
    });
  });

  it("requires an authenticated admin identity", async () => {
    mocks.verifyAdmin.mockResolvedValue({ authorized: false });

    const response = await POST(request({ action: "hide", reason: "개인정보 노출" }), context());

    expect(response.status).toBe(401);
    expect(mocks.getServiceClient).not.toHaveBeenCalled();
  });

  it("rejects hard deletion and missing reasons before opening the service client", async () => {
    const hardDelete = await POST(
      request({ action: "delete", reason: "삭제" }),
      context()
    );
    const noReason = await POST(request({ action: "hide", reason: " " }), context());

    expect(hardDelete.status).toBe(400);
    expect(noReason.status).toBe(400);
    expect(mocks.getServiceClient).not.toHaveBeenCalled();
  });

  it("requires a UUID idempotency key before opening the service client", async () => {
    const missing = await POST(
      request({ action: "hide", reason: "confirmed safety action" }, null),
      context(),
    );
    const malformed = await POST(
      request(
        { action: "hide", reason: "confirmed safety action" },
        "retry-me",
      ),
      context(),
    );

    expect(missing.status).toBe(400);
    expect(malformed.status).toBe(400);
    expect(mocks.getServiceClient).not.toHaveBeenCalled();
  });

  it("records a reversible action through the atomic service-only RPC", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: validReceipt("soft_delete"),
      error: null,
    });
    mocks.getServiceClient.mockReturnValue({ rpc });

    const response = await POST(
      request({ action: "soft_delete", reason: "반복적인 개인정보 노출" }),
      context()
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(rpc).toHaveBeenCalledWith("community_moderate_content", {
      p_target_type: "post",
      p_target_id: POST_ID,
      p_action: "soft_delete",
      p_reason: "반복적인 개인정보 노출",
      p_admin_id: ADMIN_ID,
      p_idempotency_key: IDEMPOTENCY_KEY,
    });
  });

  it("fails closed when the audited schema is unavailable", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: {
        code: "PGRST202",
        message: "Could not find community_moderate_content",
      },
    });
    mocks.getServiceClient.mockReturnValue({ rpc });

    const response = await POST(
      request({ action: "hide", reason: "검토 중 임시 보호" }),
      context()
    );
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.code).toBe("COMMUNITY_MODERATION_SCHEMA_UNAVAILABLE");
  });

  it("returns a stable conflict when an independent safety decision blocks restore", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: {
        code: "55000",
        message: "confirmed reports still require containment",
      },
    });
    mocks.getServiceClient.mockReturnValue({ rpc });

    const response = await POST(
      request({ action: "restore", reason: "재검토 결과 복구 요청" }),
      context(),
    );
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(body.code).toBe("COMMUNITY_MODERATION_CONFLICT");
  });

  it("returns a stable conflict when an operation key names another command", async () => {
    mocks.getServiceClient.mockReturnValue({
      rpc: vi.fn().mockResolvedValue({
        data: null,
        error: {
          code: "23505",
          message: "COMMUNITY_MODERATION_IDEMPOTENCY_CONFLICT",
        },
      }),
    });

    const response = await POST(
      request({ action: "hide", reason: "confirmed safety action" }),
      context(),
    );
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.code).toBe("COMMUNITY_MODERATION_CONFLICT");
  });

  it.each([
    [
      "operation identity",
      "hide",
      validReceipt("hide", {
        operation_key: "00000000-0000-4000-8000-000000000099",
      }),
    ],
    [
      "requested action",
      "hide",
      validReceipt("hide", { requested_action: "restore" }),
    ],
    [
      "restore postcondition",
      "restore",
      validReceipt("restore", {
        target_contained: true,
        current_postcondition: {
          target_contained: true,
          superseded: false,
          causal_head_event_id: EVENT_ID,
          author_state: {},
        },
      }),
    ],
  ])("fails closed on an inconsistent %s receipt", async (_label, action, data) => {
    mocks.getServiceClient.mockReturnValue({
      rpc: vi.fn().mockResolvedValue({ data, error: null }),
    });

    const response = await POST(
      request({ action, reason: "confirmed safety action" }),
      context(),
    );
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.code).toBe("COMMUNITY_MODERATION_INVALID_RECEIPT");
  });

  it("accepts an exact stored replay receipt without mutable replay telemetry", async () => {
    const receipt = validReceipt("hide");
    mocks.getServiceClient.mockReturnValue({
      rpc: vi.fn().mockResolvedValue({
        data: receipt,
        error: null,
      }),
    });

    const response = await POST(
      request({ action: "hide", reason: "confirmed safety action" }),
      context(),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, result: receipt });
    expect(receipt).not.toHaveProperty("idempotent_replay");
  });

  it("maps a missing or corrupt durable receipt to a fail-closed 503", async () => {
    mocks.getServiceClient.mockReturnValue({
      rpc: vi.fn().mockResolvedValue({
        data: null,
        error: {
          code: "55000",
          message: "COMMUNITY_MODERATION_RECEIPT_DIGEST_MISMATCH",
        },
      }),
    });

    const response = await POST(
      request({ action: "hide", reason: "confirmed safety action" }),
      context(),
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      code: "COMMUNITY_MODERATION_INVALID_RECEIPT",
    });
  });

  it("fails closed when the atomic RPC returns an unverifiable receipt", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: { ok: true, event_id: "not-a-uuid" },
      error: null,
    });
    mocks.getServiceClient.mockReturnValue({ rpc });

    const response = await POST(
      request({ action: "hide", reason: "확인 가능한 영수증 필요" }),
      context(),
    );
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.code).toBe("COMMUNITY_MODERATION_INVALID_RECEIPT");
  });
});
