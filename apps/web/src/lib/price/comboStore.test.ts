import { describe, expect, it } from "vitest";

import { createPriceComboStore, type ComboSelection } from "./comboStore";
const OWNER_A = "40000000-0000-4000-8000-000000000001";
const OWNER_B = "40000000-0000-4000-8000-000000000002";

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
    first.getState().setOwner(null);
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
    store.getState().setOwner(null);

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

  it("withholds a private draft until its owner is confirmed and clears it for another owner", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
      removeItem: (key: string) => { values.delete(key); },
    };
    const first = createPriceComboStore(storage);
    first.getState().hydrate(storage, OWNER_A);
    first.getState().setSelection("studio", selection("private-studio", 100));
    const remounted = createPriceComboStore(storage);
    remounted.getState().hydrate();
    expect(remounted.getState().selections.studio).toBeNull();
    remounted.getState().hydrate(storage, OWNER_A);
    expect(remounted.getState().selections.studio?.vendorId).toBe("private-studio");
    remounted.getState().hydrate(storage, OWNER_B);
    expect(remounted.getState().selections.studio).toBeNull();
    expect(values.size).toBe(0);
  });

  it("keeps an anonymous draft when its user signs in and binds subsequent saves to that owner", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
      removeItem: (key: string) => { values.delete(key); },
    };
    const store = createPriceComboStore(storage);
    store.getState().setOwner(null);
    store.getState().setSelection("studio", selection("guest-choice", 100));
    store.getState().hydrate(storage, OWNER_A);
    expect(store.getState().selections.studio?.vendorId).toBe("guest-choice");
    expect(JSON.parse(values.get("hanbang-price-combo-v1") ?? "{}").ownerId).toBe(OWNER_A);
    store.getState().hydrate(storage, null);
    expect(store.getState().totalKrw).toBe(0);
  });

  it("keeps unverified choices in memory and never persists them as anonymous", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
      removeItem: (key: string) => { values.delete(key); },
    };
    const store = createPriceComboStore(storage);
    store.getState().setSelection("studio", selection("unverified", 100));
    expect(store.getState().totalKrw).toBe(100_100);
    expect(values.size).toBe(0);
    store.getState().setOwner(OWNER_A);
    store.getState().setSelection("studio", selection("known-a-with-api-outage", 100));
    expect(JSON.parse(values.get("hanbang-price-combo-v1") ?? "{}").ownerId).toBe(OWNER_A);
    const other = createPriceComboStore(storage);
    other.getState().hydrate();
    expect(other.getState().totalKrw).toBe(0);
    other.getState().hydrate(storage, OWNER_B);
    expect(other.getState().totalKrw).toBe(0);
  });

  it.each([undefined, "", "invalid"])("discards legacy or invalid owner %s instead of assuming a guest", (ownerId) => {
    let removed = false;
    const store = createPriceComboStore({
      getItem: () => JSON.stringify({ ownerId, selections: { studio: selection("legacy", 100), dress: null, makeup: null } }),
      setItem: () => undefined,
      removeItem: () => { removed = true; },
    });
    store.getState().hydrate();
    expect(store.getState().totalKrw).toBe(0);
    expect(removed).toBe(true);
  });

  it("does not throw or keep stale choices when both storage reads and removal are blocked", () => {
    const blocked = () => { throw new Error("storage blocked"); };
    const store = createPriceComboStore({ getItem: blocked, setItem: blocked, removeItem: blocked });
    store.getState().setSelection("studio", selection("stale", 100));
    expect(() => store.getState().hydrate()).not.toThrow();
    expect(store.getState().totalKrw).toBe(0);
    expect(() => store.getState().reset()).not.toThrow();
  });
});
