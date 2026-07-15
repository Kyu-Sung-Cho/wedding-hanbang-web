"use client";

import { useState, type ReactNode } from "react";
import {
  BarChart3, MapPin, Building2, Camera, Shirt, Palette,
  Sun, Snowflake, ChevronDown, ExternalLink, ListChecks,
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
  getLatestPeriodId,
  getNationalAverages,
  getVenueOptionalItems,
} from "@/constants/marketPrices";
import RegionalCostTable from "@/components/app/market-prices/RegionalCostTable";
import { formatMarketPrice } from "@/lib/marketPrices/display";

export { formatMarketPrice } from "@/lib/marketPrices/display";

const TABS = [
  { id: "overview", label: "조사 요약", icon: BarChart3 },
  { id: "regional", label: "지역별", icon: MapPin },
  { id: "venue", label: "예식장", icon: Building2 },
  { id: "sdm", label: "스드메", icon: Camera },
  { id: "options", label: "옵션별", icon: ListChecks },
  { id: "seasonal", label: "예식장 시즌별", icon: Sun },
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

const formatMan = formatMarketPrice;

export default function MarketPricesClient() {
  const [activeTab, setActiveTab] = useState<TabId>("overview");
  const [periodId, setPeriodId] = useState(getLatestPeriodId());
  const [scope, setScope] = useState<"national" | "seoul">("national");

  const currentPeriod = PRICE_PERIODS.find(p => p.id === periodId)!;

  return (
    // (app) 레이아웃 컨테이너에 기대던 페이지 — (community) 그룹은 페이지가 자체 컨테이너를 가짐
    <div className="mx-auto w-full max-w-[1120px] space-y-4 px-4 pt-6 pb-12 sm:px-6">
      {/* 헤더 */}
      <div className={`${SERVICE_CARD} p-4 md:p-5`}>
        <p className={KICKER}>OFFICIAL WEDDING PRICE SURVEY</p>
        <h1 className="mt-1 font-serif-kr text-[26px] font-medium leading-tight text-[#071629] sm:text-[30px]">
          공식 가격 조사 (조사월 기준)
        </h1>
        <p className="mt-2 flex flex-wrap items-center gap-1 text-[13px] font-medium text-[#5d6879]">
          한국소비자원 참가격 원문
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

      {/* 조사값을 개인 견적이나 총비용으로 오해하지 않도록 범위를 먼저 고지 */}
      <section className={`${SERVICE_CARD} p-4 md:p-5`}>
        <h2 className={SECTION_TITLE}>{currentPeriod.label} 조사 자료를 읽는 기준</h2>
        <p className="mt-2 text-[13px] font-medium leading-[1.7] text-[#5d6879]">
          아래 값은 참가격 원문이 제공하는 항목별 조사값입니다. 서로 더해 개인의 결혼비용으로 보거나,
          특정 견적의 적정성을 판정하는 데 사용하지 않습니다. 실제 계약 전에는 포함 항목·추가 조건·최종
          금액을 업체 원문과 계약서에서 다시 확인하세요.
        </p>
        <a
            href="https://www.price.go.kr/tprice/portal/wedding/areaStatistic.do"
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 inline-flex items-center gap-0.5 text-[12px] font-semibold text-[#36534E] hover:underline"
          >
          한국소비자원 참가격 공식 조사 원문 <ExternalLink size={12} />
        </a>
      </section>

      {/* 기간 선택 + 전국/서울 토글 */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative">
          <select
            value={periodId}
            onChange={e => setPeriodId(e.target.value)}
            className="appearance-none rounded-[14px] border border-[#eadfc9] bg-white px-4 py-2.5 pr-9 text-[14px] font-semibold text-[#071629] shadow-[0_8px_24px_rgba(8,22,38,0.035)] focus:outline-none focus:ring-2 focus:ring-[#36534E]/20"
          >
            {[...PRICE_PERIODS].reverse().map(p => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
          </select>
          <ChevronDown size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[#7a8290]" />
        </div>

        {(activeTab === "venue" || activeTab === "sdm" || activeTab === "options") && (
          <div className="flex rounded-[14px] border border-[#eadfc9] bg-white p-1">
            {(["national", "seoul"] as const).map(s => (
              <button
                key={s}
                onClick={() => setScope(s)}
                className={`rounded-[10px] px-4 py-2 text-[13px] font-semibold transition-colors ${
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
      <div className="flex gap-1 overflow-x-auto pb-1 scrollbar-hide">
        {TABS.map(tab => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex shrink-0 items-center gap-1.5 rounded-[14px] border px-4 py-2.5 text-[13px] font-semibold whitespace-nowrap transition-colors ${
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
      <div className="space-y-6">
        {activeTab === "overview" && <OverviewTab periodId={periodId} />}
        {activeTab === "regional" && <RegionalTab periodId={periodId} />}
        {activeTab === "venue" && <VenueTab periodId={periodId} scope={scope} />}
        {activeTab === "sdm" && <SdmTab periodId={periodId} />}
        {activeTab === "options" && <OptionsTab scope={scope} />}
        {activeTab === "seasonal" && <SeasonalTab periodId={periodId} />}
      </div>

      {/* 출처 */}
      <div className="text-center text-[12px] font-medium text-[#7a8290]">
        데이터 출처: 한국소비자원 · {currentPeriod.label} 기준 · 단위: 만원
      </div>

    </div>
  );
}

function OverviewTab({ periodId }: { periodId: string }) {
  const nat = getNationalAverages(periodId);
  const sdm = SDM_PACKAGES.find(s => s.periodId === periodId && s.region === "전체");
  const seasonal = SEASONAL_DATA.find(s => s.periodId === periodId);

  return (
    <>
      <div className="grid grid-cols-2 gap-3 max-md:grid-cols-1">
        <StatCard label="전국 식대 평균 계약금액" value={nat.meal} sub="다른 항목과 합산하지 않는 개별 조사값" />
        <StatCard label="전국 대관료 평균 계약금액" value={nat.rental} sub="다른 항목과 합산하지 않는 개별 조사값" />
        <StatCard label="전국 기본 장식 평균 계약금액" value={nat.decoration} sub="다른 항목과 합산하지 않는 개별 조사값" />
        <StatCard label="전국 스드메 평균 계약금액" value={nat.sdm} sub="예식장 항목과 별도인 조사값" />
        <StatCard label="스드메 패키지 중위가격(중간값)" value={sdm?.packageMedian} />
        <StatCard
          label="예식장 성수기·비수기 중위가격(중간값) 차이"
          value={seasonal?.savings}
          suffix="만원 차이"
          sub={seasonal ? `예식장 중위값 ${formatMan(seasonal.peak)} → ${formatMan(seasonal.offPeak)} · 스드메 제외` : ""}
        />
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
          지역별 예식장·스드메 평균
        </h3>
        <p className={`${MUTED_TEXT} mt-1`}>
          식대·대관료·기본 장식·스드메 조사값을 별도 열로 표시합니다. 항목끼리 합산하거나 지역 순위로 해석하지 마세요.
        </p>
      </div>
      <div className="px-4 pb-4 md:px-5">
        <RegionalCostTable periodId={periodId} />
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
          <p className={`${MUTED_TEXT} mt-1`}>금액과 최소 보증인원은 공식 조사 중위가격(중간값)입니다.</p>
        </div>
        {nec ? (
          <div className="grid grid-cols-2 gap-px bg-[#eadfc9]/70 max-md:grid-cols-1">
            <DataCell label="대관료" value={formatMan(nec.rental)} />
            <DataCell
              label="최소 보증인원"
              value={nec.minGuests > 0 ? `${nec.minGuests.toLocaleString()}명` : "자료 없음"}
            />
            <DataCell label="1인당 식대" value={formatMan(nec.perPersonMeal)} />
            <DataCell label="식대 총액" value={formatMan(nec.totalFood)} />
          </div>
        ) : (
          <p className="px-4 pb-4 text-[13px] font-medium text-[#7a8290] md:px-5">
            선택한 조사월의 예식장 필수 항목 자료가 없습니다.
          </p>
        )}
      </div>

      <div className={`${SERVICE_CARD} overflow-hidden`}>
        <div className="px-4 py-4 md:px-5">
          <h3 className={SECTION_TITLE}>선택 항목 중위가격(중간값)</h3>
          <p className={`${MUTED_TEXT} mt-1`}>필수가 아닌 선택 서비스입니다. 실제 포함 범위와 추가 조건을 확인하세요.</p>
        </div>
        <div className="divide-y divide-[#eadfc9]/70">
          {VENUE_OPTIONAL_NAMES.map(name => (
            <div key={name} className="flex items-center justify-between gap-3 px-4 py-3 md:px-5">
              <span className="text-[13px] font-medium text-[#071629]">{name}</span>
              <span className="shrink-0 text-[13px] font-semibold text-[#071629]">
                {formatMan(optItems.items[name])}
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
        title="스드메 패키지 지역별 중위가격(중간값)"
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
        title="드레스 중위가격(중간값)"
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
        title="메이크업 중위가격(중간값)"
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
  const latestPeriod = PRICE_PERIODS[PRICE_PERIODS.length - 1];
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
              <p className={`${MUTED_TEXT} mt-1`}>
                {latestPeriod.label} 최신 조사 기준 중위가격(중간값)입니다. 옵션별 데이터는 최신 조사월만 제공합니다.
              </p>
            </div>
            <div className="divide-y divide-[#eadfc9]/70">
              {items.map(item => {
                const price = scope === "seoul" ? item.seoulPrice : item.nationalPrice;
                return (
                  <div key={item.name} className="flex items-center justify-between gap-3 px-4 py-3 md:px-5">
                    <span className="text-[13px] font-medium text-[#071629]">{item.name}</span>
                    <span className="shrink-0 text-[13px] font-semibold text-[#071629]">
                      {formatMan(price)}
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
  const selected = SEASONAL_DATA.find(s => s.periodId === periodId);
  if (!selected) {
    return (
      <div className={`${SERVICE_CARD} p-4 md:p-5`} role="status">
        <p className="text-[13px] font-semibold text-[#071629]">시즌별 자료 없음</p>
        <p className={`${MUTED_TEXT} mt-1`}>
          선택한 조사월의 성수기·비수기 조사값을 확인할 수 없습니다. 다른 조사월을 선택해주세요.
        </p>
      </div>
    );
  }
  const selectedPeriod = PRICE_PERIODS.find(p => p.id === selected.periodId);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 max-md:grid-cols-1">
        <div className={`${SERVICE_CARD_SOFT} p-4 md:p-5`}>
          <div className="mb-3 flex items-center gap-2">
            <Sun size={20} className="text-[#36534E]" />
            <span className="text-[13px] font-semibold text-[#071629]">예식장 성수기 중위가격(중간값)</span>
          </div>
          <p className={MUTED_TEXT}>{selectedPeriod?.label} 조사 · 예식장별 성수기·비수기 기준 상이 · 스드메 제외</p>
          <p className="mt-2 font-serif-kr text-[30px] font-medium leading-none text-[#071629]">{formatMan(selected.peak)}</p>
        </div>
        <div className={`${SERVICE_CARD_SOFT} p-4 md:p-5`}>
          <div className="mb-3 flex items-center gap-2">
            <Snowflake size={20} className="text-[#36534E]" />
            <span className="text-[13px] font-semibold text-[#071629]">예식장 비수기 중위가격(중간값)</span>
          </div>
          <p className={MUTED_TEXT}>{selectedPeriod?.label} 조사 · 예식장별 성수기·비수기 기준 상이 · 스드메 제외</p>
          <p className="mt-2 font-serif-kr text-[30px] font-medium leading-none text-[#071629]">{formatMan(selected.offPeak)}</p>
        </div>
      </div>

      <div className={`${SERVICE_CARD} p-4 text-center md:p-5`}>
        <p className={KICKER}>VENUE CONTRACT AMOUNT GAP</p>
        <p className="mt-2 font-serif-kr text-[34px] font-medium leading-none text-[#36534E]">
          {formatMan(selected.savings)}
        </p>
        <p className={`${BODY_TEXT} mt-2`}>
          같은 조사월의 예식장 중위가격(중간값) 차이입니다. 성수기·비수기 월 구분은 예식장마다 다르며,
          실제 절약 보장액이나 전체 결혼비용 차이가 아닙니다. 스드메는 포함하지 않습니다.
        </p>
      </div>

      <TableCard
        title="조사월별 예식장 성수기/비수기 중위가격(중간값)"
        headers={["조사월", "성수기", "비수기", "금액 차이"]}
      >
        {[...SEASONAL_DATA].reverse().map(s => {
          const period = PRICE_PERIODS.find(p => p.id === s.periodId);
          return (
            <tr key={s.periodId} className="border-b border-[#eadfc9]/70 last:border-b-0 hover:bg-[#fffdf7]">
              <td className={TABLE_TEXT}>{period?.label ?? "조사월 확인 불가"}</td>
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

function StatCard({
  label,
  value,
  suffix = "만원",
  sub,
}: {
  label: string;
  value: number | null | undefined;
  suffix?: string;
  sub?: string;
}) {
  return (
    <div className={`${SERVICE_CARD_SOFT} p-4 md:p-5`}>
      <p className="mb-2 text-[12px] font-semibold text-[#5d6879]">{label}</p>
      <p className="font-serif-kr text-[30px] font-medium leading-none text-[#071629] sm:text-[34px]">
        {formatMarketPrice(value, suffix)}
      </p>
      {sub && <p className={`${MUTED_TEXT} mt-2`}>{sub}</p>}
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
