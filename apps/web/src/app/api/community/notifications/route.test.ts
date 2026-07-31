// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClientFromRequest: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClientFromRequest: mocks.createClientFromRequest,
}));

import { GET, POST } from "./route";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const ACTOR_ID = "22222222-2222-4222-8222-222222222222";
const POST_ID = "33333333-3333-4333-8333-333333333333";
const COMMENT_ID = "44444444-4444-4444-8444-444444444444";
const NOTIFICATION_ID = "55555555-5555-4555-8555-555555555555";

function request(method: "GET" | "POST", body?: unknown) {
  const headers = new Headers({
    origin: "http://localhost",
    "sec-fetch-site": "same-origin",
  });
  if (body !== undefined) headers.set("content-type", "application/json");
  return new Request("http://localhost/api/community/notifications", {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("community reply notifications route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lists only the authenticated recipient's notifications", async () => {
    const recipientEq = vi.fn(() => ({
      order: vi.fn(() => ({
        order: vi.fn(() => ({
          limit: vi.fn(async () => ({
            data: [{
              id: NOTIFICATION_ID,
              recipient_id: USER_ID,
              actor_id: ACTOR_ID,
              post_id: POST_ID,
              comment_id: COMMENT_ID,
              parent_comment_id: null,
              kind: "post_reply",
              read_at: null,
              created_at: "2026-07-31T00:00:00.000Z",
            }],
            error: null,
          })),
        })),
      })),
    }));
    const from = vi.fn((table: string) => {
      if (table === "community_reply_notifications") {
        return {
          select: vi.fn(() => ({ eq: recipientEq })),
        };
      }
      if (table === "community_profiles") {
        return {
          select: vi.fn(() => ({
            in: vi.fn(async () => ({
              data: [{ user_id: ACTOR_ID, nickname: "경험자" }],
              error: null,
            })),
          })),
        };
      }
      if (table === "community_posts") {
        return {
          select: vi.fn(() => ({
            in: vi.fn(async () => ({
              data: [{ id: POST_ID, title: "계약금 환불 고민" }],
              error: null,
            })),
          })),
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    });
    mocks.createClientFromRequest.mockResolvedValue({
      auth: {
        getUser: vi.fn(async () => ({ data: { user: { id: USER_ID } } })),
      },
      from,
    });

    const response = await GET(request("GET"));

    expect(response.status).toBe(200);
    expect(recipientEq).toHaveBeenCalledWith("recipient_id", USER_ID);
    await expect(response.json()).resolves.toMatchObject({
      ownerId: USER_ID,
      notifications: [{
        id: NOTIFICATION_ID,
        actor_nickname: "경험자",
        title: "경험자님이 내 고민에 답변을 남겼어요",
        message: "계약금 환불 고민",
        href: `/wedding/community/post/${POST_ID}#comment-${COMMENT_ID}`,
      }],
    });
  });

  it("does not expose notifications without authentication", async () => {
    const from = vi.fn();
    mocks.createClientFromRequest.mockResolvedValue({
      auth: { getUser: vi.fn(async () => ({ data: { user: null } })) },
      from,
    });

    const response = await GET(request("GET"));
    expect(response.status).toBe(401);
    expect(from).not.toHaveBeenCalled();
  });

  it("marks only the current recipient's selected notification as read", async () => {
    const selectedIn = vi.fn(async () => ({ data: null, error: null }));
    const unreadIs = vi.fn(() => ({ in: selectedIn }));
    const recipientEq = vi.fn(() => ({ is: unreadIs }));
    const update = vi.fn(() => ({ eq: recipientEq }));
    const from = vi.fn((table: string) => {
      if (table !== "community_reply_notifications") {
        throw new Error(`Unexpected table: ${table}`);
      }
      return { update };
    });
    mocks.createClientFromRequest.mockResolvedValue({
      auth: {
        getUser: vi.fn(async () => ({ data: { user: { id: USER_ID } } })),
      },
      from,
    });

    const response = await POST(request("POST", { ids: [NOTIFICATION_ID] }));

    expect(response.status).toBe(200);
    expect(recipientEq).toHaveBeenCalledWith("recipient_id", USER_ID);
    expect(unreadIs).toHaveBeenCalledWith("read_at", null);
    expect(selectedIn).toHaveBeenCalledWith("id", [NOTIFICATION_ID]);
  });

  it("rejects attempts to smuggle a different recipient into read requests", async () => {
    const from = vi.fn();
    mocks.createClientFromRequest.mockResolvedValue({
      auth: {
        getUser: vi.fn(async () => ({ data: { user: { id: USER_ID } } })),
      },
      from,
    });

    const response = await POST(request("POST", {
      ids: [NOTIFICATION_ID],
      recipient_id: ACTOR_ID,
    }));

    expect(response.status).toBe(400);
    expect(from).not.toHaveBeenCalled();
  });
});
