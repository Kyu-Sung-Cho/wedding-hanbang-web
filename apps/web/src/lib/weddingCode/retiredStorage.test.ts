import { describe, expect, it, vi } from "vitest";

import {
  clearRetiredWeddingCodeStorage,
  RETIRED_WEDDING_CODE_RESULT_STORAGE_KEY,
} from "./retiredStorage";

describe("retired WeddingCode storage", () => {
  it("removes the legacy answer snapshot", () => {
    const removeItem = vi.fn();
    clearRetiredWeddingCodeStorage({ removeItem });
    expect(removeItem).toHaveBeenCalledWith(RETIRED_WEDDING_CODE_RESULT_STORAGE_KEY);
  });

  it("never blocks an identity transition when storage is unavailable", () => {
    expect(() => clearRetiredWeddingCodeStorage({
      removeItem: () => { throw new Error("storage denied"); },
    })).not.toThrow();
  });
});
