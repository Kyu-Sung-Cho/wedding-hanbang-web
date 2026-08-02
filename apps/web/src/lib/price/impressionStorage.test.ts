import { describe, expect, it } from "vitest";

import {
  clearPriceImpressionClientState,
  hasPriceImpression,
  markPriceImpression,
  priceImpressionStorageKey,
} from "./impressionStorage";

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(key); },
    setItem: (key, value) => { values.set(key, value); },
  };
}

describe("price impression storage", () => {
  it("does not reuse account A's impression for account B", () => {
    const storage = memoryStorage();
    markPriceImpression("user:a", "vendor-1", storage);

    expect(hasPriceImpression("user:a", "vendor-1", storage)).toBe(true);
    expect(hasPriceImpression("user:b", "vendor-1", storage)).toBe(false);
    expect(priceImpressionStorageKey("user:a", "vendor-1"))
      .not.toBe(priceImpressionStorageKey("user:b", "vendor-1"));
  });

  it("purges the departing actor and every legacy account-unbound key", () => {
    const storage = memoryStorage();
    storage.setItem("hb-price-impression:legacy-vendor", "1");
    markPriceImpression("user:a", "vendor-a", storage);
    markPriceImpression("user:b", "vendor-b", storage);

    clearPriceImpressionClientState("user:a", storage);

    expect(storage.getItem("hb-price-impression:legacy-vendor")).toBeNull();
    expect(hasPriceImpression("user:a", "vendor-a", storage)).toBe(false);
    expect(hasPriceImpression("user:b", "vendor-b", storage)).toBe(true);
  });
});
