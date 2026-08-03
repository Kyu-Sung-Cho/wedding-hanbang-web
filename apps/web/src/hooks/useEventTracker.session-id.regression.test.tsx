import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { usePageViewTracker } from "./useEventTracker";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

function PageViewHarness() {
  usePageViewTracker();
  return <div>page</div>;
}

describe("event tracker session identifier", () => {
  let root: Root;
  let container: HTMLDivElement;
  let clockMs = new Date("2026-08-03T00:00:00.000Z").getTime();
  const fetchMock = vi.fn<typeof fetch>(
    async () => new Response(null, { status: 200 }),
  );

  beforeEach(() => {
    vi.useFakeTimers();
    clockMs += 6_000;
    vi.setSystemTime(clockMs);
    sessionStorage.clear();
    fetchMock.mockClear();
    vi.stubGlobal("fetch", fetchMock);
    window.history.replaceState({}, "", "/dashboard");
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    document.body.replaceChildren();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  // Regression: authenticated page views were silently rejected by /api/events
  // because the client generated a timestamp-based value while the server requires UUID.
  it("sends the legacy events API a UUID sessionId", async () => {
    await act(async () => {
      root.render(<PageViewHarness />);
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = fetchMock.mock.calls[0]?.[1];
    const body = JSON.parse(String(init?.body)) as { sessionId?: string };
    expect(body.sessionId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it("replaces a session identifier created by the previous client", async () => {
    sessionStorage.setItem("event_session_id", "1785768071039-q97cokq");

    await act(async () => {
      root.render(<PageViewHarness />);
      await Promise.resolve();
    });

    const init = fetchMock.mock.calls[0]?.[1];
    const body = JSON.parse(String(init?.body)) as { sessionId?: string };
    expect(body.sessionId).not.toBe("1785768071039-q97cokq");
    expect(body.sessionId).toBe(sessionStorage.getItem("event_session_id"));
    expect(body.sessionId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });
});
