import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClientFromRequest } from "@/lib/supabase/server";
import {
  GET,
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

  it("returns 410 before auth, body parsing, or vendor message storage", async () => {
    const response = await POST();
    const payload = await response.json();

    expect(VENDOR_MESSAGES_ENABLED).toBe(false);
    expect(response.status).toBe(410);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(payload).toEqual({
      error: "업체 연결을 현재 제공하지 않습니다. 문의는 업체에 전송되지 않으며 저장되지 않습니다.",
      code: VENDOR_MESSAGES_DISABLED_CODE,
    });
    expect(VENDOR_MESSAGES_DISABLED_CODE).toBe("vendor_messages_disabled");
    expect(createClientFromRequest).not.toHaveBeenCalled();
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("retires message reads without inspecting the request", async () => {
    const response = await GET();

    expect(response.status).toBe(410);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(createClientFromRequest).not.toHaveBeenCalled();
    expect(createAdminClient).not.toHaveBeenCalled();
  });
});
