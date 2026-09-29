"use client";

import type { PriceOption, PriceVendor } from "@/lib/price/catalog";

// 슬림 카탈로그(옵션 본문 없이 개수만)의 짝꿍 클라이언트 로더.
// 오퍼(official_price_id) 단위 모듈 캐시 + 진행 중 요청 공유로 중복 호출을 막는다.
const optionCache = new Map<string, PriceOption[]>();
const inflight = new Map<string, Promise<void>>();
const MAX_IDS_PER_REQUEST = 60;

type OptionWithParent = PriceOption & { officialPriceId: string };

function isOptionWithParent(value: unknown): value is OptionWithParent {
  if (!value || typeof value !== "object") return false;
  const isMoney = (amount: unknown) => amount === null
    || (typeof amount === "number" && Number.isSafeInteger(amount) && amount >= 0);
  return "id" in value && typeof value.id === "string" && value.id.length > 0
    && "officialPriceId" in value && typeof value.officialPriceId === "string"
    && "name" in value && typeof value.name === "string" && value.name.length > 0
    && "rawText" in value && typeof value.rawText === "string" && value.rawText.length > 0
    && "minimumKrw" in value && isMoney(value.minimumKrw)
    && "maximumKrw" in value && isMoney(value.maximumKrw)
    && "unit" in value && (value.unit === null || typeof value.unit === "string")
    && "condition" in value && (value.condition === null || typeof value.condition === "string")
    && "isEffectivelyMandatory" in value && typeof value.isEffectivelyMandatory === "boolean"
    && (!("sortOrder" in value) || (typeof value.sortOrder === "number"
      && Number.isSafeInteger(value.sortOrder) && value.sortOrder >= 0));
}

async function fetchOptions(ids: string[]): Promise<void> {
  const key = ids.join(",");
  const existing = inflight.get(key);
  if (existing) return existing;
  const request = (async () => {
    const response = await fetch(`/api/price/vendor-options?ids=${key}`);
    if (!response.ok) throw new Error(`옵션 로드 실패 (${response.status})`);
    const body: unknown = await response.json();
    if (!body || typeof body !== "object" || !("options" in body) || !Array.isArray(body.options)) {
      throw new Error("옵션 응답 형식이 올바르지 않습니다.");
    }
    const grouped = new Map<string, PriceOption[]>(ids.map((id) => [id, []]));
    const seen = new Set<string>();
    for (const value of body.options) {
      if (!isOptionWithParent(value) || !grouped.has(value.officialPriceId) || seen.has(value.id)) {
        throw new Error("옵션 응답 형식이 올바르지 않습니다.");
      }
      seen.add(value.id);
      const { officialPriceId, ...option } = value;
      grouped.get(officialPriceId)!.push(option);
    }
    for (const [id, list] of grouped) optionCache.set(id, list);
  })().finally(() => inflight.delete(key));
  inflight.set(key, request);
  return request;
}

/** 벤더의 모든 오퍼 옵션을 로드해 offerId→옵션 맵으로 돌려준다 (캐시 우선). */
export async function loadVendorOptions(vendor: PriceVendor): Promise<Map<string, PriceOption[]>> {
  const missing = [...new Set(vendor.offers
    .filter((offer) => offer.options.length === 0 && (offer.optionCount ?? 0) > 0)
    .map((offer) => offer.id)
    .filter((id) => !optionCache.has(id)))].sort();
  // 성공한 배치만 캐시한다. 뒤 배치가 실패하면 재시도 때 남은 오퍼만 가져온다.
  for (let index = 0; index < missing.length; index += MAX_IDS_PER_REQUEST) {
    await fetchOptions(missing.slice(index, index + MAX_IDS_PER_REQUEST));
  }
  return new Map(vendor.offers.map((offer) => [
    offer.id,
    offer.options.length > 0 ? offer.options : optionCache.get(offer.id) ?? [],
  ]));
}
