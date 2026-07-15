import { describe, expect, it, vi } from "vitest";
import {
  etiquetteChecksStorageKey,
  etiquetteMemosStorageKey,
  readEtiquetteDeviceSnapshot,
  removeLegacyCommunityDraft,
} from "@/lib/userScopedBrowserStorage";

describe("removeLegacyCommunityDraft", () => {
  it("never lets blocked legacy cleanup break the server-backed writer", () => {
    const storage = {
      removeItem: vi.fn(() => {
        throw new DOMException("blocked", "SecurityError");
      }),
    };

    expect(removeLegacyCommunityDraft(storage)).toBe(false);
    expect(storage.removeItem).toHaveBeenCalledWith("community_post_draft");
  });
});

describe("readEtiquetteDeviceSnapshot", () => {
  it("reads one account and part as a single validated snapshot", () => {
    const values = new Map([
      [etiquetteChecksStorageKey("user-1", 2), JSON.stringify(["a", "b"])],
      [etiquetteMemosStorageKey("user-1", 2), JSON.stringify({ a: "메모" })],
    ]);
    const storage = {
      getItem: vi.fn((key: string) => values.get(key) ?? null),
      removeItem: vi.fn(),
    };

    expect(readEtiquetteDeviceSnapshot(storage, "user-1", 2)).toEqual({
      checkedItemIds: ["a", "b"],
      itemMemos: { a: "메모" },
    });
  });

  it("fails closed instead of turning blocked storage into an empty snapshot", () => {
    const storage = {
      getItem: vi.fn(() => {
        throw new DOMException("blocked", "SecurityError");
      }),
      removeItem: vi.fn(),
    };

    expect(() => readEtiquetteDeviceSnapshot(storage, "user-1", 2)).toThrow();
  });

  it("fails closed when stored JSON has an invalid shape", () => {
    const storage = {
      getItem: vi.fn((key: string) =>
        key.startsWith("etiquette_checks") ? JSON.stringify({ a: true }) : "{}"
      ),
      removeItem: vi.fn(),
    };

    expect(() => readEtiquetteDeviceSnapshot(storage, "user-1", 2)).toThrow(
      "체크 기록 형식",
    );
  });
});
