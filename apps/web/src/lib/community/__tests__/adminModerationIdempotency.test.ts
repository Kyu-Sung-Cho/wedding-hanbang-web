import { describe, expect, it, vi } from "vitest";
import {
  getOrCreateModerationOperationKey,
  settleModerationOperationKey,
} from "../adminModerationIdempotency";

describe("admin moderation operation identity", () => {
  it("reuses one key for the same command after an unknown failure", () => {
    const keys = new Map<string, string>();
    const createKey = vi.fn()
      .mockReturnValueOnce("00000000-0000-4000-8000-000000000001");
    const fingerprint = "post:1:hide:safety reason";

    const first = getOrCreateModerationOperationKey(keys, fingerprint, createKey);
    const retry = getOrCreateModerationOperationKey(keys, fingerprint, createKey);

    expect(retry).toBe(first);
    expect(createKey).toHaveBeenCalledTimes(1);
  });

  it("retains keys for server-unknown outcomes and clears definitive outcomes", () => {
    const keys = new Map([
      ["server-failure", "00000000-0000-4000-8000-000000000001"],
      ["conflict", "00000000-0000-4000-8000-000000000002"],
      ["success", "00000000-0000-4000-8000-000000000003"],
    ]);

    settleModerationOperationKey(keys, "server-failure", 503);
    settleModerationOperationKey(keys, "conflict", 409);
    settleModerationOperationKey(keys, "success", 200);

    expect(keys.has("server-failure")).toBe(true);
    expect(keys.has("conflict")).toBe(false);
    expect(keys.has("success")).toBe(false);
  });

  it("does not share a key across different command fingerprints", () => {
    const keys = new Map<string, string>();
    const createKey = vi.fn()
      .mockReturnValueOnce("00000000-0000-4000-8000-000000000001")
      .mockReturnValueOnce("00000000-0000-4000-8000-000000000002");

    const hide = getOrCreateModerationOperationKey(
      keys,
      "post:1:hide:safety reason",
      createKey,
    );
    const restore = getOrCreateModerationOperationKey(
      keys,
      "post:1:restore:safety reason",
      createKey,
    );

    expect(restore).not.toBe(hide);
  });
});
