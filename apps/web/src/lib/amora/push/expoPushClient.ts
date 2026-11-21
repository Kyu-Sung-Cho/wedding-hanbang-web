/**
 * 아모라 앱 알림을 Expo 에 넘기는 작은 발송기. 커뮤니티 답글 발송기(`lib/community/notificationPushDelivery.ts`)와
 * 같은 주소·머리글·크기 한도·오류 이름을 쓴다. 그쪽은 답글 모양만 받도록 묶여 있어 공유하지 않고 같은 규칙을 따른다.
 * Expo 의 오류 글(message)은 남기지 않고 오류 이름(details.error)만 돌려준다.
 */
import type { AmoraPushMessage } from "@hanbang/shared/amora-push";

export const EXPO_PUSH_SEND_URL = "https://exp.host/--/api/v2/push/send";
const MAX_BATCH = 8;
const MAX_REQUEST_BYTES = 64 * 1024;
const MAX_RESPONSE_BYTES = 256 * 1024;
const TIMEOUT_MS = 10_000;

export type AmoraPushProviderError =
  | "DeviceNotRegistered"
  | "MessageTooBig"
  | "MessageRateExceeded"
  | "MismatchSenderId"
  | "InvalidCredentials"
  | "ExpoServerError"
  | "network_error"
  | "invalid_response";

export type AmoraPushTicket = { ok: true } | { ok: false; error: AmoraPushProviderError };

const PROVIDER_ERRORS: ReadonlySet<string> = new Set([
  "DeviceNotRegistered",
  "MessageTooBig",
  "MessageRateExceeded",
  "MismatchSenderId",
  "InvalidCredentials",
]);

function httpErrorCode(status: number): AmoraPushProviderError {
  if (status === 429) return "MessageRateExceeded";
  if (status === 401 || status === 403) return "InvalidCredentials";
  if (status === 413) return "MessageTooBig";
  if (status >= 500) return "ExpoServerError";
  return "invalid_response";
}

function ticketFrom(value: unknown): AmoraPushTicket {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ok: false, error: "invalid_response" };
  const record = value as Record<string, unknown>;
  if (record.status === "ok" && typeof record.id === "string" && /^[A-Za-z0-9_-]{16,128}$/.test(record.id)) {
    return { ok: true };
  }
  if (record.status === "error") {
    const details = record.details;
    const code = details && typeof details === "object" ? (details as Record<string, unknown>).error : undefined;
    return { ok: false, error: typeof code === "string" && PROVIDER_ERRORS.has(code) ? code as AmoraPushProviderError : "ExpoServerError" };
  }
  return { ok: false, error: "invalid_response" };
}

/** 메시지마다 결과 하나. 요청 자체가 실패하면 모든 메시지가 같은 오류를 받는다. */
export async function sendExpoPushMessages(
  messages: readonly AmoraPushMessage[],
  accessToken: string,
  fetcher: typeof fetch = fetch,
): Promise<AmoraPushTicket[]> {
  if (messages.length < 1 || messages.length > MAX_BATCH) throw new Error("AMORA_PUSH_BATCH_INVALID");
  const body = JSON.stringify(messages);
  if (new TextEncoder().encode(body).byteLength > MAX_REQUEST_BYTES) {
    return messages.map(() => ({ ok: false, error: "MessageTooBig" }));
  }
  let response: Response;
  try {
    response = await fetcher(EXPO_PUSH_SEND_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Accept-Encoding": "gzip, deflate",
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body,
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    return messages.map(() => ({ ok: false, error: "network_error" }));
  }
  if (!response.ok) {
    const error = httpErrorCode(response.status);
    return messages.map(() => ({ ok: false, error }));
  }
  let parsed: unknown;
  try {
    const text = await response.text();
    if (text.length > MAX_RESPONSE_BYTES) throw new Error("too large");
    parsed = JSON.parse(text);
  } catch {
    return messages.map(() => ({ ok: false, error: "invalid_response" }));
  }
  const data = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>).data : undefined;
  if (!Array.isArray(data) || data.length !== messages.length) {
    return messages.map(() => ({ ok: false, error: "invalid_response" }));
  }
  return data.map(ticketFrom);
}
