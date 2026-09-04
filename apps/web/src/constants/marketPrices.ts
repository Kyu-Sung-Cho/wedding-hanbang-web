/**
 * Legacy market-price compatibility surface.
 *
 * Real disclosure figures must never live in source code. Published prices now
 * enter through the reviewed local-file/admin pipeline and are read from the
 * public disclosure views. These empty exports keep older, non-price UI modules
 * type-safe while they are redirected to `/price`.
 */

import {
  OFF_PEAK_WEDDING_MONTHS_LABEL,
  PEAK_WEDDING_MONTHS_LABEL,
} from "./weddingSeasonality";

export interface PricePeriod {
  id: string;
  label: string;
  year: number;
  month: number;
}

export type RegionKey =
  | "seoulGangnam" | "seoulOther" | "busan" | "daegu" | "incheon"
  | "gwangju" | "daejeon" | "ulsan" | "gyeonggi" | "gangwon"
  | "chungcheong" | "jeolla" | "gyeongsang" | "jeju";

export interface RegionalCost {
  periodId: string;
  region: RegionKey;
  meal: number;
  sdm: number;
  rental: number;
  decoration: number;
  total: number;
}

export interface TrendDataPoint {
  month: string;
  medianTotal: number;
  medianSdm: number;
}

export interface VenueNecessary {
  periodId: string;
  scope: "national" | "seoul";
  rental: number;
  minGuests: number;
  perPersonMeal: number;
  totalFood: number;
}

export interface VenueOptionalItem {
  periodId: string;
  scope: "national" | "seoul";
  items: Record<string, number>;
}

export interface SdmPackage {
  periodId: string;
  region: string;
  packageMedian: number;
  dmPackageMedian: number;
  studioBasic: number;
}

export interface DressPrice {
  periodId: string;
  scope: "national" | "seoul";
  photoShoot: number;
  ceremony: number;
  secondDress: number;
}

export interface MakeupPrice {
  periodId: string;
  scope: "national" | "seoul";
  photoShoot: number;
  ceremony: number;
  rehearsal: number;
}

export interface OptionPriceItem {
  category: "studio" | "dress" | "makeup";
  name: string;
  nationalPrice: number;
  seoulPrice: number;
}

export interface SeasonalComparison {
  periodId: string;
  peak: number;
  offPeak: number;
  savings: number;
}

export const REGION_LABELS: Record<RegionKey, string> = {
  seoulGangnam: "서울(강남)",
  seoulOther: "서울(강남외)",
  busan: "부산",
  daegu: "대구",
  incheon: "인천",
  gwangju: "광주",
  daejeon: "대전",
  ulsan: "울산",
  gyeonggi: "경기",
  gangwon: "강원",
  chungcheong: "충청",
  jeolla: "전라",
  gyeongsang: "경상",
  jeju: "제주",
};

export const REGION_KEYS = Object.keys(REGION_LABELS) as RegionKey[];
export const PRICE_PERIODS: PricePeriod[] = [];
export const NATIONAL_TOTALS: Record<string, {
  meal: number;
  sdm: number;
  rental: number;
  decoration: number;
}> = {};
export const TREND_DATA: TrendDataPoint[] = [];
export const VENUE_NECESSARY: VenueNecessary[] = [];
export const SDM_PACKAGES: SdmPackage[] = [];
export const DRESS_PRICES: DressPrice[] = [];
export const MAKEUP_PRICES: MakeupPrice[] = [];
export const OPTION_PRICES: OptionPriceItem[] = [];
export const SEASONAL_DATA: SeasonalComparison[] = [];

export const VENUE_OPTIONAL_NAMES = [
  "생화꽃장식", "축가/축하공연", "본식 사회자", "본식 도우미", "주례비",
  "폐백 음식", "폐백 수모비", "혼주 헤어/메이크업", "부케", "본식 촬영",
  "본식 원판구매", "플라워샤워", "축주비", "포토테이블", "한복대여",
  "웨딩케이크", "본식드레스도우미",
];

export function getRegionalCosts(periodId: string): RegionalCost[] {
  void periodId;
  return [];
}

export function getVenueOptionalItems(
  periodId: string,
  scope: "national" | "seoul",
): VenueOptionalItem {
  return { periodId, scope, items: {} };
}

export function getLatestPeriodId(): string {
  return "";
}

export function getNationalTotal(periodId?: string) {
  void periodId;
  return { meal: 0, sdm: 0, rental: 0, decoration: 0, total: 0 };
}

export function getSeoulTotal(periodId?: string) {
  void periodId;
  return { meal: 0, sdm: 0, rental: 0, decoration: 0, total: 0 };
}

export function getCategoryMarketPrice(
  categoryKey: string,
  scope: "national" | "seoul" = "national",
): number | null {
  void categoryKey;
  void scope;
  return null;
}

export function getMarketPriceContext(): string {
  return `## 공시 가격 사용 규칙

- 소스 코드에 고정된 과거 시세 숫자를 사용하지 않습니다.
- 최신 가격은 검수·발행된 업체별 공시 데이터만 조회합니다.
- 공시 가격은 기준 시점과 기본 조건의 가격이며 실제 계약 금액을 보증하지 않습니다.
- 가격이 필요하면 get_market_price 로 조회하고, 결과에 출처와 기준 시점을 함께 표시합니다.
- 조회할 수단이 없으면 금액을 지어내지 말고 공시가 페이지(/price)에서 직접 확인하도록 안내합니다.
- 공시 자료가 있는 항목은 결혼식장(대관료·식대)·웨딩 사진 촬영·드레스·헤어메이크업 넷뿐입니다. 한복·예단·예물·신혼여행·청첩장·답례품처럼 그 밖의 항목을 물으면 "확인된 시세 자료가 없다"고 한 번만 말하고, 받은 견적을 서로 비교하거나 커뮤니티의 최근 기록을 보라고 안내하세요. 같은 말을 되풀이하지 마세요.
- 일정 분류 참고: 성수기 (${PEAK_WEDDING_MONTHS_LABEL}) / 비수기(${OFF_PEAK_WEDDING_MONTHS_LABEL}). 업체·지역·요일별 실제 가격과 예약 수요는 다를 수 있습니다.`;
}
