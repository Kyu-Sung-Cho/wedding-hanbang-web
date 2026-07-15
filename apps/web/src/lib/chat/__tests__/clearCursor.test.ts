import { describe, expect, it } from "vitest";
import { resolveMonotonicSharedClearCursor } from "../clearCursor";

describe("resolveMonotonicSharedClearCursor", () => {
  it("prefers the RPC-authored cursor over the request creation time", () => {
    expect(resolveMonotonicSharedClearCursor({
      currentClearedAt: "2026-07-14T10:00:00.000Z",
      rpcClearedAt: "2026-07-14T12:00:00.000Z",
      requestCreatedAt: "2026-07-14T09:00:00.000Z",
    })).toBe("2026-07-14T12:00:00.000Z");
  });

  it("does not let a late realtime update move the cursor backwards", () => {
    expect(resolveMonotonicSharedClearCursor({
      currentClearedAt: "2026-07-14T13:00:00.000Z",
      rpcClearedAt: "2026-07-14T12:00:00.000Z",
      requestCreatedAt: "2026-07-14T09:00:00.000Z",
    })).toBe("2026-07-14T13:00:00.000Z");
  });

  it("supports legacy accepted rows without an RPC cursor", () => {
    expect(resolveMonotonicSharedClearCursor({
      currentClearedAt: "1970-01-01T00:00:00.000Z",
      requestCreatedAt: "2026-07-14T09:00:00.000Z",
    })).toBe("2026-07-14T09:00:00.000Z");
  });

  it("ignores a malformed RPC cursor", () => {
    expect(resolveMonotonicSharedClearCursor({
      currentClearedAt: "2026-07-14T08:00:00.000Z",
      rpcClearedAt: "not-a-date",
      requestCreatedAt: "2026-07-14T09:00:00.000Z",
    })).toBe("2026-07-14T09:00:00.000Z");
  });
});
