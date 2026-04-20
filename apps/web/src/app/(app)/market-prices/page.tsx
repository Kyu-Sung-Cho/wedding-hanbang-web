"use client";

import { useState } from "react";
import {
  BarChart3, MapPin, TrendingUp, Building2, Camera, Shirt, Palette,
  Sun, Snowflake, ChevronDown, ExternalLink, ListChecks,
} from "lucide-react";
import {
  PRICE_PERIODS,
  NATIONAL_TOTALS,
  TREND_DATA,
  VENUE_NECESSARY,
  VENUE_OPTIONAL_NAMES,
  SDM_PACKAGES,
  DRESS_PRICES,
  MAKEUP_PRICES,
  OPTION_PRICES,
  SEASONAL_DATA,
  getLatestPeriodId,
  getNationalTotal,
  getSeoulTotal,
  getVenueOptionalItems,
  type PricePeriod,
} from "@/constants/marketPrices";
import TrendChart from "@/components/app/market-prices/TrendChart";
import RegionalCostTable from "@/components/app/market-prices/RegionalCostTable";

const TABS = [
  { id: "overview", label: "종합 요약", icon: BarChart3 },
  { id: "regional", label: "지역별", icon: MapPin },
  { id: "trend", label: "트렌드", icon: TrendingUp },
  { id: "venue", label: "예식장", icon: Building2 },
  { id: "sdm", label: "스드메", icon: Camera },
  { id: "options", label: "옵션별", icon: ListChecks },
  { id: "seasonal", label: "성수기/비수기", icon: Sun },
] as const;

type TabId = (typeof TABS)[number]["id"];

export default function MarketPricesPage() {
  const [activeTab, setActiveTab] = useState<TabId>("overview");
  const [periodId, setPeriodId] = useState(getLatestPeriodId());
  const [scope, setScope] = useState<"national" | "seoul">("national");

  const currentPeriod = PRICE_PERIODS.find(p => p.id === periodId)!;

  return (
    <div className="max-w-[1000px] mx-auto pb-20">
      {/* 헤더 */}
      <div className="mb-6">
        <h1 className="font-serif-kr text-[30px] font-light text-[#1A1A1F] tracking-tight mb-1">
          웨딩 시세 정보
        </h1>
        <p className="text-[13px] text-[#B5ADA3] font-light flex items-center gap-1">
          한국소비자원 제공
          <a
            href="https://www.price.go.kr/tprice/portal/wedding/areaStatistic.do"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-0.5 text-[#795252] hover:underline"
          >
            price.go.kr <ExternalLink size={11} />
          </a>
        </p>
      </div>

      {/* 기간 선택 + 전국/서울 토글 */}
      <div className="flex items-center gap-3 mb-5 flex-wrap">
        <div className="relative">
          <select
            value={periodId}
            onChange={e => setPeriodId(e.target.value)}
            className="appearance-none bg-white rounded-xl px-4 py-2 pr-8 text-[13px] text-[#1A1A1F] shadow-[0_4px_14px_0_rgba(0,0,0,0.03)] focus:outline-none focus:ring-2 focus:ring-[#795252]/30"
          >
            {[...PRICE_PERIODS].reverse().map(p => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
          </select>
          <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#B5ADA3] pointer-events-none" />
        </div>

        {(activeTab === "venue" || activeTab === "sdm" || activeTab === "options") && (
          <div className="flex bg-[#F6F3F2] rounded-lg p-0.5">
            {(["national", "seoul"] as const).map(s => (
              <button
                key={s}
                onClick={() => setScope(s)}
                className={`px-3 py-1.5 rounded-md text-[12px] font-medium transition-colors ${
                  scope === s
                    ? "bg-white text-[#795252] shadow-sm"
                    : "text-[#504444] hover:text-[#795252]"
                }`}
              >
                {s === "national" ? "전국" : "서울"}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 탭 네비게이션 */}
      <div className="flex gap-1 mb-6 overflow-x-auto pb-1 scrollbar-hide">
        {TABS.map(tab => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-[12px] font-medium whitespace-nowrap transition-colors ${
                activeTab === tab.id
                  ? "bg-gradient-to-br from-[#795252] to-[#946a6a] text-white shadow-[0_4px_14px_0_rgba(121,82,82,0.2)]"
                  : "bg-white text-[#504444] hover:text-[#795252]"
              }`}
            >
              <Icon size={14} />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* 탭 콘텐츠 */}
      <div className="space-y-6">
        {activeTab === "overview" && <OverviewTab periodId={periodId} />}
        {activeTab === "regional" && <RegionalTab periodId={periodId} />}
        {activeTab === "trend" && <TrendTab />}
        {activeTab === "venue" && <VenueTab periodId={periodId} scope={scope} />}
        {activeTab === "sdm" && <SdmTab periodId={periodId} />}
        {activeTab === "options" && <OptionsTab scope={scope} />}
        {activeTab === "seasonal" && <SeasonalTab />}
      </div>

      {/* 출처 */}
      <div className="mt-8 text-center text-[11px] text-[#B5ADA3] font-light">
        데이터 출처: 한국소비자원 · {currentPeriod.label} 기준 · 단위: 만원
      </div>
    </div>
  );
}

// ===== 종합 요약 탭 =====
function OverviewTab({ periodId }: { periodId: string }) {
  const nat = getNationalTotal(periodId);
  const seoul = getSeoulTotal(periodId);
  const sdm = SDM_PACKAGES.find(s => s.periodId === periodId && s.region === "전체");
  const seasonal = SEASONAL_DATA.find(s => s.periodId === periodId);

  return (
    <>
      {/* 4개 요약 카드 */}
      <div className="grid grid-cols-2 gap-4 max-md:grid-cols-1">
        <StatCard label="전국 평균 총 비용" value={nat.total} unit="만원" color="#795252" />
        <StatCard label="서울 평균 총 비용" value={seoul.total} unit="만원" color="#946a6a" />
        <StatCard label="스드메 패키지 평균" value={sdm?.packageMedian ?? 0} unit="만원" color="#928980" />
        <StatCard
          label="비수기 절약액"
          value={seasonal?.savings ?? 0}
          unit="만원 절약"
          color="#795252"
          sub={seasonal ? `성수기 ${seasonal.peak}만원 → 비수기 ${seasonal.offPeak}만원` : ""}
        />
      </div>

      {/* 비용 구성 */}
      <div className="bg-white rounded-xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] overflow-hidden">
        <div className="px-5 py-4">
          <h3 className="font-serif-kr text-[18px] font-light text-[#1A1A1F]">전국 평균 비용 구성</h3>
        </div>
        <div className="p-5 pt-0">
          <div className="grid grid-cols-4 gap-4 max-md:grid-cols-2">
            <CostBreakdownItem label="식대" value={nat.meal} total={nat.total} color="#795252" />
            <CostBreakdownItem label="대관료" value={nat.rental} total={nat.total} color="#946a6a" />
            <CostBreakdownItem label="스드메" value={nat.sdm} total={nat.total} color="#928980" />
            <CostBreakdownItem label="꽃장식" value={nat.decoration} total={nat.total} color="#B5ADA3" />
          </div>
        </div>
      </div>

      {/* 서울 vs 전국 비교 */}
      <div className="bg-white rounded-xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] overflow-hidden">
        <div className="px-5 py-4">
          <h3 className="font-serif-kr text-[18px] font-light text-[#1A1A1F]">서울 vs 전국 비교</h3>
        </div>
        <div className="divide-y divide-[#F6F3F2]">
          {(["meal", "rental", "sdm", "decoration"] as const).map(key => {
            const labels: Record<string, string> = { meal: "식대", rental: "대관료", sdm: "스드메", decoration: "꽃장식" };
            const natVal = nat[key];
            const seoulVal = seoul[key];
            const diff = Math.round(((seoulVal - natVal) / natVal) * 100);
            return (
              <div key={key} className="flex items-center justify-between px-5 py-3">
                <span className="text-[13px] text-[#1A1A1F]">{labels[key]}</span>
                <div className="flex items-center gap-4">
                  <span className="text-[12px] text-[#504444]">전국 {natVal.toLocaleString()}</span>
                  <span className="text-[12px] font-medium text-[#1A1A1F]">서울 {seoulVal.toLocaleString()}</span>
                  <span className={`text-[11px] font-medium ${diff > 0 ? "text-[#795252]" : "text-[#504444]"}`}>
                    {diff > 0 ? `+${diff}%` : `${diff}%`}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}

// ===== 지역별 탭 =====
function RegionalTab({ periodId }: { periodId: string }) {
  return (
    <div className="bg-white rounded-xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] overflow-hidden">
      <div className="px-5 py-4">
        <h3 className="font-serif-kr text-[18px] font-light text-[#1A1A1F] flex items-center gap-2">
          <MapPin size={16} className="text-[#795252]" />
          지역별 결혼 비용
        </h3>
        <p className="text-[11px] text-[#B5ADA3] mt-0.5 font-light">식대 + 스드메 + 대관료 + 꽃장식 합산 (만원)</p>
      </div>
      <div className="p-5 pt-0">
        <RegionalCostTable periodId={periodId} />
      </div>
    </div>
  );
}

// ===== 트렌드 탭 =====
function TrendTab() {
  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] overflow-hidden">
        <div className="px-5 py-4">
          <h3 className="font-serif-kr text-[18px] font-light text-[#1A1A1F] flex items-center gap-2">
            <TrendingUp size={16} className="text-[#795252]" />
            18개월 비용 추이
          </h3>
          <p className="text-[11px] text-[#B5ADA3] mt-0.5 font-light">2026년 1월 ~ 2027년 6월 예상 시세 기준</p>
        </div>
        <div className="p-5 pt-0">
          <TrendChart />
        </div>
      </div>

      {/* 주요 인사이트 */}
      <div className="bg-gradient-to-br from-[#795252]/5 to-[#946a6a]/5 rounded-xl p-5 shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
        <h4 className="font-serif-kr text-[16px] font-light text-[#1A1A1F] mb-3">주요 인사이트</h4>
        <ul className="space-y-2 text-[12px] text-[#504444]">
          <li className="flex items-start gap-2">
            <span className="text-[#795252] mt-0.5">&#8226;</span>
            <span>성수기(10~11월)와 비수기(2~3월, 8월)의 가격 차이가 400~500만원 수준</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-[#795252] mt-0.5">&#8226;</span>
            <span>스드메 가격은 280~310만원 범위에서 꾸준히 상승 추세</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-[#795252] mt-0.5">&#8226;</span>
            <span>총 비용 중위값은 1,190~1,750만원으로 월별 변동이 큼</span>
          </li>
        </ul>
      </div>
    </div>
  );
}

// ===== 예식장 탭 =====
function VenueTab({ periodId, scope }: { periodId: string; scope: "national" | "seoul" }) {
  const nec = VENUE_NECESSARY.find(v => v.periodId === periodId && v.scope === scope);
  const optItems = getVenueOptionalItems(periodId, scope);

  return (
    <div className="space-y-6">
      {/* 필수 항목 */}
      <div className="bg-white rounded-xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] overflow-hidden">
        <div className="px-5 py-4">
          <h3 className="font-serif-kr text-[18px] font-light text-[#1A1A1F] flex items-center gap-2">
            <Building2 size={16} className="text-[#795252]" />
            필수 항목
          </h3>
        </div>
        {nec && (
          <div className="grid grid-cols-2 gap-px bg-[#F6F3F2] max-md:grid-cols-1">
            <DataCell label="대관료" value={`${nec.rental}만원`} />
            <DataCell label="최소 보증인원" value={`${nec.minGuests}명`} />
            <DataCell label="1인당 식대" value={`${nec.perPersonMeal}만원`} />
            <DataCell label="식대 총액" value={`${nec.totalFood.toLocaleString()}만원`} />
          </div>
        )}
      </div>

      {/* 선택 항목 (17개) */}
      <div className="bg-white rounded-xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] overflow-hidden">
        <div className="px-5 py-4">
          <h3 className="font-serif-kr text-[18px] font-light text-[#1A1A1F]">선택 항목</h3>
          <p className="text-[11px] text-[#B5ADA3] mt-0.5 font-light">필수가 아닌 선택 서비스 — 절약 포인트!</p>
        </div>
        <div className="divide-y divide-[#F6F3F2]">
          {VENUE_OPTIONAL_NAMES.map(name => (
            <div key={name} className="flex items-center justify-between px-5 py-3">
              <span className="text-[13px] text-[#1A1A1F]">{name}</span>
              <span className="text-[13px] font-medium text-[#1A1A1F]">
                {optItems.items[name]?.toLocaleString() ?? "—"}<span className="text-[11px] text-[#B5ADA3] ml-0.5">만원</span>
              </span>
            </div>
          ))}
        </div>
        {/* 합계 */}
        <div className="px-5 py-3 bg-[#F6F3F2] flex items-center justify-between">
          <span className="text-[13px] font-medium text-[#1A1A1F]">선택항목 전체 합계</span>
          <span className="font-serif-kr text-[18px] font-light text-[#795252]">
            {Object.values(optItems.items).reduce((s, v) => s + v, 0).toLocaleString()}만원
          </span>
        </div>
      </div>
    </div>
  );
}

// ===== 스드메 탭 =====
function SdmTab({ periodId }: { periodId: string }) {
  const packages = SDM_PACKAGES.filter(s => s.periodId === periodId);
  const dressNat = DRESS_PRICES.find(d => d.periodId === periodId && d.scope === "national");
  const dressSeoul = DRESS_PRICES.find(d => d.periodId === periodId && d.scope === "seoul");
  const makeupNat = MAKEUP_PRICES.find(m => m.periodId === periodId && m.scope === "national");
  const makeupSeoul = MAKEUP_PRICES.find(m => m.periodId === periodId && m.scope === "seoul");

  return (
    <div className="space-y-6">
      {/* 패키지 가격 */}
      <div className="bg-white rounded-xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] overflow-hidden">
        <div className="px-5 py-4">
          <h3 className="font-serif-kr text-[18px] font-light text-[#1A1A1F] flex items-center gap-2">
            <Camera size={16} className="text-[#795252]" />
            스드메 패키지 지역별 비교
          </h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="border-b border-[#F6F3F2]">
                <th className="text-left py-3 px-4 text-[10px] font-medium text-[#B5ADA3] uppercase tracking-[0.12em]">지역</th>
                <th className="text-right py-3 px-4 text-[10px] font-medium text-[#B5ADA3] uppercase tracking-[0.12em]">스드메 패키지</th>
                <th className="text-right py-3 px-4 text-[10px] font-medium text-[#B5ADA3] uppercase tracking-[0.12em]">드메 패키지</th>
                <th className="text-right py-3 px-4 text-[10px] font-medium text-[#B5ADA3] uppercase tracking-[0.12em]">스튜디오 기본</th>
              </tr>
            </thead>
            <tbody>
              {packages.map(p => (
                <tr key={p.region} className="border-b border-[#F6F3F2] hover:bg-[#F6F3F2]/30">
                  <td className="py-2.5 px-4 font-medium text-[#1A1A1F]">{p.region}</td>
                  <td className="py-2.5 px-4 text-right text-[#795252] font-medium">{p.packageMedian}만원</td>
                  <td className="py-2.5 px-4 text-right text-[#504444]">{p.dmPackageMedian}만원</td>
                  <td className="py-2.5 px-4 text-right text-[#504444]">{p.studioBasic}만원</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* 드레스 상세 */}
      <div className="bg-white rounded-xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] overflow-hidden">
        <div className="px-5 py-4">
          <h3 className="font-serif-kr text-[18px] font-light text-[#1A1A1F] flex items-center gap-2">
            <Shirt size={16} className="text-[#946a6a]" />
            드레스 가격
          </h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="border-b border-[#F6F3F2]">
                <th className="text-left py-3 px-4 text-[10px] font-medium text-[#B5ADA3] uppercase tracking-[0.12em]">구분</th>
                <th className="text-right py-3 px-4 text-[10px] font-medium text-[#B5ADA3] uppercase tracking-[0.12em]">촬영용</th>
                <th className="text-right py-3 px-4 text-[10px] font-medium text-[#B5ADA3] uppercase tracking-[0.12em]">본식용</th>
                <th className="text-right py-3 px-4 text-[10px] font-medium text-[#B5ADA3] uppercase tracking-[0.12em]">2부 드레스</th>
              </tr>
            </thead>
            <tbody>
              {dressNat && (
                <tr className="border-b border-[#F6F3F2]">
                  <td className="py-2.5 px-4 font-medium text-[#1A1A1F]">전국</td>
                  <td className="py-2.5 px-4 text-right">{dressNat.photoShoot}만원</td>
                  <td className="py-2.5 px-4 text-right">{dressNat.ceremony}만원</td>
                  <td className="py-2.5 px-4 text-right">{dressNat.secondDress}만원</td>
                </tr>
              )}
              {dressSeoul && (
                <tr className="border-b border-[#F6F3F2]">
                  <td className="py-2.5 px-4 font-medium text-[#1A1A1F]">서울</td>
                  <td className="py-2.5 px-4 text-right font-medium text-[#795252]">{dressSeoul.photoShoot}만원</td>
                  <td className="py-2.5 px-4 text-right font-medium text-[#795252]">{dressSeoul.ceremony}만원</td>
                  <td className="py-2.5 px-4 text-right font-medium text-[#795252]">{dressSeoul.secondDress}만원</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 메이크업 상세 */}
      <div className="bg-white rounded-xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] overflow-hidden">
        <div className="px-5 py-4">
          <h3 className="font-serif-kr text-[18px] font-light text-[#1A1A1F] flex items-center gap-2">
            <Palette size={16} className="text-[#946a6a]" />
            메이크업 가격
          </h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="border-b border-[#F6F3F2]">
                <th className="text-left py-3 px-4 text-[10px] font-medium text-[#B5ADA3] uppercase tracking-[0.12em]">구분</th>
                <th className="text-right py-3 px-4 text-[10px] font-medium text-[#B5ADA3] uppercase tracking-[0.12em]">촬영</th>
                <th className="text-right py-3 px-4 text-[10px] font-medium text-[#B5ADA3] uppercase tracking-[0.12em]">본식</th>
                <th className="text-right py-3 px-4 text-[10px] font-medium text-[#B5ADA3] uppercase tracking-[0.12em]">리허설</th>
              </tr>
            </thead>
            <tbody>
              {makeupNat && (
                <tr className="border-b border-[#F6F3F2]">
                  <td className="py-2.5 px-4 font-medium text-[#1A1A1F]">전국</td>
                  <td className="py-2.5 px-4 text-right">{makeupNat.photoShoot}만원</td>
                  <td className="py-2.5 px-4 text-right">{makeupNat.ceremony}만원</td>
                  <td className="py-2.5 px-4 text-right">{makeupNat.rehearsal}만원</td>
                </tr>
              )}
              {makeupSeoul && (
                <tr className="border-b border-[#F6F3F2]">
                  <td className="py-2.5 px-4 font-medium text-[#1A1A1F]">서울</td>
                  <td className="py-2.5 px-4 text-right font-medium text-[#795252]">{makeupSeoul.photoShoot}만원</td>
                  <td className="py-2.5 px-4 text-right font-medium text-[#795252]">{makeupSeoul.ceremony}만원</td>
                  <td className="py-2.5 px-4 text-right font-medium text-[#795252]">{makeupSeoul.rehearsal}만원</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ===== 옵션별 탭 =====
function OptionsTab({ scope }: { scope: "national" | "seoul" }) {
  const categories = [
    { key: "studio" as const, label: "스튜디오 옵션", icon: Camera, color: "#795252" },
    { key: "dress" as const, label: "드레스 옵션", icon: Shirt, color: "#946a6a" },
    { key: "makeup" as const, label: "메이크업 옵션", icon: Palette, color: "#928980" },
  ];

  return (
    <div className="space-y-6">
      {categories.map(cat => {
        const Icon = cat.icon;
        const items = OPTION_PRICES.filter(o => o.category === cat.key);
        return (
          <div key={cat.key} className="bg-white rounded-xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] overflow-hidden">
            <div className="px-5 py-4">
              <h3 className="font-serif-kr text-[18px] font-light text-[#1A1A1F] flex items-center gap-2">
                <Icon size={16} style={{ color: cat.color }} />
                {cat.label} ({items.length}개)
              </h3>
              <p className="text-[11px] text-[#B5ADA3] mt-0.5 font-light">2026년 1월 기준 중위 가격</p>
            </div>
            <div className="divide-y divide-[#F6F3F2]">
              {items.map(item => {
                const price = scope === "seoul" ? item.seoulPrice : item.nationalPrice;
                return (
                  <div key={item.name} className="flex items-center justify-between px-5 py-2.5">
                    <span className="text-[13px] text-[#1A1A1F]">{item.name}</span>
                    <span className="text-[13px] font-medium text-[#1A1A1F]">
                      {price > 0 ? `${price.toLocaleString()}만원` : "—"}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ===== 성수기/비수기 탭 =====
function SeasonalTab() {
  return (
    <div className="space-y-6">
      {/* 최신 비교 카드 */}
      <div className="grid grid-cols-2 gap-4 max-md:grid-cols-1">
        <div className="bg-gradient-to-br from-[#795252]/10 to-[#946a6a]/5 rounded-xl p-5 shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
          <div className="flex items-center gap-2 mb-3">
            <Sun size={18} className="text-[#795252]" />
            <span className="text-[13px] font-medium text-[#1A1A1F]">성수기</span>
          </div>
          <p className="text-[10px] text-[#B5ADA3] mb-1 font-light">4~6월, 9~11월</p>
          <p className="font-serif-kr text-[32px] font-light text-[#1A1A1F]">
            {SEASONAL_DATA[SEASONAL_DATA.length - 1].peak.toLocaleString()}
            <span className="text-[14px] text-[#B5ADA3] ml-1">만원</span>
          </p>
        </div>
        <div className="bg-gradient-to-br from-[#F6F3F2] to-white rounded-xl p-5 shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
          <div className="flex items-center gap-2 mb-3">
            <Snowflake size={18} className="text-[#504444]" />
            <span className="text-[13px] font-medium text-[#1A1A1F]">비수기</span>
          </div>
          <p className="text-[10px] text-[#B5ADA3] mb-1 font-light">1~3월, 7~8월, 12월</p>
          <p className="font-serif-kr text-[32px] font-light text-[#1A1A1F]">
            {SEASONAL_DATA[SEASONAL_DATA.length - 1].offPeak.toLocaleString()}
            <span className="text-[14px] text-[#B5ADA3] ml-1">만원</span>
          </p>
        </div>
      </div>

      {/* 절약 강조 */}
      <div className="bg-white rounded-xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] p-6 text-center">
        <p className="text-[10px] text-[#B5ADA3] font-medium uppercase tracking-[0.12em] mb-2">비수기 결혼 시 평균 절약 금액</p>
        <p className="font-serif-kr text-[44px] font-light text-[#795252]">
          {SEASONAL_DATA[SEASONAL_DATA.length - 1].savings.toLocaleString()}
          <span className="text-[16px] text-[#B5ADA3] ml-1">만원</span>
        </p>
      </div>

      {/* 기간별 추이 테이블 */}
      <div className="bg-white rounded-xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] overflow-hidden">
        <div className="px-5 py-4">
          <h3 className="font-serif-kr text-[18px] font-light text-[#1A1A1F]">기간별 성수기/비수기 비교</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="border-b border-[#F6F3F2]">
                <th className="text-left py-3 px-4 text-[10px] font-medium text-[#B5ADA3] uppercase tracking-[0.12em]">기간</th>
                <th className="text-right py-3 px-4 text-[10px] font-medium text-[#B5ADA3] uppercase tracking-[0.12em]">성수기</th>
                <th className="text-right py-3 px-4 text-[10px] font-medium text-[#B5ADA3] uppercase tracking-[0.12em]">비수기</th>
                <th className="text-right py-3 px-4 text-[10px] font-medium text-[#B5ADA3] uppercase tracking-[0.12em]">절약액</th>
              </tr>
            </thead>
            <tbody>
              {[...SEASONAL_DATA].reverse().map(s => {
                const period = PRICE_PERIODS.find(p => p.id === s.periodId);
                return (
                  <tr key={s.periodId} className="border-b border-[#F6F3F2] hover:bg-[#F6F3F2]/30">
                    <td className="py-2.5 px-4 text-[#1A1A1F]">{period?.label}</td>
                    <td className="py-2.5 px-4 text-right text-[#795252] font-medium">{s.peak.toLocaleString()}</td>
                    <td className="py-2.5 px-4 text-right">{s.offPeak.toLocaleString()}</td>
                    <td className="py-2.5 px-4 text-right text-[#946a6a] font-medium">{s.savings.toLocaleString()}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ===== 공통 컴포넌트 =====
function StatCard({ label, value, unit, color, sub }: { label: string; value: number; unit: string; color: string; sub?: string }) {
  return (
    <div className="bg-white rounded-xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] p-5">
      <p className="text-[10px] text-[#B5ADA3] font-medium uppercase tracking-[0.12em] mb-2">{label}</p>
      <p className="font-serif-kr text-[36px] font-light text-[#1A1A1F] leading-tight">
        {value.toLocaleString()}
        <span className="text-[13px] font-light ml-1" style={{ color }}>{unit}</span>
      </p>
      {sub && <p className="text-[11px] text-[#B5ADA3] mt-2 font-light">{sub}</p>}
    </div>
  );
}

function CostBreakdownItem({ label, value, total, color }: { label: string; value: number; total: number; color: string }) {
  const percent = Math.round((value / total) * 100);
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-[12px] text-[#504444]">{label}</span>
        <span className="text-[12px] font-medium" style={{ color }}>{percent}%</span>
      </div>
      <div className="h-1.5 bg-[#F6F3F2] rounded-full overflow-hidden mb-1">
        <div className="h-full rounded-full bg-gradient-to-r from-[#795252] to-[#946a6a]" style={{ width: `${percent}%` }} />
      </div>
      <p className="text-[14px] font-medium text-[#1A1A1F]">{value.toLocaleString()}<span className="text-[10px] text-[#B5ADA3]">만원</span></p>
    </div>
  );
}

function DataCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white p-4">
      <p className="text-[10px] text-[#B5ADA3] font-medium uppercase tracking-[0.12em] mb-1">{label}</p>
      <p className="font-serif-kr text-[22px] font-light text-[#1A1A1F]">{value}</p>
    </div>
  );
}
