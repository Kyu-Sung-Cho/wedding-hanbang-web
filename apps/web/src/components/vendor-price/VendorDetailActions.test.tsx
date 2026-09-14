// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import VendorDetailActions from "./VendorDetailActions";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/lib/analytics/track", () => ({
  track: vi.fn(),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function flushAsyncWork() {
  await new Promise((resolve) => window.setTimeout(resolve, 0));
  await Promise.resolve();
}

describe("VendorDetailActions", () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await act(async () => root.unmount());
    document.body.replaceChildren();
  });

  it("keeps actions disabled until their initial saved state is settled", async () => {
    const favorites = deferred<Response>();
    const fetchMock = vi.fn().mockReturnValueOnce(favorites.promise);
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root.render(<VendorDetailActions vendorId="vendor-1" redirectPath="/price/studio/sample" />);
      await Promise.resolve();
    });

    // 찜 하나뿐이다 — 가격변동 알림 토글은 알림을 보내는 쪽이 생길 때까지 그리지 않는다.
    const actionButtons = Array.from(container.querySelectorAll<HTMLButtonElement>("button[aria-pressed]"));
    expect(actionButtons).toHaveLength(1);
    expect(actionButtons.every((button) => button.disabled)).toBe(true);

    await act(async () => {
      favorites.resolve(jsonResponse({ vendorIds: ["vendor-1"] }));
      await flushAsyncWork();
    });

    expect(actionButtons.every((button) => button.disabled)).toBe(false);
    expect(actionButtons[0].getAttribute("aria-pressed")).toBe("true");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("ignores a previous vendor's late initial response", async () => {
    const oldFavoriteBody = deferred<{ vendorIds: string[] }>();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: () => oldFavoriteBody.promise })
      .mockResolvedValueOnce(jsonResponse({ vendorIds: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root.render(<VendorDetailActions vendorId="vendor-old" redirectPath="/price/studio/old" />);
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      root.render(<VendorDetailActions vendorId="vendor-new" redirectPath="/price/studio/new" />);
      await flushAsyncWork();
    });

    const favoriteButton = container.querySelector<HTMLButtonElement>('button[aria-pressed]');
    expect(favoriteButton?.getAttribute("aria-pressed")).toBe("false");

    await act(async () => {
      oldFavoriteBody.resolve({ vendorIds: ["vendor-old"] });
      await flushAsyncWork();
    });

    expect(favoriteButton?.getAttribute("aria-pressed")).toBe("false");
  });

  it("allows only one in-flight mutation and disables the action while it settles", async () => {
    const mutation = deferred<Response>();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ vendorIds: [] }))
      .mockReturnValue(mutation.promise);
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root.render(<VendorDetailActions vendorId="vendor-1" redirectPath="/price/studio/sample" />);
      await flushAsyncWork();
    });

    const actionButtons = Array.from(container.querySelectorAll<HTMLButtonElement>("button[aria-pressed]"));
    await act(async () => {
      actionButtons[0].click();
      actionButtons[0].click();
      await Promise.resolve();
    });

    const postCalls = fetchMock.mock.calls.filter(([, init]) => (
      (init as RequestInit | undefined)?.method === "POST"
    ));
    expect(postCalls).toHaveLength(1);
    expect(actionButtons.every((button) => button.disabled)).toBe(true);

    await act(async () => {
      mutation.resolve(jsonResponse({ isFavorite: true }));
      await flushAsyncWork();
    });

    expect(actionButtons.every((button) => button.disabled)).toBe(false);
    expect(actionButtons[0].getAttribute("aria-pressed")).toBe("true");
  });

  it("uses deterministic add and remove methods instead of a retry-sensitive toggle", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ vendorIds: [] }))
      .mockResolvedValueOnce(jsonResponse({ isFavorite: true }))
      .mockResolvedValueOnce(jsonResponse({ isFavorite: false }));
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root.render(<VendorDetailActions vendorId="vendor-1" redirectPath="/price/vendor/sample" />);
      await flushAsyncWork();
    });

    const favoriteButton = container.querySelector<HTMLButtonElement>('button[aria-pressed]');
    await act(async () => {
      favoriteButton?.click();
      await flushAsyncWork();
    });
    await act(async () => {
      favoriteButton?.click();
      await flushAsyncWork();
    });

    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({ method: "POST" });
    expect(fetchMock.mock.calls[2]?.[1]).toMatchObject({ method: "DELETE" });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(favoriteButton?.getAttribute("aria-pressed")).toBe("false");
  });

  it("shows a recoverable message when the initial saved state cannot be loaded", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ error: "unavailable" }, 503))
      .mockResolvedValueOnce(jsonResponse({ vendorIds: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root.render(<VendorDetailActions vendorId="vendor-1" redirectPath="/price/studio/sample" />);
      await flushAsyncWork();
    });

    expect(container.querySelector('[role="alert"]')?.textContent).toContain("찜 상태");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("기존 저장은 변경하지 않았어요");
    const actionButtons = Array.from(container.querySelectorAll<HTMLButtonElement>("button[aria-pressed]"));
    expect(actionButtons).toHaveLength(1);
    expect(actionButtons[0].disabled).toBe(true);

    const retryButton = Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent?.includes("다시 불러오기"));
    await act(async () => {
      retryButton?.click();
      await flushAsyncWork();
    });

    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(actionButtons.every((button) => button.disabled)).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("shows which action failed when a mutation API rejects the save", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ vendorIds: [] }))
      .mockResolvedValueOnce(jsonResponse({ error: "write failed" }, 500));
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root.render(<VendorDetailActions vendorId="vendor-1" redirectPath="/price/studio/sample" />);
      await flushAsyncWork();
    });

    const favoriteButton = container.querySelector<HTMLButtonElement>('button[aria-pressed]');
    await act(async () => {
      favoriteButton?.click();
      await flushAsyncWork();
    });

    expect(container.querySelector('[role="alert"]')?.textContent).toContain("찜 저장");
    expect(favoriteButton?.disabled).toBe(false);
  });

  it("does not apply a late mutation result to a different vendor", async () => {
    const oldMutation = deferred<Response>();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ vendorIds: [] }))
      .mockReturnValueOnce(oldMutation.promise)
      .mockResolvedValueOnce(jsonResponse({ vendorIds: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root.render(<VendorDetailActions vendorId="vendor-old" redirectPath="/price/studio/old" />);
      await flushAsyncWork();
    });
    const favoriteButton = container.querySelector<HTMLButtonElement>('button[aria-pressed]');
    await act(async () => {
      favoriteButton?.click();
      await Promise.resolve();
    });

    await act(async () => {
      root.render(<VendorDetailActions vendorId="vendor-new" redirectPath="/price/studio/new" />);
      await flushAsyncWork();
    });
    expect(favoriteButton?.getAttribute("aria-pressed")).toBe("false");

    await act(async () => {
      oldMutation.resolve(jsonResponse({ isFavorite: true }));
      await flushAsyncWork();
    });

    expect(favoriteButton?.getAttribute("aria-pressed")).toBe("false");
  });

  it("does not offer a price-change alert toggle and never reads price alerts", async () => {
    // 2026-09-14: /api/price/alerts 는 price_alerts 행을 넣고 뺄 뿐, 그 행을 읽어
    // 알림을 보내는 코드가 저장소에 없다. 토글을 그리면 공개 업체 상세가 없는
    // 알림을 약속한다. 알림을 보내는 쪽이 생기기 전까지 토글도, 그 상태 조회도 없다.
    const fetchMock = vi.fn().mockImplementation(async () => jsonResponse({ vendorIds: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root.render(<VendorDetailActions vendorId="vendor-1" redirectPath="/price/studio/sample" />);
      await flushAsyncWork();
    });

    const labels = Array.from(container.querySelectorAll("button")).map((button) => button.textContent ?? "");
    expect(labels).toContain("찜하기");
    expect(labels.filter((label) => label.includes("알림"))).toEqual([]);
    expect(container.textContent).not.toContain("가격 알림");
    expect(fetchMock.mock.calls.map(([url]) => String(url))).not.toContain("/api/price/alerts");
  });
});
