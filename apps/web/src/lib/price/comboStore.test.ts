import { describe, expect, it } from "vitest";

import {
  clearPriceComboClientState,
  createPriceComboStore,
  PRICE_COMBO_STORAGE_KEY,
  priceComboStorageKey,
  priceComboStore,
  type ComboSelection,
} from "./comboStore";

function selection(vendorId: string, baseKrw: number): ComboSelection {
  return {
    vendorId,
    vendorSlug: `sample-${vendorId}`,
    vendorName: `샘플 업체 ${vendorId}`,
    agencyId: null,
    agencyName: "직접 입력",
    baseKrw,
    selectedOptions: [{ name: "샘플 추가 옵션", krw: 100_000 }],
    customKrw: null,
  };
}

describe("createPriceComboStore", () => {
  it("keeps one selection per category and includes selected options in the live total", () => {
    const store = createPriceComboStore();
    store.getState().setSelection("studio", selection("studio-1", 1_200_000));
    store.getState().setSelection("dress", selection("dress-1", 900_000));

    expect(store.getState().selections.studio?.vendorId).toBe("studio-1");
    expect(store.getState().selections.dress?.vendorId).toBe("dress-1");
    expect(store.getState().totalKrw).toBe(2_300_000);

    store.getState().clearSelection("studio");
    expect(store.getState().totalKrw).toBe(1_000_000);
  });

  it("restores a valid combination from session storage and ignores malformed state", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
      removeItem: (key: string) => { values.delete(key); },
    };
    const first = createPriceComboStore(storage);
    first.getState().setSelection("makeup", selection("makeup-1", 500_000));

    const restored = createPriceComboStore(storage);
    restored.getState().hydrate();
    expect(restored.getState().selections.makeup?.vendorId).toBe("makeup-1");
    expect(restored.getState().totalKrw).toBe(600_000);

    values.set("hanbang-price-combo-v1", "{broken");
    const malformed = createPriceComboStore(storage);
    malformed.getState().hydrate();
    expect(malformed.getState().totalKrw).toBe(0);
  });

  it("replaces a restored combination atomically and persists only the final state", () => {
    const writes: string[] = [];
    const storage = {
      getItem: () => null,
      setItem: (_key: string, value: string) => { writes.push(value); },
      removeItem: () => undefined,
    };
    const store = createPriceComboStore(storage);

    store.getState().replaceSelections({
      studio: selection("studio-restored", 1_200_000),
      dress: selection("dress-restored", 900_000),
      makeup: null,
    });

    expect(store.getState().totalKrw).toBe(2_300_000);
    expect(store.getState().selections.studio?.vendorId).toBe("studio-restored");
    expect(writes).toHaveLength(1);
    expect(JSON.parse(writes[0])).toMatchObject({
      selections: {
        studio: { vendorId: "studio-restored" },
        dress: { vendorId: "dress-restored" },
        makeup: null,
      },
    });
  });

  it("purges tab storage and singleton values at an account boundary", () => {
    const actorStorageKey = priceComboStorageKey("user:a");
    const values = new Map([
      [PRICE_COMBO_STORAGE_KEY, "legacy private combo"],
      [actorStorageKey, "private account A combo"],
    ]);
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
      removeItem: (key: string) => { values.delete(key); },
    };
    priceComboStore.getState().setSelection("studio", selection("account-a", 2_000_000));

    clearPriceComboClientState(storage, "user:a");

    expect(priceComboStore.getState().totalKrw).toBe(0);
    expect(priceComboStore.getState().selections.studio).toBeNull();
    expect(values.has(PRICE_COMBO_STORAGE_KEY)).toBe(false);
    expect(values.has(actorStorageKey)).toBe(false);
  });

  it("uses a different persistence key for every verified actor", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
      removeItem: (key: string) => { values.delete(key); },
    };
    const store = createPriceComboStore(storage);

    store.getState().hydrate(storage, "user:a");
    store.getState().setSelection("studio", selection("account-a", 2_000_000));
    store.getState().hydrate(storage, "user:b");

    expect(store.getState().selections.studio).toBeNull();
    expect(values.has(priceComboStorageKey("user:a"))).toBe(true);
    expect(values.has(priceComboStorageKey("user:b"))).toBe(false);
  });
});
