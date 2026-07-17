// 서버 렌더 SEO 콘텐츠 — 검색엔진 크롤러가 시세 본문을 읽을 수 있게 보장.
// 인터랙티브 탭 UI(MarketPricesClient)는 hydration 후에만 콘텐츠를 다 펼치므로,
// 핵심 시세 숫자를 의미있는 HTML(표·문단)로 서버에서 정적 렌더한다.
// 사용자에게도 "전체 시세 한눈에" 요약으로 유용 — cloaking 아님, 실제 콘텐츠.
import {
  PRICE_PERIODS,
  SDM_PACKAGES,
  DRESS_PRICES,
  MAKEUP_PRICES,
  SEASONAL_DATA,
  getLatestPeriodId,
  getNationalTotal,
  getRegionalCosts,
  REGION_LABELS,
} from "@/constants/marketPrices";

function man(v: number | undefined) {
  return v == null ? "-" : `${v.toLocaleString()}만원`;
}

export default function MarketPriceSeoContent() {
  const pid = getLatestPeriodId();
  const period = PRICE_PERIODS.find((p) => p.id === pid);
  const label = period?.label ?? "최신";
  const nat = getNationalTotal(pid);
  const sdmNat = SDM_PACKAGES.find((s) => s.periodId === pid && s.region === "전체");
  const sdmSeoul = SDM_PACKAGES.find((s) => s.periodId === pid && s.region === "서울");
  const sdmGyeonggi = SDM_PACKAGES.find((s) => s.periodId === pid && s.region === "경기/인천");
  const dressNat = DRESS_PRICES.find((d) => d.periodId === pid && d.scope === "national");
  const makeupNat = MAKEUP_PRICES.find((m) => m.periodId === pid && m.scope === "national");
  const seasonal = SEASONAL_DATA.find((s) => s.periodId === pid);
  const regional = getRegionalCosts(pid);
  const gangnam = regional.find((row) => row.region === "seoulGangnam");
  const seoulOther = regional.find((row) => row.region === "seoulOther");

  return (
    <section
      aria-label="웨딩 시세 전체 요약"
      className="mt-4 rounded-[18px] border border-[#eadfc9] bg-white/90 p-4 shadow-[0_8px_24px_rgba(8,22,38,0.035)] md:p-5"
    >
      <h2 className="font-serif-kr text-[20px] font-medium text-[#071629]">
        웨딩 시세 한눈에 보기 ({label} 기준)
      </h2>
      <p className="mt-2 text-[13px] leading-[1.7] text-[#5d6879]">
        한국소비자원 참가격의 {label} 조사 표본입니다. 선택품목을 제외한 식대·스드메·대관료·기본장식비
        평균 합계는 전국 {man(nat.total)}, 서울(강남) {man(gangnam?.total)}, 서울(강남외) {man(seoulOther?.total)}입니다.
        서울 두 권역을 임의로 합친 평균은 만들지 않았습니다. 스드메 패키지 중간값은 전국 {man(sdmNat?.packageMedian)},
        서울 {man(sdmSeoul?.packageMedian)}, 경기·인천 {man(sdmGyeonggi?.packageMedian)}입니다.
      </p>

      <h3 className="mt-4 text-[14px] font-semibold text-[#071629]">품목별 중간값</h3>
      <table className="mt-2 w-full border-collapse text-[13px]">
        <thead>
          <tr className="border-b border-[#eadfc9] text-left text-[#7a8290]">
            <th className="py-2 pr-3 font-medium">항목</th>
            <th className="py-2 pr-3 font-medium">전국</th>
            <th className="py-2 font-medium">서울</th>
          </tr>
        </thead>
        <tbody className="text-[#5d6879]">
          <tr className="border-b border-[#f0efed]">
            <td className="py-2 pr-3">스드메 패키지(중위가)</td>
            <td className="py-2 pr-3">{man(sdmNat?.packageMedian)}</td>
            <td className="py-2">{man(sdmSeoul?.packageMedian)}</td>
          </tr>
          <tr className="border-b border-[#f0efed]">
            <td className="py-2 pr-3">스튜디오 기본</td>
            <td className="py-2 pr-3">{man(sdmNat?.studioBasic)}</td>
            <td className="py-2">{man(sdmSeoul?.studioBasic)}</td>
          </tr>
          <tr className="border-b border-[#f0efed]">
            <td className="py-2 pr-3">드레스(본식)</td>
            <td className="py-2 pr-3">{man(dressNat?.ceremony)}</td>
            <td className="py-2">{man(DRESS_PRICES.find((d) => d.periodId === pid && d.scope === "seoul")?.ceremony)}</td>
          </tr>
          <tr className="border-b border-[#f0efed]">
            <td className="py-2 pr-3">메이크업(본식)</td>
            <td className="py-2 pr-3">{man(makeupNat?.ceremony)}</td>
            <td className="py-2">{man(MAKEUP_PRICES.find((m) => m.periodId === pid && m.scope === "seoul")?.ceremony)}</td>
          </tr>
        </tbody>
      </table>

      {seasonal && (
        <p className="mt-4 text-[13px] leading-[1.7] text-[#5d6879]">
          예식장 필수품목의 성수기 표본 중간값은 {man(seasonal.peak)}, 비수기 표본 중간값은 {man(seasonal.offPeak)}이고
          차이는 {man(seasonal.savings)}입니다. 이는 특정 날짜나 업체에서 보장되는 할인·절약액이 아닙니다.
        </p>
      )}

      {regional.length > 0 && (
        <>
          <h3 className="mt-4 text-[14px] font-semibold text-[#071629]">지역별 총 비용</h3>
          <ul className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[13px] text-[#5d6879] sm:grid-cols-3">
            {regional.map((r) => (
              <li key={r.region}>
                {REGION_LABELS[r.region]}: {man(r.total)}
              </li>
            ))}
          </ul>
        </>
      )}

      <p className="mt-4 text-[12px] text-[#7a8290]">
        출처: 한국소비자원 참가격 결혼서비스 통계,
        {" "}<a className="underline" href="https://www.price.go.kr/tprice/portal/wedding/areaStatistic.do">원문 보기</a>,
        {" "}{label} 조사. 평균값과 중간값을 구분했으며 표본·구성·지역 차이 때문에 개별 견적의 좋고 나쁨을 판정하지 않습니다.
      </p>
    </section>
  );
}
