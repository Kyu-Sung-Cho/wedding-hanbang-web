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

const actorMock = vi.hoisted(() => ({
  current: {
    status: "ready" as "verifying" | "ready" | "error",
    actorKey: "user:test-a" as string | null,
    kind: "user" as "user" | "guest" | "demo" | "native" | null,
    userId: "test-a" as string | null,
    generation: 1,
  },
}));

vi.mock("@/components/common/UserScopedClientStateBoundary", () => ({
  useUserScopedClientActor: () => actorMock.current,
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
    actorMock.current = {
      status: "ready",
      actorKey: "user:test-a",
      kind: "user",
      userId: "test-a",
      generation: 1,
    };
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
    const alerts = deferred<Response>();
    const fetchMock = vi.fn()
      .mockReturnValueOnce(favorites.promise)
      .mockReturnValueOnce(alerts.promise);
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root.render(<VendorDetailActions vendorId="vendor-1" redirectPath="/price/studio/sample" />);
      await Promise.resolve();
    });

    const actionButtons = Array.from(container.querySelectorAll<HTMLButtonElement>("button[aria-pressed]"));
    expect(actionButtons).toHaveLength(2);
    expect(actionButtons.every((button) => button.disabled)).toBe(true);

    await act(async () => {
      favorites.resolve(jsonResponse({ vendorIds: ["vendor-1"] }));
      alerts.resolve(jsonResponse({ vendorIds: [] }));
      await flushAsyncWork();
    });

    expect(actionButtons.every((button) => button.disabled)).toBe(false);
    expect(actionButtons[0].getAttribute("aria-pressed")).toBe("true");
    expect(actionButtons[1].getAttribute("aria-pressed")).toBe("false");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("ignores a previous vendor's late initial response", async () => {
    const oldFavoriteBody = deferred<{ vendorIds: string[] }>();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: () => oldFavoriteBody.promise })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ vendorIds: [] }) })
      .mockResolvedValueOnce(jsonResponse({ vendorIds: [] }))
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

  it("allows only one in-flight mutation and disables both actions while it settles", async () => {
    const mutation = deferred<Response>();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ vendorIds: [] }))
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
      actionButtons[1].click();
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
      .mockResolvedValueOnce(jsonResponse({ vendorIds: [] }))
      .mockResolvedValueOnce(jsonResponse({ isFavorite: true }))
      .mockResolvedValueOnce(jsonResponse({ isFavorite: false }))
      .mockResolvedValueOnce(jsonResponse({ subscribed: true }))
      .mockResolvedValueOnce(jsonResponse({ subscribed: false }));
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
    const alertButton = container.querySelectorAll<HTMLButtonElement>('button[aria-pressed]')[1];
    await act(async () => {
      alertButton?.click();
      await flushAsyncWork();
    });
    await act(async () => {
      alertButton?.click();
      await flushAsyncWork();
    });

    expect(fetchMock.mock.calls[2]?.[1]).toMatchObject({
      method: "POST",
      headers: expect.objectContaining({ "x-hanbang-expected-actor": "test-a" }),
    });
    expect(fetchMock.mock.calls[3]?.[1]).toMatchObject({
      method: "DELETE",
      headers: expect.objectContaining({ "x-hanbang-expected-actor": "test-a" }),
    });
    expect(fetchMock.mock.calls[4]?.[1]).toMatchObject({
      method: "POST",
      headers: expect.objectContaining({ "x-hanbang-expected-actor": "test-a" }),
    });
    expect(fetchMock.mock.calls[5]?.[1]).toMatchObject({
      method: "DELETE",
      headers: expect.objectContaining({ "x-hanbang-expected-actor": "test-a" }),
    });
    expect(favoriteButton?.getAttribute("aria-pressed")).toBe("false");
    expect(alertButton?.getAttribute("aria-pressed")).toBe("false");
  });

  it("shows a recoverable message when the initial saved state cannot be loaded", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ error: "unavailable" }, 503))
      .mockResolvedValueOnce(jsonResponse({ vendorIds: [] }))
      .mockResolvedValueOnce(jsonResponse({ vendorIds: [] }))
      .mockResolvedValueOnce(jsonResponse({ vendorIds: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root.render(<VendorDetailActions vendorId="vendor-1" redirectPath="/price/studio/sample" />);
      await flushAsyncWork();
    });

    expect(container.querySelector('[role="alert"]')?.textContent).toContain("찜 상태");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("기존 저장은 변경하지 않았어요");
    const actionButtons = Array.from(container.querySelectorAll<HTMLButtonElement>("button[aria-pressed]"));
    expect(actionButtons[0].disabled).toBe(true);
    expect(actionButtons[1].disabled).toBe(false);

    const retryButton = Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent?.includes("다시 불러오기"));
    await act(async () => {
      retryButton?.click();
      await flushAsyncWork();
    });

    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(actionButtons.every((button) => button.disabled)).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("shows which action failed when a mutation API rejects the save", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ vendorIds: [] }))
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
      .mockResolvedValueOnce(jsonResponse({ vendorIds: [] }))
      .mockReturnValueOnce(oldMutation.promise)
      .mockResolvedValueOnce(jsonResponse({ vendorIds: [] }))
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

  it("aborts and drops account A's saved-state response after account B becomes active", async () => {
    const accountABody = deferred<{ vendorIds: string[] }>();
    let accountASignal: AbortSignal | undefined;
    const fetchMock = vi.fn()
      .mockImplementationOnce((_input: string | URL | Request, init?: RequestInit) => {
        accountASignal = init?.signal as AbortSignal | undefined;
        return Promise.resolve({ ok: true, status: 200, json: () => accountABody.promise });
      })
      .mockResolvedValueOnce(jsonResponse({ vendorIds: [] }))
      .mockResolvedValueOnce(jsonResponse({ vendorIds: [] }))
      .mockResolvedValueOnce(jsonResponse({ vendorIds: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root.render(<VendorDetailActions vendorId="vendor-1" redirectPath="/price/studio/sample" />);
      await Promise.resolve();
      await Promise.resolve();
    });

    actorMock.current = {
      status: "ready",
      actorKey: "user:test-b",
      kind: "user",
      userId: "test-b",
      generation: 2,
    };
    await act(async () => {
      root.render(<VendorDetailActions vendorId="vendor-1" redirectPath="/price/studio/sample" />);
      await flushAsyncWork();
    });

    const favoriteButton = container.querySelector<HTMLButtonElement>('button[aria-pressed]');
    expect((accountASignal as AbortSignal | undefined)?.aborted).toBe(true);
    expect(favoriteButton?.getAttribute("aria-pressed")).toBe("false");

    await act(async () => {
      accountABody.resolve({ vendorIds: ["vendor-1"] });
      await flushAsyncWork();
    });

    expect(favoriteButton?.getAttribute("aria-pressed")).toBe("false");
  });
});
