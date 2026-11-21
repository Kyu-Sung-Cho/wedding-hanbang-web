import { createHmac, timingSafeEqual } from "node:crypto";

// 10장 P2.7: 케어 메일마다 한 번 눌러 수신을 끊는 링크와 List-Unsubscribe 머리글을 넣는다.
//
// 토큰은 받는 사람의 id 에 서버 비밀값으로 서명한 값이다. 같은 사람에게는 늘 같은 토큰이라
// 메일 발송을 재시도해도 요청이 한 글자도 바뀌지 않는다(Resend 의 같은 요청 키 규칙).
// 토큰으로 할 수 있는 일은 그 사람의 케어 메일 동의를 끄는 것 하나뿐이다.

const VERSION = "v1";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MIN_SECRET_LENGTH = 32;

export const CARE_UNSUBSCRIBE_PATH = "/api/amora/care/unsubscribe";

type EnvLike = Record<string, string | undefined>;

export function readCareUnsubscribeSecret(env: EnvLike = process.env): string | null {
  const secret = env.AMORA_CARE_UNSUBSCRIBE_SECRET?.trim();
  return secret && secret.length >= MIN_SECRET_LENGTH ? secret : null;
}

function sign(secret: string, userId: string): string {
  return createHmac("sha256", secret)
    .update(`amora-care-email-unsubscribe:${VERSION}:${userId.toLowerCase()}`)
    .digest("base64url");
}

export function buildCareUnsubscribeToken(secret: string, userId: string): string {
  if (!UUID_PATTERN.test(userId)) {
    throw new Error("care unsubscribe token needs a user uuid");
  }
  return `${VERSION}.${userId.toLowerCase()}.${sign(secret, userId)}`;
}

/** 서명이 맞으면 그 사람의 id 를, 아니면 null 을 돌려준다. */
export function verifyCareUnsubscribeToken(secret: string, token: unknown): string | null {
  if (typeof token !== "string" || token.length > 200) return null;
  const [version, userId, signature, ...rest] = token.split(".");
  if (rest.length > 0 || version !== VERSION || !userId || !signature) return null;
  if (!UUID_PATTERN.test(userId)) return null;
  const expected = Buffer.from(sign(secret, userId));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  return userId.toLowerCase();
}

export function buildCareUnsubscribeUrl(site: string, token: string): string {
  return `${site.replace(/\/+$/, "")}${CARE_UNSUBSCRIBE_PATH}?t=${encodeURIComponent(token)}`;
}

/** RFC 2369 / RFC 8058 머리글. 메일 앱이 "구독 취소" 단추를 그리고 한 번의 POST 로 끝낸다. */
export function careUnsubscribeHeaders(url: string): Record<string, string> {
  return {
    "List-Unsubscribe": `<${url}>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  };
}
