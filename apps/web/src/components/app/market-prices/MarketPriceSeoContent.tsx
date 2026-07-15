// 서버 렌더 SEO 콘텐츠 — 검색엔진 크롤러가 시세 본문을 읽을 수 있게 보장.
// 인터랙티브 탭 UI(MarketPricesClient)는 hydration 후에만 콘텐츠를 다 펼치므로,
// 핵심 시세 숫자를 의미있는 HTML(표·문단)로 서버에서 정적 렌더한다.
// 사용자에게도 조사 항목 원문 범위를 확인하는 표로 유용 — cloaking 아님, 실제 콘텐츠.
import {
  PRICE_PERIODS,
  SDM_PACKAGES,
  DRESS_PRICES,
  MAKEUP_PRICES,
  SEASONAL_DATA,
  getLatestPeriodId,
  getNationalAverages,
  getRegionalCosts,
  REGION_LABELS,
} from "@/constants/marketPrices";
import { formatMarketPrice } from "@/lib/marketPrices/display";

function man(v: number | null | undefined) {
  return formatMarketPrice(v);
}

export default function MarketPriceSeoContent() {
  const pid = getLatestPeriodId();
  const period = PRICE_PERIODS.find((p) => p.id === pid);
  const label = period?.label ?? "최신";
  const nat = getNationalAverages(pid);
  const sdmNat = SDM_PACKAGES.find((s) => s.periodId === pid && s.region === "전체");
  const sdmSeoul = SDM_PACKAGES.find((s) => s.periodId === pid && s.region === "서울");
  const dressNat = DRESS_PRICES.find((d) => d.periodId === pid && d.scope === "national");
  const makeupNat = MAKEUP_PRICES.find((m) => m.periodId === pid && m.scope === "national");
  const seasonal = SEASONAL_DATA.find((s) => s.periodId === pid);
  const regional = getRegionalCosts(pid);

  return (
    <section
      aria-label="공식 가격 조사 항목 표"
      className="mt-4 rounded-[18px] border border-[#eadfc9] bg-white/90 p-4 shadow-[0_8px_24px_rgba(8,22,38,0.035)] md:p-5"
    >
      <h2 className="font-serif-kr text-[20px] font-medium text-[#071629]">
        공식 가격 조사 항목 ({label} 조사월)
      </h2>
      <p className="mt-2 text-[13px] leading-[1.7] text-[#5d6879]">
        한국소비자원 참가격이 구분한 항목과 지역별 조사값을 그대로 확인할 수 있습니다. 항목별 조사 범위가
        다르므로 서로 합산하지 않으며, 개인 견적이나 전체 결혼비용을 판정하는 자료가 아닙니다.
      </p>

      <h3 className="mt-4 text-[14px] font-semibold text-[#071629]">카테고리별 계약금액</h3>
      <table className="mt-2 w-full border-collapse text-[13px]">
        <thead>
          <tr className="border-b border-[#eadfc9] text-left text-[#7a8290]">
            <th className="py-2 pr-3 font-medium">항목</th>
            <th className="py-2 pr-3 font-medium">전국 조사값</th>
            <th className="py-2 font-medium">서울 직접 조사값</th>
          </tr>
        </thead>
        <tbody className="text-[#5d6879]">
          <tr className="border-b border-[#f0efed]">
            <td className="py-2 pr-3">식대 평균 계약금액</td>
            <td className="py-2 pr-3">{man(nat.meal)}</td>
            <td className="py-2">자료 없음</td>
          </tr>
          <tr className="border-b border-[#f0efed]">
            <td className="py-2 pr-3">대관료 평균 계약금액</td>
            <td className="py-2 pr-3">{man(nat.rental)}</td>
            <td className="py-2">자료 없음</td>
          </tr>
          <tr className="border-b border-[#f0efed]">
            <td className="py-2 pr-3">기본 장식 평균 계약금액</td>
            <td className="py-2 pr-3">{man(nat.decoration)}</td>
            <td className="py-2">자료 없음</td>
          </tr>
          <tr className="border-b border-[#f0efed]">
            <td className="py-2 pr-3">스드메 평균 계약금액</td>
            <td className="py-2 pr-3">{man(nat.sdm)}</td>
            <td className="py-2">자료 없음</td>
          </tr>
          <tr className="border-b border-[#f0efed]">
            <td className="py-2 pr-3">스드메 패키지 중위가격(중간값)</td>
            <td className="py-2 pr-3">{man(sdmNat?.packageMedian)}</td>
            <td className="py-2">{man(sdmSeoul?.packageMedian)}</td>
          </tr>
          <tr className="border-b border-[#f0efed]">
            <td className="py-2 pr-3">스튜디오 기본 중위가격(중간값)</td>
            <td className="py-2 pr-3">{man(sdmNat?.studioBasic)}</td>
            <td className="py-2">{man(sdmSeoul?.studioBasic)}</td>
          </tr>
          <tr className="border-b border-[#f0efed]">
            <td className="py-2 pr-3">드레스(본식) 중위가격(중간값)</td>
            <td className="py-2 pr-3">{man(dressNat?.ceremony)}</td>
            <td className="py-2">{man(DRESS_PRICES.find((d) => d.periodId === pid && d.scope === "seoul")?.ceremony)}</td>
          </tr>
          <tr className="border-b border-[#f0efed]">
            <td className="py-2 pr-3">메이크업(본식) 중위가격(중간값)</td>
            <td className="py-2 pr-3">{man(makeupNat?.ceremony)}</td>
            <td className="py-2">{man(MAKEUP_PRICES.find((m) => m.periodId === pid && m.scope === "seoul")?.ceremony)}</td>
          </tr>
        </tbody>
      </table>

      {seasonal && (
        <p className="mt-4 text-[13px] leading-[1.7] text-[#5d6879]">
          {label} 조사 기준 예식장 중위가격(중간값)은 성수기 {man(seasonal.peak)}, 비수기
          {man(seasonal.offPeak)}이며 금액 차이는 {man(seasonal.savings)}입니다. 예식장별 성수기·비수기 기준은
          서로 다릅니다. 스드메는 포함하지 않으며 실제 절약 보장액이나 전체 결혼비용 차이가 아닙니다.
        </p>
      )}

      {regional.length > 0 && (
        <>
          <h3 className="mt-4 text-[14px] font-semibold text-[#071629]">지역별 예식장·스드메 평균</h3>
          <ul className="mt-2 grid gap-2 text-[13px] text-[#5d6879] sm:grid-cols-2">
            {regional.map((r) => (
              <li key={r.region}>
                <span className="font-medium text-[#071629]">{REGION_LABELS[r.region]}</span>: 식대 {man(r.meal)} ·
                대관료 {man(r.rental)} · 기본 장식 {man(r.decoration)} · 스드메 {man(r.sdm)}
              </li>
            ))}
          </ul>
        </>
      )}

      <p className="mt-4 text-[12px] text-[#7a8290]">
        출처: <a
          href="https://www.price.go.kr/tprice/portal/wedding/areaStatistic.do"
          target="_blank"
          rel="noopener noreferrer"
          className="text-[#36534E] hover:underline"
        >
          한국소비자원 참가격 공식 통계
        </a>
        , {label} 조사 기준. 서울 단일값이 원문에 없는 항목은 강남·강남외 값을 임의 평균하지 않고 비워
        두었습니다. 모든 항목은 서로 합산하지 않으며 개인 견적의 좋고 나쁨을 판정하지 않습니다.
      </p>
    </section>
  );
}
