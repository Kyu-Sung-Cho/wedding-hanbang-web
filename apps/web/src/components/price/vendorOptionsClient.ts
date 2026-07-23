"use client";

import type { PriceOption, PriceVendor } from "@/lib/price/catalog";

// 슬림 카탈로그(옵션 본문 없이 개수만)의 짝꿍 클라이언트 로더.
// 오퍼(official_price_id) 단위 모듈 캐시 + 진행 중 요청 공유로 중복 호출을 막는다.
const optionCache = new Map<string, PriceOption[]>();
const inflight = new Map<string, Promise<void>>();

type OptionWithParent = PriceOption & { officialPriceId: string };

async function fetchOptions(ids: string[]): Promise<void> {
  const key = ids.join(",");
  const existing = inflight.get(key);
  if (existing) return existing;
  const request = (async () => {
    const response = await fetch(`/api/price/vendor-options?ids=${key}`);
    if (!response.ok) throw new Error(`옵션 로드 실패 (${response.status})`);
    const body = (await response.json()) as { options?: OptionWithParent[] };
    const grouped = new Map<string, PriceOption[]>(ids.map((id) => [id, []]));
    for (const { officialPriceId, ...option } of body.options ?? []) {
      grouped.get(officialPriceId)?.push(option);
    }
    for (const [id, list] of grouped) optionCache.set(id, list);
  })().finally(() => inflight.delete(key));
  inflight.set(key, request);
  return request;
}

/** 벤더의 모든 오퍼 옵션을 로드해 offerId→옵션 맵으로 돌려준다 (캐시 우선). */
export async function loadVendorOptions(vendor: PriceVendor): Promise<Map<string, PriceOption[]>> {
  const missing = vendor.offers
    .filter((offer) => offer.options.length === 0 && (offer.optionCount ?? 0) > 0)
    .map((offer) => offer.id)
    .filter((id) => !optionCache.has(id));
  if (missing.length > 0) await fetchOptions(missing.sort());
  return new Map(vendor.offers.map((offer) => [
    offer.id,
    offer.options.length > 0 ? offer.options : optionCache.get(offer.id) ?? [],
  ]));
}
