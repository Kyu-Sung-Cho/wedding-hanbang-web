/**
 * `/api/invitation/*` 부르기(청첩장 디자인 실제 커플 화면, 2026-11-17).
 *
 * 같은 출처로만 부르고 쿠키를 싣는다(`credentials: "same-origin"`). 쓰기 요청은 서버가 출처를 다시 본다.
 * 서버 오류는 `{ error: 사람이 읽는 문장, code: 기계가 읽는 코드 }` 다. 화면은 코드를 보고 상태 문구로
 * 바꾸고, 내부 오류 원문은 처음부터 응답에 없다.
 */

export const INVITATION_API_BASE = "/api/invitation";

export type InvitationApiFailure = {
  ok: false;
  /** HTTP 상태. 응답을 받지 못했으면 0 이다(연결 끊김·중단). */
  status: number;
  code: string | null;
  /** 서버가 준 사람이 읽는 문장. 없으면 null. */
  error: string | null;
  /** 화면이 떠나거나 새 요청이 앞 요청을 멈췄다. 화면은 이 실패를 보여 주지 않는다. */
  aborted: boolean;
};

export type InvitationApiResult<T> = { ok: true; data: T } | InvitationApiFailure;

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readJson(response: Response): Promise<unknown> {
  try {
    const text = await response.text();
    return text ? (JSON.parse(text) as unknown) : null;
  } catch {
    return null;
  }
}

/**
 * 한 번 부른다. 응답 모양은 `accept` 가 경계에서 확인한다(서버와 화면 번들이 어긋난 배포 사이 등).
 * 모양이 틀리면 실패로 돌려준다 — 틀린 모델로 화면을 그리지 않는다.
 */
export async function invitationRequest<T>(
  path: string,
  options: {
    method?: Method;
    body?: unknown;
    signal?: AbortSignal;
    accept: (value: unknown) => value is T;
  },
): Promise<InvitationApiResult<T>> {
  const hasBody = options.body !== undefined;
  let response: Response;
  try {
    response = await fetch(`${INVITATION_API_BASE}${path}`, {
      method: options.method ?? "GET",
      credentials: "same-origin",
      cache: "no-store",
      headers: hasBody ? { Accept: "application/json", "Content-Type": "application/json" } : { Accept: "application/json" },
      body: hasBody ? JSON.stringify(options.body) : undefined,
      signal: options.signal,
    });
  } catch {
    return { ok: false, status: 0, code: null, error: null, aborted: options.signal?.aborted === true };
  }

  const payload = await readJson(response);
  if (options.signal?.aborted) return { ok: false, status: 0, code: null, error: null, aborted: true };
  if (!response.ok) {
    const failure = isRecord(payload) ? payload : {};
    return {
      ok: false,
      status: response.status,
      code: typeof failure.code === "string" ? failure.code : null,
      error: typeof failure.error === "string" ? failure.error : null,
      aborted: false,
    };
  }
  if (!options.accept(payload)) {
    return { ok: false, status: response.status, code: "RESPONSE_SHAPE", error: null, aborted: false };
  }
  return { ok: true, data: payload };
}
