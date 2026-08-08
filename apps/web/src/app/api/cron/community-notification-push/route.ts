import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  getExpoPushReceipts,
  sendExpoReplyPushBatch,
  type ConfirmedPushDelivery,
  type ReceiptClaim,
} from "@/lib/community/notificationPushDelivery";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_BATCH_SIZE = 50;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EXPO_TICKET_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;

type ClaimedDelivery = {
  delivery_id: string;
  notification_id: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function isExpoTicketId(value: unknown): value is string {
  return typeof value === "string" && EXPO_TICKET_PATTERN.test(value);
}

function parseClaims(value: unknown): ClaimedDelivery[] | null {
  if (!Array.isArray(value) || value.length > MAX_BATCH_SIZE) return null;
  const parsed: ClaimedDelivery[] = [];
  const ids = new Set<string>();
  for (const row of value) {
    if (
      !isRecord(row)
      || !isUuid(row.delivery_id)
      || !isUuid(row.notification_id)
      || ids.has(row.delivery_id)
    ) {
      return null;
    }
    ids.add(row.delivery_id);
    parsed.push({
      delivery_id: row.delivery_id,
      notification_id: row.notification_id,
    });
  }
  return parsed;
}

function parseConfirmed(
  value: unknown,
  claimedNotifications: ReadonlyMap<string, string>,
) {
  if (!Array.isArray(value) || value.length > MAX_BATCH_SIZE) return null;
  const parsed: ConfirmedPushDelivery[] = [];
  const ids = new Set<string>();
  for (const row of value) {
    if (
      !isRecord(row)
      || !isUuid(row.delivery_id)
      || !claimedNotifications.has(row.delivery_id)
      || ids.has(row.delivery_id)
      || !isUuid(row.notification_id)
      || claimedNotifications.get(row.delivery_id) !== row.notification_id
      || !isUuid(row.post_id)
      || !isUuid(row.comment_id)
      || !(row.kind === "post_reply" || row.kind === "comment_reply")
      || typeof row.push_token !== "string"
    ) {
      return null;
    }
    ids.add(row.delivery_id);
    parsed.push({
      delivery_id: row.delivery_id,
      notification_id: row.notification_id,
      post_id: row.post_id,
      comment_id: row.comment_id,
      kind: row.kind,
      push_token: row.push_token,
    });
  }
  return parsed;
}

function parseReceiptClaims(value: unknown): ReceiptClaim[] | null {
  if (!Array.isArray(value) || value.length > MAX_BATCH_SIZE) return null;
  const parsed: ReceiptClaim[] = [];
  const ids = new Set<string>();
  for (const row of value) {
    if (
      !isRecord(row)
      || !isUuid(row.delivery_id)
      || !isExpoTicketId(row.expo_ticket_id)
      || ids.has(row.delivery_id)
    ) {
      return null;
    }
    ids.add(row.delivery_id);
    parsed.push({
      delivery_id: row.delivery_id,
      expo_ticket_id: row.expo_ticket_id,
    });
  }
  return parsed;
}

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return json({ error: "Unauthorized" }, 401);
  }
  if (process.env.COMMUNITY_REPLY_PUSH_DELIVERY_ENABLED !== "true") {
    return json({ ok: true, disabled: true });
  }
  const expoAccessToken = process.env.EXPO_ACCESS_TOKEN;
  if (
    !expoAccessToken
    || expoAccessToken !== expoAccessToken.trim()
    || expoAccessToken.length > 4096
  ) {
    return json({ error: "Push provider unavailable" }, 503);
  }

  const admin = createAdminClient();
  const stats = {
    receiptsClaimed: 0,
    receiptsOk: 0,
    receiptsFailed: 0,
    deliveriesClaimed: 0,
    deliveriesConfirmed: 0,
    ticketsOk: 0,
    ticketsFailed: 0,
    persistenceFailed: 0,
  };

  const receiptLease = randomUUID();
  const receiptClaim = await admin.rpc(
    "community_claim_notification_push_receipts",
    { p_lease_token: receiptLease, p_limit: MAX_BATCH_SIZE },
  );
  if (receiptClaim.error) {
    return json({ error: "Push receipt queue unavailable", ...stats }, 503);
  }
  const receiptRows = parseReceiptClaims(receiptClaim.data);
  if (!receiptRows) {
    return json({ error: "Push receipt queue invalid", ...stats }, 503);
  }
  stats.receiptsClaimed = receiptRows.length;
  if (receiptRows.length > 0) {
    const receiptResults = await getExpoPushReceipts(
      receiptRows,
      expoAccessToken,
    );
    for (const result of receiptResults) {
      const parameters = result.status === "error"
        ? {
            p_delivery_id: result.deliveryId,
            p_lease_token: receiptLease,
            p_receipt_status: "error",
            p_error_code: result.errorCode,
          }
        : {
            p_delivery_id: result.deliveryId,
            p_lease_token: receiptLease,
            p_receipt_status: result.status,
            p_error_code: null,
          };
      const recorded = await admin.rpc(
        "community_record_notification_push_receipt",
        parameters,
      );
      if (recorded.error || recorded.data !== true) {
        stats.persistenceFailed += 1;
      } else if (result.status === "ok") {
        stats.receiptsOk += 1;
      } else {
        stats.receiptsFailed += 1;
      }
    }
  }
  if (stats.persistenceFailed > 0) {
    return json({ error: "Push delivery persistence incomplete", ...stats }, 503);
  }

  const sendLease = randomUUID();
  const sendClaim = await admin.rpc(
    "community_claim_notification_push_batch",
    { p_lease_token: sendLease, p_limit: MAX_BATCH_SIZE },
  );
  if (sendClaim.error) {
    return json({ error: "Push delivery queue unavailable", ...stats }, 503);
  }
  const claims = parseClaims(sendClaim.data);
  if (!claims) {
    return json({ error: "Push delivery queue invalid", ...stats }, 503);
  }
  stats.deliveriesClaimed = claims.length;

  if (claims.length > 0) {
    const claimedNotifications = new Map(
      claims.map((row) => [row.delivery_id, row.notification_id]),
    );
    const confirmation = await admin.rpc(
      "community_confirm_notification_push_batch",
      {
        p_lease_token: sendLease,
        p_delivery_ids: [...claimedNotifications.keys()],
      },
    );
    if (confirmation.error) {
      return json({ error: "Push delivery confirmation unavailable", ...stats }, 503);
    }
    const confirmed = parseConfirmed(confirmation.data, claimedNotifications);
    if (!confirmed) {
      return json({ error: "Push delivery confirmation invalid", ...stats }, 503);
    }
    stats.deliveriesConfirmed = confirmed.length;

    if (confirmed.length > 0) {
      const ticketResults = await sendExpoReplyPushBatch(
        confirmed,
        expoAccessToken,
      );
      for (const result of ticketResults) {
        const recorded = await admin.rpc(
          "community_record_notification_push_ticket",
          result.status === "ok"
            ? {
                p_delivery_id: result.deliveryId,
                p_lease_token: sendLease,
                p_ticket_id: result.ticketId,
                p_error_code: null,
              }
            : {
                p_delivery_id: result.deliveryId,
                p_lease_token: sendLease,
                p_ticket_id: null,
                p_error_code: result.errorCode,
              },
        );
        if (recorded.error || recorded.data !== true) {
          stats.persistenceFailed += 1;
        } else if (result.status === "ok") {
          stats.ticketsOk += 1;
        } else {
          stats.ticketsFailed += 1;
        }
      }
    }
  }

  if (stats.persistenceFailed > 0) {
    return json({ error: "Push delivery persistence incomplete", ...stats }, 503);
  }
  return json({ ok: true, ...stats });
}
