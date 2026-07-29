import { loadPriceCatalogWithBuildFallback } from "./buildCatalog";
import { loadPublicPriceCatalog } from "./publicListData";
import {
  EMPTY_AGENCY_SPREAD_SUMMARY,
  summarizeAgencySpread,
  type AgencySpreadSummary,
} from "./agencySpread";
import { createPublicClient } from "@/lib/supabase/public";

/**
 * 첫 화면이 쓸 대행사 간 공시가 차이 요약.
 *
 * **절대 던지지 않는다.** 첫 화면은 커뮤니티 피드가 본문이고 이 숫자는 그 위에 얹는
 * 증거다. 공시 조회가 흔들린다고 랜딩이 500으로 죽으면 잃는 게 훨씬 크다 —
 * 실패하면 빈 요약을 돌려주고, 화면은 숫자 블록만 빼고 그대로 선다.
 * 조용히 사라지는 것이 유일한 위험이므로 로그 접두어를 남겨 Vercel 함수 로그에서
 * 바로 잡을 수 있게 한다(`v_public_vendor_policies`와 같은 방식).
 *
 * 옵션 원문은 한 건도 받지 않는다(`optionCategories: []`) — 차이 계산에 필요한 것은
 * 대행사별 기본가뿐이고, 옵션까지 받으면 첫 화면이 수천 행을 끌어온다.
 */
export async function loadLandingAgencySpread(): Promise<AgencySpreadSummary> {
  try {
    const catalog = await loadPriceCatalogWithBuildFallback(() => (
      loadPublicPriceCatalog(createPublicClient(), { optionCategories: [] })
    ));
    return summarizeAgencySpread(catalog);
  } catch (cause) {
    console.error(
      "[landing-agency-spread] 공시가 차이 요약 실패 — 첫 화면에서 숫자 블록이 사라진다:",
      cause,
    );
    return EMPTY_AGENCY_SPREAD_SUMMARY;
  }
}
