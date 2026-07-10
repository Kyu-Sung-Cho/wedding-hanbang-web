import { beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
import { checkRateLimitPersistent } from "@/utils/rateLimit";
import { POST } from "../route";

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(),
}));

vi.mock("@/utils/rateLimit", () => ({
  checkRateLimitPersistent: vi.fn(() => null),
  rateLimitKey: vi.fn(() => "wc-pair:test"),
}));

const RESPONSE_ID = "123e4567-e89b-42d3-a456-426614174000";
const COUPLE_TOKEN = "223e4567-e89b-42d3-a456-426614174000";
const CANONICAL_TOKEN = "323e4567-e89b-42d3-a456-426614174000";

function request(body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest("http://localhost/api/wedding-code/pair", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

function mockAdmin(options: {
  pairingStatus?: string;
  coupleToken?: string | null;
  error?: { message: string } | null;
}) {
  const pairingStatus = options.pairingStatus ?? "waiting";
  const coupleToken = Object.prototype.hasOwnProperty.call(options, "coupleToken")
    ? options.coupleToken
    : pairingStatus === "waiting" || pairingStatus === "paired"
      ? COUPLE_TOKEN
      : null;
  const admin = {
    rpc: vi.fn(() =>
      Promise.resolve({
        data: options.error
          ? null
          : [{ pairing_status: pairingStatus, couple_token: coupleToken }],
        error: options.error ?? null,
      })
    ),
  };
  vi.mocked(createClient).mockReturnValue(admin as unknown as ReturnType<typeof createClient>);
  return admin;
}

describe("/api/wedding-code/pair POST", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects oversized requests before rate limiting or Supabase access", async () => {
    const response = await POST(request({}, { "content-length": "4097" }));
    const body = await response.json();

    expect(response.status).toBe(413);
    expect(body.error).toContain("너무 큽니다");
    expect(checkRateLimitPersistent).not.toHaveBeenCalled();
    expect(createClient).not.toHaveBeenCalled();
  });

  it("rejects malformed identifiers before Supabase access", async () => {
    const response = await POST(request({ response_id: "bad", couple_token: COUPLE_TOKEN }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toContain("잘못된 요청");
    expect(createClient).not.toHaveBeenCalled();
  });

  it("rejects a token that already has two responses", async () => {
    const admin = mockAdmin({ pairingStatus: "full" });

    const response = await POST(request({ response_id: RESPONSE_ID, couple_token: COUPLE_TOKEN }));
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error).toContain("이미 두 분");
    expect(body.pairingStatus).toBe("full");
    expect(admin.rpc).toHaveBeenCalledWith("pair_wedding_code_response", {
      p_response_id: RESPONSE_ID,
      p_couple_token: COUPLE_TOKEN,
    });
  });

  it("links a response that does not already have a couple token", async () => {
    const admin = mockAdmin({ pairingStatus: "waiting" });

    const response = await POST(request({ response_id: RESPONSE_ID, couple_token: COUPLE_TOKEN }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.pairingStatus).toBe("waiting");
    expect(body.coupleToken).toBe(COUPLE_TOKEN);
    expect(admin.rpc).toHaveBeenCalledTimes(1);
  });

  it("fails closed when the atomic pairing RPC is unavailable", async () => {
    mockAdmin({ error: { message: "function missing" } });

    const response = await POST(request({ response_id: RESPONSE_ID, couple_token: COUPLE_TOKEN }));
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.pairingStatus).toBe("error");
  });

  it("treats a same-token retry as an idempotent success", async () => {
    mockAdmin({ pairingStatus: "paired" });
    const response = await POST(
      request({ response_id: RESPONSE_ID, couple_token: COUPLE_TOKEN })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      success: true,
      pairingStatus: "paired",
      coupleToken: COUPLE_TOKEN,
    });
  });

  it("does not expose a token when the response capability is missing", async () => {
    mockAdmin({ pairingStatus: "not_found" });
    const missingResponse = await POST(
      request({ response_id: RESPONSE_ID, couple_token: COUPLE_TOKEN })
    );
    const missingBody = await missingResponse.json();

    expect(missingResponse.status).toBe(409);
    expect(missingBody.pairingStatus).toBe("conflict");
    expect(missingBody.coupleToken).toBeUndefined();
  });

  it("returns the canonical token when a stale tab requests another token", async () => {
    mockAdmin({ pairingStatus: "paired", coupleToken: CANONICAL_TOKEN });
    const response = await POST(
      request({ response_id: RESPONSE_ID, couple_token: COUPLE_TOKEN })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      success: true,
      pairingStatus: "paired",
      coupleToken: CANONICAL_TOKEN,
    });
  });
});
