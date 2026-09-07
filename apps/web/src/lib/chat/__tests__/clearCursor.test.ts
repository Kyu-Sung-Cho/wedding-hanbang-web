import { describe, expect, it } from "vitest";
import { compareChatTimestamps } from "@hanbang/shared";
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

  it("preserves the later microsecond cursor when acknowledgements share a millisecond", () => {
    expect(resolveMonotonicSharedClearCursor({
      currentClearedAt: "2026-07-14T13:00:00.123900Z",
      rpcClearedAt: "2026-07-14T13:00:00.123100Z",
      requestCreatedAt: "2026-07-14T12:00:00.000Z",
    })).toBe("2026-07-14T13:00:00.123900Z");
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

describe("compareChatTimestamps", () => {
  it.each([
    ["2026-07-14T13:00:00.123100Z", "2026-07-14T13:00:00.123900Z", -1],
    ["2026-07-14T13:00:00.1239Z", "2026-07-14T13:00:00.123100Z", 1],
    ["2026-07-14T13:00:00.123Z", "2026-07-14T13:00:00.123000+00:00", 0],
    ["2026-07-14T22:00:00.123900+09:00", "2026-07-14T13:00:00.123100Z", 1],
    ["2026-07-14T22:00:00.123900+0900", "2026-07-14T13:00:00.123900Z", 0],
    ["1969-12-31T23:59:59.999100Z", "1969-12-31T23:59:59.999900Z", -1],
    ["2026-07-14T13:00:00.124Z", "2026-07-14T13:00:00.123900Z", 1],
    ["2026-07-14T13:00:00Z", "2026-07-14T13:00:00.000001Z", -1],
  ])("compares %s with %s using the database precision", (left, right, expected) => {
    expect(compareChatTimestamps(left, right)).toBe(expected);
  });

  it.each([["invalid", "2026-07-14T13:00:00Z"], ["2026-07-14T13:00:00Z", ""]])(
    "rejects a malformed boundary: %s / %s", (left, right) => {
      expect(compareChatTimestamps(left, right)).toBeNull();
    },
  );
});
