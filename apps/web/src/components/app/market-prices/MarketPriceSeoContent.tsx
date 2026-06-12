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
  getSeoulTotal,
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
  const seoul = getSeoulTotal(pid);
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
        한국소비자원 참가격(price.go.kr) 공공데이터 기준 결혼 비용 평균입니다. 식대·스드메·대관료·꽃장식을
        합산한 총비용은 전국 평균 약 {man(nat.total)}, 서울 평균 약 {man(seoul.total)}이에요. 스드메
        패키지 중위가는 전국 {man(sdmNat?.packageMedian)}, 서울 {man(sdmSeoul?.packageMedian)},
        경기·인천 {man(sdmGyeonggi?.packageMedian)} 수준입니다.
      </p>

      <h3 className="mt-4 text-[14px] font-semibold text-[#071629]">카테고리별 평균 가격</h3>
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
            <td className="py-2 pr-3">총 비용(식대+스드메+대관+꽃)</td>
            <td className="py-2 pr-3">{man(nat.total)}</td>
            <td className="py-2">{man(seoul.total)}</td>
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
          성수기(4~6월·9~11월) 평균은 {man(seasonal.peak)}, 비수기(1~3월·7~8월·12월)는 {man(seasonal.offPeak)}으로,
          비수기에 진행하면 약 {man(seasonal.savings)}을 아낄 수 있어요.
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
        출처: 한국소비자원 참가격(price.go.kr), {label} 기준. 시세는 구성·시즌에 따라 달라지며 가격의
        좋고 나쁨을 판정하지 않습니다 — 평균 참고용입니다.
      </p>
    </section>
  );
}
