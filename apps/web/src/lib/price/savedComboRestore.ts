import { PRICE_CATEGORIES, type PriceCatalog, type PriceCategory, type PriceOption, type PriceVendor } from "./catalog";
import type {
  ComboCategory,
  ComboSelection,
  ComboSelections,
} from "./comboStore";

const COMBO_CATEGORIES: readonly ComboCategory[] = ["studio", "dress", "makeup"];
const MAX_MONEY_KRW = 1_000_000_000;
const MAX_OPTIONS_PER_SELECTION = 50;

/** 비활성 카테고리도 저장 조합 복구에 쓰이므로 모든 가격 식별자는 보존한다. */
export function catalogForPriceBrowser(catalog: PriceCatalog, activeCategory: PriceCategory): PriceCatalog {
  const categories = { ...catalog.categories };
  for (const category of PRICE_CATEGORIES) {
    if (category === activeCategory) continue;
    categories[category] = category === "hall" ? [] : catalog.categories[category].map((vendor) => ({
      ...vendor,
      aliases: [],
      regionCode: null,
      offers: vendor.offers.map((offer) => ({
        id: offer.id,
        agencyId: offer.agencyId,
        agencyName: offer.agencyName,
        minimumKrw: offer.minimumKrw,
        maximumKrw: null,
        priceNote: null,
        baseSpec: null,
        options: [],
        optionCount: offer.options.length || offer.optionCount,
      })),
    }));
  }
  return { ...catalog, categories };
}

type SavedSelection = {
  vendorId: string;
  agencyId: string | null;
  baseKrw: number;
  selectedOptions: Array<{ name: string; krw: number }>;
  customKrw: number | null;
};

export type SavedComboPreview = {
  id: string;
  name: string;
  createdAt: string;
  selections: Record<ComboCategory, SavedSelection | null>;
};

export type LatestSavedComboParseResult =
  | { ok: true; combo: SavedComboPreview | null }
  | { ok: false };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isMoney(value: unknown): value is number {
  return typeof value === "number"
    && Number.isSafeInteger(value)
    && value >= 0
    && value <= MAX_MONEY_KRW;
}

function parseSavedSelection(value: unknown): SavedSelection | null | undefined {
  if (value === null) return null;
  if (!isRecord(value)
    || typeof value.vendor_id !== "string"
    || value.vendor_id.length < 1
    || value.vendor_id.length > 200
    || (value.agency_id !== null
      && (typeof value.agency_id !== "string" || value.agency_id.length > 200))
    || !isMoney(value.base_krw)
    || (value.custom_krw !== null && !isMoney(value.custom_krw))
    || !Array.isArray(value.selected_options)
    || value.selected_options.length > MAX_OPTIONS_PER_SELECTION
  ) return undefined;

  const optionNames = new Set<string>();
  const selectedOptions: Array<{ name: string; krw: number }> = [];
  for (const option of value.selected_options) {
    if (!isRecord(option)
      || typeof option.name !== "string"
      || option.name.trim().length < 1
      || option.name.trim().length > 200
      || !isMoney(option.krw)
    ) return undefined;
    const name = option.name.trim();
    if (optionNames.has(name)) return undefined;
    optionNames.add(name);
    selectedOptions.push({ name, krw: option.krw });
  }

  return {
    vendorId: value.vendor_id,
    agencyId: value.agency_id,
    baseKrw: value.base_krw,
    selectedOptions,
    customKrw: value.custom_krw,
  };
}

export function parseLatestSavedComboPayload(value: unknown): LatestSavedComboParseResult {
  if (!isRecord(value) || !Array.isArray(value.combos) || value.combos.length > 100) {
    return { ok: false };
  }
  if (value.combos.length === 0) return { ok: true, combo: null };

  const latest = value.combos[0];
  if (!isRecord(latest)
    || typeof latest.id !== "string"
    || latest.id.length < 1
    || latest.id.length > 200
    || typeof latest.name !== "string"
    || latest.name.trim().length < 1
    || latest.name.trim().length > 80
    || typeof latest.created_at !== "string"
    || !Number.isFinite(Date.parse(latest.created_at))
    || !isRecord(latest.selections)
  ) return { ok: false };

  const savedSelections = latest.selections;
  const selections = Object.fromEntries(COMBO_CATEGORIES.map((category) => [
    category,
    parseSavedSelection(savedSelections[category]),
  ])) as Record<ComboCategory, SavedSelection | null | undefined>;
  if (COMBO_CATEGORIES.some((category) => selections[category] === undefined)
    || COMBO_CATEGORIES.every((category) => selections[category] === null)
  ) return { ok: false };

  return {
    ok: true,
    combo: {
      id: latest.id,
      name: latest.name.trim(),
      createdAt: latest.created_at,
      selections: selections as Record<ComboCategory, SavedSelection | null>,
    },
  };
}

export function restoreSavedComboAgainstCatalog(
  saved: SavedComboPreview,
  catalog: PriceCatalog,
): {
  selections: ComboSelections;
  restoredCategories: ComboCategory[];
  skippedCategories: ComboCategory[];
} {
  const restoredCategories: ComboCategory[] = [];
  const skippedCategories: ComboCategory[] = [];
  const selections = Object.fromEntries(COMBO_CATEGORIES.map((category) => {
    const savedSelection = saved.selections[category];
    if (!savedSelection) return [category, null];

    const vendor = catalog.categories[category]
      .find((candidate) => candidate.id === savedSelection.vendorId);
    const offer = vendor?.offers.find((candidate) => (
      candidate.agencyId === savedSelection.agencyId
      && candidate.minimumKrw === savedSelection.baseKrw
      && savedSelection.selectedOptions.every((savedOption) => candidate.options.some((option) => (
        option.name === savedOption.name && option.minimumKrw === savedOption.krw
      )))
    ));
    const selectedOptions = offer
      ? savedSelection.selectedOptions.flatMap((savedOption) => {
          const currentOption = offer.options.find((candidate) => (
            candidate.name === savedOption.name
            && candidate.minimumKrw === savedOption.krw
          ));
          return currentOption
            ? [{ name: currentOption.name, krw: currentOption.minimumKrw! }]
            : [];
        })
      : [];
    if (!vendor || !offer || selectedOptions.length !== savedSelection.selectedOptions.length) {
      skippedCategories.push(category);
      return [category, null];
    }

    const selection: ComboSelection = {
      vendorId: vendor.id,
      vendorSlug: vendor.slug,
      vendorName: vendor.name,
      agencyId: offer.agencyId,
      agencyName: offer.agencyName,
      baseKrw: offer.minimumKrw!,
      selectedOptions,
      customKrw: savedSelection.customKrw,
    };
    restoredCategories.push(category);
    return [category, selection];
  })) as ComboSelections;

  return { selections, restoredCategories, skippedCategories };
}

/** 저장된 추가금의 본문만 확인한다. 조회 실패를 가격 변경으로 오인하지 않는다. */
export async function restoreSavedComboWithOptions(
  saved: SavedComboPreview,
  catalog: PriceCatalog,
  loadOptions: (vendor: PriceVendor) => Promise<Map<string, PriceOption[]>>,
) {
  const categories = { ...catalog.categories };
  for (const category of COMBO_CATEGORIES) {
    const selection = saved.selections[category];
    if (!selection || selection.selectedOptions.length === 0) continue;
    const vendor = categories[category].find((candidate) => candidate.id === selection.vendorId);
    if (!vendor) continue;
    const candidates = vendor.offers.filter((offer) => offer.agencyId === selection.agencyId
      && offer.minimumKrw === selection.baseKrw);
    const missing = candidates.filter((offer) => offer.options.length === 0);
    if (missing.length === 0) continue;
    const options = await loadOptions({
      ...vendor,
      offers: missing.map((offer) => ({ ...offer, optionCount: Math.max(offer.optionCount ?? 0, selection.selectedOptions.length) })),
    });
    categories[category] = categories[category].map((candidate) => candidate.id !== vendor.id ? candidate : {
      ...candidate,
      offers: candidate.offers.map((offer) => ({ ...offer, options: options.get(offer.id) ?? offer.options })),
    });
  }
  return restoreSavedComboAgainstCatalog(saved, { ...catalog, categories });
}
