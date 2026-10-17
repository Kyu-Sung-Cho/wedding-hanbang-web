import { createStore, type StoreApi } from "zustand/vanilla";

export type ComboCategory = "studio" | "dress" | "makeup";

export type ComboSelection = {
  vendorId: string;
  vendorSlug: string;
  vendorName: string;
  agencyId: string | null;
  agencyName: string;
  baseKrw: number;
  selectedOptions: Array<{ name: string; krw: number }>;
  customKrw: number | null;
};

export type ComboSelections = Record<ComboCategory, ComboSelection | null>;

export type PriceComboState = {
  selections: ComboSelections;
  totalKrw: number;
  setSelection(category: ComboCategory, selection: ComboSelection): void;
  replaceSelections(selections: ComboSelections): void;
  clearSelection(category: ComboCategory): void;
  hydrate(storage?: SessionStorageLike): void;
  reset(): void;
};

export type SessionStorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export const PRICE_COMBO_STORAGE_KEY = "hanbang-price-combo-v1";

const EMPTY_SELECTIONS: ComboSelections = {
  studio: null,
  dress: null,
  makeup: null,
};

function selectionTotal(selection: ComboSelection | null): number {
  if (!selection) return 0;
  const base = selection.customKrw ?? selection.baseKrw;
  return base + selection.selectedOptions.reduce((sum, option) => sum + option.krw, 0);
}

function total(selections: ComboSelections): number {
  return selectionTotal(selections.studio)
    + selectionTotal(selections.dress)
    + selectionTotal(selections.makeup);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validMoney(value: unknown): value is number {
  return typeof value === "number"
    && Number.isSafeInteger(value)
    && value >= 0
    && value <= 1_000_000_000;
}

function parseSelection(value: unknown): ComboSelection | null | undefined {
  if (value === null) return null;
  if (!isRecord(value)
    || typeof value.vendorId !== "string"
    || typeof value.vendorSlug !== "string"
    || typeof value.vendorName !== "string"
    || (value.agencyId !== null && typeof value.agencyId !== "string")
    || typeof value.agencyName !== "string"
    || !validMoney(value.baseKrw)
    || (value.customKrw !== null && !validMoney(value.customKrw))
    || !Array.isArray(value.selectedOptions)
    || value.selectedOptions.length > 100
  ) return undefined;
  const selectedOptions = value.selectedOptions.flatMap((option) => {
    if (!isRecord(option) || typeof option.name !== "string" || !validMoney(option.krw)) return [];
    return [{ name: option.name.slice(0, 200), krw: option.krw }];
  });
  if (selectedOptions.length !== value.selectedOptions.length) return undefined;
  return {
    vendorId: value.vendorId.slice(0, 200),
    vendorSlug: value.vendorSlug.slice(0, 200),
    vendorName: value.vendorName.slice(0, 300),
    agencyId: value.agencyId === null ? null : value.agencyId.slice(0, 200),
    agencyName: value.agencyName.slice(0, 300),
    baseKrw: value.baseKrw,
    selectedOptions,
    customKrw: value.customKrw,
  };
}

export function parseComboSelections(value: unknown): ComboSelections | null {
  if (!isRecord(value)) return null;
  const studio = parseSelection(value.studio);
  const dress = parseSelection(value.dress);
  const makeup = parseSelection(value.makeup);
  if (studio === undefined || dress === undefined || makeup === undefined) return null;
  return { studio, dress, makeup };
}

export function createPriceComboStore(
  initialStorage?: SessionStorageLike,
): StoreApi<PriceComboState> {
  let activeStorage = initialStorage;
  const persist = (selections: ComboSelections) => {
    try {
      activeStorage?.setItem(PRICE_COMBO_STORAGE_KEY, JSON.stringify({ selections }));
    } catch {
      // Session persistence is best effort and must never block price comparison.
    }
  };
  return createStore<PriceComboState>((set) => ({
    selections: { ...EMPTY_SELECTIONS },
    totalKrw: 0,
    setSelection(category, selection) {
      set((state) => {
        const selections = { ...state.selections, [category]: selection };
        persist(selections);
        return { selections, totalKrw: total(selections) };
      });
    },
    replaceSelections(selections) {
      const next = { ...selections };
      persist(next);
      set({ selections: next, totalKrw: total(next) });
    },
    clearSelection(category) {
      set((state) => {
        const selections = { ...state.selections, [category]: null };
        persist(selections);
        return { selections, totalKrw: total(selections) };
      });
    },
    hydrate(storage) {
      if (storage) activeStorage = storage;
      if (!activeStorage) return;
      try {
        const raw = activeStorage.getItem(PRICE_COMBO_STORAGE_KEY);
        if (!raw) return;
        const parsed = JSON.parse(raw) as unknown;
        const selections = isRecord(parsed) ? parseComboSelections(parsed.selections) : null;
        if (!selections) {
          activeStorage.removeItem(PRICE_COMBO_STORAGE_KEY);
          return;
        }
        set({ selections, totalKrw: total(selections) });
      } catch {
        activeStorage.removeItem(PRICE_COMBO_STORAGE_KEY);
      }
    },
    reset() {
      try {
        activeStorage?.removeItem(PRICE_COMBO_STORAGE_KEY);
      } catch {
        // Session persistence is best effort.
      }
      set({ selections: { ...EMPTY_SELECTIONS }, totalKrw: 0 });
    },
  }));
}
