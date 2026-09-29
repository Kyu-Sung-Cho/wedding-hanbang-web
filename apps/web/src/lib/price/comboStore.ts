import { createStore, type StoreApi } from "zustand/vanilla";
import { isUuid } from "@/utils/requestValidation";

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
  ownerId: string | null | undefined;
  setOwner(ownerId: string | null | undefined): void;
  selections: ComboSelections;
  totalKrw: number;
  setSelection(category: ComboCategory, selection: ComboSelection): void;
  replaceSelections(selections: ComboSelections): void;
  clearSelection(category: ComboCategory): void;
  hydrate(storage?: SessionStorageLike, ownerId?: string | null): void;
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

function parseSelections(value: unknown): ComboSelections | null {
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
  let activeOwner: string | null | undefined;
  const removePersisted = () => {
    try { activeStorage?.removeItem(PRICE_COMBO_STORAGE_KEY); } catch { /* 저장소 차단은 비교를 막지 않는다. */ }
  };
  const persist = (selections: ComboSelections) => {
    if (activeOwner === undefined) return;
    try {
      activeStorage?.setItem(PRICE_COMBO_STORAGE_KEY, JSON.stringify({ selections, ownerId: activeOwner }));
    } catch {
      // Session persistence is best effort and must never block price comparison.
    }
  };
  return createStore<PriceComboState>((set) => ({
    ownerId: undefined,
    setOwner(ownerId) {
      activeOwner = ownerId;
      set({ ownerId });
    },
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
    hydrate(storage, ownerId) {
      if (storage) activeStorage = storage;
      if (!activeStorage) return;
      try {
        const raw = activeStorage.getItem(PRICE_COMBO_STORAGE_KEY);
        activeOwner = ownerId;
        set({ ownerId });
        if (!raw) {
          set({ selections: { ...EMPTY_SELECTIONS }, totalKrw: 0 });
          return;
        }
        const parsed = JSON.parse(raw) as unknown;
        const selections = isRecord(parsed) ? parseSelections(parsed.selections) : null;
        if (!selections || !isRecord(parsed) || !(parsed.ownerId === null || isUuid(parsed.ownerId))) {
          removePersisted();
          set({ selections: { ...EMPTY_SELECTIONS }, totalKrw: 0 });
          return;
        }
        const storedOwner = parsed.ownerId;
        // 계정을 확인하기 전에는 개인 초안을 노출하지 않고 같은 계정 확인 후 복원한다.
        if (storedOwner && storedOwner !== ownerId) {
          if (ownerId !== undefined) removePersisted();
          set({ selections: { ...EMPTY_SELECTIONS }, totalKrw: 0 });
          return;
        }
        activeOwner = ownerId === undefined ? storedOwner : ownerId;
        if (ownerId !== undefined) persist(selections);
        set({ selections, totalKrw: total(selections), ownerId: activeOwner });
      } catch {
        removePersisted();
        set({ selections: { ...EMPTY_SELECTIONS }, totalKrw: 0 });
      }
    },
    reset() {
      activeOwner = undefined;
      removePersisted();
      set({ selections: { ...EMPTY_SELECTIONS }, totalKrw: 0, ownerId: undefined });
    },
  }));
}
