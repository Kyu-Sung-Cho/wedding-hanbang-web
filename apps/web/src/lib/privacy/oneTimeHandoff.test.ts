import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearOneTimeHandoffs,
  consumeChatHandoff,
  consumeQuotePostHandoff,
  stageChatHandoff,
  stageQuotePostHandoff,
} from "./oneTimeHandoff";

describe("one-time sensitive navigation handoff", () => {
  beforeEach(() => {
    clearOneTimeHandoffs();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-02T00:00:00.000Z"));
  });

  afterEach(() => {
    clearOneTimeHandoffs();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("consumes a chat payload only once without browser storage", () => {
    const storageSpy = vi.spyOn(Storage.prototype, "setItem");
    stageChatHandoff("private quote", "user-a");

    expect(consumeChatHandoff("user-a")).toEqual({ input: "private quote" });
    expect(consumeChatHandoff("user-a")).toBeNull();
    expect(storageSpy).not.toHaveBeenCalled();
  });

  it("destroys a handoff when a different actor attempts to consume it", () => {
    stageQuotePostHandoff(
      { category: "is_normal", title: "quote", body: "private details" },
      "user-a",
    );

    expect(consumeQuotePostHandoff("user-b")).toBeNull();
    expect(consumeQuotePostHandoff("user-a")).toBeNull();
  });

  it("does not treat an unauthenticated source as a wildcard actor", () => {
    stageChatHandoff("private quote", null);
    expect(consumeChatHandoff("user-b")).toBeNull();
  });

  it("expires an unconsumed payload after two minutes", () => {
    stageChatHandoff("private quote", null);
    vi.advanceTimersByTime(2 * 60 * 1000 + 1);
    expect(consumeChatHandoff("user-a")).toBeNull();
  });
});
