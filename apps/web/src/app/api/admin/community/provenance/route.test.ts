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

const ADMIN_ID = "00000000-0000-4000-8000-000000000001";
const TARGET_ID = "00000000-0000-4000-8000-000000000002";

function request(body: unknown) {
  return new NextRequest(
    "https://hanbang.ai/api/admin/community/provenance",
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "sec-fetch-site": "same-origin",
      },
      body: JSON.stringify(body),
    }
  );
}

describe("PATCH /api/admin/community/provenance", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.verifyAdmin.mockResolvedValue({
      authorized: true,
      userId: ADMIN_ID,
    });
  });

  it("reclassifies one row through the audited service RPC", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: { ok: true, changed: true },
      error: null,
    });
    mocks.getServiceClient.mockReturnValue({ rpc });

    const response = await PATCH(
      request({
        target_type: "post",
        target_id: TARGET_ID,
        new_origin: "operator",
        reason: "운영 계정의 원본 작성 기록 확인",
      })
    );

    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith(
      "community_reclassify_content_origin",
      {
        p_target_type: "post",
        p_target_id: TARGET_ID,
        p_new_origin: "operator",
        p_reason: "운영 계정의 원본 작성 기록 확인",
        p_admin_id: ADMIN_ID,
      }
    );
  });

  it("does not let an operator mark a row as still unverified", async () => {
    const response = await PATCH(
      request({
        target_type: "comment",
        target_id: TARGET_ID,
        new_origin: "legacy_unverified",
        reason: "확인 못함",
      })
    );

    expect(response.status).toBe(400);
    expect(mocks.getServiceClient).not.toHaveBeenCalled();
  });

  it("fails closed when the provenance RPC is unavailable", async () => {
    mocks.getServiceClient.mockReturnValue({
      rpc: vi.fn().mockResolvedValue({
        data: null,
        error: {
          code: "PGRST202",
          message: "Could not find community_reclassify_content_origin",
        },
      }),
    });

    const response = await PATCH(
      request({
        target_type: "post",
        target_id: TARGET_ID,
        new_origin: "member",
        reason: "작성자 본인 확인 완료",
      })
    );
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.code).toBe("COMMUNITY_PROVENANCE_SCHEMA_UNAVAILABLE");
  });
});
