import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";
import {
  HANBANG_EXPECTED_ACTOR_USER_ID_HEADER,
  HANBANG_MUTATION_CONTRACT_VERSION,
  HANBANG_MUTATION_CONTRACT_VERSION_HEADER,
} from "@hanbang/shared";

import { sealMediationPrivateSafetyHold } from "@/lib/care/mediationPrivateSafetyHold";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClientFromRequest } from "@/lib/supabase/server";
import { checkRateLimit } from "@/utils/rateLimit";
import { isTrustedMutationRequest } from "@/utils/trustedMutation";
import { POST } from "./route";

vi.mock("@/lib/care/mediationPrivateSafetyHold", () => ({
  sealMediationPrivateSafetyHold: vi.fn(),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClientFromRequest: vi.fn() }));
vi.mock("@/utils/rateLimit", () => ({
  checkRateLimit: vi.fn(() => null),
  rateLimitKey: vi.fn(() => "mediation-private-safety-hold:test"),
}));
vi.mock("@/utils/trustedMutation", () => ({
  isTrustedMutationRequest: vi.fn(() => true),
}));

const USER_ID = "10000000-0000-4000-8000-000000000001";
const PARTNER_ID = "10000000-0000-4000-8000-000000000002";
const COUPLE_ID = "20000000-0000-4000-8000-000000000001";

function query(data: unknown) {
  const builder = { select: vi.fn(), eq: vi.fn(), single: vi.fn() };
  builder.select.mockReturnValue(builder);
  builder.eq.mockReturnValue(builder);
  builder.single.mockResolvedValue({ data, error: null });
  return builder;
}

function installClient({
  userId = USER_ID,
  profileData = { couple_id: COUPLE_ID, role: "bride" },
  coupleData = { bride_id: USER_ID, groom_id: PARTNER_ID },
}: {
  userId?: string | null;
  profileData?: unknown;
  coupleData?: unknown;
} = {}) {
  const profile = query(profileData);
  const couple = query(coupleData);
  vi.mocked(createClientFromRequest).mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: userId ? { id: userId } : null } }) },
    from: vi.fn((name: string) => name === "profiles" ? profile : couple),
  } as never);
}

function request(
  body: unknown,
  { expectedActorUserId = USER_ID }: { expectedActorUserId?: string } = {},
) {
  return new Request("http://localhost/api/amora/mediation/private-safety-hold", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "sec-fetch-site": "same-origin",
      [HANBANG_MUTATION_CONTRACT_VERSION_HEADER]: HANBANG_MUTATION_CONTRACT_VERSION,
      [HANBANG_EXPECTED_ACTOR_USER_ID_HEADER]: expectedActorUserId,
    },
    body: JSON.stringify(body),
  });
}

describe("POST /api/amora/mediation/private-safety-hold", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    installClient();
    vi.mocked(isTrustedMutationRequest).mockReturnValue(true);
    vi.mocked(checkRateLimit).mockReturnValue(null);
    vi.mocked(createAdminClient).mockReturnValue({ rpc: vi.fn() } as never);
    vi.mocked(sealMediationPrivateSafetyHold).mockResolvedValue(true);
  });

  it("seals only the current owner and couple without receiving safety content", async () => {
    const response = await POST(request({ coupleId: COUPLE_ID }));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      version: 1,
      sealed: true,
      recipientUserId: USER_ID,
      coupleId: COUPLE_ID,
    });
    expect(sealMediationPrivateSafetyHold).toHaveBeenCalledWith({
      client: expect.any(Object),
      coupleId: COUPLE_ID,
      recipientUserId: USER_ID,
    });
  });

  it("rejects raw text, reasons, and classification before a service write", async () => {
    for (const body of [
      { coupleId: COUPLE_ID, rawText: "private" },
      { coupleId: COUPLE_ID, reason: "private" },
      { coupleId: COUPLE_ID, classification: "private" },
    ]) {
      const response = await POST(request(body));
      expect(response.status).toBe(400);
    }
    expect(sealMediationPrivateSafetyHold).not.toHaveBeenCalled();
  });

  it("returns a private 503 receipt when the opaque service seal is unavailable", async () => {
    vi.mocked(sealMediationPrivateSafetyHold).mockResolvedValueOnce(false);

    const response = await POST(request({ coupleId: COUPLE_ID }));

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toContain("no-store");
    await expect(response.json()).resolves.toEqual({
      code: "MEDIATION_PRIVATE_SAFETY_HOLD_SEAL_UNAVAILABLE",
    });
  });

  it("rejects an untrusted origin before auth, admin access, or a service write", async () => {
    vi.mocked(isTrustedMutationRequest).mockReturnValueOnce(false);

    const response = await POST(request({ coupleId: COUPLE_ID }));

    expect(response.status).toBe(403);
    expect(createClientFromRequest).not.toHaveBeenCalled();
    expect(createAdminClient).not.toHaveBeenCalled();
    expect(sealMediationPrivateSafetyHold).not.toHaveBeenCalled();
  });

  it("requires an authenticated UUID actor before reading couple scope", async () => {
    installClient({ userId: null });

    const response = await POST(request({ coupleId: COUPLE_ID }));

    expect(response.status).toBe(401);
    expect(createAdminClient).not.toHaveBeenCalled();
    expect(sealMediationPrivateSafetyHold).not.toHaveBeenCalled();
  });

  it("rejects an expected-actor mismatch before reading or sealing the hold", async () => {
    const response = await POST(request(
      { coupleId: COUPLE_ID },
      { expectedActorUserId: PARTNER_ID },
    ));

    expect(response.status).toBe(409);
    expect(createAdminClient).not.toHaveBeenCalled();
    expect(sealMediationPrivateSafetyHold).not.toHaveBeenCalled();
  });

  it.each([
    [
      "profile couple changed",
      { couple_id: "20000000-0000-4000-8000-000000000099", role: "bride" },
      { bride_id: USER_ID, groom_id: PARTNER_ID },
    ],
    [
      "current roster does not contain the actor in the claimed role",
      { couple_id: COUPLE_ID, role: "bride" },
      { bride_id: PARTNER_ID, groom_id: USER_ID },
    ],
  ])("fails closed when %s", async (_label, profileData, coupleData) => {
    installClient({ profileData, coupleData });

    const response = await POST(request({ coupleId: COUPLE_ID }));

    expect(response.status).toBe(409);
    expect(createAdminClient).not.toHaveBeenCalled();
    expect(sealMediationPrivateSafetyHold).not.toHaveBeenCalled();
  });

  it("rejects a streamed body over the byte bound before scope or service access", async () => {
    const response = await POST(request({
      coupleId: COUPLE_ID,
      padding: "가".repeat(128),
    }));

    expect(response.status).toBe(413);
    expect(createAdminClient).not.toHaveBeenCalled();
    expect(sealMediationPrivateSafetyHold).not.toHaveBeenCalled();
  });

  it("returns the shared rate-limit receipt without creating an admin client", async () => {
    vi.mocked(checkRateLimit).mockReturnValueOnce(
      NextResponse.json({ code: "RATE_LIMITED" }, { status: 429 }),
    );

    const response = await POST(request({ coupleId: COUPLE_ID }));

    expect(response.status).toBe(429);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(createAdminClient).not.toHaveBeenCalled();
    expect(sealMediationPrivateSafetyHold).not.toHaveBeenCalled();
  });
});
