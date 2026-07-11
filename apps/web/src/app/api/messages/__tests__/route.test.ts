import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClientFromRequest } from "@/lib/supabase/server";
import {
  POST,
  VENDOR_MESSAGES_DISABLED_CODE,
  VENDOR_MESSAGES_ENABLED,
} from "../route";

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClientFromRequest: vi.fn(),
}));

vi.mock("@/utils/rateLimit", () => ({
  checkRateLimit: vi.fn(),
  rateLimitKey: vi.fn(),
}));

describe("/api/messages POST hard-disable contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 503 before auth, body parsing, or vendor message storage", async () => {
    const json = vi.fn(() => Promise.resolve({
      vendorId: "12345678-1234-4234-9234-123456789abc",
      content: "연락처가 포함된 민감한 문의",
    }));

    const response = await POST({ json } as unknown as Request);
    const payload = await response.json();

    expect(VENDOR_MESSAGES_ENABLED).toBe(false);
    expect(response.status).toBe(503);
    expect(payload).toEqual({
      error: "업체 연결 준비 중입니다. 현재 문의는 업체에 전송되지 않으며 저장되지 않습니다.",
      code: VENDOR_MESSAGES_DISABLED_CODE,
    });
    expect(VENDOR_MESSAGES_DISABLED_CODE).toBe("vendor_messages_disabled");
    expect(json).not.toHaveBeenCalled();
    expect(createClientFromRequest).not.toHaveBeenCalled();
    expect(createAdminClient).not.toHaveBeenCalled();
  });
});
