import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  __resetVendorEventTrackerForTests,
  flushVendorEvents,
  track,
} from "../track";

describe("vendor event client queue", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    __resetVendorEventTrackerForTests();
    document.cookie = "hb_price_anon_id=; Path=/; Max-Age=0";
    sessionStorage.clear();
  });

  afterEach(() => {
    __resetVendorEventTrackerForTests();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("flushes at 20 events and never includes a client weight", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
    for (let index = 0; index < 20; index += 1) {
      track("vendor_impression", {
        vendor_id: "20000000-0000-4000-8000-000000000001",
        surface: "price_list",
        context: { category: "studio" },
      });
    }
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const payload = JSON.parse(String(request.body));
    expect(payload.events).toHaveLength(20);
    expect(payload.events[0]).not.toHaveProperty("weight");
  });

  it("flushes after five seconds and retries a failed request once", async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
    track("page_view", { surface: "price_detail", context: {} });
    await vi.advanceTimersByTimeAsync(5_000);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });

  it("supports an explicit non-blocking flush", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
    track("search", {
      surface: "price_list",
      context: { category: "dress", zero_result: true },
    });
    await flushVendorEvents();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
