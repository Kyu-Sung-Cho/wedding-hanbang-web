// Cloudflare Turnstile 서버 검증 — 가입 등 남용 표면의 봇 차단.
//
// 로컬/프리뷰에서 키가 없으면 no-op. Production에서는 키 누락도 실패 처리한다.
//
// 환경변수:
//   NEXT_PUBLIC_TURNSTILE_SITE_KEY  (클라 위젯 렌더용 — 공개)
//   TURNSTILE_SECRET_KEY            (서버 검증용 — 비공개)

const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const MAX_TOKEN_LENGTH = 2_048;

export type TurnstileAction = "signup" | "forgot" | "preregister" | "survey";

export interface TurnstileVerifyResult {
  /** 검증 통과 여부. Production 시크릿 미설정은 false. */
  ok: boolean;
  /** 로컬/프리뷰 no-op(시크릿 미설정)으로 통과한 경우 true — 로깅 구분용. */
  skipped: boolean;
}

function requiresTurnstileSecret(): boolean {
  return process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "production";
}

export async function verifyTurnstile(
  token: string | undefined | null,
  remoteIp: string | null | undefined,
  expectedAction: TurnstileAction,
  expectedHostname: string | null,
): Promise<TurnstileVerifyResult> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) {
    // Missing production credentials are a security failure, not a feature
    // toggle. Otherwise deleting both keys silently disables bot attestation.
    return requiresTurnstileSecret()
      ? { ok: false, skipped: false }
      : { ok: true, skipped: true };
  }

  if (!token || token.length > MAX_TOKEN_LENGTH) {
    return { ok: false, skipped: false };
  }

  try {
    const body = new URLSearchParams();
    body.set("secret", secret);
    body.set("response", token);
    if (remoteIp) body.set("remoteip", remoteIp);

    const res = await fetch(VERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      // siteverify 지연으로 가입 표면이 무방비 통과 모드에 빠지지 않도록 타임아웃.
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return { ok: false, skipped: false };
    const data = (await res.json()) as {
      success?: boolean;
      action?: unknown;
      hostname?: unknown;
    };
    const actionMatches = data.action === expectedAction;
    // The public site key can be embedded elsewhere if dashboard hostname
    // restrictions drift. Bind every accepted token to the exact hostname at
    // the trusted Next request-URL boundary as recommended by Siteverify.
    const hostnameMatches = typeof expectedHostname === "string"
      && expectedHostname.length > 0
      && data.hostname === expectedHostname;
    return {
      ok: data.success === true && actionMatches && hostnameMatches,
      skipped: false,
    };
  } catch {
    // fail-closed: 시크릿이 설정됐는데 검증을 못 했다면 가입을 거부한다.
    // (이메일 폭탄 방어가 목적인 표면이라, 장애 시 통과보다 거부가 안전.
    //  시크릿 미설정 시는 위에서 이미 통과 반환하므로 영향 없음.)
    return { ok: false, skipped: false };
  }
}

// 이메일 기반 rate limit 키를 위한 정규화 — Gmail dot/plus 별칭을 하나로 합쳐
// victim+1@, v.i.c.t.i.m@ 같은 변형으로 이메일당 한도를 우회하는 폭탄을 막는다.
export function normalizeEmailForRateLimit(raw: string): string {
  const email = String(raw).trim().toLowerCase();
  const at = email.lastIndexOf("@");
  if (at < 0) return email;
  let local = email.slice(0, at);
  const domain = email.slice(at + 1);
  if (domain === "gmail.com" || domain === "googlemail.com") {
    local = local.split("+")[0].replace(/\./g, "");
    return `${local}@gmail.com`;
  }
  // 그 외 도메인은 plus 별칭만 제거(점은 도메인마다 의미가 달라 보존).
  local = local.split("+")[0];
  return `${local}@${domain}`;
}
