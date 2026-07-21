import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { usePageViewTracker } from "./useEventTracker";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

function PageViewHarness({ enabled }: { enabled: boolean }) {
  usePageViewTracker(enabled);
  return <div>page</div>;
}

describe("usePageViewTracker suppression", () => {
  let root: Root;
  let container: HTMLDivElement;
  const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-21T00:00:00.000Z"));
    fetchMock.mockClear();
    vi.stubGlobal("fetch", fetchMock);
    window.history.replaceState({}, "", "/wedding/vendors");
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
});
