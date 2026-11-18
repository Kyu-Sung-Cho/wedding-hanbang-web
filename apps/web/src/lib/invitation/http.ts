import { NextResponse } from "next/server";
import { readBoundedUtf8Text } from "@/utils/requestValidation";

/**
 * `/api/invitation/*` 가 함께 쓰는 응답 모양. 커플의 준비 정보가 실리므로 늘 캐시하지 않는다.
 * 오류는 사람이 읽는 문장과 기계가 읽는 코드를 함께 준다. 내부 오류 원문은 싣지 않는다.
 */

const PRIVATE_NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  Vary: "Authorization, Cookie",
} as const;

export function privateJson(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: PRIVATE_NO_STORE_HEADERS });
}

export function apiError(status: number, code: string, error: string): NextResponse {
  return privateJson({ error, code }, status);
}

/** 요청 제한 응답처럼 다른 곳이 만든 응답에도 같은 캐시 머리를 붙인다. */
export function withPrivateHeaders(response: Response): Response {
  response.headers.set("Cache-Control", PRIVATE_NO_STORE_HEADERS["Cache-Control"]);
  return response;
}

export type JsonBodyResult = { ok: true; value: unknown } | { ok: false; response: NextResponse };

/** 본문을 정해진 크기까지만 읽고 JSON 으로 푼다. 실패하면 바로 돌려줄 응답을 준다. */
export async function readJsonBody(request: Request, maxBytes: number): Promise<JsonBodyResult> {
  const text = await readBoundedUtf8Text(request, maxBytes);
  if (!text.ok) {
    return text.reason === "too_large"
      ? { ok: false, response: apiError(413, "BODY_TOO_LARGE", "요청 내용이 너무 커요.") }
      : { ok: false, response: apiError(400, "BODY_UNREADABLE", "요청 내용을 읽지 못했어요.") };
  }
  try {
    return { ok: true, value: JSON.parse(text.text) as unknown };
  } catch {
    return { ok: false, response: apiError(400, "BODY_NOT_JSON", "요청 형식이 올바르지 않아요.") };
  }
}

export const UNTRUSTED_ORIGIN = () => apiError(403, "UNTRUSTED_ORIGIN", "잘못된 요청 출처예요.");
export const AUTH_REQUIRED = () => apiError(401, "AUTH_REQUIRED", "로그인이 필요해요.");
