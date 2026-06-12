// Cloudflare Turnstile 서버 검증 — 가입 등 남용 표면의 봇 차단.
//
// 키가 없으면 자동 no-op(검증 통과) — 키 발급 전에도 무중단,
// TURNSTILE_SECRET_KEY를 Vercel에 넣는 순간 강제 활성화된다(Sentry/PostHog 패턴).
//
// 환경변수:
//   NEXT_PUBLIC_TURNSTILE_SITE_KEY  (클라 위젯 렌더용 — 공개)
//   TURNSTILE_SECRET_KEY            (서버 검증용 — 비공개)

const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export interface TurnstileVerifyResult {
  /** 검증 통과 여부. 시크릿 미설정 시 항상 true(no-op). */
  ok: boolean;
  /** no-op(시크릿 미설정)으로 통과한 경우 true — 로깅 구분용. */
  skipped: boolean;
}

export async function verifyTurnstile(
  token: string | undefined | null,
  remoteIp?: string | null
): Promise<TurnstileVerifyResult> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) return { ok: true, skipped: true };

  if (!token) return { ok: false, skipped: false };

  try {
    const body = new URLSearchParams();
    body.set("secret", secret);
    body.set("response", token);
    if (remoteIp) body.set("remoteip", remoteIp);

    const res = await fetch(VERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    const data = (await res.json()) as { success?: boolean };
    return { ok: data.success === true, skipped: false };
  } catch {
    // 검증 서버 장애 시 가입을 완전히 막지 않는다(fail-open) — 단,
    // 시크릿이 설정된 상태이므로 정상 경로에선 거의 발생하지 않는다.
    return { ok: true, skipped: true };
  }
}
