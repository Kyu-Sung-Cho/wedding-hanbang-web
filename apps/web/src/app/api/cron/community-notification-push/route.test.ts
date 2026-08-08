import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createAdmin: vi.fn(),
  rpc: vi.fn(),
  fetch: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mocks.createAdmin,
}));

import { GET } from "./route";
import { buildExpoReplyMessages } from "@/lib/community/notificationPushDelivery";

const DELIVERY = "11111111-1111-4111-8111-111111111111";
const NOTIFICATION = "22222222-2222-4222-8222-222222222222";
const POST = "33333333-3333-4333-8333-333333333333";
const COMMENT = "44444444-4444-4444-8444-444444444444";
const TICKET = "55555555-5555-4555-8555-555555555555";
const TOKEN = "ExpoPushToken[aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa]";
const PUSH_CRON_PATH = "/api/cron/community-notification-push";

function normalizedCronPath(path: string) {
  const pathname = new URL(path, "https://vercel.invalid").pathname;
  return pathname.replace(/\/+$/u, "") || "/";
}

function request(secret = "cron-secret") {
  return new NextRequest("http://localhost/api/cron/community-notification-push", {
    headers: { authorization: `Bearer ${secret}` },
  });
}

function rpcResult(data: unknown) {
  return Promise.resolve({ data, error: null });
}

describe("/api/cron/community-notification-push", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("CRON_SECRET", "cron-secret");
    vi.stubEnv("EXPO_ACCESS_TOKEN", "expo-access-token");
    vi.stubEnv("COMMUNITY_REPLY_PUSH_DELIVERY_ENABLED", "true");
    mocks.createAdmin.mockReturnValue({ rpc: mocks.rpc });
    vi.stubGlobal("fetch", mocks.fetch);
  });

  it("keeps the provider cron out of the default Vercel config until rollout approval", () => {
    const config = JSON.parse(
      readFileSync(resolve(process.cwd(), "vercel.json"), "utf8"),
    ) as { crons?: Array<{ path?: string; schedule?: string }> };

    for (const equivalentPath of [
      PUSH_CRON_PATH,
      `${PUSH_CRON_PATH}/`,
      `${PUSH_CRON_PATH}?rollout=1`,
      `${PUSH_CRON_PATH}/?rollout=1`,
    ]) {
      expect(normalizedCronPath(equivalentPath)).toBe(PUSH_CRON_PATH);
    }

    const configuredPaths = (config.crons ?? [])
      .map((cron) => cron.path)
      .filter((path): path is string => typeof path === "string")
      .map(normalizedCronPath);
    expect(configuredPaths).not.toContain(PUSH_CRON_PATH);
  });

  it("keeps external reply delivery default-off without touching the queue", async () => {
    vi.stubEnv("COMMUNITY_REPLY_PUSH_DELIVERY_ENABLED", "");

    const response = await GET(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      disabled: true,
    });
    expect(mocks.createAdmin).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("requires both service authentication and a server-only Expo credential", async () => {
    const unauthorized = await GET(request("wrong"));
    expect(unauthorized.status).toBe(401);
    expect(mocks.createAdmin).not.toHaveBeenCalled();

    vi.stubEnv("EXPO_ACCESS_TOKEN", "");
    const unavailable = await GET(request());
    expect(unavailable.status).toBe(503);
    expect(mocks.createAdmin).not.toHaveBeenCalled();
  });

  it("sends only generic content after the final DB eligibility confirmation", async () => {
    mocks.rpc.mockImplementation((name: string) => {
      if (name === "community_claim_notification_push_receipts") return rpcResult([]);
      if (name === "community_claim_notification_push_batch") {
        return rpcResult([{ delivery_id: DELIVERY, notification_id: NOTIFICATION }]);
      }
      if (name === "community_confirm_notification_push_batch") {
        return rpcResult([{
          delivery_id: DELIVERY,
          notification_id: NOTIFICATION,
          push_token: TOKEN,
          kind: "comment_reply",
          post_id: POST,
          comment_id: COMMENT,
        }]);
      }
      if (name === "community_record_notification_push_ticket") return rpcResult(true);
      throw new Error(`unexpected rpc ${name}`);
    });
    mocks.fetch.mockResolvedValue(new Response(JSON.stringify({
      data: [{ status: "ok", id: TICKET }],
    }), { status: 200 }));

    const response = await GET(request());
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      deliveriesClaimed: 1,
      deliveriesConfirmed: 1,
      ticketsOk: 1,
      ticketsFailed: 0,
    });

    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    const [url, options] = mocks.fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://exp.host/--/api/v2/push/send");
    expect(options.headers).toMatchObject({
      Authorization: "Bearer expo-access-token",
      "Content-Type": "application/json",
    });
    const body = JSON.parse(String(options.body)) as Array<Record<string, unknown>>;
    expect(body).toEqual([expect.objectContaining({
      to: TOKEN,
      sound: "default",
      ttl: 300,
      priority: "high",
      collapseId: `community-reply:${NOTIFICATION}`,
      tag: `community-reply:${NOTIFICATION}`,
      data: {
        type: "community_reply",
        href: `/community/post/${POST}?commentId=${COMMENT}`,
        notificationId: NOTIFICATION,
        deliveryId: DELIVERY,
      },
    })]);
    expect(Object.keys(body[0] ?? {}).sort()).toEqual([
      "body", "collapseId", "data", "priority", "sound", "tag", "title", "to", "ttl",
    ]);
    const serialized = JSON.stringify(body);
    for (const forbidden of [
      "업체명", "계약금", "예산", "결혼식 날짜", "private title", "source text",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
    expect(mocks.rpc).toHaveBeenCalledWith(
      "community_record_notification_push_ticket",
      expect.objectContaining({
        p_delivery_id: DELIVERY,
        p_ticket_id: TICKET,
        p_error_code: null,
      }),
    );
  });

  it("uses stable content-free collapse ids for retries and separates notifications", () => {
    const row = {
      delivery_id: DELIVERY,
      notification_id: NOTIFICATION,
      push_token: TOKEN,
      kind: "post_reply" as const,
      post_id: POST,
      comment_id: COMMENT,
    };
    const retry = buildExpoReplyMessages([row])[0];
    const sameNotification = buildExpoReplyMessages([{
      ...row,
      delivery_id: "66666666-6666-4666-8666-666666666666",
    }])[0];
    const otherNotification = buildExpoReplyMessages([{
      ...row,
      delivery_id: "77777777-7777-4777-8777-777777777777",
      notification_id: "88888888-8888-4888-8888-888888888888",
    }])[0];

    expect(retry?.collapseId).toBe(sameNotification?.collapseId);
    expect(retry?.tag).toBe(sameNotification?.tag);
    expect(retry?.collapseId).not.toBe(otherNotification?.collapseId);
    expect(retry?.tag).not.toBe(otherNotification?.tag);
    expect(retry?.collapseId).toMatch(/^community-reply:[0-9a-f-]{36}$/u);
    expect(retry?.collapseId.length).toBeLessThanOrEqual(64);
  });

  it("never calls Expo when read/block/content/preference revalidation removes a lease", async () => {
    mocks.rpc.mockImplementation((name: string) => {
      if (name === "community_claim_notification_push_receipts") return rpcResult([]);
      if (name === "community_claim_notification_push_batch") {
        return rpcResult([{ delivery_id: DELIVERY, notification_id: NOTIFICATION }]);
      }
      if (name === "community_confirm_notification_push_batch") return rpcResult([]);
      throw new Error(`unexpected rpc ${name}`);
    });

    const response = await GET(request());
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      deliveriesClaimed: 1,
      deliveriesConfirmed: 0,
    });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("fails closed when confirmation changes the claimed notification identity", async () => {
    mocks.rpc.mockImplementation((name: string) => {
      if (name === "community_claim_notification_push_receipts") return rpcResult([]);
      if (name === "community_claim_notification_push_batch") {
        return rpcResult([{ delivery_id: DELIVERY, notification_id: NOTIFICATION }]);
      }
      if (name === "community_confirm_notification_push_batch") {
        return rpcResult([{
          delivery_id: DELIVERY,
          notification_id: "99999999-9999-4999-8999-999999999999",
          push_token: TOKEN,
          kind: "post_reply",
          post_id: POST,
          comment_id: COMMENT,
        }]);
      }
      throw new Error(`unexpected rpc ${name}`);
    });

    const response = await GET(request());

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: "Push delivery confirmation invalid",
    });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("validates Expo receipts and records DeviceNotRegistered without exposing the token", async () => {
    mocks.rpc.mockImplementation((name: string) => {
      if (name === "community_claim_notification_push_receipts") {
        return rpcResult([{ delivery_id: DELIVERY, expo_ticket_id: TICKET }]);
      }
      if (name === "community_record_notification_push_receipt") return rpcResult(true);
      if (name === "community_claim_notification_push_batch") return rpcResult([]);
      throw new Error(`unexpected rpc ${name}`);
    });
    mocks.fetch.mockResolvedValue(new Response(JSON.stringify({
      data: {
        [TICKET]: {
          status: "error",
          message: "provider text must not be persisted",
          details: { error: "DeviceNotRegistered" },
        },
      },
    }), { status: 200 }));

    const response = await GET(request());
    expect(response.status).toBe(200);
    const responseBody = await response.text();
    expect(responseBody).not.toContain(TOKEN);
    expect(responseBody).not.toContain("provider text");
    expect(mocks.rpc).toHaveBeenCalledWith(
      "community_record_notification_push_receipt",
      expect.objectContaining({
        p_delivery_id: DELIVERY,
        p_receipt_status: "error",
        p_error_code: "DeviceNotRegistered",
      }),
    );
  });

  it("turns a provider network failure into a bounded retry result", async () => {
    mocks.rpc.mockImplementation((name: string) => {
      if (name === "community_claim_notification_push_receipts") return rpcResult([]);
      if (name === "community_claim_notification_push_batch") {
        return rpcResult([{ delivery_id: DELIVERY, notification_id: NOTIFICATION }]);
      }
      if (name === "community_confirm_notification_push_batch") {
        return rpcResult([{
          delivery_id: DELIVERY,
          notification_id: NOTIFICATION,
          push_token: TOKEN,
          kind: "post_reply",
          post_id: POST,
          comment_id: COMMENT,
        }]);
      }
      if (name === "community_record_notification_push_ticket") return rpcResult(true);
      throw new Error(`unexpected rpc ${name}`);
    });
    mocks.fetch.mockRejectedValue(new Error(`never log ${TOKEN}`));

    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith(
      "community_record_notification_push_ticket",
      expect.objectContaining({
        p_delivery_id: DELIVERY,
        p_ticket_id: null,
        p_error_code: "network_error",
      }),
    );
  });

  it("reports a retryable failure when a provider result was not durably recorded", async () => {
    mocks.rpc.mockImplementation((name: string) => {
      if (name === "community_claim_notification_push_receipts") return rpcResult([]);
      if (name === "community_claim_notification_push_batch") {
        return rpcResult([{ delivery_id: DELIVERY, notification_id: NOTIFICATION }]);
      }
      if (name === "community_confirm_notification_push_batch") {
        return rpcResult([{
          delivery_id: DELIVERY,
          notification_id: NOTIFICATION,
          push_token: TOKEN,
          kind: "post_reply",
          post_id: POST,
          comment_id: COMMENT,
        }]);
      }
      if (name === "community_record_notification_push_ticket") return rpcResult(false);
      throw new Error(`unexpected rpc ${name}`);
    });
    mocks.fetch.mockResolvedValue(new Response(JSON.stringify({
      data: [{ status: "ok", id: TICKET }],
    }), { status: 200 }));

    const response = await GET(request());

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: "Push delivery persistence incomplete",
      persistenceFailed: 1,
    });
  });
});
