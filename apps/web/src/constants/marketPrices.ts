/**
 * 한국소비자원 결혼서비스 가격 통계
 * 출처: https://www.price.go.kr/tprice/portal/wedding/areaStatistic.do
 *
 * 데이터는 marketPricesData.generated.ts (자동 생성)에서 가져온다.
 * 갱신: apps/web에서 `npm run update:market-prices` 실행 → typecheck/test 후 커밋.
 * 직접 숫자를 수정하지 말 것 — 수동 전사는 오타·원본 개정 누락 사고가 이미 있었다.
 */

import {
  GEN_DECO_DATA,
  GEN_DRESS_PRICES,
  GEN_MAKEUP_PRICES,
  GEN_MEAL_DATA,
  GEN_NATIONAL_TOTALS,
  GEN_OPTION_PRICES,
  GEN_PRICE_PERIODS,
  GEN_RENTAL_DATA,
  GEN_SDM_DATA,
  GEN_SDM_PACKAGES,
  GEN_SEASONAL_DATA,
  GEN_VENUE_NECESSARY,
  GEN_VENUE_OPT_NATIONAL,
  GEN_VENUE_OPT_SEOUL,
} from "./marketPricesData.generated";

// ===== 타입 정의 =====

export interface PricePeriod {
  id: string;       // "202504", "202505", ...
  label: string;    // "2025년 4월"
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
  meal: number;       // 식대 (만원)
  sdm: number;        // 스드메 (만원)
  rental: number;     // 대관료 (만원)
  decoration: number; // 꽃장식 (만원)
}

/** @deprecated 출처 스냅샷이 없는 레거시 차트 호환 타입. 공개 시세에 사용하지 않는다. */
export interface TrendDataPoint {
  month: string;
  medianTotal: number;
  medianSdm: number;
}

export interface VenueNecessary {
  periodId: string;
  scope: "national" | "seoul";
  rental: number;         // 대관료 (만원)
  minGuests: number;      // 최소보증인원 (명)
  perPersonMeal: number;  // 1인당 식대 (만원)
  totalFood: number;      // 식대 총액 (만원)
}

export interface VenueOptionalItem {
  periodId: string;
  scope: "national" | "seoul";
  items: Record<string, number>; // 항목명 → 가격(만원)
}

export interface SdmPackage {
  periodId: string;
  region: string;          // "전체", "서울", "경기/인천", "5대광역시", "기타지역"
  packageMedian: number;   // 스드메 패키지 (만원)
  dmPackageMedian: number; // 드메 패키지 (만원)
  studioBasic: number;     // 스튜디오 기본가 (만원)
}

export interface DressPrice {
  periodId: string;
  scope: "national" | "seoul";
  photoShoot: number;   // 촬영용 (만원)
  ceremony: number;     // 본식용 (만원)
  secondDress: number;  // 2부 드레스 (만원)
}

export interface MakeupPrice {
  periodId: string;
  scope: "national" | "seoul";
  photoShoot: number;   // 촬영 (만원)
  ceremony: number;     // 본식 (만원)
  rehearsal: number;    // 리허설 (만원)
}

export interface OptionPriceItem {
  category: "studio" | "dress" | "makeup";
  name: string;
  nationalPrice: number;  // 전국 (만원)
  seoulPrice: number;     // 서울 (만원)
}

export interface SeasonalComparison {
  periodId: string;
  peak: number;     // 예식장 성수기 중위 계약금액 (만원, 스드메 제외)
  offPeak: number;  // 예식장 비수기 중위 계약금액 (만원, 스드메 제외)
  savings: number;  // 두 예식장 중위 계약금액의 차이 (만원, 절약 보장액 아님)
}

export interface NationalAveragePrice {
  meal: number | null;
  sdm: number | null;
  rental: number | null;
  decoration: number | null;
}

// ===== 상수 데이터 (자동 생성분 바인딩) =====

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

export const REGION_KEYS: RegionKey[] = [
  "seoulGangnam", "seoulOther", "busan", "daegu", "incheon",
  "gwangju", "daejeon", "ulsan", "gyeonggi", "gangwon",
  "chungcheong", "jeolla", "gyeongsang", "jeju",
];

export const PRICE_PERIODS: PricePeriod[] = [...GEN_PRICE_PERIODS];

// 전국 평균 요약 (기간별)
export const NATIONAL_AVERAGES: Record<string, { meal: number; sdm: number; rental: number; decoration: number }> =
  GEN_NATIONAL_TOTALS;

// 지역별 상세 데이터 (14개 지역 × 기간) — REGION_KEYS 순서
const MEAL_DATA: Record<string, number[]> = GEN_MEAL_DATA;
const SDM_DATA: Record<string, number[]> = GEN_SDM_DATA;
const RENTAL_DATA: Record<string, number[]> = GEN_RENTAL_DATA;
const DECO_DATA: Record<string, number[]> = GEN_DECO_DATA;

// 지역별 데이터 빌더
export function getRegionalCosts(periodId: string): RegionalCost[] {
  const meals = MEAL_DATA[periodId];
  const sdms = SDM_DATA[periodId];
  const rentals = RENTAL_DATA[periodId];
  const decos = DECO_DATA[periodId];
  if (!meals) return [];

  return REGION_KEYS.map((region, i) => ({
    periodId,
    region,
    meal: meals[i],
    sdm: sdms[i],
    rental: rentals[i],
    decoration: decos[i],
  }));
}

/**
 * @deprecated 과거 수동 전사값은 조사 스냅샷·표본·갱신 경로가 없어 삭제했다.
 * 참가격의 예식장·스드메 계약금액을 분리 수집하고 조사 시점을 보존하는 파이프라인 없이는 다시 채우지 않는다.
 */
export const TREND_DATA: TrendDataPoint[] = [];

// 예식장 필수항목 (기간별, 전국/서울)
export const VENUE_NECESSARY: VenueNecessary[] = GEN_VENUE_NECESSARY as VenueNecessary[];

// 예식장 선택항목 이름 목록 (17개)
export const VENUE_OPTIONAL_NAMES = [
  "생화꽃장식", "축가/축하공연", "본식 사회자", "본식 도우미", "주례비",
  "폐백 음식", "폐백 수모비", "혼주 헤어/메이크업", "부케", "본식 촬영",
  "본식 원판구매", "플라워샤워", "축주비", "포토테이블", "한복대여",
  "웨딩케이크", "본식드레스도우미",
];

// 예식장 선택항목 데이터
const VENUE_OPT_NATIONAL: Record<string, number[]> = GEN_VENUE_OPT_NATIONAL;
const VENUE_OPT_SEOUL: Record<string, number[]> = GEN_VENUE_OPT_SEOUL;

export function getVenueOptionalItems(periodId: string, scope: "national" | "seoul"): VenueOptionalItem {
  const data = scope === "seoul" ? VENUE_OPT_SEOUL[periodId] : VENUE_OPT_NATIONAL[periodId];
  const items: Record<string, number> = {};
  if (data) {
    VENUE_OPTIONAL_NAMES.forEach((name, i) => {
      items[name] = data[i];
    });
  }
  return { periodId, scope, items };
}

// 스드메 패키지 가격
export const SDM_PACKAGES: SdmPackage[] = GEN_SDM_PACKAGES;

// 드레스 가격
export const DRESS_PRICES: DressPrice[] = GEN_DRESS_PRICES as DressPrice[];

// 메이크업 가격
export const MAKEUP_PRICES: MakeupPrice[] = GEN_MAKEUP_PRICES as MakeupPrice[];

// 옵션별 시세 (최신 기간 기준)
export const OPTION_PRICES: OptionPriceItem[] = GEN_OPTION_PRICES as OptionPriceItem[];

// 예식장 성수기 vs 비수기 중위 계약금액 (스드메 제외)
export const SEASONAL_DATA: SeasonalComparison[] = GEN_SEASONAL_DATA;

// ===== 헬퍼 함수 =====

export function getLatestPeriodId(): string {
  return PRICE_PERIODS[PRICE_PERIODS.length - 1].id;
}

export function getNationalAverages(periodId?: string): NationalAveragePrice {
  const pid = periodId ?? getLatestPeriodId();
  const d = NATIONAL_AVERAGES[pid];
  if (!d) return { meal: null, sdm: null, rental: null, decoration: null };
  return { ...d };
}
