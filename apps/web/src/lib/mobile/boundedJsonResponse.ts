import { NextResponse } from "next/server";

export const MAX_MOBILE_BRIDGE_RESPONSE_BYTES = 256 * 1024;
export const MOBILE_BRIDGE_RESPONSE_BYTES_HEADER = "x-hanbang-response-bytes";

const TOO_LARGE_BODY = JSON.stringify({
  error: "응답이 너무 커서 안전하게 전송할 수 없습니다.",
});

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function serializedJsonResponse(
  serialized: string,
  init: ResponseInit,
): NextResponse {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set(MOBILE_BRIDGE_RESPONSE_BYTES_HEADER, String(utf8Bytes(serialized)));
  headers.set("x-content-type-options", "nosniff");
  return new NextResponse(serialized, { ...init, headers });
}

/**
 * JSON response contract for API routes exposed through the native WebView.
 * React Native fetch may omit both ReadableStream and Content-Length, so the
 * trusted origin declares the exact decoded UTF-8 size before sending it.
 */
export function mobileBridgeJson(
  value: unknown,
  init: ResponseInit = {},
): NextResponse {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) {
    throw new TypeError("MOBILE_BRIDGE_JSON_UNSERIALIZABLE");
  }
  if (utf8Bytes(serialized) > MAX_MOBILE_BRIDGE_RESPONSE_BYTES) {
    return serializedJsonResponse(TOO_LARGE_BODY, {
      ...init,
      status: 507,
    });
  }
  return serializedJsonResponse(serialized, init);
}
