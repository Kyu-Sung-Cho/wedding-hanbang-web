import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(process.cwd(), "../..");
const read = (path: string) => readFileSync(resolve(repoRoot, path), "utf8");

describe("market-price derivation trust boundary", () => {
  it("does not present Hanbang-derived sums or unweighted Seoul averages as official prices", () => {
    const constants = read("apps/web/src/constants/marketPrices.ts");
    const client = read("apps/web/src/components/app/market-prices/MarketPricesClient.tsx");
    const seo = read("apps/web/src/components/app/market-prices/MarketPriceSeoContent.tsx");

    expect(constants).not.toContain("getSeoulAverages");
    expect(client).not.toContain("서울 vs 전국 비교");
    expect(client).not.toContain("서울 예식장 평균 계약금액");
    expect(client).not.toContain("선택항목 전체 합계");
    expect(seo).not.toContain("nationalVenueAverage");
    expect(seo).not.toContain("seoulVenueAverage");
  });

  it("does not solicit sensitive receipts before a verified intake process exists", () => {
    const client = read("apps/web/src/components/app/market-prices/MarketPricesClient.tsx");

    expect(client).not.toContain("실거래가 공유 신청");
    expect(client).not.toContain("영수증 기반 실거래가");
    expect(client).not.toContain("mailto:");
  });

  it("labels the community snapshot as source data instead of a personal-price shortcut", () => {
    const community = read("apps/web/src/components/community/CommunityLandingClient.tsx");

    expect(community).toContain("공식 조사 자료");
    expect(community).toContain("커뮤니티 경험담과 공식 조사값을 섞지 않습니다");
    expect(community).toContain("조사월·지역·포함 항목·통계 단위");
    expect(community).toContain('weddingLinkProps("/market-prices")');
    expect(community).not.toContain("전국 평균으로 대략 감만 먼저 잡아보세요");
    expect(community).not.toContain("약 {formatMarketPrice");
  });
});
