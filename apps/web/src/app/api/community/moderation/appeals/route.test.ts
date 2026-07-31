import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClientFromRequest: vi.fn(),
  checkRateLimitPersistent: vi.fn(),
  rateLimitKey: vi.fn(() => "appeal-key"),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClientFromRequest: mocks.createClientFromRequest,
}));

vi.mock("@/utils/rateLimit", () => ({
  checkRateLimitPersistent: mocks.checkRateLimitPersistent,
  rateLimitKey: mocks.rateLimitKey,
}));

import { POST } from "./route";

const USER_ID = "00000000-0000-4000-8000-000000000001";
const EVENT_ID = "00000000-0000-4000-8000-000000000002";

function request(reason = "작성 맥락이 누락되어 다시 검토를 요청합니다.") {
  return new NextRequest(
    "https://hanbang.ai/api/community/moderation/appeals",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "sec-fetch-site": "same-origin",
      },
      body: JSON.stringify({ event_id: EVENT_ID, reason }),
    }
  );
}

function clientWithInsert(result: {
  data: unknown;
  error: { code?: string } | null;
}) {
  const single = vi.fn().mockResolvedValue(result);
  const select = vi.fn(() => ({ single }));
  const insert = vi.fn(() => ({ select }));
  const from = vi.fn(() => ({ insert }));
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: USER_ID } },
      }),
    },
    from,
    insert,
  };
}

describe("POST /api/community/moderation/appeals", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.checkRateLimitPersistent.mockResolvedValue(null);
  });

  it("lets the affected user submit one appeal without consulting suspension state", async () => {
    const client = clientWithInsert({
      data: {
        id: "appeal-id",
        event_id: EVENT_ID,
        status: "pending",
      },
      error: null,
    });
    mocks.createClientFromRequest.mockResolvedValue(client);

    const response = await POST(request());

    expect(response.status).toBe(201);
    expect(client.from).toHaveBeenCalledWith("community_moderation_appeals");
    expect(client.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        event_id: EVENT_ID,
        appellant_id: USER_ID,
      })
    );
  });

  it("returns a recoverable conflict for a duplicate appeal", async () => {
    mocks.createClientFromRequest.mockResolvedValue(
      clientWithInsert({
        data: null,
        error: { code: "23505" },
      })
    );

    const response = await POST(request());
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.code).toBe("COMMUNITY_MODERATION_APPEAL_ALREADY_EXISTS");
  });

  it("rejects an appeal without enough review context before writing", async () => {
    const client = clientWithInsert({ data: null, error: null });
    mocks.createClientFromRequest.mockResolvedValue(client);

    const response = await POST(request("짧음"));

    expect(response.status).toBe(400);
    expect(client.from).not.toHaveBeenCalled();
  });
});
