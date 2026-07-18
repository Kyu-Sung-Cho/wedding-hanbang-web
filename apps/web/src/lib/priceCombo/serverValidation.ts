import { isUuid } from "@/utils/requestValidation";

export const COMBO_CATEGORIES = ["studio", "dress", "makeup"] as const;
export type ComboCategory = (typeof COMBO_CATEGORIES)[number];

const MAX_MONEY_KRW = 1_000_000_000;
const MAX_TOTAL_KRW = 2_147_483_647;
const MAX_OPTIONS_PER_SELECTION = 50;

export type ComboOptionInput = Readonly<{
  name: string;
  krw: number;
}>;

export type ComboSelectionInput = Readonly<{
  vendor_id: string;
  agency_id: string | null;
  base_krw: number;
  selected_options: ReadonlyArray<ComboOptionInput>;
  custom_krw: number | null;
}>;

export type ComboSelectionsInput = Readonly<Record<
  ComboCategory,
  ComboSelectionInput | null
>>;

export type ParsedComboSaveBody = {
  name: string;
  selections: ComboSelectionsInput;
};

export type PublicComboPrice = Readonly<{
  official_price_id: string;
  vendor_id: string;
  category: string;
  agency_id: string | null;
  price_min_krw: number | null;
}>;

export type PublicComboOption = Readonly<{
  official_price_id: string;
  name: string;
  price_min_krw: number | null;
}>;

type RepricedSelection = {
  vendor_id: string;
  agency_id: string | null;
  base_krw: number;
  selected_options: Array<{ name: string; krw: number }>;
  custom_krw: number | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const allowedKeys = new Set(allowed);
  return Object.keys(value).every((key) => allowedKeys.has(key));
}

function isMoney(value: unknown): value is number {
  return typeof value === "number"
    && Number.isSafeInteger(value)
    && value >= 0
    && value <= MAX_MONEY_KRW;
}

function parseSelection(value: unknown): ComboSelectionInput | null | undefined {
  if (value === null) return null;
  if (!isRecord(value) || !hasOnlyKeys(value, [
    "vendor_id",
    "agency_id",
    "base_krw",
    "selected_options",
    "custom_krw",
  ])) return undefined;

  if (!isUuid(value.vendor_id)
    || (value.agency_id !== null && !isUuid(value.agency_id))
    || !isMoney(value.base_krw)
    || (value.custom_krw !== null && !isMoney(value.custom_krw))
    || !Array.isArray(value.selected_options)
    || value.selected_options.length > MAX_OPTIONS_PER_SELECTION
  ) return undefined;

  const selectedOptions: Array<{ name: string; krw: number }> = [];
  const optionNames = new Set<string>();
  for (const option of value.selected_options) {
    if (!isRecord(option)
      || !hasOnlyKeys(option, ["name", "krw"])
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
    vendor_id: value.vendor_id,
    agency_id: value.agency_id,
    base_krw: value.base_krw,
    selected_options: selectedOptions,
    custom_krw: value.custom_krw,
  };
}

export function parseComboSaveBody(value: unknown): ParsedComboSaveBody | null {
  if (!isRecord(value) || !hasOnlyKeys(value, ["name", "selections"])) return null;
  const name = value.name === undefined ? "내 조합" : value.name;
  if (typeof name !== "string" || name.trim().length < 1 || name.trim().length > 80) {
    return null;
  }
  const selectionsValue = value.selections;
  if (!isRecord(selectionsValue)
    || !hasOnlyKeys(selectionsValue, COMBO_CATEGORIES)
    || !COMBO_CATEGORIES.every((category) => category in selectionsValue)
  ) return null;

  const selections = Object.fromEntries(COMBO_CATEGORIES.map((category) => [
    category,
    parseSelection(selectionsValue[category]),
  ])) as Record<ComboCategory, ComboSelectionInput | null | undefined>;

  if (COMBO_CATEGORIES.some((category) => selections[category] === undefined)
    || COMBO_CATEGORIES.every((category) => selections[category] === null)
  ) return null;

  return {
    name: name.trim(),
    selections: selections as ComboSelectionsInput,
  };
}

function repricedSelection(
  category: ComboCategory,
  selection: ComboSelectionInput,
  prices: ReadonlyArray<PublicComboPrice>,
  options: ReadonlyArray<PublicComboOption>,
): RepricedSelection {
  const vendorPrices = prices.filter((price) => (
    price.vendor_id === selection.vendor_id
    && price.category === category
    && (selection.agency_id === null || price.agency_id === selection.agency_id)
    && isMoney(price.price_min_krw)
  ));

  const selectedPrice = selection.custom_krw === null
    ? vendorPrices.find((price) => price.price_min_krw === selection.base_krw)
    : vendorPrices.toSorted((left, right) => left.price_min_krw! - right.price_min_krw!)[0];
  if (!selectedPrice) throw new Error("COMBO_PUBLIC_PRICE_NOT_FOUND");

  const allowedPriceIds = new Set(vendorPrices.map((price) => price.official_price_id));
  const selectedOptions = selection.selected_options.map(({ name }) => {
    const publicOption = options
      .filter((option) => (
        allowedPriceIds.has(option.official_price_id)
        && option.name === name
        && isMoney(option.price_min_krw)
      ))
      .toSorted((left, right) => left.price_min_krw! - right.price_min_krw!)[0];
    if (!publicOption) throw new Error("COMBO_PUBLIC_OPTION_NOT_FOUND");
    return { name: publicOption.name, krw: publicOption.price_min_krw! };
  });

  return {
    vendor_id: selection.vendor_id,
    agency_id: selection.agency_id,
    base_krw: selectedPrice.price_min_krw!,
    selected_options: selectedOptions,
    custom_krw: selection.custom_krw,
  };
}

export function repriceComboSelections(
  selections: ComboSelectionsInput,
  catalog: Readonly<{
    prices: ReadonlyArray<PublicComboPrice>;
    options: ReadonlyArray<PublicComboOption>;
  }>,
): {
  selections: Record<ComboCategory, RepricedSelection | null>;
  totalKrw: number;
} {
  const repriced = Object.fromEntries(COMBO_CATEGORIES.map((category) => {
    const selection = selections[category];
    return [
      category,
      selection ? repricedSelection(category, selection, catalog.prices, catalog.options) : null,
    ];
  })) as Record<ComboCategory, RepricedSelection | null>;

  const totalKrw = COMBO_CATEGORIES.reduce((total, category) => {
    const selection = repriced[category];
    if (!selection) return total;
    return total
      + (selection.custom_krw ?? selection.base_krw)
      + selection.selected_options.reduce((sum, option) => sum + option.krw, 0);
  }, 0);
  if (!Number.isSafeInteger(totalKrw) || totalKrw > MAX_TOTAL_KRW) {
    throw new Error("COMBO_TOTAL_OUT_OF_RANGE");
  }

  return { selections: repriced, totalKrw };
}
