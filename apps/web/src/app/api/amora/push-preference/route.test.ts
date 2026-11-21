// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createClientFromRequest } from "@/lib/supabase/server";
import { isTrustedMutationRequest } from "@/utils/trustedMutation";
import { GET, PUT } from "./route";

vi.mock("@/lib/supabase/server", () => ({ createClientFromRequest: vi.fn() }));
vi.mock("@/utils/rateLimit", () => ({ checkRateLimit: vi.fn(() => null), rateLimitKey: vi.fn(() => "k") }));
vi.mock("@/utils/trustedMutation", () => ({ isTrustedMutationRequest: vi.fn(() => true) }));

const USER = "10000000-0000-4000-8000-000000000001";

function client(rpcResult: unknown = { enabled: false, consentedAt: null }) {
  const rpc = vi.fn(async () => ({ data: rpcResult, error: null }));
  return {
    rpc,
    value: { auth: { getUser: vi.fn(async () => ({ data: { user: { id: USER } }, error: null })) }, rpc },
  };
}

function put(body: unknown) {
  return new Request("http://localhost/api/amora/push-preference", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("/api/amora/push-preference (D-86)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isTrustedMutationRequest).mockReturnValue(true);
  });
  afterEach(() => vi.unstubAllEnvs());

  it("보낼 수 없는 동안에는 available false 를 알리고 켜기를 받지 않는다", async () => {
    vi.stubEnv("AMORA_APP_PUSH_ENABLED", "false");
    vi.stubEnv("EXPO_ACCESS_TOKEN", "token");
    const { rpc, value } = client();
    vi.mocked(createClientFromRequest).mockResolvedValue(value as never);
    expect(await (await GET(new Request("http://localhost/api/amora/push-preference"))).json())
      .toEqual({ available: false, enabled: false, consentedAt: null });
    const refused = await PUT(put({ enabled: true }));
    expect(refused.status).toBe(409);
    expect(rpc).not.toHaveBeenCalledWith("set_amora_push_preference", expect.anything());
  });

  it("끄기는 언제나 받고, 켜기는 스위치와 열쇠가 다 있을 때만 받는다", async () => {
    vi.stubEnv("AMORA_APP_PUSH_ENABLED", "false");
    const off = client({ enabled: false, consentedAt: null });
    vi.mocked(createClientFromRequest).mockResolvedValue(off.value as never);
    expect((await PUT(put({ enabled: false }))).status).toBe(200);
    expect(off.rpc).toHaveBeenCalledWith("set_amora_push_preference", { p_enabled: false });

    vi.stubEnv("AMORA_APP_PUSH_ENABLED", "true");
    vi.stubEnv("EXPO_ACCESS_TOKEN", "token");
    const on = client({ enabled: true, consentedAt: "2026-11-20T01:00:00.000Z" });
    vi.mocked(createClientFromRequest).mockResolvedValue(on.value as never);
    expect(await (await PUT(put({ enabled: true }))).json())
      .toEqual({ available: true, enabled: true, consentedAt: "2026-11-20T01:00:00.000Z" });
  });

  it("다른 출처, 틀린 본문은 저장하지 않는다", async () => {
    vi.stubEnv("AMORA_APP_PUSH_ENABLED", "true");
    vi.stubEnv("EXPO_ACCESS_TOKEN", "token");
    const { rpc, value } = client();
    vi.mocked(createClientFromRequest).mockResolvedValue(value as never);
    for (const body of [{}, { enabled: "yes" }, { enabled: true, extra: 1 }]) {
      expect((await PUT(put(body))).status).toBe(400);
    }
    vi.mocked(isTrustedMutationRequest).mockReturnValue(false);
    expect((await PUT(put({ enabled: true }))).status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
  });
});
