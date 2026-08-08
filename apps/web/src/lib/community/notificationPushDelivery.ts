import { buildCommunityRemoteReplyPushPayload } from "@hanbang/shared/community-notification";

const EXPO_SEND_URL = "https://exp.host/--/api/v2/push/send";
const EXPO_RECEIPT_URL = "https://exp.host/--/api/v2/push/getReceipts";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EXPO_TOKEN_PATTERN = /^(Exponent|Expo)PushToken\[[A-Za-z0-9_-]+\]$/;
const EXPO_TICKET_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;
const MAX_BATCH_SIZE = 50;
const MAX_REQUEST_BYTES = 64 * 1024;
const MAX_RESPONSE_BYTES = 256 * 1024;
const REQUEST_TIMEOUT_MS = 10_000;

export type PushProviderErrorCode =
  | "DeviceNotRegistered"
  | "MessageTooBig"
  | "MessageRateExceeded"
  | "MismatchSenderId"
  | "InvalidCredentials"
  | "ExpoServerError"
  | "network_error"
  | "invalid_response";

export type ConfirmedPushDelivery = {
  delivery_id: string;
  notification_id: string;
  push_token: string;
  kind: "post_reply" | "comment_reply";
  post_id: string;
  comment_id: string;
};

export type ReceiptClaim = {
  delivery_id: string;
  expo_ticket_id: string;
};

export type PushTicketResult =
  | { deliveryId: string; status: "ok"; ticketId: string }
  | { deliveryId: string; status: "error"; errorCode: PushProviderErrorCode };

export type PushReceiptResult =
  | { deliveryId: string; status: "ok" }
  | { deliveryId: string; status: "error"; errorCode: PushProviderErrorCode }
  | { deliveryId: string; status: "not_ready" | "invalid_response" };

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function isExpoTicketId(value: unknown): value is string {
  return typeof value === "string" && EXPO_TICKET_PATTERN.test(value);
}

function providerErrorCode(value: unknown): PushProviderErrorCode | null {
  if (
    value === "DeviceNotRegistered"
    || value === "MessageTooBig"
    || value === "MessageRateExceeded"
    || value === "MismatchSenderId"
    || value === "InvalidCredentials"
    || value === "ExpoServerError"
  ) {
    return value;
  }
  return null;
}

function httpErrorCode(status: number): PushProviderErrorCode {
  if (status === 429) return "MessageRateExceeded";
  if (status === 401 || status === 403) return "InvalidCredentials";
  if (status === 413) return "MessageTooBig";
  if (status >= 500) return "ExpoServerError";
  return "invalid_response";
}

function requestHeaders(accessToken: string) {
  return {
    Accept: "application/json",
    "Accept-Encoding": "gzip, deflate",
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
  };
}

function assertBatchSize(rows: readonly unknown[]) {
  if (rows.length < 1 || rows.length > MAX_BATCH_SIZE) {
    throw new Error("NOTIFICATION_PUSH_BATCH_INVALID");
  }
}

function serializeBounded(value: unknown) {
  const serialized = JSON.stringify(value);
  if (new TextEncoder().encode(serialized).byteLength > MAX_REQUEST_BYTES) {
    throw new Error("NOTIFICATION_PUSH_REQUEST_TOO_LARGE");
  }
  return serialized;
}

async function readBoundedJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (new TextEncoder().encode(text).byteLength > MAX_RESPONSE_BYTES) {
    throw new Error("NOTIFICATION_PUSH_RESPONSE_TOO_LARGE");
  }
  return JSON.parse(text) as unknown;
}

function validateDelivery(row: ConfirmedPushDelivery) {
  if (
    !isUuid(row.delivery_id)
    || !isUuid(row.notification_id)
    || !isUuid(row.post_id)
    || !isUuid(row.comment_id)
    || !(row.kind === "post_reply" || row.kind === "comment_reply")
    || typeof row.push_token !== "string"
    || row.push_token.length > 512
    || !EXPO_TOKEN_PATTERN.test(row.push_token)
  ) {
    throw new Error("NOTIFICATION_PUSH_DELIVERY_INVALID");
  }
}

export function buildExpoReplyMessages(rows: readonly ConfirmedPushDelivery[]) {
  assertBatchSize(rows);
  return rows.map((row) => {
    validateDelivery(row);
    const collapseKey = `community-reply:${row.notification_id.toLowerCase()}`;
    const payload = buildCommunityRemoteReplyPushPayload({
      kind: row.kind,
      postId: row.post_id,
      commentId: row.comment_id,
      notificationId: row.notification_id,
      deliveryId: row.delivery_id,
    });
    return Object.freeze({
      to: row.push_token,
      sound: "default" as const,
      title: payload.title,
      body: payload.body,
      data: payload.data,
      collapseId: collapseKey,
      tag: collapseKey,
      ttl: 300,
      priority: "high" as const,
    });
  });
}

export async function sendExpoReplyPushBatch(
  rows: readonly ConfirmedPushDelivery[],
  accessToken: string,
  fetcher: typeof fetch = fetch,
): Promise<PushTicketResult[]> {
  let messages: ReturnType<typeof buildExpoReplyMessages>;
  try {
    messages = buildExpoReplyMessages(rows);
  } catch {
    return rows.map((row) => ({
      deliveryId: row.delivery_id,
      status: "error",
      errorCode: "invalid_response",
    }));
  }

  let response: Response;
  try {
    response = await fetcher(EXPO_SEND_URL, {
      method: "POST",
      headers: requestHeaders(accessToken),
      body: serializeBounded(messages),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      cache: "no-store",
    });
  } catch {
    return rows.map((row) => ({
      deliveryId: row.delivery_id,
      status: "error",
      errorCode: "network_error",
    }));
  }

  if (!response.ok) {
    const errorCode = httpErrorCode(response.status);
    return rows.map((row) => ({
      deliveryId: row.delivery_id,
      status: "error",
      errorCode,
    }));
  }

  let parsed: unknown;
  try {
    parsed = await readBoundedJson(response);
  } catch {
    parsed = null;
  }
  const ticketData = isPlainRecord(parsed) ? parsed.data : null;
  if (!Array.isArray(ticketData) || ticketData.length !== rows.length) {
    return rows.map((row) => ({
      deliveryId: row.delivery_id,
      status: "error",
      errorCode: "invalid_response",
    }));
  }

  return rows.map((row, index): PushTicketResult => {
    const ticket = ticketData[index];
    if (isPlainRecord(ticket) && ticket.status === "ok" && isExpoTicketId(ticket.id)) {
      return { deliveryId: row.delivery_id, status: "ok", ticketId: ticket.id };
    }
    if (isPlainRecord(ticket) && ticket.status === "error") {
      const details = isPlainRecord(ticket.details) ? ticket.details : null;
      return {
        deliveryId: row.delivery_id,
        status: "error",
        errorCode: providerErrorCode(details?.error) ?? "invalid_response",
      };
    }
    return {
      deliveryId: row.delivery_id,
      status: "error",
      errorCode: "invalid_response",
    };
  });
}

export async function getExpoPushReceipts(
  rows: readonly ReceiptClaim[],
  accessToken: string,
  fetcher: typeof fetch = fetch,
): Promise<PushReceiptResult[]> {
  assertBatchSize(rows);
  if (rows.some((row) => !isUuid(row.delivery_id) || !isExpoTicketId(row.expo_ticket_id))) {
    return rows.map((row) => ({
      deliveryId: row.delivery_id,
      status: "invalid_response",
    }));
  }

  let response: Response;
  try {
    response = await fetcher(EXPO_RECEIPT_URL, {
      method: "POST",
      headers: requestHeaders(accessToken),
      body: serializeBounded({ ids: rows.map((row) => row.expo_ticket_id) }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      cache: "no-store",
    });
  } catch {
    return rows.map((row) => ({
      deliveryId: row.delivery_id,
      status: "invalid_response",
    }));
  }

  if (!response.ok) {
    return rows.map((row) => ({
      deliveryId: row.delivery_id,
      status: response.status === 404 ? "not_ready" : "invalid_response",
    }));
  }

  let parsed: unknown;
  try {
    parsed = await readBoundedJson(response);
  } catch {
    parsed = null;
  }
  const receiptData = isPlainRecord(parsed) ? parsed.data : null;
  if (!isPlainRecord(receiptData)) {
    return rows.map((row) => ({
      deliveryId: row.delivery_id,
      status: "invalid_response",
    }));
  }

  return rows.map((row): PushReceiptResult => {
    const receipt = receiptData[row.expo_ticket_id];
    if (receipt === undefined) {
      return { deliveryId: row.delivery_id, status: "not_ready" };
    }
    if (isPlainRecord(receipt) && receipt.status === "ok") {
      return { deliveryId: row.delivery_id, status: "ok" };
    }
    if (isPlainRecord(receipt) && receipt.status === "error") {
      const details = isPlainRecord(receipt.details) ? receipt.details : null;
      const errorCode = providerErrorCode(details?.error);
      if (errorCode) {
        return { deliveryId: row.delivery_id, status: "error", errorCode };
      }
    }
    return { deliveryId: row.delivery_id, status: "invalid_response" };
  });
}
