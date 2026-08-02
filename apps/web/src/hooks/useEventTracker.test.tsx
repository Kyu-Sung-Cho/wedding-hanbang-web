import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetLegacyEventTrackerState, usePageViewTracker } from "./useEventTracker";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

function PageViewHarness({ enabled }: { enabled: boolean }) {
  usePageViewTracker(enabled);
  return <div>page</div>;
}

describe("usePageViewTracker suppression", () => {
  let root: Root;
  let container: HTMLDivElement;
  const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
    new Response(null, { status: 200 }));

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-21T00:00:00.000Z"));
    fetchMock.mockClear();
    vi.stubGlobal("fetch", fetchMock);
    resetLegacyEventTrackerState();
    window.history.replaceState({}, "", "/wedding/vendors");
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    document.body.replaceChildren();
    Object.defineProperty(document, "referrer", { configurable: true, value: "" });
    resetLegacyEventTrackerState();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  async function render(enabled: boolean) {
    await act(async () => {
      root.render(<PageViewHarness enabled={enabled} />);
      await Promise.resolve();
    });
  }

  it("resumes the ordinary page-view write after a same-path preview suppression", async () => {
    await render(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await render(false);
    vi.advanceTimersByTime(6_000);
    await render(true);

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("uses a UUID session without browser storage or a full referrer URL", async () => {
    const storageSpy = vi.spyOn(Storage.prototype, "setItem");
    Object.defineProperty(document, "referrer", {
      configurable: true,
      value: "https://example.com/private?email=user@example.com",
    });

    await render(true);

    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const payload = JSON.parse(String(request.body));
    expect(payload.sessionId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(JSON.stringify(payload)).not.toContain("user@example.com");
    expect(storageSpy).not.toHaveBeenCalled();
  });
});
