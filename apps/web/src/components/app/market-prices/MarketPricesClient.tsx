"use client";

import { useState, type ReactNode } from "react";
import {
  BarChart3, MapPin, TrendingUp, Building2, Camera, Shirt, Palette,
  Sun, Snowflake, ChevronDown, ExternalLink, ListChecks, ArrowRight,
} from "lucide-react";
import {
  PRICE_PERIODS,
  VENUE_NECESSARY,
  VENUE_OPTIONAL_NAMES,
  SDM_PACKAGES,
  DRESS_PRICES,
  MAKEUP_PRICES,
  OPTION_PRICES,
  SEASONAL_DATA,
  TREND_DATA,
  getLatestPeriodId,
  getNationalTotal,
  getRegionalCosts,
  getVenueOptionalItems,
} from "@/constants/marketPrices";
import {
  OFF_PEAK_WEDDING_MONTHS_LABEL,
  PEAK_WEDDING_MONTHS_LABEL,
} from "@/constants/weddingSeasonality";
import TrendChart from "@/components/app/market-prices/TrendChart";
import RegionalCostTable from "@/components/app/market-prices/RegionalCostTable";
import { CONTACT } from "@/lib/constants/contact";

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

const SERVICE_CARD = "rounded-[18px] border border-[#eadfc9] bg-white/90 shadow-[0_8px_24px_rgba(8,22,38,0.035)]";
const SERVICE_CARD_SOFT = "rounded-[18px] border border-[#eadfc9] bg-[#fffdf7]/90 shadow-[0_8px_24px_rgba(8,22,38,0.035)]";
const KICKER = "text-[11px] font-semibold uppercase tracking-[0.16em] text-[#36534E]";
const SECTION_TITLE = "font-serif-kr text-[22px] font-medium leading-tight text-[#071629]";
const BODY_TEXT = "text-[13px] font-medium leading-[1.65] text-[#5d6879]";
const MUTED_TEXT = "text-[12px] font-medium text-[#7a8290]";
const TABLE_HEAD = "px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#7a8290]";
const TABLE_TEXT = "px-4 py-3 text-[13px] font-medium text-[#5d6879]";
const TABLE_VALUE = "px-4 py-3 text-right text-[13px] font-semibold text-[#071629]";

function formatMan(value: number) {
  return `${value.toLocaleString()}만원`;
}

export default function MarketPricesClient() {
  const [activeTab, setActiveTab] = useState<TabId>("overview");
  const [periodId, setPeriodId] = useState(getLatestPeriodId());
  const [scope, setScope] = useState<"national" | "seoul">("national");

  const currentPeriod = PRICE_PERIODS.find(p => p.id === periodId)!;
  const latestPeriod = PRICE_PERIODS.at(-1)!;
  const usesLatestOnly = activeTab === "trend" || activeTab === "options";
  const displayedPeriod = usesLatestOnly ? latestPeriod : currentPeriod;

  return (
    // (app) 레이아웃 컨테이너에 기대던 페이지 — (community) 그룹은 페이지가 자체 컨테이너를 가짐
    <div className="mx-auto w-full max-w-[1120px] space-y-4 px-4 pt-6 pb-12 sm:px-6">
      {/* 헤더 */}
      <div className={`${SERVICE_CARD} p-4 md:p-5`}>
        <p className={KICKER}>WEDDING MARKET DATA</p>
        <h1 className="mt-1 font-serif-kr text-[26px] font-medium leading-tight text-[#071629] sm:text-[30px]">
          웨딩 시세 정보
        </h1>
        <p className="mt-2 flex flex-wrap items-center gap-1 text-[13px] font-medium text-[#5d6879]">
          한국소비자원 참가격의 표본 통계를 그대로 구분해 보여드려요.
          <a
            href="https://www.price.go.kr/tprice/portal/wedding/areaStatistic.do"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-0.5 text-[#36534E] hover:underline"
          >
            price.go.kr <ExternalLink size={14} />
          </a>
        </p>
      </div>

      {/* 기간 선택 + 전국/서울 토글 */}
      <div className="flex flex-wrap items-center gap-3">
        {!usesLatestOnly && <div className="relative">
          <label htmlFor="market-price-period" className="sr-only">가격 조사 기준월</label>
          <select
            id="market-price-period"
            value={periodId}
            onChange={e => setPeriodId(e.target.value)}
            className="min-h-11 appearance-none rounded-[14px] border border-[#eadfc9] bg-white px-4 py-2.5 pr-9 text-[14px] font-semibold text-[#071629] shadow-[0_8px_24px_rgba(8,22,38,0.035)] focus:outline-none focus:ring-2 focus:ring-[#36534E]/20"
          >
            {[...PRICE_PERIODS].reverse().map(p => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
          </select>
          <ChevronDown size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[#7a8290]" />
        </div>}

        {(activeTab === "venue" || activeTab === "sdm" || activeTab === "options") && (
          <div className="flex rounded-[14px] border border-[#eadfc9] bg-white p-1">
            {(["national", "seoul"] as const).map(s => (
              <button
                key={s}
                onClick={() => setScope(s)}
                aria-pressed={scope === s}
                className={`min-h-11 rounded-[10px] px-4 py-2 text-[13px] font-semibold transition-colors ${
                  scope === s
                    ? "bg-[#fff8ec] text-[#36534E]"
                    : "text-[#5d6879] hover:text-[#36534E]"
                }`}
              >
                {s === "national" ? "전국" : "서울"}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 탭 네비게이션 */}
      <div className="flex gap-1 overflow-x-auto pb-1 scrollbar-hide" role="tablist" aria-label="시세 정보 분류">
        {TABS.map(tab => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.id}
              aria-controls={`market-price-panel-${tab.id}`}
              className={`flex min-h-11 shrink-0 items-center gap-1.5 rounded-[14px] border px-4 py-2.5 text-[13px] font-semibold whitespace-nowrap transition-colors ${
                activeTab === tab.id
                  ? "border-[#36534E] bg-[#36534E] text-white shadow-[0_10px_24px_rgba(54,83,78,0.14)]"
                  : "border-[#eadfc9] bg-white text-[#5d6879] hover:bg-[#fff8ec] hover:text-[#36534E]"
              }`}
            >
              <Icon size={16} />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* 탭 콘텐츠 */}
      <div id={`market-price-panel-${activeTab}`} role="tabpanel" className="space-y-6">
        {activeTab === "overview" && <OverviewTab periodId={periodId} />}
        {activeTab === "regional" && <RegionalTab periodId={periodId} />}
        {activeTab === "trend" && <TrendTab />}
        {activeTab === "venue" && <VenueTab periodId={periodId} scope={scope} />}
        {activeTab === "sdm" && <SdmTab periodId={periodId} />}
        {activeTab === "options" && <OptionsTab scope={scope} />}
        {activeTab === "seasonal" && <SeasonalTab periodId={periodId} />}
      </div>

      {/* 출처 */}
      <div className="text-center text-[12px] font-medium text-[#7a8290]">
        데이터 출처: 한국소비자원 참가격 · {displayedPeriod.label} 조사 · 단위: 만원. 평균값과 중간값을 각 표에 구분했습니다.
      </div>

      <section className={`${SERVICE_CARD_SOFT} p-4 md:p-5`}>
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="max-w-2xl">
            <p className={KICKER}>REAL PRICE BETA</p>
            <h2 className="mt-1 font-serif-kr text-[22px] font-medium leading-tight text-[#071629]">
              더 깊은 실거래가 데이터는 베타로 준비 중이에요.
            </h2>
            <p className={`${BODY_TEXT} mt-2`}>
              지금 화면은 한국소비자원 공개 통계 기준입니다. 향후 별도 동의를 받은 자료가 충분히 쌓이면
              수집 기간·표본 수·구성 범위를 함께 표시하는 기능을 검토합니다. 지금은 영수증이나 개인정보를 이메일로 보내지 마세요.
            </p>
          </div>
          <a
            href={`mailto:${CONTACT.email}?subject=%EC%8B%A4%EA%B1%B0%EB%9E%98%EA%B0%80%20%EA%B3%B5%EC%9C%A0%20%EC%8B%A0%EC%B2%AD`}
            className="inline-flex shrink-0 items-center justify-center gap-2 rounded-full bg-[#36534E] px-5 py-3 text-[13px] font-semibold text-white shadow-[0_10px_24px_rgba(54,83,78,0.14)] transition-colors hover:bg-[#2d4642]"
          >
            베타 참여 문의
            <ArrowRight className="h-4 w-4" />
          </a>
        </div>
      </section>
    </div>
  );
}

function OverviewTab({ periodId }: { periodId: string }) {
  const nat = getNationalTotal(periodId);
  const regional = getRegionalCosts(periodId);
  const gangnam = regional.find((cost) => cost.region === "seoulGangnam");
  const seoulOther = regional.find((cost) => cost.region === "seoulOther");
  const sdm = SDM_PACKAGES.find(s => s.periodId === periodId && s.region === "전체");

  return (
    <>
      <div className="grid grid-cols-2 gap-3 max-md:grid-cols-1">
        <StatCard label="전국 평균 총 비용" value={nat.total} />
        <StatCard label="서울(강남) 평균 총비용" value={gangnam?.total ?? 0} />
        <StatCard label="서울(강남외) 평균 총비용" value={seoulOther?.total ?? 0} />
        <StatCard label="전국 스드메 패키지 중간값" value={sdm?.packageMedian ?? 0} />
      </div>

      <div className={`${SERVICE_CARD} overflow-hidden`}>
        <div className="px-4 py-4 md:px-5">
          <h3 className={SECTION_TITLE}>전국 평균 비용 구성</h3>
        </div>
        <div className="px-4 pb-4 md:px-5">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <CostBreakdownItem label="식대" value={nat.meal} total={nat.total} />
            <CostBreakdownItem label="대관료" value={nat.rental} total={nat.total} />
            <CostBreakdownItem label="스드메" value={nat.sdm} total={nat.total} />
            <CostBreakdownItem label="꽃장식" value={nat.decoration} total={nat.total} />
          </div>
        </div>
      </div>

      <div className={`${SERVICE_CARD} overflow-hidden`}>
        <div className="px-4 py-4 md:px-5">
          <h3 className={SECTION_TITLE}>서울 두 권역과 전국 평균 비교</h3>
          <p className={`${MUTED_TEXT} mt-1`}>서울 전체 평균을 임의로 만들지 않고 원문 권역을 나눠 표시합니다.</p>
        </div>
        <div className="divide-y divide-[#eadfc9]/70">
          {(["meal", "rental", "sdm", "decoration"] as const).map(key => {
            const labels: Record<string, string> = { meal: "식대", rental: "대관료", sdm: "스드메", decoration: "꽃장식" };
            const natVal = nat[key];
            return (
              <div key={key} className="grid gap-2 px-4 py-3 text-[13px] md:grid-cols-[1fr_auto] md:items-center md:px-5">
                <span className="font-semibold text-[#071629]">{labels[key]}</span>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[#5d6879]">
                  <span>전국 {formatMan(natVal)}</span>
                  {gangnam && <span className="font-semibold text-[#071629]">강남 {formatMan(gangnam[key])}</span>}
                  {seoulOther && <span className="font-semibold text-[#071629]">강남외 {formatMan(seoulOther[key])}</span>}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}

function RegionalTab({ periodId }: { periodId: string }) {
  return (
    <div className={`${SERVICE_CARD} overflow-hidden`}>
      <div className="px-4 py-4 md:px-5">
        <h3 className={`${SECTION_TITLE} flex items-center gap-2`}>
          <MapPin size={18} className="text-[#36534E]" />
          지역별 결혼 비용
        </h3>
        <p className={`${MUTED_TEXT} mt-1`}>식대 + 스드메 + 대관료 + 꽃장식 합산, 단위는 모두 만원입니다.</p>
      </div>
      <div className="px-4 pb-4 md:px-5">
        <RegionalCostTable periodId={periodId} />
      </div>
    </div>
  );
}

function TrendTab() {
  const firstMonth = TREND_DATA.at(0)?.month ?? "조사월";
  const lastMonth = TREND_DATA.at(-1)?.month ?? "향후 18개월";
  return (
    <div className="space-y-4">
      <div className={`${SERVICE_CARD} overflow-hidden`}>
        <div className="px-4 py-4 md:px-5">
          <h3 className={`${SECTION_TITLE} flex items-center gap-2`}>
            <TrendingUp size={18} className="text-[#36534E]" />
            18개월 비용 추이
          </h3>
          <p className={`${MUTED_TEXT} mt-1`}>{firstMonth}부터 {lastMonth} 예식 계약 표본의 중간값입니다. 미래 가격 예측은 아닙니다.</p>
        </div>
        <div className="px-4 pb-4 md:px-5">
          <TrendChart />
        </div>
      </div>

      <div className={`${SERVICE_CARD_SOFT} p-4 md:p-5`}>
        <h4 className="font-serif-kr text-[20px] font-medium leading-tight text-[#071629]">읽을 때 주의할 점</h4>
        <p className={`${BODY_TEXT} mt-2`}>
          월별 값은 조사 시점까지 수집된 계약 표본의 중간값입니다. 같은 달이어도 지역·업체·하객 수·포함 구성에 따라 달라지므로 개인 견적의 예상가나 적정가로 사용하지 마세요.
        </p>
      </div>
    </div>
  );
}

function VenueTab({ periodId, scope }: { periodId: string; scope: "national" | "seoul" }) {
  const nec = VENUE_NECESSARY.find(v => v.periodId === periodId && v.scope === scope);
  const optItems = getVenueOptionalItems(periodId, scope);

  return (
    <div className="space-y-4">
      <div className={`${SERVICE_CARD} overflow-hidden`}>
        <div className="px-4 py-4 md:px-5">
          <h3 className={`${SECTION_TITLE} flex items-center gap-2`}>
            <Building2 size={18} className="text-[#36534E]" />
            필수 항목
          </h3>
        </div>
        {nec && (
          <div className="grid grid-cols-2 gap-px bg-[#eadfc9]/70 max-md:grid-cols-1">
            <DataCell label="대관료" value={formatMan(nec.rental)} />
            <DataCell label="최소 보증인원" value={`${nec.minGuests}명`} />
            <DataCell label="1인당 식대" value={formatMan(nec.perPersonMeal)} />
            <DataCell label="식대 총액" value={formatMan(nec.totalFood)} />
          </div>
        )}
      </div>

      <div className={`${SERVICE_CARD} overflow-hidden`}>
        <div className="px-4 py-4 md:px-5">
          <h3 className={SECTION_TITLE}>선택 항목</h3>
          <p className={`${MUTED_TEXT} mt-1`}>각 항목의 별도 중간값입니다. 한 계약에 모두 포함되는 묶음이 아니므로 서로 더하지 마세요.</p>
        </div>
        <div className="divide-y divide-[#eadfc9]/70">
          {VENUE_OPTIONAL_NAMES.map(name => (
            <div key={name} className="flex items-center justify-between gap-3 px-4 py-3 md:px-5">
              <span className="text-[13px] font-medium text-[#071629]">{name}</span>
              <span className="shrink-0 text-[13px] font-semibold text-[#071629]">
                {optItems.items[name] ? formatMan(optItems.items[name]) : "-"}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function SdmTab({ periodId }: { periodId: string }) {
  const packages = SDM_PACKAGES.filter(s => s.periodId === periodId);
  const dressNat = DRESS_PRICES.find(d => d.periodId === periodId && d.scope === "national");
  const dressSeoul = DRESS_PRICES.find(d => d.periodId === periodId && d.scope === "seoul");
  const makeupNat = MAKEUP_PRICES.find(m => m.periodId === periodId && m.scope === "national");
  const makeupSeoul = MAKEUP_PRICES.find(m => m.periodId === periodId && m.scope === "seoul");

  return (
    <div className="space-y-4">
      <TableCard
        icon={<Camera size={18} className="text-[#36534E]" />}
        title="스드메 패키지 지역별 비교"
        headers={["지역", "스드메 패키지", "드메 패키지", "스튜디오 기본"]}
      >
        {packages.map(p => (
          <tr key={p.region} className="border-b border-[#eadfc9]/70 last:border-b-0 hover:bg-[#fffdf7]">
            <td className={TABLE_TEXT}>{p.region}</td>
            <td className={TABLE_VALUE}>{formatMan(p.packageMedian)}</td>
            <td className={TABLE_VALUE}>{formatMan(p.dmPackageMedian)}</td>
            <td className={TABLE_VALUE}>{formatMan(p.studioBasic)}</td>
          </tr>
        ))}
      </TableCard>

      <TableCard
        icon={<Shirt size={18} className="text-[#36534E]" />}
        title="드레스 가격"
        headers={["구분", "촬영용", "본식용", "2부 드레스"]}
      >
        {dressNat && (
          <tr className="border-b border-[#eadfc9]/70">
            <td className={TABLE_TEXT}>전국</td>
            <td className={TABLE_VALUE}>{formatMan(dressNat.photoShoot)}</td>
            <td className={TABLE_VALUE}>{formatMan(dressNat.ceremony)}</td>
            <td className={TABLE_VALUE}>{formatMan(dressNat.secondDress)}</td>
          </tr>
        )}
        {dressSeoul && (
          <tr className="border-b border-[#eadfc9]/70 last:border-b-0 bg-[#fffdf7]">
            <td className={TABLE_TEXT}>서울</td>
            <td className={TABLE_VALUE}>{formatMan(dressSeoul.photoShoot)}</td>
            <td className={TABLE_VALUE}>{formatMan(dressSeoul.ceremony)}</td>
            <td className={TABLE_VALUE}>{formatMan(dressSeoul.secondDress)}</td>
          </tr>
        )}
      </TableCard>

      <TableCard
        icon={<Palette size={18} className="text-[#36534E]" />}
        title="메이크업 가격"
        headers={["구분", "촬영", "본식", "리허설"]}
      >
        {makeupNat && (
          <tr className="border-b border-[#eadfc9]/70">
            <td className={TABLE_TEXT}>전국</td>
            <td className={TABLE_VALUE}>{formatMan(makeupNat.photoShoot)}</td>
            <td className={TABLE_VALUE}>{formatMan(makeupNat.ceremony)}</td>
            <td className={TABLE_VALUE}>{formatMan(makeupNat.rehearsal)}</td>
          </tr>
        )}
        {makeupSeoul && (
          <tr className="border-b border-[#eadfc9]/70 last:border-b-0 bg-[#fffdf7]">
            <td className={TABLE_TEXT}>서울</td>
            <td className={TABLE_VALUE}>{formatMan(makeupSeoul.photoShoot)}</td>
            <td className={TABLE_VALUE}>{formatMan(makeupSeoul.ceremony)}</td>
            <td className={TABLE_VALUE}>{formatMan(makeupSeoul.rehearsal)}</td>
          </tr>
        )}
      </TableCard>
    </div>
  );
}

function OptionsTab({ scope }: { scope: "national" | "seoul" }) {
  const latestPeriodLabel = PRICE_PERIODS.at(-1)?.label ?? "최신 조사";
  const categories = [
    { key: "studio" as const, label: "스튜디오 옵션", icon: Camera },
    { key: "dress" as const, label: "드레스 옵션", icon: Shirt },
    { key: "makeup" as const, label: "메이크업 옵션", icon: Palette },
  ];

  return (
    <div className="space-y-4">
      {categories.map(cat => {
        const Icon = cat.icon;
        const items = OPTION_PRICES.filter(o => o.category === cat.key);
        return (
          <div key={cat.key} className={`${SERVICE_CARD} overflow-hidden`}>
            <div className="px-4 py-4 md:px-5">
              <h3 className={`${SECTION_TITLE} flex items-center gap-2`}>
                <Icon size={18} className="text-[#36534E]" />
                {cat.label} ({items.length}개)
              </h3>
              <p className={`${MUTED_TEXT} mt-1`}>{latestPeriodLabel} 조사 기준 중간값입니다.</p>
            </div>
            <div className="divide-y divide-[#eadfc9]/70">
              {items.map(item => {
                const price = scope === "seoul" ? item.seoulPrice : item.nationalPrice;
                return (
                  <div key={item.name} className="flex items-center justify-between gap-3 px-4 py-3 md:px-5">
                    <span className="text-[13px] font-medium text-[#071629]">{item.name}</span>
                    <span className="shrink-0 text-[13px] font-semibold text-[#071629]">
                      {price > 0 ? formatMan(price) : "-"}
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

function SeasonalTab({ periodId }: { periodId: string }) {
  const selected = SEASONAL_DATA.find((row) => row.periodId === periodId)
    ?? SEASONAL_DATA[SEASONAL_DATA.length - 1];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 max-md:grid-cols-1">
        <div className={`${SERVICE_CARD_SOFT} p-4 md:p-5`}>
          <div className="mb-3 flex items-center gap-2">
            <Sun size={20} className="text-[#36534E]" />
            <span className="text-[13px] font-semibold text-[#071629]">성수기</span>
          </div>
          <p className={MUTED_TEXT}>{PEAK_WEDDING_MONTHS_LABEL}</p>
          <p className="mt-2 font-serif-kr text-[30px] font-medium leading-none text-[#071629]">{formatMan(selected.peak)}</p>
        </div>
        <div className={`${SERVICE_CARD_SOFT} p-4 md:p-5`}>
          <div className="mb-3 flex items-center gap-2">
            <Snowflake size={20} className="text-[#36534E]" />
            <span className="text-[13px] font-semibold text-[#071629]">비수기</span>
          </div>
          <p className={MUTED_TEXT}>{OFF_PEAK_WEDDING_MONTHS_LABEL}</p>
          <p className="mt-2 font-serif-kr text-[30px] font-medium leading-none text-[#071629]">{formatMan(selected.offPeak)}</p>
        </div>
      </div>

      <div className={`${SERVICE_CARD} p-4 text-center md:p-5`}>
        <p className={KICKER}>MEDIAN DIFFERENCE</p>
        <p className="mt-2 font-serif-kr text-[34px] font-medium leading-none text-[#36534E]">
          {formatMan(selected.savings)}
        </p>
        <p className={`${BODY_TEXT} mt-2`}>두 시기 분류의 표본 중간값 차이입니다. 특정 계약의 할인이나 절약액을 뜻하지 않습니다.</p>
      </div>

      <TableCard title="조사월별 성수기/비수기 표본 비교" headers={["조사월", "성수기 중간값", "비수기 중간값", "차이"]}>
        {[...SEASONAL_DATA].reverse().map(s => {
          const period = PRICE_PERIODS.find(p => p.id === s.periodId);
          return (
            <tr key={s.periodId} className="border-b border-[#eadfc9]/70 last:border-b-0 hover:bg-[#fffdf7]">
              <td className={TABLE_TEXT}>{period?.label}</td>
              <td className={TABLE_VALUE}>{formatMan(s.peak)}</td>
              <td className={TABLE_VALUE}>{formatMan(s.offPeak)}</td>
              <td className={TABLE_VALUE}>{formatMan(s.savings)}</td>
            </tr>
          );
        })}
      </TableCard>
    </div>
  );
}

function StatCard({ label, value, suffix = "만원", sub }: { label: string; value: number; suffix?: string; sub?: string }) {
  return (
    <div className={`${SERVICE_CARD_SOFT} p-4 md:p-5`}>
      <p className="mb-2 text-[12px] font-semibold text-[#5d6879]">{label}</p>
      <p className="font-serif-kr text-[30px] font-medium leading-none text-[#071629] sm:text-[34px]">
        {value.toLocaleString()}
        <span className="ml-1 text-[13px] font-medium text-[#7a8290]">{suffix}</span>
      </p>
      {sub && <p className={`${MUTED_TEXT} mt-2`}>{sub}</p>}
    </div>
  );
}

function CostBreakdownItem({ label, value, total }: { label: string; value: number; total: number }) {
  const percent = Math.round((value / total) * 100);
  return (
    <div className="rounded-[14px] border border-[#eadfc9]/70 bg-[#fffdf7] p-3.5">
      <div className="mb-2 flex items-center justify-between gap-3">
        <span className="text-[13px] font-semibold text-[#071629]">{label}</span>
        <span className="text-[13px] font-semibold text-[#36534E]">{percent}%</span>
      </div>
      <div className="mb-2 h-1.5 overflow-hidden rounded-full bg-[#efe6d7]">
        <div className="h-full rounded-full bg-[#36534E]" style={{ width: `${Math.min(percent, 100)}%` }} />
      </div>
      <p className="text-[13px] font-semibold text-[#071629]">{formatMan(value)}</p>
    </div>
  );
}

function DataCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white p-4 md:p-5">
      <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#7a8290]">{label}</p>
      <p className="font-serif-kr text-[24px] font-medium leading-tight text-[#071629]">{value}</p>
    </div>
  );
}

function TableCard({
  title,
  icon,
  headers,
  children,
}: {
  title: string;
  icon?: ReactNode;
  headers: string[];
  children: ReactNode;
}) {
  return (
    <div className={`${SERVICE_CARD} overflow-hidden`}>
      <div className="px-4 py-4 md:px-5">
        <h3 className={`${SECTION_TITLE} flex items-center gap-2`}>
          {icon}
          {title}
        </h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px]">
          <thead>
            <tr className="border-b border-[#eadfc9]/70 bg-[#fffdf7]">
              {headers.map((header, index) => (
                <th key={header} className={`${TABLE_HEAD} ${index === 0 ? "text-left" : "text-right"}`}>
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>{children}</tbody>
        </table>
      </div>
    </div>
  );
}
