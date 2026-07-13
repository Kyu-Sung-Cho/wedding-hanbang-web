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
  getNationalAverages,
  getSeoulAverages,
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
  const nat = getNationalAverages(pid);
  const seoul = getSeoulAverages(pid);
  const nationalVenueAverage = Math.round((nat.meal + nat.rental + nat.decoration) * 10) / 10;
  const seoulVenueAverage = Math.round((seoul.meal + seoul.rental + seoul.decoration) * 10) / 10;
  const sdmNat = SDM_PACKAGES.find((s) => s.periodId === pid && s.region === "전체");
  const sdmSeoul = SDM_PACKAGES.find((s) => s.periodId === pid && s.region === "서울");
  const sdmGyeonggi = SDM_PACKAGES.find((s) => s.periodId === pid && s.region === "경기/인천");
  const dressNat = DRESS_PRICES.find((d) => d.periodId === pid && d.scope === "national");
  const makeupNat = MAKEUP_PRICES.find((m) => m.periodId === pid && m.scope === "national");
  const seasonal = SEASONAL_DATA.find((s) => s.periodId === pid);
  const regional = getRegionalCosts(pid);

  return (
    <section
      aria-label="웨딩 시세 전체 요약"
      className="mt-4 rounded-[18px] border border-[#eadfc9] bg-white/90 p-4 shadow-[0_8px_24px_rgba(8,22,38,0.035)] md:p-5"
    >
      <h2 className="font-serif-kr text-[20px] font-medium text-[#071629]">
        웨딩 시세 한눈에 보기 ({label} 기준)
      </h2>
      <p className="mt-2 text-[13px] leading-[1.7] text-[#5d6879]">
        한국소비자원 참가격은 예식장과 스드메 계약금액을 분리해 제공합니다. {label} 조사 기준 전국 예식장
        평균 계약금액은 {man(nationalVenueAverage)}, 스드메 평균 계약금액은 {man(nat.sdm)}입니다. 두 항목은
        조사 범위가 달라 하나의 결혼비용으로 합산하지 않습니다. 스드메
        패키지 중위가는 전국 {man(sdmNat?.packageMedian)}, 서울 {man(sdmSeoul?.packageMedian)},
        경기·인천 {man(sdmGyeonggi?.packageMedian)} 수준입니다.
      </p>

      <h3 className="mt-4 text-[14px] font-semibold text-[#071629]">카테고리별 계약금액</h3>
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
            <td className="py-2 pr-3">예식장 평균(식대+대관+기본 장식)</td>
            <td className="py-2 pr-3">{man(nationalVenueAverage)}</td>
            <td className="py-2">{man(seoulVenueAverage)}</td>
          </tr>
          <tr className="border-b border-[#f0efed]">
            <td className="py-2 pr-3">스드메 평균 계약금액</td>
            <td className="py-2 pr-3">{man(nat.sdm)}</td>
            <td className="py-2">{man(seoul.sdm)}</td>
          </tr>
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
          {label} 조사 기준 예식장 중위 계약금액은 성수기(4~6월·9~11월) {man(seasonal.peak)},
          비수기(1~3월·7~8월·12월) {man(seasonal.offPeak)}이며 금액 차이는 {man(seasonal.savings)}입니다.
          스드메는 포함하지 않으며 실제 절약 보장액이나 전체 결혼비용 차이가 아닙니다.
        </p>
      )}

      {regional.length > 0 && (
        <>
          <h3 className="mt-4 text-[14px] font-semibold text-[#071629]">지역별 예식장·스드메 평균</h3>
          <ul className="mt-2 grid gap-2 text-[13px] text-[#5d6879] sm:grid-cols-2">
            {regional.map((r) => (
              <li key={r.region}>
                <span className="font-medium text-[#071629]">{REGION_LABELS[r.region]}</span>: 예식장 {man(
                  Math.round((r.meal + r.rental + r.decoration) * 10) / 10
                )} · 스드메 {man(r.sdm)}
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
        , {label} 조사 기준. 예식장과 스드메는 조사 범위가 다른 별도 평균이므로 합산하지 않습니다. 시세는
        구성·시즌에 따라 달라지며 가격의 좋고 나쁨을 판정하지 않습니다.
      </p>
    </section>
  );
}
