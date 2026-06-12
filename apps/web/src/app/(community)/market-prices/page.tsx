// 서버 컴포넌트 — 검색엔진이 시세 본문을 읽을 수 있도록 SEO 콘텐츠를 정적 렌더한 뒤
// 인터랙티브 탭 UI(클라이언트)를 함께 렌더. metadata는 layout.tsx가 제공.
import MarketPricesClient from "@/components/app/market-prices/MarketPricesClient";
import MarketPriceSeoContent from "@/components/app/market-prices/MarketPriceSeoContent";

export default function MarketPricesPage() {
  return (
    <>
      <MarketPricesClient />
      <div className="mx-auto w-full max-w-[1120px] px-4 pb-12 sm:px-6">
        <MarketPriceSeoContent />
      </div>
    </>
  );
}
