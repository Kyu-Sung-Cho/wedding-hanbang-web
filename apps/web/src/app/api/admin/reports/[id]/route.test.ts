import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  verifyAdmin: vi.fn(),
  getServiceClient: vi.fn(),
}));

vi.mock("@/lib/utils/adminAuth", () => ({
  verifyAdmin: mocks.verifyAdmin,
  getServiceClient: mocks.getServiceClient,
}));

import { PATCH } from "./route";

const REPORT_ID = "00000000-0000-4000-8000-000000000001";
const ADMIN_ID = "00000000-0000-4000-8000-000000000002";

function request(body: unknown) {
  return new NextRequest(`https://hanbang.ai/api/admin/reports/${REPORT_ID}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
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

  it("reviews a public-content report through the atomic audit RPC", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: { ok: true, event_id: "event-id" },
      error: null,
    });
    mocks.getServiceClient.mockReturnValue({ rpc });

    const response = await PATCH(
      request({ status: "dismissed", reason: "신고 사유와 원문을 대조함" }),
      { params: Promise.resolve({ id: REPORT_ID }) }
    );

    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("community_review_report", {
      p_report_id: REPORT_ID,
      p_status: "dismissed",
      p_reason: "신고 사유와 원문을 대조함",
      p_admin_id: ADMIN_ID,
    });
  });

  it("fails closed when the audited report schema is unavailable", async () => {
    mocks.getServiceClient.mockReturnValue({
      rpc: vi.fn().mockResolvedValue({
        data: null,
        error: {
          code: "PGRST202",
          message: "Could not find community_review_report",
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
