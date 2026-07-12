// Cloudflare Turnstile 서버 검증 — 가입 등 남용 표면의 봇 차단.
//
// 로컬 개발/테스트에서만 키가 없으면 no-op. Production-mode build와
// Vercel Production에서는 키 누락도 실패 처리한다.
//
// 환경변수:
//   NEXT_PUBLIC_TURNSTILE_SITE_KEY  (클라 위젯 렌더용 — 공개)
//   TURNSTILE_SECRET_KEY            (서버 검증용 — 비공개)

const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
export const PRODUCTION_TURNSTILE_HOSTNAME = "hanbang.ai";

export interface TurnstileVerifyResult {
  /** 검증 통과 여부. Production 시크릿 미설정은 false. */
  ok: boolean;
  /** 로컬 개발/테스트 no-op으로 통과한 경우 true — 로깅 구분용. */
  skipped: boolean;
}

function requiresTurnstileSecret(): boolean {
  return process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "production";
}

export type TurnstileAction =
  | "signup"
  | "forgot_password"
  | "preregister"
  | "survey";

function isPlausibleTurnstileKey(value: string | undefined): boolean {
  if (!value || value !== value.trim()) return false;
  const normalized = value?.trim() ?? "";
  return normalized.length >= 20
    && normalized.length <= 128
    && /^[A-Za-z0-9_-]+$/.test(normalized)
    && !/(?:placeholder|changeme|example|test)/i.test(normalized)
    && !/^[123]x0{10,}[A-Z]{2}$/i.test(normalized);
}

function configuredTurnstileHostname(): string | null {
  const configuredSiteUrl = process.env.NEXT_PUBLIC_SITE_URL;
  if (!configuredSiteUrl || configuredSiteUrl !== configuredSiteUrl.trim()) return null;
  const rawSiteUrl = configuredSiteUrl;

  try {
    const parsed = new URL(rawSiteUrl);
    if (
      parsed.protocol !== "https:"
      || parsed.username
      || parsed.password
      || parsed.port
      || (parsed.pathname !== "/" && parsed.pathname !== "")
      || parsed.search
      || parsed.hash
      || !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(
        parsed.hostname
      )
    ) {
      return null;
    }
    return parsed.hostname.toLowerCase();
  } catch {
    return null;
  }
}

/** Boolean-only configuration evidence. Never returns either credential. */
export function hasTurnstileCredentials(): boolean {
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  const secretKey = process.env.TURNSTILE_SECRET_KEY;
  return isPlausibleTurnstileKey(siteKey)
    && isPlausibleTurnstileKey(secretKey)
    && siteKey !== secretKey;
}

/**
 * The public site URL is mutable deployment configuration, not an authority for
 * which hostname may redeem production tokens. Keep the comparison exact so a
 * syntactically valid but wrong URL cannot silently move the trust boundary.
 */
export function hasCanonicalTurnstileHostname(): boolean {
  return configuredTurnstileHostname() === PRODUCTION_TURNSTILE_HOSTNAME;
}

/**
 * Configuration readiness only. A real browser token for every expected action
 * must still be independently attested before release.
 */
export function hasTurnstileConfig(): boolean {
  return hasTurnstileCredentials() && hasCanonicalTurnstileHostname();
}

export async function verifyTurnstile(
  token: string | undefined | null,
  remoteIp?: string | null,
  expectedAction?: TurnstileAction
): Promise<TurnstileVerifyResult> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!hasTurnstileConfig() || !secret) {
    return requiresTurnstileSecret()
      ? { ok: false, skipped: false }
      : { ok: true, skipped: true };
  }

  if (!token || token.length > 2048 || !expectedAction) {
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
    const data = (await res.json()) as {
      success?: boolean;
      hostname?: string;
      action?: string;
    };
    return {
      ok: data.success === true
        && data.hostname?.toLowerCase() === PRODUCTION_TURNSTILE_HOSTNAME
        && data.action === expectedAction,
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
