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

export const BETA_TOTAL = 50;

export async function getBetaCount(): Promise<number> {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) return 0;
    const admin = createClient(url, key, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { count } = await admin
      .from("preregistrations")
      .select("id", { count: "exact", head: true })
      .eq("is_beta_candidate", true);
    return count ?? 0;
  } catch {
    return 0;
  }
}
