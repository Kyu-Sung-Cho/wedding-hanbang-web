import { describe, expect, it } from "vitest";

import { createPriceComboStore, type ComboSelection } from "./comboStore";

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
});
