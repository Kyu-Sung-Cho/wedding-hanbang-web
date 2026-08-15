// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  HANBANG_EXPECTED_ACTOR_USER_ID_HEADER,
  HANBANG_MUTATION_CONTRACT_VERSION,
  HANBANG_MUTATION_CONTRACT_VERSION_HEADER,
} from "@hanbang/shared";
import { createClientFromRequest } from "@/lib/supabase/server";
import { POST } from "../route";

vi.mock("@/lib/supabase/server", () => ({ createClientFromRequest: vi.fn() }));
vi.mock("@/utils/trustedMutation", () => ({
  isTrustedMutationRequest: vi.fn(() => true),
}));
vi.mock("@/utils/rateLimit", () => ({
  checkRateLimit: vi.fn(() => null),
  rateLimitKey: vi.fn(() => "couple:reset:test"),
}));

const USER_ID = "00000000-0000-4000-8000-000000000001";
const OTHER_USER_ID = "00000000-0000-4000-8000-000000000002";

function resetRequest(headers: HeadersInit = {}) {
  return new Request("http://localhost/api/couple/reset", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify({ confirmText: "초기화합니다" }),
  });
}

describe("/api/couple/reset POST", () => {
  const rpc = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    rpc.mockResolvedValue({ error: null });
    vi.mocked(createClientFromRequest).mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: USER_ID } } }),
      },
      rpc,
    } as never);
  });

  it("rejects a headerless legacy reset before the RPC", async () => {
    const response = await POST(resetRequest());

    expect(response.status).toBe(426);
    expect(response.headers.get("cache-control")).toContain("no-store");
    await expect(response.json()).resolves.toMatchObject({
      code: "CLIENT_UPDATE_REQUIRED",
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects a reset confirmed on another account's screen before the RPC", async () => {
    const response = await POST(resetRequest({
      [HANBANG_MUTATION_CONTRACT_VERSION_HEADER]: HANBANG_MUTATION_CONTRACT_VERSION,
      [HANBANG_EXPECTED_ACTOR_USER_ID_HEADER]: OTHER_USER_ID,
    }));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: "MUTATION_ACTOR_CHANGED",
    });
    expect(rpc).not.toHaveBeenCalled();
  });
});
