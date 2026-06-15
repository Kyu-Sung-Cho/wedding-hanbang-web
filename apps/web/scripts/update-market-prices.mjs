/**
 * 한국소비자원 참가격 결혼서비스 통계 자동 갱신 스크립트
 *
 * price.go.kr의 내부 AJAX 엔드포인트에서 전 기간 데이터를 받아
 * src/constants/marketPricesData.generated.ts 를 재생성한다.
 *
 * 왜 자동화인가: 수동 전사는 ①오타 ②원본 개정(예: 2026-02 데이터가
 * 2026-03-27에 사이트에서 수정됨)을 따라가지 못한다. 시세 정확도가
 * 견적 진단 신뢰의 전부이므로 데이터 파이프는 기계가 담당한다.
 *
 * 실행: npm run update:market-prices   (apps/web에서)
 * 이후: typecheck + vitest 통과 확인 후 커밋.
 */

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const BASE = "https://www.price.go.kr/tprice/portal/wedding";
const OUT_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "src",
  "constants",
  "marketPricesData.generated.ts"
);

// 참가격 첫 조사가 2025-04. 현재 연도까지 스캔한다.
const FIRST_YEAR = 2025;

// 사이트 areaList 순서와 동일 (검증으로 보장)
const REGION_ORDER = [
  "서울(강남)", "서울(강남외)", "부산", "대구", "인천",
  "광주", "대전", "울산", "경기도", "강원도",
  "충청도", "전라도", "경상도", "제주도",
];

// 예식장 선택항목 17개 — 사이트 표 순서 고정
const VENUE_OPTIONAL_NAMES = [
  "생화꽃장식", "축가/축하공연", "본식 사회자", "본식 도우미", "주례비",
  "폐백 음식", "폐백 수모비", "혼주 헤어/메이크업", "부케", "본식 촬영",
  "본식 원판구매", "플라워샤워", "축주비", "포토테이블", "한복대여",
  "웨딩케이크", "본식드레스도우미",
];

// 옵션 시세 항목명 — 사이트 표 순서 고정 (S4 옵션 리스트와 1:1)
void VENUE_OPTIONAL_NAMES;

const STUDIO_OPTION_NAMES = [
  "앨범페이지 추가", "드레스 추가", "드레스 외 의상 추가", "수정비용", "액자변경",
  "촬영시간 추가", "선수정본", "컨펌비", "담당자 지정", "야외촬영",
  "야간촬영", "촬영 출장비", "서브 스냅", "소품 활용", "들러리 촬영",
  "반려동물 촬영", "원본구매비", "수정본구매비", "모바일 사진 제공", "얼리스타트비",
];
const DRESS_OPTION_NAMES = [
  "헬퍼(촬영)", "헬퍼(본식)", "기본 피팅비", "추가 피팅비", "재가봉비",
  "가봉스냅", "드레스 지정비", "디자인 추가", "웨딩슈즈 대여", "2부 드레스",
  "퍼스트웨어", "야외 예식", "턱시도 대여", "액세서리 대여",
];
const MAKEUP_OPTION_NAMES = [
  "담당자 지정", "촬영 출장비", "휴무일 진행비", "신랑 메이크업", "신랑헤어",
  "신부 커트", "가발", "흑채", "헤어변형", "헤어피스 구매",
  "헤어피스 보증금", "헤어피스 시술", "남성혼주 헤어&메이크업", "여성혼주 헤어&메이크업",
  "레이트 스타트비", "얼리스타트비",
];

async function post(endpoint, body) {
  const res = await fetch(`${BASE}/${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
  });
  if (!res.ok) throw new Error(`${endpoint} HTTP ${res.status}`);
  return res.json();
}

const r1 = (n) => Math.round(Number(n) * 10) / 10;
const r2 = (n) => Math.round(Number(n) * 100) / 100;

function assert(cond, msg) {
  if (!cond) throw new Error(`데이터 검증 실패: ${msg}`);
}

async function getScheduleNumbers() {
  const currentYear = new Date().getFullYear();
  const numbers = [];
  for (let year = FIRST_YEAR; year <= currentYear; year++) {
    try {
      const res = await post("getMonthList.do", { scheduleYear: String(year) });
      for (const row of res.resultList ?? []) {
        numbers.push(String(row.weddingPriceScheduleNumber));
      }
    } catch {
      // 해당 연도 자료 없음 — skip
    }
  }
  assert(numbers.length >= 11, `기간 수가 너무 적음 (${numbers.length})`);
  return [...new Set(numbers)].sort();
}

async function main() {
  console.log("참가격 데이터 수집 시작...");
  const scheduleNumbers = await getScheduleNumbers();
  console.log(`기간 ${scheduleNumbers.length}개: ${scheduleNumbers[0]} ~ ${scheduleNumbers[scheduleNumbers.length - 1]}`);

  const periods = [];
  const nationalTotals = {};
  const mealData = {};
  const sdmData = {};
  const rentalData = {};
  const decoData = {};
  const venueNecessary = [];
  const venueOptNational = {};
  const venueOptSeoul = {};
  const sdmPackages = [];
  const dressPrices = [];
  const makeupPrices = [];
  const seasonal = [];
  let optionPrices = null; // 최신 기간 기준

  for (const sn of scheduleNumbers) {
    const year = Number(sn.slice(0, 4));
    const month = Number(sn.slice(4, 6));
    console.log(`  ${year}년 ${month}월 (${sn}) 수집 중...`);

    const [s1, s3, s4] = await Promise.all([
      post("areaStatisticSection1.do", { scheduleNumber: sn }),
      post("areaStatisticSection3.do", { scheduleNumber: sn }),
      post("areaStatisticSection4.do", { scheduleNumber: sn }),
    ]);

    // ── S1: 지역별 + 전국 합산 ──
    const areaNames = (s1.areaList ?? []).map((a) => a.areaName);
    assert(
      REGION_ORDER.every((name, i) => areaNames[i] === name),
      `${sn} 지역 순서 불일치: ${areaNames.join(",")}`
    );
    for (const key of ["areaMealSumList", "areaSdmSumList", "areaRentalSumList", "areaDecoSumList"]) {
      assert(s1[key]?.length === 14, `${sn} ${key} 길이 ${s1[key]?.length}`);
    }
    mealData[sn] = s1.areaMealSumList.map(r1);
    sdmData[sn] = s1.areaSdmSumList.map(r1);
    rentalData[sn] = s1.areaRentalSumList.map(r1);
    decoData[sn] = s1.areaDecoSumList.map(r1);
    nationalTotals[sn] = {
      meal: r1(s1.totalMeal),
      sdm: r1(s1.totalSDM),
      rental: r1(s1.totalRental),
      decoration: r1(s1.totalDeco),
    };
    assert(nationalTotals[sn].meal > 0 && nationalTotals[sn].sdm > 0, `${sn} 전국 합산 0`);

    // ── S3: 예식장 필수/선택 + 성수기 ──
    // 필수 배열: [대관료, 최소보증인원, 1인식대, 식대총액]
    for (const [scope, list] of [
      ["national", s3.allAreaMiddleNecessaryPriceList],
      ["seoul", s3.seoulMiddleNecessaryPriceList],
    ]) {
      assert(list?.length === 4, `${sn} ${scope} 필수항목 길이 ${list?.length}`);
      venueNecessary.push({
        periodId: sn,
        scope,
        rental: r1(list[0]),
        minGuests: Math.round(list[1]),
        perPersonMeal: r2(list[2]),
        totalFood: r1(list[3]),
      });
    }
    assert(s3.allAreaMiddlePriceList?.length === 17, `${sn} 선택항목(전국) 길이`);
    assert(s3.seoulMiddlePriceList?.length === 17, `${sn} 선택항목(서울) 길이`);
    venueOptNational[sn] = s3.allAreaMiddlePriceList.map(r2);
    venueOptSeoul[sn] = s3.seoulMiddlePriceList.map(r2);
    seasonal.push({
      periodId: sn,
      peak: r1(s3.peekSeasonMiddlePrice),
      offPeak: r1(s3.offSeasonMiddlePrice),
      savings: r1(s3.peekSeasonMiddlePrice - s3.offSeasonMiddlePrice),
    });

    // ── S4: 스드메/드레스/메이크업 중위가 ──
    const sdmRegions = [
      ["전체", s4.allAreaSdmMedianPrice, s4.allAreaDmMedianPrice, s4.allAreaStudioMedianPrice],
      ["서울", s4.seoulSdmMedianPrice, s4.seoulDmMedianPrice, s4.seoulStudioMedianPrice],
      ["경기/인천", s4.ggicSdmMedianPrice, s4.ggicDmMedianPrice, s4.ggicStudioMedianPrice],
      ["5대광역시", s4.fiveSdmMedianPrice, s4.fiveDmMedianPrice, s4.fiveStudioMedianPrice],
      ["기타지역", s4.otherSdmMedianPrice, s4.otherDmMedianPrice, s4.otherStudioMedianPrice],
    ];
    for (const [region, pkg, dm, studio] of sdmRegions) {
      assert(Number(pkg) > 0 && Number(studio) > 0, `${sn} ${region} 스드메/스튜디오 중위가 0`);
      sdmPackages.push({
        periodId: sn,
        region,
        packageMedian: r2(pkg),
        dmPackageMedian: r2(dm),
        studioBasic: r2(studio),
      });
    }
    // 드레스 [촬영용, 본식용, 2부] / 메이크업 [촬영, 본식, 리허설]
    for (const [scope, dress, makeup] of [
      ["national", s4.allAreaDressMiddlePriceList, s4.allAreaMakeUpMiddlePriceList],
      ["seoul", s4.seoulDressMiddlePriceList, s4.seoulMakeUpMiddlePriceList],
    ]) {
      assert(dress?.length === 3 && makeup?.length === 3, `${sn} ${scope} 드레스/메이크업 길이`);
      dressPrices.push({
        periodId: sn,
        scope,
        photoShoot: r2(dress[0]),
        ceremony: r2(dress[1]),
        secondDress: r2(dress[2]),
      });
      makeupPrices.push({
        periodId: sn,
        scope,
        photoShoot: r2(makeup[0]),
        ceremony: r2(makeup[1]),
        rehearsal: r2(makeup[2]),
      });
    }

    // 옵션 시세는 최신 기간으로 덮어씀 (루프가 오름차순이므로 마지막이 최신)
    assert(s4.allAreaStudioMiddlePriceList?.length === STUDIO_OPTION_NAMES.length, `${sn} 스튜디오 옵션 길이`);
    assert(s4.allAreaDressOptionMiddlePriceList?.length === DRESS_OPTION_NAMES.length, `${sn} 드레스 옵션 길이`);
    assert(s4.allAreaMakeUpOptionMiddlePriceList?.length === MAKEUP_OPTION_NAMES.length, `${sn} 메이크업 옵션 길이`);
    optionPrices = [
      ...STUDIO_OPTION_NAMES.map((name, i) => ({
        category: "studio",
        name,
        nationalPrice: r2(s4.allAreaStudioMiddlePriceList[i]),
        seoulPrice: r2(s4.seoulStudioMiddlePriceList[i]),
      })),
      ...DRESS_OPTION_NAMES.map((name, i) => ({
        category: "dress",
        name,
        nationalPrice: r2(s4.allAreaDressOptionMiddlePriceList[i]),
        seoulPrice: r2(s4.seoulDressOptionMiddlePriceList[i]),
      })),
      ...MAKEUP_OPTION_NAMES.map((name, i) => ({
        category: "makeup",
        name,
        nationalPrice: r2(s4.allAreaMakeUpOptionMiddlePriceList[i]),
        seoulPrice: r2(s4.seoulMakeUpOptionMiddlePriceList[i]),
      })),
    ];

    periods.push({ id: sn, label: `${year}년 ${month}월`, year, month });
  }

  const json = (v) => JSON.stringify(v, null, 2);
  const out = `/**
 * 자동 생성 파일 — 직접 수정 금지.
 * 생성: scripts/update-market-prices.mjs (npm run update:market-prices)
 * 출처: 한국소비자원 참가격 결혼서비스 가격조사 (price.go.kr)
 * 수집 시각: ${new Date().toISOString()}
 * 포함 기간: ${scheduleNumbers[0]} ~ ${scheduleNumbers[scheduleNumbers.length - 1]} (${scheduleNumbers.length}개)
 */

export const GEN_PRICE_PERIODS = ${json(periods)} as const;

export const GEN_NATIONAL_TOTALS: Record<string, { meal: number; sdm: number; rental: number; decoration: number }> = ${json(nationalTotals)};

export const GEN_MEAL_DATA: Record<string, number[]> = ${json(mealData)};

export const GEN_SDM_DATA: Record<string, number[]> = ${json(sdmData)};

export const GEN_RENTAL_DATA: Record<string, number[]> = ${json(rentalData)};

export const GEN_DECO_DATA: Record<string, number[]> = ${json(decoData)};

export const GEN_VENUE_NECESSARY = ${json(venueNecessary)};

export const GEN_VENUE_OPT_NATIONAL: Record<string, number[]> = ${json(venueOptNational)};

export const GEN_VENUE_OPT_SEOUL: Record<string, number[]> = ${json(venueOptSeoul)};

export const GEN_SDM_PACKAGES = ${json(sdmPackages)};

export const GEN_DRESS_PRICES = ${json(dressPrices)};

export const GEN_MAKEUP_PRICES = ${json(makeupPrices)};

export const GEN_OPTION_PRICES = ${json(optionPrices)};

export const GEN_SEASONAL_DATA = ${json(seasonal)};
`;

  writeFileSync(OUT_PATH, out, "utf8");
  console.log(`\n✅ 생성 완료: ${OUT_PATH}`);
  console.log(`   기간 ${periods.length}개, 최신 = ${periods[periods.length - 1].label}`);
  console.log("   다음: npm run typecheck && npm test 통과 확인 후 커밋");
}

main().catch((err) => {
  console.error("\n❌ 갱신 실패:", err.message);
  process.exit(1);
});
