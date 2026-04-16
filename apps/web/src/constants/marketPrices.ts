/**
 * 한국소비자원 결혼서비스 가격 통계
 * 출처: https://www.price.go.kr/tprice/portal/wedding/areaStatistic.do
 * 데이터 기간: 2025년 4월 ~ 2026년 2월 (11개 기간)
 */

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
  total: number;      // 합계 (만원)
}

export interface TrendDataPoint {
  month: string;        // "26년 01월"
  medianTotal: number;  // 총 비용 중위값 (만원)
  medianSdm: number;    // 스드메 중위값 (만원)
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
  peak: number;     // 성수기 (만원)
  offPeak: number;  // 비수기 (만원)
  savings: number;  // 절약액 (만원)
}

// ===== 상수 데이터 =====

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

export const PRICE_PERIODS: PricePeriod[] = [
  { id: "202504", label: "2025년 4월", year: 2025, month: 4 },
  { id: "202505", label: "2025년 5월", year: 2025, month: 5 },
  { id: "202506", label: "2025년 6월", year: 2025, month: 6 },
  { id: "202507", label: "2025년 7월", year: 2025, month: 7 },
  { id: "202508", label: "2025년 8월", year: 2025, month: 8 },
  { id: "202509", label: "2025년 9월", year: 2025, month: 9 },
  { id: "202510", label: "2025년 10월", year: 2025, month: 10 },
  { id: "202511", label: "2025년 11월", year: 2025, month: 11 },
  { id: "202512", label: "2025년 12월", year: 2025, month: 12 },
  { id: "202601", label: "2026년 1월", year: 2026, month: 1 },
  { id: "202602", label: "2026년 2월", year: 2026, month: 2 },
];

// 전국 평균 요약 (기간별)
export const NATIONAL_TOTALS: Record<string, { meal: number; sdm: number; rental: number; decoration: number }> = {
  "202504": { meal: 1321.6, sdm: 309.4, rental: 368.5, decoration: 101.8 },
  "202505": { meal: 1307.1, sdm: 310.0, rental: 371.0, decoration: 99.5 },
  "202506": { meal: 1298.9, sdm: 309.1, rental: 367.5, decoration: 98.8 },
  "202507": { meal: 1308.0, sdm: 311.8, rental: 387.1, decoration: 92.5 },
  "202508": { meal: 1332.5, sdm: 318.6, rental: 409.6, decoration: 99.5 },
  "202509": { meal: 1313.9, sdm: 323.0, rental: 405.7, decoration: 98.4 },
  "202510": { meal: 1288.1, sdm: 323.2, rental: 390.8, decoration: 83.9 },
  "202511": { meal: 1304.6, sdm: 323.9, rental: 396.6, decoration: 81.2 },
  "202512": { meal: 1290.7, sdm: 322.7, rental: 389.1, decoration: 88.8 },
  "202601": { meal: 1281.0, sdm: 314.6, rental: 406.8, decoration: 85.5 },
  "202602": { meal: 1140.5, sdm: 280.0, rental: 350.5, decoration: 280.0 },
};

// 지역별 상세 데이터 (14개 지역 × 10개 기간)
const MEAL_DATA: Record<string, number[]> = {
  "202504": [2150.1, 1677.7, 681.3, 1154.6, 1247.3, 1147.6, 1189.8, 1136.1, 1193.8, 1015.6, 1123.4, 1045.1, 758.1, 1273.4],
  "202505": [2115.4, 1610.7, 685.4, 1093.3, 1207.5, 1122.1, 1104.1, 1141.9, 1184.3, 1182.1, 1124.4, 1042.4, 736.5, 1313.4],
  "202506": [2099.6, 1628.9, 686.9, 1090.3, 1229.9, 1118.0, 1098.9, 1145.6, 1202.7, 1175.0, 1094.2, 1033.5, 699.8, 1313.8],
  "202507": [2172.6, 1600.4, 680.7, 1104.7, 1209.0, 1139.4, 1104.7, 1122.4, 1201.9, 1217.3, 1077.7, 1041.0, 707.3, 1137.6],
  "202508": [2158.7, 1546.8, 706.9, 1058.9, 1212.1, 1114.9, 1048.7, 1053.2, 1161.7, 1105.4, 1166.1, 1058.2, 729.9, 1008.8],
  "202509": [2132.3, 1573.7, 687.2, 1080.3, 1237.9, 1114.2, 1041.4, 1085.4, 1148.9, 1030.1, 1177.0, 1085.9, 763.0, 992.2],
  "202510": [2148.3, 1578.1, 694.1, 1049.8, 1184.6, 1112.0, 1082.0, 1143.6, 1126.4, 1096.4, 1105.4, 1078.9, 762.3, 1065.4],
  "202511": [2190.2, 1563.1, 706.5, 1043.4, 1190.0, 1115.5, 1083.3, 1122.8, 1124.0, 1114.8, 1135.0, 1087.9, 752.2, 1066.4],
  "202512": [2205.8, 1567.1, 727.3, 1038.9, 1134.8, 1071.0, 969.6, 1169.6, 1151.8, 1106.8, 1114.9, 1082.9, 764.7, 1013.5],
  "202601": [2064.8, 1629.7, 830.0, 1041.6, 1003.2, 1103.3, 1025.2, 1029.1, 1153.0, 1044.1, 1022.0, 1006.9, 749.8, 1207.6],
};

const SDM_DATA: Record<string, number[]> = {
  "202504": [360.6, 324.5, 341.4, 272.5, 221.6, 334.0, 266.4, 265.5, 246.6, 249.1, 254.4, 339.1, 242.7, 107.8],
  "202505": [360.0, 311.5, 350.7, 272.7, 223.4, 343.1, 264.4, 263.7, 243.3, 251.7, 256.9, 340.6, 239.1, 115.7],
  "202506": [355.5, 300.2, 349.4, 263.4, 228.4, 343.6, 287.2, 265.6, 244.3, 252.8, 259.5, 341.1, 241.0, 129.5],
  "202507": [367.9, 289.0, 350.8, 266.1, 227.5, 345.2, 277.8, 251.7, 249.8, 252.3, 256.0, 342.2, 227.8, 129.7],
  "202508": [388.5, 314.2, 342.1, 260.2, 239.7, 346.3, 289.7, 244.8, 259.7, 259.9, 260.3, 328.6, 223.1, 149.4],
  "202509": [403.4, 303.1, 350.2, 260.8, 245.3, 341.9, 289.7, 241.7, 253.5, 256.3, 274.4, 330.5, 241.4, 181.1],
  "202510": [397.2, 289.5, 371.0, 269.7, 273.4, 343.7, 279.4, 242.5, 242.2, 252.1, 284.3, 330.0, 235.2, 153.9],
  "202511": [405.9, 299.2, 357.7, 275.3, 243.5, 340.8, 293.4, 240.2, 248.4, 245.0, 272.1, 325.5, 232.4, 147.8],
  "202512": [401.4, 266.7, 358.7, 274.5, 250.6, 341.4, 290.1, 244.2, 243.0, 245.0, 273.9, 323.3, 228.2, 148.7],
  "202601": [379.1, 296.3, 331.5, 295.1, 248.5, 314.2, 280.0, 224.2, 241.3, 233.4, 267.1, 318.1, 217.8, 147.1],
};

const RENTAL_DATA: Record<string, number[]> = {
  "202504": [637.3, 549.8, 203.5, 200.4, 321.7, 164.3, 178.1, 391.2, 370.6, 345.0, 356.8, 271.1, 206.7, 91.3],
  "202505": [640.9, 534.4, 200.3, 188.1, 297.1, 180.0, 190.8, 405.2, 382.4, 333.1, 348.2, 273.5, 215.3, 100.0],
  "202506": [638.0, 530.6, 198.7, 190.4, 307.9, 183.0, 204.4, 407.3, 378.7, 333.3, 337.4, 276.3, 209.0, 96.6],
  "202507": [678.8, 552.3, 187.4, 195.1, 311.2, 207.4, 204.8, 398.5, 387.2, 348.4, 338.8, 272.2, 235.0, 114.9],
  "202508": [681.4, 561.8, 171.4, 187.7, 357.2, 189.6, 217.0, 347.7, 393.7, 305.0, 332.6, 296.7, 227.6, 88.1],
  "202509": [692.5, 573.9, 179.3, 196.3, 371.0, 190.1, 225.5, 314.3, 395.5, 271.2, 343.0, 318.6, 236.0, 113.6],
  "202510": [716.2, 559.6, 190.1, 198.4, 326.6, 188.9, 219.6, 386.4, 375.9, 285.2, 320.6, 311.6, 228.1, 126.3],
  "202511": [676.1, 588.2, 190.1, 196.5, 329.3, 190.8, 219.7, 388.0, 370.5, 300.6, 321.1, 319.1, 229.2, 117.5],
  "202512": [681.4, 572.9, 199.0, 185.8, 328.7, 159.1, 211.7, 388.9, 363.5, 300.6, 324.5, 329.6, 233.4, 124.3],
  "202601": [693.5, 609.7, 221.0, 195.6, 295.4, 198.9, 263.6, 271.5, 396.0, 315.2, 362.3, 324.7, 227.2, 124.6],
};

const DECO_DATA: Record<string, number[]> = {
  "202504": [260.7, 262.8, 0.7, 17.5, 43.2, 9.2, 62.2, 3.7, 64.3, 16.8, 0.0, 6.2, 1.5, 70.5],
  "202505": [234.7, 244.3, 0.6, 41.1, 52.0, 6.9, 58.8, 4.2, 52.7, 23.1, 0.0, 6.5, 4.2, 66.9],
  "202506": [242.8, 243.6, 0.0, 42.5, 53.0, 4.3, 66.6, 5.2, 55.1, 24.3, 0.0, 7.4, 3.1, 69.3],
  "202507": [216.3, 200.9, 0.0, 42.3, 50.8, 5.5, 78.1, 6.5, 66.5, 15.0, 0.0, 9.1, 8.9, 20.1],
  "202508": [280.1, 165.4, 0.0, 36.7, 51.0, 4.1, 79.1, 0.0, 47.0, 2.2, 0.0, 9.4, 0.0, 38.1],
  "202509": [282.6, 178.6, 0.0, 43.9, 58.6, 4.1, 75.9, 0.0, 44.5, 5.8, 0.0, 20.7, 0.0, 17.2],
  "202510": [238.3, 165.3, 0.0, 40.1, 40.5, 2.2, 74.1, 0.0, 57.9, 4.5, 0.0, 20.8, 5.2, 18.4],
  "202511": [287.0, 109.8, 0.0, 38.0, 33.0, 1.9, 74.7, 0.0, 60.4, 13.8, 0.0, 23.0, 2.5, 37.1],
  "202512": [310.2, 123.8, 0.0, 41.3, 38.6, 2.3, 110.4, 0.0, 67.4, 20.8, 4.8, 26.0, 2.0, 38.7],
  "202601": [276.4, 151.6, 0.0, 38.4, 13.8, 1.5, 87.7, 16.2, 46.5, 47.0, 13.2, 16.3, 2.4, 51.2],
};

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
    total: Math.round((meals[i] + sdms[i] + rentals[i] + decos[i]) * 10) / 10,
  }));
}

// 18개월 트렌드 데이터 (2024-08 ~ 2026-01, scheduleNumber 202601 기준)
export const TREND_DATA: TrendDataPoint[] = [
  { month: "26년 01월", medianTotal: 1190, medianSdm: 280 },
  { month: "26년 02월", medianTotal: 1245, medianSdm: 278 },
  { month: "26년 03월", medianTotal: 1655, medianSdm: 280 },
  { month: "26년 04월", medianTotal: 1725, medianSdm: 289 },
  { month: "26년 05월", medianTotal: 1750, medianSdm: 290 },
  { month: "26년 06월", medianTotal: 1660, medianSdm: 293 },
  { month: "26년 07월", medianTotal: 1400, medianSdm: 290 },
  { month: "26년 08월", medianTotal: 1300, medianSdm: 290 },
  { month: "26년 09월", medianTotal: 1580, medianSdm: 300 },
  { month: "26년 10월", medianTotal: 1496, medianSdm: 300 },
  { month: "26년 11월", medianTotal: 1478, medianSdm: 300 },
  { month: "26년 12월", medianTotal: 1430, medianSdm: 302 },
  { month: "27년 01월", medianTotal: 1190, medianSdm: 300 },
  { month: "27년 02월", medianTotal: 1310, medianSdm: 310 },
  { month: "27년 03월", medianTotal: 1728, medianSdm: 309 },
  { month: "27년 04월", medianTotal: 1643, medianSdm: 310 },
  { month: "27년 05월", medianTotal: 1745, medianSdm: 305 },
  { month: "27년 06월", medianTotal: 1700, medianSdm: 310 },
];

// 예식장 필수항목 (기간별, 전국/서울)
export const VENUE_NECESSARY: VenueNecessary[] = [
  // 전국
  { periodId: "202504", scope: "national", rental: 300, minGuests: 200, perPersonMeal: 5.8, totalFood: 1182.5 },
  { periodId: "202505", scope: "national", rental: 300, minGuests: 200, perPersonMeal: 5.8, totalFood: 1180 },
  { periodId: "202506", scope: "national", rental: 300, minGuests: 200, perPersonMeal: 5.8, totalFood: 1180 },
  { periodId: "202507", scope: "national", rental: 300, minGuests: 200, perPersonMeal: 5.9, totalFood: 1200 },
  { periodId: "202508", scope: "national", rental: 350, minGuests: 200, perPersonMeal: 6.0, totalFood: 1200 },
  { periodId: "202509", scope: "national", rental: 330, minGuests: 200, perPersonMeal: 5.9, totalFood: 1200 },
  { periodId: "202510", scope: "national", rental: 300, minGuests: 200, perPersonMeal: 5.8, totalFood: 1144 },
  { periodId: "202511", scope: "national", rental: 300, minGuests: 200, perPersonMeal: 5.8, totalFood: 1151 },
  { periodId: "202512", scope: "national", rental: 300, minGuests: 200, perPersonMeal: 5.8, totalFood: 1140 },
  { periodId: "202601", scope: "national", rental: 350, minGuests: 200, perPersonMeal: 5.9, totalFood: 1125 },
  { periodId: "202602", scope: "national", rental: 350.5, minGuests: 200, perPersonMeal: 5.9, totalFood: 1140.5 },
  // 서울
  { periodId: "202504", scope: "seoul", rental: 600, minGuests: 220, perPersonMeal: 7.7, totalFood: 1760 },
  { periodId: "202505", scope: "seoul", rental: 600, minGuests: 200, perPersonMeal: 7.5, totalFood: 1700 },
  { periodId: "202506", scope: "seoul", rental: 600, minGuests: 200, perPersonMeal: 7.5, totalFood: 1701 },
  { periodId: "202507", scope: "seoul", rental: 600, minGuests: 200, perPersonMeal: 7.6, totalFood: 1725 },
  { periodId: "202508", scope: "seoul", rental: 600, minGuests: 200, perPersonMeal: 7.7, totalFood: 1625 },
  { periodId: "202509", scope: "seoul", rental: 600, minGuests: 200, perPersonMeal: 7.8, totalFood: 1640 },
  { periodId: "202510", scope: "seoul", rental: 600, minGuests: 200, perPersonMeal: 7.7, totalFood: 1650 },
  { periodId: "202511", scope: "seoul", rental: 600, minGuests: 200, perPersonMeal: 7.9, totalFood: 1655 },
  { periodId: "202512", scope: "seoul", rental: 600, minGuests: 200, perPersonMeal: 7.9, totalFood: 1700 },
  { periodId: "202601", scope: "seoul", rental: 600, minGuests: 200, perPersonMeal: 8.0, totalFood: 1625 },
  { periodId: "202602", scope: "seoul", rental: 630.5, minGuests: 200, perPersonMeal: 8.0, totalFood: 1600.5 },
];

// 예식장 선택항목 이름 목록 (17개)
export const VENUE_OPTIONAL_NAMES = [
  "생화꽃장식", "축가/축하공연", "본식 사회자", "본식 도우미", "주례비",
  "폐백 음식", "폐백 수모비", "혼주 헤어/메이크업", "부케", "본식 촬영",
  "본식 원판구매", "플라워샤워", "축주비", "포토테이블", "한복대여",
  "웨딩케이크", "본식드레스도우미",
];

// 예식장 선택항목 데이터 (전국)
const VENUE_OPT_NATIONAL: Record<string, number[]> = {
  "202504": [225, 27, 30, 30, 16, 30, 10, 17, 28, 85, 51, 14, 40, 37, 30, 37, 15],
  "202505": [225, 25, 30, 30, 16, 30, 10, 18, 28, 80, 50, 14, 40, 37, 30, 38, 15],
  "202506": [200, 25, 30, 30, 16, 30, 10, 18, 28, 80, 50, 13, 40, 37, 30, 38, 15],
  "202507": [200, 25, 30, 30, 16, 30, 10, 17, 28, 80, 50, 14, 40, 37, 30, 38, 15],
  "202508": [262, 25, 30, 30, 16, 30, 10, 17, 28, 80, 50, 13, 40, 37, 30, 38, 15],
  "202509": [275, 25, 30, 30, 16, 30, 10, 17, 28, 80, 50, 15, 40, 37, 30, 38, 15],
  "202510": [250, 25, 30, 30, 16, 30, 10, 18, 26, 80, 50, 15, 40, 37, 30, 38, 15],
  "202511": [250, 25, 30, 30, 16, 30, 10, 16.55, 25.13, 80, 50, 15, 40, 37, 30, 38, 15],
  "202512": [262, 25, 30, 30, 16, 30, 10, 15, 26, 80, 50.5, 15, 40, 37, 29.25, 38, 15],
  "202601": [275, 25, 30, 30, 16, 30, 10, 14, 25, 80, 50, 15, 40, 37, 28, 38, 15],
  "202602": [280, 25, 30, 30, 16, 30, 11, 14.5, 25, 77, 50, 13.5, 40, 37, 27.25, 38, 15],
};

// 예식장 선택항목 데이터 (서울)
const VENUE_OPT_SEOUL: Record<string, number[]> = {
  "202504": [501, 39, 33, 32, 20, 38, 17, 17, 29, 85, 51, 21, 45, 35, 33, 41, 32],
  "202505": [501, 39, 33, 30, 20, 36, 16, 18, 29, 85, 51, 21, 45, 37, 33, 44, 34],
  "202506": [501, 39, 33, 30, 20, 37, 17, 18, 29, 85, 51, 21, 45, 37, 33, 44, 37],
  "202507": [501, 33, 30, 30, 20, 37, 15, 19, 29, 85, 51, 21, 45, 37, 33, 44, 34],
  "202508": [501, 33, 33, 30, 20, 39, 17, 19, 29, 85, 51, 21, 44, 35, 33, 45, 30],
  "202509": [501, 35, 33, 30, 20, 39, 17, 19, 29, 85, 51, 22, 44, 35, 33, 45, 30],
  "202510": [501, 35, 33, 30, 20, 39, 17, 18, 29, 85, 51, 22, 45, 36, 33, 45, 32],
  "202511": [501, 33, 33, 30, 20, 37.75, 15.75, 18, 29, 85, 51, 22, 45, 36, 33, 44.5, 32],
  "202512": [501, 33, 33, 30, 20, 38.5, 16.75, 16.5, 29, 85, 51, 22, 45, 37, 33, 45, 30],
  "202601": [550, 30, 34, 30, 20, 38.75, 15, 14.25, 29, 85, 50, 22, 50, 37, 33, 45, 25.75],
  "202602": [540, 30, 33, 30, 20, 37, 15, 16.5, 29, 85, 50, 22, 42.5, 37, 33, 44, 32],
};

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
export const SDM_PACKAGES: SdmPackage[] = [
  // 202504
  { periodId: "202504", region: "전체", packageMedian: 290, dmPackageMedian: 140, studioBasic: 135 },
  { periodId: "202504", region: "서울", packageMedian: 295, dmPackageMedian: 97, studioBasic: 150 },
  { periodId: "202504", region: "경기/인천", packageMedian: 228, dmPackageMedian: 150, studioBasic: 125 },
  { periodId: "202504", region: "5대광역시", packageMedian: 307, dmPackageMedian: 150, studioBasic: 140 },
  { periodId: "202504", region: "기타지역", packageMedian: 285, dmPackageMedian: 129, studioBasic: 110 },
  // 202505
  { periodId: "202505", region: "전체", packageMedian: 291, dmPackageMedian: 138, studioBasic: 132 },
  { periodId: "202505", region: "서울", packageMedian: 297, dmPackageMedian: 79, studioBasic: 150 },
  { periodId: "202505", region: "경기/인천", packageMedian: 234, dmPackageMedian: 148, studioBasic: 120 },
  { periodId: "202505", region: "5대광역시", packageMedian: 307, dmPackageMedian: 152, studioBasic: 140 },
  { periodId: "202505", region: "기타지역", packageMedian: 285, dmPackageMedian: 125, studioBasic: 115 },
  // 202506
  { periodId: "202506", region: "전체", packageMedian: 292, dmPackageMedian: 140, studioBasic: 132 },
  { periodId: "202506", region: "서울", packageMedian: 299, dmPackageMedian: 80, studioBasic: 150 },
  { periodId: "202506", region: "경기/인천", packageMedian: 233, dmPackageMedian: 139, studioBasic: 120 },
  { periodId: "202506", region: "5대광역시", packageMedian: 305, dmPackageMedian: 150, studioBasic: 140 },
  { periodId: "202506", region: "기타지역", packageMedian: 290, dmPackageMedian: 140, studioBasic: 115 },
  // 202507
  { periodId: "202507", region: "전체", packageMedian: 291, dmPackageMedian: 150, studioBasic: 132 },
  { periodId: "202507", region: "서울", packageMedian: 304, dmPackageMedian: 140, studioBasic: 150 },
  { periodId: "202507", region: "경기/인천", packageMedian: 237, dmPackageMedian: 140, studioBasic: 120 },
  { periodId: "202507", region: "5대광역시", packageMedian: 299, dmPackageMedian: 152, studioBasic: 140 },
  { periodId: "202507", region: "기타지역", packageMedian: 282, dmPackageMedian: 150, studioBasic: 115 },
  // 202508
  { periodId: "202508", region: "전체", packageMedian: 293, dmPackageMedian: 150, studioBasic: 132 },
  { periodId: "202508", region: "서울", packageMedian: 313, dmPackageMedian: 130, studioBasic: 150 },
  { periodId: "202508", region: "경기/인천", packageMedian: 250, dmPackageMedian: 138, studioBasic: 120 },
  { periodId: "202508", region: "5대광역시", packageMedian: 295, dmPackageMedian: 150, studioBasic: 140 },
  { periodId: "202508", region: "기타지역", packageMedian: 280, dmPackageMedian: 160, studioBasic: 112 },
  // 202509
  { periodId: "202509", region: "전체", packageMedian: 295, dmPackageMedian: 150, studioBasic: 132 },
  { periodId: "202509", region: "서울", packageMedian: 320, dmPackageMedian: 190, studioBasic: 150 },
  { periodId: "202509", region: "경기/인천", packageMedian: 244, dmPackageMedian: 130, studioBasic: 120 },
  { periodId: "202509", region: "5대광역시", packageMedian: 293, dmPackageMedian: 140, studioBasic: 139 },
  { periodId: "202509", region: "기타지역", packageMedian: 280, dmPackageMedian: 160, studioBasic: 115 },
  // 202510
  { periodId: "202510", region: "전체", packageMedian: 290, dmPackageMedian: 150, studioBasic: 139 },
  { periodId: "202510", region: "서울", packageMedian: 300, dmPackageMedian: 180, studioBasic: 150 },
  { periodId: "202510", region: "경기/인천", packageMedian: 258, dmPackageMedian: 104, studioBasic: 120 },
  { periodId: "202510", region: "5대광역시", packageMedian: 290, dmPackageMedian: 160, studioBasic: 140 },
  { periodId: "202510", region: "기타지역", packageMedian: 290, dmPackageMedian: 148, studioBasic: 112 },
  // 202511
  { periodId: "202511", region: "전체", packageMedian: 292, dmPackageMedian: 160, studioBasic: 135 },
  { periodId: "202511", region: "서울", packageMedian: 325, dmPackageMedian: 195, studioBasic: 150 },
  { periodId: "202511", region: "경기/인천", packageMedian: 243, dmPackageMedian: 130, studioBasic: 120 },
  { periodId: "202511", region: "5대광역시", packageMedian: 300, dmPackageMedian: 160, studioBasic: 140 },
  { periodId: "202511", region: "기타지역", packageMedian: 274, dmPackageMedian: 160, studioBasic: 112 },
  // 202512
  { periodId: "202512", region: "전체", packageMedian: 293, dmPackageMedian: 160, studioBasic: 139 },
  { periodId: "202512", region: "서울", packageMedian: 317, dmPackageMedian: 180, studioBasic: 150 },
  { periodId: "202512", region: "경기/인천", packageMedian: 247, dmPackageMedian: 130, studioBasic: 120 },
  { periodId: "202512", region: "5대광역시", packageMedian: 300, dmPackageMedian: 150, studioBasic: 140 },
  { periodId: "202512", region: "기타지역", packageMedian: 278, dmPackageMedian: 160, studioBasic: 112 },
  // 202601
  { periodId: "202601", region: "전체", packageMedian: 290, dmPackageMedian: 157, studioBasic: 139 },
  { periodId: "202601", region: "서울", packageMedian: 335, dmPackageMedian: 150, studioBasic: 150 },
  { periodId: "202601", region: "경기/인천", packageMedian: 240, dmPackageMedian: 140, studioBasic: 120 },
  { periodId: "202601", region: "5대광역시", packageMedian: 300, dmPackageMedian: 170, studioBasic: 140 },
  { periodId: "202601", region: "기타지역", packageMedian: 270, dmPackageMedian: 160, studioBasic: 112 },
  // 202602
  { periodId: "202602", region: "전체", packageMedian: 280, dmPackageMedian: 155, studioBasic: 137.75 },
  { periodId: "202602", region: "서울", packageMedian: 330, dmPackageMedian: 148, studioBasic: 150.5 },
  { periodId: "202602", region: "경기/인천", packageMedian: 238, dmPackageMedian: 138, studioBasic: 120.5 },
  { periodId: "202602", region: "5대광역시", packageMedian: 295, dmPackageMedian: 168, studioBasic: 140 },
  { periodId: "202602", region: "기타지역", packageMedian: 268, dmPackageMedian: 158, studioBasic: 112 },
];

// 드레스 가격
export const DRESS_PRICES: DressPrice[] = [
  // 전국
  { periodId: "202504", scope: "national", photoShoot: 155, ceremony: 143, secondDress: 140 },
  { periodId: "202505", scope: "national", photoShoot: 151, ceremony: 140, secondDress: 140 },
  { periodId: "202506", scope: "national", photoShoot: 151, ceremony: 140, secondDress: 139 },
  { periodId: "202507", scope: "national", photoShoot: 155, ceremony: 143, secondDress: 140 },
  { periodId: "202508", scope: "national", photoShoot: 155, ceremony: 145, secondDress: 140 },
  { periodId: "202509", scope: "national", photoShoot: 155, ceremony: 145, secondDress: 142 },
  { periodId: "202510", scope: "national", photoShoot: 155, ceremony: 145, secondDress: 143 },
  { periodId: "202511", scope: "national", photoShoot: 156, ceremony: 145, secondDress: 143 },
  { periodId: "202512", scope: "national", photoShoot: 160, ceremony: 145, secondDress: 143 },
  { periodId: "202601", scope: "national", photoShoot: 159, ceremony: 145, secondDress: 143 },
  { periodId: "202602", scope: "national", photoShoot: 158, ceremony: 145, secondDress: 143 },
  // 서울
  { periodId: "202504", scope: "seoul", photoShoot: 198, ceremony: 167, secondDress: 165 },
  { periodId: "202505", scope: "seoul", photoShoot: 160, ceremony: 145, secondDress: 140 },
  { periodId: "202506", scope: "seoul", photoShoot: 160, ceremony: 144, secondDress: 140 },
  { periodId: "202507", scope: "seoul", photoShoot: 176, ceremony: 154, secondDress: 145 },
  { periodId: "202508", scope: "seoul", photoShoot: 180, ceremony: 158, secondDress: 150 },
  { periodId: "202509", scope: "seoul", photoShoot: 176, ceremony: 157, secondDress: 150 },
  { periodId: "202510", scope: "seoul", photoShoot: 166, ceremony: 154, secondDress: 150 },
  { periodId: "202511", scope: "seoul", photoShoot: 172, ceremony: 154, secondDress: 150 },
  { periodId: "202512", scope: "seoul", photoShoot: 176, ceremony: 158, secondDress: 150 },
  { periodId: "202601", scope: "seoul", photoShoot: 172, ceremony: 151, secondDress: 150 },
  { periodId: "202602", scope: "seoul", photoShoot: 170, ceremony: 150, secondDress: 148 },
];

// 메이크업 가격
export const MAKEUP_PRICES: MakeupPrice[] = [
  // 전국
  { periodId: "202504", scope: "national", photoShoot: 76, ceremony: 68, rehearsal: 61 },
  { periodId: "202505", scope: "national", photoShoot: 73, ceremony: 66, rehearsal: 56 },
  { periodId: "202506", scope: "national", photoShoot: 73, ceremony: 66, rehearsal: 59 },
  { periodId: "202507", scope: "national", photoShoot: 76, ceremony: 66, rehearsal: 60 },
  { periodId: "202508", scope: "national", photoShoot: 77, ceremony: 68, rehearsal: 62 },
  { periodId: "202509", scope: "national", photoShoot: 77, ceremony: 69, rehearsal: 62 },
  { periodId: "202510", scope: "national", photoShoot: 77, ceremony: 69, rehearsal: 62 },
  { periodId: "202511", scope: "national", photoShoot: 77, ceremony: 68, rehearsal: 62 },
  { periodId: "202512", scope: "national", photoShoot: 78, ceremony: 69, rehearsal: 62 },
  { periodId: "202601", scope: "national", photoShoot: 78, ceremony: 69, rehearsal: 63 },
  { periodId: "202602", scope: "national", photoShoot: 77, ceremony: 69, rehearsal: 62 },
  // 서울
  { periodId: "202504", scope: "seoul", photoShoot: 96, ceremony: 91, rehearsal: 81 },
  { periodId: "202505", scope: "seoul", photoShoot: 96, ceremony: 88, rehearsal: 77 },
  { periodId: "202506", scope: "seoul", photoShoot: 95, ceremony: 83, rehearsal: 77 },
  { periodId: "202507", scope: "seoul", photoShoot: 96, ceremony: 86, rehearsal: 77 },
  { periodId: "202508", scope: "seoul", photoShoot: 96, ceremony: 84, rehearsal: 77 },
  { periodId: "202509", scope: "seoul", photoShoot: 96, ceremony: 84, rehearsal: 77 },
  { periodId: "202510", scope: "seoul", photoShoot: 96, ceremony: 84, rehearsal: 77 },
  { periodId: "202511", scope: "seoul", photoShoot: 96, ceremony: 84, rehearsal: 77 },
  { periodId: "202512", scope: "seoul", photoShoot: 96, ceremony: 84, rehearsal: 77 },
  { periodId: "202601", scope: "seoul", photoShoot: 96, ceremony: 84, rehearsal: 77 },
  { periodId: "202602", scope: "seoul", photoShoot: 96, ceremony: 84, rehearsal: 77 },
];

// 옵션별 시세 (최신 기간 202601 기준)
export const OPTION_PRICES: OptionPriceItem[] = [
  // 스튜디오 옵션 (20개)
  { category: "studio", name: "앨범페이지 추가", nationalPrice: 3.3, seoulPrice: 3.3 },
  { category: "studio", name: "드레스 추가", nationalPrice: 11, seoulPrice: 11 },
  { category: "studio", name: "드레스 외 의상 추가", nationalPrice: 12.5, seoulPrice: 11 },
  { category: "studio", name: "수정비용", nationalPrice: 5, seoulPrice: 5 },
  { category: "studio", name: "액자변경", nationalPrice: 25, seoulPrice: 24.75 },
  { category: "studio", name: "촬영시간 추가", nationalPrice: 11, seoulPrice: 11 },
  { category: "studio", name: "선수정본", nationalPrice: 5.5, seoulPrice: 5.5 },
  { category: "studio", name: "컨펌비", nationalPrice: 8.25, seoulPrice: 8.25 },
  { category: "studio", name: "담당자 지정", nationalPrice: 20, seoulPrice: 16.5 },
  { category: "studio", name: "야외촬영", nationalPrice: 15, seoulPrice: 11 },
  { category: "studio", name: "야간촬영", nationalPrice: 15, seoulPrice: 11 },
  { category: "studio", name: "촬영 출장비", nationalPrice: 20, seoulPrice: 20 },
  { category: "studio", name: "서브 스냅", nationalPrice: 16.5, seoulPrice: 16.5 },
  { category: "studio", name: "소품 활용", nationalPrice: 5, seoulPrice: 59 },
  { category: "studio", name: "들러리 촬영", nationalPrice: 7, seoulPrice: 16.5 },
  { category: "studio", name: "반려동물 촬영", nationalPrice: 7, seoulPrice: 13.75 },
  { category: "studio", name: "원본구매비", nationalPrice: 30, seoulPrice: 38.5 },
  { category: "studio", name: "수정본구매비", nationalPrice: 16.5, seoulPrice: 13.75 },
  { category: "studio", name: "모바일 사진 제공", nationalPrice: 8.25, seoulPrice: 8.25 },
  { category: "studio", name: "얼리스타트비", nationalPrice: 5, seoulPrice: 6.25 },
  // 드레스 옵션 (14개)
  { category: "dress", name: "헬퍼(촬영)", nationalPrice: 25, seoulPrice: 25 },
  { category: "dress", name: "헬퍼(본식)", nationalPrice: 25, seoulPrice: 25 },
  { category: "dress", name: "기본 피팅비", nationalPrice: 5.5, seoulPrice: 5.5 },
  { category: "dress", name: "추가 피팅비", nationalPrice: 5.5, seoulPrice: 5.5 },
  { category: "dress", name: "재가봉비", nationalPrice: 10, seoulPrice: 10 },
  { category: "dress", name: "가봉스냅", nationalPrice: 75, seoulPrice: 75 },
  { category: "dress", name: "드레스 지정비", nationalPrice: 100, seoulPrice: 82.5 },
  { category: "dress", name: "디자인 추가", nationalPrice: 115, seoulPrice: 110 },
  { category: "dress", name: "웨딩슈즈 대여", nationalPrice: 0, seoulPrice: 3 },
  { category: "dress", name: "2부 드레스", nationalPrice: 40, seoulPrice: 50 },
  { category: "dress", name: "퍼스트웨어", nationalPrice: 110, seoulPrice: 105 },
  { category: "dress", name: "야외 예식", nationalPrice: 15, seoulPrice: 11 },
  { category: "dress", name: "턱시도 대여", nationalPrice: 20, seoulPrice: 23.75 },
  { category: "dress", name: "액세서리 대여", nationalPrice: 0, seoulPrice: 0 },
  // 메이크업 옵션 (16개)
  { category: "makeup", name: "담당자 지정", nationalPrice: 5.5, seoulPrice: 5.5 },
  { category: "makeup", name: "촬영 출장비", nationalPrice: 20, seoulPrice: 15 },
  { category: "makeup", name: "휴무일 진행비", nationalPrice: 16.5, seoulPrice: 19.25 },
  { category: "makeup", name: "신랑 메이크업", nationalPrice: 5, seoulPrice: 5 },
  { category: "makeup", name: "신랑헤어", nationalPrice: 5, seoulPrice: 5.5 },
  { category: "makeup", name: "신부 커트", nationalPrice: 6.6, seoulPrice: 6.6 },
  { category: "makeup", name: "가발", nationalPrice: 10, seoulPrice: 11 },
  { category: "makeup", name: "흑채", nationalPrice: 3.3, seoulPrice: 3.3 },
  { category: "makeup", name: "헤어변형", nationalPrice: 34, seoulPrice: 35 },
  { category: "makeup", name: "헤어피스 구매", nationalPrice: 16, seoulPrice: 16 },
  { category: "makeup", name: "헤어피스 보증금", nationalPrice: 10, seoulPrice: 10 },
  { category: "makeup", name: "헤어피스 시술", nationalPrice: 11, seoulPrice: 11 },
  { category: "makeup", name: "남성혼주 헤어&메이크업", nationalPrice: 8.25, seoulPrice: 8.8 },
  { category: "makeup", name: "여성혼주 헤어&메이크업", nationalPrice: 26.4, seoulPrice: 29.7 },
  { category: "makeup", name: "레이트 스타트비", nationalPrice: 8.25, seoulPrice: 8.25 },
  { category: "makeup", name: "얼리스타트비", nationalPrice: 11, seoulPrice: 13.75 },
];

// 성수기 vs 비수기
export const SEASONAL_DATA: SeasonalComparison[] = [
  { periodId: "202504", peak: 1620, offPeak: 1170, savings: 450 },
  { periodId: "202505", peak: 1620, offPeak: 1120, savings: 500 },
  { periodId: "202506", peak: 1630, offPeak: 1150, savings: 480 },
  { periodId: "202507", peak: 1650, offPeak: 1111, savings: 539 },
  { periodId: "202508", peak: 1662, offPeak: 1295, savings: 367 },
  { periodId: "202509", peak: 1696, offPeak: 1175, savings: 521 },
  { periodId: "202510", peak: 1630, offPeak: 1175, savings: 455 },
  { periodId: "202511", peak: 1640, offPeak: 1170, savings: 470 },
  { periodId: "202512", peak: 1610, offPeak: 1155, savings: 455 },
  { periodId: "202601", peak: 1630, offPeak: 1250, savings: 380 },
  { periodId: "202602", peak: 1610, offPeak: 1400, savings: 210 },
];

// ===== 헬퍼 함수 =====

export function getLatestPeriodId(): string {
  return PRICE_PERIODS[PRICE_PERIODS.length - 1].id;
}

export function getNationalTotal(periodId?: string): { meal: number; sdm: number; rental: number; decoration: number; total: number } {
  const pid = periodId ?? getLatestPeriodId();
  const d = NATIONAL_TOTALS[pid];
  if (!d) return { meal: 0, sdm: 0, rental: 0, decoration: 0, total: 0 };
  return { ...d, total: Math.round((d.meal + d.sdm + d.rental + d.decoration) * 10) / 10 };
}

export function getSeoulTotal(periodId?: string): { meal: number; sdm: number; rental: number; decoration: number; total: number } {
  const pid = periodId ?? getLatestPeriodId();
  const costs = getRegionalCosts(pid);
  const gangnam = costs.find(c => c.region === "seoulGangnam");
  const other = costs.find(c => c.region === "seoulOther");
  if (!gangnam || !other) return { meal: 0, sdm: 0, rental: 0, decoration: 0, total: 0 };
  // 서울 평균 = (강남 + 강남외) / 2
  const meal = Math.round(((gangnam.meal + other.meal) / 2) * 10) / 10;
  const sdm = Math.round(((gangnam.sdm + other.sdm) / 2) * 10) / 10;
  const rental = Math.round(((gangnam.rental + other.rental) / 2) * 10) / 10;
  const decoration = Math.round(((gangnam.decoration + other.decoration) / 2) * 10) / 10;
  return { meal, sdm, rental, decoration, total: Math.round((meal + sdm + rental + decoration) * 10) / 10 };
}

// 예산 카테고리 키 → 시세 매핑 (만원 반환)
export function getCategoryMarketPrice(catKey: string, scope: "national" | "seoul" = "national"): number | null {
  const pid = getLatestPeriodId();
  const latestNational = getNationalTotal(pid);
  const latestSeoul = getSeoulTotal(pid);
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
  const nat = getNationalTotal(pid);
  const seoul = getSeoulTotal(pid);
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

### 총 비용 (식대+스드메+대관료+꽃장식)
- 전국 평균: ${nat.total}만원 (식대 ${nat.meal} + 스드메 ${nat.sdm} + 대관료 ${nat.rental} + 꽃장식 ${nat.decoration})
- 서울 평균: ${seoul.total}만원 (식대 ${seoul.meal} + 스드메 ${seoul.sdm} + 대관료 ${seoul.rental} + 꽃장식 ${seoul.decoration})

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

### 스드메 패키지
- 전체: 패키지 ${sdmNat.packageMedian}만원, 스튜디오 ${sdmNat.studioBasic}만원
- 서울: 패키지 ${sdmSeoul.packageMedian}만원, 스튜디오 ${sdmSeoul.studioBasic}만원

### 드레스
- 촬영용: 전국 ${dressNat.photoShoot}만원 / 서울 ${dressSeoul.photoShoot}만원
- 본식용: 전국 ${dressNat.ceremony}만원 / 서울 ${dressSeoul.ceremony}만원

### 메이크업
- 촬영: 전국 ${makeupNat.photoShoot}만원 / 서울 ${makeupSeoul.photoShoot}만원
- 본식: 전국 ${makeupNat.ceremony}만원 / 서울 ${makeupSeoul.ceremony}만원

### 성수기 vs 비수기
- 성수기(4~6월,9~11월): ${seasonal.peak}만원
- 비수기(1~3월,7~8월,12월): ${seasonal.offPeak}만원
- 비수기 절약: 약 ${seasonal.savings}만원

### 시세 활용 규칙
1. 고객이 예산 적정성을 물으면 시세와 비교하여 구체적 수치로 답변
2. 서울/수도권은 더 높은 가격 기준 안내
3. 비수기 결혼 시 절약 가능 금액 안내
4. 출처를 "한국소비자원 ${period.label} 기준"으로 명시
5. 스드메 패키지와 개별 계약 차이 안내
6. 예식장 선택항목은 필수가 아니므로 절약 포인트로 안내`;
}
