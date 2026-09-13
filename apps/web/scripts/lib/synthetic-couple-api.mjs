import { readFileSync } from "node:fs";

const policySource = readFileSync(new URL("../../../../packages/shared/src/contracts/signupConsent.ts", import.meta.url), "utf8");
const policyMatches = [...policySource.matchAll(/export const SIGNUP_CONSENT_POLICY_VERSION = "([^"\r\n]+)";/g)];
if (policyMatches.length !== 1) throw new Error("SYNTHETIC_CONSENT_POLICY_UNAVAILABLE");

export function validateSyntheticAppUrl(value, expectedRef) {
  let url;
  try { url = new URL(value); } catch { throw new Error("AMORA_PREVIEW_APP_URL_REQUIRED"); }
  const local = ["localhost", "127.0.0.1"].includes(url.hostname);
  const production = ["hanbang.ai", "www.hanbang.ai"].includes(url.hostname);
  if ((!local && url.protocol !== "https:") || (local && !["http:", "https:"].includes(url.protocol))
      || (!local && !production && !url.hostname.endsWith(".vercel.app"))
      || url.username || url.password || url.pathname !== "/" || url.search || url.hash
      || (production && expectedRef !== "slrtobkksjmxgzatjyqb")) throw new Error("SYNTHETIC_APP_TARGET_INVALID");
  return url.origin;
}

// 시험에서 만든 계정만 호출한다. 실제 고객 대신 동의를 기록하는 도구로 쓰지 않는다.
export async function joinSyntheticCoupleViaApi({ user, inviteCode, expectedCoupleId, role, appUrl, expectedRef, fetchImpl = fetch }) {
  const origin = validateSyntheticAppUrl(appUrl, expectedRef);
  if (!["bride", "groom"].includes(role) || !user?.id || !/^WH-[A-Z0-9]{6,12}$/.test(inviteCode)) throw new Error("SYNTHETIC_JOIN_INPUT_INVALID");
  const verified = await user.client.auth.getUser();
  const session = await user.client.auth.getSession();
  if (verified.error || verified.data?.user?.id !== user.id || session.data?.session?.user?.id !== user.id || !session.data.session.access_token) throw new Error("SYNTHETIC_JOIN_OWNER_MISMATCH");
  const headers = { Authorization: `Bearer ${session.data.session.access_token}`, Origin: origin, "Content-Type": "application/json" };
  async function request(path, body) {
    const response = await fetchImpl(`${origin}${path}`, { method: body ? "POST" : "GET", headers, redirect: "error", signal: AbortSignal.timeout(30000), ...(body ? { body: JSON.stringify(body) } : {}) });
    if (!response.ok) throw new Error(`SYNTHETIC_JOIN_API_FAILED_${response.status}`);
    return response.json();
  }
  // 다른 Supabase를 향한 앱이면 쓰기 전에 거절한다. 토큰/응답 원문은 로그에 남기지 않는다.
  const me = await request("/api/auth/me?consent_only=1");
  if (me.user?.id !== user.id) throw new Error("SYNTHETIC_JOIN_API_OWNER_MISMATCH");
  const consent = await request("/api/auth/consent", { termsAgreed: true, privacyAgreed: true, ageOver14Confirmed: true, marketingAgreed: false, consentPolicyVersion: policyMatches[0][1] });
  if (consent.success !== true) throw new Error("SYNTHETIC_JOIN_CONSENT_UNVERIFIED");
  const joined = await request("/api/onboarding", { role, coupleAction: "join", partnerInviteCode: inviteCode });
  if (joined.success !== true || joined.coupleId !== expectedCoupleId) throw new Error("SYNTHETIC_JOIN_API_POSTCONDITION_FAILED");
  return joined;
}
