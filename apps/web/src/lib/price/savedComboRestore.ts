import type { PriceCatalog } from "./catalog";
import type {
  ComboCategory,
  ComboSelection,
  ComboSelections,
} from "./comboStore";

const COMBO_CATEGORIES: readonly ComboCategory[] = ["studio", "dress", "makeup"];
const MAX_MONEY_KRW = 1_000_000_000;
const MAX_OPTIONS_PER_SELECTION = 50;

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
