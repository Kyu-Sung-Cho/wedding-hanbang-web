import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

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

import { PATCH } from "./route";

const REPORT_ID = "00000000-0000-4000-8000-000000000001";
const ADMIN_ID = "00000000-0000-4000-8000-000000000002";
const IDEMPOTENCY_KEY = "00000000-0000-4000-8000-000000000003";
const EVENT_ID = "00000000-0000-4000-8000-000000000004";
const TARGET_ID = "00000000-0000-4000-8000-000000000005";
const NOTICE_ID = "00000000-0000-4000-8000-000000000006";

function validReceipt(
  status: "reviewed" | "resolved" | "dismissed",
  contentAction: "none" | "hide" | "already_contained" | "restore" | "retained_containment",
  overrides: Record<string, unknown> = {},
) {
  const targetContained =
    contentAction === "hide" ||
    contentAction === "already_contained" ||
    contentAction === "retained_containment";
  const hasNotice = status === "resolved" || contentAction !== "none";
  const action = status === "resolved"
    ? "hide"
    : status === "dismissed" && contentAction !== "none"
      ? "restore"
      : "review_report";

  return {
    ok: true,
    receipt_version: 3,
    event_id: EVENT_ID,
    notice_id: hasNotice ? NOTICE_ID : null,
    operation_key: IDEMPOTENCY_KEY,
    target_type: "post",
    target_id: TARGET_ID,
    report_id: REPORT_ID,
    status,
    requested_action: status,
    action,
    content_action: contentAction,
    target_contained: targetContained,
    source_event_id:
      status === "dismissed" && contentAction !== "none" ? EVENT_ID : null,
    original_outcome: {
      content_action: contentAction,
      target_contained: targetContained,
      report_status: status,
    },
    current_postcondition: {
      target_contained: targetContained,
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
  return new NextRequest(`https://hanbang.ai/api/admin/reports/${REPORT_ID}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify(body),
  });
}

describe("PATCH /api/admin/reports/:id", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.verifyAdmin.mockResolvedValue({
      authorized: true,
      userId: ADMIN_ID,
    });
  });

  it("requires a durable review reason", async () => {
    const response = await PATCH(
      request({ status: "reviewed", reason: "" }),
      { params: Promise.resolve({ id: REPORT_ID }) }
    );

    expect(response.status).toBe(400);
    expect(mocks.getServiceClient).not.toHaveBeenCalled();
  });

  it("requires a UUID idempotency key for a content report decision", async () => {
    const response = await PATCH(
      request(
        { status: "resolved", reason: "confirmed policy violation" },
        null,
      ),
      { params: Promise.resolve({ id: REPORT_ID }) },
    );

    expect(response.status).toBe(400);
    expect(mocks.getServiceClient).not.toHaveBeenCalled();
  });

  it("reviews a public-content report through the atomic resolution RPC", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: validReceipt("dismissed", "none"),
      error: null,
    });
    mocks.getServiceClient.mockReturnValue({ rpc });

    const response = await PATCH(
      request({ status: "dismissed", reason: "신고 사유와 원문을 대조함" }),
      { params: Promise.resolve({ id: REPORT_ID }) }
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(rpc).toHaveBeenCalledWith("community_review_report_atomic", {
      p_report_id: REPORT_ID,
      p_status: "dismissed",
      p_reason: "신고 사유와 원문을 대조함",
      p_admin_id: ADMIN_ID,
      p_idempotency_key: IDEMPOTENCY_KEY,
    });
  });

  it("fails closed when a resolved receipt does not prove containment", async () => {
    mocks.getServiceClient.mockReturnValue({
      rpc: vi.fn().mockResolvedValue({
        data: {
          ...validReceipt("resolved", "hide"),
          target_contained: false,
        },
        error: null,
      }),
    });

    const response = await PATCH(
      request({ status: "resolved", reason: "confirmed policy violation" }),
      { params: Promise.resolve({ id: REPORT_ID }) }
    );
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.code).toBe("COMMUNITY_REPORT_ATOMIC_RECEIPT_INVALID");
  });

  it.each([
    [
      "operation identity",
      "resolved",
      validReceipt("resolved", "hide", {
        operation_key: "00000000-0000-4000-8000-000000000099",
      }),
    ],
    [
      "resolved notice",
      "resolved",
      validReceipt("resolved", "already_contained", { notice_id: null }),
    ],
    [
      "dismissed restore postcondition",
      "dismissed",
      validReceipt("dismissed", "restore", {
        target_contained: true,
        current_postcondition: {
          target_contained: true,
          superseded: false,
          causal_head_event_id: EVENT_ID,
          author_state: {},
        },
      }),
    ],
    [
      "reviewed notice",
      "reviewed",
      validReceipt("reviewed", "none", { notice_id: NOTICE_ID }),
    ],
  ])("fails closed on an inconsistent %s receipt", async (_label, status, data) => {
    mocks.getServiceClient.mockReturnValue({
      rpc: vi.fn().mockResolvedValue({ data, error: null }),
    });

    const response = await PATCH(
      request({ status, reason: "durable moderation decision" }),
      { params: Promise.resolve({ id: REPORT_ID }) },
    );
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.code).toBe("COMMUNITY_REPORT_ATOMIC_RECEIPT_INVALID");
  });

  it("accepts an exact stored report replay without mutable replay telemetry", async () => {
    const receipt = validReceipt("resolved", "hide");
    mocks.getServiceClient.mockReturnValue({
      rpc: vi.fn().mockResolvedValue({
        data: receipt,
        error: null,
      }),
    });

    const response = await PATCH(
      request({ status: "resolved", reason: "durable moderation decision" }),
      { params: Promise.resolve({ id: REPORT_ID }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, result: receipt });
    expect(receipt).not.toHaveProperty("idempotent_replay");
  });

  it("maps a missing or corrupt durable report receipt to a fail-closed 503", async () => {
    mocks.getServiceClient.mockReturnValue({
      rpc: vi.fn().mockResolvedValue({
        data: null,
        error: {
          code: "55000",
          message: "COMMUNITY_MODERATION_RECEIPT_UNAVAILABLE",
        },
      }),
    });

    const response = await PATCH(
      request({ status: "resolved", reason: "durable moderation decision" }),
      { params: Promise.resolve({ id: REPORT_ID }) },
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      code: "COMMUNITY_REPORT_ATOMIC_RECEIPT_INVALID",
    });
  });

  it("returns a stable conflict for an operation-key or transition conflict", async () => {
    mocks.getServiceClient.mockReturnValue({
      rpc: vi.fn().mockResolvedValue({
        data: null,
        error: {
          code: "23505",
          message: "COMMUNITY_MODERATION_IDEMPOTENCY_CONFLICT",
        },
      }),
    });

    const response = await PATCH(
      request({ status: "resolved", reason: "durable moderation decision" }),
      { params: Promise.resolve({ id: REPORT_ID }) },
    );
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.code).toBe("COMMUNITY_REPORT_REVIEW_CONFLICT");
  });

  it("fails closed when the audited report schema is unavailable", async () => {
    mocks.getServiceClient.mockReturnValue({
      rpc: vi.fn().mockResolvedValue({
        data: null,
        error: {
          code: "PGRST202",
          message: "Could not find community_review_report_atomic",
        },
      }),
    });

    const response = await PATCH(
      request({ status: "reviewed", reason: "운영 검토 시작" }),
      { params: Promise.resolve({ id: REPORT_ID }) }
    );
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.code).toBe("COMMUNITY_REPORT_REVIEW_SCHEMA_UNAVAILABLE");
  });

  it("reviews and restricts one cohort member report atomically", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: { ok: true, event_id: "cohort-event-id" },
      error: null,
    });
    mocks.getServiceClient.mockReturnValue({ rpc });

    const response = await PATCH(
      request({
        status: "resolved",
        reason: "반복 영업 메시지 원문 확인",
        action: "deactivate_member",
      }),
      { params: Promise.resolve({ id: `member:${REPORT_ID}` }) }
    );

    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith(
      "community_review_cohort_member_report",
      {
        p_report_id: REPORT_ID,
        p_status: "resolved",
        p_reason: "반복 영업 메시지 원문 확인",
        p_admin_id: ADMIN_ID,
        p_deactivate_member: true,
      }
    );
  });
});
