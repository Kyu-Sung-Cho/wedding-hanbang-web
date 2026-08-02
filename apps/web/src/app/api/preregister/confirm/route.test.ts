import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  checkRateLimitPersistent: vi.fn(),
  createAdminClient: vi.fn(),
  rpc: vi.fn(),
  decrypt: vi.fn(),
}));

vi.mock("@/utils/rateLimit", () => ({
  checkRateLimitPersistent: mocks.checkRateLimitPersistent,
  rateLimitKey: () => "preregister-confirm:ip-key",
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mocks.createAdminClient,
}));

vi.mock("@/lib/preregistration/preregistrationIntent", () => ({
  CONFIRM_PREREGISTRATION_INTENT_RPC: "confirm_preregistration_intent",
  READ_PREREGISTRATION_INTENT_RPC: "read_preregistration_intent",
  REVOKE_PREREGISTRATION_INTENT_RPC: "revoke_preregistration_intent",
  digestPreregistrationIntentToken: (token: unknown) =>
    token === "A".repeat(43) ? "a".repeat(64) : null,
  digestPreregistrationEmail: () => "b".repeat(64),
  decryptPreregistrationPayload: mocks.decrypt,
  isPreregistrationIntentEncryptionConfigured: () => true,
}));

import { POST } from "./route";

const TOKEN = "A".repeat(43);
const ENVELOPE = `v1.${"I".repeat(16)}.${"T".repeat(22)}.${"C".repeat(32)}`;
const PAYLOAD = {
  email: "person@example.com",
  name: "김한방",
  weddingDate: "2026-12-20",
  role: "bride",
  message: "참여하고 싶어요.",
  isBetaCandidate: true,
  utmSource: "naver",
  utmMedium: "social",
  utmCampaign: "launch_2026",
  privacyVersion: "2026-08-02",
};

function request(action: "confirm" | "cancel", headers: HeadersInit = {}) {
  return new Request("https://hanbang.ai/api/preregister/confirm", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://hanbang.ai",
      "sec-fetch-site": "same-origin",
      ...headers,
    },
    body: JSON.stringify({ token: TOKEN, action }),
  });
}

describe("preregistration confirmation route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.checkRateLimitPersistent.mockResolvedValue(null);
    mocks.decrypt.mockReturnValue(PAYLOAD);
    mocks.rpc.mockImplementation(async (name: string) => {
      if (name === "read_preregistration_intent") return { data: ENVELOPE, error: null };
      if (name === "confirm_preregistration_intent") return { data: "confirmed", error: null };
      if (name === "revoke_preregistration_intent") return { data: true, error: null };
      return { data: null, error: new Error("unexpected RPC") };
    });
    mocks.createAdminClient.mockReturnValue({ rpc: mocks.rpc });
  });

  it("rejects cross-site POSTs before rate-limit or database work", async () => {
    const response = await POST(request("confirm", {
      origin: "https://attacker.example",
      "sec-fetch-site": "cross-site",
    }));
    expect(response.status).toBe(403);
    expect(mocks.checkRateLimitPersistent).not.toHaveBeenCalled();
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it("reads encrypted payload then atomically promotes and consumes it", async () => {
    const response = await POST(request("confirm"));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true, status: "confirmed" });
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(mocks.rpc).toHaveBeenNthCalledWith(1, "read_preregistration_intent", {
      p_token_digest_hex: "a".repeat(64),
    });
    expect(mocks.rpc).toHaveBeenNthCalledWith(2, "confirm_preregistration_intent", {
      p_token_digest_hex: "a".repeat(64),
      p_email_lookup_digest_hex: "b".repeat(64),
      p_email: "person@example.com",
      p_name: "김한방",
      p_wedding_date: "2026-12-20",
      p_role: "bride",
      p_message: "참여하고 싶어요.",
      p_is_beta_candidate: true,
      p_utm_source: "naver",
      p_utm_medium: "social",
      p_utm_campaign: "launch_2026",
      p_privacy_version: "2026-08-02",
    });
  });

  it("cancels idempotently without decrypting or promoting", async () => {
    const response = await POST(request("cancel"));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true, status: "cancelled" });
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).toHaveBeenCalledWith("revoke_preregistration_intent", {
      p_token_digest_hex: "a".repeat(64),
    });
    expect(mocks.decrypt).not.toHaveBeenCalled();
  });

  it("returns a generic expiry response without exposing registration existence", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: null });
    const response = await POST(request("confirm"));
    expect(response.status).toBe(410);
    await expect(response.json()).resolves.toEqual({
      error: "확인 링크가 유효하지 않거나 만료되었습니다.",
    });
    expect(mocks.decrypt).not.toHaveBeenCalled();
  });

  it("fails closed if the authenticated ciphertext cannot be decrypted", async () => {
    mocks.decrypt.mockReturnValue(null);
    const response = await POST(request("confirm"));
    expect(response.status).toBe(503);
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).not.toHaveBeenCalledWith(
      "confirm_preregistration_intent",
      expect.anything(),
    );
  });
});
