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

export function getNationalAverages(periodId?: string): { meal: number; sdm: number; rental: number; decoration: number } {
  const pid = periodId ?? getLatestPeriodId();
  const d = NATIONAL_AVERAGES[pid];
  if (!d) return { meal: 0, sdm: 0, rental: 0, decoration: 0 };
  return { ...d };
}

export function getSeoulAverages(periodId?: string): { meal: number; sdm: number; rental: number; decoration: number } {
  const pid = periodId ?? getLatestPeriodId();
  const costs = getRegionalCosts(pid);
  const gangnam = costs.find(c => c.region === "seoulGangnam");
  const other = costs.find(c => c.region === "seoulOther");
  if (!gangnam || !other) return { meal: 0, sdm: 0, rental: 0, decoration: 0 };
  // 서울 평균 = (강남 + 강남외) / 2
  const meal = Math.round(((gangnam.meal + other.meal) / 2) * 10) / 10;
  const sdm = Math.round(((gangnam.sdm + other.sdm) / 2) * 10) / 10;
  const rental = Math.round(((gangnam.rental + other.rental) / 2) * 10) / 10;
  const decoration = Math.round(((gangnam.decoration + other.decoration) / 2) * 10) / 10;
  return { meal, sdm, rental, decoration };
}

// 예산 카테고리 키 → 시세 매핑 (만원 반환)
export function getCategoryMarketPrice(catKey: string, scope: "national" | "seoul" = "national"): number | null {
  const pid = getLatestPeriodId();
  const venueNec = VENUE_NECESSARY.find(v => v.periodId === pid && v.scope === scope);
  const sdm = SDM_PACKAGES.find(s => s.periodId === pid && s.region === (scope === "seoul" ? "서울" : "전체"));
  const dress = DRESS_PRICES.find(d => d.periodId === pid && d.scope === scope);
  const makeup = MAKEUP_PRICES.find(m => m.periodId === pid && m.scope === scope);
  const optItems = getVenueOptionalItems(pid, scope);

  switch (catKey) {
    case "venue":
      return venueNec ? venueNec.rental + venueNec.totalFood : null;
    case "studio":
      return sdm ? sdm.studioBasic : null;
    case "dress":
      return dress ? dress.ceremony : null;
    case "makeup":
      return makeup ? makeup.photoShoot : null;
    case "snap":
      return optItems.items["본식 촬영"] ?? null;
    case "bouquet":
      return optItems.items["부케"] ?? null;
    case "mc":
      return optItems.items["본식 사회자"] ?? null;
    case "pyebaek":
      return (optItems.items["폐백 음식"] ?? 0) + (optItems.items["폐백 수모비"] ?? 0) || null;
    case "hanbok":
      return optItems.items["한복대여"] ?? null;
    default:
      return null;
  }
}

// AI 프롬프트용 시세 요약 텍스트
export function getMarketPriceContext(): string {
  const pid = getLatestPeriodId();
  const period = PRICE_PERIODS.find(p => p.id === pid)!;
  const nat = getNationalAverages(pid);
  const seoul = getSeoulAverages(pid);
  const nationalVenueAverage = Math.round((nat.meal + nat.rental + nat.decoration) * 10) / 10;
  const seoulVenueAverage = Math.round((seoul.meal + seoul.rental + seoul.decoration) * 10) / 10;
  const sdmNat = SDM_PACKAGES.find(s => s.periodId === pid && s.region === "전체")!;
  const sdmSeoul = SDM_PACKAGES.find(s => s.periodId === pid && s.region === "서울")!;
  const venueNat = VENUE_NECESSARY.find(v => v.periodId === pid && v.scope === "national")!;
  const venueSeoul = VENUE_NECESSARY.find(v => v.periodId === pid && v.scope === "seoul")!;
  const dressNat = DRESS_PRICES.find(d => d.periodId === pid && d.scope === "national")!;
  const dressSeoul = DRESS_PRICES.find(d => d.periodId === pid && d.scope === "seoul")!;
  const makeupNat = MAKEUP_PRICES.find(m => m.periodId === pid && m.scope === "national")!;
  const makeupSeoul = MAKEUP_PRICES.find(m => m.periodId === pid && m.scope === "seoul")!;
  const seasonal = SEASONAL_DATA.find(s => s.periodId === pid)!;
  const optNat = getVenueOptionalItems(pid, "national");
  const optSeoul = getVenueOptionalItems(pid, "seoul");

  return `## 한국소비자원 웨딩 시세 (${period.label} 기준, price.go.kr)

### 계약금액 비교 (참가격 분류를 분리해 표시)
- 전국 예식장 평균 계약금액: ${nationalVenueAverage}만원 (식대 ${nat.meal} + 대관료 ${nat.rental} + 기본 장식 ${nat.decoration})
- 전국 스드메 평균 계약금액: ${nat.sdm}만원
- 서울 예식장 평균 계약금액: ${seoulVenueAverage}만원 (식대 ${seoul.meal} + 대관료 ${seoul.rental} + 기본 장식 ${seoul.decoration})
- 서울 스드메 평균 계약금액: ${seoul.sdm}만원
- 답변 규칙: 예식장 평균과 스드메 평균은 조사 분류가 다르므로 하나의 총액으로 합산하지 말고 각각 제시할 것. 어느 값도 개인의 실제 결혼 총지출이나 중위값으로 표현하지 말 것

### 예식장 필수
- 대관료: 전국 ${venueNat.rental}만원 / 서울 ${venueSeoul.rental}만원
- 1인당 식대: 전국 ${venueNat.perPersonMeal}만원 / 서울 ${venueSeoul.perPersonMeal}만원
- 최소보증인원: 전국 ${venueNat.minGuests}명 / 서울 ${venueSeoul.minGuests}명

### 예식장 선택항목 (전국/서울)
- 생화꽃장식: ${optNat.items["생화꽃장식"]}만원 / ${optSeoul.items["생화꽃장식"]}만원
- 축가: ${optNat.items["축가/축하공연"]}만원 / ${optSeoul.items["축가/축하공연"]}만원
- 사회자: ${optNat.items["본식 사회자"]}만원 / ${optSeoul.items["본식 사회자"]}만원
- 주례비: ${optNat.items["주례비"]}만원 / ${optSeoul.items["주례비"]}만원
- 폐백음식: ${optNat.items["폐백 음식"]}만원 / ${optSeoul.items["폐백 음식"]}만원
- 수모비: ${optNat.items["폐백 수모비"]}만원 / ${optSeoul.items["폐백 수모비"]}만원
- 부케: ${optNat.items["부케"]}만원 / ${optSeoul.items["부케"]}만원
- 본식촬영: ${optNat.items["본식 촬영"]}만원 / ${optSeoul.items["본식 촬영"]}만원
- 웨딩케이크: ${optNat.items["웨딩케이크"]}만원 / ${optSeoul.items["웨딩케이크"]}만원
- 한복대여: ${optNat.items["한복대여"]}만원 / ${optSeoul.items["한복대여"]}만원

### 스드메 패키지 (지역별 중위가)
- 전체: 패키지 ${sdmNat.packageMedian}만원, 스튜디오 ${sdmNat.studioBasic}만원
- 서울: 패키지 ${sdmSeoul.packageMedian}만원, 스튜디오 ${sdmSeoul.studioBasic}만원
- 경기/인천: 패키지 ${SDM_PACKAGES.find(s => s.periodId === pid && s.region === "경기/인천")?.packageMedian}만원
- 5대광역시: 패키지 ${SDM_PACKAGES.find(s => s.periodId === pid && s.region === "5대광역시")?.packageMedian}만원

### 드레스
- 촬영용: 전국 ${dressNat.photoShoot}만원 / 서울 ${dressSeoul.photoShoot}만원
- 본식용: 전국 ${dressNat.ceremony}만원 / 서울 ${dressSeoul.ceremony}만원

### 메이크업
- 촬영: 전국 ${makeupNat.photoShoot}만원 / 서울 ${makeupSeoul.photoShoot}만원
- 본식: 전국 ${makeupNat.ceremony}만원 / 서울 ${makeupSeoul.ceremony}만원

### 예식장 성수기 vs 비수기 중위 계약금액 (스드메 제외)
- 성수기(4~6월,9~11월): ${seasonal.peak}만원
- 비수기(1~3월,7~8월,12월): ${seasonal.offPeak}만원
- 두 예식장 중위 계약금액 차이: ${seasonal.savings}만원 (실제 절약 보장액 아님)

### 시세 활용 규칙
1. 고객이 예산 적정성을 물으면 좋고 나쁨을 판정하지 말고 같은 조사월·지역·구성의 참고값을 제공
2. 지역(서울/경기·인천/광역시)에 따라 기준 중위가가 크게 다르므로 반드시 지역 기준으로 안내
3. 시즌 차이는 예식장 중위 계약금액만 비교하며 스드메 제외와 절약 비보장을 명시
4. 출처를 "한국소비자원 ${period.label} 기준"으로 명시
5. 스드메 패키지와 개별 계약 차이 안내
6. 예식장 선택항목은 필수가 아니므로 절약 포인트로 안내`;
}
