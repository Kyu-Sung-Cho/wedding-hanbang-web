// =============================================
// 베타 모집 카운트 — server-side 공용 fetch helper
// =============================================
// 사용처:
//   - /beta page (신청 폼 + 진척 카드)
//   - / (root landing) BetaCTA 섹션
//   - /about ForBetaCouples 섹션
// 결과는 ISR (revalidate)로 캐시되어 60초마다 새로고침.
// =============================================

import { createClient } from "@supabase/supabase-js";
import { USER_RESEARCH_COHORT_CODE } from "@/constants/beta";

export { BETA_COUNTER_MIN, BETA_TOTAL, shouldShowBetaCounter } from "@/constants/beta";

const BETA_COUNT_TIMEOUT_MS = 2_000;

const betaCountFetch: typeof fetch = (input, init) =>
  fetch(input, {
    ...init,
    signal: AbortSignal.timeout(BETA_COUNT_TIMEOUT_MS),
  });

export async function getBetaCount(): Promise<number> {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) return 0;
    const admin = createClient(url, key, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { fetch: betaCountFetch },
    });
    const { count } = await admin
      .from("research_cohort_applications")
      .select("id", { count: "exact", head: true })
      .eq("cohort_code", USER_RESEARCH_COHORT_CODE)
      .not("privacy_consent_at", "is", null)
      .not("email_verified_at", "is", null)
      .gt("expires_at", new Date().toISOString());
    return count ?? 0;
  } catch {
    return 0;
  }
}
