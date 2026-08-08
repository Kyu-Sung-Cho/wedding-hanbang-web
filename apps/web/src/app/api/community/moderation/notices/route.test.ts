import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClientFromRequest: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClientFromRequest: mocks.createClientFromRequest,
}));

import { GET } from "./route";

const USER_ID = "00000000-0000-4000-8000-000000000001";
const EVENT_ID = "00000000-0000-4000-8000-000000000002";

function authenticatedClient(results: Array<{ data: unknown; error: unknown }>) {
  const queries = results.map((result) => {
    const terminal = vi.fn().mockResolvedValue(result);
    return {
      select: vi.fn(() => ({
        order: vi.fn(() => ({ limit: terminal })),
        in: terminal,
      })),
    };
  });
  const from = vi.fn(() => queries.shift());
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: USER_ID } },
      }),
    },
    from,
  };
}

describe("GET /api/community/moderation/notices", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns the user's notices with their appeal status", async () => {
    const notice = {
      id: "notice-id",
      event_id: EVENT_ID,
      target_type: "post",
      target_id: "post-id",
      action: "hide",
      reason: "개인정보 임시 보호",
      appeal_available: true,
      read_at: null,
      created_at: "2026-07-31T00:00:00.000Z",
    };
    const appeal = {
      id: "appeal-id",
      event_id: EVENT_ID,
      status: "pending",
      reason: "수정 완료",
      resolution_reason: null,
      created_at: "2026-07-31T01:00:00.000Z",
      resolved_at: null,
    };
    mocks.createClientFromRequest.mockResolvedValue(
      authenticatedClient([
        { data: [notice], error: null },
        { data: [appeal], error: null },
      ])
    );

    const response = await GET(
      new NextRequest("https://hanbang.ai/api/community/moderation/notices")
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.notices).toEqual([
      {
        ...notice,
        appeal: {
          id: appeal.id,
          status: appeal.status,
          reason: appeal.reason,
          resolution_reason: appeal.resolution_reason,
          created_at: appeal.created_at,
          resolved_at: appeal.resolved_at,
        },
      },
    ]);
  });

  it("fails closed when the forward schema is missing", async () => {
    mocks.createClientFromRequest.mockResolvedValue(
      authenticatedClient([
        { data: null, error: { code: "42P01" } },
      ])
    );

    const response = await GET(
      new NextRequest("https://hanbang.ai/api/community/moderation/notices")
    );
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.code).toBe(
      "COMMUNITY_MODERATION_NOTICE_SCHEMA_UNAVAILABLE"
    );
  });
});
