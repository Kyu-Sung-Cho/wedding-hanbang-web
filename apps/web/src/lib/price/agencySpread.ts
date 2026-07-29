import {
  PRICE_CATEGORIES,
  type PriceCatalog,
  type PriceCategory,
  type PriceVendor,
} from "./catalog";
import { canonicalVendorName } from "./vendorIdentity";

/**
 * 첫 화면에 세울 "대행사 간 공시 기본가 차이".
 *
 * 이 서비스가 유일하게 가진 사실은 공시 원문이다. 그런데 첫 화면은 그동안 그 사실을
 * **설명만** 했다("같은 업체인데 대행사마다 달라요"). 읽는 사람에게 그건 주장이고,
 * 주장은 3초 안에 검증되지 않는다. 그래서 주장 대신 **계산된 숫자**를 세운다.
 *
 * ## 묶음 규칙이 왜 이 모양인가 (2026-07-29 운영 데이터 실측)
 *
 * 처음에는 "같은 상품명끼리만 비교한다"로 짰다가 데이터를 보고 뒤집었다.
 *
 *  - 스드메 공시의 `item_name`은 **상품명이 아니라 샵 이름**이다(studio 650/718,
 *    dress 485/525, makeup 274/285가 vendor_name과 글자까지 동일). 상품명인 줄 알고
 *    묶으면 아무 일도 안 하는 게 아니라 **틀리게 쪼갠다** — 아이웨딩만 "가을스튜디오",
 *    나머지는 "가을"로 적어서 최저가 109만 행이 비교에서 통째로 빠졌다.
 *  - 반대로 예식장의 `item_name`은 진짜 상품이다(1,081행 중 vendor_name과 같은 것 0건.
 *    "비스타홀 식대"·"펠리시타홀 식대"처럼 한 예식장 안의 홀·항목별 행이다). 여기서
 *    묶지 않으면 식대와 대관료를 맞대게 된다.
 *
 * 그래서 상품명 여부를 **`canonicalVendorName`으로 판정한다.** 사람이 검수한 표기
 * 병합 표를 그대로 재사용하므로 "가을 = 가을스튜디오 = 샵 이름"은 한 묶음이 되고,
 * "비스타홀 식대"는 상품으로 남는다. 목록·상세와 같은 함수를 쓰는 게 핵심이다.
 *
 * ## 하지 않는 주장
 *
 * 대행사끼리 **구성까지 같다고는 말하지 않는다.** `base_spec` 문구가 글자까지 같은
 * 경우는 16곳뿐이고 그중 값이 다른 건 1곳이라(실측) 그 기준으로는 화면에 세울 게
 * 없다. 그래서 비교 대상은 "그 대행사로 계약할 때의 최저 기본가"이고, 구성이 함께
 * 다를 수 있다는 사실은 화면에서 먼저 밝힌다. 어느 쪽이 낫다는 판정은 하지 않는다.
 */
export type AgencySpread = {
  category: PriceCategory;
  /**
   * 상품명으로 확인된 경우에만 채운다(예식장의 "비스타홀 식대").
   * 스드메처럼 `item_name`이 샵 이름이면 null — 첫 화면에 업체명을 세우지 않는다.
   */
  itemLabel: string | null;
  lowKrw: number;
  highKrw: number;
  gapKrw: number;
  /** 이 묶음을 공시한 대행사 수. */
  agencyCount: number;
};

export type AgencySpreadSummary = {
  /** 대행사 2곳 이상이 공시해 비교가 가능한 업체 수. */
  comparableVendors: number;
  /** 그중 대행사에 따라 실제로 공시 기본가가 달랐던 업체 수. */
  differingVendors: number;
  /** 카테고리별로 차이가 가장 컸던 사례. */
  highlights: AgencySpread[];
};

export const EMPTY_AGENCY_SPREAD_SUMMARY: AgencySpreadSummary = {
  comparableVendors: 0,
  differingVendors: 0,
  highlights: [],
};

/** 상품명이 아니라 샵 이름을 적어 둔 행인지. 판정은 목록·상세와 같은 함수로 한다. */
function isShopNameItem(category: PriceCategory, vendorName: string, itemName: string): boolean {
  return canonicalVendorName(category, itemName) === canonicalVendorName(category, vendorName);
}

function normalizeProductName(value: string): string {
  return value.normalize("NFKC").replace(/\s+/g, "").toLocaleLowerCase("ko-KR");
}

function positiveMoney(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null;
}

/**
 * 한 업체 안에서 비교 가능한 묶음마다 대행사 간 최저·최고를 구한다.
 * 비교 가능한 묶음이 없으면 빈 배열.
 */
export function vendorAgencySpreads(vendor: PriceVendor): AgencySpread[] {
  // 묶음 키 → { 화면 라벨, 대행사별 최저가 }
  const buckets = new Map<string, { label: string | null; agencyLows: Map<string, number> }>();

  for (const offer of vendor.offers) {
    const price = positiveMoney(offer.minimumKrw);
    if (price === null) continue;

    const rawItemName = offer.itemName?.trim() ?? "";
    const isProduct = rawItemName.length > 0
      && !isShopNameItem(vendor.category, vendor.name, rawItemName);
    const key = isProduct ? `item:${normalizeProductName(rawItemName)}` : "vendor";
    // agencyId가 없는 행("업체 직접 공시")은 이름으로 묶는다.
    const agencyKey = offer.agencyId ?? `name:${offer.agencyName}`;

    const bucket = buckets.get(key) ?? { label: isProduct ? rawItemName : null, agencyLows: new Map<string, number>() };
    const previous = bucket.agencyLows.get(agencyKey);
    // 한 대행사가 같은 묶음으로 여러 행을 올렸으면 그 안의 최솟값이 "그 대행사로
    // 갈 때의 값"이다. 이렇게 해야 한 대행사 안의 상·하한이 대행사 간 차이로 둔갑하지 않는다.
    bucket.agencyLows.set(agencyKey, previous === undefined ? price : Math.min(previous, price));
    buckets.set(key, bucket);
  }

  const spreads: AgencySpread[] = [];
  for (const { label, agencyLows } of buckets.values()) {
    if (agencyLows.size < 2) continue;
    const values = [...agencyLows.values()];
    const lowKrw = Math.min(...values);
    const highKrw = Math.max(...values);
    spreads.push({
      category: vendor.category,
      itemLabel: label,
      lowKrw,
      highKrw,
      gapKrw: highKrw - lowKrw,
      agencyCount: agencyLows.size,
    });
  }

  return spreads.sort((left, right) =>
    right.gapKrw - left.gapKrw
    || (left.itemLabel ?? "").localeCompare(right.itemLabel ?? "", "ko-KR"));
}

export function summarizeAgencySpread(catalog: PriceCatalog): AgencySpreadSummary {
  let comparableVendors = 0;
  let differingVendors = 0;
  const bestByCategory = new Map<PriceCategory, AgencySpread>();

  for (const category of PRICE_CATEGORIES) {
    for (const vendor of catalog.categories[category] ?? []) {
      const spreads = vendorAgencySpreads(vendor);
      if (spreads.length === 0) continue;
      comparableVendors += 1;

      const best = spreads[0];
      if (best.gapKrw <= 0) continue;
      differingVendors += 1;

      const current = bestByCategory.get(category);
      if (!current || best.gapKrw > current.gapKrw) bestByCategory.set(category, best);
    }
  }

  return {
    comparableVendors,
    differingVendors,
    // 카탈로그 순서(스튜디오·드레스·메이크업·예식장)를 그대로 따른다 — 차액 순으로
    // 정렬하면 화면이 매 분기 다른 카테고리로 시작해 첫인상이 흔들린다.
    highlights: PRICE_CATEGORIES.flatMap((category) => {
      const spread = bestByCategory.get(category);
      return spread ? [spread] : [];
    }),
  };
}

/**
 * 원 단위를 "만" 단위 문구로. 반올림은 소수 첫째 자리까지만 하고 그 이상은 버리지
 * 않는다 — 149.5만을 150만으로 적으면 첫 화면이 5천원을 지어내는 셈이다.
 */
export function formatKrwManwon(krw: number): string {
  if (!Number.isFinite(krw)) return "-";
  const man = krw / 10_000;
  if (man >= 10_000) {
    const eok = Math.floor(man / 10_000);
    const rest = Math.round(man % 10_000);
    return rest > 0 ? `${eok}억 ${rest.toLocaleString("ko-KR")}만` : `${eok}억`;
  }
  const rounded = Math.round(man * 10) / 10;
  return `${rounded.toLocaleString("ko-KR", { maximumFractionDigits: 1 })}만`;
}
