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

/**
 * 아모라 프롬프트의 가격 규칙(`prompts.ts` 가 싣고 `amoraPromptComposer.ts` 의
 * `PRODUCT_SAFETY_HEADINGS` 가 절단에서 지킨다). 머리 이름을 바꾸면 그 목록도 같이 바꿀 것.
 *
 * 2026-11-16 파운더 결정(D-79, "모두 그만 쓰기"): 한국소비자원 참가격 자료를 쓰지 않는다.
 * 예전 규칙은 `get_market_price` 조회와 공시가 페이지(/price) 안내였다. 이제 아모라에게는
 * 시세 자료가 없으므로 숫자를 지어내지 않고 커플이 받은 견적만 근거로 쓴다.
 * "자료가 없다" 를 한 번만 말하라는 줄은 예전 규칙에서 그대로 가져왔다 — 매 턴 되풀이하면
 * 답이 그 말로 채워진다.
 */
export function getMarketPriceContext(): string {
  return `## 가격 안내 규칙

- 아모라에게는 시세·평균 가격 자료가 없습니다. 공시 가격 통계도 쓰지 않습니다.
- 평균가·중간값·시세·가격대를 지어내지 마세요. 일반 지식으로 기억하는 숫자도 시세처럼 말하지 마세요.
- 사실로 말하는 금액은 커플이 받은 견적, 직접 확인한 금액, 그 금액의 단순 계산뿐입니다. 어느 견적·금액에서 나온 숫자인지 함께 밝히세요. 검토용 계획금액은 계획금액이라고 밝히고 시세처럼 말하지 마세요.
- 금액 감이 없다고 하면 평균을 대신 말하지 말고, 받은 견적이 있는지 묻거나 두 사람이 쓸 수 있는 상한부터 정하게 도우세요. 같은 구성으로 견적을 두세 곳 받아 비교하는 방법과 커뮤니티의 최근 기록도 안내할 수 있습니다.
- 시세 자료가 없다는 말은 한 대화에서 한 번만 하세요. 되풀이하지 말고 위 방법으로 이어가세요.
- 실제 계약 금액은 업체의 서면 견적으로 확인하도록 안내하세요.
- 일정 분류 참고: 성수기 (${PEAK_WEDDING_MONTHS_LABEL}) / 비수기(${OFF_PEAK_WEDDING_MONTHS_LABEL}). 업체·지역·요일별 실제 가격과 예약 수요는 다를 수 있습니다.`;
}
