/**
 * 메일 인증 링크의 만료를 **우리가** 강제한다.
 *
 * ## 왜 필요한가
 *
 * 전에는 만료를 전혀 검사하지 않았다. Supabase 대시보드의 만료 설정에 전적으로
 * 기댔는데, 그 값은 코드에서 읽을 수 없고 콘솔에서 조용히 바뀔 수 있다. 그런데
 * 재설정 메일은 "이 링크는 24시간 동안 유효합니다"라고 **단정**하고 있었다 —
 * 참인지 아무도 확인할 수 없는 문장이었다.
 *
 * 그래서 링크에 만료 시각을 싣고 서명한다. 서명이 없으면 시각을 늘려 붙이는
 * 것만으로 링크를 영원히 살릴 수 있다.
 *
 * ## 왜 새 환경변수를 만들지 않았나
 *
 * 이 저장소는 **env 하나가 없어 프로덕션 빌드가 통째로 죽은** 적이 있다. 서명
 * 키를 새 필수 변수로 만들면 같은 함정을 하나 더 파는 셈이다. 그래서 이미
 * 필수인 `SUPABASE_SERVICE_ROLE_KEY` 에서 **용도를 섞지 않도록 파생**해서 쓴다 —
 * 그 키가 없으면 애초에 링크를 만들지도 못하므로 새로운 실패 지점이 생기지 않는다.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

/** 파생 라벨. 키를 다른 용도와 섞지 않기 위한 것이므로 바꾸면 기존 링크가 전부 무효가 된다. */
const DERIVATION_LABEL = "hanbang:email-confirm-link:v1";

function signingKey(): Buffer | null {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) return null;
  return createHmac("sha256", secret).update(DERIVATION_LABEL).digest();
}

/**
 * 서명 대상. **만료 시각만 서명하면 안 된다** — 그러면 한 링크의 서명을 떼어
 * 다른 토큰에 붙일 수 있다. 토큰과 종류를 함께 묶는다.
 */
function payload(tokenHash: string, type: string, expiresAt: number): string {
  return `${type}.${tokenHash}.${expiresAt}`;
}

export function signEmailConfirm(
  tokenHash: string,
  type: string,
  expiresAt: number,
): string | null {
  const key = signingKey();
  if (!key) return null;
  return createHmac("sha256", key)
    .update(payload(tokenHash, type, expiresAt))
    .digest("base64url");
}

export type EmailConfirmSignatureVerdict =
  /** 서명이 맞고 아직 살아 있다. */
  | "valid"
  /** 서명은 맞는데 시간이 지났다. 새 메일을 받으면 된다. */
  | "expired"
  /** 서명이 아예 없다 — 이 기능 이전에 나간 옛 링크다. 사용자 행동은 만료와 같다. */
  | "unsigned"
  /** 서명이 틀렸다. 값을 손댔거나 다른 링크의 서명을 붙였다. */
  | "invalid";

/**
 * @param nowMs 현재 시각. 테스트가 시계를 넘길 수 있도록 인자로 받는다.
 */
export function verifyEmailConfirmSignature({
  tokenHash,
  type,
  expiresAt,
  signature,
  nowMs,
}: {
  tokenHash: string;
  type: string;
  expiresAt: string | null;
  signature: string | null;
  nowMs: number;
}): EmailConfirmSignatureVerdict {
  // 이 기능 이전에 나간 링크. 사용자가 할 일은 만료와 똑같다 — 새 메일 받기.
  if (!expiresAt && !signature) return "unsigned";
  if (!expiresAt || !signature) return "invalid";

  // 숫자가 아니거나 소수점·부호가 섞인 값은 받지 않는다.
  if (!/^\d{1,15}$/.test(expiresAt)) return "invalid";
  const expiry = Number(expiresAt);

  const expected = signEmailConfirm(tokenHash, type, expiry);
  // 키가 없으면 검증할 수 없다. **통과시키지 않는다** — 열어 두면 서명 검사가
  // 있으나 마나가 된다.
  if (!expected) return "invalid";

  const given = Buffer.from(signature, "base64url");
  const want = Buffer.from(expected, "base64url");
  if (given.length !== want.length || !timingSafeEqual(given, want)) return "invalid";

  // 서명을 먼저 본 뒤에 시간을 본다. 순서가 반대면 만료 여부가 서명 없이도
  // 새어 나간다.
  return expiry * 1000 <= nowMs ? "expired" : "valid";
}
