// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClientFromRequest } from "@/lib/supabase/server";
import { checkRateLimit } from "@/utils/rateLimit";
import { POST } from "./route";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClientFromRequest: vi.fn() }));
vi.mock("@/utils/rateLimit", () => ({
  checkRateLimit: vi.fn(() => null),
  rateLimitKey: vi.fn(() => "chat-clear-request-test"),
}));

const AUTHENTICATED_USER_ID = "00000000-0000-4000-8000-000000000001";
const STALE_SCREEN_USER_ID = "00000000-0000-4000-8000-000000000002";
const COUPLE_ID = "10000000-0000-4000-8000-000000000001";
const MESSAGE_ID = "20000000-0000-4000-8000-000000000001";

function request(
  body: Record<string, unknown>,
  actorId: string | null = STALE_SCREEN_USER_ID,
) {
  return new Request("http://localhost/api/chat/clear-request", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "http://localhost",
      ...(actorId
        ? {
            "X-Hanbang-Mutation-Contract-Version": "2",
            "X-Hanbang-Expected-Actor-User-Id": actorId,
          }
        : {}),
    },
    body: JSON.stringify(body),
  });
}

describe("POST /api/chat/clear-request mutation actor fence", () => {
  const rpc = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createClientFromRequest).mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: AUTHENTICATED_USER_ID } },
        }),
      },
      rpc,
    } as never);
  });

  it.each([
    ["request", { action: "request", coupleId: COUPLE_ID }],
    ["accept", { action: "accept", messageId: MESSAGE_ID, coupleId: COUPLE_ID }],
    ["decline", { action: "decline", messageId: MESSAGE_ID, coupleId: COUPLE_ID }],
  ])("rejects a stale %s before rate limiting, RPC, or service-role access", async (
    _label,
    body,
  ) => {
    const response = await POST(request(body));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: "MUTATION_ACTOR_CHANGED",
    });
    expect(checkRateLimit).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("keeps headerless cached callers on the Phase-A path", async () => {
    const response = await POST(request({}, null));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "action이 필요합니다.",
    });
    expect(checkRateLimit).toHaveBeenCalledTimes(1);
    expect(rpc).not.toHaveBeenCalled();
    expect(createAdminClient).not.toHaveBeenCalled();
  });
});
